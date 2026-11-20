// Users: who may sign in and with which rights. Writes are journaled without the invite columns and the link time.
// An invite is a one-time code in a Telegram link; only its sha256 is stored (as the reminders pairing does).
import type { AuthMode, InviteLink, Rights } from '../domain/api'
import { DbReadConflict, type Database, type PreparedStatement } from './db'
import { randomId, sha256Hex } from './secrets'
import { InputError, plainObject, type Actor } from './http'
import { commitMutation } from './mutations'
import { CHANGE_LOG_INSERT, logStatement, rowJson, tableColumns, type Column } from './rows'
import { isPersonal, signInManagerSql, type SignInLink } from './signIn'

export interface UserRow {
  id: number
  member: string
  telegramId: string | null
  telegramSignIn: boolean
  telegramName: string | null
  rights: Rights
  invitePending: boolean
  /** ISO time the Telegram account was last linked; a credential issued before it was the previous link's. NULL — linked before it was kept */
  telegramLinkedAt: string | null
  /** ISO time the row was written: a session issued before it belonged to someone else (ids can be reused) */
  createdAt: string
  /** The provider account bound to the user: its issuer and when it was bound; null — none */
  identity: { issuer: string; linkedAt: string } | null
}

/** `link`: what lets a person sign in in `mode`; unset means the Telegram link in the telegram mode and none otherwise */
export interface UserRules { mode: AuthMode; link?: SignInLink | null }

export const ALL_RIGHTS: Rights = { edit: true, vote: true, manage: true }
const DEFAULT_RIGHTS: Rights = { edit: true, vote: true, manage: false }

const INVITE_TTL_MS = 7 * 24 * 3600_000
/**
 * Columns the journal never records: the invite (its hash is a secret) and the link time — sign-in bookkeeping like the
 * invite; the linking itself shows in the journal as the new telegram_id and updated_at.
 */
const UNJOURNALED_COLUMNS = ['invite_hash', 'invite_expires_at', 'telegram_linked_at']
const inviteHash = sha256Hex

interface Raw {
  id: number; member: string; telegram_id: string | null; telegram_name: string | null
  can_edit: number; can_vote: number; can_manage: number; invite_hash: string | null; invite_expires_at: string | null
  telegram_sign_in: number
  created_at: string; telegram_linked_at: string | null
  identity_issuer: string | null; identity_linked_at: string | null
}

const toRow = (r: Raw, now: Date): UserRow => ({
  id: r.id,
  member: r.member,
  telegramId: r.telegram_id,
  telegramSignIn: !!r.telegram_sign_in,
  telegramName: r.telegram_name,
  rights: { edit: !!r.can_edit, vote: !!r.can_vote, manage: !!r.can_manage },
  invitePending: !!r.invite_hash && !!r.invite_expires_at && r.invite_expires_at > now.toISOString(),
  telegramLinkedAt: r.telegram_linked_at,
  createdAt: r.created_at,
  identity: r.identity_issuer === null || r.identity_linked_at === null ? null : { issuer: r.identity_issuer, linkedAt: r.identity_linked_at },
})

/** A user with their provider identity (at most one: user_id is unique there) */
const USER_SELECT = 'SELECT u.*, i.issuer AS identity_issuer, i.linked_at AS identity_linked_at FROM users u LEFT JOIN user_identities i ON i.user_id = u.id'

export async function readUsers(db: Database): Promise<UserRow[]> {
  const { results } = await db.prepare(`${USER_SELECT} ORDER BY u.id`).all<Raw>()
  const now = new Date()
  return results.map(r => toRow(r, now))
}

export async function findUser(db: Database, by: { id: number } | { telegramId: string } | { member: string }): Promise<UserRow | null> {
  const [column, value] = 'id' in by ? ['id', by.id] : 'member' in by ? ['member', by.member] : ['telegram_id', by.telegramId]
  const raw = await db.prepare(`${USER_SELECT} WHERE u.${column} = ?`).bind(value).first<Raw>()
  return raw ? toRow(raw, new Date()) : null
}

/** A manager who can still sign in through `link` (by default with Telegram). */
export async function hasSignInManager(db: Database, link: SignInLink = { method: 'telegram' }): Promise<boolean> {
  const { sql, params } = signInManagerSql(link)
  return !!(await db.prepare(sql).bind(...params).first())
}

/** Whether `user` can sign in through `link` */
const signsInWith = (user: UserRow, link: SignInLink) =>
  link.method === 'telegram' ? !!user.telegramId && user.telegramSignIn : user.identity?.issuer === link.issuer

/**
 * The users as they will be after a change: someone who can sign in and manage, or — under the family password,
 * which still lets people in — none at all, or none as before (users added under the password without the right: their
 * rights stay editable). A family of personal accounts with no users could not sign in again.
 */
