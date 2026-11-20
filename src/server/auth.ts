// Sign-in: a cookie session from the family password or from a confirm in the bot. The mode is
// the live one of the sign-in runtime (authSettings.ts), read per request, so a switch needs no re-mount.
import { telegramPreferences } from './familyTelegram'
import { randomBytes, createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isIP, isIPv6 } from 'node:net'
import path from 'node:path'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { getConnInfo } from '@hono/node-server/conninfo'
import { secureCookies, type AppConfig, type OidcConfig } from './config'
import { FALLBACK_LANGUAGE, type Language } from '../i18n/languages'
import type { Me, SetupState } from '../domain/api'
import type { Database } from './db'
import { ALL_RIGHTS, findUser, linkSelectedUser, type UserRow } from './users'
import { isPersonal, type SignInLink } from './signIn'
import { acceptIdentityInvite, bindIdentity, findIdentity, identityInviteTarget } from './identities'
import { newChecks, OidcFailure, safeReturn, type OidcChecks, type OidcClient, type OidcFailureCode, type ProviderAnswer } from './oidc'
import { errorJson, field, guard, isApiPath, json, readJson, type Actor } from './http'
import { createLoginAttempts, type LoginAttempts, type LoginTarget } from './loginAttempts'
import type { AuthRuntime } from './authSettings'

const SESSION_COOKIE = 'session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** The browser's half of a sign-in through the bot: `${code}.${secret}`, as long as the attempt lives */
const LOGIN_COOKIE = 'login'
const LOGIN_TTL_S = 5 * 60
/**
 * The switch ticket: a test sign-in through the bot completed in password mode, `${userId}.${approvedAt}`, path-scoped to
 * /api/auth-settings; the switch to Telegram sign-in needs it younger than SWITCH_TTL_MS
 */
export const SWITCH_COOKIE = 'switch'
/** Bind switch proof to the configured bot without exposing its token. */
export const switchBotKey = (auth: AuthRuntime) => createHash('sha256').update(auth.botToken() ?? '').digest('hex')
export const SWITCH_TTL_MS = 10 * 60_000
/** Bind a provider switch ticket to the configured provider (issuer and client), as the Telegram one is to the bot. */
export const oidcSwitchKey = (oidc: Pick<OidcConfig, 'issuer' | 'clientId'>) => createHash('sha256').update(`${oidc.issuer}\n${oidc.clientId}`).digest('hex')
/**
 * The provider switch ticket: `oidc.${userId}.${approvedAt}.${key}.${name}`, the name the provider gave in base64url
 * (shown as "confirmed as"); the Telegram ticket keeps its own shape.
 */
export const OIDC_TICKET = /^oidc\.(\d+)\.(\d+)\.([a-f0-9]+)\.([A-Za-z0-9_-]*)$/
/** The anonymous family behind the shared password; also the author of the bootstrap's writes */
const PASSWORD_ACTOR: Actor = { name: 'family', source: 'admin', rights: ALL_RIGHTS, userId: null }
/** Claude acting for the family (a family token, or monido-mcp with no members yet): data entry only; proposals need a person */
export const FAMILY_MCP_ACTOR: Actor = { name: 'family', source: 'mcp', rights: { edit: true, vote: false, manage: false }, userId: null }
/** The author of edits inside a demo sandbox: the visitor is anonymous */
const DEMO_ACTOR: Actor = { name: 'demo', source: 'admin', rights: ALL_RIGHTS, userId: null }

export type AuthVariables = { actor: Actor }

export interface LoginLimiter {
  blocked(key: string): boolean
  /** `global: false` counts only against the key: for calls that guess no secret, so they cannot lock everyone out */
  fail(key: string, global?: boolean): void
  reset(key: string): void
}

interface LoginLimiterOptions {
  /** failures from one key within the window before that key gets 429 */
  limit?: number
  windowMs?: number
  now?: () => number
  /** keys kept at most; the oldest is evicted */
  maxKeys?: number
  /** failures from all keys together within one window before everyone gets 429 */
  globalLimit?: number
}

type Window = { start: number; failures: number }

/**
 * Failed sign-ins per client key (see limiterKey): `limit` failures within the window mean 429 for that key until
 * its window ends. At most `maxKeys` keys are kept; expired windows are pruned on access, then the oldest key goes.
 * A ceiling across all keys bounds the total: `globalLimit` failures in one window block everyone until it ends,
 * so many addresses cannot make many guesses.
 */
