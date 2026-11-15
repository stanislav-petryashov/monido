import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { familyT } from '../../../src/server/bot/texts'
import type { Evaluation } from '../../../src/domain/advisorImpact'
import type { AuthMode } from '../../../src/domain/api'
import { isoDate } from '../../../src/domain/dates'
import { deadlineAfter } from '../../../src/domain/proposals'
import { deliveries } from '../../../src/modules/advisor/council/delivery'
import { castVote } from '../../../src/modules/advisor/council/store'
import { councilAvailable } from '../../../src/modules/advisor/council/available'
import { ADVISOR_TOOLS, callTool, toolInfo, type ToolContext } from '../../../src/modules/advisor/tools/registry'
import { actorOfUser } from '../../../src/server/auth'
import type { Actor } from '../../../src/server/http'
import { type TestDb } from '../../helpers/db'
import { CREDIT, councilFamily, type CouncilMember } from '../../helpers/council'
import { ru } from '../../helpers/i18n'

const ENV = { TELEGRAM_BOT_TOKEN: '123:secret-token', APP_URL: 'https://fc.example' }
/** A loan far beyond the family's means: the computed risk is not `ok`, so `ok` is lighter */
const HEAVY = { kind: 'credit', amount: 400000, currency: 'USD', termMonths: 12, ratePct: 20, downPayment: 0, loanType: 'consumer' }

type Member = CouncilMember
type VoteOut = { member: string; vote: string | null; settled: boolean; userComment: string | null }
type VersionOut = { id: number; number: number; title: string; question: string; evaluation: Evaluation; verdict: Record<string, unknown>; votes: VoteOut[] }
type ProposalOut = { id: number; status: string; type: string; current: VersionOut; previous: VersionOut[]; author: { member: string } }

// every test's deliveries go to a fake Telegram, never the network
let tg: ReturnType<typeof fakeTelegram>
beforeEach(() => { tg = fakeTelegram() })
afterEach(async () => {
  await deliveries.flush()
})

/** Telegram that answers every call with success and remembers the chats it was sent to and the texts sent there. */
function fakeTelegram() {
  const chats: string[] = []
  const texts: { chat: string; text: string }[] = []
  let nextId = 500
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    chats.push(String(body.chat_id))
    if (typeof body.text === 'string') texts.push({ chat: String(body.chat_id), text: body.text })
    return new Response(JSON.stringify({ ok: true, result: url.endsWith('/sendMessage') ? { message_id: nextId++ } : true }))
  })
  vi.stubGlobal('fetch', fetchImpl)
  return { chats, texts }
}

/** The council family (helpers/council.ts): Ryan, Annika and Mila vote; the tools are called as one of them. */
function setup() {
  const { db, ids } = councilFamily()
  const idOf = (member: Member) => ids[member.toLowerCase() as keyof typeof ids]
  /** The member as the connector signs them in: rights read from the database, source `mcp` */
  const actor = async (member: Member): Promise<Actor> => (await actorOfUser(db, idOf(member), Date.now(), 'mcp'))!
  const ctx = async (member: Member, authMode: AuthMode = 'telegram'): Promise<ToolContext> =>
    ({ db, actor: await actor(member), download: false, now: new Date(), env: ENV, authMode })
  const call = async (member: Member, name: string, input: unknown) => callTool(name, await ctx(member), input)
  return { db, idOf, actor, ctx, call }
}

type Preview = {
  draftId: string; expiresAt: string; card: { text: string }; voters: string[]; acceptedAtOnce: boolean
  baseCurrency: string; evaluation: Evaluation; nextStep: string
}

/** preview_proposal as `member` */
const preview = (t: ReturnType<typeof setup>, member: Member, input: Record<string, unknown>) =>
  t.call(member, 'preview_proposal', input) as Promise<Preview>

/** The two steps: the preview, then propose_to_family (or revise_proposal, for a preview with proposalId) with its draftId. */
async function send(t: ReturnType<typeof setup>, member: Member, input: Record<string, unknown>): Promise<{ proposal: ProposalOut }> {
  const { draftId } = await preview(t, member, input)
  return t.call(member, input.proposalId === undefined ? 'propose_to_family' : 'revise_proposal', { draftId }) as Promise<{ proposal: ProposalOut }>
}

