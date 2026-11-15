import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'
import type { Evaluation } from '../../../src/domain/advisorImpact'
import type { ProposalsView, ProposalView } from '../../../src/domain/api'
import { isoDate } from '../../../src/domain/dates'
import { deliveries } from '../../../src/modules/advisor/council/delivery'
import { createApp } from '../../../src/server/app'
import { createLoginAttempts, type LoginAttempts } from '../../../src/server/loginAttempts'
import { testConfig, type TestDb } from '../../helpers/db'
import { addMember, COUNCIL_CHATS, councilFamily, CREDIT } from '../../helpers/council'
import { authFor } from '../../helpers/auth'
import { fakeTelegram as telegramRecorder } from '../../helpers/telegram'

// The site's council routes through createApp with a signed-in Telegram session: the list, votes with a comment, a
// comment added later, withdraw, the goal link and the settings.

const TELEGRAM = { mode: 'telegram', TELEGRAM_BOT_TOKEN: '123:secret-token', APP_URL: 'https://fc.example' }
const PASSWORD = 'correct horse battery'
const BOT = { username: () => 'fcbot', status: () => ({ configured: true, username: 'fcbot', problem: null }) }
const CHAT = { ...COUNCIL_CHATS, Olga: '104', Pavel: '105' } as const

type Member = keyof typeof CHAT

/** The shared Telegram as the global fetch; `to` takes a member (not a chat id). */
function fakeTelegram() {
  const base = telegramRecorder({ stub: true })
  return { ...base, to: (member: Member) => base.to(CHAT[member]) }
}

let tg: ReturnType<typeof fakeTelegram>
beforeEach(() => { tg = fakeTelegram() })
afterEach(async () => {
  await deliveries.flush()
})

/**
 * The council family (helpers/council.ts: Ryan with all rights, Annika edit and vote, Mila vote only) and Olga, who may
 * neither edit nor vote, each with a linked Telegram account; `env` — the app's sign-in mode.
 */
function setup(env: Record<string, string> = TELEGRAM) {
  const { db } = councilFamily()
  addMember(db, 'Olga', { edit: false, vote: false, telegramId: CHAT.Olga })
  const logins = createLoginAttempts()
  const app = createApp({ db, config: testConfig(env, 'test-secret'), auth: authFor(testConfig(env, 'test-secret')), logins, bot: BOT, ratesOnline: false })
  return { db, app, ...client(db, app, logins) }
}

