import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMMENT_WINDOW_MS, LATE_COMMENT_MS } from '../../../src/domain/proposals'
import { handleCouncilUpdate, settleDueAndDeliver } from '../../../src/modules/advisor/council/bot'
import { deliverPending, deliveries } from '../../../src/modules/advisor/council/delivery'
import { readProposal } from '../../../src/modules/advisor/council/read'
import { propose, revise } from '../../../src/modules/advisor/council/store'
import { advisorServer } from '../../../src/modules/advisor/server'
import { familyT } from '../../../src/server/bot/texts'
import type { BotUpdate } from '../../../src/server/bot/updates'
import { SCHEDULER_ACTOR } from '../../../src/server/http'
import { type TestDb } from '../../helpers/db'
import { fakeAuthRuntime } from '../../helpers/auth'
import { COUNCIL_CHATS, councilFamily, creditEvaluation, creditInput, type CouncilMember } from '../../helpers/council'
import { fakeTelegram as telegramRecorder } from '../../helpers/telegram'

const TOKEN = '123:secret-token'
const ENV = { TELEGRAM_BOT_TOKEN: TOKEN, APP_URL: 'https://fc.example' }
const T0 = new Date('2026-11-02T09:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
const MINUTE = 60_000
// Ryan (the author), Annika and Mila: each one's private chat id is their Telegram id
const person = (name: CouncilMember) => ({ id: COUNCIL_CHATS[name] as string, name })
const RYAN = person('Ryan')
const ANNIKA = person('Annika')
const MILA = person('Mila')
type Person = { id: string; name: string }

/** The shared Telegram as the global fetch (deliverSoon), with lookups by method and the callback answers. */
function fakeTelegram() {
  const { calls, fetchImpl, goDown } = telegramRecorder({ stub: true })
  const of = (method: string, chat?: string) => calls.filter(c => c.method === method && (chat === undefined || String(c.body.chat_id) === chat))
  /** the text of every callback answer, in order */
  const answers = () => of('answerCallbackQuery').map(c => c.body.text ?? null)
  return { calls, fetchImpl, of, answers, goDown }
}

/** The council family (helpers/council.ts), Ryan's credit proposal sent and its messages delivered. */
async function setup() {
  const { db, ids, actor } = councilFamily()
  const input = creditInput(await creditEvaluation(db))
  const proposal = await propose(db, input, actor('Ryan'), T0)
  const tg = fakeTelegram()
  await deliverPending(db, ENV, at(500), tg.fetchImpl)
  tg.calls.length = 0
  const { t } = await familyT(db)
  const v1 = proposal.current.id
  const handle = (update: BotUpdate, now?: Date) => handleCouncilUpdate(update, { db, env: ENV, now, fetchImpl: tg.fetchImpl })
  return { db, ids, actor, proposal, input, tg, t, v1, handle }
}

let pressCount = 0
const press = (from: Person, data: string, chatId = from.id): BotUpdate =>
  ({ kind: 'callback', id: `cb-${++pressCount}`, chatId, messageId: 500, from, data })
const text = (from: Person, body: string, { chatId = from.id, chatType = 'private' } = {}): BotUpdate =>
  ({ kind: 'message', chatId, chatType, from, text: body, date: 1 })

type VoteRow = { vote: string; settled: number; settled_by: string | null; comment: string | null; pending_until: string | null }
const voteOf = (db: TestDb, versionId: number, userId: number) => db.sqlite.prepare(
  'SELECT vote, settled, settled_by, comment, pending_until FROM proposal_votes WHERE version_id = ? AND user_id = ?').get(versionId, userId) as VoteRow | undefined
const statusOf = (db: TestDb, proposalId: number) =>
  (db.sqlite.prepare('SELECT status FROM proposals WHERE id = ?').get(proposalId) as { status: string }).status
const journalCount = (db: TestDb) => (db.sqlite.prepare('SELECT COUNT(*) AS n FROM change_log').get() as { n: number }).n
const voteCount = (db: TestDb) => (db.sqlite.prepare('SELECT COUNT(*) AS n FROM proposal_votes').get() as { n: number }).n
/** the buttons of the last edit of a person's card, as [text, callback_data] */
const lastButtons = (tg: ReturnType<typeof fakeTelegram>, chat: string) => {
  const edits = tg.of('editMessageText', chat)
  const markup = edits[edits.length - 1]?.body.reply_markup as { inline_keyboard: { text: string; callback_data?: string }[][] } | undefined
  return markup?.inline_keyboard.flat().filter(b => b.callback_data).map(b => [b.text, b.callback_data])
}

beforeEach(() => {
  // the comment timer and the clock: nothing runs by itself, and a timer left by a test is dropped with the fake clock
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: at(1000) })
})

