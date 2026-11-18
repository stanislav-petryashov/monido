import { useState, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { applyFamilyLanguage, currentLanguage, t } from '../i18n/client'
import { bootstrapLanguage, carryBootstrapLanguage, clearBootstrapLanguage } from './bootstrapLanguage'
import { isLanguage } from '../i18n/languages'
import type { AuthMode, Me, SetupState } from '../domain/api'
import { apiError } from './api'
import type { DemoFamilyCard } from '../demo/family'
import { refreshSnapshot, snapshotQueryKey } from './useFinanceData'

/** The public demo: the password shown on the sign-in screen and the visitor's sandbox session. */
interface DemoSession {
  hint: string
  /** when the sandbox is deleted, on this device's clock (epoch ms, see localDeadline); null before sign-in */
  expiresAt: number | null
  /** "Install it yourself" (DEMO_INSTALL_URL); null: the button is not shown */
  installUrl: string | null
  /** the server answered that the sandbox is gone: the end-of-session dialog shows */
  expired: boolean
  /** "Start over" found that the server no longer knows the visitor (it was restarted): the sign-in screen says so */
  restarted: boolean
  /** every language's family, as the sign-in card lists them */
  families: DemoFamilyCard[]
  /** how many sign-ins opened a sandbox so far */
  launches: number
}

interface AuthState {
  mode: AuthMode | null
  authenticated: boolean
  failed: boolean
  demo: DemoSession | null
  /** who is signed in and what they may do; null before sign-in, and for the demo */
  me: Me | null
  /** bootstrap mode: the 15-minute window to set the family password is open */
  bootstrapOpen: boolean
  /** the first-run flag of the family; null before sign-in and in the demo */
  setup: SetupState | null
}

const INITIAL: AuthState = { mode: null, authenticated: false, failed: false, demo: null, me: null, bootstrapOpen: false, setup: null }
let state: AuthState = INITIAL
const listeners = new Set<() => void>()

function emit() { for (const l of listeners) l() }

export function setAuth(next: Partial<AuthState>): void {
  state = { ...state, ...next }
  emit()
}
export function markUnauthorized(): void { setAuth({ authenticated: false, me: null }) }

/**
 * A 401 from the API. In the demo the visitor stays on the page and the end-of-session dialog shows: the sandbox is gone
 * (demo_expired) or its cookie ran out with it (unauthorized). Otherwise — and before a demo sign-in — the sign-in screen appears,
 * in the mode the server has now.
 */
export function sessionLost(): void {
  if (state.mode === 'demo' && state.demo && state.authenticated) setAuth({ demo: { ...state.demo, expired: true } })
  else {
    markUnauthorized()
    // the sign-in mode may have changed on another device (password ↔ Telegram): the sign-in screen asks the server
    void reloadAuth()
  }
}
/** Resets the sign-in state between tests. @public */
export function resetAuth(): void { state = INITIAL; serverExpiry = null; emit() }

export function useAuth(): AuthState {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l) } },
    () => state,
    () => state,
  )
}

const JSON_POST = { method: 'POST', headers: { 'Content-Type': 'application/json' } } as const

/** The answer of GET /api/auth; the demo adds its fields. */
interface AuthAnswer {
  mode: AuthMode
  authenticated: boolean
  hint?: string
  expiresAt?: number | null
  /** the server's clock when it answered (epoch ms) */
  now?: number
  installUrl?: string | null
  families?: DemoFamilyCard[]
  launches?: number
  /** the family's UI language (the demo: the sandbox's) */
  language?: string
  me?: Me | null
  bootstrapOpen?: boolean
  setup?: SetupState
}