/** Requests as a member signed in through the bot (one session each, made on first use). */
function client(db: TestDb, app: Pick<Hono, 'request'>, logins: LoginAttempts) {
  const sessions = new Map<Member, string>()
  const idOf = (member: Member) => (db.sqlite.prepare('SELECT id FROM users WHERE member = ?').get(member) as { id: number }).id
  async function session(member: Member): Promise<string> {
    const known = sessions.get(member)
    if (known) return known
    const start = await app.request('/api/auth/telegram', { method: 'POST' })
    const { link } = await start.json() as { link: string }
    const login = start.headers.getSetCookie().find(l => l.startsWith('login='))!.split(';')[0]
    expect(logins.approve(/login_(.+)$/.exec(link)![1], idOf(member))).toBe(true)
    const done = await app.request('/api/auth/telegram', { headers: { Cookie: login } })
    const cookie = done.headers.getSetCookie().find(l => l.startsWith('session='))!.split(';')[0]
    sessions.set(member, cookie)
    return cookie
  }
  async function request(member: Member, method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Cookie: await session(member) }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  }
  /** The answer's JSON, after checking its status */
  async function call<T = ProposalsView>(member: Member, method: string, path: string, body?: unknown, status = 200): Promise<T> {
    const res = await request(member, method, path, body)
    const out = await res.json() as T
    expect(res.status, `${method} ${path}: ${JSON.stringify(out)}`).toBe(status)
    return out
  }
  /** Ryan sends a proposal through the tools route (the server weighs it); its view */
  async function propose(scenario: Record<string, unknown> = CREDIT, title = 'A car on credit', evaluate = 'evaluate_purchase'): Promise<ProposalView> {
    // evaluate_goal takes the goal's fields without the kind
    const input = evaluate === 'evaluate_goal' ? Object.fromEntries(Object.entries(scenario).filter(([key]) => key !== 'kind')) : scenario
    const { result } = await call<{ result: { evaluation: Evaluation } }>('Ryan', 'POST', `/api/advisor/tools/${evaluate}`, input)
    const verdict = { risk: result.evaluation.impact.risk, recommended: null, reason: 'The payment fits the budget and the cushion stays' }
    const draft = await call<{ result: { draftId: string } }>('Ryan', 'POST', '/api/advisor/tools/preview_proposal', {
      scenario, title, question: 'Shall we?', verdict,
    })
    const sent = await call<{ result: { proposal: ProposalView } }>('Ryan', 'POST', '/api/advisor/tools/propose_to_family', { draftId: draft.result.draftId })
    await deliveries.flush()
    return sent.result.proposal
  }
  /** The body naming the proposal's current version, as the card sends it, unless the test names one itself */
  const versioned = (id: number, body: unknown) => {
    if (!body || typeof body !== 'object' || 'versionId' in body) return body
    const row = db.sqlite.prepare('SELECT MAX(id) AS v FROM proposal_versions WHERE proposal_id = ?').get(id) as { v: number | null } | undefined
    return { ...body, versionId: row?.v ?? 0 }
  }
  const vote = (member: Member, id: number, body: unknown, status = 200) => call(member, 'POST', `/api/advisor/proposals/${id}/votes`, versioned(id, body), status)
  const comment = (member: Member, id: number, body: unknown, status = 200) => call(member, 'POST', `/api/advisor/proposals/${id}/comment`, versioned(id, body), status)
  const error = (out: unknown) => (out as { error: { code: string; params?: Record<string, unknown> } }).error
  return { idOf, session, request, call, propose, vote, comment, error }
}

const viewOf = (out: ProposalsView, id: number) => out.proposals.find(p => p.id === id)!
const voteRow = (db: TestDb, member: string) => db.sqlite.prepare(`SELECT pv.vote, pv.settled, pv.settled_by, pv.comment FROM proposal_votes pv
  JOIN users u ON u.id = pv.user_id WHERE u.member = ? ORDER BY pv.version_id DESC LIMIT 1`).get(member) as Record<string, unknown> | undefined

