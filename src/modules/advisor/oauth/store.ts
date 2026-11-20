// The connector's OAuth state on SQLite: the clients Claude registers (RFC 7591) and the tokens issued to them. A token
// is 32 random bytes, base64url, stored only as its SHA-256 hex; every authorization starts a chain of tokens that refresh
// rotation keeps, and a replayed code or a reused refresh token revokes the whole chain. A token also keeps the Telegram
// account its user consented with: it is live only while the user is still linked to that account, by a link made before
// the token (linked elsewhere and back, the old tokens stay dead). All times are ISO strings, compared as text.
import { createHash } from 'node:crypto'
import { randomId, sameSecret, sha256Hex } from '../../../server/secrets'
import type { SignInMode } from '../../../server/authSettings'
import type { Database } from '../../../server/db'
import { isConstraint } from '../../../server/http'
import type { CodeStore } from './pending'
import { isAllowedRedirect } from './redirects'

/** The one scope of the connector. */
export const SCOPE = 'advisor'
/** An access token lives an hour. */
const ACCESS_TTL_MS = 3_600_000
/** A refresh token lives 30 days and is replaced on every use. */
const REFRESH_TTL_MS = 30 * 24 * 3_600_000
/**
 * At most this many client registrations per client address (IPv6 by /48) within REGISTRATION_WINDOW_MS. No server-wide ceiling: strangers
 * from many addresses would only block the family's connector with it; MAX_CLIENTS and the eviction bound storage.
 */
const REGISTRATIONS_PER_KEY = 5
const REGISTRATION_WINDOW_MS = 3_600_000
/** The most client addresses the registration limiter remembers; when full, the oldest goes. */
const REGISTRATION_KEYS_MAX = 10_000
/** At most this many registered clients. */
const MAX_CLIENTS = 50
/**
 * At the cap, the oldest client with no live token, older than this and not referenced by a pending request or a code,
 * is evicted for the new one: a pending authorization lives 10 minutes.
 */
const EVICTABLE_AFTER_MS = 10 * 60_000
/** A token row is deleted this long after it expired; until then a reused rotated refresh token is still recognised. */
const TOKEN_ROW_KEEP_MS = REFRESH_TTL_MS
/** The registration's limits on what it stores. */
const MAX_REDIRECT_URIS = 10
const CLIENT_NAME_MAX = 100
/** RFC 7636: 43–128 unreserved characters. */
const CODE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/
/** The shape of a token this server issues; anything else is not looked up. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/
/** The grant and response types the connector registers and announces. */
export const GRANT_TYPES = ['authorization_code', 'refresh_token'] as const
export const RESPONSE_TYPES = ['code'] as const

/** An RFC 6749 / RFC 7591 error: `code` is the `error` field of the JSON answer, `status` its HTTP status. */
export class OAuthError extends Error {
  readonly code: string
  readonly status: number
  /** `error_description`: English for developers, never shown to the family */
  readonly description?: string
  constructor(code: string, status: number, description?: string) {
    super(description ?? code)
    this.name = 'OAuthError'
    this.code = code
    this.status = status
    this.description = description
  }
}

export interface RegisteredClient {
  client_id: string
  client_name?: string
  redirect_uris: string[]
  token_endpoint_auth_method: 'none'
  grant_types: typeof GRANT_TYPES
  response_types: typeof RESPONSE_TYPES
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: 'Bearer'
  expires_in: 3600
  scope: typeof SCOPE
}

export interface Connection { userId: number; clients: number; lastIssuedAt: string }

const newToken = () => randomId(32)
const iso = (now: Date, plusMs = 0) => new Date(now.getTime() + plusMs).toISOString()

const metadataError = (description: string) => new OAuthError('invalid_client_metadata', 400, description)
const invalidGrant = (description: string) => new OAuthError('invalid_grant', 400, description)
const invalidRequest = (description: string) => new OAuthError('invalid_request', 400, description)

/** A list of allowed strings when present: absent is the default, anything else is refused. */
function checkList(body: Record<string, unknown>, field: string, allowed: readonly string[]): void {
  const value = body[field]
  if (value === undefined) return
  if (!Array.isArray(value) || value.length === 0 || value.some(v => typeof v !== 'string' || !allowed.includes(v))) {
    throw metadataError(`${field} must be a list of ${allowed.join(', ')}`)
  }
}