/** GET /api/auth answered with an error status */
class AuthReadError extends Error {
  status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

/** GET /api/auth; throws AuthReadError on an error status (and whatever fetch or the JSON parse throws) */
async function fetchAuthAnswer(): Promise<AuthAnswer> {
  const res = await fetch('/api/auth')
  if (!res.ok) throw new AuthReadError(res.status)
  return await res.json() as AuthAnswer
}

/**
 * How a refused request is worded when called: a 429 without a code of ours (a proxy's limit) reads as too many attempts;
 * otherwise the server's message (the demo's own 429 says why).
 */
function refusal(res: Response, body: unknown): () => string {
  return res.status === 429 && !apiError(res.status, body).code
    ? () => t('errors.too_many_attempts')
    : () => apiError(res.status, body).message
}

/** Switches the UI to the language the server named; an unknown or missing one leaves it as it is. */
async function adoptLanguage(data: AuthAnswer): Promise<void> {
  // A new installation has no family choice yet; keep the browser/menu language until Welcome saves it.
  if (data.mode === 'bootstrap') return
  const carried = data.authenticated && data.setup === 'pending' ? bootstrapLanguage() : null
  if (data.authenticated && data.setup && data.setup !== 'pending') clearBootstrapLanguage()
  if (carried) { await applyFamilyLanguage(carried).catch(() => {}); return }
  if (isLanguage(data.language) && data.language !== currentLanguage()) await applyFamilyLanguage(data.language).catch(() => {})
}

/**
 * The server's end time on this device's clock: the time it has left (expiresAt - the server's now) counted from
 * Date.now(). A device clock that runs ahead or behind does not end the session early or late. Without the server's
 * clock the end time is taken as is.
 */
function localDeadline(expiresAt: unknown, serverNow: unknown): number | null {
  if (typeof expiresAt !== 'number') return null
  serverExpiry = expiresAt
  return typeof serverNow === 'number' ? Date.now() + (expiresAt - serverNow) : expiresAt
}

/** The sandbox's end on the server's clock, as last read: another tab's "Start over" gives the visitor a new one */
let serverExpiry: number | null = null

const demoOf = (data: AuthAnswer): DemoSession | null => (data.mode === 'demo'
  ? {
    hint: data.hint ?? '', expiresAt: localDeadline(data.expiresAt, data.now), installUrl: data.installUrl ?? null,
    expired: false, restarted: false, families: data.families ?? [], launches: data.launches ?? 0,
  }
  : null)

/** The session fields of an /api/auth answer: every read of it (the app's load, a sign-in) sets them all. */
const sessionOf = (data: AuthAnswer): Pick<AuthState, 'authenticated' | 'demo' | 'me' | 'bootstrapOpen' | 'setup'> => ({
  authenticated: data.authenticated, demo: demoOf(data), me: data.me ?? null, bootstrapOpen: data.bootstrapOpen === true,
  setup: data.setup ?? null,
})

/** GET /api/auth into the state; throws when the server cannot be read. */
async function readAuth(): Promise<AuthAnswer> {
  const data = await fetchAuthAnswer()
  await adoptLanguage(data)
  setAuth({ mode: data.mode, failed: false, ...sessionOf(data) })
  return data
}

/** Sign-in mode and state from the server; an unreachable network sets failed. */
export async function loadAuth(): Promise<void> {
  try {
    await readAuth()
  } catch {
    setAuth({ failed: true })
  }
}

/**
 * The same read inside the app, when the person's rights may have changed (a Users write, a 403 `no_right_*`), so `me`,
 * the menus and the screens follow. A failed read changes nothing: the app stays, not the "server is down" page.
 * Resolves to whether the person is signed in, false when the read failed.
 */
export async function reloadAuth(): Promise<boolean> {
  try {
    return (await readAuth()).authenticated
  } catch {
    return false
  }
}

/**
 * Password sign-in; a failure carries `error`, a function that words it in the UI language when called (the sign-in
 * screen calls it on every render, so the text follows a language switch). After a 200 the session is checked again through /api/auth: the browser silently drops a Secure
 * cookie (APP_URL is https) when the site is opened over http, and the sign-in screen would loop.
 */
export async function login(password: string): Promise<{ ok: true } | { ok: false; error: () => string; status: number }> {
  try {
    const res = await fetch('/api/auth/login', { ...JSON_POST, body: JSON.stringify(state.mode === 'demo' ? { password, language: currentLanguage() } : { password }) })
    if (!res.ok) return { ok: false, error: refusal(res, await res.json().catch(() => null)), status: res.status }
    let session: AuthAnswer | null = null
    try {
      session = await fetchAuthAnswer()
    } catch (e) {
      if (e instanceof AuthReadError) return { ok: false, error: () => apiError(e.status, null).message, status: e.status }
      if (!(e instanceof SyntaxError)) throw e
    }
    if (!session?.authenticated) return { ok: false, error: () => t('auth.cookieDropped'), status: 0 }
    await adoptLanguage(session)
    setAuth(sessionOf(session))
    return { ok: true }
  } catch {
    return { ok: false, error: () => t('auth.unreachable'), status: 0 }
  }
}

/**
 * Sets the family password on a new installation (the bootstrap window): the server answers with the session cookie, the
 * caller reads /api/auth next. A failure carries the server's `code` (`bootstrap_closed` closes the form) and `error`,
 * which words it when called.
 */
export async function bootstrapPassword(password: string): Promise<{ ok: true } | { ok: false; code: string | null; error: () => string }> {
  const language = currentLanguage()
  let res: Response
  try {
    res = await fetch('/api/auth/bootstrap', { ...JSON_POST, body: JSON.stringify({ password }) })
  } catch {
    return { ok: false, code: null, error: () => t('auth.unreachable') }
  }
  if (res.ok) { carryBootstrapLanguage(language); return { ok: true } }
  const body = await res.json().catch(() => null)
  const { code } = apiError(res.status, body)
  return { ok: false, code: res.status === 429 && !code ? null : code, error: refusal(res, body) }
}

/**
 * The demo's session from the server again (the window got the focus back): another tab may have started over, or the
 * sandbox may be gone. A failed request changes nothing — the countdown still runs.
 */
export async function syncDemo(client?: QueryClient): Promise<void> {
  if (!state.demo || state.demo.expired) return
  try {
    const data = await fetchAuthAnswer()
    if (!state.demo) return
    const before = serverExpiry
    const expiresAt = localDeadline(data.expiresAt, data.now) ?? state.demo.expiresAt
    setAuth({ demo: data.authenticated ? { ...state.demo, expiresAt } : { ...state.demo, expired: true } })
    // another end on the server's own clock is another tab's "Start over" (or a sign-in with another family): a fresh
    // sandbox, whose data this tab must read instead of showing the old one's figures while its writes land in the new one
    if (client && data.authenticated && before !== null && typeof data.expiresAt === 'number' && data.expiresAt !== before) invalidateDemoData(client)
  } catch {
    // offline: keep counting down
  }
}

/** Everything read from the old sandbox, read again from the new one */
function invalidateDemoData(client: QueryClient): void {
  void refreshSnapshot(client)
  const snapshotRoot = snapshotQueryKey(null)[0]
  void client.invalidateQueries({ predicate: query => query.queryKey[0] !== snapshotRoot })
}

/**
 * "Start over" in the demo: the server deletes the visitor's sandbox and opens a fresh copy, with no password (the signed
 * visitor cookie of the earlier sign-in). Everything cached came from the old sandbox, so it is loaded again. A 401 means
 * the server no longer knows the visitor (it was restarted): back to the sign-in screen, which says why. A failure's
 * `error` words it when called.
 */
export async function restartDemo(client: QueryClient): Promise<{ ok: true } | { ok: false; error: () => string }> {
  let res: Response
  try {
    // the language opens the fresh sandbox when the old one is gone (expired): the visitor keeps the one they see
    res = await fetch('/api/demo/restart', { ...JSON_POST, body: JSON.stringify({ language: currentLanguage() }) })
  } catch {
    return { ok: false, error: () => t('auth.unreachable') }
  }
  const body = await res.json().catch(() => null) as { expiresAt?: unknown; now?: unknown } | null
  if (!res.ok || typeof body?.expiresAt !== 'number') {
    if (res.status === 401 && state.demo) setAuth({ authenticated: false, demo: { ...state.demo, expiresAt: null, expired: false, restarted: true } })
    return { ok: false, error: () => apiError(res.status, body).message }
  }
  if (state.demo) setAuth({ authenticated: true, demo: { ...state.demo, expiresAt: localDeadline(body.expiresAt, body.now), expired: false } })
  invalidateDemoData(client)
  return { ok: true }
}

/** restartDemo for a button: busy while the request runs, and the failure worded at render. */
export function useRestartDemo() {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<(() => string) | null>(null)
  async function restart(): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    setError(null)
    try {
      const result = await restartDemo(client)
      if (!result.ok) setError(() => result.error)
      return result.ok
    } finally {
      setBusy(false)
    }
  }
  return { restart, busy, error }
}

