// Telegram reminders on SQLite: settings for the Modules page (under the module card), linking a chat, and the hourly
// run that decides whether to send. The bot token and the chat id never leave the server.
import type { ModuleEnv } from '../../server/config'
import type { Database } from '../../server/db'
import { randomId, sha256Hex } from '../../server/secrets'
import { InputError } from '../../server/http'
import { TelegramError, isBlocked, migratedTo, sendMessage } from '../../server/bot/telegram'
import { sendToFamilyChat } from '../../server/familyTelegram'
import { familyT } from '../../server/bot/texts'
import type { BotUpdate } from '../../server/bot/updates'
import type { ReminderPairing, RemindersView } from '../../domain/api'
import { openMonths } from '../../domain/monthClose'
import { localDay, nextReminder, parseSchedule, shouldRemind, type ReminderSettings, type StoredError } from './domain'
import { reminderText, testMessage } from './message'

const DEFAULTS: ReminderSettings = {
  enabled: false, startDay: 3, hour: 10, timezone: 'UTC', chatId: null, chatTitle: null, lastSentAt: null, lastError: null,
}
const text = (v: unknown) => (v == null ? null : String(v))

/** last_error as stored: JSON `{ code, params? }`; anything else (broken JSON, a shape that is not one — migration 0010 cleared the prose of before codes) is no error. */
function storedError(v: unknown): StoredError | null {
  if (typeof v !== 'string') return null
  try {
    const parsed = JSON.parse(v) as unknown
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as StoredError).code !== 'string') return null
    const { code, params } = parsed as StoredError
    return params && typeof params === 'object' && !Array.isArray(params) ? { code, params } : { code }
  } catch { return null }
}

/** What last_error stores for a failure: a Telegram code as is; anything else — `fallback` (its text may hold the token). */
const failureJson = (e: unknown, fallback: TelegramError): string => {
  const { code, params } = e instanceof TelegramError ? e : fallback
  return JSON.stringify(params ? { code, params } : { code })
}

/** The settings; with no row (deleted) the defaults. */
async function readSettings(db: Database): Promise<ReminderSettings> {
  const r = await db.prepare('SELECT * FROM reminder_settings WHERE id = 1').first()
  if (!r) return DEFAULTS
  return {
    enabled: Number(r.enabled) === 1, startDay: Number(r.start_day), hour: Number(r.hour), timezone: String(r.timezone),
    chatId: text(r.chat_id), chatTitle: text(r.chat_title), lastSentAt: text(r.last_sent_at), lastError: storedError(r.last_error),
  }
}

/** The wizard queue on the schedule's local date: "the month is over" is about the person's time zone, not UTC. */
async function readOpenMonths(db: Database, now: Date, timezone: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT month FROM closed_months').all()
  return openMonths(results.map(r => String(r.month)), localDay(now, timezone))
}

/** Runs one statement on the settings row (prepare, bind, run); only a caller's upsert creates a row that was deleted. */
async function write(db: Database, sql: string, ...values: unknown[]): Promise<void> {
  await db.prepare(sql).bind(...values).run()
}

/** Delivery addresses stay server-side; the UI submits a known recipient key. */
async function readRecipients(db: Database, settings: ReminderSettings) {
  const { results: users } = await db.prepare('SELECT id, member, telegram_id, telegram_reminders FROM users WHERE telegram_id IS NOT NULL').all<{ id: number; member: string; telegram_id: string; telegram_reminders: number }>()
  const { results: groups } = await db.prepare('SELECT chat_id, title, reminders FROM family_telegram_groups').all<{ chat_id: string; title: string; reminders: number }>()
  const recipients: { id: string; title: string; kind: 'user' | 'group' | 'legacy'; enabled: boolean; chatId: string }[] = [
    ...users.map(u => ({ id: `user:${u.id}`, title: u.member, kind: 'user' as const, enabled: !!u.telegram_reminders, chatId: u.telegram_id })),
    ...groups.map(g => ({ id: `group:${g.chat_id}`, title: g.title, kind: 'group' as const, enabled: !!g.reminders, chatId: g.chat_id })),
  ]
  if (settings.chatId && !recipients.some(r => r.chatId === settings.chatId)) {
    recipients.push({ id: 'legacy', title: settings.chatTitle ?? '', kind: 'legacy', enabled: true, chatId: settings.chatId })
  }
  return recipients
}