/** A display name: plain text up to CLIENT_NAME_MAX characters, no control or format characters (bidi overrides, zero-width). */
function clientName(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw metadataError('client_name must be a string')
  const name = value.trim()
  if (name.length === 0) return null
  if (name.length > CLIENT_NAME_MAX || /[\p{Cc}\p{Cf}]/u.test(name)) throw metadataError('client_name is too long or not plain text')
  return name
}

/** In-memory registration counters (a restart resets them, like the login limiter). */
export interface RegistrationLimiter {
  /** Takes a slot for this client address at `now`: false when the address is at its hourly limit */
  take(key: string, now: Date): boolean
}

/** A sliding window of REGISTRATION_WINDOW_MS: REGISTRATIONS_PER_KEY per client address. */
export function createRegistrationLimiter(
  { perKey = REGISTRATIONS_PER_KEY, windowMs = REGISTRATION_WINDOW_MS, maxKeys = REGISTRATION_KEYS_MAX } = {},
): RegistrationLimiter {
  // Map order is insertion order: a key is reinserted on every registration, so the first key is the least recent
  const byKey = new Map<string, number[]>()
  const recent = (times: number[] | undefined, since: number) => (times ?? []).filter(t => t > since)
  return {
    take(key, now) {
      const t = now.getTime()
      const since = t - windowMs
      const mine = recent(byKey.get(key), since)
      byKey.delete(key)
      if (mine.length >= perKey) {
        if (mine.length > 0) byKey.set(key, mine)
        return false
      }
      if (byKey.size >= maxKeys) {
        for (const [k, times] of [...byKey]) if (recent(times, since).length === 0) byKey.delete(k)
        while (byKey.size >= maxKeys) byKey.delete(byKey.keys().next().value!)
      }
      byKey.set(key, [...mine, t])
      return true
    },
  }
}

export interface RegistrationContext {
  /** The client address as `limiterKey(clientAddress(…), 48)` gives it (IPv6 by /48) */
  clientKey: string
  limiter: RegistrationLimiter
  /** Clients of live pending requests and codes (`PendingStore.clientIds`, `CodeStore.clientIds`): never evicted */
  referenced: Iterable<string>
}

/**
 * Dynamic Client Registration (RFC 7591) of a public client: `redirect_uris` only from `isAllowedRedirect`
 * (else `invalid_redirect_uri`), `token_endpoint_auth_method` only `none`, `grant_types` and `response_types` only those of
 * the code flow (else `invalid_client_metadata`). A valid registration takes a slot of the limiter (REGISTRATIONS_PER_KEY
 * an hour per client address; else 429 `temporarily_unavailable`). At MAX_CLIENTS clients the
 * oldest one without a live token, older than EVICTABLE_AFTER_MS and not `referenced`, makes room; if none can, 429
 * `temporarily_unavailable`. The eviction, the count and the insert are one transaction with no await inside, so
 * registrations at once cannot pass the cap.
 */