export function createLoginLimiter(
  { limit = 10, windowMs = 60_000, now = Date.now, maxKeys = 10_000, globalLimit = 100 }: LoginLimiterOptions = {},
): LoginLimiter {
  // Map order is insertion order: a key is reinserted when its window starts again, so the first key is the oldest
  const windows = new Map<string, Window>()
  let all: Window | undefined
  const expired = (w: Window) => now() - w.start >= windowMs
  const live = (key: string) => {
    const w = windows.get(key)
    if (w && expired(w)) { windows.delete(key); return undefined }
    return w
  }
  const liveAll = () => (all && expired(all) ? (all = undefined) : all)
  return {
    blocked: key => (liveAll()?.failures ?? 0) >= globalLimit || (live(key)?.failures ?? 0) >= limit,
    fail: (key, global = true) => {
      if (global) {
        const total = liveAll()
        if (total) total.failures++
        else all = { start: now(), failures: 1 }
      }
      const w = live(key)
      if (w) { w.failures++; return }
      if (windows.size >= maxKeys) {
        for (const k of windows.keys()) live(k)
        if (windows.size >= maxKeys) windows.delete(windows.keys().next().value!)
      }
      windows.set(key, { start: now(), failures: 1 })
    },
    reset: key => { windows.delete(key) },
  }
}

/** The eight 16-bit groups of a valid IPv6 address (a trailing dotted IPv4 becomes the last two). */
function ipv6Groups(address: string): number[] {
  const parse = (part: string) => (part ? part.split(':') : []).flatMap(g => {
    if (!g.includes('.')) return [parseInt(g, 16)]
    const [a, b, c, d] = g.split('.').map(Number)
    return [(a << 8) | b, (c << 8) | d]
  })
  const [head, tail] = address.split('::')
  if (tail === undefined) return parse(head)
  const left = parse(head)
  const right = parse(tail)
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right]
}

/**
 * The limiter's key for an address: an IPv4-mapped IPv6 (::ffff:a.b.c.d) is the plain IPv4, any other IPv6 is its
 * /64 (one subscriber usually holds a whole /64, so per-/128 keys would give one attacker 2^64 counters), or its /48
 * with `prefix` 48 (a site's usual allocation; the Telegram attempts store ranks clients by it for eviction).
 */
export function limiterKey(address: string, prefix: 48 | 64 = 64): string {
  const bare = address.split('%')[0]
  if (!isIPv6(bare)) return address
  const groups = ipv6Groups(bare)
  if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.')
  }
  return `${groups.slice(0, prefix / 16).map(g => g.toString(16)).join(':')}::/${prefix}`
}

const MAX_ADDRESS_LENGTH = 64

/**
 * The client address: the rightmost CLIENT_IP_HEADER entry (the address the proxy itself saw), else the socket
 * address, else 'unknown'. Behind a proxy without the header every client shares the proxy's address.
 */
export function clientAddress(c: Context, config: AppConfig): string {
  const forwarded = config.clientIpHeader ? c.req.header(config.clientIpHeader)?.split(',').at(-1)?.trim() : undefined
  // longer than any textual IP address (45 characters): a junk header must not become a huge limiter key
  if (forwarded) return forwarded.length <= MAX_ADDRESS_LENGTH ? forwarded : 'unknown'
  try {
    return getConnInfo(c).remote.address || 'unknown'
  } catch {
    // no Node socket (app.request in tests)
    return 'unknown'
  }
}

/**
 * The cookie signing key: from the environment, else DATA_DIR/session.key (created once, 0600; an empty file counts as none).
 * The file is created with the wx flag: if two processes start at once, the second takes the first one's key instead of overwriting it.
 */
