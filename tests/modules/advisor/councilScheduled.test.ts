import { describe, expect, it, vi } from 'vitest'
import { deliverPending } from '../../../src/modules/advisor/council/delivery'
import { readProposal } from '../../../src/modules/advisor/council/read'
import { runCouncilScheduled } from '../../../src/modules/advisor/council/scheduled'
import { castVote, propose, recheckOpen, remindDue, settleDue } from '../../../src/modules/advisor/council/store'
import { advisorServer } from '../../../src/modules/advisor/server'
import { InputError } from '../../../src/server/http'
import { type TestDb } from '../../helpers/db'
import { fakeAuthRuntime } from '../../helpers/auth'
import { COUNCIL_CHATS, councilFamily, creditEvaluation, creditInput, type CouncilMember } from '../../helpers/council'
import { fakeTelegram } from '../../helpers/telegram'

// the steps of the run, wrapped so that a test can make one of them fail; they call the real thing otherwise
vi.mock('../../../src/modules/advisor/council/store', async importOriginal => {
  const store = await importOriginal<typeof import('../../../src/modules/advisor/council/store')>()
  return { ...store, settleDue: vi.fn(store.settleDue), recheckOpen: vi.fn(store.recheckOpen), remindDue: vi.fn(store.remindDue) }
})
vi.mock('../../../src/modules/advisor/council/delivery', async importOriginal => {
  const delivery = await importOriginal<typeof import('../../../src/modules/advisor/council/delivery')>()
  return { ...delivery, deliverPending: vi.fn(delivery.deliverPending) }
})