afterEach(async () => {
  await deliveries.flush()
  vi.useRealTimers()
})

describe('the council in the bot', () => {
  it('Agree from a voter writes a provisional vote and answers the callback with the comment prompt; the card is re-rendered with No comment / Cancel vote', async () => {
    const { db, ids, tg, t, v1, handle } = await setup()
    expect(await handle(press(ANNIKA, `v:${v1}:a`), at(2000))).toBe(true)
    expect(voteOf(db, v1, ids.annika)).toMatchObject({ vote: 'agree', settled: 0, pending_until: new Date(at(2000).getTime() + COMMENT_WINDOW_MS).toISOString() })
    expect(tg.answers()).toEqual([t('modules.advisor.bot.answer.commentAsk')])
    expect(tg.of('answerCallbackQuery')[0].body.callback_query_id).toBe(`cb-${pressCount}`)
    await deliveries.flush()
    expect(lastButtons(tg, ANNIKA.id)).toEqual([['No comment', `v:${v1}:k`], ['Cancel vote', `v:${v1}:c`]])
    expect(String(tg.of('editMessageText', ANNIKA.id).at(-1)!.body.text)).toContain('You answered Agree. Add a comment for Ryan')
  })

  it('the next private text within 10 minutes becomes the comment, settles the vote and is confirmed; the proposal is accepted when it was the last vote', async () => {
    const { db, ids, proposal, tg, t, v1, handle } = await setup()
    await handle(press(MILA, `v:${v1}:a`), at(2000))
    await handle(press(MILA, `v:${v1}:k`), at(3000))
    await handle(press(ANNIKA, `v:${v1}:a`), at(4000))
    expect(statusOf(db, proposal.id)).toBe('open')

    expect(await handle(text(ANNIKA, '  Fine by me​\r\nlet us go  '), at(4000 + 9 * MINUTE))).toBe(true)
    expect(voteOf(db, v1, ids.annika)).toMatchObject({ vote: 'agree', settled: 1, settled_by: 'comment', comment: 'Fine by me\nlet us go' })
    expect(statusOf(db, proposal.id)).toBe('accepted')
    const confirm = tg.of('sendMessage', ANNIKA.id)
    expect(confirm.map(c => c.body.text)).toContain(t('modules.advisor.bot.commentSaved', { author: 'Ryan', title: 'A car on credit' }))
    expect(confirm.every(c => !('parse_mode' in c.body))).toBe(true)
    // the journal names the person and the bot
    const last = db.sqlite.prepare(`SELECT actor, source FROM change_log WHERE table_name = 'proposal_votes' ORDER BY id DESC LIMIT 1`).get()
    expect(last).toEqual({ actor: 'Annika', source: 'bot' })
  })

  it('No comment settles without a comment; Cancel vote deletes the provisional vote and the card gets its buttons back', async () => {
    const { db, ids, tg, t, v1, handle } = await setup()
    await handle(press(ANNIKA, `v:${v1}:a`), at(2000))
    expect(await handle(press(ANNIKA, `v:${v1}:k`), at(3000))).toBe(true)
    expect(voteOf(db, v1, ids.annika)).toMatchObject({ vote: 'agree', settled: 1, settled_by: 'button', comment: null })
    // a duplicate press writes nothing
    const journal = journalCount(db)
    expect(await handle(press(ANNIKA, `v:${v1}:k`), at(3500))).toBe(true)
    expect(await handle(press(ANNIKA, `v:${v1}:a`), at(3600))).toBe(true)
    expect(journalCount(db)).toBe(journal)

    await handle(press(MILA, `v:${v1}:n`), at(4000))
    expect(voteOf(db, v1, ids.mila)).toMatchObject({ vote: 'against', settled: 0 })
    expect(await handle(press(MILA, `v:${v1}:c`), at(5000))).toBe(true)
    expect(voteOf(db, v1, ids.mila)).toBeUndefined()
    expect(await handle(press(MILA, `v:${v1}:c`), at(6000))).toBe(true)
    expect(tg.answers()).toEqual([
      t('modules.advisor.bot.answer.commentAsk'), t('modules.advisor.bot.answer.recorded'),
      t('modules.advisor.bot.answer.unchanged'), t('modules.advisor.bot.answer.unchanged'),
      t('modules.advisor.bot.answer.commentAsk'), t('modules.advisor.bot.answer.cancelled'), t('modules.advisor.bot.answer.nothingToCancel'),
    ])
    await deliveries.flush()
    expect(lastButtons(tg, MILA.id)).toEqual([['Agree', `v:${v1}:a`], ['Against', `v:${v1}:n`]])
  })

  it('pressing the same provisional vote again writes nothing, and one settle timer serves every press', async () => {
    const { db, ids, tg, t, v1, handle } = await setup()
    await handle(press(ANNIKA, `v:${v1}:a`), at(2000))
    const journal = journalCount(db)
    const before = voteOf(db, v1, ids.annika)
    for (const ms of [2100, 2200, 2300]) await handle(press(ANNIKA, `v:${v1}:a`), at(ms))
    expect(journalCount(db)).toBe(journal)
    expect(voteOf(db, v1, ids.annika)).toEqual(before)
    expect(tg.answers().slice(1)).toEqual(Array(3).fill(t('modules.advisor.bot.answer.unchanged')))
    await handle(press(MILA, `v:${v1}:n`), at(2400))
    expect(vi.getTimerCount()).toBe(1)
  })

  it('a text after 10 minutes finds the vote settled by timeout and tells the person to add the comment on the site', async () => {
    const { db, ids, proposal, tg, t, v1, handle } = await setup()
    await handle(press(ANNIKA, `v:${v1}:a`), at(2000))
    const late = at(2000 + COMMENT_WINDOW_MS + 5000)
    expect(await handle(text(ANNIKA, 'Sorry, here is my comment'), late)).toBe(true)
    // settled lazily by this very update, before the text was read: without a comment
    expect(voteOf(db, v1, ids.annika)).toMatchObject({ vote: 'agree', settled: 1, settled_by: 'timeout', comment: null })
    const lateText = t('modules.advisor.bot.lateComment', { url: `https://fc.example/advisor#proposal-${proposal.id}`, minutes: 10 })
    expect(lateText).toContain('10 minutes')
    expect(tg.of('sendMessage', ANNIKA.id).map(c => c.body.text)).toEqual([lateText])

    // told once per vote: another text in that hour is taken quietly
    await deliveries.flush()
    tg.calls.length = 0
    expect(await handle(text(ANNIKA, 'Did you get it?'), at(2000 + COMMENT_WINDOW_MS + 30 * MINUTE))).toBe(true)
    expect(tg.calls).toEqual([])

    // an hour after the window closed it is just a message, not this module's
    await deliveries.flush()
    tg.calls.length = 0
    expect(await handle(text(ANNIKA, 'And another'), at(2000 + COMMENT_WINDOW_MS + LATE_COMMENT_MS + 1000))).toBe(false)
    expect(tg.calls).toEqual([])
  })

  it('a late text says what can still be done: back with the author while revising, replaced after a new version, closed when decided', async () => {
    const { db, actor, proposal, input, tg, t, v1, handle } = await setup()
    await handle(press(ANNIKA, `v:${v1}:a`), at(2000))
    await handle(press(MILA, `v:${v1}:n`), at(3000))
    // both windows have closed: Annika's agree and then Mila's against are settled, and the proposal goes back to Ryan
    const late = 3000 + COMMENT_WINDOW_MS + 5000
    expect(await handle(text(ANNIKA, 'my comment'), at(late))).toBe(true)
    expect(statusOf(db, proposal.id)).toBe('revising')
    expect(tg.of('sendMessage', ANNIKA.id).map(c => c.body.text)).toEqual([t('modules.advisor.bot.lateCommentRevising', { author: 'Ryan', minutes: 10 })])

    await revise(db, proposal.id, input, actor('Ryan'), at(late + 1000))
    expect(await handle(text(MILA, 'why I am against'), at(late + 2000))).toBe(true)
    const replaced = t('modules.advisor.bot.lateCommentClosed', { minutes: 10, status: t('modules.advisor.bot.lateStatus.replaced', { number: 2 }) })
    expect(replaced).toContain('replaced by version 2')
    expect(tg.of('sendMessage', MILA.id).map(c => c.body.text)).toEqual([replaced])
  })

  it('a late text after the proposal was decided says so', async () => {
    const { db, proposal, tg, t, v1, handle } = await setup()
    await handle(press(ANNIKA, `v:${v1}:a`), at(2000))
    await handle(press(RYAN, `w:${proposal.id}`), at(2000 + COMMENT_WINDOW_MS + 1000))
    expect(statusOf(db, proposal.id)).toBe('withdrawn')
    expect(await handle(text(ANNIKA, 'my comment'), at(2000 + COMMENT_WINDOW_MS + 2000))).toBe(true)
    expect(tg.of('sendMessage', ANNIKA.id).map(c => c.body.text)).toEqual([
      t('modules.advisor.bot.lateCommentClosed', { minutes: 10, status: t('modules.advisor.bot.lateStatus.withdrawn') })])
  })

  it('a comment that loses the race with the timer is answered as a late one', async () => {
    const { db, ids, proposal, tg, t, v1, handle } = await setup()
    await handle(press(ANNIKA, `v:${v1}:a`), at(2000))
    // the timer settles the vote right after the bot found it waiting, before the comment is written
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation(query => {
      const statement = prepare(query)
      if (!/pv\.settled = 0 AND pv\.pending_until > \?/.test(query)) return statement
      const bind = statement.bind.bind(statement)
      statement.bind = (...values: unknown[]) => {
        const bound = bind(...values)
        const first = bound.first.bind(bound)
        bound.first = async <T,>() => {
          const found = await first<T>()
          db.sqlite.prepare(`UPDATE proposal_votes SET settled = 1, settled_by = 'timeout', settled_at = ? WHERE user_id = ?`).run(at(3000).toISOString(), ids.annika)
          return found
        }
        return bound
      }
      return statement
    })
    expect(await handle(text(ANNIKA, 'just in time?'), at(2000 + COMMENT_WINDOW_MS - 1000))).toBe(true)
    expect(db.prepare).toHaveBeenCalledWith(expect.stringMatching(/pv\.settled = 0 AND pv\.pending_until > \?/))
    expect(voteOf(db, v1, ids.annika)).toMatchObject({ settled: 1, settled_by: 'timeout', comment: null })
    expect(tg.of('sendMessage', ANNIKA.id).map(c => c.body.text)).toEqual([
      t('modules.advisor.bot.lateComment', { url: `https://fc.example/advisor#proposal-${proposal.id}`, minutes: 10 })])
  })

  it('what the lazy settling changed is delivered even when the press itself then fails', async () => {
    const { db, ids, tg, t, v1, handle } = await setup()
    await handle(press(MILA, `v:${v1}:a`), at(2000))
    await deliveries.flush()
    tg.calls.length = 0
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const batch = db.batch.bind(db)
    let batches = 0
    // the first batch is settleDue's, the second the press's own
    vi.spyOn(db, 'batch').mockImplementation(async statements => {
      if (++batches === 2) throw new Error('disk I/O error')
      return batch(statements)
    })
    expect(await handle(press(ANNIKA, `v:${v1}:a`), at(2000 + COMMENT_WINDOW_MS + 1000))).toBe(true)
    expect(voteOf(db, v1, ids.mila)).toMatchObject({ settled: 1, settled_by: 'timeout' })
    expect(tg.answers()).toEqual([t('modules.advisor.bot.answer.failed')])
    await deliveries.flush()
    expect(String(tg.of('editMessageText', ANNIKA.id).at(-1)?.body.text)).toContain('Mila ✓')
  })

  it('a text in a group chat, a text from an unknown account and a text with no pending vote are left to the next handler', async () => {
    const { db, ids, tg, v1, handle } = await setup()
    await handle(press(ANNIKA, `v:${v1}:a`), at(2000))
    await deliveries.flush()
    tg.calls.length = 0
    const now = at(3000)
    expect(await handle(text(ANNIKA, 'in the group', { chatId: '-900', chatType: 'group' }), now)).toBe(false)
    expect(await handle(text(ANNIKA, 'in someone else’s chat', { chatId: MILA.id }), now)).toBe(false)
    expect(await handle(text({ id: '999', name: 'Stranger' }, 'hello'), now)).toBe(false)
    expect(await handle(text(MILA, 'no vote of mine is waiting'), now)).toBe(false)
    // a bot command is not a comment: another handler (the reminders' /start) may be waiting for it
    expect(await handle(text(ANNIKA, '/start abc123'), now)).toBe(false)
    expect(voteOf(db, v1, ids.annika)).toMatchObject({ settled: 0, comment: null })
    expect(tg.calls).toEqual([])
    // the comment still lands
    expect(await handle(text(ANNIKA, 'the real one'), now)).toBe(true)
    expect(voteOf(db, v1, ids.annika)).toMatchObject({ settled: 1, comment: 'the real one' })
  })

  it('a press on a replaced version answers "replaced by version 2" and writes nothing', async () => {
    const { db, ids, actor, proposal, input, tg, t, v1, handle } = await setup()
    await handle(press(ANNIKA, `v:${v1}:n`), at(2000))
    await handle(press(ANNIKA, `v:${v1}:k`), at(3000))
    await revise(db, proposal.id, input, actor('Ryan'), at(4000))
    await deliveries.flush()
    tg.calls.length = 0
    const journal = journalCount(db)
    const votes = voteCount(db)
    for (const action of ['a', 'n', 'k', 'c']) expect(await handle(press(MILA, `v:${v1}:${action}`), at(5000))).toBe(true)
    expect(tg.answers()).toEqual(Array(4).fill(t('modules.advisor.bot.answer.replaced', { number: 2 })))
    expect(t('modules.advisor.bot.answer.replaced', { number: 2 })).toBe('Replaced by version 2')
    expect(journalCount(db)).toBe(journal)
    expect(voteCount(db)).toBe(votes)
    expect(voteOf(db, v1, ids.mila)).toBeUndefined()
  })

  it('Against settles into revising; the author gets the against notice; the other voter cannot vote any more (answer closed.revising)', async () => {
    const { db, proposal, tg, t, v1, handle } = await setup()
    await handle(press(ANNIKA, `v:${v1}:n`), at(2000))
    expect(statusOf(db, proposal.id)).toBe('open')
    await handle(text(ANNIKA, 'Let us wait for the bonus'), at(3000))
    expect(statusOf(db, proposal.id)).toBe('revising')
    await deliveries.flush()
    const toRyan = tg.of('sendMessage', RYAN.id).map(c => String(c.body.text))
    expect(toRyan.some(m => m.includes('Annika is against: “Let us wait for the bonus”'))).toBe(true)

    await deliveries.flush()
    tg.calls.length = 0
    const journal = journalCount(db)
    expect(await handle(press(MILA, `v:${v1}:a`), at(4000))).toBe(true)
    expect(await handle(press(ANNIKA, `v:${v1}:a`), at(4000))).toBe(true)
    expect(tg.answers()).toEqual([t('modules.advisor.bot.answer.closed.revising'), t('modules.advisor.bot.answer.unchanged')])
    expect(journalCount(db)).toBe(journal)
  })

  it('Agree or Against on a card whose version is gone answers gone; after the deadline it answers closed.expired', async () => {
    const { tg, t, v1, handle } = await setup()
    expect(await handle(press(ANNIKA, `v:${v1 + 50}:a`), at(2000))).toBe(true)
    expect(await handle(press(ANNIKA, `v:${v1 + 50}:n`), at(2000))).toBe(true)
    expect(await handle(press(MILA, `v:${v1}:a`), at(15 * 86_400_000))).toBe(true)
    expect(tg.answers()).toEqual([
      t('modules.advisor.bot.answer.gone'), t('modules.advisor.bot.answer.gone'), t('modules.advisor.bot.answer.closed.expired'),
    ])
  })

  it('Withdraw by the author closes the proposal; by another it answers notAuthor', async () => {
    const { db, proposal, tg, t, handle } = await setup()
    expect(await handle(press(ANNIKA, `w:${proposal.id}`), at(2000))).toBe(true)
    expect(statusOf(db, proposal.id)).toBe('open')
    expect(await handle(press(RYAN, `w:${proposal.id}`), at(3000))).toBe(true)
    expect(statusOf(db, proposal.id)).toBe('withdrawn')
    expect(await handle(press(RYAN, `w:${proposal.id}`), at(4000))).toBe(true)
    expect(await handle(press(RYAN, `w:${proposal.id + 50}`), at(4000))).toBe(true)
    expect(tg.answers()).toEqual([
      t('modules.advisor.bot.answer.notAuthor'), t('modules.advisor.bot.answer.withdrawn'),
      t('modules.advisor.bot.answer.closed.withdrawn'), t('modules.advisor.bot.answer.gone'),
    ])
    await deliveries.flush()
    // the voters are told
    expect(tg.of('sendMessage', ANNIKA.id).length).toBeGreaterThan(0)
    expect(tg.of('sendMessage', MILA.id).length).toBeGreaterThan(0)
  })

  it('votes, their comments and Withdraw work with bot commands off; only an unrelated text goes on', async () => {
    const { db, ids, proposal, tg, t, v1, handle } = await setup()
    db.sqlite.exec('UPDATE users SET telegram_conversation = 0')
    expect(await handle(press(ANNIKA, `v:${v1}:a`), at(2000))).toBe(true)
    expect(await handle(text(ANNIKA, 'Fine by me'), at(3000))).toBe(true)
    expect(voteOf(db, v1, ids.annika)).toMatchObject({ vote: 'agree', settled: 1, settled_by: 'comment', comment: 'Fine by me' })
    expect(await handle(text(MILA, 'hello'), at(3000))).toBe(false)
    expect(await handle(press(RYAN, `w:${proposal.id}`), at(4000))).toBe(true)
    expect(statusOf(db, proposal.id)).toBe('withdrawn')
    expect(tg.answers()).toEqual([t('modules.advisor.bot.answer.commentAsk'), t('modules.advisor.bot.answer.withdrawn')])
  })

  it('the timer settles a provisional vote after 10 minutes and delivers the edits', async () => {
    const { db, ids, tg, v1, handle } = await setup()
    // no `now`: the clock of the moment, as in the bot
    await handle(press(ANNIKA, `v:${v1}:a`))
    await deliveries.flush()
    expect(lastButtons(tg, ANNIKA.id)).toEqual([['No comment', `v:${v1}:k`], ['Cancel vote', `v:${v1}:c`]])

    await vi.advanceTimersByTimeAsync(COMMENT_WINDOW_MS)
    expect(voteOf(db, v1, ids.annika)).toMatchObject({ settled: 0 })
    await vi.advanceTimersByTimeAsync(1000)
    // the timer's run is in the background: wait for its edit
    await vi.waitFor(() => expect(lastButtons(tg, ANNIKA.id)).toEqual([['Change vote to Against', `v:${v1}:n`]]))
    await deliveries.flush()
    expect(voteOf(db, v1, ids.annika)).toMatchObject({ vote: 'agree', settled: 1, settled_by: 'timeout', comment: null })
    // the other cards show the new votes line
    expect(String(tg.of('editMessageText', MILA.id).at(-1)!.body.text)).toContain('Annika ✓')
  })

  it('every callback is answered even when the store fails', async () => {
    const { db, proposal, tg, t, v1, handle } = await setup()
    const errors = vi.spyOn(console, 'log').mockImplementation(() => {})
    db.sqlite.exec('DROP TABLE proposal_votes')
    expect(await handle(press(ANNIKA, `v:${v1}:a`), at(2000))).toBe(true)
    expect(await handle(press(ANNIKA, `v:${v1}:c`), at(2000))).toBe(true)
    expect(await handle(press(RYAN, `w:${proposal.id}`), at(2000))).toBe(true)
    expect(tg.answers()).toEqual(Array(3).fill(t('modules.advisor.bot.answer.failed')))
    // the log names the press and a code, never a text or the token
    expect(errors).toHaveBeenCalled()
    for (const [line] of errors.mock.calls) {
      expect(JSON.parse(String(line))).toMatchObject({ event_name: 'monido.council.bot_failed', attributes: { 'monido.operation': expect.any(String), 'error.type': 'internal' } })
      expect(String(line)).not.toContain(TOKEN)
    }
    // the timer's run never throws either
    errors.mockClear()
    await expect(settleDueAndDeliver(db, ENV)).resolves.toBeUndefined()
    expect(errors.mock.calls.map(([line]) => JSON.parse(String(line)))).toMatchObject([{ event_name: 'monido.council.bot_failed', attributes: { 'monido.operation': 'timer', 'error.type': 'internal' } }])

    // a press in someone else's chat is answered and writes nothing; a sign-in press is not this module's
    const fresh = await setup()
    expect(await fresh.handle(press(ANNIKA, `v:${fresh.v1}:a`, '-900'), at(2000))).toBe(true)
    expect(voteOf(fresh.db, fresh.v1, fresh.ids.annika)).toBeUndefined()
    expect(await fresh.handle(press({ id: '999', name: 'Stranger' }, `v:${fresh.v1}:a`), at(2000))).toBe(true)
    expect(fresh.tg.answers()).toEqual([null, fresh.t('modules.advisor.bot.answer.notVoter')])
    expect(await fresh.handle(press(ANNIKA, 'login:abc'), at(2000))).toBe(false)

    // Telegram itself failing to take the answer does not throw out of the handler
    fresh.tg.goDown()
    await expect(fresh.handle(press(ANNIKA, `v:${fresh.v1}:a`), at(3000))).resolves.toBe(true)
  })

  it('the module hands the bot updates to the council', async () => {
    const { db, ids, proposal, v1, tg } = await setup()
    expect(await advisorServer.onBotUpdate!(press(ANNIKA, `v:${v1}:a`), { db, env: ENV, auth: fakeAuthRuntime() })).toBe(true)
    expect(voteOf(db, v1, ids.annika)).toMatchObject({ vote: 'agree', settled: 0 })
    expect(tg.answers()).toHaveLength(1)
    expect((await readProposal(db, proposal.id, SCHEDULER_ACTOR))?.current.votes.find(v => v.userId === ids.annika)).toMatchObject({ vote: 'agree', settled: false })
  })
})