export async function getReminders(db: Database, env: ModuleEnv, now = new Date()): Promise<RemindersView> {
  const settings = await readSettings(db)
  const open = await readOpenMonths(db, now, settings.timezone)
  const recipients = await readRecipients(db, settings)
  const { chatId, ...rest } = settings
  const nextTimes = await Promise.all(recipients.filter(r => r.enabled).map(async r => {
    const previous = r.chatId === chatId ? settings.lastSentAt : (await db.prepare('SELECT last_sent_at FROM family_telegram_reminder_delivery WHERE chat_id = ?').bind(r.chatId).first<{ last_sent_at: string }>())?.last_sent_at ?? null
    return nextReminder({ ...settings, chatId: r.chatId, lastSentAt: previous }, open, now)
  }))
  const next = nextTimes.filter((n): n is NonNullable<typeof n> => n !== null).sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour || a.minute - b.minute)[0] ?? null
  return { configured: !!env.TELEGRAM_BOT_TOKEN, linked: recipients.some(r => r.enabled), settings: rest, openMonths: open, next: env.TELEGRAM_BOT_TOKEN ? next : null,
    recipients: recipients.map(({ id, title, kind, enabled }) => ({ id, title, kind, enabled })) }
}

/** The schedule; the messages are in the family language, which is not a reminder setting. */
export async function saveSchedule(db: Database, env: ModuleEnv, body: unknown, now = new Date()): Promise<RemindersView> {
  let schedule
  // the parser's reason is English validation text; it goes to the client as is, in detail
  try { schedule = parseSchedule(body) } catch (e) { throw new InputError('reminders.invalid_schedule', 400, { detail: e instanceof Error ? e.message : 'Invalid schedule' }) }
  await write(db,
    `INSERT INTO reminder_settings (id, enabled, start_day, hour, timezone) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, start_day = excluded.start_day, hour = excluded.hour, timezone = excluded.timezone`,
    schedule.enabled ? 1 : 0, schedule.startDay, schedule.hour, schedule.timezone)
  return getReminders(db, env, now)
}

function requireToken(env: ModuleEnv): string {
  if (!env.TELEGRAM_BOT_TOKEN) throw new InputError('reminders.no_token', 409)
  return env.TELEGRAM_BOT_TOKEN
}

/** A Telegram error is passed on with its code (it holds no token); anything else without details. */
function asInputError(e: unknown): InputError {
  return e instanceof TelegramError ? new InputError(e.code, 502, e.params) : new InputError('reminders.unreachable', 502)
}

const PAIRING_TTL_MS = 10 * 60_000

/** Only the initiating browser receives the code. Settings reads never expose it or its hash. */
export async function beginPairing(db: Database, env: ModuleEnv, now = new Date()): Promise<ReminderPairing> {
  requireToken(env)
  const pairingToken = randomId(32)
  await write(db,
    `INSERT INTO reminder_settings (id, pairing_hash, pairing_expires_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET pairing_hash = excluded.pairing_hash, pairing_expires_at = excluded.pairing_expires_at`,
    sha256Hex(pairingToken), new Date(now.getTime() + PAIRING_TTL_MS).toISOString())
  return { pairingToken }
}

const PAIRING_CODE = /^[A-Za-z0-9_-]{43}$/

/**
 * The bot heard a private `/start <code>` with the pending, unexpired code: that chat becomes the recipient.
 * The code is consumed in the same conditional write, so a replaced, expired or used code changes nothing.
 * The consumed hash stays (without an expiry) until the next pairing, so the issuing browser can confirm.
 */
export async function linkFromStart(db: Database, update: BotUpdate, now = new Date()): Promise<boolean> {
  if (update.kind !== 'message' || update.chatType !== 'private') return false
  const code = update.text.match(/^\/start (\S+)$/)?.[1]
  if (!code || !PAIRING_CODE.test(code)) return false
  const linked = await db.prepare(
    `UPDATE reminder_settings SET chat_id = ?, chat_title = ?, last_error = NULL, pairing_expires_at = NULL
     WHERE id = 1 AND pairing_hash = ? AND pairing_expires_at > ?`)
    .bind(update.chatId, update.from.name, sha256Hex(code), now.toISOString()).run()
  return linked.meta.changes === 1
}