describe('GET /api/advisor/proposals', () => {
  it('GET lists the open proposals first and the settings; in password mode available is false and the list empty', async () => {
    const t = setup()
    const first = await t.propose()
    await t.call('Ryan', 'POST', `/api/advisor/proposals/${first.id}/withdraw`)
    const targetDate = isoDate(new Date(Date.now() + 3 * 365 * 86_400_000))
    const second = await t.propose({ kind: 'goal', name: 'Piano', amount: 6000, currency: 'USD', targetDate }, 'A piano', 'evaluate_goal')

    const ryan = await t.call('Ryan', 'GET', '/api/advisor/proposals')
    expect(ryan).toMatchObject({ available: true, settings: { decideDays: 14, remindDays: 3 }, canCreateGoal: true })
    expect(ryan.proposals.map(p => [p.id, p.status])).toEqual([[second.id, 'open'], [first.id, 'withdrawn']])
    expect(viewOf(ryan, second.id).you).toEqual({ voter: true, vote: 'agree', settled: true, author: true })
    // Mila may not edit: no Create goal
    const mila = await t.call('Mila', 'GET', '/api/advisor/proposals')
    expect(mila.canCreateGoal).toBe(false)
    expect(viewOf(mila, second.id).you).toEqual({ voter: true, vote: null, settled: false, author: false })
    expect((await t.request('Ryan', 'DELETE', '/api/advisor/proposals')).status).toBe(405)

    // the same database behind a family password: no council, so nothing is listed and nothing can be written
    const app = createApp({ db: t.db, config: testConfig({ password: PASSWORD }, 'test-secret'), auth: authFor(testConfig({ password: PASSWORD }, 'test-secret')), ratesOnline: false })
    const login = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })
    const Cookie = login.headers.getSetCookie().find(l => l.startsWith('session='))!.split(';')[0]
    const list = await app.request('/api/advisor/proposals', { headers: { Cookie } })
    expect(list.status).toBe(200)
    expect(await list.json()).toEqual({ available: false, proposals: [], settings: { decideDays: 14, remindDays: 3 }, canCreateGoal: true })
    const write = (path: string, body: unknown) =>
      app.request(path, { method: 'POST', headers: { Cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    for (const [path, body] of [[`/api/advisor/proposals/${second.id}/votes`, { vote: 'agree' }], [`/api/advisor/proposals/${second.id}/withdraw`, {}],
      [`/api/advisor/proposals/${second.id}/comment`, { comment: 'Hi' }]] as const) {
      const res = await write(path, body)
      expect(res.status, path).toBe(409)
      expect(t.error(await res.json()).code).toBe('advisor.council_unavailable')
    }
    expect(voteRow(t.db, 'Annika')).toBeUndefined()
  })
})

describe('site votes', () => {
  it('a site vote with a comment settles at once, edits the Telegram cards (delivery rows dirty) and accepts when it was the last', async () => {
    const t = setup()
    const p = await t.propose()
    // the cards of Annika and Mila, Ryan's status message
    expect(tg.calls.filter(c => c.method === 'sendMessage').map(c => c.chat).sort()).toEqual(['101', '102', '103'])
    tg.calls.length = 0

    const release = tg.hold()
    const after = await t.vote('Annika', p.id, { vote: 'agree', comment: ' Fine\u200b by me\r\nlet us go ' })
    expect(after.available).toBe(true)
    const view = viewOf(after, p.id)
    expect(view.status).toBe('open')
    expect(view.you.vote).toBe('agree')
    expect(view.current.votes.find(v => v.member === 'Annika')).toMatchObject({ vote: 'agree', settled: true, comment: 'Fine by me\nlet us go' })
    expect(voteRow(t.db, 'Annika')).toEqual({ vote: 'agree', settled: 1, settled_by: 'site', comment: 'Fine by me\nlet us go' })
    // the write marked every message of the version; the delivery runs right after the answer
    expect(t.db.sqlite.prepare('SELECT COUNT(*) AS n FROM proposal_messages WHERE dirty > 0').get()).toEqual({ n: 3 })
    release()
    await deliveries.flush()
    expect(tg.calls.filter(c => c.method === 'editMessageText').map(c => c.chat).sort()).toEqual(['101', '102', '103'])
    expect(t.db.sqlite.prepare(`SELECT actor, source FROM change_log WHERE table_name = 'proposal_votes' ORDER BY id DESC LIMIT 1`).get())
      .toEqual({ actor: 'Annika', source: 'admin' })

    // the same vote again changes nothing
    await t.vote('Annika', p.id, { vote: 'agree' })
    expect(voteRow(t.db, 'Annika')).toMatchObject({ comment: 'Fine by me\nlet us go' })
    // the same agree with a new comment keeps the comment (it goes onto the settled agree)
    const again = await t.vote('Annika', p.id, { vote: 'agree', comment: 'Even better with a bonus' })
    expect(viewOf(again, p.id).current.votes.find(v => v.member === 'Annika')).toMatchObject({ vote: 'agree', settled: true, comment: 'Even better with a bonus' })
    expect(voteRow(t.db, 'Annika')).toEqual({ vote: 'agree', settled: 1, settled_by: 'site', comment: 'Even better with a bonus' })
    // the author's agree came with the proposal: a comment from the site goes onto it too
    await t.vote('Ryan', p.id, { vote: 'agree', comment: 'My reasons' })
    expect(voteRow(t.db, 'Ryan')).toMatchObject({ vote: 'agree', comment: 'My reasons' })

    // Mila's agree is the last one: accepted, and every voter is told
    tg.calls.length = 0
    const last = await t.vote('Mila', p.id, { vote: 'agree' })
    expect(viewOf(last, p.id).status).toBe('accepted')
    await deliveries.flush()
    expect(new Set(tg.calls.map(c => c.chat))).toEqual(new Set(['101', '102', '103']))
  })

  it('an against from the site, with its comment, sends the proposal back to the author', async () => {
    const t = setup()
    const p = await t.propose()
    const out = await t.vote('Mila', p.id, { vote: 'against', comment: 'Let us wait for the bonus' })
    expect(viewOf(out, p.id).status).toBe('revising')
    expect(voteRow(t.db, 'Mila')).toEqual({ vote: 'against', settled: 1, settled_by: 'site', comment: 'Let us wait for the bonus' })
    // the version is frozen: Annika's vote is refused
    expect(t.error(await t.vote('Annika', p.id, { vote: 'agree' }, 409)).code).toBe('advisor.proposal_closed')
  })

  it('a voter whose Telegram card is blocked still votes on the site', async () => {
    const t = setup()
    tg.chats[CHAT.Mila] = 'blocked'
    const p = await t.propose()
    expect(t.db.sqlite.prepare(`SELECT state FROM proposal_messages WHERE chat_id = ?`).get(CHAT.Mila)).toEqual({ state: 'blocked' })
    const sentToMila = tg.to('Mila').length

    await t.vote('Mila', p.id, { vote: 'agree', comment: 'From the site' })
    expect(voteRow(t.db, 'Mila')).toMatchObject({ vote: 'agree', settled: 1, settled_by: 'site' })
    const out = await t.vote('Annika', p.id, { vote: 'agree' })
    // her vote counted: Annika's was the last one
    expect(viewOf(out, p.id).status).toBe('accepted')
    await deliveries.flush()
    // her blocked card is never tried again (only the new accepted notice is tried, once); the others' cards are edited
    expect(tg.to('Mila').slice(sentToMila).map(c => c.method)).toEqual(['sendMessage'])
    expect(tg.to('Annika').some(c => c.method === 'editMessageText')).toBe(true)
    expect(t.db.sqlite.prepare(`SELECT state FROM proposal_messages WHERE chat_id = ? AND kind = 'card'`).get(CHAT.Mila)).toEqual({ state: 'blocked' })
  })

  it('a vote by a non-voter is 403 not_a_voter (with or without the right); on a closed proposal 409', async () => {
    const t = setup()
    const p = await t.propose()
    // Pavel gets the vote right after the proposal was sent: the voters were fixed then
    addMember(t.db, 'Pavel', { edit: false, telegramId: CHAT.Pavel })
    expect(t.error(await t.vote('Pavel', p.id, { vote: 'agree' }, 403)).code).toBe('advisor.not_a_voter')
    // Olga has no vote right and so is not a voter: the version's voters decide, as in the bot
    expect(t.error(await t.vote('Olga', p.id, { vote: 'agree' }, 403)).code).toBe('advisor.not_a_voter')
    // the body
    expect(t.error(await t.vote('Annika', p.id, {}, 400))).toEqual({ code: 'missing_param', params: { param: 'vote' } })
    expect(t.error(await t.vote('Annika', p.id, { vote: 'maybe' }, 400))).toEqual({ code: 'invalid_param', params: { param: 'vote' } })
    expect(t.error(await t.vote('Annika', p.id, { vote: 'agree', comment: 5 }, 400))).toEqual({ code: 'invalid_param', params: { param: 'comment' } })
    expect(t.error(await t.vote('Annika', 999, { vote: 'agree' }, 404)).code).toBe('advisor.proposal_not_found')
    expect(t.error(await t.vote('Annika', 'abc' as unknown as number, { vote: 'agree' }, 404)).code).toBe('advisor.proposal_not_found')
    expect((await t.request('Annika', 'GET', `/api/advisor/proposals/${p.id}/votes`)).status).toBe(405)
    // a vote names the version it answers: none is 400, one no longer current is 409
    expect(t.error(await t.vote('Annika', p.id, { vote: 'agree', versionId: null }, 400))).toEqual({ code: 'missing_param', params: { param: 'versionId' } })
    expect(t.error(await t.vote('Annika', p.id, { vote: 'agree', versionId: 'x' }, 400))).toEqual({ code: 'invalid_param', params: { param: 'versionId' } })
    expect(t.error(await t.vote('Annika', p.id, { vote: 'agree', versionId: p.current.id - 1 }, 409))).toEqual({ code: 'advisor.version_changed', params: { number: p.current.number } })
    expect(t.error(await t.comment('Annika', p.id, { comment: 'Hm', versionId: p.current.id - 1 }, 409)).code).toBe('advisor.version_changed')
    expect(voteRow(t.db, 'Annika')).toBeUndefined()

    await t.call('Ryan', 'POST', `/api/advisor/proposals/${p.id}/withdraw`)
    expect(t.error(await t.vote('Annika', p.id, { vote: 'agree' }, 409)).code).toBe('advisor.proposal_closed')
    expect(voteRow(t.db, 'Annika')).toBeUndefined()
  })

  it('a voter whose vote right was taken away mid-proposal still votes and comments; the author without it withdraws', async () => {
    const t = setup()
    const p = await t.propose()
    t.db.sqlite.exec(`UPDATE users SET can_vote = 0 WHERE member IN ('Ryan', 'Annika')`)
    expect(viewOf(await t.vote('Annika', p.id, { vote: 'agree' }), p.id).current.votes.find(v => v.member === 'Annika'))
      .toMatchObject({ vote: 'agree', settled: true })
    const commented = await t.comment('Annika', p.id, { comment: 'Still fine' })
    expect(viewOf(commented, p.id).current.votes.find(v => v.member === 'Annika')).toMatchObject({ comment: 'Still fine' })
    expect(viewOf(await t.call('Ryan', 'POST', `/api/advisor/proposals/${p.id}/withdraw`), p.id).status).toBe('withdrawn')
  })
})

describe('the same origin', () => {
  it('a vote from another origin is 403 cross_origin and writes nothing', async () => {
    const t = setup()
    const p = await t.propose()
    await t.request('Annika', 'GET', '/api/advisor/proposals')
    const res = await t.app.request(`/api/advisor/proposals/${p.id}/votes`, {
      method: 'POST',
      headers: { Cookie: await t.session('Annika'), 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ vote: 'agree' }),
    })
    expect(res.status).toBe(403)
    expect(t.error(await res.json()).code).toBe('cross_origin')
    expect(voteRow(t.db, 'Annika')).toBeUndefined()
  })
})

