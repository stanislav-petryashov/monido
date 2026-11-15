import { buildFamily } from '../../../src/demo/family'
import type { FamilyOverview } from '../../../src/domain/advisorOverview'
import { isoDate } from '../../../src/domain/dates'
import { writeFamily } from '../../../src/server/demo/writeFamily'
import { createApp } from '../../../src/server/app'
import { ADVISOR_GUIDE } from '../../../src/modules/advisor/guide'
import { callTool, toolInfo, ADVISOR_TOOLS } from '../../../src/modules/advisor/tools/registry'
import { createTestDb, testConfig, type TestDb } from '../../helpers/db'
import { authFor } from '../../helpers/auth'
import { FAMILY_PASSWORD, familyCookie } from '../../helpers/session'

const HEADERS = { 'Content-Type': 'application/json' }

function setup(db: TestDb = createTestDb(), env: Record<string, string> = { password: FAMILY_PASSWORD }) {
  const config = testConfig(env, 'secret')
  const auth = authFor(config)
  const app = createApp({ db, config, auth, ratesOnline: false })
  const call = async (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { ...HEADERS, Cookie: await familyCookie(auth) }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { db, app, auth, call }
}

describe('advisor tools over /api/advisor', () => {
  it('GET /api/advisor/tools lists get_advisor_guide with its schema and readOnly true', async () => {
    const res = await setup().call('GET', '/api/advisor/tools')
    expect(res.status).toBe(200)
    const { tools } = await res.json() as { tools: { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }[] }
    const guide = tools.find(t => t.name === 'get_advisor_guide')!
    expect(guide).toMatchObject({ readOnly: true, inputSchema: { type: 'object', properties: {} } })
    expect(guide.description).toMatch(/guide/i)
    expect(Object.keys(guide).sort()).toEqual(['description', 'inputSchema', 'name', 'readOnly'])
  })

  it('POST /api/advisor/tools/get_advisor_guide answers the guide text, with a body or without', async () => {
    const { call } = setup()
    const withBody = await call('POST', '/api/advisor/tools/get_advisor_guide', {})
    expect(withBody.status).toBe(200)
    expect(await withBody.json()).toEqual({ result: { guide: ADVISOR_GUIDE } })
    const { app, auth } = setup()
    const noBody = await app.request('/api/advisor/tools/get_advisor_guide', { method: 'POST', headers: { Cookie: await familyCookie(auth) } })
    expect(noBody.status).toBe(200)
    expect(((await noBody.json()) as { result: { guide: string } }).result.guide).toBe(ADVISOR_GUIDE)
  })

  it('the site route gates the council writes too: in password mode propose_to_family answers 409 council_unavailable and stores nothing', async () => {
    const db = createTestDb()
    writeFamily(db.sqlite, buildFamily({ today: isoDate(new Date()) }))
    const { call } = setup(db)
    const res = await call('POST', '/api/advisor/tools/propose_to_family', {
      scenario: { kind: 'buy_now', amount: 1000, currency: 'USD' }, title: 'A sofa', question: 'Shall we?',
      verdict: { risk: 'ok', recommended: null, reason: 'It fits' },
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'advisor.council_unavailable' } })
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM proposals').get()).toEqual({ n: 0 })
  })

  it('an unknown tool answers 404 unknown_tool', async () => {
    const res = await setup().call('POST', '/api/advisor/tools/nope', {})
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'unknown_tool' } })
  })

  it('refuses a request without a signed-in user', async () => {
    const res = await setup().app.request('/api/advisor/tools')
    expect(res.status).toBe(401)
  })

  it('in the demo the advisor\'s paths do not exist: /api/advisor/* answers 404 not_found', async () => {
    const demo = createApp({ db: createTestDb(), config: testConfig({ AUTH_MODE: 'demo' }, 'demo-secret'), auth: authFor(testConfig({ AUTH_MODE: 'demo' }, 'demo-secret')), ratesOnline: false })
    const res = await demo.request('/api/advisor/tools')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'not_found' } })
  })

  it('GET on a call path or POST on the list answers 405', async () => {
    const { call } = setup()
    for (const [method, path] of [['GET', '/api/advisor/tools/get_advisor_guide'], ['POST', '/api/advisor/tools'], ['DELETE', '/api/advisor/tools']] as const) {
      const res = await call(method, path, method === 'POST' ? {} : undefined)
      expect(res.status, `${method} ${path}`).toBe(405)
      expect(await res.json()).toEqual({ error: { code: 'method_not_allowed' } })
    }
  })
})

describe('the tool registry', () => {
  const ctx = (rights: { edit: boolean }) => ({
    db: createTestDb(), download: false, now: new Date('2026-10-24T00:00:00Z'), env: {}, authMode: 'password' as const,
    actor: { name: 'o', source: 'admin' as const, rights: { edit: rights.edit, manage: false, vote: true }, userId: null },
  })

  it('describes a tool as info: readOnly follows the right it needs', () => {
    const tool = ADVISOR_TOOLS.find(t => t.name === 'get_advisor_guide')!
    expect(tool.right).toBeNull()
    expect(toolInfo(tool)).toEqual({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, readOnly: true })
  })

  it('callTool runs a known tool and rejects an unknown one', async () => {
    expect(await callTool('get_advisor_guide', ctx({ edit: false }), {})).toEqual({ guide: ADVISOR_GUIDE })
    await expect(callTool('nope', ctx({ edit: false }), {})).rejects.toMatchObject({ status: 404, code: 'unknown_tool' })
  })
})

describe('get_family_overview', () => {
  it('answers the demo family overview with base currency and gaps', async () => {
    const db = createTestDb()
    writeFamily(db.sqlite, buildFamily({ today: isoDate(new Date()) }))
    const { call } = setup(db)

    const list = await (await call('GET', '/api/advisor/tools')).json() as { tools: { name: string; readOnly: boolean }[] }
    expect(list.tools.find(t => t.name === 'get_family_overview')).toMatchObject({ readOnly: true })

    const res = await call('POST', '/api/advisor/tools/get_family_overview', {})
    expect(res.status).toBe(200)
    const { result } = await res.json() as { result: FamilyOverview }
    expect(result.baseCurrency).toBe('USD')
    expect(result.monthsOfData).toBe(3)
    expect(result.now.incomePerMonth).toBeGreaterThan(10000)
    expect(result.now.loanPaymentsPerMonth).toBeGreaterThan(0)
    expect(result.mandatory).toMatchObject({ source: 'categories' })
    expect(result.loans.map(l => l.name).length).toBeGreaterThanOrEqual(2)
    expect(result.goals.length).toBe(3)
    expect(result.health.length).toBeGreaterThan(0)
    expect(result.incomeShares.map(x => x.member)).toEqual(expect.arrayContaining(['Ryan', 'Annika']))
    expect(Array.isArray(result.gaps)).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/)
  })

  it('needs no right besides a signed-in user', async () => {
    const tool = ADVISOR_TOOLS.find(t => t.name === 'get_family_overview')!
    expect(tool.right).toBeNull()
  })
})