/** The issuing browser asks whether its code reached the bot: still pending, linked by it, or no longer valid. */
export async function linkChat(db: Database, env: ModuleEnv, body: unknown, now = new Date()): Promise<RemindersView> {
  requireToken(env)
  const pairingToken = (body as Partial<ReminderPairing> | null)?.pairingToken
  if (typeof pairingToken !== 'string' || !PAIRING_CODE.test(pairingToken)) throw new InputError('reminders.invalid_pairing', 409)
  const r = await db.prepare('SELECT chat_id, pairing_expires_at FROM reminder_settings WHERE id = 1 AND pairing_hash = ?').bind(sha256Hex(pairingToken)).first()
  // consumed by this code: the chat it linked is still the recipient (an unlink or a purge clears it)
  if (r && r.pairing_expires_at === null && r.chat_id !== null) return getReminders(db, env, now)
  if (r && r.pairing_expires_at !== null && String(r.pairing_expires_at) > now.toISOString()) throw new InputError('reminders.no_start', 404)
  throw new InputError('reminders.invalid_pairing', 409)
}

export async function unlinkChat(db: Database, env: ModuleEnv, now = new Date()): Promise<RemindersView> {
  // the delivery history was about this chat: the next recipient has no use for it
  await write(db, 'UPDATE reminder_settings SET chat_id = NULL, chat_title = NULL, last_error = NULL, last_sent_at = NULL, pairing_hash = NULL, pairing_expires_at = NULL WHERE id = 1')
  return getReminders(db, env, now)
}

/** A test message: checks the bot and the chat, leaves the schedule alone. */
export async function sendTest(db: Database, env: ModuleEnv, now = new Date(), fetchImpl?: typeof fetch, recipientId?: unknown): Promise<RemindersView> {
  const token = requireToken(env)
  const settings = await readSettings(db)
  const recipient = recipientId === undefined ? null : (await readRecipients(db, settings)).find(r => r.id === recipientId && r.enabled)
  const chatId = recipientId === undefined ? settings.chatId : recipient?.chatId
  if (!chatId) throw new InputError('reminders.no_chat', 409)
  try {
    const { t } = await familyT(db)
    const open = recipientId === undefined ? [] : await readOpenMonths(db, now, settings.timezone)
    const message = testMessage(t) + (open.length ? `\n\n${reminderText(t, open, env.APP_URL ?? null)}` : '')
    await sendMessage(token, chatId, message, fetchImpl)
  } catch (e) {
    if (chatId === settings.chatId) await write(db, 'UPDATE reminder_settings SET last_error = ? WHERE id = 1', failureJson(e, new TelegramError('reminders.unreachable')))
    throw asInputError(e)
  }
  // delivery works: the earlier error no longer applies
  if (chatId === settings.chatId) await write(db, 'UPDATE reminder_settings SET last_error = NULL WHERE id = 1')
  return getReminders(db, env, now)
}