export function loadSessionSecret(config: AppConfig): string {
  if (config.sessionSecret) return config.sessionSecret
  const file = path.join(config.dataDir, 'session.key')
  const exists = existsSync(file)
  const stored = exists ? readFileSync(file, 'utf8').trim() : ''
  if (stored) return stored
  mkdirSync(config.dataDir, { recursive: true })
  const secret = randomBytes(32).toString('hex')
  try {
    // an empty file is overwritten; a new file must not exist before us
    writeFileSync(file, secret, { mode: 0o600, flag: exists ? 'w' : 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    const raced = readFileSync(file, 'utf8').trim()
    if (raced) return raced
    throw new Error(`${file} was created by another process but is empty; restart the server`, { cause: err })
  }
  return secret
}

/**
 * The session cookie's value: `${issuedAt}` in password mode, `${userId}.${issuedAt}` in telegram mode. The key is
 * the runtime's signingKey() — the mode and the generation in it, so one mode's cookie is never valid in the other and a
 * password change or a mode switch voids every session issued before.
 */
async function readSession(c: Context, key: string): Promise<{ userId: number | null; issuedAt: number } | null> {
  const value = await getSignedCookie(c, key, SESSION_COOKIE)
  const parts = value ? /^(?:(\d+)\.)?(\d+)$/.exec(value) : null
  if (!parts) return null
  const issuedAt = Number(parts[2])
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt >= SESSION_TTL_MS) return null
  return { userId: parts[1] === undefined ? null : Number(parts[1]), issuedAt }
}

const sessionCookie = (config: AppConfig, maxAge: number) =>
  ({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge, secure: secureCookies(config) }) as const

/** Sets the session cookie (shared by issueSession and the Telegram poll). */
async function setSession(c: Context, config: AppConfig, key: string, value: string): Promise<void> {
  await setSignedCookie(c, SESSION_COOKIE, value, key, sessionCookie(config, SESSION_TTL_MS / 1000))
}

/**
 * A fresh session cookie for the caller in the live mode, signed with the current key: `${issuedAt}` for the family
 * password (`user` null), `${userId}.${issuedAt}` for a telegram-mode user. A user outside telegram mode, or no user in
 * it, is a programming error and throws.
 */
export async function issueSession(c: Context, auth: AuthRuntime, config: AppConfig, user: { userId: number } | null): Promise<void> {
  const mode = auth.mode()
  if (user === null && isPersonal(mode)) throw new Error(`a ${mode}-mode session needs a user`)
  if (user !== null && !isPersonal(mode)) throw new Error(`a session for a user needs a personal-account mode, the mode is ${mode}`)
  await setSession(c, config, auth.signingKey(), user === null ? `${Date.now()}` : `${user.userId}.${Date.now()}`)
}

const userActor = (user: UserRow, source: Actor['source'] = 'admin'): Actor => ({ name: user.member, source, rights: user.rights, userId: user.id })

/**
 * The actor of a telegram-mode credential (a session, or the connector's access token) issued to `userId` at `issuedAt`
 * (ms), read from the database every time; null when the user is gone, has no Telegram linked any more (an unlinked
 * account cannot sign in, so its credentials do not outlive the unlinking), was created at or after the credential (a
 * user id can be given again after a delete: an older credential is not this person's) or had a Telegram account linked
 * at or after it (the credential was the previous link's; a link from before telegram_linked_at existed is NULL and not
 * checked). Both are strict: a real credential needs a link and a bot approval first, so it is never issued in the same
 * millisecond. Rights are the user's current ones.
 */
export async function actorOfUser(db: Database, userId: number, issuedAt: number, link: SignInLink, source: Actor['source'] = 'admin'): Promise<Actor | null> {
  const user = await findUser(db, { id: userId })
  // `<` fails closed: an unreadable time (NaN) ends the credential
  const before = (iso: string) => Date.parse(iso) < issuedAt
  if (!user || !before(user.createdAt)) return null
  if (link.method === 'oidc') {
    // the Telegram link plays no part here: linking it for the bot signs nobody out
    return user.identity?.issuer === link.issuer && before(user.identity.linkedAt) ? userActor(user, source) : null
  }
  if (!user.telegramId || !(await telegramPreferences(db, userId))?.signIn) return null
  if (user.telegramLinkedAt !== null && !before(user.telegramLinkedAt)) return null
  return userActor(user, source)
}

/**
 * The actor of a family member named `member`, for a local command (the stdio advisor): whoever runs it already owns the
 * database, so no credential or Telegram link is checked. Read every time: rights are the current ones; null when there is
 * no such user.
 */
export async function actorOfMember(db: Database, member: string, source: Actor['source']): Promise<Actor | null> {
  const user = await findUser(db, { member })
  return user ? userActor(user, source) : null
}

/**
 * Who sends the request in the live mode, read from the database every time: changed rights and deleted users take
 * effect at once. null — nobody signed in (always in bootstrap state: no password exists, so no session either).
 * Demo mode is not asked here.
 */
async function resolveActor(c: Context, db: Database, auth: AuthRuntime): Promise<Actor | null> {
  const mode = auth.mode()
  if (mode === 'none') return PASSWORD_ACTOR
  if (mode === 'bootstrap') return null
  if (mode === 'password') return (await readSession(c, auth.signingKey()))?.userId === null ? PASSWORD_ACTOR : null
  const session = await readSession(c, auth.signingKey())
  const link = auth.signInLink()
  return session?.userId == null || link === null ? null : actorOfUser(db, session.userId, session.issuedAt, link)
}

/** Copies Set-Cookie from the context into the answer: Hono does not merge c.header() into a ready Response (from json()). */
export function withCookies(c: Context, res: Response): Response {
  for (const cookie of c.res.headers.getSetCookie()) res.headers.append('Set-Cookie', cookie)
  return res
}

/**
 * Checks a family password the caller typed: the attempt is counted before the verification (scrypt, slow and async), so
 * concurrent requests from one client cannot queue more verifications than the limit allows; a right password clears the
 * client's count again. A password change or a switch committed during the scrypt means the verified password may be the
 * old one (and a session would be signed with the new key), so the answer is wrong then. null: it is right.
 */
export async function verifyCounted(
  auth: AuthRuntime, limiter: LoginLimiter, client: string, given: unknown, wrongCode: string,
): Promise<Response | null> {
  limiter.fail(client)
  const generation = auth.generation()
  const mode = auth.mode()
  if (!await auth.verifyPassword(given) || auth.generation() !== generation || auth.mode() !== mode) {
    return errorJson(wrongCode, 401)
  }
  limiter.reset(client)
  return null
}

interface AuthDeps {
  db: Database
  limiter?: LoginLimiter
  /** the language of the sign-in screen */
  familyLanguage?: () => Promise<Language>
  /** the first-run wizard flag, read for a signed-in person only */
  familySetup?: () => Promise<SetupState>
  /** the attempts the bot approves (telegram mode); createApp shares one store with the bot */
  logins?: LoginAttempts
  /** the bot's username for deep links; null until the bot has introduced itself */
  botUsername?: () => string | null
  /** the family's identity provider; null when none is configured or its setup has a problem */
  oidc?: OidcClient | null
}

/** The provider flow's state: the checks, why it was started and where to go after; signed with the mode's key */
const OIDC_COOKIE = 'oidc'
const OIDC_PATH = '/api/auth/oidc'
const OIDC_TTL_S = 10 * 60
type OidcPurpose = { kind: 'sign-in' } | { kind: 'test'; userId: number } | { kind: 'invite'; code: string }
/** `at`: when the flow started (ms); the cookie's Max-Age binds only the browser, so the server checks it too */
interface OidcState { checks: OidcChecks; purpose: OidcPurpose; returnTo: string; at: number }

const isOidcState = (v: unknown): v is OidcState => {
  const s = v as Partial<OidcState> | null
  const checks = s?.checks as Partial<OidcChecks> | undefined
  const purpose = s?.purpose as Partial<{ kind: string; userId: unknown; code: unknown }> | undefined
  return typeof s?.returnTo === 'string' && Number.isFinite(s.at) && typeof checks?.state === 'string' && typeof checks.nonce === 'string' && typeof checks.verifier === 'string'
    && (purpose?.kind === 'sign-in' || (purpose?.kind === 'test' && Number.isSafeInteger(purpose.userId)) || (purpose?.kind === 'invite' && typeof purpose.code === 'string'))
}

/** The saved state of this browser's flow, read once: the cookie is deleted whether it was valid or not */
async function takeOidcState(c: Context, key: string): Promise<OidcState | null> {
  const raw = await getSignedCookie(c, key, OIDC_COOKIE)
  deleteCookie(c, OIDC_COOKIE, { path: OIDC_PATH })
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    return isOidcState(parsed) ? parsed : null
  } catch { return null }
}

