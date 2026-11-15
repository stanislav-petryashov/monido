import { beforeEach, describe, expect, it, vi } from 'vitest'
import { beginPairing, getReminders, linkChat, linkFromStart, runScheduled, saveSchedule, sendTest, unlinkChat } from '../../../src/modules/reminders/reminders'
import { remindersServer } from '../../../src/modules/reminders/server'
import type { BotUpdate } from '../../../src/server/bot/updates'
import { createTestDb, type TestDb } from '../../helpers/db'
import { fakeAuthRuntime } from '../../helpers/auth'
import { ru } from '../../helpers/i18n'
import { monthTitle } from '../../../src/i18n/dates'

const NOW = new Date('2031-10-03T07:05:00Z')           // 3 October, 10:05 Moscow time
const env = { TELEGRAM_BOT_TOKEN: 'T0KEN', APP_URL: 'https://finance.example.com' }
const row = (db: TestDb) => ({ ...(db.sqlite.prepare('SELECT * FROM reminder_settings').get() as Record<string, unknown>) })
const link = (db: TestDb) => db.sqlite.exec(`UPDATE reminder_settings SET chat_id = '42', chat_title = 'Robin'`)
const enable = (db: TestDb) => db.sqlite.exec(`UPDATE reminder_settings SET enabled = 1, timezone = 'Europe/Moscow'`)
const speak = (db: TestDb, language: string) => db.sqlite.exec(`INSERT INTO app_settings (key, value) VALUES ('language', '${language}') ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
/** What last_error holds: JSON with a code and its params. */
const storedError = (db: TestDb) => JSON.parse(String(row(db).last_error)) as unknown
/** August is closed: in October only September is in the queue. */
const seedOpen = (db: TestDb) => db.sqlite.exec(`INSERT INTO closed_months VALUES ('2031-08', 't', 'migration')`)
const closeAll = (db: TestDb) => db.sqlite.exec(`INSERT INTO closed_months VALUES ('2031-09', 't', 'migration')`)
/** What the bot hears when someone sends /start with a code in a private chat. */
const start = (chatId: number, name: string, code: string): BotUpdate => ({
  kind: 'message', chatId: String(chatId), chatType: 'private', from: { id: String(chatId), name }, text: `/start ${code}`, date: Math.floor(NOW.getTime() / 1000),
})

/** A fake Telegram: sendMessage succeeds or refuses with a reason. */
function tg({ sendError, status = 403 }: { sendError?: string; status?: number }) {
  return vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
    if (sendError) return new Response(JSON.stringify({ ok: false, error_code: status, description: sendError }), { status })
    return new Response(JSON.stringify({ ok: true, result: {} }))
  })
}
const sentTexts = (f: ReturnType<typeof tg>) => f.mock.calls
  .filter(([url]) => String(url).endsWith('/sendMessage'))
  .map(call => (JSON.parse(String((call as unknown as [string, RequestInit])[1].body)) as { text: string }).text)

let db: TestDb
beforeEach(() => { db = createTestDb() })

describe('settings', () => {
  it('reports that the bot is not configured without a token', async () => {
    expect((await getReminders(db, {}, NOW)).configured).toBe(false)
    expect((await getReminders(db, env, NOW)).configured).toBe(true)
  })

  it('never returns the chat id or the token', async () => {
    link(db)
    const view = await getReminders(db, env, NOW)
    expect(JSON.stringify(view)).not.toContain('T0KEN')
    expect(JSON.stringify(view)).not.toContain('"42"')
    expect(view.linked).toBe(true)
    expect(view.settings.chatTitle).toBe('Robin')
  })

  it('tells the queue and when the next reminder is due', async () => {
    seedOpen(db); link(db); enable(db)
    const view = await getReminders(db, env, new Date('2031-10-01T09:00:00Z'))
    expect(view.openMonths).toEqual(['2031-09'])
    expect(view.next).toEqual({ date: '2031-10-03', hour: 10, minute: 0 })
  })

  it('saves a schedule within the limits and refuses one outside them, naming the field', async () => {
    const view = await saveSchedule(db, env, { enabled: true, startDay: 15, hour: 9, timezone: 'Europe/Moscow' }, NOW)
    expect(view.settings).toMatchObject({ enabled: true, startDay: 15, hour: 9, timezone: 'Europe/Moscow' })
    expect(row(db)).toMatchObject({ enabled: 1, start_day: 15, hour: 9, timezone: 'Europe/Moscow' })
    await expect(saveSchedule(db, env, { enabled: true, startDay: 16, hour: 9, timezone: 'Europe/Moscow' }, NOW))
      .rejects.toMatchObject({ status: 400, code: 'reminders.invalid_schedule', params: { detail: expect.stringContaining('startDay') } })
    expect(row(db)).toMatchObject({ start_day: 15 })
  })
})

describe('linking a chat', () => {
  let pairing: Awaited<ReturnType<typeof beginPairing>>
  beforeEach(async () => { pairing = await beginPairing(db, env, NOW) })
  const LATER = new Date(NOW.getTime() + 60_000)

  it('/start with the pairing code links the chat through onBotUpdate', async () => {
    // onBotUpdate reads the clock: a code issued now
    const fresh = await beginPairing(db, env)
    expect(await remindersServer.onBotUpdate!(start(7, 'Stranger', 'x'.repeat(43)), { db, env, auth: fakeAuthRuntime() })).toBe(false)
    expect(row(db)).toMatchObject({ chat_id: null, pairing_hash: expect.any(String) })
    expect(await remindersServer.onBotUpdate!(start(42, 'Robin', fresh.pairingToken), { db, env, auth: fakeAuthRuntime() })).toBe(true)
    expect(row(db)).toMatchObject({ chat_id: '42', chat_title: 'Robin', pairing_expires_at: null })
  })

  it('names a chat without a name as such: the UI words it', async () => {
    await linkFromStart(db, { ...start(42, 'Robin', pairing.pairingToken), from: { id: '42', name: null } }, LATER)
    expect(row(db)).toMatchObject({ chat_id: '42', chat_title: null })
  })

  it.each<[string, (code: string) => BotUpdate]>([
    ['a group', code => ({ ...start(-100, 'Family', code), chatType: 'group' })],
    ['a bare /start', () => ({ ...start(7, 'Stranger', ''), text: '/start' })],
    ['another pairing code', () => start(7, 'Stranger', 'y'.repeat(43))],
    ['a partial code', code => start(7, 'Stranger', code.slice(1))],
    ['a code with more after it', code => start(7, 'Stranger', `${code}x`)],
    ['the code with more words', code => start(7, 'Stranger', `${code} again`)],
    ['another command', code => ({ ...start(7, 'Stranger', code), text: `/startle ${code}` })],
    ['a button press', code => ({ kind: 'callback', id: 'cb', chatId: '7', messageId: 1, from: { id: '7', name: null }, data: `/start ${code}` })],
  ])('ignores %s and keeps the current recipient and the pending code', async (_, make) => {
    link(db)
    const hash = row(db).pairing_hash
    expect(await linkFromStart(db, make(pairing.pairingToken), LATER)).toBe(false)
    expect(row(db)).toMatchObject({ chat_id: '42', chat_title: 'Robin', pairing_hash: hash, pairing_expires_at: '2031-10-03T07:15:00.000Z' })
  })

  it('ignores an expired, a replaced or a used code', async () => {
    expect(await linkFromStart(db, start(7, 'Late', pairing.pairingToken), new Date(NOW.getTime() + 10 * 60_000))).toBe(false)
    const next = await beginPairing(db, env, NOW)
    expect(await linkFromStart(db, start(7, 'Old code', pairing.pairingToken), LATER)).toBe(false)
    expect(await linkFromStart(db, start(42, 'Robin', next.pairingToken), LATER)).toBe(true)
    expect(await linkFromStart(db, start(7, 'Replay', next.pairingToken), LATER)).toBe(false)
    expect(row(db)).toMatchObject({ chat_id: '42', chat_title: 'Robin' })
  })

  it('only one of two chats sending the code at once becomes the recipient', async () => {
    const results = await Promise.all([linkFromStart(db, start(42, 'Robin', pairing.pairingToken), LATER), linkFromStart(db, start(7, 'Stranger', pairing.pairingToken), LATER)])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('POST /api/reminders/link reports the result', async () => {
    await expect(linkChat(db, env, pairing, LATER)).rejects.toMatchObject({ code: 'reminders.no_start', status: 404 })
    await linkFromStart(db, start(42, 'Robin', pairing.pairingToken), LATER)
    const view = await linkChat(db, env, pairing, LATER)
    expect(view.linked).toBe(true)
    expect(view.settings.chatTitle).toBe('Robin')
    // the browser may ask again, even after the code's time is up
    expect((await linkChat(db, env, pairing, new Date(NOW.getTime() + 60 * 60_000))).linked).toBe(true)
  })

  it('a code that expired, was replaced or whose chat was unlinked is no longer valid', async () => {
    await expect(linkChat(db, env, pairing, new Date(NOW.getTime() + 10 * 60_000))).rejects.toMatchObject({ code: 'reminders.invalid_pairing', status: 409 })
    await linkFromStart(db, start(42, 'Robin', pairing.pairingToken), LATER)
    await unlinkChat(db, env, LATER)
    await expect(linkChat(db, env, pairing, LATER)).rejects.toMatchObject({ code: 'reminders.invalid_pairing' })
    const first = await beginPairing(db, env, NOW)
    await linkFromStart(db, start(42, 'Robin', first.pairingToken), LATER)
    await beginPairing(db, env, NOW)
    await expect(linkChat(db, env, first, LATER)).rejects.toMatchObject({ code: 'reminders.invalid_pairing' })
    expect(row(db).chat_id).toBe('42')
  })

  it('refuses to confirm without a token', async () => {
    await expect(linkChat(db, {}, pairing, LATER)).rejects.toMatchObject({ code: 'reminders.no_token', status: 409 })
  })

  it('stores only a hash, does not expose it in settings, and preserves the current recipient and schedule', async () => {
    link(db); enable(db)
    const next = await beginPairing(db, env, NOW)
    expect(next.pairingToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(next.pairingToken).not.toBe(pairing.pairingToken)
    expect(row(db)).toMatchObject({ chat_id: '42', enabled: 1, timezone: 'Europe/Moscow', pairing_expires_at: '2031-10-03T07:15:00.000Z' })
    expect(row(db).pairing_hash).not.toBe(next.pairingToken)
    const settings = JSON.stringify(await getReminders(db, env, NOW))
    expect(settings).not.toContain(next.pairingToken)
    expect(settings).not.toContain(String(row(db).pairing_hash))
  })

  it.each([undefined, null, {}, { pairingToken: 42 }, { pairingToken: 'x' }, { pairingToken: 'x'.repeat(43) }])('refuses missing or invalid attempts: %j', async body => {
    link(db)
    await expect(linkChat(db, env, body, NOW)).rejects.toMatchObject({ code: 'reminders.invalid_pairing', status: 409 })
    expect(row(db).chat_id).toBe('42')
  })

  it('clears an old delivery error when a chat is linked again', async () => {
    db.sqlite.exec(`UPDATE reminder_settings SET last_error = 'Forbidden: bot was blocked by the user'`)
    await linkFromStart(db, start(42, 'Robin', pairing.pairingToken), LATER)
    expect(row(db).last_error).toBeNull()
  })
})

describe('test message', () => {
  it('goes to the linked chat and does not move the schedule', async () => {
    link(db)
    const calls = tg({})
    await sendTest(db, env, NOW, calls)
    expect(sentTexts(calls)).toEqual(['Test message: reminders about months not closed yet are set up.'])
    expect(row(db).last_sent_at).toBeNull()
  })

  it('reports a failure with Telegram’s reason', async () => {
    link(db)
    await expect(sendTest(db, env, NOW, tg({ sendError: 'Forbidden: bot was blocked by the user' })))
      .rejects.toMatchObject({ status: 502, code: 'telegram.external', params: { detail: expect.stringContaining('bot was blocked') } })
  })

  it('is refused without a linked chat or without a token', async () => {
    await expect(sendTest(db, env, NOW, tg({}))).rejects.toMatchObject({ status: 409 })
    link(db)
    await expect(sendTest(db, {}, NOW, tg({}))).rejects.toMatchObject({ status: 409 })
  })
})

describe('runScheduled', () => {
  it('sends the reminder with the open months and the link, and remembers when', async () => {
    seedOpen(db); link(db); enable(db)
    const calls = tg({})
    expect(await runScheduled(db, env, NOW, calls)).toBe('sent')
    expect(sentTexts(calls)).toEqual(['September 2031 is not closed yet.\nClose it: https://finance.example.com/close'])
    expect(row(db)).toMatchObject({ last_sent_at: NOW.toISOString(), last_error: null })
  })

  it('does not send twice the same local day', async () => {
    seedOpen(db); link(db); enable(db)
    await runScheduled(db, env, NOW, tg({}))
    const again = tg({})
    expect(await runScheduled(db, env, new Date('2031-10-03T08:05:00Z'), again)).toBe('skipped')
    expect(again).not.toHaveBeenCalled()
  })

  it('sends again the next day while the month is still open, and stops once it is closed', async () => {
    seedOpen(db); link(db); enable(db)
    await runScheduled(db, env, NOW, tg({}))
    expect(await runScheduled(db, env, new Date('2031-10-04T07:05:00Z'), tg({}))).toBe('sent')
    closeAll(db)
    expect(await runScheduled(db, env, new Date('2031-10-05T07:05:00Z'), tg({}))).toBe('skipped')
  })

  it('tries again the next hour after a refusal, and clears the error once it goes through', async () => {
    seedOpen(db); link(db); enable(db)
    expect(await runScheduled(db, env, NOW, tg({ sendError: 'Too Many Requests', status: 429 }))).toBe('failed')
    expect(await runScheduled(db, env, new Date('2031-10-03T08:05:00Z'), tg({}))).toBe('sent')
    expect(row(db).last_error).toBeNull()
  })

  it.each([
    [403, 'Forbidden: bot was blocked by the user'],
    [400, 'Bad Request: chat not found'],
  ])('a blocked or gone chat (%i) keeps the day: no retry every hour, only the reason is stored', async (status, detail) => {
    seedOpen(db); link(db); enable(db)
    expect(await runScheduled(db, env, NOW, tg({ sendError: detail, status }))).toBe('failed')
    expect(row(db).last_sent_at).toBe(NOW.toISOString())
    expect(storedError(db)).toEqual({ code: 'telegram.external', params: { status, detail } })
    expect(await runScheduled(db, env, new Date('2031-10-03T08:05:00Z'), tg({}))).toBe('skipped')
  })

  it('never stores the token in last_error', async () => {
    seedOpen(db); link(db); enable(db)
    const boom = vi.fn(async () => { throw new Error('fetch failed: https://api.telegram.org/botT0KEN/sendMessage') })
    expect(await runScheduled(db, env, NOW, boom)).toBe('failed')
    expect(String(row(db).last_error)).not.toContain('T0KEN')
    expect(storedError(db)).toEqual({ code: 'telegram.unavailable' })
  })

  it('keeps the day when Telegram does not answer: the message may have gone, so the next hour does not send it again', async () => {
    seedOpen(db); link(db); enable(db)
    expect(await runScheduled(db, env, NOW, vi.fn(async () => { throw new Error('timeout') }))).toBe('failed')
    expect(row(db).last_sent_at).toBe(NOW.toISOString())
    const again = tg({})
    expect(await runScheduled(db, env, new Date('2031-10-03T08:05:00Z'), again)).toBe('skipped')
    expect(again).not.toHaveBeenCalled()
  })

  it.each([
    ['there is no token', (d: TestDb) => { seedOpen(d); link(d); enable(d) }, {}],
    ['reminders are off', (d: TestDb) => { seedOpen(d); link(d) }, env],
    ['no chat is linked', (d: TestDb) => { seedOpen(d); enable(d) }, env],
    ['every month is closed', (d: TestDb) => { seedOpen(d); closeAll(d); link(d); enable(d) }, env],
  ])('does nothing when %s', async (_, prepare, e) => {
    prepare(db)
    const calls = tg({})
    expect(await runScheduled(db, e, NOW, calls)).toBe('skipped')
    expect(calls).not.toHaveBeenCalled()
  })

  it('sends without a link when the address of the app is not set', async () => {
    seedOpen(db); link(db); enable(db)
    const calls = tg({})
    await runScheduled(db, { TELEGRAM_BOT_TOKEN: 'T0KEN' }, NOW, calls)
    expect(sentTexts(calls)[0]).toBe('September 2031 is not closed yet.\nOpen “Close month” in the app.')
  })
})

describe('review: the queue follows the local month', () => {
  it('does not remind a western zone about a month that has not ended there', async () => {
    seedOpen(db); link(db)
    db.sqlite.exec(`UPDATE reminder_settings SET enabled = 1, timezone = 'America/Los_Angeles', start_day = 3`)
    // 1 October 00:00 UTC: in Los Angeles it is still 30 September, 17:00
    const calls = tg({})
    expect(await runScheduled(db, env, new Date('2031-10-01T00:00:00Z'), calls)).toBe('skipped')
    expect(calls).not.toHaveBeenCalled()
    expect((await getReminders(db, env, new Date('2031-10-01T00:00:00Z'))).openMonths).toEqual([])
    // 3 October 10:00 in Los Angeles
    expect(await runScheduled(db, env, new Date('2031-10-03T17:00:00Z'), tg({}))).toBe('sent')
  })

  it('reminds an eastern zone on its own first day', async () => {
    seedOpen(db); link(db)
    db.sqlite.exec(`UPDATE reminder_settings SET enabled = 1, timezone = 'Pacific/Tongatapu', start_day = 1, hour = 10`)
    // 30 September 21:00 UTC: in Tonga it is 1 October 10:00
    expect(await runScheduled(db, env, new Date('2031-09-30T21:00:00Z'), tg({}))).toBe('sent')
  })
})

describe('review: robustness', () => {
  it('two overlapping runs send one message', async () => {
    seedOpen(db); link(db); enable(db)
    const calls = tg({})
    const results = await Promise.all([runScheduled(db, env, NOW, calls), runScheduled(db, env, NOW, calls)])
    expect(results.sort()).toEqual(['sent', 'skipped'])
    expect(sentTexts(calls)).toHaveLength(1)
  })

  it.each([
    ['429', 429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 30', parameters: { retry_after: 30 } }, 'Too Many Requests: retry after 30'],
    ['a 502 page', 502, '<html>Bad Gateway</html>', { code: 'telegram.status', params: { status: 502 } }],
  ])('records %s and keeps the schedule', async (_, status, body, reason) => {
    seedOpen(db); link(db); enable(db)
    const f = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
    expect(await runScheduled(db, env, NOW, f)).toBe('failed')
    expect(row(db).last_sent_at).toBeNull()
    expect(storedError(db)).toEqual(typeof reason === 'string' ? { code: 'telegram.external', params: { status, detail: reason } } : reason)
  })

  it('saves the schedule and links a chat even when the settings row is gone', async () => {
    db.sqlite.exec('DELETE FROM reminder_settings')
    await saveSchedule(db, env, { enabled: true, startDay: 5, hour: 9, timezone: 'Europe/Moscow' }, NOW)
    expect(row(db)).toMatchObject({ enabled: 1, start_day: 5 })
    db.sqlite.exec('DELETE FROM reminder_settings')
    const pairing = await beginPairing(db, env, NOW)
    await linkFromStart(db, start(42, 'Robin', pairing.pairingToken), NOW)
    expect(row(db)).toMatchObject({ chat_id: '42', enabled: 0 })
  })

  it('a test message that goes through clears an old delivery error; one that fails records why', async () => {
    link(db)
    db.sqlite.exec(`UPDATE reminder_settings SET last_error = 'Forbidden: bot was blocked by the user'`)
    await sendTest(db, env, NOW, tg({}))
    expect(row(db).last_error).toBeNull()
    await sendTest(db, env, NOW, tg({ sendError: 'Bad Request: chat not found' })).catch(() => {})
    expect(storedError(db)).toEqual({ code: 'telegram.external', params: { status: 403, detail: 'Bad Request: chat not found' } })
  })

  it('unlinking forgets the delivery history of that chat', async () => {
    link(db)
    db.sqlite.exec(`UPDATE reminder_settings SET last_error = 'x', last_sent_at = '2031-10-01T07:00:00Z'`)
    await unlinkChat(db, env, NOW)
    expect(row(db)).toMatchObject({ last_error: null, last_sent_at: null })
  })
})


describe('message language', () => {
  it('a reminder is written in the family language', async () => {
    seedOpen(db); link(db); enable(db); speak(db, 'ru-RU')
    const calls = tg({})
    expect(await runScheduled(db, env, NOW, calls)).toBe('sent')
    const [head, action] = sentTexts(calls)[0].split('\n')
    expect(head).toBe(ru('modules.reminders.message.single', { month: monthTitle(ru, '2031-09') }))
    expect(action).toBe(ru('modules.reminders.message.closeAt', { url: 'https://finance.example.com/close' }))
  })

  it('the test message is in the family language too', async () => {
    link(db); speak(db, 'ru-RU')
    const calls = tg({})
    await sendTest(db, env, NOW, calls)
    expect(sentTexts(calls)).toEqual([ru('modules.reminders.message.test')])
  })

  it('the reminder settings carry no language and ignore the legacy column', async () => {
    db.sqlite.exec(`UPDATE reminder_settings SET language = 'ru-RU'`)
    expect((await getReminders(db, env, NOW)).settings).not.toHaveProperty('language')
    const view = await saveSchedule(db, env, { enabled: true, startDay: 3, hour: 10, timezone: 'UTC' }, NOW)
    expect(view.settings).not.toHaveProperty('language')
  })
})

describe('stored errors', () => {
  it('a failed test message stores the code, and the view returns it', async () => {
    link(db)
    await sendTest(db, env, NOW, tg({ sendError: 'Forbidden: bot was blocked by the user' })).catch(() => {})
    expect(storedError(db)).toEqual({ code: 'telegram.external', params: { status: 403, detail: 'Forbidden: bot was blocked by the user' } })
    expect((await getReminders(db, env, NOW)).settings.lastError)
      .toEqual({ code: 'telegram.external', params: { status: 403, detail: 'Forbidden: bot was blocked by the user' } })
  })

  it('a failed hourly run stores a code without params when Telegram is down', async () => {
    seedOpen(db); link(db); enable(db)
    await runScheduled(db, env, NOW, vi.fn(async () => { throw new Error('down') }))
    expect((await getReminders(db, env, NOW)).settings.lastError).toEqual({ code: 'telegram.unavailable' })
  })

  it.each([
    ['legacy prose', 'Forbidden: bot was blocked by the user'],
    ['JSON without a code', '{"detail":"x"}'],
    ['a JSON string', '"telegram.external"'],
  ])('reads %s as no error', async (_, stored) => {
    link(db)
    db.sqlite.prepare('UPDATE reminder_settings SET last_error = ?').run(stored)
    expect((await getReminders(db, env, NOW)).settings.lastError).toBeNull()
  })

  it('drops array params and keeps the code', async () => {
    link(db)
    db.sqlite.prepare('UPDATE reminder_settings SET last_error = ?').run('{"code":"telegram.unavailable","params":["x"]}')
    expect((await getReminders(db, env, NOW)).settings.lastError).toEqual({ code: 'telegram.unavailable' })
  })
})

describe('notification recipients', () => {
  it('reports the next run for family recipients without a legacy chat', async () => {
    seedOpen(db); enable(db)
    db.sqlite.exec(`INSERT INTO users (member, telegram_id, telegram_reminders, created_at, updated_at) VALUES ('Alex', '9001', 1, 't', 't')`)
    const view = await getReminders(db, env, new Date('2031-10-01T09:00:00Z'))
    expect(view.linked).toBe(true)
    expect(view.next).toEqual({ date: '2031-10-03', hour: 10, minute: 0 })
  })
  it('does not advertise a legacy recipient who opted out', async () => {
    seedOpen(db); link(db); enable(db)
    db.sqlite.exec(`INSERT INTO users (member, telegram_id, telegram_reminders, created_at, updated_at) VALUES ('Robin', '42', 0, 't', 't')`)
    const view = await getReminders(db, env, NOW)
    expect(view.linked).toBe(false)
    expect(view.next).toBeNull()
  })
})

it('tests only the selected opted-in recipient without consuming the scheduled send', async () => {
  seedOpen(db); enable(db)
  db.sqlite.exec(`INSERT INTO users (id, member, telegram_id, telegram_reminders, created_at, updated_at) VALUES (1, 'Alex', '9001', 1, 't', 't'), (2, 'Maria', '9002', 0, 't', 't')`)
  const fetchImpl = tg({})
  await sendTest(db, env, NOW, fetchImpl, 'user:1')
  expect(fetchImpl.mock.calls).toHaveLength(1)
  expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({ chat_id: '9001' })
  expect(db.sqlite.prepare('SELECT * FROM family_telegram_reminder_delivery').all()).toEqual([])
  await expect(sendTest(db, env, NOW, fetchImpl, 'user:2')).rejects.toMatchObject({ status: 409 })
  await expect(sendTest(db, env, NOW, fetchImpl, '9001')).rejects.toMatchObject({ status: 409 })
  await expect(sendTest(db, env, NOW, fetchImpl, null)).rejects.toMatchObject({ status: 409 })
  expect(fetchImpl.mock.calls).toHaveLength(1)
})