describe('a comment added to a settled agree', () => {
  it('adds a comment to one\'s own settled agree; nothing to comment is 409; a closed proposal is 409', async () => {
    const t = setup()
    const p = await t.propose()
    await t.vote('Annika', p.id, { vote: 'agree' })
    await deliveries.flush()
    tg.calls.length = 0
    const comment = (member: Member, body: unknown, status = 200) => t.comment(member, p.id, body, status)

    const out = await comment('Annika', { comment: '  Fine by me\u0007 ' })
    expect(viewOf(out, p.id).current.votes.find(v => v.member === 'Annika')).toMatchObject({ vote: 'agree', settled: true, comment: 'Fine by me' })
    expect(t.db.sqlite.prepare(`SELECT actor, source, op FROM change_log WHERE table_name = 'proposal_votes' ORDER BY id DESC LIMIT 1`).get())
      .toEqual({ actor: 'Annika', source: 'admin', op: 'update' })
    // the cards show no agree comment: rendered again, they are unchanged and not sent
    await deliveries.flush()
    expect(tg.calls).toEqual([])
    // the same comment again is a no-op
    const journaled = t.db.sqlite.prepare('SELECT COUNT(*) AS n FROM change_log').get()
    await comment('Annika', { comment: 'Fine by me' })
    expect(t.db.sqlite.prepare('SELECT COUNT(*) AS n FROM change_log').get()).toEqual(journaled)

    // Mila has not voted: there is nothing to add the comment to
    expect(t.error(await comment('Mila', { comment: 'Hm' }, 409)).code).toBe('advisor.nothing_to_comment')
    expect(t.error(await comment('Olga', { comment: 'Hm' }, 403)).code).toBe('advisor.not_a_voter')
    expect(t.error(await comment('Annika', { comment: ' \u200b ' }, 400))).toEqual({ code: 'missing_param', params: { param: 'comment' } })
    expect(t.error(await comment('Annika', { comment: 1 }, 400))).toEqual({ code: 'invalid_param', params: { param: 'comment' } })

    // an against freezes the version: the comment comes too late
    await t.vote('Mila', p.id, { vote: 'against' })
    expect(t.error(await comment('Annika', { comment: 'Another' }, 409)).code).toBe('advisor.proposal_closed')
    expect(voteRow(t.db, 'Annika')).toMatchObject({ comment: 'Fine by me' })
  })
})