export async function registerClient(db: Database, body: unknown, now: Date, ctx: RegistrationContext): Promise<RegisteredClient> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw metadataError('the body must be a JSON object')
  const fields = body as Record<string, unknown>
  const uris = fields.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS || uris.some(u => typeof u !== 'string')) {
    throw new OAuthError('invalid_redirect_uri', 400, 'redirect_uris must be a list of URIs')
  }
  const redirectUris = [...new Set(uris as string[])]
  if (!redirectUris.every(isAllowedRedirect)) throw new OAuthError('invalid_redirect_uri', 400, 'only Claude\'s callback URIs are allowed')
  if (fields.token_endpoint_auth_method !== undefined && fields.token_endpoint_auth_method !== 'none') {
    throw metadataError('only public clients (token_endpoint_auth_method none)')
  }
  checkList(fields, 'grant_types', GRANT_TYPES)
  checkList(fields, 'response_types', RESPONSE_TYPES)
  const name = clientName(fields.client_name)
  if (!ctx.limiter.take(ctx.clientKey, now)) throw new OAuthError('temporarily_unavailable', 429, 'too many registrations this hour')

  const ts = now.toISOString()
  const clientId = randomId(16)
  const results = await db.batch([
    db.prepare(`DELETE FROM oauth_clients WHERE (SELECT COUNT(*) FROM oauth_clients) >= ? AND client_id = (
        SELECT c.client_id FROM oauth_clients c
        WHERE c.created_at < ? AND c.client_id NOT IN (SELECT value FROM json_each(?))
          AND NOT EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.client_id = c.client_id AND t.revoked_at IS NULL AND t.expires_at > ?)
        ORDER BY c.created_at, c.rowid LIMIT 1)`)
      .bind(MAX_CLIENTS, iso(now, -EVICTABLE_AFTER_MS), JSON.stringify([...ctx.referenced]), ts),
    db.prepare(`INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at)
        SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM oauth_clients) < ?`)
      .bind(clientId, name, JSON.stringify(redirectUris), ts, MAX_CLIENTS),
  ])
  if (results[1].meta.changes !== 1) throw new OAuthError('temporarily_unavailable', 429, 'too many registered clients')
  return {
    client_id: clientId,
    ...(name === null ? {} : { client_name: name }),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: GRANT_TYPES,
    response_types: RESPONSE_TYPES,
  }
}

export async function findClient(db: Database, clientId: string): Promise<{ clientId: string; clientName: string | null; redirectUris: string[] } | null> {
  const row = await db.prepare('SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?')
    .bind(clientId).first<{ client_id: string; client_name: string | null; redirect_uris: string }>()
  if (!row) return null
  return { clientId: row.client_id, clientName: row.client_name, redirectUris: JSON.parse(row.redirect_uris) as string[] }
}

/** `telegramId` — the user's Telegram account at consent: linking the user to another account ends the chain. */
interface ChainGrant { clientId: string; userId: number; telegramId: string; chainId: string }

/** A family token (family-password sign-in): no user has id 0. */
export const FAMILY_USER_ID = 0
/** A family token's `telegram_id`: the sign-in generation it was approved at; a password change, reset or switch bumps it. */
export const familyMarker = (generation: number): string => `family:${generation}`

const IDENTITY_KEY_PREFIX = 'oidc:'
/** A person's token in the provider mode keeps, in `telegram_id`, the key of the provider binding it was approved through */
export const identityKey = (identityId: number): string => `${IDENTITY_KEY_PREFIX}${identityId}`

/** The sign-in a token is checked against, read per request. `fallback` — Telegram is stored but no manager is linked. */
export interface LiveAuth { mode: SignInMode; generation: number; fallback: boolean }

/**
 * Whether a token of this kind may act now: a family token only with the family password (not the fallback) at its own
 * generation; a person's token only with Telegram sign-in.
 */
function kindLive(userId: number, telegramId: string, live: LiveAuth): boolean {
  if (userId === FAMILY_USER_ID) return live.mode === 'password' && !live.fallback && telegramId === familyMarker(live.generation)
  // a person's token belongs to the link it was approved through: a provider account's key never reads as a Telegram id
  const provider = telegramId.startsWith(IDENTITY_KEY_PREFIX)
  return userId > 0 && (live.mode === 'oidc' ? provider : live.mode === 'telegram' && !provider)
}

/** The two inserts of a new access + refresh pair; `onlyAfterClaim` makes each insert happen only if the statement before it changed a row. */
function pairStatements(db: Database, grant: ChainGrant, now: Date, onlyAfterClaim: boolean) {
  const access = newToken()
  const refresh = newToken()
  const guard = onlyAfterClaim ? ' WHERE changes() = 1' : ''
  const insert = (token: string, kind: 'access' | 'refresh', ttlMs: number) =>
    db.prepare(`INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, telegram_id, chain_id, expires_at, created_at, revoked_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL${guard}`)
      .bind(sha256Hex(token), kind, grant.clientId, grant.userId, grant.telegramId, grant.chainId, iso(now, ttlMs), now.toISOString())
  const response: TokenResponse = { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, scope: SCOPE }
  return { statements: [insert(access, 'access', ACCESS_TTL_MS), insert(refresh, 'refresh', REFRESH_TTL_MS)], response }
}