const count = (db: TestDb, table: string) => (db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

/** The server's own evaluation of a scenario, through evaluate_purchase */
async function computed(call: ReturnType<typeof setup>['call'], scenario: Record<string, unknown>): Promise<Evaluation> {
  return ((await call('Ryan', 'evaluate_purchase', scenario)) as { evaluation: Evaluation }).evaluation
}

const verdictOf = (evaluation: Evaluation, extra: Record<string, unknown> = {}) =>
  ({ risk: evaluation.impact.risk, recommended: null, reason: 'The payment fits the budget and the cushion stays', ...extra })

async function proposeCar(t: ReturnType<typeof setup>, extra: Record<string, unknown> = {}): Promise<ProposalOut> {
  const evaluation = await computed(t.call, CREDIT)
  const answer = await send(t, 'Ryan', {
    scenario: CREDIT, title: 'A car on credit', question: 'Shall we buy the family car?', verdict: verdictOf(evaluation), ...extra,
  })
  return answer.proposal
}

const journal = (db: TestDb, table: string) =>
  db.sqlite.prepare('SELECT actor, source, op FROM change_log WHERE table_name = ? ORDER BY id').all(table) as { actor: string; source: string; op: string }[]

describe('preview_proposal and propose_to_family', () => {
  it('propose_to_family sends the previewed draft: the numbers recomputed from the scenario, version 1 stored, the view with the computed risk', async () => {
    const t = setup()
    const evaluation = await computed(t.call, CREDIT)
    // a number sent alongside is ignored: the server weighs the scenario itself
    const { draftId } = await preview(t, 'Ryan', {
      scenario: CREDIT, title: '  A car\non credit ', question: 'Shall we buy\nthe family car?', verdict: verdictOf(evaluation), payment: 1,
    })
    expect(count(t.db, 'proposals')).toBe(0)
    const answer = await t.call('Ryan', 'propose_to_family', { draftId }) as { proposal: ProposalOut }
    const { proposal } = answer
    expect(proposal).toMatchObject({ status: 'open', type: 'credit', author: { member: 'Ryan' } })
    expect(proposal.current).toMatchObject({ number: 1, title: 'A car on credit', question: 'Shall we buy\nthe family car?' })
    expect(proposal.current.evaluation).toEqual(evaluation)
    expect(proposal.current.verdict).toEqual({ risk: evaluation.impact.risk, recommended: null, reason: 'The payment fits the budget and the cushion stays' })
    // the people's texts in the votes are under userComment
    expect(proposal.current.votes.map(v => [v.member, v.vote, v.settled, v.userComment])).toEqual([
      ['Ryan', 'agree', true, null], ['Annika', null, false, null], ['Mila', null, false, null],
    ])
    expect(proposal.current.votes.every(v => !('comment' in v))).toBe(true)

    const stored = t.db.sqlite.prepare('SELECT number, evaluation_json, verdict_json FROM proposal_versions').all() as { number: number; evaluation_json: string; verdict_json: string }[]
    expect(stored).toHaveLength(1)
    expect(JSON.parse(stored[0].evaluation_json)).toEqual(evaluation)

    // the tool answers without waiting for Telegram; the delivery runs right after it
    await deliveries.flush()
    expect(tg.chats.sort()).toEqual(['101', '102', '103'])
    // a draft is sent once
    await expect(t.call('Ryan', 'propose_to_family', { draftId })).rejects.toMatchObject({ status: 404, code: 'advisor.draft_not_found' })
    expect(count(t.db, 'proposals')).toBe(1)
  })

  it('preview_proposal answers the voter\'s card in the family language with the server\'s numbers, who will vote, and writes nothing', async () => {
    const t = setup()
    t.db.sqlite.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('language', 'ru-RU')").run()
    const evaluation = await computed(t.call, CREDIT)
    const journalBefore = count(t.db, 'change_log')
    const out = await preview(t, 'Ryan', { scenario: CREDIT, title: 'A car on credit', question: 'Shall we buy the car?', verdict: verdictOf(evaluation) })
    expect(out.draftId).toMatch(/^[A-Za-z0-9_-]{16,}$/)
    expect(Date.parse(out.expiresAt) - Date.now()).toBeGreaterThan(29 * 60_000)
    expect(Date.parse(out.expiresAt) - Date.now()).toBeLessThanOrEqual(30 * 60_000)
    expect(out.voters).toEqual(['Annika', 'Mila'])
    expect(out.acceptedAtOnce).toBe(false)
    const { text } = out.card
    expect(text).toContain(ru('modules.advisor.bot.card.title', { author: 'Ryan', title: 'A car on credit' }))
    expect(text).toContain('Shall we buy the car?')
    const payment = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(evaluation.impact.credit!.payment)
    expect(text).toContain(ru('modules.advisor.bot.numbers.payment', { amount: payment }))
    expect(text).toContain(ru('modules.advisor.bot.card.assessment', { risk: ru(`modules.advisor.bot.risk.${evaluation.impact.risk}`), reason: 'The payment fits the budget and the cushion stays' }))
    expect(text).toContain('Annika ⏳')

    // nothing is stored, journaled or sent
    for (const table of ['proposals', 'proposal_versions', 'proposal_votes', 'proposal_messages']) expect(count(t.db, table)).toBe(0)
    expect(count(t.db, 'change_log')).toBe(journalBefore)
    await deliveries.flush()
    expect(tg.chats).toEqual([])

    // the card the voters get is the previewed one
    await t.call('Ryan', 'propose_to_family', { draftId: out.draftId })
    await deliveries.flush()
    expect(tg.texts.filter(m => m.chat === '102').map(m => m.text)).toEqual([text])
    expect((await familyT(t.db)).lang).toBe('ru-RU')
  })

  it('the author as the only voter: no voters, accepted at once', async () => {
    const t = setup()
    t.db.sqlite.exec(`UPDATE users SET can_vote = 0 WHERE member IN ('Annika', 'Mila')`)
    const evaluation = await computed(t.call, CREDIT)
    const out = await preview(t, 'Ryan', { scenario: CREDIT, title: 'A car', question: 'Shall we?', verdict: verdictOf(evaluation) })
    expect(out).toMatchObject({ voters: [], acceptedAtOnce: true })
    const { proposal } = await t.call('Ryan', 'propose_to_family', { draftId: out.draftId }) as { proposal: ProposalOut }
    expect(proposal.status).toBe('accepted')
  })

  it('a draft whose numbers changed since the preview is advisor.draft_stale and sends nothing', async () => {
    const t = setup()
    const evaluation = await computed(t.call, CREDIT)
    const { draftId } = await preview(t, 'Ryan', { scenario: CREDIT, title: 'A car', question: 'Shall we?', verdict: verdictOf(evaluation) })
    t.db.sqlite.exec('UPDATE monthly_cashflow SET expense = expense * 2')
    await expect(t.call('Ryan', 'propose_to_family', { draftId })).rejects.toMatchObject({ status: 409, code: 'advisor.draft_stale' })
    expect(count(t.db, 'proposals')).toBe(0)
  })

  it('another member\'s, an expired, a sent or a revision\'s draft is advisor.draft_not_found; at most five drafts per user', async () => {
    const t = setup()
    const evaluation = await computed(t.call, CREDIT)
    const input = { scenario: CREDIT, title: 'A car', question: 'Shall we?', verdict: verdictOf(evaluation) }
    const { draftId } = await preview(t, 'Ryan', input)
    await expect(t.call('Annika', 'propose_to_family', { draftId })).rejects.toMatchObject({ status: 404, code: 'advisor.draft_not_found' })
    await expect(t.call('Ryan', 'propose_to_family', { draftId: 'nope' })).rejects.toMatchObject({ status: 404, code: 'advisor.draft_not_found' })
    // the same user on another database
    const other = setup()
    await expect(other.call('Ryan', 'propose_to_family', { draftId })).rejects.toMatchObject({ status: 404, code: 'advisor.draft_not_found' })
    // a draft for a new proposal is not a revision's
    await expect(t.call('Ryan', 'revise_proposal', { draftId })).rejects.toMatchObject({ status: 404, code: 'advisor.draft_not_found' })
    // the refusals above did not spend it
    const { proposal } = await t.call('Ryan', 'propose_to_family', { draftId }) as { proposal: ProposalOut }
    expect(proposal.status).toBe('open')
    // thirty minutes after its preview a draft is gone
    const old = await preview(t, 'Annika', input)
    const later = { ...(await t.ctx('Annika')), now: new Date(Date.now() + 30 * 60_000 + 1000) }
    await expect(callTool('propose_to_family', later, { draftId: old.draftId })).rejects.toMatchObject({ status: 404, code: 'advisor.draft_not_found' })

    // the sixth preview drops the oldest
    const ids: string[] = []
    for (let i = 0; i < 6; i++) ids.push((await preview(t, 'Mila', input)).draftId)
    await expect(t.call('Mila', 'propose_to_family', { draftId: ids[0] })).rejects.toMatchObject({ status: 404, code: 'advisor.draft_not_found' })
    expect(((await t.call('Mila', 'propose_to_family', { draftId: ids[5] })) as { proposal: ProposalOut }).proposal.author.member).toBe('Mila')
  })

  it('the old direct input is refused: propose_to_family and revise_proposal need a draftId from preview_proposal', async () => {
    const t = setup()
    const evaluation = await computed(t.call, CREDIT)
    const direct = { scenario: CREDIT, title: 'A car', question: 'Shall we?', verdict: verdictOf(evaluation) }
    await expect(t.call('Ryan', 'propose_to_family', direct)).rejects.toMatchObject({ status: 400, code: 'advisor.preview_required' })
    await expect(t.call('Ryan', 'revise_proposal', { id: 1, ...direct })).rejects.toMatchObject({ status: 400, code: 'advisor.preview_required' })
    await expect(t.call('Ryan', 'propose_to_family', { draftId: 5 })).rejects.toMatchObject({ status: 400, code: 'invalid_param', params: { param: 'draftId' } })
    expect(count(t.db, 'proposals')).toBe(0)
    for (const name of ['propose_to_family', 'revise_proposal']) {
      expect(ADVISOR_TOOLS.find(x => x.name === name)!.inputSchema).toEqual({
        type: 'object', properties: { draftId: expect.any(Object) }, required: ['draftId'], additionalProperties: false,
      })
    }
  })

  it('proposes a new goal: kind goal with its name and target date', async () => {
    const t = setup()
    const targetDate = isoDate(new Date(Date.now() + 3 * 365 * 86_400_000))
    const goal = { kind: 'goal', name: 'Piano', amount: 6000, currency: 'USD', targetDate }
    const evaluation = (await t.call('Ryan', 'evaluate_goal', { name: 'Piano', amount: 6000, currency: 'USD', targetDate }) as { evaluation: Evaluation }).evaluation
    const { proposal } = await send(t, 'Ryan', {
      scenario: goal, title: 'A piano', question: 'Shall we save for a piano?', verdict: verdictOf(evaluation, { reason: 'Nothing else moves' }),
    }) as { proposal: ProposalOut & { current: { scenario: unknown } } }
    expect(proposal.type).toBe('goal')
    expect(proposal.current.scenario).toEqual(goal)
    expect(proposal.current.evaluation).toEqual(evaluation)
  })

  it('a reason, title or question with a digit, a percent or a currency sign is invalid_param naming it; a lighter risk than computed is invalid_param risk with params.computed', async () => {
    const t = setup()
    const evaluation = await computed(t.call, CREDIT)
    const base = { scenario: CREDIT, title: 'A car', question: 'Shall we?' }
    // which characters count as a figure, and the reason's length, are validateCardText's and parseVerdict's
    // (tests/domain/proposals.test.ts): one bad input per field shows the tool checks that field
    await expect(preview(t, 'Ryan', { ...base, verdict: verdictOf(evaluation, { reason: 'Costs 400 a month' }) }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_param', params: { param: 'reason' } })
    await expect(preview(t, 'Ryan', { ...base, title: 'A car at 9%', verdict: verdictOf(evaluation) }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_param', params: { param: 'title' } })
    await expect(preview(t, 'Ryan', { ...base, question: 'A car for $ thirty', verdict: verdictOf(evaluation) }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_param', params: { param: 'question' } })

    const heavy = await computed(t.call, HEAVY)
    expect(heavy.impact.risk).not.toBe('ok')
    await expect(preview(t, 'Ryan', { ...base, scenario: HEAVY, verdict: verdictOf(heavy, { risk: 'ok' }) }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_param', params: { param: 'risk', computed: heavy.impact.risk } })

    // the missing texts and a bad scenario name their parameter
    await expect(preview(t, 'Ryan', { ...base, title: ' ​ ', verdict: verdictOf(evaluation) }))
      .rejects.toMatchObject({ code: 'missing_param', params: { param: 'title' } })
    await expect(preview(t, 'Ryan', { ...base, title: 'x'.repeat(81), verdict: verdictOf(evaluation) }))
      .rejects.toMatchObject({ code: 'invalid_param', params: { param: 'title' } })
    await expect(preview(t, 'Ryan', { ...base, question: undefined, verdict: verdictOf(evaluation) }))
      .rejects.toMatchObject({ code: 'missing_param', params: { param: 'question' } })
    await expect(preview(t, 'Ryan', { ...base, question: 'x'.repeat(301), verdict: verdictOf(evaluation) }))
      .rejects.toMatchObject({ code: 'invalid_param', params: { param: 'question' } })
    const noTerm: Record<string, unknown> = { ...CREDIT }
    delete noTerm.termMonths
    await expect(preview(t, 'Ryan', { ...base, scenario: noTerm, verdict: verdictOf(evaluation) }))
      .rejects.toMatchObject({ code: 'missing_param', params: { param: 'termMonths' } })
    expect(count(t.db, 'proposals')).toBe(0)
  })

  it('a recommended kind outside the alternatives is invalid_param recommended; an unknown computed risk cannot be proposed', async () => {
    const t = setup()
    const evaluation = await computed(t.call, CREDIT)
    const base = { scenario: CREDIT, title: 'A car', question: 'Shall we?' }
    // later_date is a goal's alternative, never a credit's
    await expect(preview(t, 'Ryan', { ...base, verdict: verdictOf(evaluation, { recommended: 'later_date' }) }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_param', params: { param: 'recommended' } })
    expect(evaluation.alternatives.length).toBeGreaterThan(0)
    const offered = evaluation.alternatives[0].kind
    const { proposal } = await send(t, 'Ryan', { ...base, verdict: verdictOf(evaluation, { recommended: offered }) })
    expect(proposal.current.verdict.recommended).toBe(offered)

    // no rate for yen: the server cannot weigh it, so no risk Claude names is accepted
    const yen = { kind: 'buy_now', amount: 1_000_000, currency: 'JPY' }
    expect((await computed(t.call, yen)).impact.risk).toBe('unknown')
    for (const risk of ['unknown', 'risky']) {
      await expect(preview(t, 'Ryan', { ...base, scenario: yen, verdict: { risk, recommended: null, reason: 'Not enough data' } }))
        .rejects.toMatchObject({ code: 'invalid_param', params: { param: 'risk', computed: 'unknown' } })
    }
  })

  it('a member without the vote right gets no_right_vote; in password mode the tools answer council_unavailable', async () => {
    const t = setup()
    const evaluation = await computed(t.call, CREDIT)
    const input = { scenario: CREDIT, title: 'A car', question: 'Shall we?', verdict: verdictOf(evaluation) }
    t.db.sqlite.exec(`UPDATE users SET can_vote = 0 WHERE member = 'Annika'`)
    await expect(preview(t, 'Annika', input)).rejects.toMatchObject({ status: 403, code: 'no_right_vote' })
    await expect(t.call('Annika', 'propose_to_family', { draftId: 'x' })).rejects.toMatchObject({ status: 403, code: 'no_right_vote' })

    await expect(callTool('preview_proposal', await t.ctx('Ryan', 'password'), input))
      .rejects.toMatchObject({ status: 409, code: 'advisor.council_unavailable' })
    await expect(callTool('propose_to_family', await t.ctx('Ryan', 'password'), { draftId: 'x' }))
      .rejects.toMatchObject({ status: 409, code: 'advisor.council_unavailable' })
    await expect(callTool('withdraw_proposal', await t.ctx('Ryan', 'password'), { id: 1 }))
      .rejects.toMatchObject({ status: 409, code: 'advisor.council_unavailable' })
    await expect(callTool('revise_proposal', await t.ctx('Ryan', 'password'), { draftId: 'x' }))
      .rejects.toMatchObject({ status: 409, code: 'advisor.council_unavailable' })
    // the reads answer what exists: nothing
    expect(await callTool('list_proposals', await t.ctx('Ryan', 'password'), {})).toEqual({ proposals: [] })
    // a signed-in actor without a user (the family password) has no council either
    const passwordCtx = { ...(await t.ctx('Ryan')), actor: { name: 'family', source: 'mcp' as const, rights: { edit: true, vote: true, manage: true }, userId: null } }
    expect(councilAvailable(passwordCtx)).toBe(false)
    await expect(callTool('preview_proposal', passwordCtx, input)).rejects.toMatchObject({ status: 409, code: 'advisor.council_unavailable' })
    expect(councilAvailable(await t.ctx('Ryan'))).toBe(true)
    // a member whose Telegram was unlinked during the call is no voter: refused at the preview, as propose refuses
    const mila = await t.ctx('Mila')
    t.db.sqlite.exec(`UPDATE users SET telegram_id = NULL WHERE member = 'Mila'`)
    await expect(callTool('preview_proposal', mila, input)).rejects.toMatchObject({ status: 409, code: 'advisor.not_a_voter' })
    expect(count(t.db, 'proposals')).toBe(0)
  })
})

describe('get_proposal and list_proposals', () => {
  it('get_proposal returns versions, votes and comments under question / userComment; list_proposals defaults to the open ones', async () => {
    const t = setup()
    const car = await proposeCar(t)
    await castVote(t.db, car.current.id, t.idOf('Annika'), 'against', { settle: 'now', comment: 'Let us wait for the bonus', by: 'site' }, await t.actor('Annika'), new Date())

    const { proposal } = await t.call('Mila', 'get_proposal', { id: car.id }) as { proposal: ProposalOut }
    expect(proposal.status).toBe('revising')
    expect(proposal.current.question).toBe('Shall we buy the family car?')
    expect(proposal.current.votes.find(v => v.member === 'Annika')).toMatchObject({ vote: 'against', settled: true, userComment: 'Let us wait for the bonus' })
    expect(JSON.stringify(proposal)).not.toContain('"comment"')
    await expect(t.call('Mila', 'get_proposal', { id: 999 })).rejects.toMatchObject({ status: 404, code: 'advisor.proposal_not_found' })
    await expect(t.call('Mila', 'get_proposal', {})).rejects.toMatchObject({ status: 400, code: 'missing_param', params: { param: 'id' } })
    await expect(t.call('Mila', 'get_proposal', { id: 'one' })).rejects.toMatchObject({ status: 400, code: 'invalid_param', params: { param: 'id' } })

    const second = await proposeCar(t, { title: 'A second car' })
    await t.call('Ryan', 'withdraw_proposal', { id: second.id })
    const open = await t.call('Annika', 'list_proposals', {}) as { proposals: Record<string, unknown>[] }
    expect(open.proposals).toEqual([{
      id: car.id, status: 'revising', type: 'credit', title: 'A car on credit', author: 'Ryan',
      createdAt: expect.any(String), deadlineAt: expect.any(String), version: 1, yourVote: 'against',
    }])
    const all = await t.call('Annika', 'list_proposals', { status: 'all' }) as { proposals: { id: number; status: string; yourVote: string | null }[] }
    expect(all.proposals.map(p => [p.id, p.status, p.yourVote])).toEqual([[car.id, 'revising', 'against'], [second.id, 'withdrawn', null]])
    await expect(t.call('Annika', 'list_proposals', { status: 'closed' })).rejects.toMatchObject({ code: 'invalid_param', params: { param: 'status' } })

    // a member without the vote right still reads
    t.db.sqlite.exec(`UPDATE users SET can_vote = 0 WHERE member = 'Mila'`)
    expect(((await t.call('Mila', 'get_proposal', { id: car.id })) as { proposal: ProposalOut }).proposal.id).toBe(car.id)
  })
})

describe('the reads without the council', () => {
  it('get_proposal finds nothing and list_proposals lists nothing outside Telegram sign-in, though proposals exist', async () => {
    const t = setup()
    const car = await proposeCar(t)
    await expect(callTool('get_proposal', await t.ctx('Annika', 'password'), { id: car.id })).rejects.toMatchObject({ status: 404, code: 'advisor.proposal_not_found' })
    expect(await callTool('list_proposals', await t.ctx('Annika', 'password'), { status: 'all' })).toEqual({ proposals: [] })
    const familyCtx = { ...(await t.ctx('Annika')), actor: { name: 'family', source: 'mcp' as const, rights: { edit: true, vote: true, manage: true }, userId: null } }
    await expect(callTool('get_proposal', familyCtx, { id: car.id })).rejects.toMatchObject({ status: 404, code: 'advisor.proposal_not_found' })
    expect(await callTool('list_proposals', familyCtx, {})).toEqual({ proposals: [] })
  })
})

describe('revise_proposal and withdraw_proposal', () => {
  it('revise_proposal sends a revision\'s draft, only for the author of a revising proposal, as version 2; withdraw_proposal closes it', async () => {
    const t = setup()
    const car = await proposeCar(t)
    const longer = { ...CREDIT, termMonths: 72 }
    const evaluation = await computed(t.call, longer)
    const revision = { proposalId: car.id, scenario: longer, question: 'A longer term, then?', verdict: verdictOf(evaluation, { reason: 'A lighter payment' }) }

    // still open: nothing to revise yet
    await expect(preview(t, 'Ryan', revision)).rejects.toMatchObject({ status: 409, code: 'advisor.not_revising' })
    await castVote(t.db, car.current.id, t.idOf('Annika'), 'against', { settle: 'now', comment: 'Too short a term', by: 'site' }, await t.actor('Annika'), new Date())
    await expect(preview(t, 'Annika', revision)).rejects.toMatchObject({ status: 403, code: 'advisor.not_author' })
    await expect(preview(t, 'Ryan', { ...revision, proposalId: 999 })).rejects.toMatchObject({ status: 404, code: 'advisor.proposal_not_found' })
    await expect(preview(t, 'Ryan', { ...revision, proposalId: 'one' })).rejects.toMatchObject({ status: 400, code: 'invalid_param', params: { param: 'proposalId' } })

    const draft = await preview(t, 'Ryan', revision)
    // the card shows the new version and what changed
    expect(draft.card.text).toContain('Ryan updated the proposal (version 2): A car on credit')
    expect(draft.card.text).toContain('Compared with version 1:')
    // a revision's draft is not a new proposal's
    await expect(t.call('Ryan', 'propose_to_family', { draftId: draft.draftId })).rejects.toMatchObject({ status: 404, code: 'advisor.draft_not_found' })
    const { proposal } = await t.call('Ryan', 'revise_proposal', { draftId: draft.draftId }) as { proposal: ProposalOut }
    expect(proposal.status).toBe('open')
    // a missing title keeps the current one
    expect(proposal.current).toMatchObject({ number: 2, title: 'A car on credit', question: 'A longer term, then?' })
    expect(proposal.current.evaluation).toEqual(evaluation)
    expect(proposal.previous.map(v => v.number)).toEqual([1])
    expect(proposal.previous[0].votes.find(v => v.member === 'Annika')?.userComment).toBe('Too short a term')

    // withdraw's refusals (another's, a closed or a missing proposal) are the store's (councilStore.test.ts): one passes through here
    await expect(t.call('Annika', 'withdraw_proposal', { id: car.id })).rejects.toMatchObject({ status: 403, code: 'advisor.not_author' })
    const withdrawn = await t.call('Ryan', 'withdraw_proposal', { id: car.id }) as { proposal: ProposalOut }
    expect(withdrawn.proposal.status).toBe('withdrawn')
  })

  it('a revision\'s draft is stale once the proposal moved on since the preview', async () => {
    const t = setup()
    const car = await proposeCar(t)
    await castVote(t.db, car.current.id, t.idOf('Annika'), 'against', { settle: 'now', comment: 'No', by: 'site' }, await t.actor('Annika'), new Date())
    const longer = { ...CREDIT, termMonths: 72 }
    const revision = { proposalId: car.id, scenario: longer, question: 'Longer?', verdict: verdictOf(await computed(t.call, longer), { reason: 'Lighter' }) }
    const first = await preview(t, 'Ryan', revision)
    const second = await preview(t, 'Ryan', revision)
    await t.call('Ryan', 'revise_proposal', { draftId: second.draftId })
    // version 2 went out: the first draft is no longer the next version of what the family sees
    await expect(t.call('Ryan', 'revise_proposal', { draftId: first.draftId })).rejects.toMatchObject({ status: 409, code: 'advisor.draft_stale' })
  })

  it('the author withdraws without the vote right now (the store checks the author, as in the bot)', async () => {
    const t = setup()
    const car = await proposeCar(t)
    t.db.sqlite.exec(`UPDATE users SET can_vote = 0 WHERE member = 'Ryan'`)
    const withdrawn = await t.call('Ryan', 'withdraw_proposal', { id: car.id }) as { proposal: ProposalOut }
    expect(withdrawn.proposal.status).toBe('withdrawn')
  })

  it('a proposal write is journaled with source mcp and the member as actor', async () => {
    const t = setup()
    const car = await proposeCar(t)
    await t.call('Ryan', 'withdraw_proposal', { id: car.id })
    expect(journal(t.db, 'proposals')).toEqual([{ actor: 'Ryan', source: 'mcp', op: 'insert' }, { actor: 'Ryan', source: 'mcp', op: 'update' }])
    expect(journal(t.db, 'proposal_versions')).toEqual([{ actor: 'Ryan', source: 'mcp', op: 'insert' }])
  })
})

describe('the preview: its figures, a new goal\'s card, a send after midnight, a stale draft', () => {
  it('answers the exact figures next to the card and the next step', async () => {
    const t = setup()
    const evaluation = await computed(t.call, CREDIT)
    const out = await preview(t, 'Ryan', { scenario: CREDIT, title: 'A car', question: 'Shall we?', verdict: verdictOf(evaluation) })
    expect(out.baseCurrency).toBe('USD')
    expect(out.evaluation).toEqual(evaluation)
    expect(out.nextStep).toBe('Show the user card.text, then send with propose_to_family (or revise_proposal) only after the user\'s explicit yes to this card')
    expect(out.acceptedAtOnce).toBe(out.voters.length === 0)
  })

  it('a new goal\'s card has the goal\'s own line, and the delivered card is the previewed one', async () => {
    const t = setup()
    const targetDate = isoDate(new Date(Date.now() + 3 * 365 * 86_400_000))
    const goal = { kind: 'goal', name: 'Piano', amount: 6000, currency: 'USD', targetDate }
    const evaluation = (await t.call('Ryan', 'evaluate_goal', { name: 'Piano', amount: 6000, currency: 'USD', targetDate }) as { evaluation: Evaluation }).evaluation
    const out = await preview(t, 'Ryan', { scenario: goal, title: 'A piano', question: 'Shall we save for a piano?', verdict: verdictOf(evaluation) }) as Preview
    expect(out.card.text).toMatch(/^Piano: (by |not reachable)/m)
    await t.call('Ryan', 'propose_to_family', { draftId: out.draftId })
    await deliveries.flush()
    expect(tg.texts.filter(m => m.chat === '102').map(m => m.text)).toEqual([out.card.text])
  })

  it('a new goal\'s name with a figure is invalid_param name in the preview; evaluate_goal still weighs it', async () => {
    const t = setup()
    const targetDate = isoDate(new Date(Date.now() + 3 * 365 * 86_400_000))
    const goal = { kind: 'goal', name: 'Piano 2', amount: 6000, currency: 'USD', targetDate }
    const evaluation = (await t.call('Ryan', 'evaluate_goal', { name: 'Piano 2', amount: 6000, currency: 'USD', targetDate }) as { evaluation: Evaluation }).evaluation
    await expect(preview(t, 'Ryan', { scenario: goal, title: 'A piano', question: 'Shall we?', verdict: verdictOf(evaluation) }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_param', params: { param: 'name' } })
  })

  it('a send just after midnight UTC is not stale: the numbers are weighed again as at the preview, and the deadline is the previewed one', async () => {
    const t = setup()
    const midnight = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1))
    const before = new Date(midnight.getTime() - 10 * 60_000)
    const after = new Date(midnight.getTime() + 5 * 60_000)
    const at = async (now: Date) => ({ ...(await t.ctx('Ryan')), now })
    const evaluation = (await callTool('evaluate_purchase', await at(before), CREDIT) as { evaluation: Evaluation }).evaluation
    const out = await callTool('preview_proposal', await at(before), { scenario: CREDIT, title: 'A car', question: 'Shall we?', verdict: verdictOf(evaluation) }) as Preview
    const { proposal } = await callTool('propose_to_family', await at(after), { draftId: out.draftId }) as { proposal: ProposalOut & { deadlineAt: string } }
    expect(proposal.current.evaluation).toEqual(evaluation)
    expect(proposal.deadlineAt).toBe(deadlineAfter(before, 14))
    await deliveries.flush()
    expect(tg.texts.filter(m => m.chat === '102').map(m => m.text)).toEqual([out.card.text])
  })

  it('a draft whose voters or language changed since the preview is stale: the card would not be the one shown', async () => {
    const t = setup()
    const evaluation = await computed(t.call, CREDIT)
    const input = { scenario: CREDIT, title: 'A car', question: 'Shall we?', verdict: verdictOf(evaluation) }
    const first = await preview(t, 'Ryan', input)
    const second = await preview(t, 'Ryan', input)
    t.db.sqlite.exec(`UPDATE users SET can_vote = 0 WHERE member = 'Mila'`)
    await expect(t.call('Ryan', 'propose_to_family', { draftId: first.draftId })).rejects.toMatchObject({ status: 409, code: 'advisor.draft_stale' })
    t.db.sqlite.exec(`UPDATE users SET can_vote = 1 WHERE member = 'Mila'`)
    t.db.sqlite.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('language', 'ru-RU')").run()
    await expect(t.call('Ryan', 'propose_to_family', { draftId: second.draftId })).rejects.toMatchObject({ status: 409, code: 'advisor.draft_stale' })
    expect(count(t.db, 'proposals')).toBe(0)
  })
})

describe('the registry', () => {
  it('preview, propose and revise need the vote right, withdraw only the author; the preview writes nothing, none of the three writes is read-only; the reads need nothing', () => {
    const rightOf = (name: string) => ADVISOR_TOOLS.find(t => t.name === name)!.right
    const readOnly = (name: string) => toolInfo(ADVISOR_TOOLS.find(t => t.name === name)!).readOnly
    expect(rightOf('preview_proposal')).toBe('vote')
    expect(readOnly('preview_proposal')).toBe(true)
    expect(ADVISOR_TOOLS.map(t => t.name).indexOf('preview_proposal')).toBe(ADVISOR_TOOLS.map(t => t.name).indexOf('propose_to_family') - 1)
    expect(['propose_to_family', 'revise_proposal', 'withdraw_proposal'].map(rightOf)).toEqual(['vote', 'vote', null])
    expect(['get_proposal', 'list_proposals'].map(rightOf)).toEqual([null, null])
    expect(['propose_to_family', 'revise_proposal', 'withdraw_proposal'].map(readOnly)).toEqual([false, false, false])
    expect(['get_proposal', 'list_proposals'].map(readOnly)).toEqual([true, true])
  })
})