/** Starts a sign-in through the bot: the link that opens the chat. A failure's `error` words it when called. */
export async function startTelegramLogin(userId?: number): Promise<{ ok: true; link: string; attempt?: string } | { ok: false; error: () => string }> {
  let res: Response
  try {
    res = await fetch('/api/auth/telegram', { ...JSON_POST, body: JSON.stringify(userId === undefined ? {} : { userId }) })
  } catch {
    return { ok: false, error: () => t('auth.unreachable') }
  }
  const body = await res.json().catch(() => null) as { link?: unknown; attempt?: unknown } | null
  if (res.ok && typeof body?.link === 'string') return { ok: true, link: body.link, ...(typeof body.attempt === 'string' ? { attempt: body.attempt } : {}) }
  return { ok: false, error: refusal(res, body) }
}

/**
 * One look at the sign-in attempt. On `done` the session cookie is set: /api/auth is read again for who signed in.
 * A failed request throws; the caller keeps waiting. The server forgets an attempt once it reported `done`: if the read
 * after it failed, the next look says `expired` while the cookie is valid, so `expired` asks /api/auth once more.
 */
export async function pollTelegramLogin(): Promise<'waiting' | 'expired' | 'done'> {
  const res = await fetch('/api/auth/telegram')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { status } = await res.json() as { status?: unknown }
  if (status === 'expired') return await reloadAuth() ? 'done' : 'expired'
  if (status !== 'done') return 'waiting'
  const session = await fetchAuthAnswer()
  if (!session.authenticated) throw new Error('not authenticated')
  await adoptLanguage(session)
  setAuth(sessionOf(session))
  return 'done'
}