/** The hourly run: sends a reminder when it is time; never throws. */
export async function runScheduled(db: Database, env: ModuleEnv, now = new Date(), fetchImpl?: typeof fetch): Promise<'sent' | 'skipped' | 'failed'> {
  try {
    const token = env.TELEGRAM_BOT_TOKEN
    if (!token) return 'skipped'
    const settings = await readSettings(db)
    const open = await readOpenMonths(db, now, settings.timezone)
    const familySent = await sendFamilyReminders(db, env, settings, open, now, fetchImpl)
    const legacyUser = settings.chatId ? await db.prepare('SELECT telegram_reminders FROM users WHERE telegram_id = ?').bind(settings.chatId).first<{ telegram_reminders: number }>() : null
    if ((legacyUser && !legacyUser.telegram_reminders) || !settings.chatId || !shouldRemind(settings, open, now)) return familySent ? 'sent' : 'skipped'
    const message = reminderText((await familyT(db)).t, open, env.APP_URL ?? null)
    // Claim today before sending: if runs overlap, only one message goes out
    const claim = await db.prepare('UPDATE reminder_settings SET last_sent_at = ? WHERE id = 1 AND last_sent_at IS ?')
      .bind(now.toISOString(), settings.lastSentAt).run()
    if (claim.meta.changes !== 1) return 'skipped'
    try {
      try {
        await sendMessage(token, settings.chatId, message, fetchImpl)
      } catch (e) {
        // the linked group was upgraded to a supergroup: the reminders follow it to its new id
        const to = migratedTo(e)
        if (!to) throw e
        await db.prepare('UPDATE reminder_settings SET chat_id = ? WHERE id = 1 AND chat_id = ?').bind(to, settings.chatId).run()
        await sendMessage(token, to, message, fetchImpl)
      }
    } catch (e) {
      // the reason shows on the Modules page, under the module card. Only Telegram's own refusal releases the day (the next
      // hour tries again); a blocked chat keeps it (retrying is pointless), and so does no answer: the message may have gone
      const reason = failureJson(e, new TelegramError('reminders.send_failed'))
      const refused = e instanceof TelegramError && e.code !== 'telegram.unavailable' && !isBlocked(e)
      if (refused) await db.prepare('UPDATE reminder_settings SET last_sent_at = ?, last_error = ? WHERE id = 1').bind(settings.lastSentAt, reason).run()
      else await db.prepare('UPDATE reminder_settings SET last_error = ? WHERE id = 1').bind(reason).run()
      return 'failed'
    }
    await db.prepare('UPDATE reminder_settings SET last_error = NULL WHERE id = 1').run()
    return 'sent'
  } catch {
    // without the error object: it may hold the request URL with the token
    console.error('[reminders] scheduled run failed')
    return 'failed'
  }
}

/** Each opted-in recipient has its own day claim, while sharing the existing schedule. */
async function sendFamilyReminders(db: Database, env: ModuleEnv, settings: ReminderSettings, open: string[], now: Date, fetchImpl?: typeof fetch): Promise<boolean> {
  const { results } = await db.prepare(`SELECT telegram_id AS chat_id FROM users WHERE telegram_reminders = 1 AND telegram_id IS NOT NULL
    UNION SELECT chat_id FROM family_telegram_groups WHERE reminders = 1`).all<{ chat_id: string }>()
  let sent = false
  for (const { chat_id: chatId } of results) {
    if (chatId === settings.chatId) continue
    const previous = await db.prepare('SELECT last_sent_at FROM family_telegram_reminder_delivery WHERE chat_id = ?').bind(chatId).first<{ last_sent_at: string }>()
    if (!shouldRemind({ ...settings, chatId, lastSentAt: previous?.last_sent_at ?? null }, open, now)) continue
    const claim = await db.prepare(`INSERT INTO family_telegram_reminder_delivery (chat_id, last_sent_at) VALUES (?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET last_sent_at = excluded.last_sent_at WHERE last_sent_at IS ?`).bind(chatId, now.toISOString(), previous?.last_sent_at ?? null).run()
    if (!claim.meta.changes) continue
    // A changed recipient preference takes effect before the send, including a disconnected group.
    const allowed = await db.prepare(`SELECT 1 FROM users WHERE telegram_id = ? AND telegram_reminders = 1
      UNION SELECT 1 FROM family_telegram_groups WHERE chat_id = ? AND reminders = 1`).bind(chatId, chatId).first()
    if (!allowed) continue
    try {
      await sendToFamilyChat(db, env.TELEGRAM_BOT_TOKEN!, chatId, reminderText((await familyT(db)).t, open, env.APP_URL ?? null), fetchImpl)
      sent = true
    } catch (e) {
      if (e instanceof TelegramError && e.code !== 'telegram.unavailable' && !isBlocked(e)) {
        await db.prepare('DELETE FROM family_telegram_reminder_delivery WHERE chat_id = ? AND last_sent_at = ?').bind(chatId, now.toISOString()).run()
      }
      console.error('[reminders] recipient delivery failed')
    }
  }
  return sent
}