function assertManagerLeft(before: UserRow[], after: UserRow[], { mode, link }: UserRules): void {
  const personal = isPersonal(mode)
  if (!after.length && !personal) return
  const signIn = link ?? (mode === 'telegram' ? { method: 'telegram' } as const : null)
  const canSignIn = (u: UserRow) => !personal || (signIn !== null && signsInWith(u, signIn))
  const managing = (users: UserRow[]) => users.some(u => u.rights.manage && canSignIn(u))
  if (!personal && !managing(before)) return
  if (!managing(after)) throw new InputError('last_manager', 409)
}

function parseRights(value: unknown, base: Rights): Rights {
  if (value === undefined) return { ...base }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('invalid_value', 400, { column: 'rights' })
  const out = { ...base }
  for (const [key, v] of Object.entries(value)) {
    if (!Object.hasOwn(out, key) || typeof v !== 'boolean') throw new InputError('invalid_value', 400, { column: 'rights' })
    out[key as keyof Rights] = v
  }
  return out
}

/** Table columns for the journal: UNJOURNALED_COLUMNS never go there. */
async function journalColumns(db: Database): Promise<Column[]> {
  return (await tableColumns(db, 'users')).filter(c => !UNJOURNALED_COLUMNS.includes(c.name))
}

async function journalRow(db: Database, id: number, columns: Column[]): Promise<Record<string, unknown> | null> {
  const raw = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()
  if (!raw) return null
  return Object.fromEntries(columns.map(c => [c.name, raw[c.name]]))
}

