// The sign-in settings and their live state, one object per process: the mode, the family password (scrypt), the bot
// token and session generation in app_settings. The bot token and temporary open access may be overridden by .env.
// Writes are journaled; secrets' journal entries carry '***'.
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { passwordProblem } from '../domain/password'
import type { AppConfig } from './config'
import { transaction, type SqliteDatabase } from './db'
import { CONFIG_ACTOR, InputError, type Actor } from './http'
import { CHANGE_LOG_INSERT } from './rows'
import { SIGN_IN_MANAGER_SQL } from './users'

/** The effective way in: 'bootstrap' is password mode with no password anywhere (the first visitor sets it). */
export type SignInMode = 'password' | 'telegram' | 'bootstrap' | 'none'

export interface AuthRuntime {
  /** The effective mode now ('bootstrap': password mode with no password anywhere) */
  mode(): SignInMode
  /** Read-only in the demo and while AUTH_MODE=none overrides sign-in. */
  locked(): boolean
  passwordSource(): 'app' | null
  botTokenSource(): 'env' | 'app' | null
  /** env, else app_settings */
  botToken(): string | null
  /** scrypt; no password or not a string: false */
  verifyPassword(given: unknown): Promise<boolean>
  /** App only; bumps auth_generation */
  setPassword(password: string, actor: Actor): Promise<void>
  /** Stores the token only after `verify` resolved (Telegram's getMe) */
  setBotToken(token: string, actor: Actor, verify: (token: string) => Promise<{ username: string }>): Promise<{ username: string }>
  /** App only */
  clearBotToken(actor: Actor): Promise<void>
  /** App only; bumps auth_generation */
  setMode(mode: 'password' | 'telegram', actor: Actor): Promise<void>
  generation(): number
  /** HMAC-SHA256(sessionSecret, `${mode}:${generation}`), read per request */
  signingKey(): string
  /** Bootstrap state and less than BOOTSTRAP_WINDOW_MS since the window opened */
  bootstrapOpen(): boolean
  /** Throws not_in_bootstrap / bootstrap_closed / password_too_* */
  completeBootstrap(password: string, actor: Actor): Promise<void>
  /** Re-reads the auth_* rows (the reset-password command changed them); reopens the window in bootstrap state */
  reload(): void
  /** The bot supervisor and anything that caches the mode; returns the unsubscribe */
  onChange(listener: () => void): () => void
}

/** How long after the start (or the last reload into bootstrap) the first visitor may set the password. */
export const BOOTSTRAP_WINDOW_MS = 15 * 60_000

type AuthKey = 'auth_mode' | 'auth_password' | 'auth_bot_token' | 'auth_generation'
type StoredMode = 'password' | 'telegram'
type Fallback = 'password' | 'bootstrap'
interface AuthChange { key: AuthKey; value: string | null }

/** The keys whose values never reach the journal. */
const SECRET_KEYS: ReadonlySet<AuthKey> = new Set(['auth_password', 'auth_bot_token'])

// scrypt: N = 2^16, r = 8, p = 2, a 16-byte salt, a 32-byte key (one of OWASP's listed equivalents of N = 2^17, p = 1, at
// half the memory). It needs 128·N·r = 64 MiB, over Node's default maxmem (32 MiB), hence 128 MiB. Hashes written with
// N = 2^15, p = 1 still verify: each stores its parameters.
const SCRYPT = { N: 2 ** 16, r: 8, p: 2, saltBytes: 16, keyBytes: 32 } as const
const SCRYPT_MAXMEM = 128 * 1024 * 1024
const STORED_HASH = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/

function derive(password: string, salt: Buffer, { N, r, p }: { N: number; r: number; p: number }, keyBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyBytes, { N, r, p, maxmem: SCRYPT_MAXMEM }, (error, key) => error ? reject(error) : resolve(key))
  })
}

/** `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>`: the parameters are stored so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT.saltBytes)
  const key = await derive(password, salt, SCRYPT, SCRYPT.keyBytes)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

/** The password against a stored hash, in constant time; false for a malformed string or parameters scrypt refuses. */
export async function verifyHash(password: string, stored: string): Promise<boolean> {
  const parts = STORED_HASH.exec(stored)
  if (!parts) return false
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  const salt = Buffer.from(parts[4], 'base64')
  const expected = Buffer.from(parts[5], 'base64')
  if (!expected.length) return false
  try {
    return timingSafeEqual(await derive(password, salt, { N, r, p }, expected.length), expected)
  } catch {
    // N not a power of two, a memory need over maxmem: a hash this code did not write
    return false
  }
}

