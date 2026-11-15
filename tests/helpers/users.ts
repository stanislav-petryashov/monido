import type { TestDb } from './db'

/**
 * A users row as the Users page would write it; returns its id. The rights default to the table's (edit and vote on,
 * manage off). created_at is a fixed ISO time well before "now", which userCookie (helpers/session.ts) needs.
 */
export function addUser(db: TestDb, member: string, { telegramId = null, manage = false, edit = true, vote = true }:
  { telegramId?: string | null; manage?: boolean; edit?: boolean; vote?: boolean } = {}): number {
  const at = '2020-01-01T00:00:00.000Z'
  return Number(db.sqlite.prepare('INSERT INTO users (member, telegram_id, can_edit, can_vote, can_manage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(member, telegramId, edit ? 1 : 0, vote ? 1 : 0, manage ? 1 : 0, at, at).lastInsertRowid)
}
