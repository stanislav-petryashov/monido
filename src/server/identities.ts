// Provider identities: the account at the family's OpenID Connect provider bound to a user, and one-time invitations to bind
// one. Sign-in state like `users`: journaled (never the invitation's hash) but never reverted, kept by a restore.
import { DbReadConflict, type Database, type PreparedStatement } from './db'
import { InputError, type Actor } from './http'
import { CHANGE_LOG_INSERT } from './rows'
import { randomId, sha256Hex } from './secrets'
import { INVITE_TTL_MS } from './users'

export interface Identity { id: number; userId: number; issuer: string; subject: string; linkedAt: string }
/** The account as the provider names it: its issuer, byte for byte, and its `sub` */
export interface ProviderAccount { issuer: string; subject: string }

interface Raw { id: number; user_id: number; issuer: string; subject: string; linked_at: string }
const toIdentity = (r: Raw): Identity => ({ id: Number(r.id), userId: Number(r.user_id), issuer: r.issuer, subject: r.subject, linkedAt: r.linked_at })

export async function findIdentity(db: Database, by: ProviderAccount | { userId: number }): Promise<Identity | null> {
  const raw = 'userId' in by
    ? await db.prepare('SELECT * FROM user_identities WHERE user_id = ?').bind(by.userId).first<Raw>()
    : await db.prepare('SELECT * FROM user_identities WHERE issuer = ? AND subject = ?').bind(by.issuer, by.subject).first<Raw>()
  return raw ? toIdentity(raw) : null
}

const ROW_JSON = "json_object('user_id', user_id, 'issuer', issuer, 'subject', subject, 'linked_at', linked_at)"
/** Who a binding is written as: the member bound, as the Telegram link is */
const memberActor = (db: Database, userId: number) => db.prepare('SELECT member FROM users WHERE id = ?').bind(userId).first<{ member: string }>()

/** The insert of a binding and its journal entry, written only if the insert changed a row */
function insertStatements(db: Database, author: string, userId: number, account: ProviderAccount, ts: string): PreparedStatement[] {
  return [
    db.prepare('INSERT OR IGNORE INTO user_identities (user_id, issuer, subject, linked_at) VALUES (?, ?, ?, ?)').bind(userId, account.issuer, account.subject, ts),
    db.prepare(`${CHANGE_LOG_INSERT} SELECT ?, ?, 'admin', 'user_identities', id, 'insert', NULL, ${ROW_JSON}, NULL FROM user_identities WHERE user_id = ? AND changes() > 0`)
      .bind(ts, author, userId),
  ]
}

/** The journal entry of a binding about to go, then its delete */
function deleteStatements(db: Database, actor: { name: string; source: Actor['source'] }, identity: Identity, ts: string): PreparedStatement[] {
  return [
    db.prepare(`${CHANGE_LOG_INSERT} SELECT ?, ?, ?, 'user_identities', id, 'delete', ${ROW_JSON}, NULL, NULL FROM user_identities WHERE id = ?`)
      .bind(ts, actor.name, actor.source, identity.id),
    db.prepare('DELETE FROM user_identities WHERE id = ?').bind(identity.id),
  ]
}

export type BindResult = { status: 'bound' | 'same'; linkedAt: string } | { status: 'taken' | 'already_bound' | 'expired' }

/**
 * Binds `account` to the user (a manager's test sign-in): `same` when it is theirs already (no write), `taken` when it is
 * another user's, `already_bound` when the user has another account of the same issuer, `expired` when `valid` turned false
 * or the rows changed meanwhile. A binding under another issuer (an old OIDC_ISSUER) is replaced.
 */
export async function bindIdentity(db: Database, userId: number, account: ProviderAccount, valid: () => boolean, now = new Date()): Promise<BindResult> {
  const read = db.readToken()
  const [mine, owner, member] = await Promise.all([findIdentity(db, { userId }), findIdentity(db, account), memberActor(db, userId)])
  if (!member) return { status: 'expired' }
  if (owner && owner.userId !== userId) return { status: 'taken' }
  if (owner) return { status: 'same', linkedAt: owner.linkedAt }
  if (mine && mine.issuer === account.issuer) return { status: 'already_bound' }
  const ts = now.toISOString()
  const statements = [...(mine ? deleteStatements(db, { name: member.member, source: 'admin' }, mine, ts) : []), ...insertStatements(db, member.member, userId, account, ts)]
  // no await between this check and the synchronous guarded commit
  if (!valid()) return { status: 'expired' }
  try {
    await db.guardedBatch(read, statements)
  } catch (error) {
    if (error instanceof DbReadConflict) return { status: 'expired' }
    throw error
  }
  return (await findIdentity(db, account))?.userId === userId ? { status: 'bound', linkedAt: ts } : { status: 'expired' }
}