/** A stored generation that is missing or not a positive integer reads as 1, never NaN in the signing key. */
function parseGeneration(value: string | undefined): number {
  const n = value !== undefined && /^\d+$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(n) && n >= 1 ? n : 1
}

interface AuthRows { mode: StoredMode; hash: string | null; token: string | null; generation: number }

function readValue(sqlite: DatabaseSync, key: AuthKey): string | undefined {
  return (sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value
}

function readRows(sqlite: DatabaseSync): AuthRows {
  return {
    mode: readValue(sqlite, 'auth_mode') === 'telegram' ? 'telegram' : 'password',
    hash: readValue(sqlite, 'auth_password') ?? null,
    token: readValue(sqlite, 'auth_bot_token') ?? null,
    generation: parseGeneration(readValue(sqlite, 'auth_generation')),
  }
}

/** The generation bump, read inside the caller's transaction. */
const bump = (sqlite: DatabaseSync): AuthChange =>
  ({ key: 'auth_generation', value: String(parseGeneration(readValue(sqlite, 'auth_generation')) + 1) })

/**
 * The one writer of the auth_* rows: synchronous, inside the caller's transaction. Each change differing from the stored
 * value is upserted (or deleted for null) with a change_log entry `{ key, value }`, the secrets' values as '***'.
 */
function writeAuthRows(sqlite: DatabaseSync, actor: Actor, changes: AuthChange[], ts: string): void {
  const log = sqlite.prepare(`${CHANGE_LOG_INSERT} VALUES (?, ?, ?, 'app_settings', ?, ?, ?, ?, NULL)`)
  for (const { key, value } of changes) {
    const before = sqlite.prepare('SELECT rowid, value FROM app_settings WHERE key = ?').get(key) as { rowid: number; value: string } | undefined
    if ((before?.value ?? null) === value) continue
    const shown = (v: string) => JSON.stringify({ key, value: SECRET_KEYS.has(key) ? '***' : v })
    let rowid: number
    let op: 'insert' | 'update' | 'delete'
    if (!before) {
      rowid = Number(sqlite.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(key, value).lastInsertRowid)
      op = 'insert'
    } else if (value === null) {
      sqlite.prepare('DELETE FROM app_settings WHERE key = ?').run(key)
      ;[rowid, op] = [Number(before.rowid), 'delete']
    } else {
      sqlite.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(value, key)
      ;[rowid, op] = [Number(before.rowid), 'update']
    }
    log.run(ts, actor.name, actor.source, rowid, op, before ? shown(before.value) : null, value === null ? null : shown(value))
  }
}

const BOOTSTRAP_LINE = '[auth] Open the site within 15 minutes to configure access; after that, restart the container to reopen the window'
const FALLBACK_REASON = 'Telegram sign-in is off at start: no account that manages users and settings has a linked Telegram'

/** What planSharedPassword and fallbackOf reach in a loaded runtime. */
interface RuntimeInternals {
  config: AppConfig
  storedHash(): string | null
  fallback(): Fallback | null
  /** After the caller's COMMIT of a write that set the mode: re-read the rows, drop the fallback, notify */
  committed(): void
}

const INTERNALS = new WeakMap<AuthRuntime, RuntimeInternals>()

/** Loads app-managed sign-in settings and opens the initial setup or password-recovery window. */
export async function loadAuthRuntime(db: SqliteDatabase, config: AppConfig, opts: { now?: () => number; log?: (line: string) => void } = {}): Promise<AuthRuntime> {
  const { sqlite } = db
  const now = opts.now ?? Date.now
  const log = opts.log ?? ((line: string) => console.log(line))
  if (config.authMode === 'demo') throw new Error('the demo has no sign-in runtime of its own; use demoAuthRuntime')

  mirrorBotToken(sqlite, config)

  let rows = readRows(sqlite)
  let mode: SignInMode = 'bootstrap'
  let fallback: Fallback | null = null
  let windowOpenedAt: number | null = null
  const listeners = new Set<() => void>()
  // a listener's failure must not turn a committed write into an error: log it and go on
  const notify = () => {
    for (const listener of [...listeners]) {
      try { listener() } catch (err) { console.error(`[auth] a change listener failed: ${err instanceof Error ? err.message : String(err)}`) }
    }
  }

  const hasPassword = () => !!rows.hash
  /** The stored mode; `linkedManager` false turns a stored telegram mode into its fallback. */
  const resolve = (linkedManager: boolean): { mode: SignInMode; fallback: Fallback | null } => {
    if (config.authMode === 'none') return { mode: 'none', fallback: null }
    const passwordMode = hasPassword() ? 'password' : 'bootstrap'
    if (rows.mode === 'telegram') {
      return linkedManager ? { mode: 'telegram', fallback: null } : { mode: passwordMode, fallback: passwordMode }
    }
    return { mode: passwordMode, fallback: null }
  }
  const logLine = () => {
    if (fallback === 'bootstrap') return `[auth] ${FALLBACK_REASON}. ${BOOTSTRAP_LINE.slice('[auth] '.length)}`
    if (fallback === 'password') return `[auth] mode: password (${FALLBACK_REASON})`
    if (mode === 'bootstrap') return BOOTSTRAP_LINE
    return `[auth] mode: ${mode}${config.authMode === 'none' ? ' (set by AUTH_MODE in .env)' : ''}`
  }
  /** At start and on reload: the manager check, a fresh window in bootstrap state, the log line. */
  const settle = () => {
    rows = readRows(sqlite)
    ;({ mode, fallback } = resolve(!!sqlite.prepare(SIGN_IN_MANAGER_SQL).get()))
    windowOpenedAt = mode === 'bootstrap' ? now() : null
    log(logLine())
  }
  /** After a committed write: the rows again; a fallback holds while the stored mode is still telegram. */
  const refresh = ({ dropFallback = false }: { dropFallback?: boolean } = {}) => {
    const before = mode
    rows = readRows(sqlite)
    ;({ mode, fallback } = resolve(dropFallback || fallback === null))
    if (mode !== 'bootstrap') windowOpenedAt = null
    else if (before !== 'bootstrap') windowOpenedAt = now()
    notify()
  }
  const write = (actor: Actor, changes: (AuthChange | typeof bump)[], recheck?: () => void) => {
    transaction(sqlite, () => {
      recheck?.()
      writeAuthRows(sqlite, actor, changes.map(c => typeof c === 'function' ? c(sqlite) : c), new Date(now()).toISOString())
    })
  }
  const bootstrapOpen = () => mode === 'bootstrap' && windowOpenedAt !== null && now() - windowOpenedAt < BOOTSTRAP_WINDOW_MS

  settle()

  const runtime: AuthRuntime = {
    mode: () => mode,
    locked: () => config.authMode === 'none',
    passwordSource: () => rows.hash ? 'app' : null,
    botTokenSource: () => config.telegramBotToken ? 'env' : rows.token ? 'app' : null,
    botToken: () => config.telegramBotToken ?? rows.token,
    async verifyPassword(given) {
      if (typeof given !== 'string') return false
      return rows.hash ? verifyHash(given, rows.hash) : false
    },
    async setPassword(password, actor) {
      assertPassword(password)
      const hash = await hashPassword(password)
      write(actor, [{ key: 'auth_password', value: hash }, bump])
      refresh()
    },
    async setBotToken(token, actor, verify) {
      if (config.telegramBotToken) throw new InputError('bot_token_locked', 409)
      const result = await verify(token)
      write(actor, [{ key: 'auth_bot_token', value: token }])
      refresh()
      return result
    },
    async clearBotToken(actor) {
      if (config.telegramBotToken) throw new InputError('bot_token_locked', 409)
      write(actor, [{ key: 'auth_bot_token', value: null }])
      refresh()
    },
    async setMode(next, actor) {
      if (config.authMode === 'none') throw new InputError('auth_mode_locked', 409)
      if (next !== 'password' && next !== 'telegram') throw new InputError('invalid_value', 400, { column: 'mode' })
      write(actor, [{ key: 'auth_mode', value: next }, bump])
      // the caller checked what the switch needs: a switch to telegram is no fallback
      refresh({ dropFallback: true })
    },
    generation: () => rows.generation,
    signingKey() {
      if (!config.sessionSecret) throw new Error('sessionSecret is not loaded; call loadSessionSecret first')
      return createHmac('sha256', config.sessionSecret).update(`${mode}:${rows.generation}`).digest('hex')
    },
    bootstrapOpen,
    async completeBootstrap(password, actor) {
      const check = () => {
        if (mode !== 'bootstrap' || readValue(sqlite, 'auth_password') !== undefined) throw new InputError('not_in_bootstrap', 409)
        if (!bootstrapOpen()) throw new InputError('bootstrap_closed', 409)
      }
      check()
      assertPassword(password)
      const hash = await hashPassword(password)
      write(actor, [{ key: 'auth_password', value: hash }, { key: 'auth_mode', value: 'password' }, bump], check)
      refresh({ dropFallback: true })
    },
    reload() {
      settle()
      notify()
    },
    onChange(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  INTERNALS.set(runtime, {
    config,
    storedHash: () => rows.hash,
    fallback: () => fallback,
    committed: () => refresh({ dropFallback: true }),
  })
  return runtime
}

/** password_too_short / password_too_long (400); a non-string is too short. */
export function assertPassword(password: unknown): asserts password is string {
  const problem = typeof password === 'string' ? passwordProblem(password) : 'password_too_short'
  if (problem) throw new InputError(problem, 400)
}

/** The bot token remains an optional environment override; sign-in settings belong to the app. */
function mirrorBotToken(sqlite: DatabaseSync, config: AppConfig): void {
  if (!config.telegramBotToken) return
  transaction(sqlite, () => writeAuthRows(sqlite, CONFIG_ACTOR,
    [{ key: 'auth_bot_token', value: config.telegramBotToken }], new Date().toISOString()))
}

/** The demo sandbox's runtime: password mode, locked, nothing set; every setter is 403 not_in_demo. */
export function demoAuthRuntime(config: AppConfig): AuthRuntime {
  const refuse = async (): Promise<never> => { throw new InputError('not_in_demo', 403) }
  return {
    mode: () => 'password',
    locked: () => true,
    passwordSource: () => null,
    botTokenSource: () => null,
    botToken: () => null,
    verifyPassword: async () => false,
    setPassword: refuse,
    setBotToken: refuse,
    clearBotToken: refuse,
    setMode: refuse,
    generation: () => 1,
    signingKey() {
      if (!config.sessionSecret) throw new Error('sessionSecret is not loaded; call loadSessionSecret first')
      return config.sessionSecret
    },
    bootstrapOpen: () => false,
    completeBootstrap: refuse,
    reload: () => {},
    onChange: () => () => {},
  }
}

export interface SharedPasswordPlan {
  apply(sqlite: DatabaseSync): void
  committed(): void
}

/** Prepares the password hash before the caller's atomic transaction; refreshes runtime only after commit. */
export async function planSharedPassword(auth: AuthRuntime, actor: Actor, opts: { password?: string }): Promise<SharedPasswordPlan> {
  const internals = INTERNALS.get(auth)
  if (!internals) throw new Error('planSharedPassword needs a loaded runtime')
  if (internals.config.authMode === 'none') throw new InputError('auth_mode_locked', 409)
  let hash: string | null = null
  if (opts.password !== undefined) {
    assertPassword(opts.password)
    hash = await hashPassword(opts.password)
  } else if (!internals.storedHash()) {
    throw new InputError('password_needed', 409)
  }
  return {
    apply(sqlite) {
      // the stored password the check relied on was deleted meanwhile (the reset-password command, another process):
      // throwing here rolls the caller's transaction back
      if (hash === null && readRows(sqlite).hash === null) throw new InputError('password_needed', 409)
      const changes: AuthChange[] = [{ key: 'auth_mode', value: 'password' }]
      if (hash !== null) changes.push({ key: 'auth_password', value: hash })
      writeAuthRows(sqlite, actor, [...changes, bump(sqlite)], new Date().toISOString())
    },
    committed: internals.committed,
  }
}

/** Clears the password, revokes sessions and enters password recovery; writes only journaled auth settings. */
export function resetPasswordRows(sqlite: DatabaseSync, config: AppConfig, actor: Actor): void {
  const envMode = config.authMode
  if (envMode === 'demo' || envMode === 'none') throw new InputError('wrong_mode', 409)
  transaction(sqlite, () => {
    const changes: AuthChange[] = [{ key: 'auth_password', value: null }]
    changes.push({ key: 'auth_mode', value: 'password' })
    writeAuthRows(sqlite, actor, [...changes, bump(sqlite)], new Date().toISOString())
  })
}

/** The DB-mode telegram fallback at load (or the last reload): which way in the server took instead; null for none. */
export function fallbackOf(auth: AuthRuntime): Fallback | null {
  return INTERNALS.get(auth)?.fallback() ?? null
}
