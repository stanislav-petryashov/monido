// The demo router: signs visitors into private sandboxes and forwards their /api/* to their own sandbox app.
// It owns /api/auth* and /api/demo/*; it never holds a database itself, only the pool of sandbox copies.
import { randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { appSecureHeaders, noStore } from '../app'
import { clientAddress, createLoginLimiter, limiterKey, sameOrigin, withCookies, type LoginLimiter } from '../auth'
import { secureCookies, type AppConfig } from '../config'
import { errorJson, guard, isApiPath, json, logRequestError, notAllowed, readJson } from '../http'
import { sameSecret } from '../secrets'
import { ALL_RIGHTS } from '../users'
import { languageOr } from '../../i18n/languages'
import type { OpenResult, Sandbox, SandboxPool } from './pool'

/** the sandbox id; it lives as long as the sandbox */
const SESSION_COOKIE = 'demo_session'
const SESSION_MAX_AGE = 15 * 60
/** a random visitor id: signing in again returns to the visitor's sandbox, and "Start over" needs no password */
const VISITOR_COOKIE = 'demo_visitor'
const VISITOR_MAX_AGE = 30 * 24 * 60 * 60

const REFUSAL_STATUS = { demo_busy: 503, demo_ip_limit: 429, demo_updating: 503 } as const
/** "Start over" at most once in this time per visitor: each one copies the template */
const RESTART_COOLDOWN_MS = 10_000

interface DemoAppDeps {
  /** demo mode: demoPassword is set */
  config: AppConfig
  pool: SandboxPool
  /** signs the cookies; a new process has a new one, so the old cookies are void */
  secret: string
  /** the password is public: only the per-address limit applies, a global one would let anyone lock everyone out */
  limiter?: LoginLimiter
}

export function createDemoApp({ config, pool, secret, limiter = createLoginLimiter({ globalLimit: Infinity }) }: DemoAppDeps): Hono {
  const password = config.demoPassword
  if (!password) throw new Error('the demo router needs DEMO_PASSWORD (AUTH_MODE=demo)')
  const app = new Hono()
  const cookieOptions = { httpOnly: true, sameSite: 'Lax', path: '/', secure: secureCookies(config) } as const
  /** the per-IP cap counts what the login limiter counts: an IPv6 /64 is one client */
  const clientKey = (c: Context) => limiterKey(clientAddress(c, config))
  /** visitor → the time of their last "Start over"; entries older than the cooldown are dropped at the next one */
  const restartedAt = new Map<string, number>()

  /** undefined: no session cookie; null: one that is forged, from a previous process, or of a sandbox that is gone */
  async function session(c: Context): Promise<Sandbox | null | undefined> {
    // a value without a well-formed signature is not reported by getSignedCookie at all: ask for the raw one
    if (getCookie(c, SESSION_COOKIE) === undefined) return undefined
    const id = await getSignedCookie(c, secret, SESSION_COOKIE)
    return id ? pool.get(id) : null
  }

  /** A refusal: retryAfter (whole seconds) in the body and in Retry-After. */
  function refusal(code: string, status: number, retryAfter: number): Response {
    const res = errorJson(code, status, { retryAfter })
    res.headers.set('Retry-After', String(retryAfter))
    return res
  }

  /**
   * A new or reused sandbox sets both cookies. expiresAt comes with the server's now: the browser counts down
   * expiresAt - now on its own clock, which may be off.
   */
  async function answer(c: Context, result: OpenResult, visitor: string): Promise<Response> {
    if ('error' in result) return refusal(result.error, REFUSAL_STATUS[result.error], result.retryAfter)
    await setSignedCookie(c, SESSION_COOKIE, result.sandbox.id, secret, { ...cookieOptions, maxAge: SESSION_MAX_AGE })
    await setSignedCookie(c, VISITOR_COOKIE, visitor, secret, { ...cookieOptions, maxAge: VISITOR_MAX_AGE })
    return withCookies(c, json({ ok: true, expiresAt: result.sandbox.expiresAt, now: pool.now() }))
  }

  // the demo is not for search engines: every answer says so, robots.txt says so, and there is no sitemap
  app.use('*', async (c, next) => {
    await next()
    c.res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  })
  app.get('/robots.txt', c => c.text('User-agent: *\nDisallow: /\n'))
  app.get('/sitemap.xml', c => c.notFound())
  app.use(appSecureHeaders(config))
  app.use('/api/*', noStore)
  app.get('/api/health', () => json({ ok: true }))
  // before every route: login, logout and "Start over" are writes too
  app.use('/api/*', sameOrigin())

  app.get('/api/auth', async c => {
    const sandbox = await session(c)
    return json({
      mode: 'demo', authenticated: Boolean(sandbox), hint: password, expiresAt: sandbox?.expiresAt ?? null, now: pool.now(),
      // the visitor is anonymous with all rights, as the sandbox's demo actor
      installUrl: config.demoInstallUrl, me: sandbox ? { name: null, rights: ALL_RIGHTS } : null, ...(sandbox ? { language: pool.language(sandbox.id) } : {}),
    })
  })
  app.all('/api/auth', notAllowed)

  app.post('/api/auth/login', c => guard(c.req, { tag: 'demo' }, async () => {
    const client = clientKey(c)
    if (limiter.blocked(client)) return errorJson('too_many_attempts', 429)
    const body = await readJson(c.req.raw) as { password?: unknown; language?: unknown } | null
    const given = body?.password
    if (typeof given !== 'string') return errorJson('password_required', 400)
    // the body read yields: recheck before the synchronous comparison and failure accounting (as auth.ts)
    if (limiter.blocked(client)) return errorJson('too_many_attempts', 429)
    if (!sameSecret(given, password)) {
      limiter.fail(client)
      return errorJson('wrong_password', 401)
    }
    const visitor = (await getSignedCookie(c, secret, VISITOR_COOKIE)) || randomUUID()
    return answer(c, pool.open(visitor, client, languageOr(body?.language)), visitor)
  }))
  app.all('/api/auth/login', notAllowed)

  // the sandbox stays until it expires: closing it here would let a sign-in/sign-out loop copy the template without end
  // past the per-address cap; signing in again returns to it
  app.post('/api/auth/logout', c => {
    deleteCookie(c, SESSION_COOKIE, cookieOptions)
    return withCookies(c, json({ ok: true }))
  })
  app.all('/api/auth/logout', notAllowed)

  // "Start over": the visitor proved the password at an earlier sign-in; the caps apply as at sign-in, and one
  // visitor may start over once per cooldown
  app.post('/api/demo/restart', c => guard(c.req, { tag: 'demo' }, async () => {
    const visitor = await getSignedCookie(c, secret, VISITOR_COOKIE)
    if (!visitor) return errorJson('unauthorized', 401)
    const now = pool.now()
    for (const [id, at] of restartedAt) if (now - at >= RESTART_COOLDOWN_MS) restartedAt.delete(id)
    const last = restartedAt.get(visitor)
    if (last !== undefined) return refusal('demo_restart_cooldown', 429, Math.max(1, Math.ceil((last + RESTART_COOLDOWN_MS - now) / 1000)))
    // the browser's language: the pool uses it when the old sandbox is gone (expired), as at sign-in; no body or a
    // broken one (an older page) is English
    const body = await readJson(c.req.raw).catch(() => null) as { language?: unknown } | null
    const result = pool.restart(visitor, clientKey(c), languageOr(body?.language))
    if ('sandbox' in result) restartedAt.set(visitor, now)
    return answer(c, result, visitor)
  }))
  app.all('/api/demo/restart', notAllowed)

  app.all('/api/*', async c => {
    const sandbox = await session(c)
    if (sandbox === undefined) return errorJson('unauthorized', 401)
    if (!sandbox) return errorJson('demo_expired', 401)
    const res = await sandbox.app.fetch(c.req.raw)
    // the sweep closed the sandbox while the request was inside it: its failure on the closed database means "expired"
    if (res.status >= 500 && !pool.get(sandbox.id)) return errorJson('demo_expired', 401)
    // storage_full: the sandbox reached its size cap; "Start over" gives a fresh copy
    return res.status === 507 ? errorJson('demo_full', 409) : res
  })

  app.onError((err, c) => {
    logRequestError(c.req, 'demo', err)
    return errorJson('load_failed', 500)
  })
  app.notFound(c => (isApiPath(c.req.path) ? errorJson('not_found', 404) : c.text('Not found', 404)))
  return app
}