/** Rows that expired long ago: not needed for reuse detection any more. */
const pruneStatement = (db: Database, now: Date) =>
  db.prepare('DELETE FROM oauth_tokens WHERE expires_at < ?').bind(iso(now, -TOKEN_ROW_KEEP_MS))

/**
 * A new access + refresh pair in the grant's chain. The statements are sent at once, with no await before them: called
 * right after a code is taken, nothing can run in between (a replay revoking the chain sees these rows).
 */
export async function issueTokens(db: Database, grant: ChainGrant, now: Date): Promise<TokenResponse> {
  const { statements, response } = pairStatements(db, grant, now, false)
  await clientMustExist(db.batch([pruneStatement(db, now), ...statements]))
  return response
}

/** The token insert's foreign key failed: the client was removed meanwhile, which is `invalid_client`, not a server error. */
async function clientMustExist<T>(write: Promise<T>): Promise<T> {
  try { return await write } catch (err) {
    if (isConstraint(err) && /FOREIGN KEY/i.test(String(err))) throw new OAuthError('invalid_client', 400, 'unknown client')
    throw err
  }
}

/** Revokes every live token of a chain. */
const revokeChain = (db: Database, chainId: string, now: Date) =>
  db.prepare('UPDATE oauth_tokens SET revoked_at = ? WHERE chain_id = ? AND revoked_at IS NULL').bind(now.toISOString(), chainId).run()

/** One value of a form: absent is null, a repeated parameter is invalid_request (RFC 6749 §3.2). */
function param(body: URLSearchParams, name: string): string | null {
  const values = body.getAll(name)
  if (values.length > 1) throw invalidRequest(`${name} is repeated`)
  return values.length === 1 && values[0] !== '' ? values[0] : null
}

function required(body: URLSearchParams, name: string): string {
  const value = param(body, name)
  if (value === null) throw invalidRequest(`${name} is required`)
  return value
}

function checkGrantType(body: URLSearchParams, expected: string): void {
  if (required(body, 'grant_type') !== expected) throw new OAuthError('unsupported_grant_type', 400)
}

/** RFC 8707: a `resource` given in a token request must be this server's MCP URL. */
function resourceMatches(body: URLSearchParams, resource: string): boolean {
  const given = param(body, 'resource')
  return given === null || given === resource
}

/**
 * The authorization-code grant (`grant_type=authorization_code`, `code`, `code_verifier`, `client_id`, `redirect_uri`, an
 * optional `resource` that must equal `resource`) → a token pair. A malformed request is `invalid_request` and leaves the
 * code; an unknown client is `invalid_client`. Otherwise the code is spent first, so a wrong verifier, client, redirect URI
 * or resource, an expired or unknown code are all `invalid_grant` and the code cannot be tried again; a code taken before
 * (a replay) also revokes every token issued from it.
 */
export async function exchangeCode(db: Database, codes: CodeStore, body: URLSearchParams, now: Date, resource: string, live: LiveAuth): Promise<TokenResponse> {
  checkGrantType(body, 'authorization_code')
  const code = required(body, 'code')
  const verifier = required(body, 'code_verifier')
  const clientId = required(body, 'client_id')
  const redirectUri = required(body, 'redirect_uri')
  param(body, 'resource')
  if (!CODE_VERIFIER.test(verifier)) throw invalidRequest('code_verifier must be 43-128 unreserved characters')
  if (!await findClient(db, clientId)) throw new OAuthError('invalid_client', 400, 'unknown client')

  // from here to the token inserts nothing awaits: a replay of this code cannot slip in before the tokens exist
  const grant = codes.take(code)
  if (!grant) {
    const chain = codes.spentChain(code)
    if (chain !== null) await revokeChain(db, chain, now)
    throw invalidGrant('the code is unknown, expired or used')
  }
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const matches = [
    sameSecret(challenge, grant.codeChallenge),
    grant.clientId === clientId,
    grant.redirectUri === redirectUri,
    resourceMatches(body, resource),
  ]
  if (matches.includes(false)) throw invalidGrant('the code does not match this request')
  // approved in another sign-in (before a password change, a reset or a switch): its tokens would never act
  if (grant.generation !== live.generation || !kindLive(grant.userId, grant.telegramId, live)) throw invalidGrant('the sign-in changed since the consent')
  return issueTokens(db, grant, now)
}