/** Waits until a credential issued now is strictly after `linkedAt`; false when the binding is from the future (a skewed clock) */
async function pastBinding(linkedAt: string): Promise<boolean> {
  const t = Date.parse(linkedAt)
  if (!Number.isFinite(t) || t > Date.now() + 1000) return false
  while (Date.now() <= t) await delay(1)
  return true
}

/**
 * /api/auth (carries the family language, who is signed in, and in bootstrap state whether the window is open),
 * POST /api/auth/login (password mode), POST and GET /api/auth/telegram (telegram mode: start an attempt, then poll it;
 * password mode: the test sign-in that earns the switch ticket),
 * POST /api/auth/bootstrap (bootstrap state: the first visitor sets the family password), POST /api/auth/logout.
 * Every route is mounted in every family mode and answers 409 wrong_mode where the live mode does not fit, so a mode
 * switch needs no re-mount. Demo mode registers nothing: the demo router in front of the sandboxes owns /api/auth*.
 */
export function authRoutes(
  config: AppConfig,
  { db, auth, limiter = createLoginLimiter(), familyLanguage, familySetup, logins = createLoginAttempts(), botUsername, oidc = null }: AuthDeps & { auth: AuthRuntime },
): Hono {
  const app = new Hono()
  if (config.authMode === 'demo') return app
  const clientOf = (c: Context) => limiterKey(clientAddress(c, config))
  app.get('/api/auth', async c => {
    const mode = auth.mode()
    const actor = await resolveActor(c, db, auth)
    const signedIn = actor !== null
    // the family password is nobody in particular
    const me: Me | null = signedIn ? { name: mode === 'password' || mode === 'none' ? null : actor.name, rights: actor.rights } : null
    // the sign-in screen is shown in the family language; a failing read must not lock anyone out, but is logged
    const language = await familyLanguage?.().catch((error: unknown) => {
      console.error('[auth] could not read the family language', error)
      return FALLBACK_LANGUAGE
    }) ?? FALLBACK_LANGUAGE
    // a failing read must not lock anyone out of the app or send them into the wizard: it answers done, and is logged
    const setup = signedIn && familySetup ? await familySetup().catch((error: unknown): SetupState => {
      console.error('[auth] could not read the setup state', error)
      return 'done'
    }) : undefined
    return json({
      mode, authenticated: signedIn, language, me,
      ...(setup ? { setup } : {}),
      ...(mode === 'bootstrap' ? { bootstrapOpen: auth.bootstrapOpen() } : {}),
      // the provider's host for the sign-in button and the invitation page; only while it is usable
      ...(oidc ? { provider: oidc.provider() } : {}),
    })
  })

  app.post('/api/auth/login', c => guard(c.req, { tag: 'auth' }, async () => {
    if (auth.mode() !== 'password') return errorJson('wrong_mode', 409)
    const client = clientOf(c)
    if (limiter.blocked(client)) return errorJson('too_many_attempts', 429)
    const body = await readJson(c.req.raw)
    const password = field(body, 'password')
    if (typeof password !== 'string') return errorJson('password_required', 400)
    // Body reads yield: recheck before the comparison and failure accounting.
    if (limiter.blocked(client)) return errorJson('too_many_attempts', 429)
    const refused = await verifyCounted(auth, limiter, client, password, 'wrong_password')
    if (refused) return refused
    if (auth.mode() !== 'password') return errorJson('wrong_mode', 409)
    await issueSession(c, auth, config, null)
    return withCookies(c, json({ ok: true }))
  }))

  // every call counts against the client, successful or not: there is no secret to guess, the limiter bounds hammering;
  // so it stays out of the global ceiling, which strangers could otherwise fill to lock the owner out of setting it
  app.post('/api/auth/bootstrap', c => guard(c.req, { tag: 'auth' }, async () => {
    const client = clientOf(c)
    if (limiter.blocked(client)) return errorJson('too_many_attempts', 429)
    limiter.fail(client, false)
    const body = await readJson(c.req.raw)
    const choice = field(body, 'mode')
    if (choice !== undefined && choice !== 'password') return errorJson('invalid_value', 400, { column: 'mode' })
    const password = field(body, 'password')
    if (typeof password !== 'string') return errorJson('password_too_short', 400)
    await auth.completeBootstrap(password, PASSWORD_ACTOR)
    await issueSession(c, auth, config, null)
    return withCookies(c, json({ ok: true }))
  }))

  // every start counts against the client like a failed password, but not toward the global ceiling (it guesses no
  // secret; the attempts store has its own cap): strangers' starts cannot lock the family out. In password
  // mode it is the test sign-in for the switch to Telegram: only a signed-in family may start one
  app.post('/api/auth/telegram', c => guard(c.req, { tag: 'auth' }, async () => {
    const mode = auth.mode()
    const key = auth.signingKey()
    const token = auth.botToken()
    if (mode !== 'telegram' && mode !== 'password') return errorJson('wrong_mode', 409)
    if (mode === 'password') {
      const actor = await resolveActor(c, db, auth)
      if (actor === null || !actor.rights.manage) return errorJson('unauthorized', 401)
    }
    const client = clientOf(c)
    if (limiter.blocked(client)) return errorJson('too_many_attempts', 429)
    const bot = botUsername?.()
    if (!bot) return errorJson('bot_not_configured', 409)
    limiter.fail(client, false)
    let target: LoginTarget | undefined
    const userId = c.req.header('Content-Type')?.includes('application/json') ? field(await readJson(c.req.raw), 'userId') : undefined
    if (userId !== undefined) {
      if (mode !== 'password') return errorJson('wrong_mode', 409)
      if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) return errorJson('invalid_value', 400, { column: 'userId' })
      const selected = await findUser(db, { id: userId })
      if (!selected) return errorJson('user_not_found', 404)
      if (!selected.telegramSignIn) return errorJson('invalid_value', 400, { column: 'signIn' })
      target = {
        valid: () => auth.mode() === mode && auth.signingKey() === key && auth.botToken() === token,
        async confirm(telegram, valid) {
          const current = await findUser(db, { id: userId })
          if (!valid() || !current || !current.telegramSignIn || current.createdAt !== selected.createdAt || current.telegramId !== selected.telegramId || current.telegramLinkedAt !== selected.telegramLinkedAt) return 'expired'
          if (current.telegramId && current.telegramId !== telegram.id) return 'mismatch'
          const owner = await findUser(db, { telegramId: telegram.id })
          if (owner && owner.id !== userId) return 'mismatch'
          if (!current.telegramId && !await linkSelectedUser(db, selected, telegram, valid)) return 'expired'
          const linked = await findUser(db, { id: userId })
          if (!linked || linked.telegramId !== telegram.id || linked.createdAt !== selected.createdAt || (selected.telegramId && linked.telegramLinkedAt !== selected.telegramLinkedAt)) return 'expired'
          // Credentials must be strictly newer than the link; never invent a future approval timestamp.
          const linkedAt = Math.max(Date.parse(linked.createdAt), linked.telegramLinkedAt ? Date.parse(linked.telegramLinkedAt) : 0)
          if (!Number.isFinite(linkedAt) || linkedAt > Date.now()) return 'expired'
          while (Date.now() === linkedAt && valid()) await delay(1)
          const fresh = await findUser(db, { id: userId })
          return valid() && fresh?.telegramSignIn && fresh.telegramId === linked.telegramId && fresh.telegramLinkedAt === linked.telegramLinkedAt && fresh.createdAt === linked.createdAt ? userId : 'expired'
        },
      }
    }
    if (auth.mode() !== mode || auth.signingKey() !== key || auth.botToken() !== token) return errorJson('wrong_mode', 409)
    const previous = (await getSignedCookie(c, key, LOGIN_COOKIE) || '').split('.')
    if (previous[0] && previous[1]) logins.cancel(previous[0], previous[1])
    deleteCookie(c, SWITCH_COOKIE, { path: '/api/auth-settings' })
    // capped per /64 like the limiter; ranked for eviction by /48, so a flood over one allocation's /64s goes first
    const { code, secret } = logins.start(target ?? { valid: () => auth.mode() === mode && auth.signingKey() === key && auth.botToken() === token }, client, limiterKey(clientAddress(c, config), 48))
    await setSignedCookie(c, LOGIN_COOKIE, `${code}.${secret}`, auth.signingKey(), { ...sessionCookie(config, LOGIN_TTL_S), path: '/api/auth/telegram' })
    return withCookies(c, json({ link: `https://t.me/${bot}?start=login_${code}`, attempt: code }))
  }))
  // the browser polls; only the one holding the signed secret of an approved attempt gets the session. The session is
  // issued at the bot's approval, not at the poll: an approval from before a re-link (the old account's) is `expired`.
  // In password mode `done` issues no session but the switch ticket, and names who confirmed
  app.get('/api/auth/telegram', c => guard(c.req, { tag: 'auth' }, async () => {
    const mode = auth.mode()
    if (mode !== 'telegram' && mode !== 'password') return errorJson('wrong_mode', 409)
    const key = auth.signingKey()
    const botKey = switchBotKey(auth)
    const [code, secret] = (await getSignedCookie(c, key, LOGIN_COOKIE) || '').split('.')
    const result = code && secret ? logins.take(code, secret) : { status: 'expired' as const }
    if (result.status !== 'done') return json({ status: result.status })
    deleteCookie(c, LOGIN_COOKIE, { path: '/api/auth/telegram' })
    const actor = await actorOfUser(db, result.userId, result.approvedAt, { method: 'telegram' })
    if (!actor || auth.mode() !== mode || auth.signingKey() !== key || switchBotKey(auth) !== botKey) return withCookies(c, json({ status: 'expired' }))
    const value = `${result.userId}.${result.approvedAt}`
    if (mode === 'password') {
      await setSignedCookie(c, SWITCH_COOKIE, `${value}.${botKey}`, key, { ...sessionCookie(config, SWITCH_TTL_MS / 1000), path: '/api/auth-settings' })
      return withCookies(c, json({ status: 'done', member: actor.name, manage: actor.rights.manage }))
    }
    await setSession(c, config, key, value)
    return withCookies(c, json({ status: 'done' }))
  }))

  app.delete('/api/auth/telegram', c => guard(c.req, { tag: 'auth' }, async () => {
    const requested = field(await readJson(c.req.raw), 'attempt')
    const [code, secret] = (await getSignedCookie(c, auth.signingKey(), LOGIN_COOKIE) || '').split('.')
    if (code && secret && requested === code) logins.cancel(code, secret)
    return json({ ok: true })
  }))

  // --- sign-in through the family's identity provider ---------------------------------------------------------------
  const appOrigin = config.oidc?.redirectUri ? new URL(config.oidc.redirectUri).origin : null
  const failed = (c: Context, code: string) => c.redirect(`/?sign_in_error=${code}`, 302)
  /**
   * The state cookie must be set on the host the provider sends the browser back to (APP_URL's): a start on another host
   * (a LAN address) moves there first; `moved` stops a proxy that rewrites Host from looping.
   */
  const offHost = (c: Context): Response | null => {
    if (appOrigin === null || new URL(c.req.url).host === new URL(appOrigin).host) return null
    if (c.req.query('moved')) return failed(c, 'oidc_wrong_host')
    const target = new URL(c.req.path, appOrigin)
    for (const [k, v] of new URL(c.req.url).searchParams) target.searchParams.set(k, v)
    target.searchParams.set('moved', '1')
    return c.redirect(target.href, 302)
  }
  /** The provider's authorization URL for a new flow of `purpose`, its state saved in this browser; or why the provider cannot be reached */
  const begin = async (c: Context, client: OidcClient, purpose: OidcPurpose, returnTo: unknown, prompt?: 'login'): Promise<URL | OidcFailureCode> => {
    const checks = newChecks()
    let url: URL
    try {
      url = await client.authorizationUrl(checks, prompt)
    } catch (error) {
      if (error instanceof OidcFailure) return error.code
      throw error
    }
    const state: OidcState = { checks, purpose, returnTo: safeReturn(returnTo, appOrigin ?? ''), at: Date.now() }
    await setSignedCookie(c, OIDC_COOKIE, Buffer.from(JSON.stringify(state)).toString('base64url'), auth.signingKey(),
      { ...sessionCookie(config, OIDC_TTL_S), path: OIDC_PATH })
    return url
  }

  // a navigation, not a fetch: the sign-in button opens it. Counted like a Telegram start: it guesses no secret
  app.get('/api/auth/oidc/start', async c => {
    if (auth.mode() !== 'oidc' || oidc === null) return errorJson('wrong_mode', 409)
    const moved = offHost(c)
    if (moved) return moved
    const client = clientOf(c)
    if (limiter.blocked(client)) return failed(c, 'too_many_attempts')
    limiter.fail(client, false)
    const url = await begin(c, oidc, { kind: 'sign-in' }, c.req.query('return'))
    return typeof url === 'string' ? failed(c, url) : c.redirect(url.href, 302)
  })

  /** A POST that would set the state cookie on another host than APP_URL's: refused with the address to use */
  const wrongHost = (c: Context): Response | null =>
    appOrigin !== null && new URL(c.req.url).host !== new URL(appOrigin).host ? errorJson('oidc_wrong_host', 409, { appUrl: appOrigin }) : null
  /** `path` (a safe return path) with `params` added: where the test sign-in comes back to */
  const backTo = (c: Context, path: string, params: Record<string, string>) => {
    const url = new URL(path, appOrigin ?? 'https://monido.invalid')
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    return c.redirect(`${url.pathname}${url.search}`, 302)
  }

  // { userId, return }: from the family password, a manager's test sign-in at the provider binds that user's account and
  // earns the switch ticket; prompt=login, so a provider session already open in this browser cannot bind someone else
  app.post('/api/auth/oidc/test', c => guard(c.req, { tag: 'auth' }, async () => {
    if (auth.mode() !== 'password' || oidc === null) return errorJson('wrong_mode', 409)
    const actor = await resolveActor(c, db, auth)
    if (actor === null || !actor.rights.manage) return errorJson('unauthorized', 401)
    const moved = wrongHost(c)
    if (moved) return moved
    const body = await readJson(c.req.raw)
    const userId = field(body, 'userId')
    if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) return errorJson('invalid_value', 400, { column: 'userId' })
    if (!await findUser(db, { id: userId })) return errorJson('user_not_found', 404)
    const url = await begin(c, oidc, { kind: 'test', userId }, field(body, 'return'), 'login')
    return typeof url === 'string' ? errorJson(url, 503) : withCookies(c, json({ url: url.href }))
  }))

  // an invitation: GET names its member (so the page can say whom it binds), POST starts the provider; only a wrong code
  // counts, against the client and a ceiling across all clients. The ceiling is the invitations' own: in the sign-in
  // limiter strangers' guesses would lock the family out of signing in; here they can only hold invitations up
  const inviteGuesses = createLoginLimiter()
  app.get('/api/auth/oidc/invite/:code', c => guard(c.req, { tag: 'auth' }, async () => {
    const client = clientOf(c)
    if (inviteGuesses.blocked(client)) return errorJson('too_many_attempts', 429)
    const target = oidc === null ? null : await identityInviteTarget(db, c.req.param('code'))
    if (!target) {
      inviteGuesses.fail(client)
      return errorJson('invite_invalid', 404)
    }
    return json({ member: target.member })
  }))
  app.post('/api/auth/oidc/invite/:code', c => guard(c.req, { tag: 'auth' }, async () => {
    const client = clientOf(c)
    if (inviteGuesses.blocked(client)) return errorJson('too_many_attempts', 429)
    const code = c.req.param('code')
    if (oidc === null || !await identityInviteTarget(db, code)) {
      inviteGuesses.fail(client)
      return errorJson('invite_invalid', 404)
    }
    const moved = wrongHost(c)
    if (moved) return moved
    const url = await begin(c, oidc, { kind: 'invite', code }, '/', 'login')
    return typeof url === 'string' ? errorJson(url, 503) : withCookies(c, json({ url: url.href }))
  }))

  // the provider sends the browser back here; without this browser's state nothing is asked of the provider
  app.get('/api/auth/oidc/callback', async c => {
    const key = auth.signingKey()
    const saved = await takeOidcState(c, key)
    if (saved === null || oidc === null || !config.oidc?.redirectUri) return failed(c, 'oidc_expired')
    const age = Date.now() - saved.at
    if (age > OIDC_TTL_S * 1000 || age < -60_000) return failed(c, 'oidc_expired')
    // every exchange costs the provider a token request with the client secret: counted, like a start
    const client = clientOf(c)
    if (limiter.blocked(client)) return failed(c, 'too_many_attempts')
    limiter.fail(client, false)
    // the redirect URI as registered, with the provider's answer: never the request's own URL (behind a proxy it says http)
    const callbackUrl = new URL(config.oidc.redirectUri)
    callbackUrl.search = new URL(c.req.url).search
    let answer: ProviderAnswer
    try {
      answer = await oidc.finish(callbackUrl, saved.checks)
    } catch (error) {
      if (error instanceof OidcFailure) return failed(c, error.code)
      throw error
    }
    if (auth.signingKey() !== key) return failed(c, 'oidc_expired')
    // a binding asked the provider for a fresh sign-in (prompt=login): one that ignored it and vouched for a session
    // already open in this browser binds nothing; a provider that does not say when the person signed in is trusted
    const stale = answer.authTime !== null && answer.authTime < Math.floor(saved.at / 1000) - 60
    if (saved.purpose.kind === 'sign-in') {
      if (auth.mode() !== 'oidc') return failed(c, 'oidc_expired')
      const identity = await findIdentity(db, answer)
      if (identity === null) return failed(c, 'oidc_not_linked')
      if (!await pastBinding(identity.linkedAt) || auth.signingKey() !== key) return failed(c, 'oidc_expired')
      await issueSession(c, auth, config, { userId: identity.userId })
      return c.redirect(saved.returnTo, 302)
    }
    if (saved.purpose.kind === 'test') {
      const { userId } = saved.purpose
      const back = (code: string) => backTo(c, saved.returnTo, { sign_in_error: code })
      if (auth.mode() !== 'password') return back('oidc_expired')
      if (stale) return back('oidc_stale_login')
      // the family session that started it, still here: the callback is a plain navigation anyone could be sent to
      const actor = await resolveActor(c, db, auth)
      if (actor === null || !actor.rights.manage) return back('unauthorized')
      const bound = await bindIdentity(db, userId, answer, () => auth.mode() === 'password' && auth.signingKey() === key)
      if (bound.status !== 'bound' && bound.status !== 'same') return back(`oidc_${bound.status}`)
      if (!await pastBinding(bound.linkedAt) || auth.signingKey() !== key) return back('oidc_expired')
      const name = Buffer.from(answer.name ?? '', 'utf8').toString('base64url')
      await setSignedCookie(c, SWITCH_COOKIE, `oidc.${userId}.${Date.now()}.${oidcSwitchKey(config.oidc)}.${name}`, key,
        { ...sessionCookie(config, SWITCH_TTL_MS / 1000), path: '/api/auth-settings' })
      return backTo(c, saved.returnTo, { oidc_test: 'done' })
    }
    if (stale) return failed(c, 'oidc_stale_login')
    const accepted = await acceptIdentityInvite(db, saved.purpose.code, answer)
    if (accepted.status === 'invalid') return failed(c, 'oidc_invite_invalid')
    if (accepted.status !== 'bound') return failed(c, `oidc_${accepted.status}`)
    // in the provider mode the invited member is signed in at once; before the switch the binding waits for it
    if (auth.mode() !== 'oidc' || auth.signingKey() !== key) return c.redirect('/?oidc_invite=bound', 302)
    if (!await pastBinding(accepted.linkedAt)) return failed(c, 'oidc_expired')
    await issueSession(c, auth, config, { userId: accepted.userId })
    // the page names who is signed in now: whoever had a session in this browser is the invited member from here on
    return c.redirect('/?oidc_invite=bound', 302)
  })

  app.post('/api/auth/logout', c => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    // a confirmed test sign-in (10 minutes) and a pending Telegram sign-in stay with the person, not with the browser:
    // the next person signing in here must not switch the mode with them
    deleteCookie(c, SWITCH_COOKIE, { path: '/api/auth-settings' })
    deleteCookie(c, LOGIN_COOKIE, { path: '/api/auth/telegram' })
    deleteCookie(c, OIDC_COOKIE, { path: OIDC_PATH })
    return withCookies(c, json({ ok: true }))
  })
  return app
}

