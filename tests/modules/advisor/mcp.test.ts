import { afterEach, describe, expect, it, vi } from 'vitest'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Hono } from 'hono'
import { buildFamily } from '../../../src/demo/family'
import type { FamilyOverview } from '../../../src/domain/advisorOverview'
import { isoDate, shiftMonth } from '../../../src/domain/dates'
import { prevFinishedMonth } from '../../../src/domain/monthClose'
import { ADVISOR_GUIDE, ANSWER_RULES } from '../../../src/modules/advisor/guide'
import { createRegistrationLimiter, FAMILY_USER_ID, familyMarker, issueTokens, registerClient, revokeToken } from '../../../src/modules/advisor/oauth/store'
import { advisorMcpServer } from '../../../src/modules/advisor/mcp'
import { ADVISOR_TOOLS, toolInfo, type ToolContext } from '../../../src/modules/advisor/tools/registry'
import { createApp } from '../../../src/server/app'
import { getMonthCloseState, saveDraft } from '../../../src/server/monthClose'
import { writeFamily } from '../../../src/server/demo/writeFamily'
import { createTestDb, testConfig, type TestDb } from '../../helpers/db'
import { authFor, fakeAuthRuntime } from '../../helpers/auth'
import { FAMILY_PASSWORD, familyCookie, userCookie } from '../../helpers/session'

const APP_URL = 'https://family.test'
const MCP_URL = `${APP_URL}/mcp`
const TELEGRAM = { mode: 'telegram', TELEGRAM_BOT_TOKEN: '123:token', APP_URL }
const RESOURCE_METADATA = `Bearer resource_metadata="${APP_URL}/.well-known/oauth-protected-resource"`
const BOT = { username: () => 'fcbot', status: () => ({ configured: true, username: 'fcbot', problem: null }) }

type TextContent = { type: 'text'; text: string }
type ToolAnswer = { content: TextContent[]; isError?: boolean }

const clients: Client[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close()
})

/** The demo family with the advisor on; Ryan (manages) and Annika (view-only) have linked Telegram accounts. */
function setup() {
  const db = createTestDb()
  writeFamily(db.sqlite, buildFamily({ today: isoDate(new Date()) }))
  db.sqlite.exec(`UPDATE users SET telegram_id = '101' WHERE member = 'Ryan'`)
  db.sqlite.exec(`UPDATE users SET telegram_id = '102', can_edit = 0 WHERE member = 'Annika'`)
  const app = createApp({ db, config: testConfig(TELEGRAM, 'test-secret'), auth: authFor(testConfig(TELEGRAM, 'test-secret')), bot: BOT, ratesOnline: false })
  return { db, app }
}

const userOf = (db: TestDb, member: string) =>
  db.sqlite.prepare('SELECT id, telegram_id FROM users WHERE member = ?').get(member) as { id: number; telegram_id: string }

/** A registered Claude and a live access token of the member's, from the OAuth store */
async function tokenFor(db: TestDb, member: string, now = new Date()): Promise<string> {
  const client = await registerClient(db, { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }, now,
    { clientKey: 'test', limiter: createRegistrationLimiter(), referenced: [] })
  const user = userOf(db, member)
  const tokens = await issueTokens(db, { clientId: client.client_id, userId: Number(user.id), telegramId: user.telegram_id, chainId: `chain-${member}` }, now)
  return tokens.access_token
}

/** The SDK's own client over app.request, with the bearer token */
async function connect(app: Pick<Hono, 'request'>, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: (url, init) => Promise.resolve(app.request(String(url), init)),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  const client = new Client({ name: 'test-claude', version: '1.0.0' })
  await client.connect(transport)
  clients.push(client)
  return client
}

const textOf = (answer: unknown) => JSON.parse((answer as ToolAnswer).content[0].text) as unknown

const initialize = (headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } },
  }),
})

