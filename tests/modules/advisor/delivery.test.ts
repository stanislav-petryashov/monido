import { describe, expect, it, vi } from 'vitest'
import { renderHash, renderMessage, type MessageRow } from '../../../src/modules/advisor/council/cards'
import { deliverPending, deliverSoon, deliveries } from '../../../src/modules/advisor/council/delivery'
import { readProposal } from '../../../src/modules/advisor/council/read'
import { castVote, propose, revise, withdraw } from '../../../src/modules/advisor/council/store'
import { familyT } from '../../../src/server/bot/texts'
import { SCHEDULER_ACTOR } from '../../../src/server/http'
import { type TestDb } from '../../helpers/db'
import { COUNCIL_CHATS, councilFamily, creditEvaluation, creditInput } from '../../helpers/council'
import { fakeTelegram } from '../../helpers/telegram'

const TOKEN = '123:secret-token'
const ENV = { TELEGRAM_BOT_TOKEN: TOKEN, APP_URL: 'https://fc.example' }
const T0 = new Date('2026-11-02T09:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
const HOUR = 3_600_000
// the chats of Ryan (the author), Annika and Mila
const { Ryan: RYAN, Annika: ANNIKA, Mila: MILA } = COUNCIL_CHATS

/** The council family (helpers/council.ts) and Ryan's credit proposal sent: two cards and a status row. */
async function setup() {
  const { db, ids, actor } = councilFamily()
  const input = creditInput(await creditEvaluation(db))
  const proposal = await propose(db, input, actor('Ryan'), T0)
  return { db, ids, actor, proposal, input }
}

type Row = Record<string, unknown>
const rows = (db: TestDb) => db.sqlite.prepare(
  'SELECT id, chat_id, kind, notice, message_id, state, dirty, attempts, last_error, sent_hash FROM proposal_messages ORDER BY id').all() as Row[]
const rowOf = (db: TestDb, chat: string, kind = 'card') => rows(db).find(r => r.chat_id === chat && r.kind === kind)!
const ZERO = { sent: 0, edited: 0, failed: 0, blocked: 0, skipped: 0 }

describe('delivery rows', () => {
  it('sends every pending row once, stores message_id and the hash; a second run with nothing changed sends nothing', async () => {
    const { db, proposal } = await setup()
    const tg = fakeTelegram()
    expect(await deliverPending(db, ENV, at(1000), tg.fetchImpl)).toEqual({ ...ZERO, sent: 3 })
    expect(tg.calls.map(c => [c.method, c.body.chat_id]).sort()).toEqual([['sendMessage', RYAN], ['sendMessage', ANNIKA], ['sendMessage', MILA]])
    // plain text: no parse_mode
    expect(tg.calls.every(c => !('parse_mode' in c.body))).toBe(true)

    const view = (await readProposal(db, proposal.id, SCHEDULER_ACTOR))!
    const ctx = { ...(await familyT(db)), appUrl: ENV.APP_URL, now: at(1000) }
    for (const row of rows(db)) {
      expect(row).toMatchObject({ state: 'sent', dirty: 0, attempts: 0, last_error: null })
      expect(row.message_id).toBeGreaterThanOrEqual(500)
      const message: MessageRow = { kind: row.kind as MessageRow['kind'], notice: String(row.notice), version_id: proposal.current.id, user_id: 0 }
      const user = db.sqlite.prepare('SELECT user_id FROM proposal_messages WHERE id = ?').get(row.id as number) as { user_id: number }
      const { text, buttons } = renderMessage({ ...message, user_id: user.user_id }, view, ctx)!
      expect(row.sent_hash).toBe(renderHash(text, buttons))
      expect(tg.calls.find(c => c.body.chat_id === row.chat_id)?.body.text).toBe(text)
    }

    expect(await deliverPending(db, ENV, at(2000), tg.fetchImpl)).toEqual(ZERO)
    expect(tg.calls).toHaveLength(3)
  })

  it('a dirty sent row is edited; an unchanged render is skipped', async () => {
    const { db, ids, actor, proposal } = await setup()
    const tg = fakeTelegram()
    await deliverPending(db, ENV, at(1000), tg.fetchImpl)
    const sent = rows(db)

    // Mila agrees on the site: every card and the status show the new votes line
    await castVote(db, proposal.current.id, ids.mila, 'agree', { settle: 'now', by: 'site' }, actor('Mila'), at(2000))
    expect(await deliverPending(db, ENV, at(3000), tg.fetchImpl)).toEqual({ ...ZERO, edited: 3 })
    const edits = tg.calls.slice(3)
    expect(edits.every(c => c.method === 'editMessageText')).toBe(true)
    expect(edits.find(c => c.body.chat_id === MILA)?.body).toMatchObject({ message_id: rowOf(db, MILA).message_id, reply_markup: { inline_keyboard: [
      [{ text: 'Change vote to Against', callback_data: `v:${proposal.current.id}:n` }],
      [{ text: 'Details on the site', url: `https://fc.example/advisor#proposal-${proposal.id}` }],
    ] } })
    expect(String(edits.find(c => c.body.chat_id === ANNIKA)?.body.text)).toContain('Mila ✓')
    for (const row of rows(db)) expect(row.sent_hash).not.toBe(sent.find(s => s.id === row.id)!.sent_hash)

    // marked dirty with nothing changed: nothing goes to Telegram
    db.sqlite.exec('UPDATE proposal_messages SET dirty = 1')
    expect(await deliverPending(db, ENV, at(4000), tg.fetchImpl)).toEqual({ ...ZERO, skipped: 3 })
    expect(tg.calls).toHaveLength(6)
    expect(rows(db).every(r => r.dirty === 0)).toBe(true)
  })

  it('a failure for one voter leaves the others sent and the row failed with attempts 1; the hourly run retries it', async () => {
    const { db, ids, actor, proposal } = await setup()
    const tg = fakeTelegram()
    tg.chats[MILA] = 'down'
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await deliverPending(db, ENV, at(1000), tg.fetchImpl)).toEqual({ ...ZERO, sent: 2, failed: 1 })
    expect(rowOf(db, MILA)).toMatchObject({ state: 'failed', attempts: 1, last_error: 'telegram.external', message_id: null })
    expect(rowOf(db, ANNIKA)).toMatchObject({ state: 'sent' })
    expect(rowOf(db, RYAN, 'status')).toMatchObject({ state: 'sent' })
    const row = rowOf(db, MILA).id as number
    expect(errors.mock.calls.map(c => String(c[0]))).toEqual([`[council] delivery ${row} failed: telegram.external (502)`])
    // the log names no text, no number of the proposal and never the token
    expect(JSON.stringify(errors.mock.calls)).not.toContain(TOKEN)

    // the others still vote: Annika's agree counts, and the run after it leaves the failed row for the hourly retry
    expect(await castVote(db, proposal.current.id, ids.annika, 'agree', { settle: 'now', by: 'site' }, actor('Annika'), at(2000))).toEqual({ outcome: 'recorded' })
    expect(await deliverPending(db, ENV, at(3000), tg.fetchImpl)).toEqual({ ...ZERO, edited: 2 })
    expect(tg.to(MILA)).toHaveLength(1)
    // an hour after the failure, still down: tried again, the same error is not logged again
    expect(await deliverPending(db, ENV, at(1000 + HOUR), tg.fetchImpl)).toEqual({ ...ZERO, failed: 1 })
    expect(rowOf(db, MILA)).toMatchObject({ state: 'failed', attempts: 1 })
    expect(errors).toHaveBeenCalledTimes(1)

    tg.chats[MILA] = 'ok'
    expect(await deliverPending(db, ENV, at(1000 + 2 * HOUR), tg.fetchImpl)).toEqual({ ...ZERO, sent: 1 })
    expect(rowOf(db, MILA)).toMatchObject({ state: 'sent', attempts: 0, last_error: null, dirty: 0 })
    expect(String(tg.to(MILA).at(-1)?.body.text)).toContain('Annika ✓')
  })

  it('a 403 marks the row blocked and never retries it', async () => {
    const { db, ids, actor, proposal } = await setup()
    const tg = fakeTelegram()
    tg.chats[MILA] = 'blocked'
    tg.chats[ANNIKA] = 'gone'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await deliverPending(db, ENV, at(1000), tg.fetchImpl)).toEqual({ ...ZERO, sent: 1, blocked: 2 })
    expect(rowOf(db, MILA)).toMatchObject({ state: 'blocked', dirty: 0, last_error: 'telegram.external', attempts: 0 })
    expect(rowOf(db, ANNIKA)).toMatchObject({ state: 'blocked' })

    // a later vote marks the cards dirty again: the blocked ones are left alone, Mila still votes on the site
    tg.chats[MILA] = 'ok'
    expect(await castVote(db, proposal.current.id, ids.mila, 'agree', { settle: 'now', by: 'site' }, actor('Mila'), at(2000))).toEqual({ outcome: 'recorded' })
    expect(await deliverPending(db, ENV, at(3000), tg.fetchImpl)).toEqual({ ...ZERO, edited: 1 })
    expect(tg.to(MILA)).toHaveLength(1)
    expect(tg.to(ANNIKA)).toHaveLength(1)
  })

  it('after 24 attempts a failed row is left alone, until a change of the proposal revives it', async () => {
    const { db, ids, actor, proposal } = await setup()
    const tg = fakeTelegram()
    tg.chats[MILA] = 'down'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await deliverPending(db, ENV, at(1000), tg.fetchImpl)
    db.sqlite.prepare('UPDATE proposal_messages SET attempts = 23 WHERE chat_id = ?').run(MILA)
    expect(await deliverPending(db, ENV, at(1000 + HOUR), tg.fetchImpl)).toEqual({ ...ZERO, failed: 1 })
    expect(rowOf(db, MILA)).toMatchObject({ state: 'failed', attempts: 24 })
    tg.chats[MILA] = 'ok'
    expect(await deliverPending(db, ENV, at(1000 + 3 * HOUR), tg.fetchImpl)).toEqual(ZERO)
    expect(tg.to(MILA)).toHaveLength(2)

    await castVote(db, proposal.current.id, ids.annika, 'agree', { settle: 'now', by: 'site' }, actor('Annika'), at(4 * HOUR))
    expect(rowOf(db, MILA)).toMatchObject({ state: 'failed', attempts: 0 })
    expect(await deliverPending(db, ENV, at(6 * HOUR), tg.fetchImpl)).toMatchObject({ sent: 1 })
    expect(rowOf(db, MILA)).toMatchObject({ state: 'sent' })
  })

  it.each([
    ['no answer', 'timeout', 'telegram.unavailable'],
    ['a 5xx answer', 'down', 'telegram.external'],
  ] as const)('a send that may have gone through (%s) is tried at most twice more', async (_, behaviour, code) => {
    const { db } = await setup()
    const tg = fakeTelegram()
    tg.chats[MILA] = behaviour
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const hour of [0, 1, 2]) {
      expect(await deliverPending(db, ENV, at(1000 + hour * HOUR), tg.fetchImpl)).toMatchObject({ failed: 1 })
    }
    expect(rowOf(db, MILA)).toMatchObject({ state: 'failed', last_error: code, attempts: 24 })
    expect(await deliverPending(db, ENV, at(1000 + 5 * HOUR), tg.fetchImpl)).toEqual(ZERO)
    expect(tg.to(MILA)).toHaveLength(3)
  })

  it('a recipient no longer linked to that chat is never sent to', async () => {
    const { db } = await setup()
    const tg = fakeTelegram()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.sqlite.exec(`DELETE FROM users WHERE member = 'Mila'`)
    db.sqlite.exec(`UPDATE users SET telegram_id = '999' WHERE member = 'Annika'`)
    expect(await deliverPending(db, ENV, at(1000), tg.fetchImpl)).toEqual({ ...ZERO, sent: 1, blocked: 2 })
    expect(tg.calls.map(c => c.body.chat_id)).toEqual([RYAN])
    expect(rowOf(db, MILA)).toMatchObject({ state: 'blocked', last_error: 'unlinked', dirty: 0, message_id: null })
    expect(rowOf(db, ANNIKA)).toMatchObject({ state: 'blocked', last_error: 'unlinked' })
  })

  it('a message the person deleted is sent again once; a second time the row is blocked', async () => {
    const { db, ids, actor, proposal } = await setup()
    const tg = fakeTelegram()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await deliverPending(db, ENV, at(1000), tg.fetchImpl)
    const first = rowOf(db, ANNIKA).message_id
    tg.chats[ANNIKA] = 'messageGone'

    await castVote(db, proposal.current.id, ids.mila, 'agree', { settle: 'now', by: 'site' }, actor('Mila'), at(2000))
    expect(await deliverPending(db, ENV, at(3000), tg.fetchImpl)).toEqual({ ...ZERO, sent: 1, edited: 2 })
    expect(tg.to(ANNIKA).map(c => c.method)).toEqual(['sendMessage', 'editMessageText', 'sendMessage'])
    expect(rowOf(db, ANNIKA)).toMatchObject({ state: 'sent', last_error: 'resent', dirty: 0 })
    expect(rowOf(db, ANNIKA).message_id).not.toBe(first)

    // the edits of the new message fail for a while: the row shows the latest code, logged once, and stays resent
    const errors = vi.mocked(console.error)
    errors.mockClear()
    tg.chats[ANNIKA] = 'down'
    await castVote(db, proposal.current.id, ids.mila, 'against', { settle: 'now', by: 'site' }, actor('Mila'), at(4000))
    expect(await deliverPending(db, ENV, at(5000), tg.fetchImpl)).toEqual({ ...ZERO, sent: 1, edited: 2, failed: 1 })
    expect(rowOf(db, ANNIKA)).toMatchObject({ state: 'failed', last_error: 'resent:telegram.external' })
    expect(await deliverPending(db, ENV, at(5000 + HOUR), tg.fetchImpl)).toEqual({ ...ZERO, failed: 1 })
    const row = rowOf(db, ANNIKA).id as number
    expect(errors.mock.calls.map(c => String(c[0])).filter(l => l.includes(`delivery ${row} `))).toEqual([`[council] delivery ${row} failed: telegram.external (502)`])

    // the message is gone a second time: the row stops
    tg.chats[ANNIKA] = 'messageGone'
    expect(await deliverPending(db, ENV, at(5000 + 2 * HOUR), tg.fetchImpl)).toEqual({ ...ZERO, blocked: 1 })
    expect(rowOf(db, ANNIKA)).toMatchObject({ state: 'blocked', last_error: 'message_gone' })
    expect(tg.to(ANNIKA).filter(c => c.method === 'sendMessage')).toHaveLength(2)
  })

  it('the author keeps one status message across versions: it is edited, the new version gets new cards', async () => {
    const { db, ids, actor, proposal, input } = await setup()
    const tg = fakeTelegram()
    await deliverPending(db, ENV, at(1000), tg.fetchImpl)
    await castVote(db, proposal.current.id, ids.mila, 'against', { settle: 'now', by: 'site' }, actor('Mila'), at(2000))
    expect(await deliverPending(db, ENV, at(3000), tg.fetchImpl)).toEqual({ ...ZERO, sent: 1, edited: 3 })
    await revise(db, proposal.id, { ...input, title: 'A car, longer term' }, actor('Ryan'), at(4000))
    expect(await deliverPending(db, ENV, at(5000), tg.fetchImpl)).toEqual({ ...ZERO, sent: 2, edited: 3 })
    // the status and the against notice, nothing more: version 2's status is the same message, edited
    expect(tg.to(RYAN).filter(c => c.method === 'sendMessage')).toHaveLength(2)
    const status = tg.to(RYAN).filter(c => c.method === 'editMessageText').at(-1)!
    expect(status.body.message_id).toBe(rowOf(db, RYAN, 'status').message_id)
    expect(String(status.body.text)).toContain('Your proposal: A car, longer term, sent to Annika, Mila')
    expect(rows(db).filter(r => r.kind === 'status')).toHaveLength(1)
  })

  it('a notice is sent once and never edited; without a bot token nothing is sent', async () => {
    const { db, ids, actor, proposal } = await setup()
    const tg = fakeTelegram()
    expect(await deliverPending(db, {}, at(500), tg.fetchImpl)).toEqual(ZERO)
    expect(tg.calls).toHaveLength(0)

    await castVote(db, proposal.current.id, ids.annika, 'agree', { settle: 'now', by: 'site' }, actor('Annika'), at(1000))
    await castVote(db, proposal.current.id, ids.mila, 'agree', { settle: 'now', by: 'site' }, actor('Mila'), at(1000))
    // accepted: a notice to each other voter besides the cards and the status (the author's status says it)
    expect(await deliverPending(db, ENV, at(2000), tg.fetchImpl)).toEqual({ ...ZERO, sent: 5 })
    expect(tg.calls.filter(c => String(c.body.text).startsWith('Decided ✓'))).toHaveLength(2)
    expect(tg.to(RYAN).map(c => c.method)).toEqual(['sendMessage'])
    expect(String(tg.to(RYAN)[0].body.text)).toContain('Your proposal “A car on credit” is accepted')
    db.sqlite.exec('UPDATE proposal_messages SET dirty = 1')
    expect(await deliverPending(db, ENV, at(3000), tg.fetchImpl)).toEqual({ ...ZERO, skipped: 3 })
    expect(tg.calls).toHaveLength(5)
  })

  it('a failed reminder retried after the proposal was withdrawn is not sent: the row is blocked as stale', async () => {
    const { db, ids, actor, proposal } = await setup()
    const tg = fakeTelegram()
    await deliverPending(db, ENV, at(500), tg.fetchImpl)
    db.sqlite.prepare(`INSERT INTO proposal_messages (version_id, user_id, chat_id, kind, notice, state, dirty, attempts, last_error, updated_at)
      VALUES (?, ?, ?, 'notice', 'reminder', 'failed', 0, 1, 'telegram.external', ?)`).run(proposal.current.id, ids.mila, MILA, at(1000).toISOString())
    await withdraw(db, proposal.id, actor('Ryan'), at(2000))
    tg.calls.length = 0

    await deliverPending(db, ENV, at(1000 + HOUR), tg.fetchImpl)
    expect(rows(db).find(r => r.notice === 'reminder')).toMatchObject({ state: 'blocked', last_error: 'stale', dirty: 0 })
    expect(tg.calls.filter(c => String(c.body.text).includes('waits for your vote'))).toEqual([])
  })

  it('a failed reminder retried after the voter voted (still in the comment window) is not sent: the row is blocked as stale', async () => {
    const { db, ids, actor, proposal } = await setup()
    const tg = fakeTelegram()
    await deliverPending(db, ENV, at(500), tg.fetchImpl)
    db.sqlite.prepare(`INSERT INTO proposal_messages (version_id, user_id, chat_id, kind, notice, state, dirty, attempts, last_error, updated_at)
      VALUES (?, ?, ?, 'notice', 'reminder', 'failed', 0, 1, 'telegram.external', ?)`).run(proposal.current.id, ids.mila, MILA, at(1000).toISOString())
    await castVote(db, proposal.current.id, ids.mila, 'agree', { settle: 'provisional', by: 'button' }, actor('Mila', 'bot'), at(2000))
    tg.calls.length = 0

    await deliverPending(db, ENV, at(1000 + HOUR), tg.fetchImpl)
    expect(rows(db).find(r => r.notice === 'reminder')).toMatchObject({ state: 'blocked', last_error: 'stale', dirty: 0 })
    expect(tg.calls.filter(c => String(c.body.text).includes('waits for your vote'))).toEqual([])
  })

  it('a revised proposal’s status follows the author to their current chat: a new message there', async () => {
    const { db, ids, actor, proposal, input } = await setup()
    const tg = fakeTelegram()
    await deliverPending(db, ENV, at(1000), tg.fetchImpl)
    await castVote(db, proposal.current.id, ids.mila, 'against', { settle: 'now', by: 'site' }, actor('Mila'), at(2000))
    await deliverPending(db, ENV, at(3000), tg.fetchImpl)
    // Ryan links another Telegram account before revising
    db.sqlite.exec(`UPDATE users SET telegram_id = '201' WHERE member = 'Ryan'`)
    await revise(db, proposal.id, { ...input, title: 'A car, longer term' }, actor('Ryan'), at(4000))
    expect(rowOf(db, '201', 'status')).toMatchObject({ state: 'pending', message_id: null, attempts: 0, last_error: null })

    expect(await deliverPending(db, ENV, at(5000), tg.fetchImpl)).toEqual({ ...ZERO, sent: 3, edited: 2 })
    expect(tg.to('201').map(c => c.method)).toEqual(['sendMessage'])
    expect(String(tg.to('201')[0].body.text)).toContain('Your proposal: A car, longer term')
    // nothing more in the old chat: its status message stays as it was
    expect(tg.to(RYAN).filter(c => c.method === 'editMessageText')).toHaveLength(1)
    expect(rows(db).filter(r => r.kind === 'status')).toHaveLength(1)
    expect(rowOf(db, '201', 'status')).toMatchObject({ state: 'sent', dirty: 0 })
  })

  it('a revision accepted at once is one message: the author’s status, edited to accepted', async () => {
    const { db, ids, actor, proposal, input } = await setup()
    const tg = fakeTelegram()
    await deliverPending(db, ENV, at(1000), tg.fetchImpl)
    await castVote(db, proposal.current.id, ids.mila, 'against', { settle: 'now', by: 'site' }, actor('Mila'), at(2000))
    await deliverPending(db, ENV, at(3000), tg.fetchImpl)
    const before = tg.to(RYAN).length
    db.sqlite.exec(`UPDATE users SET can_vote = 0 WHERE member IN ('Annika', 'Mila')`)
    await revise(db, proposal.id, input, actor('Ryan'), at(4000))
    await deliverPending(db, ENV, at(5000), tg.fetchImpl)
    const toRyan = tg.to(RYAN).slice(before)
    expect(toRyan.map(c => c.method)).toEqual(['editMessageText'])
    expect(String(toRyan[0].body.text)).toContain('Your proposal “A car on credit” is accepted')
  })

  it('a row marked dirty again while its message was on the way stays dirty for the next run, even within the same millisecond', async () => {
    const { db, ids, actor, proposal } = await setup()
    const tg = fakeTelegram()
    const send = tg.fetchImpl
    let voted = false
    const racing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      // Mila votes while the first message is being sent
      if (!voted) {
        voted = true
        // in the same millisecond as the rows were written: only the counter can tell
        await castVote(db, proposal.current.id, ids.mila, 'agree', { settle: 'now', by: 'site' }, actor('Mila'), T0)
      }
      return send(input, init)
    }) as typeof fetch
    await deliverPending(db, ENV, at(1000), racing)
    expect(rows(db).every(r => r.state === 'sent')).toBe(true)
    // the first row was sent with the old votes line and must be edited; the later ones read the new state
    expect(rows(db)[0].dirty).toBeGreaterThan(0)
    expect(await deliverPending(db, ENV, at(2000), tg.fetchImpl)).toMatchObject({ edited: 1 })
    expect(rows(db).every(r => r.dirty === 0)).toBe(true)
  })

  it('deliverSoon coalesces overlapping calls into one run and one rerun; flush awaits both', async () => {
    const { db } = await setup()
    const tg = fakeTelegram()
    vi.stubGlobal('fetch', tg.fetchImpl)
    const prepare = vi.spyOn(db, 'prepare')
    const runs = () => prepare.mock.calls.filter(([sql]) => /FROM proposal_messages m/.test(String(sql))).length

    deliverSoon(db, ENV)
    deliverSoon(db, ENV)
    deliverSoon(db, ENV)
    await deliveries.flush()
    expect(runs()).toBe(2)
    expect(tg.calls).toHaveLength(3)

    // idle again: the next call runs at once, alone
    deliverSoon(db, ENV)
    await deliveries.flush()
    expect(runs()).toBe(3)
    expect(tg.calls).toHaveLength(3)
  })

  it('deliverSoon never throws: a failed run is logged and the next one runs', async () => {
    const { db } = await setup()
    const tg = fakeTelegram()
    vi.stubGlobal('fetch', tg.fetchImpl)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const prepare = vi.spyOn(db, 'prepare').mockImplementationOnce(() => { throw new Error('database is locked') })
    expect(() => deliverSoon(db, ENV)).not.toThrow()
    await deliveries.flush()
    expect(errors.mock.calls.map(c => String(c[0]))).toEqual(['[council] delivery run failed'])
    prepare.mockRestore()
    deliverSoon(db, ENV)
    await deliveries.flush()
    expect(tg.calls).toHaveLength(3)
  })
})