/**
 * 401 without sign-in; otherwise puts the actor into the context.
 * In demo mode the demo router has already checked the visitor.
 */
export function requireAuth(config: AppConfig, db: Database, auth: AuthRuntime): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const actor = config.authMode === 'demo' ? DEMO_ACTOR : await resolveActor(c, db, auth)
    if (!actor) return errorJson('unauthorized', 401)
    c.set('actor', actor)
    await next()
  }
}

/**
 * Writes only from our own origin: another host in Origin, or Sec-Fetch-Site: cross-site, gets a 403.
 * The scheme is not compared: behind a TLS-terminating proxy the server sees http:// while the browser sends https://;
 * a CSRF attacker cannot send an Origin with our host (the host includes the port).
 */
export function sameOrigin(): MiddlewareHandler {
  return async (c, next) => {
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      const origin = c.req.header('Origin')
      if (origin !== undefined && !hostMatches(origin, new URL(c.req.url).host)) {
        return errorJson('cross_origin', 403)
      }
      if (c.req.header('Sec-Fetch-Site') === 'cross-site') {
        return errorJson('cross_origin', 403)
      }
    }
    await next()
  }
}

/**
 * DNS rebinding guard: with nobody to sign in (AUTH_MODE=none, the bootstrap state) a foreign site could point its own
 * name at this server and use it as same-origin. Then only the APP_URL host, localhost or a literal IP address may be
 * the request's host, on any port; a name must be set as APP_URL. Signed-in modes need no check: the session is the guard.
 */
export function allowedHost(config: AppConfig, auth: AuthRuntime): MiddlewareHandler {
  const hostnameOf = (url: string) => { try { return new URL(url).hostname } catch { return null } }
  const appHost = config.appUrl ? hostnameOf(config.appUrl) : null
  return async (c, next) => {
    const mode = auth.mode()
    if (mode === 'none' || mode === 'bootstrap') {
      // the URL parser lower-cases the name and keeps IPv6 in brackets
      const host = new URL(c.req.url).hostname
      if (host !== appHost && host !== 'localhost' && !isIP(host.replace(/^\[(.*)\]$/, '$1'))) {
        // a page request gets plain text, a deliberate exception to "keys, not text": there is no SPA here to translate it
        return isApiPath(c.req.path) ? errorJson('host_not_allowed', 403) : c.text('Host not allowed: set APP_URL to this address', 403)
      }
    }
    await next()
  }
}

function hostMatches(origin: string, host: string): boolean {
  try { return new URL(origin).host === host } catch { return false }
}