const ENV = { TELEGRAM_BOT_TOKEN: '123:secret-token', APP_URL: 'https://fc.example' }
const DAY = 86_400_000
const HOUR = 3_600_000
const T0 = new Date('2026-11-02T09:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
// the chats of Ryan (the author), Annika and Mila
const { Annika: ANNIKA, Mila: MILA } = COUNCIL_CHATS

/** The council family (helpers/council.ts) with Ryan's credit proposal; the council's cards are not sent yet. */
async function setup() {
  const family = councilFamily()
  const { db } = family
  // the members act through the bot
  const actor = (member: CouncilMember) => family.actor(member, 'bot')
  const proposal = await propose(db, creditInput(await creditEvaluation(db)), actor('Ryan'), T0)
  return { db, ids: family.ids, actor, proposal }
}

type Row = Record<string, unknown>
const rows = (db: TestDb, sql: string, ...args: (string | number | null)[]) => db.sqlite.prepare(sql).all(...args) as Row[]
const notices = (db: TestDb, notice: string) =>
  rows(db, `SELECT user_id, state FROM proposal_messages WHERE kind = 'notice' AND notice = ? ORDER BY id`, notice)
const ZERO_DELIVERY = { sent: 0, edited: 0, failed: 0, blocked: 0, skipped: 0 }

describe('the council scheduled run', () => {
  it('settles provisional votes past their window, expires proposals past the deadline and sends the expired notices', async () => {
    const { db, ids, actor, proposal } = await setup()
    const tg = fakeTelegram()
    await castVote(db, proposal.current.id, ids.annika, 'agree', { settle: 'provisional', by: 'button' }, actor('Annika'), at(1000))
    // the window has closed and the bot's timer was lost: only the hourly run settles the vote
    const result = await runCouncilScheduled(db, ENV, at(14 * DAY + HOUR), tg.fetchImpl)
    expect(result).toMatchObject({ settled: 1, recheckOpen: 0, expired: 1, reminders: 0 })
    expect(result.delivery.failed).toBe(0)
    expect(rows(db, 'SELECT settled, settled_by FROM proposal_votes WHERE user_id = ?', ids.annika)).toEqual([{ settled: 1, settled_by: 'timeout' }])
    expect((await readProposal(db, proposal.id, actor('Ryan')))!.status).toBe('expired')
    // Ryan, the author, is told by his status message, edited to the outcome: no second message
    expect(notices(db, 'expired')).toEqual([ids.annika, ids.mila].map(user_id => ({ user_id, state: 'sent' })))
    expect(rows(db, `SELECT state, dirty FROM proposal_messages WHERE kind = 'status'`)).toEqual([{ state: 'sent', dirty: 0 }])
    expect(tg.to(MILA).length).toBeGreaterThan(0)
    // nothing more to do an hour later
    expect(await runCouncilScheduled(db, ENV, at(14 * DAY + 2 * HOUR), tg.fetchImpl))
      .toEqual({ settled: 0, recheckOpen: 0, expired: 0, reminders: 0, delivery: ZERO_DELIVERY })
  })

  // who is reminded, when, and only once is remindDue's rule (councilStore.test.ts): the run counts them and delivers them in the same tick
  it('creates the due reminders and delivers them in the same run', async () => {
    const { db, ids, actor, proposal } = await setup()
    const tg = fakeTelegram()
    await castVote(db, proposal.current.id, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika'), at(1000))
    expect(await runCouncilScheduled(db, ENV, at(11 * DAY), tg.fetchImpl)).toMatchObject({ reminders: 1 })
    expect(notices(db, 'reminder')).toEqual([{ user_id: ids.mila, state: 'sent' }])
  })

  it('retries failed deliveries an hour after the last attempt and leaves blocked ones', async () => {
    const { db } = await setup()
    const tg = fakeTelegram()
    tg.chats[MILA] = 'down'
    tg.chats[ANNIKA] = 'blocked'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await runCouncilScheduled(db, ENV, at(1000), tg.fetchImpl)).delivery).toEqual({ ...ZERO_DELIVERY, sent: 1, failed: 1, blocked: 1 })
    // half an hour later: not tried again
    expect((await runCouncilScheduled(db, ENV, at(1000 + HOUR / 2), tg.fetchImpl)).delivery).toEqual(ZERO_DELIVERY)
    expect(tg.to(MILA)).toHaveLength(1)
    // the next hourly tick, a few ms early (timer jitter): tried again, still down
    expect((await runCouncilScheduled(db, ENV, at(1000 + HOUR - 3), tg.fetchImpl)).delivery).toEqual({ ...ZERO_DELIVERY, failed: 1 })
    expect(tg.to(MILA)).toHaveLength(2)
    tg.chats[MILA] = 'ok'
    expect((await runCouncilScheduled(db, ENV, at(1000 + 2 * HOUR - 6), tg.fetchImpl)).delivery).toEqual({ ...ZERO_DELIVERY, sent: 1 })
    expect(tg.to(ANNIKA)).toHaveLength(1)
    expect(rows(db, `SELECT state FROM proposal_messages WHERE chat_id = ?`, ANNIKA)).toEqual([{ state: 'blocked' }])
  })

  it.each([
    ['settle', settleDue, { settled: 0, expired: 1 }],
    ['recheck', recheckOpen, { recheckOpen: 0, expired: 1 }],
    ['remind', remindDue, { reminders: 0, expired: 1 }],
  ] as const)('a failing %s step is logged by its code and does not stop the next ones', async (name, fn, expected) => {
    const { db, proposal, actor } = await setup()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    // a bug carries its text and a number; the log must show neither
    vi.mocked(fn as (db: unknown, now: Date) => Promise<unknown>).mockRejectedValueOnce(new Error('secret text 30000'))
    const result = await runCouncilScheduled(db, ENV, at(14 * DAY + HOUR), fakeTelegram().fetchImpl)
    expect(result).toMatchObject(expected)
    expect(result.delivery.sent).toBeGreaterThan(0)
    expect((await readProposal(db, proposal.id, actor('Ryan')))!.status).toBe('expired')
    expect(errors.mock.calls.map(c => String(c[0]))).toEqual([`[council] scheduled ${name} failed: internal`])
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/secret|30000|123:/)
  })

  it('a failing deliver step is logged and the earlier steps still count; a refusal is logged by its own code', async () => {
    const { db, proposal, actor } = await setup()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deliverPending).mockRejectedValueOnce(new Error('secret text 30000'))
    vi.mocked(remindDue).mockRejectedValueOnce(new InputError('advisor.proposal_closed', 409))
    const result = await runCouncilScheduled(db, ENV, at(14 * DAY + HOUR), fakeTelegram().fetchImpl)
    expect(result).toEqual({ settled: 0, recheckOpen: 0, expired: 1, reminders: 0, delivery: ZERO_DELIVERY })
    expect((await readProposal(db, proposal.id, actor('Ryan')))!.status).toBe('expired')
    expect(errors.mock.calls.map(c => String(c[0]))).toEqual(['[council] scheduled remind failed: advisor.proposal_closed', '[council] scheduled deliver failed: internal'])
    // the next hour delivers what the failed step left
    expect((await runCouncilScheduled(db, ENV, at(15 * DAY + 2 * HOUR), fakeTelegram().fetchImpl)).delivery.sent).toBeGreaterThan(0)
  })

  it('never throws, even when every step fails', async () => {
    const { db } = await setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.prepare = (() => { throw new Error('closed') }) as typeof db.prepare
    await expect(runCouncilScheduled(db, ENV, at(14 * DAY), fakeTelegram().fetchImpl))
      .resolves.toEqual({ settled: 0, recheckOpen: 0, expired: 0, reminders: 0, delivery: ZERO_DELIVERY })
  })

  it('accepts a proposal whose only missing voter was deleted before it expires, even in the run past the deadline', async () => {
    const { db, ids, actor, proposal } = await setup()
    const tg = fakeTelegram()
    await castVote(db, proposal.current.id, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika'), at(1000))
    db.sqlite.prepare('DELETE FROM users WHERE id = ?').run(ids.mila)
    expect((await readProposal(db, proposal.id, actor('Ryan')))!.status).toBe('open')
    const result = await runCouncilScheduled(db, ENV, at(14 * DAY + HOUR), tg.fetchImpl)
    expect(result).toMatchObject({ recheckOpen: 1, expired: 0 })
    expect((await readProposal(db, proposal.id, actor('Ryan')))!.status).toBe('accepted')
    expect(notices(db, 'expired')).toEqual([])
    expect(notices(db, 'accepted')).toEqual([{ user_id: ids.annika, state: 'sent' }])
  })

  it('is the advisor module\'s scheduled hook: past the deadline it expires the proposal; with no bot token it sends nothing', async () => {
    const { db, proposal, actor } = await setup()
    const fetchSpy = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchSpy)
    // the hook runs at the clock's now
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(14 * DAY + HOUR))
    try {
      await expect(advisorServer.scheduled!({ db, env: {}, auth: fakeAuthRuntime() })).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
    expect((await readProposal(db, proposal.id, actor('Ryan')))!.status).toBe('expired')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