describe('the MCP endpoint', () => {
  it('initialize returns the guide as server instructions', async () => {
    const { db, app } = setup()
    const client = await connect(app, await tokenFor(db, 'Ryan'))
    expect(client.getInstructions()).toBe(ADVISOR_GUIDE)
    expect(client.getServerVersion()).toMatchObject({ name: 'monido' })
  })

  it('tools/list lists the twenty-one advisor tools with their schemas and readOnlyHint', async () => {
    const { db, app } = setup()
    const client = await connect(app, await tokenFor(db, 'Ryan'))
    const { tools } = await client.listTools()
    expect(tools.map(t => t.name)).toEqual(ADVISOR_TOOLS.map(t => t.name))
    expect(tools).toHaveLength(21)
    for (const tool of ADVISOR_TOOLS) {
      const listed = tools.find(t => t.name === tool.name)!
      expect(listed.description).toBe(tool.description)
      expect(listed.inputSchema).toEqual(tool.inputSchema)
      expect(listed.annotations?.readOnlyHint).toBe(toolInfo(tool).readOnly)
    }
    // the proposal writes ask before they run; the proposal reads do not
    const hint = (name: string) => tools.find(t => t.name === name)?.annotations?.readOnlyHint
    expect(['propose_to_family', 'revise_proposal', 'withdraw_proposal'].map(hint)).toEqual([false, false, false])
    // the preview writes nothing: it runs without asking
    expect(['get_proposal', 'list_proposals', 'preview_proposal'].map(hint)).toEqual([true, true, true])
    // the month-draft read and the statement preview write nothing; the statement commit asks first
    expect(['get_month_draft', 'preview_statement', 'commit_statement', 'close_month'].map(hint)).toEqual([true, true, false, false])
  })

  it('tools/call get_family_overview answers the demo family overview as JSON text', async () => {
    const { db, app } = setup()
    const client = await connect(app, await tokenFor(db, 'Ryan'))
    const answer = await client.callTool({ name: 'get_family_overview', arguments: {} })
    expect(answer.isError).toBeFalsy()
    const overview = textOf(answer) as FamilyOverview
    expect(overview.baseCurrency).toBe('USD')
    expect(overview.monthsOfData).toBe(12)
    expect(overview.incomeShares.map(x => x.member)).toEqual(expect.arrayContaining(['Ryan', 'Annika']))
    // the essential rules ride in the result: claude.ai does not show Claude the server's instructions
    expect((overview as FamilyOverview & { answerRules: unknown }).answerRules).toEqual(ANSWER_RULES)
  })

  it('tools/call evaluate_purchase without termMonths answers isError with missing_param termMonths', async () => {
    const { db, app } = setup()
    const client = await connect(app, await tokenFor(db, 'Ryan'))
    const answer = await client.callTool({
      name: 'evaluate_purchase',
      arguments: { kind: 'credit', amount: 20000, currency: 'USD', ratePct: 12, downPayment: 0, loanType: 'consumer' },
    })
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toEqual({ error: { code: 'missing_param', params: { param: 'termMonths' } } })
  })

  it('an unknown tool answers isError unknown_tool', async () => {
    const { db, app } = setup()
    const client = await connect(app, await tokenFor(db, 'Ryan'))
    const answer = await client.callTool({ name: 'drop_tables', arguments: {} })
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toEqual({ error: { code: 'unknown_tool' } })
  })

  it('a view-only member calling save_category_spending gets isError no_right_edit and nothing is written', async () => {
    const { db, app } = setup()
    const before = db.sqlite.prepare('SELECT COUNT(*) AS n FROM category_spending').get() as { n: number }
    const journal = db.sqlite.prepare('SELECT COUNT(*) AS n FROM change_log').get() as { n: number }
    const client = await connect(app, await tokenFor(db, 'Annika'))
    const answer = await client.callTool({
      name: 'save_category_spending',
      arguments: { month: prevFinishedMonth(new Date()), source: 'Bank card', items: [{ categoryId: 1, amount: 10, currency: 'USD' }] },
    })
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toEqual({ error: { code: 'no_right_edit' } })
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM category_spending').get()).toEqual(before)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM change_log').get()).toEqual(journal)
  })

  it('rights are read live: a member whose edit right is taken away cannot write with a token issued before', async () => {
    const { db, app } = setup()
    const client = await connect(app, await tokenFor(db, 'Ryan'))
    db.sqlite.exec(`UPDATE users SET can_edit = 0 WHERE member = 'Ryan'`)
    const answer = await client.callTool({ name: 'add_spending_category', arguments: { name: 'Pets', kind: 'optional' } })
    expect(textOf(answer)).toEqual({ error: { code: 'no_right_edit' } })
  })

  it('a write through MCP is journaled with source mcp and the member as actor', async () => {
    const { db, app } = setup()
    const client = await connect(app, await tokenFor(db, 'Ryan'))
    const listing = textOf(await client.callTool({ name: 'list_spending_categories', arguments: {} })) as { categories: { id: number; kind: string }[] }
    const category = listing.categories.find(c => c.kind === 'mandatory')!
    const month = shiftMonth(prevFinishedMonth(new Date()), -1) // the last closed month; the finished one is still open
    const answer = await client.callTool({
      name: 'save_category_spending',
      arguments: { month, source: 'MCP card', items: [{ categoryId: category.id, amount: 42, currency: 'USD' }] },
    })
    expect(answer.isError).toBeFalsy()
    expect(textOf(answer)).toEqual({ month, source: 'MCP card', totals: [{ currency: 'USD', amount: 42 }] })
    const rows = db.sqlite.prepare(`SELECT actor, source FROM change_log WHERE table_name = 'category_spending' AND op = 'insert' ORDER BY id DESC LIMIT 1`).all()
    expect(rows).toEqual([{ actor: 'Ryan', source: 'mcp' }])
  })

  it('no bearer, a cookie only, or an expired token → 401 with the resource_metadata header', async () => {
    const { db, app } = setup()
    const expired = await tokenFor(db, 'Ryan', new Date(Date.now() - 2 * 60 * 60 * 1000))
    const revoked = await tokenFor(db, 'Ryan')
    await revokeToken(db, revoked, new Date())
    const cases: Record<string, string>[] = [
      {},
      { Cookie: 'session=1.2' },
      { Authorization: `Bearer ${expired}` },
      { Authorization: `Bearer ${revoked}` },
      { Authorization: 'Bearer not-a-token' },
      { Authorization: `Basic ${Buffer.from('a:b').toString('base64')}` },
    ]
    for (const headers of cases) {
      const res = await app.request('/mcp', initialize(headers))
      expect(res.status, JSON.stringify(headers)).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toBe(RESOURCE_METADATA)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    }
  })

  it('a token of a deleted user or of a user whose Telegram was unlinked → 401', async () => {
    const { db, app } = setup()
    const ryan = await tokenFor(db, 'Ryan')
    const annika = await tokenFor(db, 'Annika')
    expect((await app.request('/mcp', initialize({ Authorization: `Bearer ${ryan}` }))).status).toBe(200)
    db.sqlite.exec(`UPDATE users SET telegram_id = NULL WHERE member = 'Ryan'`)
    db.sqlite.prepare('DELETE FROM users WHERE member = ?').run('Annika')
    for (const token of [ryan, annika]) {
      const res = await app.request('/mcp', initialize({ Authorization: `Bearer ${token}` }))
      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toBe(RESOURCE_METADATA)
    }
  })

  it('a token of a user re-created after the token (the same id given again) → 401', async () => {
    const { db, app } = setup()
    const token = await tokenFor(db, 'Ryan', new Date(Date.now() - 60_000))
    db.sqlite.prepare('UPDATE users SET created_at = ? WHERE member = ?').run(new Date().toISOString(), 'Ryan')
    expect((await app.request('/mcp', initialize({ Authorization: `Bearer ${token}` }))).status).toBe(401)
  })

  it('a successful answer is never cached', async () => {
    const { db, app } = setup()
    const res = await app.request('/mcp', initialize({ Authorization: `Bearer ${await tokenFor(db, 'Ryan')}` }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('a close() that fails after the answer is built is logged and does not replace the answer', async () => {
    const { db, app } = setup()
    const token = await tokenFor(db, 'Ryan')
    vi.spyOn(Server.prototype, 'close').mockRejectedValue(new Error('close broke'))
    const error = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await app.request('/mcp', initialize({ Authorization: `Bearer ${token}` }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'monido' } } })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const logged = error.mock.calls.map(([line]) => JSON.parse(line))
    expect(logged).toHaveLength(1)
    expect(logged[0].attributes).toMatchObject({ 'http.route': '/mcp', 'http.response.status_code': 200,
      'monido.request.id': res.headers.get('X-Request-Id'), 'error.type': 'Error' })
    expect(JSON.stringify(logged)).not.toContain('close broke')
  })

  it('prompts/list offers discuss_big_purchase', async () => {
    const { db, app } = setup()
    const client = await connect(app, await tokenFor(db, 'Ryan'))
    const { prompts } = await client.listPrompts()
    expect(prompts).toEqual([expect.objectContaining({ name: 'discuss_big_purchase', description: 'Discuss a big purchase with the family' })])
    const prompt = await client.getPrompt({ name: 'discuss_big_purchase' })
    expect(prompt.messages[0]).toMatchObject({ role: 'user', content: { type: 'text' } })
    await expect(client.getPrompt({ name: 'nope' })).rejects.toThrow()
  })

  it('GET /mcp answers 405, and so does DELETE', async () => {
    const { db, app } = setup()
    const token = await tokenFor(db, 'Ryan')
    for (const method of ['GET', 'DELETE']) {
      const res = await app.request('/mcp', { method, headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' } })
      expect(res.status, method).toBe(405)
    }
  })

  it('answers 404 while the connector is not available (APP_URL http://)', async () => {
    const { db } = setup()
    const token = await tokenFor(db, 'Ryan')
    const http = createApp({ db, config: testConfig({ ...TELEGRAM, APP_URL: 'http://family.test' }, 'test-secret'), auth: authFor(testConfig({ ...TELEGRAM, APP_URL: 'http://family.test' }, 'test-secret')), bot: BOT, ratesOnline: false })
    expect((await http.request('/mcp', initialize({ Authorization: `Bearer ${token}` }))).status).toBe(404)
    expect((await http.request('/mcp', { method: 'GET' })).status).toBe(404)
  })
})

describe('the sign-in mode switched at runtime', () => {
  it('connectorStatus and /mcp follow the mode with no restart', async () => {
    const db = createTestDb()
    writeFamily(db.sqlite, buildFamily({ today: isoDate(new Date()) }))
    db.sqlite.exec(`UPDATE users SET telegram_id = '101' WHERE member = 'Ryan'`)
    const auth = fakeAuthRuntime({ mode: 'password', botToken: '123:token' })
    // the config says telegram throughout: only the runtime moves
    const app = createApp({ db, config: testConfig(TELEGRAM, 'test-secret'), auth, bot: BOT, ratesOnline: false })
    const token = await tokenFor(db, 'Ryan')
    // the family password serves the connector too, but a person's Telegram token is not the family's
    expect((await app.request('/mcp', initialize({ Authorization: `Bearer ${token}` }))).status).toBe(401)
    expect((await app.request('/.well-known/oauth-protected-resource')).status).toBe(200)
    auth.set({ mode: 'telegram' })
    expect((await app.request('/mcp', initialize())).status).toBe(401)
    expect((await app.request('/mcp', initialize({ Authorization: `Bearer ${token}` }))).status).toBe(200)
    expect((await app.request('/.well-known/oauth-protected-resource')).status).toBe(200)
    auth.set({ mode: 'bootstrap' })
    expect((await app.request('/mcp', initialize())).status).toBe(404)
  })

  it('a family token acts as the family, with data entry only', async () => {
    const db = createTestDb()
    writeFamily(db.sqlite, buildFamily({ today: isoDate(new Date()) }))
    const auth = fakeAuthRuntime({ mode: 'password', sessionSecret: 'test-secret' })
    const app = createApp({ db, config: testConfig(TELEGRAM, 'test-secret'), auth, bot: BOT, ratesOnline: false })
    const now = new Date()
    const client = await registerClient(db, { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }, now, { clientKey: 'test', limiter: createRegistrationLimiter(), referenced: [] })
    const { access_token } = await issueTokens(db, { clientId: client.client_id, userId: FAMILY_USER_ID, telegramId: familyMarker(auth.generation()), chainId: 'family-chain' }, now)
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = await app.request('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
      expect(res.status).toBe(200)
      return JSON.parse(((await res.json()) as { result: ToolAnswer }).result.content[0].text) as Record<string, unknown>
    }
    expect(await call('add_spending_category', { name: 'Gym', kind: 'optional' })).toMatchObject({ category: { name: 'Gym' } })
    expect(db.sqlite.prepare('SELECT actor, source FROM change_log ORDER BY id DESC LIMIT 1').get()).toEqual({ actor: 'family', source: 'mcp' })
    // proposals need a person: the family has no vote right
    expect(await call('propose_to_family', { draftId: 'x' })).toMatchObject({ error: { code: expect.any(String) } })
    // a password change (a new generation) ends it
    await auth.setPassword('another password 123', { name: 'family', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null })
    expect((await app.request('/mcp', initialize({ Authorization: `Bearer ${access_token}` }))).status).toBe(401)
  })

  it('councilAvailable reads the live mode through the api context', async () => {
    const db = createTestDb()
    writeFamily(db.sqlite, buildFamily({ today: isoDate(new Date()) }))
    db.sqlite.exec(`UPDATE users SET telegram_id = '101' WHERE member = 'Ryan'`)
    const auth = fakeAuthRuntime({ mode: 'password', botToken: '123:token', sessionSecret: 'test-secret', password: FAMILY_PASSWORD })
    const app = createApp({ db, config: testConfig({ password: FAMILY_PASSWORD }, 'test-secret'), auth, ratesOnline: false })
    const available = async (Cookie: string) => ((await (await app.request('/api/advisor/proposals', { headers: { Cookie } })).json()) as { available: boolean }).available
    const ryan = (db.sqlite.prepare("SELECT id FROM users WHERE member = 'Ryan'").get() as { id: number }).id
    expect(await available(await familyCookie(auth))).toBe(false)
    auth.set({ mode: 'telegram' })
    expect(await available(await userCookie(auth, ryan))).toBe(true)
    auth.set({ mode: 'password' })
    expect(await available(await familyCookie(auth))).toBe(false)
  })
})

describe('the statement and loan tools through MCP', () => {
  const NOW = new Date()
  const LOAN = { name: 'Lakeview Mortgage', issue_date: '2026-03-15', principal: 120000, rate: 5.5, term_months: 240, currency: 'USD', member: 'Ryan', type: 'mortgage' }
  const call = async <T = Record<string, unknown>>(client: Client, name: string, args: Record<string, unknown> = {}) => {
    const answer = await client.callTool({ name, arguments: args })
    expect(answer.isError, JSON.stringify(textOf(answer))).toBeFalsy()
    return textOf(answer) as T
  }

  it('lists the six import tools right after save_category_spending, previews and the draft read-only', async () => {
    const { db, app } = setup()
    const client = await connect(app, await tokenFor(db, 'Ryan'))
    const { tools } = await client.listTools()
    const names = tools.map(t => t.name)
    const at = names.indexOf('save_category_spending')
    expect(names.slice(at + 1, at + 7)).toEqual(['get_month_draft', 'preview_statement', 'commit_statement', 'preview_loan', 'commit_loan', 'close_month'])
    const hint = (name: string) => tools.find(t => t.name === name)?.annotations?.readOnlyHint
    expect(names.slice(at + 1, at + 7).map(hint)).toEqual([true, true, false, true, false, false])
  })

  it('writes a loan, a statement and the close as the connected member, journaled with source mcp', async () => {
    const { db, app } = setup()
    const client = await connect(app, await tokenFor(db, 'Ryan'))
    const loan = await call<{ draftId: string }>(client, 'preview_loan', LOAN)
    await call(client, 'commit_loan', { draftId: loan.draftId })
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM loans WHERE name = ?').get(LOAN.name)).toEqual({ n: 1 })

    const view = await call<{ month: string; rows: { name: string; member: string; currency: string }[] }>(client, 'get_month_draft')
    const food = (await call<{ categories: { id: number; kind: string }[] }>(client, 'list_spending_categories')).categories.find(c => c.kind !== 'loan_payment')!.id
    const first = view.rows[0]
    const statement = await call<{ draftId: string }>(client, 'preview_statement', {
      month: view.month, account: { name: first.name, member: first.member, currency: first.currency },
      balance: 1000, active: 10, passive: 0, expense: 5, categories: [{ categoryId: food, amount: 5, currency: first.currency }],
    })
    await call(client, 'commit_statement', { draftId: statement.draftId })
    const stored = await call<{ accountLines: { bank: string; items: unknown[] }[] }>(client, 'get_month_draft')
    expect(stored.accountLines).toEqual([expect.objectContaining({ bank: first.name, items: [{ categoryId: food, amount: 5 }] })])

    // every other account through the wizard's draft, then close through the client
    const state = await getMonthCloseState(db, NOW)
    await saveDraft(db, view.month, { expectedRevision: (await getMonthCloseState(db, NOW)).draftRevision, rows: state.rows.map(r => (r.balance === null ? { ...r, balance: 1000, active: 10, passive: 0, expense: 5 } : r)), loans: [] }, NOW)
    const ready = await call<{ stateHash: string }>(client, 'get_month_draft')
    const closed = await call<{ closed: string }>(client, 'close_month', { month: view.month, stateHash: ready.stateHash })
    expect(closed.closed).toBe(view.month)

    const logged = db.sqlite.prepare('SELECT table_name AS t, source FROM change_log ORDER BY id').all() as { t: string; source: string }[]
    expect(logged.filter(r => r.t === 'loans').map(r => r.source)).toEqual(['mcp'])
    expect(logged.filter(r => r.t === 'flow_lines').map(r => r.source)).toEqual(['mcp'])
    expect(logged.length).toBeGreaterThan(0)
    expect(logged.every(r => r.source === 'mcp')).toBe(true)
    // closing is recorded in closed_months, under the member's name
    expect(db.sqlite.prepare('SELECT closed_by FROM closed_months WHERE month = ?').get(view.month)).toEqual({ closed_by: expect.stringContaining('Ryan') })
  })
})

describe('advisorMcpServer', () => {
  const RYAN = { name: 'Ryan', source: 'mcp' as const, rights: { edit: true, vote: true, manage: true }, userId: 1 }
  async function connect(onWrite?: (tool: string) => void) {
    const { db } = setup()
    const factory = vi.fn(async (): Promise<ToolContext> => ({ db, actor: RYAN, download: false, now: new Date(), env: {}, authMode: 'none', signInLink: null }))
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    await advisorMcpServer(factory, 'test', onWrite).connect(serverSide)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(clientSide)
    clients.push(client)
    return { client, factory }
  }

  it('reads the context on every tool call', async () => {
    const { client, factory } = await connect()
    await client.callTool({ name: 'get_family_overview', arguments: {} })
    await client.callTool({ name: 'get_family_overview', arguments: {} })
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('reports successful writes only', async () => {
    const onWrite = vi.fn()
    const { client } = await connect(onWrite)
    await client.callTool({ name: 'get_family_overview', arguments: {} })
    const refused = await client.callTool({ name: 'add_spending_category', arguments: {} }) as ToolAnswer
    expect(refused.isError).toBe(true)
    expect(onWrite).not.toHaveBeenCalled()
    const added = await client.callTool({ name: 'add_spending_category', arguments: { name: 'Gym', kind: 'optional' } }) as ToolAnswer
    expect(added.isError).toBeUndefined()
    expect(onWrite).toHaveBeenCalledExactlyOnceWith('add_spending_category')
  })
})