describe('withdraw and the goal link', () => {
  // the store's refusals (another's, a closed or a missing proposal; a credit, an unknown goal, a second link) are
  // councilStore.test.ts's: the route keeps its own checks, one refusal passed through, and the success
  it('withdraw by the author; linking a goal needs edit and a goalId, and passes the store\'s refusal through', async () => {
    const t = setup()
    const credit = await t.propose()
    expect(t.error(await t.call('Annika', 'POST', `/api/advisor/proposals/${credit.id}/withdraw`, undefined, 403)).code).toBe('advisor.not_author')
    tg.calls.length = 0
    const withdrawn = await t.call('Ryan', 'POST', `/api/advisor/proposals/${credit.id}/withdraw`)
    expect(viewOf(withdrawn, credit.id).status).toBe('withdrawn')
    await deliveries.flush()
    expect(tg.calls.length).toBeGreaterThan(0)

    const targetDate = isoDate(new Date(Date.now() + 3 * 365 * 86_400_000))
    const goal = await t.propose({ kind: 'goal', name: 'Piano', amount: 6000, currency: 'USD', targetDate }, 'A piano', 'evaluate_goal')
    const link = (member: Member, id: number, body: unknown, status = 200) => t.call(member, 'PUT', `/api/advisor/proposals/${id}/goal`, body, status)
    // not accepted yet
    expect(t.error(await link('Ryan', goal.id, { goalId: 'vacation' }, 409)).code).toBe('advisor.cannot_link_goal')
    await t.vote('Annika', goal.id, { vote: 'agree' })
    await t.vote('Mila', goal.id, { vote: 'agree' })

    expect(t.error(await link('Mila', goal.id, { goalId: 'vacation' }, 403)).code).toBe('no_right_edit')
    expect(t.error(await link('Ryan', goal.id, {}, 400))).toEqual({ code: 'missing_param', params: { param: 'goalId' } })
    expect(t.error(await link('Ryan', goal.id, { goalId: 7 }, 400))).toEqual({ code: 'invalid_param', params: { param: 'goalId' } })
    const linked = await link('Annika', goal.id, { goalId: 'vacation' })
    expect(viewOf(linked, goal.id).goal).toEqual({ id: 'vacation', deleted: false })
    expect((await t.request('Ryan', 'POST', `/api/advisor/proposals/${goal.id}/goal`, { goalId: 'vacation' })).status).toBe(405)
  })

})

