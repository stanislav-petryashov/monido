import type { AuthMode } from '../domain/api'
import type { FamilyTelegramGroup, FamilyTelegramView, TelegramPreferences } from '../domain/familyTelegram'
import type { Database } from './db'
import { CONFIG_ACTOR, InputError, plainObject, type Actor } from './http'
import { logStatement, tableColumns } from './rows'
import { commitMutation } from './mutations'
import { randomId, sha256Hex } from './secrets'
import { migratedTo, sendMessage } from './bot/telegram'

export async function telegramPreferences(db: Database, userId: number): Promise<TelegramPreferences | null> {
  const r = await db.prepare('SELECT telegram_sign_in, telegram_reminders, telegram_proposals, telegram_conversation FROM users WHERE id = ?').bind(userId).first()
  return r ? { signIn: !!r.telegram_sign_in, reminders: !!r.telegram_reminders, proposals: !!r.telegram_proposals, conversation: !!r.telegram_conversation } : null
}
export async function telegramGroups(db: Database): Promise<FamilyTelegramGroup[]> {
  const { results } = await db.prepare('SELECT * FROM family_telegram_groups ORDER BY title, chat_id').all()
  return results.map(r => ({ chatId: String(r.chat_id), title: String(r.title), reminders: !!r.reminders, proposals: !!r.proposals, conversation: !!r.conversation }))
}
export async function familyTelegramView(db: Database): Promise<FamilyTelegramView> {
  const { results } = await db.prepare('SELECT id FROM users ORDER BY id').all<{ id: number }>()
  return { users: await Promise.all(results.map(async r => ({ userId: r.id, ...(await telegramPreferences(db, r.id))! }))), groups: await telegramGroups(db) }
}
function preferences<T extends object>(base: T, body: unknown): T {
  const data = plainObject(body)
  for (const [key, value] of Object.entries(data)) {
    if (!Object.hasOwn(base, key) || typeof value !== 'boolean') throw new InputError('invalid_value', 400, { column: key })
  }
  return { ...base, ...data }
}
export async function saveTelegramPreferences(db: Database, id: number, body: unknown, mode: AuthMode, actor: Actor = CONFIG_ACTOR): Promise<TelegramPreferences> {
  return commitMutation(db, async () => {
    const before = await telegramPreferences(db, id)
    if (!before) throw new InputError('user_not_found', 404)
    const next = preferences(before, body)
    if (mode === 'telegram' && !next.signIn && !await db.prepare('SELECT 1 FROM users WHERE id != ? AND can_manage = 1 AND telegram_id IS NOT NULL AND telegram_sign_in = 1').bind(id).first()) throw new InputError('last_manager', 409)
    const ts = new Date().toISOString()
    const columns = (await tableColumns(db, 'users')).filter(c => ['telegram_sign_in', 'telegram_reminders', 'telegram_proposals', 'telegram_conversation'].includes(c.name))
    const previous = { telegram_sign_in: +before.signIn, telegram_reminders: +before.reminders, telegram_proposals: +before.proposals, telegram_conversation: +before.conversation }
    return { statements: [db.prepare('UPDATE users SET telegram_linked_at = CASE WHEN telegram_sign_in != ? THEN ? ELSE telegram_linked_at END, telegram_sign_in = ?, telegram_reminders = ?, telegram_proposals = ?, telegram_conversation = ? WHERE id = ?').bind(+next.signIn, ts, +next.signIn, +next.reminders, +next.proposals, +next.conversation, id), logStatement(db, actor, { table: 'users', rowid: id, op: 'update', before: previous, afterColumns: columns, ts })], result: next }
  })
}
export async function saveTelegramGroup(db: Database, chatId: string, body: unknown): Promise<FamilyTelegramGroup> {
  return commitMutation(db, async () => {
    const group = (await telegramGroups(db)).find(g => g.chatId === chatId)
    if (!group) throw new InputError('not_found', 404)
    const next = preferences({ reminders: group.reminders, proposals: group.proposals, conversation: group.conversation }, body)
    return {
      statements: [db.prepare('UPDATE family_telegram_groups SET reminders = ?, proposal_cursor = CASE WHEN proposals = 0 AND ? = 1 THEN (SELECT COALESCE(MAX(id), 0) FROM change_log) ELSE proposal_cursor END, proposals = ?, conversation = ? WHERE chat_id = ?').bind(+next.reminders, +next.proposals, +next.proposals, +next.conversation, chatId)],
      result: { ...group, ...next },
    }
  })
}
export async function beginGroupPairing(db: Database, username: string | null, now = new Date()) {
  if (!username) throw new InputError('bot_not_configured', 409)
  const code = randomId(24)
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString()
  await db.prepare('INSERT INTO family_telegram_pairing (id, hash, expires_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET hash = excluded.hash, expires_at = excluded.expires_at').bind(sha256Hex(code), expiresAt).run()
  return { command: `/pair@${username} ${code}`, expiresAt }
}

/**
 * Sends to a family chat. A group Telegram upgraded to a supergroup answers with its new id: the group's settings and
 * reminder day move there (unless that chat is paired already: its own stay) and the message is sent there once.
 * Resolves to the chat id the message went to; a failed resend carries that id as `chatId`.
 */
export async function sendToFamilyChat(db: Database, token: string, chatId: string, text: string, fetchImpl?: typeof fetch): Promise<string> {
  try {
    await sendMessage(token, chatId, text, fetchImpl)
    return chatId
  } catch (e) {
    const to = migratedTo(e)
    if (!to) throw e
    // a supergroup already paired keeps its own settings and day: the old group's rows go only where it has none
    await db.batch([
      db.prepare('UPDATE OR IGNORE family_telegram_groups SET chat_id = ? WHERE chat_id = ?').bind(to, chatId),
      db.prepare('DELETE FROM family_telegram_groups WHERE chat_id = ?').bind(chatId),
      db.prepare('UPDATE OR IGNORE family_telegram_reminder_delivery SET chat_id = ? WHERE chat_id = ?').bind(to, chatId),
      db.prepare('DELETE FROM family_telegram_reminder_delivery WHERE chat_id = ?').bind(chatId),
    ])
    try {
      await sendMessage(token, to, text, fetchImpl)
    } catch (retry) {
      // the caller releases what it claimed under the chat the message was really for
      throw Object.assign(retry as object, { chatId: to })
    }
    return to
  }
}