/** Unbinds the user's account; 409 `last_manager` when they are the last manager bound under `lastManagerIssuer` (the provider mode's) */
export async function unbindIdentity(db: Database, userId: number, actor: Actor, rules: { lastManagerIssuer: string | null }, now = new Date()): Promise<void> {
  const read = db.readToken()
  const identity = await findIdentity(db, { userId })
  if (!identity) throw new InputError('identity_not_found', 404)
  if (rules.lastManagerIssuer !== null && identity.issuer === rules.lastManagerIssuer) {
    const other = await db.prepare(`SELECT 1 FROM users u JOIN user_identities i ON i.user_id = u.id
      WHERE u.can_manage = 1 AND i.issuer = ? AND u.id != ?`).bind(rules.lastManagerIssuer, userId).first()
    const manager = await db.prepare('SELECT can_manage FROM users WHERE id = ?').bind(userId).first<{ can_manage: number }>()
    if (manager?.can_manage && !other) throw new InputError('last_manager', 409)
  }
  try {
    await db.guardedBatch(read, deleteStatements(db, actor, identity, now.toISOString()))
  } catch (error) {
    // the rows changed while this was checked: the caller reloads and decides again
    if (error instanceof DbReadConflict) throw new InputError('draft_conflict', 409)
    throw error
  }
}

/** A one-time invitation to bind a provider account to the user; a new one replaces the previous. Only its sha256 is kept. */
export async function issueIdentityInvite(db: Database, userId: number, now = new Date()): Promise<{ code: string; expiresAt: string }> {
  if (!await db.prepare('SELECT 1 FROM users WHERE id = ?').bind(userId).first()) throw new InputError('user_not_found', 404)
  const code = randomId(16)
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString()
  await db.prepare(`INSERT INTO identity_invites (user_id, hash, expires_at) VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET hash = excluded.hash, expires_at = excluded.expires_at`).bind(userId, sha256Hex(code), expiresAt).run()
  return { code, expiresAt }
}

/** Whom a valid invitation is for; null for an unknown, used or expired code */
export async function identityInviteTarget(db: Database, code: string, now = new Date()): Promise<{ userId: number; member: string } | null> {
  const row = await db.prepare(`SELECT u.id, u.member FROM identity_invites v JOIN users u ON u.id = v.user_id WHERE v.hash = ? AND v.expires_at > ?`)
    .bind(sha256Hex(code), now.toISOString()).first<{ id: number; member: string }>()
  return row ? { userId: Number(row.id), member: row.member } : null
}

export type InviteAcceptance = { status: 'bound'; userId: number; linkedAt: string } | { status: 'invalid' } | { status: 'taken'; member: string } | { status: 'already_bound' }

/**
 * Accepts an invitation with the account the provider returned: binds it and uses the code in one guarded batch, only while
 * the invitation is valid and neither the user nor the account is bound (`taken` leaves the code for the right account); a
 * write between the checks and the commit (another accept) makes it `invalid`. A binding of the user under another issuer
 * is replaced.
 */
export async function acceptIdentityInvite(db: Database, code: string, account: ProviderAccount, now = new Date()): Promise<InviteAcceptance> {
  const read = db.readToken()
  const target = await identityInviteTarget(db, code, now)
  if (!target) return { status: 'invalid' }
  const owner = await findIdentity(db, account)
  if (owner && owner.userId !== target.userId) return { status: 'taken', member: (await memberActor(db, owner.userId))?.member ?? '' }
  const mine = await findIdentity(db, { userId: target.userId })
  if (mine && mine.issuer === account.issuer) return { status: 'already_bound' }
  const ts = now.toISOString()
  try {
    await db.guardedBatch(read, [
      db.prepare('DELETE FROM identity_invites WHERE user_id = ?').bind(target.userId),
      ...(mine ? deleteStatements(db, { name: target.member, source: 'admin' }, mine, ts) : []),
      ...insertStatements(db, target.member, target.userId, account, ts),
    ])
  } catch (error) {
    if (error instanceof DbReadConflict) return { status: 'invalid' }
    throw error
  }
  return { status: 'bound', userId: target.userId, linkedAt: ts }
}