/** `linked` — 1 while the token's user is still linked to the account (Telegram, or provider binding) the token was issued through, by a link made before the token. */
interface TokenRow {
  kind: string; client_id: string; user_id: number; telegram_id: string; chain_id: string; expires_at: string; revoked_at: string | null
  linked: number
}

/**
 * The join of a live token: its user exists and is linked to the Telegram account the token was issued to, by a link made
 * strictly before the token (a real token needs a session after its link, never in the same millisecond; NULL — linked
 * before the link time was kept). ISO strings of toISOString's 24 characters compare as text; any other value fails
 * closed, as an unreadable time does in actorOfUser.
 */
const SAME_ACCOUNT = `users u ON u.id = t.user_id AND (
  (u.telegram_id = t.telegram_id AND (u.telegram_linked_at IS NULL OR (length(u.telegram_linked_at) = 24 AND u.telegram_linked_at < t.created_at)))
  OR EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND '${IDENTITY_KEY_PREFIX}' || i.id = t.telegram_id
    AND length(i.linked_at) = 24 AND i.linked_at < t.created_at))`

const tokenRow = (db: Database, token: string) =>
  db.prepare(`SELECT t.kind, t.client_id, t.user_id, t.telegram_id, t.chain_id, t.expires_at, t.revoked_at, u.id IS NOT NULL AS linked
      FROM oauth_tokens t LEFT JOIN ${SAME_ACCOUNT} WHERE t.token_hash = ?`)
    .bind(sha256Hex(token)).first<TokenRow>()

/**
 * The refresh grant (`grant_type=refresh_token`, `refresh_token`, optional `client_id` and `resource`) → a new pair in the
 * same chain; the refresh token used is revoked at once. A dead token is `invalid_grant`: unknown, expired, an access
 * token, or a wrong resource. A revoked one (a rotated token used again: a stolen copy), one presented by another client,
 * one whose user is gone or no longer linked to the Telegram account it was issued to, or was linked again (to any
 * account, the same one included) at or after the token was issued, or one that loses a race with another use of itself
 * revokes the whole chain, the newest pair included.
 */
export async function refreshTokens(db: Database, body: URLSearchParams, now: Date, resource: string, live: LiveAuth): Promise<TokenResponse> {
  checkGrantType(body, 'refresh_token')
  const token = required(body, 'refresh_token')
  const clientId = param(body, 'client_id')
  param(body, 'resource')
  const row = TOKEN_SHAPE.test(token) ? await tokenRow(db, token) : null
  const ts = now.toISOString()
  if (!row || row.kind !== 'refresh') throw invalidGrant('unknown refresh token')
  if (row.revoked_at !== null || (clientId !== null && clientId !== row.client_id)) {
    await revokeChain(db, row.chain_id, now)
    throw invalidGrant('the refresh token was revoked')
  }
  // the other sign-in's token: refused, its chain kept (a person's may act again only if the family is never asked; see revokePersonTokens)
  if (!kindLive(row.user_id, row.telegram_id, live)) throw invalidGrant('the token belongs to another sign-in')
  if (row.user_id !== FAMILY_USER_ID && !row.linked) {
    await revokeChain(db, row.chain_id, now)
    throw invalidGrant('the user is no longer linked to the Telegram account the token was issued to')
  }
  if (row.expires_at <= ts) throw invalidGrant('the refresh token expired')
  if (!resourceMatches(body, resource)) throw invalidGrant('wrong resource')

  // the claim and the new pair in one transaction: the pair is written only if this request revoked the old token itself
  const grant = { clientId: row.client_id, userId: row.user_id, telegramId: row.telegram_id, chainId: row.chain_id }
  const { statements, response } = pairStatements(db, grant, now, true)
  // the prune goes first: each insert's changes() guard looks at the statement just before it (the claim, then the access insert);
  // it never deletes the token claimed, which has not expired
  const results = await clientMustExist(db.batch([
    pruneStatement(db, now),
    db.prepare("UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ? AND kind = 'refresh' AND revoked_at IS NULL AND expires_at > ?")
      .bind(ts, sha256Hex(token), ts),
    ...statements,
  ]))
  if (results[3].meta.changes !== 1) {
    // another request used the same token in between: one of them holds a stolen copy
    await revokeChain(db, row.chain_id, now)
    throw invalidGrant('the refresh token was revoked')
  }
  return response
}