describe('settings', () => {
  // the days' rules are saveSettings' (councilStore.test.ts) and parseSettings' (tests/domain/proposals.test.ts): the
  // route keeps the manage right, one refusal passed through with its params, the success and the method
  it('settings: the manage right, a refusal with its params, the saved days', async () => {
    const t = setup()
    const put = (member: Member, body: unknown, status = 200) => t.call(member, 'PUT', '/api/advisor/settings', body, status)
    expect(t.error(await put('Annika', { decideDays: 7, remindDays: 2 }, 403)).code).toBe('no_right_manage')
    expect(t.error(await put('Ryan', { decideDays: 7, remindDays: 7 }, 400))).toEqual({ code: 'advisor.remind_after_deadline', params: { param: 'remindDays' } })
    expect(await put('Ryan', { decideDays: 60, remindDays: 59 })).toEqual({ decideDays: 60, remindDays: 59 })
    expect(await put('Ryan', { decideDays: 7, remindDays: null })).toEqual({ decideDays: 7, remindDays: null })
    expect((await t.call('Annika', 'GET', '/api/advisor/proposals')).settings).toEqual({ decideDays: 7, remindDays: null })
    expect(t.db.sqlite.prepare(`SELECT actor, source FROM change_log WHERE table_name = 'advisor_settings' ORDER BY id DESC LIMIT 1`).get())
      .toEqual({ actor: 'Ryan', source: 'admin' })
    expect((await t.request('Ryan', 'GET', '/api/advisor/settings')).status).toBe(405)
  })
})