export async function createUser(db: Database, body: unknown, actor: Actor, now = new Date()): Promise<UserRow> {
  const data = plainObject(body)
  if (typeof data.member !== 'string') throw new InputError('required_field', 400, { column: 'member' })
  if (!await db.prepare('SELECT 1 FROM members WHERE name = ?').bind(data.member).first()) throw new InputError('unknown_member', 400)
  if (await db.prepare('SELECT 1 FROM users WHERE member = ?').bind(data.member).first()) throw new InputError('user_exists', 409)
  const rights = parseRights(data.rights, DEFAULT_RIGHTS)
  const ts = now.toISOString()
  const columns = await journalColumns(db)
  // AUTOINCREMENT numbers the row, so a deleted user's id is never given again; the journal reads the new id in the same batch
  const after = `(SELECT ${rowJson(columns)} FROM users WHERE id = last_insert_rowid())`
  const [inserted] = await db.batch([
    db.prepare('INSERT INTO users (member, can_edit, can_vote, can_manage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(data.member, +rights.edit, +rights.vote, +rights.manage, ts, ts),
    db.prepare(`${CHANGE_LOG_INSERT} VALUES (?, ?, ?, 'users', last_insert_rowid(), 'insert', NULL, ${after}, NULL)`).bind(ts, actor.name, actor.source),
  ])
  const id = inserted.meta.last_row_id
  return (await findUser(db, { id }))!
}

export async function updateUser(db: Database, id: number, body: unknown, actor: Actor, ctx: UserRules, now = new Date()): Promise<UserRow> {
  const data = plainObject(body)
  // guarded: two managers demoted at once must not both pass the last-manager check
  await commitMutation(db, async () => {
    const user = await findUser(db, { id })
    if (!user) throw new InputError('user_not_found', 404)
    const rights = parseRights(data.rights, user.rights)
    const users = await readUsers(db)
    assertManagerLeft(users, users.map(u => u.id === id ? { ...u, rights } : u), ctx)
    const columns = await journalColumns(db)
    const before = await journalRow(db, id, columns)
    const ts = now.toISOString()
    return {
      statements: [
        db.prepare('UPDATE users SET can_edit = ?, can_vote = ?, can_manage = ?, updated_at = ? WHERE id = ?')
          .bind(+rights.edit, +rights.vote, +rights.manage, ts, id),
        logStatement(db, actor, { table: 'users', rowid: id, op: 'update', before, afterColumns: columns, ts }),
      ],
      result: undefined,
    }
  })
  return (await findUser(db, { id }))!
}

export async function deleteUser(db: Database, id: number, actor: Actor, ctx: UserRules, now = new Date()): Promise<void> {
  return commitMutation(db, async () => {
    if (!await findUser(db, { id })) throw new InputError('user_not_found', 404)
    const users = await readUsers(db)
    assertManagerLeft(users, users.filter(u => u.id !== id), ctx)
    const before = await journalRow(db, id, await journalColumns(db))
    return {
      statements: [
        db.prepare('DELETE FROM users WHERE id = ?').bind(id),
        logStatement(db, actor, { table: 'users', rowid: id, op: 'delete', before, afterColumns: null, ts: now.toISOString() }),
      ],
      result: undefined,
    }
  })
}

/** A new link replaces the previous one. */
export async function issueInvite(db: Database, id: number, botUsername: string, now = new Date()): Promise<InviteLink> {
  if (!await findUser(db, { id })) throw new InputError('user_not_found', 404)
  const code = randomId(16)
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString()
  await db.prepare('UPDATE users SET invite_hash = ?, invite_expires_at = ? WHERE id = ?').bind(inviteHash(code), expiresAt, id).run()
  return { link: `https://t.me/${botUsername}?start=link_${code}`, expiresAt }
}

/** An update entry for the row, written only if the statement before it changed a row. */
function guardedLog(db: Database, actor: Actor, rowid: number, before: Record<string, unknown> | null, columns: Column[], ts: string): PreparedStatement {
  const after = `(SELECT ${rowJson(columns)} FROM users WHERE id = ?)`
  return db.prepare(`${CHANGE_LOG_INSERT} SELECT ?, ?, ?, 'users', ?, 'update', ?, ${after}, NULL WHERE changes() > 0`)
    .bind(ts, actor.name, actor.source, rowid, before ? JSON.stringify(before) : null, rowid)
}

/** What opening an invite did: linked the account, found it linked to someone else (the code stays unused), or nothing. */
type InviteResult = { status: 'linked'; user: UserRow } | { status: 'linked_elsewhere'; member: string } | { status: 'invalid' }

/** The user other than `exceptId` whose Telegram account this is, if any. */
const linkedElsewhere = (db: Database, telegramId: string, exceptId: number) =>
  db.prepare('SELECT member FROM users WHERE telegram_id = ? AND id != ?').bind(telegramId, exceptId).first<{ member: string }>()

/**
 * Links the Telegram account to the invited user once and records the time (`telegram_linked_at`): the user's sessions
 * and Claude tokens from before it are dead. An unknown, used or expired code is `invalid`. An account linked
 * to another user is not moved: a manager opening someone's invite "to check it" would lose their own sign-in to it.
 */
export async function acceptInvite(db: Database, code: string, telegram: { id: string; name: string | null }, now = new Date()): Promise<InviteResult> {
  const ts = now.toISOString()
  const target = await db.prepare('SELECT id, member FROM users WHERE invite_hash = ? AND invite_expires_at > ?')
    .bind(inviteHash(code), ts).first<{ id: number; member: string }>()
  if (!target) return { status: 'invalid' }
  const owner = await linkedElsewhere(db, telegram.id, target.id)
  if (owner) return { status: 'linked_elsewhere', member: owner.member }
  const columns = await journalColumns(db)
  const actor: Actor = { name: target.member, source: 'admin', rights: ALL_RIGHTS, userId: target.id }
  const before = await journalRow(db, target.id, columns)
  // another accept may have won since the selects above (used the code, or linked this account elsewhere): nothing changes then
  const [linked] = await db.batch([
    // the link time ends every session and Claude token issued before it, even for the same account linked again
    db.prepare(`UPDATE users SET telegram_id = ?, telegram_name = ?, telegram_linked_at = ?, invite_hash = NULL, invite_expires_at = NULL, updated_at = ?
      WHERE id = ? AND invite_hash = ? AND invite_expires_at > ? AND NOT EXISTS (SELECT 1 FROM users WHERE telegram_id = ? AND id != ?)`)
      .bind(telegram.id, telegram.name, ts, ts, target.id, inviteHash(code), ts, telegram.id, target.id),
    guardedLog(db, actor, target.id, before, columns, ts),
  ])
  if (!linked.meta.changes) {
    const late = await linkedElsewhere(db, telegram.id, target.id)
    return late ? { status: 'linked_elsewhere', member: late.member } : { status: 'invalid' }
  }
  return { status: 'linked', user: (await findUser(db, { id: target.id }))! }
}

/** Link only the unchanged, unlinked profile selected by the password-authenticated manager. */
export async function linkSelectedUser(db: Database, target: UserRow, telegram: { id: string; name: string | null }, valid: () => boolean): Promise<boolean> {
  const read = db.readToken()
  const current = await findUser(db, { id: target.id })
  if (!current || current.createdAt !== target.createdAt || current.telegramId !== null || current.telegramLinkedAt !== target.telegramLinkedAt || !current.telegramSignIn || await linkedElsewhere(db, telegram.id, target.id)) return false
  const columns = await journalColumns(db)
  const before = await journalRow(db, target.id, columns)
  const ts = new Date().toISOString()
  const actor: Actor = { name: target.member, source: 'admin', rights: target.rights, userId: target.id }
  // No await between checking cancellation/runtime changes and the synchronous guarded commit.
  if (!valid()) return false
  try {
    await db.guardedBatch(read, [
      db.prepare('UPDATE users SET telegram_id = ?, telegram_name = ?, telegram_linked_at = ?, invite_hash = NULL, invite_expires_at = NULL, updated_at = ? WHERE id = ?')
        .bind(telegram.id, telegram.name, ts, ts, target.id),
      guardedLog(db, actor, target.id, before, columns, ts),
    ])
    return true
  } catch (error) {
    if (error instanceof DbReadConflict) return false
    throw error
  }
}