/** RFC 7009: revokes the token's whole chain (access or refresh); an unknown token is no error. */
export async function revokeToken(db: Database, token: string, now: Date): Promise<void> {
  if (!TOKEN_SHAPE.test(token)) return
  const row = await tokenRow(db, token)
  if (row) await revokeChain(db, row.chain_id, now)
}

/** Revokes every chain of the user: the user disconnects Claude, or is deleted. */
export async function revokeUser(db: Database, userId: number, now: Date): Promise<void> {
  await db.prepare('UPDATE oauth_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now.toISOString(), userId).run()
}

/**
 * The user and client of a live access token: known by its hash, not expired, not revoked, its user still linked to the
 * Telegram account it was issued to by a link made before the token; else null. The token's `createdAt` is for the caller's user checks (a user re-created
 * after the token makes it dead).
 */
export async function verifyAccessToken(db: Database, token: string, now: Date, live: LiveAuth): Promise<{ userId: number; family: boolean; clientId: string; createdAt: string } | null> {
  if (!TOKEN_SHAPE.test(token)) return null
  const row = await db.prepare(`SELECT t.user_id, t.telegram_id, t.client_id, t.created_at, u.id IS NOT NULL AS linked FROM oauth_tokens t LEFT JOIN ${SAME_ACCOUNT}
      WHERE t.token_hash = ? AND t.kind = 'access' AND t.revoked_at IS NULL AND t.expires_at > ?`)
    .bind(sha256Hex(token), now.toISOString()).first<{ user_id: number; telegram_id: string; client_id: string; created_at: string; linked: number }>()
  if (!row || !kindLive(Number(row.user_id), row.telegram_id, live)) return null
  const family = Number(row.user_id) === FAMILY_USER_ID
  if (!family && !row.linked) return null
  return { userId: Number(row.user_id), family, clientId: row.client_id, createdAt: row.created_at }
}

/** Every live token of a person (the family's stay): a sign-in switch disconnects everyone who connected through Telegram. */
export async function revokePersonTokens(db: Database, now: Date): Promise<void> {
  await db.prepare('UPDATE oauth_tokens SET revoked_at = ? WHERE user_id <> ? AND revoked_at IS NULL').bind(now.toISOString(), FAMILY_USER_ID).run()
}

/**
 * The users with a live refresh token, issued to the Telegram account they are linked to now and after that link was
 * made: how many clients, and when the newest of those tokens was issued; by user id.
 */
export async function listConnections(db: Database, now: Date, of: { kind: 'person' } | { kind: 'family'; marker: string }): Promise<Connection[]> {
  const live = "t.kind = 'refresh' AND t.revoked_at IS NULL AND t.expires_at > ?"
  const query = of.kind === 'person'
    ? db.prepare(`SELECT t.user_id, COUNT(DISTINCT t.client_id) AS clients, MAX(t.created_at) AS last_issued_at
        FROM oauth_tokens t JOIN ${SAME_ACCOUNT} WHERE ${live} GROUP BY t.user_id ORDER BY t.user_id`).bind(now.toISOString())
    : db.prepare(`SELECT t.user_id, COUNT(DISTINCT t.client_id) AS clients, MAX(t.created_at) AS last_issued_at
        FROM oauth_tokens t WHERE ${live} AND t.user_id = ? AND t.telegram_id = ? GROUP BY t.user_id`).bind(now.toISOString(), FAMILY_USER_ID, of.marker)
  const { results } = await query.all<{ user_id: number; clients: number; last_issued_at: string }>()
  return results.map(r => ({ userId: Number(r.user_id), clients: Number(r.clients), lastIssuedAt: r.last_issued_at }))
}