/**
 * One look at a test sign-in in password mode (the proof for the switch to Telegram sign-in). On `done` the server sets
 * no session but the switch ticket and names who confirmed and whether they manage. A failed request throws; the caller
 * keeps waiting.
 */
export async function pollTelegramProof(): Promise<{ status: 'waiting' | 'expired' | 'mismatch' } | { status: 'done'; member: string; manage: boolean }> {
  const res = await fetch('/api/auth/telegram')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json() as { status?: unknown; member?: unknown; manage?: unknown }
  if (body.status === 'expired' || body.status === 'mismatch') return { status: body.status }
  if (body.status !== 'done') return { status: 'waiting' }
  if (typeof body.member !== 'string') throw new Error('no member')
  return { status: 'done', member: body.member, manage: body.manage === true }
}

/** Signs out; rejects (the session still alive) when the server did not answer: the sign-in screen must not hide a live session. */
export async function logout(): Promise<void> {
  const res = await fetch('/api/auth/logout', JSON_POST)
  // only the server clears the HttpOnly cookie: on a failed request the next person to reload would be signed in
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  markUnauthorized()
}

/** Cancels only this browser's pending attempt; a completed proof is left intact. */
export async function cancelTelegramLogin(attempt: string): Promise<void> {
  await fetch('/api/auth/telegram', { ...JSON_POST, method: 'DELETE', body: JSON.stringify({ attempt }), keepalive: true })
}
