import { loadTestAuthRuntime } from '../helpers/auth'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { Hono } from 'hono'
import { serializeSigned } from 'hono/utils/cookie'
import { loadConfig, type AppConfig } from '../../src/server/config'
import {
  actorOfMember, actorOfUser, authRoutes, createLoginLimiter, issueSession, limiterKey, loadSessionSecret, requireAuth, sameOrigin, withCookies, type AuthVariables, type LoginLimiter,
} from '../../src/server/auth'
import { createLoginAttempts, type LoginAttempts } from '../../src/server/loginAttempts'
import { BOOTSTRAP_WINDOW_MS, demoAuthRuntime, resetPasswordRows, type AuthRuntime } from '../../src/server/authSettings'
import { guard, requireRight, type Actor } from '../../src/server/http'
import { acceptInvite, issueInvite } from '../../src/server/users'
import type { Database } from '../../src/server/db'
import { createTestDb, testConfig, type TestDb } from '../helpers/db'
import { addUser } from '../helpers/users'
import { withTempDirs } from '../helpers/tmp'

const PASSWORD = 'correct horse battery'
/** A temporary DATA_DIR that afterEach removes. */
const tempDir = withTempDirs('ffd-key-')

// intercepts writing session.key: plays a second process creating the file at the same moment
const race = vi.hoisted(() => ({ before: null as null | (() => void) }))
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      const before = race.before
      if (before && String(args[0]).endsWith('session.key')) { race.before = null; before() }
      return fs.writeFileSync(...args)
    },
  }
})

const ALL = { edit: true, vote: true, manage: true }

function build(overrides: Record<string, string> = {}, limiter = createLoginLimiter()) {
  return buildWith(testConfig({ password: PASSWORD, ...overrides }, 'test-secret'), { limiter })
}

interface Deps { limiter?: LoginLimiter; db?: Database; logins?: LoginAttempts; bot?: string | null; now?: () => number }

/** The app as createApp mounts sign-in, over the real runtime of `db` (the demo: the sandbox's runtime). */
async function harness(config: AppConfig, { limiter = createLoginLimiter(), db = createTestDb(), logins, bot = null, now }: Deps = {}) {
  const auth: AuthRuntime = config.authMode === 'demo'
    ? demoAuthRuntime(config)
    : await loadTestAuthRuntime(db as TestDb, config, { log: () => {}, ...(now ? { now } : {}) })
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('/api/*', sameOrigin())
  app.route('/', authRoutes(config, { db, auth, limiter, logins, botUsername: () => bot }))
  app.use('/api/*', requireAuth(config, db, auth))
  app.get('/api/whoami', c => c.json({ actor: c.get('actor') }))
  app.post('/api/write', c => c.json({ ok: true }))
  app.post('/api/edit', c => guard(c.req, { tag: 'test' }, async () => { requireRight(c.get('actor'), 'edit'); return { ok: true } }))
  return { app, auth, db }
}

async function buildWith(config: AppConfig, deps: Deps = {}) {
  return (await harness(config, deps)).app
}

const jsonBody = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const cookieOf = (res: Response) => res.headers.get('Set-Cookie')?.split(';')[0] ?? ''
/** The whole Set-Cookie line for one cookie name ('' when not set) */
const setCookieNamed = (res: Response, name: string) => res.headers.getSetCookie().find(line => line.startsWith(`${name}=`)) ?? ''

afterEach(() => {
  vi.useRealTimers()
})

describe('password mode', () => {
  it('reports the mode and refuses the API without a session', async () => {
    const app = await build()
    expect(await (await app.request('/api/auth')).json()).toEqual({ mode: 'password', authenticated: false, language: 'en-US', me: null })
    const res = await app.request('/api/whoami')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized' } })
  })

  it('a failing family-language read answers English and is logged', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = new Hono()
    const failure = new Error('database is locked')
    const config = testConfig({ password: PASSWORD }, 'test-secret')
    const db = createTestDb()
    const auth = await loadTestAuthRuntime(db, config, { log: () => {} })
    app.route('/', authRoutes(config, { db, auth, familyLanguage: () => Promise.reject(failure) }))
    expect(await (await app.request('/api/auth')).json()).toEqual({ mode: 'password', authenticated: false, language: 'en-US', me: null })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('language'), failure)
    error.mockRestore()
  })

  it('logs in with the right password: HttpOnly Lax cookie for 30 days, actor family', async () => {
    const app = await build()
    const login = await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))
    expect(login.status).toBe(200)
    const setCookie = login.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toMatch(/^session=/)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain(`Max-Age=${30 * 24 * 3600}`)
    expect(setCookie).not.toContain('Secure')
    const me = await app.request('/api/whoami', { headers: { Cookie: cookieOf(login) } })
    expect(await me.json()).toEqual({ actor: { name: 'family', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null } })
    expect(await (await app.request('/api/auth', { headers: { Cookie: cookieOf(login) } })).json()).toEqual({ mode: 'password', authenticated: true, language: 'en-US', me: { name: null, rights: ALL } })
  })

  it('password mode: me is the family with all rights, whatever the users table holds', async () => {
    const db = createTestDb()
    addUser(db, 'Anna', { telegramId: '100' })
    const app = await buildWith(testConfig({ password: PASSWORD }, 'test-secret'), { db })
    const login = await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))
    expect(cookieOf(login)).toMatch(/^session=\d+\./)
    const auth = await (await app.request('/api/auth', { headers: { Cookie: cookieOf(login) } })).json() as { me: unknown }
    expect(auth.me).toEqual({ name: null, rights: ALL })
    expect((await app.request('/api/edit', { method: 'POST', headers: { Cookie: cookieOf(login) } })).status).toBe(200)
  })

  it('marks the cookie Secure when APP_URL is https', async () => {
    const app = await build({ APP_URL: 'https://finance.example' })
    const login = await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))
    expect(login.headers.get('Set-Cookie')).toContain('Secure')
  })

  it('refuses a wrong password without a cookie, and bad bodies without a 500', async () => {
    const app = await build()
    const wrong = await app.request('/api/auth/login', jsonBody({ password: 'nope' }))
    expect(wrong.status).toBe(401)
    expect(wrong.headers.get('Set-Cookie')).toBeNull()
    expect(await wrong.json()).toEqual({ error: { code: 'wrong_password' } })
    expect((await app.request('/api/auth/login', jsonBody({ password: 1 }))).status).toBe(400)
    expect((await app.request('/api/auth/login', { method: 'POST', body: 'password=x' })).status).toBe(415)
    expect((await app.request('/api/auth/login', jsonBody({}))).status).toBe(400)
  })

  it('ignores a tampered or expired cookie', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2031-10-01T00:00:00Z'))
    const app = await build()
    const login = await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))
    const cookie = cookieOf(login)
    // session=<time>.<base64 signature, URL-encoded>: change a character inside the signature, not the trailing %3D
    const [, issuedAt, signature] = /^session=(\d+)\.(.+)$/.exec(decodeURIComponent(cookie))!
    const middle = Math.floor(signature.length / 2)
    const flipped = signature.slice(0, middle) + (signature[middle] === 'A' ? 'B' : 'A') + signature.slice(middle + 1)
    const sessionCookie = (value: string, sig: string) => `session=${encodeURIComponent(`${value}.${sig}`)}`
    expect(sessionCookie(issuedAt, signature)).toBe(cookie)
    expect((await app.request('/api/whoami', { headers: { Cookie: sessionCookie(issuedAt, flipped) } })).status).toBe(401)
    // the issue time changed, the signature did not: the session cannot be extended
    expect((await app.request('/api/whoami', { headers: { Cookie: sessionCookie(String(Number(issuedAt) + 1000), signature) } })).status).toBe(401)
    expect((await app.request('/api/whoami', { headers: { Cookie: cookie } })).status).toBe(200)
    vi.setSystemTime(new Date('2031-11-01T00:00:01Z'))
    expect((await app.request('/api/whoami', { headers: { Cookie: cookie } })).status).toBe(401)
  })

  it('refuses a session signed with another session secret', async () => {
    const login = await (await build()).request('/api/auth/login', jsonBody({ password: PASSWORD }))
    const other = await buildWith(testConfig({ password: PASSWORD }, 'another-secret'))
    expect((await other.request('/api/whoami', { headers: { Cookie: cookieOf(login) } })).status).toBe(401)
  })

  it('logs out by clearing the cookie', async () => {
    const app = await build()
    const login = await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))
    const out = await app.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookieOf(login) } })
    expect(out.status).toBe(200)
    expect(out.headers.get('Set-Cookie')).toMatch(/^session=;.*Max-Age=0/)
    // a manager's confirmed test sign-in and a pending Telegram sign-in go too: the next person here cannot switch with them
    const cleared = out.headers.getSetCookie()
    expect(cleared).toEqual(expect.arrayContaining([expect.stringMatching(/^switch=;.*Max-Age=0.*Path=\/api\/auth-settings/), expect.stringMatching(/^login=;.*Max-Age=0.*Path=\/api\/auth\/telegram/)]))
  })

  it('answers 429 after 10 failures within a minute, then lets a new minute through', async () => {
    let now = 0
    const app = await build({}, createLoginLimiter({ now: () => now }))
    for (let i = 0; i < 10; i++) expect((await app.request('/api/auth/login', jsonBody({ password: 'nope' }))).status).toBe(401)
    const blocked = await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: { code: 'too_many_attempts' } })
    now = 60_001
    expect((await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))).status).toBe(200)
  })

  it('a right password clears the address count (as SECURITY.md says), not the global one', async () => {
    const app = await build({}, createLoginLimiter({ globalLimit: 15 }))
    for (let i = 0; i < 9; i++) expect((await app.request('/api/auth/login', jsonBody({ password: 'nope' }))).status).toBe(401)
    expect((await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))).status).toBe(200)
    for (let i = 0; i < 5; i++) expect((await app.request('/api/auth/login', jsonBody({ password: 'nope' }))).status).toBe(401)
    expect((await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))).status).toBe(429)
  })

  it.each([
    { scope: 'client', password: 'nope' },
    { scope: 'client', password: PASSWORD },
    { scope: 'global', password: 'nope' },
    { scope: 'global', password: PASSWORD },
  ])('rechecks the $scope limit after a delayed body containing "$password"', async ({ scope, password }) => {
    const limiter = createLoginLimiter({ limit: scope === 'client' ? 2 : 10, globalLimit: scope === 'global' ? 2 : 100 })
    const fail = vi.spyOn(limiter, 'fail')
    const app = await build({}, limiter)
    const from = (address: string) => ({ incoming: { socket: { remoteAddress: address } } })
    const reading = Promise.withResolvers<void>()
    let finish!: () => void
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        finish = () => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ password })))
          controller.close()
        }
      },
      pull() { reading.resolve() },
    }, { highWaterMark: 0 })
    const init: RequestInit & { duplex: string } = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' }
    const pending = app.request('/api/auth/login', init, from('203.0.113.7'))
    await reading.promise
    // This request passed its first check; finish other requests while its body is still unread.
    const address = scope === 'client' ? '203.0.113.7' : '198.51.100.4'
    for (let i = 0; i < 2; i++) {
      expect((await app.request('/api/auth/login', jsonBody({ password: 'nope' }), from(address))).status).toBe(401)
    }
    finish()
    const blocked = await pending
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: { code: 'too_many_attempts' } })
    expect(blocked.headers.get('Set-Cookie')).toBeNull()
    expect(fail).toHaveBeenCalledTimes(2)
  })

  it.each(['client', 'global'])('bounds concurrent failures by the %s limit', async scope => {
    const limiter = createLoginLimiter({ limit: scope === 'client' ? 2 : 10, globalLimit: scope === 'global' ? 2 : 100 })
    const app = await build({}, limiter)
    const responses = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      app.request('/api/auth/login', jsonBody({ password: 'nope' }), {
        incoming: { socket: { remoteAddress: scope === 'client' ? '203.0.113.7' : `203.0.113.${i + 1}` } },
      })))
    expect(responses.filter(res => res.status === 401)).toHaveLength(2)
    expect(responses.filter(res => res.status === 429)).toHaveLength(4)
    expect(responses.every(res => res.headers.get('Set-Cookie') === null)).toBe(true)
  })

  it('counts failures per client address: ten from one socket block it, another can still log in', async () => {
    const app = await build()
    const from = (address: string) => ({ incoming: { socket: { remoteAddress: address } } })
    const login = (password: string, address: string) => app.request('/api/auth/login', jsonBody({ password }), from(address))
    for (let i = 0; i < 10; i++) expect((await login('nope', '203.0.113.7')).status).toBe(401)
    expect((await login(PASSWORD, '203.0.113.7')).status).toBe(429)
    expect((await login(PASSWORD, '198.51.100.4')).status).toBe(200)
  })

  it('keys IPv6 by its /64: one /64 shares a counter, another /64 does not', async () => {
    const app = await build()
    const login = (password: string, address: string) =>
      app.request('/api/auth/login', jsonBody({ password }), { incoming: { socket: { remoteAddress: address } } })
    for (let i = 0; i < 10; i++) expect((await login('nope', `2001:db8:1:2::${i + 1}`)).status).toBe(401)
    expect((await login(PASSWORD, '2001:db8:1:2:ffff:abcd:1234:9')).status).toBe(429)
    expect((await login(PASSWORD, '2001:0db8:0001:0002:0:0:0:77')).status).toBe(429)
    expect((await login(PASSWORD, '2001:db8:1:3::1')).status).toBe(200)
  })

  it('normalises the key: an IPv4-mapped address is the plain IPv4, IPv6 becomes its /64', async () => {
    const keys: string[] = []
    const recording = { blocked: () => false, fail: (key: string) => { keys.push(key) }, reset: () => {} }
    const app = await build({ CLIENT_IP_HEADER: 'X-Forwarded-For' }, recording)
    const login = (headers: Record<string, string>, address?: string) => app.request('/api/auth/login',
      { ...jsonBody({ password: 'nope' }), headers: { 'Content-Type': 'application/json', ...headers } },
      address ? { incoming: { socket: { remoteAddress: address } } } : undefined)
    await login({}, '::ffff:203.0.113.7')
    await login({ 'X-Forwarded-For': '::FFFF:203.0.113.7' })
    await login({ 'X-Forwarded-For': '::ffff:cb00:7107' })
    await login({}, '203.0.113.7')
    await login({}, '2001:db8:aa:bb:1:2:3:4')
    await login({ 'X-Forwarded-For': 'fe80::1%eth0' })
    await login({ 'X-Forwarded-For': '::1' })
    expect(keys).toEqual(['203.0.113.7', '203.0.113.7', '203.0.113.7', '203.0.113.7', '2001:db8:aa:bb::/64', 'fe80:0:0:0::/64', '0:0:0:0::/64'])
  })

  it('keys the limiter by the rightmost CLIENT_IP_HEADER entry, else the socket, else "unknown"', async () => {
    const keys: string[] = []
    const recording = { blocked: () => false, fail: (key: string) => { keys.push(key) }, reset: () => {} }
    const app = await build({ CLIENT_IP_HEADER: 'X-Forwarded-For' }, recording)
    const socket = { incoming: { socket: { remoteAddress: '10.0.0.2' } } }
    const login = (headers: Record<string, string>, env?: object) =>
      app.request('/api/auth/login', { ...jsonBody({ password: 'nope' }), headers: { 'Content-Type': 'application/json', ...headers } }, env)
    await login({ 'X-Forwarded-For': '1.1.1.1, 2.2.2.2 ' }, socket)
    await login({}, socket)
    await login({})
    expect(keys).toEqual(['2.2.2.2', '10.0.0.2', 'unknown'])
  })

  it('does not key the limiter by an over-long CLIENT_IP_HEADER value', async () => {
    const keys: string[] = []
    const recording = { blocked: () => false, fail: (key: string) => { keys.push(key) }, reset: () => {} }
    const app = await build({ CLIENT_IP_HEADER: 'X-Forwarded-For' }, recording)
    const login = (forwarded: string) => app.request('/api/auth/login',
      { ...jsonBody({ password: 'nope' }), headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwarded } })
    await login('a'.repeat(65))
    await login('x'.repeat(5000))
    await login('2001:db8:aa:bb:1:2:3:4')
    expect(keys).toEqual(['unknown', 'unknown', '2001:db8:aa:bb::/64'])
  })

  it('refuses cross-origin writes before auth, allows same-origin ones', async () => {
    const app = await build()
    const login = await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))
    const cookie = cookieOf(login)
    expect((await app.request('http://localhost/api/write', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://attacker.example' } })).status).toBe(403)
    expect((await app.request('http://localhost/api/write', { method: 'POST', headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403)
    expect((await app.request('http://localhost/api/write', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost' } })).status).toBe(200)
    expect((await app.request('http://localhost/api/write', { method: 'POST', headers: { Cookie: cookie } })).status).toBe(200)
  })

  it('compares the host only: https Origin behind a TLS-terminating proxy passes, junk Origin does not', async () => {
    const app = await build()
    const login = await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))
    const cookie = cookieOf(login)
    const write = (origin: string) => app.request('http://finance.example/api/write', { method: 'POST', headers: { Cookie: cookie, Origin: origin } })
    expect((await write('https://finance.example')).status).toBe(200)
    expect((await write('https://attacker.example')).status).toBe(403)
    expect((await write('https://finance.example:8443')).status).toBe(403)
    expect((await write('not a url')).status).toBe(403)
  })

  it('covers login by the origin check: a cross-origin login is refused and sets no cookie', async () => {
    const app = await build()
    const res = await app.request('http://localhost/api/auth/login', {
      ...jsonBody({ password: PASSWORD }),
      headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })
})

describe('the test sign-in in password mode (the proof for the switch to Telegram)', () => {
  async function passwordWithBot() {
    const db = createTestDb()
    const logins = createLoginAttempts()
    const app = await buildWith(testConfig({ password: PASSWORD }, 'test-secret'), { db, logins, bot: 'fcbot' })
    return { app, db, logins }
  }

  it('in password mode POST /api/auth/telegram needs a signed-in caller: 401 without a session', async () => {
    const { app } = await passwordWithBot()
    const res = await app.request('/api/auth/telegram', { method: 'POST' })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized' } })
    expect(res.headers.getSetCookie()).toEqual([])
    // a session of another mode's key is no session either
    const forged = await serializeSigned('session', '1.1', createHmac('sha256', 'test-secret').update('telegram:1').digest('hex'))
    expect((await app.request('/api/auth/telegram', { method: 'POST', headers: { Cookie: forged.split(';')[0] } })).status).toBe(401)
  })

  it('in password mode the poll sets the switch cookie (path /api/auth-settings, 10 min) and no session, answering member and manage', async () => {
    const { app, db, logins } = await passwordWithBot()
    const anna = addUser(db, 'Anna', { telegramId: '100', manage: true })
    const ryan = addUser(db, 'Ryan', { telegramId: '200' })
    const session = cookieOf(await app.request('/api/auth/login', jsonBody({ password: PASSWORD })))
    const prove = async (userId: number) => {
      const start = await app.request('/api/auth/telegram', { method: 'POST', headers: { Cookie: session } })
      expect(start.status).toBe(200)
      const { link } = await start.json() as { link: string }
      expect(link).toMatch(/^https:\/\/t\.me\/fcbot\?start=login_/)
      const login = setCookieNamed(start, 'login').split(';')[0]
      const poll = () => app.request('/api/auth/telegram', { headers: { Cookie: login } })
      expect(await (await poll()).json()).toEqual({ status: 'waiting' })
      expect(logins.approve(/login_(.+)$/.exec(link)![1], userId)).toBe(true)
      return poll()
    }

    const done = await prove(anna)
    expect(done.status).toBe(200)
    expect(await done.json()).toEqual({ status: 'done', member: 'Anna', manage: true })
    expect(setCookieNamed(done, 'session')).toBe('')
    const ticket = setCookieNamed(done, 'switch')
    expect(decodeURIComponent(ticket.split(';')[0])).toMatch(new RegExp(`^switch=${anna}\\.\\d+\\.`))
    expect(ticket).toContain('Path=/api/auth-settings')
    expect(ticket).toContain('Max-Age=600')
    expect(ticket).toContain('HttpOnly')
    expect(ticket).toContain('SameSite=Lax')
    // the family session is unchanged and the mode stays
    expect(await (await app.request('/api/auth', { headers: { Cookie: session } })).json()).toMatchObject({ mode: 'password', authenticated: true })

    expect(await (await prove(ryan)).json()).toEqual({ status: 'done', member: 'Ryan', manage: false })

    // the approver re-linked since the approval: no ticket
    const { link, login } = await (async () => {
      const start = await app.request('/api/auth/telegram', { method: 'POST', headers: { Cookie: session } })
      return { link: ((await start.json()) as { link: string }).link, login: setCookieNamed(start, 'login').split(';')[0] }
    })()
    logins.approve(/login_(.+)$/.exec(link)![1], anna)
    db.sqlite.exec('UPDATE users SET telegram_id = NULL WHERE member = \'Anna\'')
    const stale = await app.request('/api/auth/telegram', { headers: { Cookie: login } })
    expect(await stale.json()).toEqual({ status: 'expired' })
    expect(setCookieNamed(stale, 'switch')).toBe('')
  })

  it.each(['bootstrap', 'none'])('in %s mode the telegram routes answer wrong_mode', async mode => {
    const app = await buildWith(testConfig(mode === 'none' ? { AUTH_MODE: 'none' } : {}, 'test-secret'), { bot: 'fcbot' })
    for (const res of [await app.request('/api/auth/telegram', { method: 'POST' }), await app.request('/api/auth/telegram')]) {
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: { code: 'wrong_mode' } })
      expect(res.headers.getSetCookie()).toEqual([])
    }
  })
})

describe('telegram mode', () => {
  const TELEGRAM = { mode: 'telegram', TELEGRAM_BOT_TOKEN: '123:token' }
  const telegramConfig = () => testConfig(TELEGRAM, 'test-secret')

  async function telegram({ bot = 'fcbot' as string | null, limiter = createLoginLimiter() } = {}) {
    const db = createTestDb()
    const logins = createLoginAttempts()
    const app = await buildWith(telegramConfig(), { db, logins, bot, limiter })
    return { app, db, logins }
  }

  /** Starts an attempt in the browser: the login cookie and the code of the deep link */
  async function start(app: Pick<Hono, 'request'>) {
    const res = await app.request('/api/auth/telegram', { method: 'POST' })
    const { link } = await res.json() as { link: string }
    return { res, link, login: setCookieNamed(res, 'login').split(';')[0], code: /login_(.+)$/.exec(link)![1] }
  }

  /** The whole flow: start, the bot confirms for the user, the browser takes the session; returns the session cookie */
  async function signIn(app: Pick<Hono, 'request'>, logins: LoginAttempts, userId: number): Promise<string> {
    const { login, code } = await start(app)
    expect(logins.approve(code, userId)).toBe(true)
    const done = await app.request('/api/auth/telegram', { headers: { Cookie: login } })
    return setCookieNamed(done, 'session').split(';')[0]
  }

  it('one address cannot fill the attempts store: its sixth live start is refused, the first still completes', async () => {
    const { app, db, logins } = await telegram()
    const anna = addUser(db, 'Anna', { telegramId: '100' })
    const first = await start(app)
    for (let i = 0; i < 4; i++) expect((await app.request('/api/auth/telegram', { method: 'POST' })).status).toBe(200)
    const refused = await app.request('/api/auth/telegram', { method: 'POST' })
    expect(refused.status).toBe(429)
    expect(await refused.json()).toEqual({ error: { code: 'sign_in_attempts_full' } })
    expect(logins.approve(first.code, anna)).toBe(true)
    expect(await (await app.request('/api/auth/telegram', { headers: { Cookie: first.login } })).json()).toEqual({ status: 'done' })
  })

  it('caps attempts per IPv6 /64: two /64s of one /48 each get their own five', async () => {
    const { app } = await telegram()
    const from = (address: string) => app.request('/api/auth/telegram', { method: 'POST' }, { incoming: { socket: { remoteAddress: address } } })
    for (let i = 0; i < 5; i++) expect((await from(`2001:db8:1:1::${i + 1}`)).status).toBe(200)
    for (let i = 0; i < 5; i++) expect((await from(`2001:db8:1:2::${i + 1}`)).status).toBe(200)
    expect((await from('2001:db8:1:1::ff')).status).toBe(429)
    expect(limiterKey('2001:0db8:0001:00ff::9', 48)).toBe('2001:db8:1::/48')
    expect(limiterKey('::ffff:203.0.113.7', 48)).toBe('203.0.113.7')
  })

  it('accepts the browser JSON empty object and completes ordinary Telegram login', async () => {
    const { app, db, logins } = await telegram()
    const anna = addUser(db, 'Anna', { telegramId: '100', manage: true })
    const started = await app.request('/api/auth/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(started.status).toBe(200)
    const { attempt, link } = await started.json() as { attempt: string; link: string }
    expect(link).toBe(`https://t.me/fcbot?start=login_${attempt}`)
    expect(logins.approve(attempt, anna)).toBe(true)
    const done = await app.request('/api/auth/telegram', { headers: { Cookie: setCookieNamed(started, 'login').split(';')[0] } })
    expect(await done.json()).toEqual({ status: 'done' })
    expect(setCookieNamed(done, 'session')).not.toBe('')
    db.close()
  })

  it('the telegram login flow', async () => {
    const { app, db, logins } = await telegram()
    const anna = addUser(db, 'Anna', { telegramId: '100', manage: true })
    const { res, link, login, code } = await start(app)
    expect(res.status).toBe(200)
    expect(link).toBe(`https://t.me/fcbot?start=login_${code}`)
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const line = setCookieNamed(res, 'login')
    expect(line).toContain('HttpOnly')
    expect(line).toContain('SameSite=Lax')
    expect(line).toContain('Max-Age=300')
    expect(setCookieNamed(res, 'session')).toBe('')

    const poll = () => app.request('/api/auth/telegram', { headers: { Cookie: login } })
    const waiting = await poll()
    expect(await waiting.json()).toEqual({ status: 'waiting' })
    expect(waiting.headers.getSetCookie()).toEqual([])

    logins.approve(code, anna)
    const done = await poll()
    expect(await done.json()).toEqual({ status: 'done' })
    const session = setCookieNamed(done, 'session')
    expect(session).toContain('HttpOnly')
    expect(session).toContain('SameSite=Lax')
    expect(session).toContain(`Max-Age=${30 * 24 * 3600}`)
    expect(decodeURIComponent(session.split(';')[0])).toMatch(new RegExp(`^session=${anna}\\.\\d+\\.`))
    expect(setCookieNamed(done, 'login')).toMatch(/^login=;.*Max-Age=0/)
    const auth = await app.request('/api/auth', { headers: { Cookie: session.split(';')[0] } })
    expect(await auth.json()).toMatchObject({ mode: 'telegram', authenticated: true })

    // single-use: the same login cookie cannot take a second session
    expect(await (await poll()).json()).toEqual({ status: 'expired' })
  })

  it('telegram mode: the session names the user and carries their rights', async () => {
    const { app, db, logins } = await telegram()
    const anna = addUser(db, 'Anna', { telegramId: '100' })
    const cookie = await signIn(app, logins, anna)
    expect(await (await app.request('/api/auth', { headers: { Cookie: cookie } })).json()).toEqual({
      mode: 'telegram', authenticated: true, language: 'en-US', me: { name: 'Anna', rights: { edit: true, vote: true, manage: false } },
    })
    expect(await (await app.request('/api/whoami', { headers: { Cookie: cookie } })).json()).toEqual({
      actor: { name: 'Anna', source: 'admin', rights: { edit: true, vote: true, manage: false }, userId: anna },
    })
  })

  it('rights are read on every request', async () => {
    const { app, db, logins } = await telegram()
    const anna = addUser(db, 'Anna', { telegramId: '100' })
    const cookie = await signIn(app, logins, anna)
    const edit = () => app.request('/api/edit', { method: 'POST', headers: { Cookie: cookie } })
    expect((await edit()).status).toBe(200)
    db.sqlite.exec('UPDATE users SET can_edit = 0')
    const refused = await edit()
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: { code: 'no_right_edit' } })
    db.sqlite.exec('DELETE FROM users')
    expect((await edit()).status).toBe(401)
    expect((await app.request('/api/whoami', { headers: { Cookie: cookie } })).status).toBe(401)
    expect(await (await app.request('/api/auth', { headers: { Cookie: cookie } })).json()).toEqual({ mode: 'telegram', authenticated: false, language: 'en-US', me: null })
  })

  it('a session ends when the Telegram account is unlinked', async () => {
    const { app, db, logins } = await telegram()
    const anna = addUser(db, 'Anna', { telegramId: '100' })
    const cookie = await signIn(app, logins, anna)
    expect((await app.request('/api/whoami', { headers: { Cookie: cookie } })).status).toBe(200)
    db.sqlite.exec('UPDATE users SET telegram_id = NULL')
    expect((await app.request('/api/whoami', { headers: { Cookie: cookie } })).status).toBe(401)
  })

  it('linking a Telegram account ends the sessions issued before it; a new sign-in works', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2031-10-01T10:00:00Z'))
    const { app, db, logins } = await telegram()
    const ryan = addUser(db, 'Ryan', { telegramId: '100' })
    const whoami = (cookie: string) => app.request('/api/whoami', { headers: { Cookie: cookie } })
    // linked before telegram_linked_at existed (NULL): the session works as before
    const old = await signIn(app, logins, ryan)
    expect((await whoami(old)).status).toBe(200)
    // a manager re-invites Ryan and the link is opened from another Telegram account
    vi.setSystemTime(new Date('2031-10-01T10:01:00Z'))
    const { link } = await issueInvite(db, ryan, 'fcbot')
    expect(await acceptInvite(db, /link_(.+)$/.exec(link)![1], { id: '200', name: null })).toMatchObject({ status: 'linked' })
    expect((await whoami(old)).status).toBe(401)
    vi.setSystemTime(new Date('2031-10-01T10:02:00Z'))
    const fresh = await signIn(app, logins, ryan)
    expect((await whoami(fresh)).status).toBe(200)
    expect((await whoami(old)).status).toBe(401)
  })

  it('a bot approval from before a re-link does not become a session after it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2031-10-01T10:00:00Z'))
    const { app, db, logins } = await telegram()
    const ryan = addUser(db, 'Ryan', { telegramId: '100' })
    const { login, code } = await start(app)
    // the old account confirms in the bot, then the member is re-linked before the browser polls
    expect(logins.approve(code, ryan)).toBe(true)
    vi.setSystemTime(new Date('2031-10-01T10:01:00Z'))
    const { link } = await issueInvite(db, ryan, 'fcbot')
    expect(await acceptInvite(db, /link_(.+)$/.exec(link)![1], { id: '200', name: null })).toMatchObject({ status: 'linked' })
    const poll = await app.request('/api/auth/telegram', { headers: { Cookie: login } })
    expect(await poll.json()).toEqual({ status: 'expired' })
    expect(setCookieNamed(poll, 'session')).toBe('')
  })

  it('a session does not pass to a later user who got the same id', async () => {
    const { app, db, logins } = await telegram()
    const anna = addUser(db, 'Anna', { telegramId: '100' })
    const cookie = await signIn(app, logins, anna)
    expect((await app.request('/api/whoami', { headers: { Cookie: cookie } })).status).toBe(200)
    db.sqlite.exec('DELETE FROM users')
    const later = new Date(Date.now() + 1000).toISOString()
    db.sqlite.prepare("INSERT INTO users (id, member, telegram_id, created_at, updated_at) VALUES (?, 'Boris', '200', ?, ?)").run(anna, later, later)
    expect((await app.request('/api/whoami', { headers: { Cookie: cookie } })).status).toBe(401)
  })

  it('telegram mode has no password login: 409 wrong_mode', async () => {
    const { app, db, logins } = await telegram()
    const cookie = await signIn(app, logins, addUser(db, 'Anna', { telegramId: '100' }))
    const res = await app.request('/api/auth/login', { ...jsonBody({ password: PASSWORD }), headers: { 'Content-Type': 'application/json', Cookie: cookie } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'wrong_mode' } })
    expect(setCookieNamed(res, 'session')).toBe('')
  })

  it('refuses the API without a session, and a family-password session', async () => {
    const { app, db } = await telegram()
    addUser(db, 'Anna', { telegramId: '100' })
    expect((await app.request('/api/whoami')).status).toBe(401)
    // a password-mode session signed with the same secret does not open telegram mode
    const login = await (await build()).request('/api/auth/login', jsonBody({ password: PASSWORD }))
    expect((await app.request('/api/whoami', { headers: { Cookie: cookieOf(login) } })).status).toBe(401)
  })

  it('a session expires after 30 days', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2031-10-01T00:00:00Z'))
    const { app, db, logins } = await telegram()
    const cookie = await signIn(app, logins, addUser(db, 'Anna', { telegramId: '100' }))
    expect((await app.request('/api/whoami', { headers: { Cookie: cookie } })).status).toBe(200)
    vi.setSystemTime(new Date('2031-11-01T00:00:01Z'))
    expect((await app.request('/api/whoami', { headers: { Cookie: cookie } })).status).toBe(401)
  })

  it('polling without the login cookie, or with a forged one, never takes the session', async () => {
    const { app, db, logins } = await telegram()
    const anna = addUser(db, 'Anna', { telegramId: '100' })
    const { login, code } = await start(app)
    logins.approve(code, anna)
    const poll = (cookie?: string) => app.request('/api/auth/telegram', cookie ? { headers: { Cookie: cookie } } : {})
    expect(await (await poll()).json()).toEqual({ status: 'expired' })
    // the code is public (it is in the link); an unsigned cookie with it is ignored
    const forged = await poll(`login=${encodeURIComponent(`${code}.anything`)}`)
    expect(await forged.json()).toEqual({ status: 'expired' })
    expect(setCookieNamed(forged, 'session')).toBe('')
    // another browser's own attempt cannot take this one
    const other = await start(app)
    expect(await (await poll(other.login)).json()).toEqual({ status: 'waiting' })
    expect(await (await poll(login)).json()).toEqual({ status: 'done' })
  })

  it('answers 409 bot_not_configured without a bot username, and sets no cookie', async () => {
    const { app } = await telegram({ bot: null })
    const res = await app.request('/api/auth/telegram', { method: 'POST' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'bot_not_configured' } })
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('limits starts per client with the login limiter', async () => {
    const { app } = await telegram({ limiter: createLoginLimiter({ limit: 2 }) })
    const from = (address: string) => ({ incoming: { socket: { remoteAddress: address } } })
    const begin = (address: string) => app.request('/api/auth/telegram', { method: 'POST' }, from(address))
    expect((await begin('203.0.113.7')).status).toBe(200)
    expect((await begin('203.0.113.7')).status).toBe(200)
    const blocked = await begin('203.0.113.7')
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: { code: 'too_many_attempts' } })
    expect(blocked.headers.getSetCookie()).toEqual([])
    expect((await begin('198.51.100.4')).status).toBe(200)
  })

  it('starts from many addresses never reach the global ceiling: the family can still start one', async () => {
    const { app } = await telegram({ limiter: createLoginLimiter({ limit: 2, globalLimit: 3 }) })
    const from = (address: string) => ({ incoming: { socket: { remoteAddress: address } } })
    const begin = (address: string) => app.request('/api/auth/telegram', { method: 'POST' }, from(address))
    for (const address of ['203.0.113.1', '203.0.113.1', '203.0.113.2', '203.0.113.2', '203.0.113.3', '203.0.113.3']) expect((await begin(address)).status).toBe(200)
    expect((await begin('198.51.100.4')).status).toBe(200)
  })

  it('refuses a cross-origin start', async () => {
    const { app } = await telegram()
    const res = await app.request('http://localhost/api/auth/telegram', { method: 'POST', headers: { Origin: 'https://attacker.example' } })
    expect(res.status).toBe(403)
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('logs out by clearing the session cookie', async () => {
    const { app, db, logins } = await telegram()
    const cookie = await signIn(app, logins, addUser(db, 'Anna', { telegramId: '100' }))
    const out = await app.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } })
    expect(out.status).toBe(200)
    expect(setCookieNamed(out, 'session')).toMatch(/^session=;.*Max-Age=0/)
  })
})

describe('the live sign-in runtime', () => {
  const FAMILY_ACTOR: Actor = { name: 'family', source: 'admin', rights: ALL, userId: null }
  const NEW_PASSWORD = 'a long family password'
  const from = (address: string) => ({ incoming: { socket: { remoteAddress: address } } })
  /** No stored auth fixtures: bootstrap on a fresh database. */
  const appManaged = (deps: Deps = {}) => harness(testConfig({}, 'test-secret'), deps)
  const authOf = async (app: Pick<Hono, 'request'>, cookie?: string) =>
    (await app.request('/api/auth', cookie ? { headers: { Cookie: cookie } } : {})).json()

  it('a session issued before a password change is 401 after it', async () => {
    const { app, auth } = await appManaged()
    await auth.setPassword(PASSWORD, FAMILY_ACTOR)
    const login = await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))
    expect(login.status).toBe(200)
    expect((await app.request('/api/whoami', { headers: { Cookie: cookieOf(login) } })).status).toBe(200)
    await auth.setPassword(NEW_PASSWORD, FAMILY_ACTOR)
    expect((await app.request('/api/whoami', { headers: { Cookie: cookieOf(login) } })).status).toBe(401)
    expect((await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))).status).toBe(401)
    expect((await app.request('/api/auth/login', jsonBody({ password: NEW_PASSWORD }))).status).toBe(200)
  })

  it('a password change committed while a login verifies the old password: wrong_password, no session', async () => {
    const { app, auth } = await appManaged()
    await auth.setPassword(PASSWORD, FAMILY_ACTOR)
    const verify = auth.verifyPassword.bind(auth)
    // the change lands between the hash read and the answer of the old password's scrypt
    vi.spyOn(auth, 'verifyPassword').mockImplementationOnce(async given => {
      const ok = await verify(given)
      await auth.setPassword(NEW_PASSWORD, FAMILY_ACTOR)
      return ok
    })
    const res = await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'wrong_password' } })
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('a cookie signed with the old HMAC(secret, password) key is 401 (the upgrade signs everyone out once)', async () => {
    const { app, auth } = await harness(testConfig({ password: PASSWORD }, 'test-secret'))
    const signed = async (key: string) => (await serializeSigned('session', String(Date.now()), key, { path: '/' })).split(';')[0]
    const oldKey = createHmac('sha256', 'test-secret').update(PASSWORD).digest('hex')
    expect((await app.request('/api/whoami', { headers: { Cookie: await signed(oldKey) } })).status).toBe(401)
    // the same value under the runtime's key is a session: only the key differs
    expect((await app.request('/api/whoami', { headers: { Cookie: await signed(auth.signingKey()) } })).status).toBe(200)
  })

  it('concurrent wrong logins against the app-stored hash run at most `limit` scrypt verifications', async () => {
    const { app, auth } = await appManaged({ limiter: createLoginLimiter({ limit: 2 }) })
    await auth.setPassword(PASSWORD, FAMILY_ACTOR)
    const verify = vi.spyOn(auth, 'verifyPassword')
    const responses = await Promise.all(Array.from({ length: 20 }, () =>
      app.request('/api/auth/login', jsonBody({ password: 'wrong guess' }), from('203.0.113.7'))))
    expect(verify).toHaveBeenCalledTimes(2)
    expect(responses.filter(res => res.status === 401)).toHaveLength(2)
    expect(responses.filter(res => res.status === 429)).toHaveLength(18)
  })

  it('a right password clears the client\'s count: failures before it do not add up with failures after it', async () => {
    const { app } = await harness(testConfig({ password: PASSWORD }, 'test-secret'), { limiter: createLoginLimiter({ limit: 3 }) })
    const login = (password: string) => app.request('/api/auth/login', jsonBody({ password }), from('203.0.113.7'))
    expect((await login('nope')).status).toBe(401)
    expect((await login('nope')).status).toBe(401)
    expect((await login(PASSWORD)).status).toBe(200)
    for (let i = 0; i < 3; i++) expect((await login('nope')).status).toBe(401)
    expect((await login(PASSWORD)).status).toBe(429)
  })

  it('bootstrap: GET /api/auth says mode bootstrap, bootstrapOpen true, authenticated false; every other /api/* is 401', async () => {
    const { app } = await appManaged()
    expect(await authOf(app)).toEqual({ mode: 'bootstrap', authenticated: false, language: 'en-US', me: null, bootstrapOpen: true })
    expect((await app.request('/api/whoami')).status).toBe(401)
    expect((await app.request('/api/write', { method: 'POST' })).status).toBe(401)
    expect((await app.request('/api/auth/logout', { method: 'POST' })).status).toBe(200)
  })

  it('POST /api/auth/bootstrap stores the password, answers ok with a session cookie; GET /api/auth then says password + authenticated', async () => {
    const { app, auth } = await appManaged()
    const res = await app.request('/api/auth/bootstrap', jsonBody({ password: NEW_PASSWORD }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const cookie = setCookieNamed(res, 'session')
    expect(cookie).toMatch(/^session=\d+\./)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(await authOf(app, cookie.split(';')[0])).toEqual({ mode: 'password', authenticated: true, language: 'en-US', me: { name: null, rights: ALL } })
    expect(await auth.verifyPassword(NEW_PASSWORD)).toBe(true)
    expect((await app.request('/api/auth/login', jsonBody({ password: NEW_PASSWORD }))).status).toBe(200)
  })

  it('POST /api/auth/bootstrap refuses a short or missing password with nothing stored', async () => {
    const { app, auth } = await appManaged()
    for (const body of [{ password: 'too short' }, { password: 12 }, {}]) {
      const res = await app.request('/api/auth/bootstrap', jsonBody(body))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: { code: 'password_too_short' } })
      expect(res.headers.getSetCookie()).toEqual([])
    }
    expect(auth.mode()).toBe('bootstrap')
  })

  it('POST /api/auth/bootstrap outside bootstrap is 409 not_in_bootstrap; after 15 minutes 409 bootstrap_closed and bootstrapOpen false', async () => {
    const outside = await build()
    const refused = await outside.request('/api/auth/bootstrap', jsonBody({ password: NEW_PASSWORD }))
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: { code: 'not_in_bootstrap' } })
    expect(refused.headers.getSetCookie()).toEqual([])

    let clock = Date.parse('2031-10-19T10:00:00Z')
    const { app, auth } = await appManaged({ now: () => clock })
    clock += BOOTSTRAP_WINDOW_MS
    expect(await authOf(app)).toMatchObject({ mode: 'bootstrap', bootstrapOpen: false })
    const closed = await app.request('/api/auth/bootstrap', jsonBody({ password: NEW_PASSWORD }))
    expect(closed.status).toBe(409)
    expect(await closed.json()).toEqual({ error: { code: 'bootstrap_closed' } })
    expect(closed.headers.getSetCookie()).toEqual([])
    expect(auth.mode()).toBe('bootstrap')
  })

  it('POST /api/auth/bootstrap counts every call in the login limiter: the 11th from one address is 429', async () => {
    const { app } = await appManaged()
    const call = (address: string) => app.request('/api/auth/bootstrap', jsonBody({ password: NEW_PASSWORD }), from(address))
    expect((await call('203.0.113.7')).status).toBe(200)
    for (let i = 0; i < 9; i++) expect((await call('203.0.113.7')).status).toBe(409)
    const blocked = await call('203.0.113.7')
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: { code: 'too_many_attempts' } })
    expect((await call('198.51.100.4')).status).toBe(409)
  })

  it('the bootstrap call and the password login share one limiter', async () => {
    const limiter = createLoginLimiter({ limit: 2 })
    const { app } = await harness(testConfig({ password: PASSWORD }, 'test-secret'), { limiter })
    expect((await app.request('/api/auth/bootstrap', jsonBody({ password: NEW_PASSWORD }), from('203.0.113.7'))).status).toBe(409)
    expect((await app.request('/api/auth/login', jsonBody({ password: 'nope' }), from('203.0.113.7'))).status).toBe(401)
    expect((await app.request('/api/auth/login', jsonBody({ password: PASSWORD }), from('203.0.113.7'))).status).toBe(429)
  })

  it('POST /api/auth/bootstrap refuses a cross-origin call', async () => {
    const { app, auth } = await appManaged()
    const res = await app.request('http://localhost/api/auth/bootstrap', {
      ...jsonBody({ password: NEW_PASSWORD }), headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    })
    expect(res.status).toBe(403)
    expect(res.headers.getSetCookie()).toEqual([])
    expect(auth.mode()).toBe('bootstrap')
  })

  it('routes are mounted in every family mode: login in telegram mode, bootstrap login → 409 wrong_mode', async () => {
    const telegram = await buildWith(testConfig({ mode: 'telegram', TELEGRAM_BOT_TOKEN: '123:token' }, 'test-secret'), { bot: 'fcbot' })
    const { app: bootstrap } = await appManaged({ bot: 'fcbot' })
    for (const res of [
      await telegram.request('/api/auth/login', jsonBody({ password: PASSWORD })),
      await bootstrap.request('/api/auth/login', jsonBody({ password: PASSWORD })),
      await bootstrap.request('/api/auth/telegram', { method: 'POST' }),
    ]) {
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: { code: 'wrong_mode' } })
      expect(res.headers.getSetCookie()).toEqual([])
    }
  })

  it('a mode switched at runtime takes effect without a new app: password session works, setMode telegram → the same cookie is 401', async () => {
    const db = createTestDb()
    const { app, auth } = await harness(testConfig({ password: PASSWORD }, 'test-secret'), { db, bot: 'fcbot' })
    const login = await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))
    expect((await app.request('/api/whoami', { headers: { Cookie: cookieOf(login) } })).status).toBe(200)
    // password mode: the telegram start is the test sign-in, for the signed-in family only
    expect((await app.request('/api/auth/telegram', { method: 'POST' })).status).toBe(401)
    await auth.setMode('telegram', FAMILY_ACTOR)
    expect((await app.request('/api/whoami', { headers: { Cookie: cookieOf(login) } })).status).toBe(401)
    expect(await authOf(app, cookieOf(login))).toMatchObject({ mode: 'telegram', authenticated: false })
    // the telegram routes answer now, the password login does not
    expect((await app.request('/api/auth/telegram', { method: 'POST' })).status).toBe(200)
    expect((await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))).status).toBe(409)
  })

  it('a stale cookie in bootstrap state answers GET /api/auth without a 500', async () => {
    const db = createTestDb()
    const { app, auth } = await appManaged({ db })
    await auth.setPassword(PASSWORD, FAMILY_ACTOR)
    const login = await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))
    expect(login.status).toBe(200)
    // the reset-password command clears the password and signals the server
    resetPasswordRows(db.sqlite, testConfig({}, 'test-secret'), { name: 'reset-password', source: 'config', rights: { edit: false, vote: false, manage: false }, userId: null })
    auth.reload()
    const res = await app.request('/api/auth', { headers: { Cookie: cookieOf(login) } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mode: 'bootstrap', authenticated: false, language: 'en-US', me: null, bootstrapOpen: true })
    expect((await app.request('/api/whoami', { headers: { Cookie: cookieOf(login) } })).status).toBe(401)
  })

  it('issueSession signs for the live mode and refuses a user outside telegram mode, or no user in it', async () => {
    const { auth } = await harness(testConfig({ password: PASSWORD }, 'test-secret'))
    const app = new Hono()
    app.post('/issue/:user', async c => {
      const user = c.req.param('user')
      try {
        await issueSession(c, auth, testConfig({}, 'test-secret'), user === 'none' ? null : { userId: Number(user) })
      } catch (error) { return c.json({ error: String(error) }, 500) }
      return withCookies(c, c.json({ ok: true }))
    })
    const family = await app.request('/issue/none', { method: 'POST' })
    expect(decodeURIComponent(setCookieNamed(family, 'session'))).toMatch(/^session=\d+\./)
    expect((await app.request('/issue/7', { method: 'POST' })).status).toBe(500)
    await auth.setMode('telegram', FAMILY_ACTOR)
    expect((await app.request('/issue/none', { method: 'POST' })).status).toBe(500)
    expect(decodeURIComponent(setCookieNamed(await app.request('/issue/7', { method: 'POST' }), 'session'))).toMatch(/^session=7\.\d+\./)
  })
})

describe('demo mode', () => {
  // inside a sandbox: the outer demo router has already checked the visitor's session
  const demo = () => build({ AUTH_MODE: 'demo' })

  it('lets every request through as the demo actor', async () => {
    const me = await (await demo()).request('/api/whoami')
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({ actor: { name: 'demo', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null } })
  })

  it('registers no /api/auth routes: the outer router owns them', async () => {
    const app = await demo()
    expect((await app.request('/api/auth')).status).toBe(404)
    expect((await app.request('/api/auth/login', jsonBody({ password: 'demo-family' }))).status).toBe(404)
    expect((await app.request('/api/auth/logout', { method: 'POST' })).status).toBe(404)
  })

  it('keeps the origin check on writes', async () => {
    const app = await demo()
    expect((await app.request('/api/write', { method: 'POST', headers: { Origin: 'https://attacker.example' } })).status).toBe(403)
    expect((await app.request('/api/write', { method: 'POST' })).status).toBe(200)
  })
})

describe('actorOfUser', () => {
  const T = Date.parse('2031-10-01T10:00:00.000Z')
  const user = (createdAt: string, linkedAt: string | null) => {
    const db = createTestDb()
    db.sqlite.prepare("INSERT INTO users (id, member, telegram_id, telegram_linked_at, created_at, updated_at) VALUES (1, 'Ryan', '100', ?, ?, ?)")
      .run(linkedAt, createdAt, createdAt)
    return db
  }
  const name = async (db: TestDb, issuedAt: number) => (await actorOfUser(db, 1, issuedAt))?.name ?? null

  it('accepts a credential only when issued strictly after the link and the creation of the user', async () => {
    const linked = user('2020-01-01T00:00:00.000Z', new Date(T).toISOString())
    expect(await name(linked, T - 1)).toBeNull()
    expect(await name(linked, T)).toBeNull()
    expect(await name(linked, T + 1)).toBe('Ryan')
    const created = user(new Date(T).toISOString(), null)
    expect(await name(created, T)).toBeNull()
    expect(await name(created, T + 1)).toBe('Ryan')
  })

  it('fails closed on an unreadable time', async () => {
    expect(await name(user('2020-01-01T00:00:00.000Z', 'garbage'), T)).toBeNull()
    expect(await name(user('garbage', null), T)).toBeNull()
  })
})

describe('helpers', () => {
  it('loadSessionSecret uses the env value, else creates DATA_DIR/session.key once with mode 0600', () => {
    const dataDir = tempDir()
    const config = loadConfig({ DATA_DIR: dataDir })
    expect(loadSessionSecret({ ...config, sessionSecret: 'from-env' })).toBe('from-env')
    const created = loadSessionSecret(config)
    expect(created).toMatch(/^[0-9a-f]{64}$/)
    expect(readFileSync(join(dataDir, 'session.key'), 'utf8')).toBe(created)
    expect(statSync(join(dataDir, 'session.key')).mode & 0o777).toBe(0o600)
    expect(loadSessionSecret(config)).toBe(created)
  })

  it('login with no password anywhere is bootstrap state: 409 wrong_mode, never a comparison against an empty string', async () => {
    const config = testConfig({}, 'test-secret')
    const app = await buildWith(config)
    const res = await app.request('/api/auth/login', jsonBody({ password: '' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'wrong_mode' } })
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it('loadSessionSecret takes the key of a concurrent start instead of overwriting it', () => {
    const dataDir = tempDir()
    const file = join(dataDir, 'session.key')
    // another process creates the file between our check and our write
    race.before = () => writeFileSync(file, 'b'.repeat(64))
    try {
      expect(loadSessionSecret(loadConfig({ DATA_DIR: dataDir }))).toBe('b'.repeat(64))
    } finally { race.before = null }
    expect(readFileSync(file, 'utf8')).toBe('b'.repeat(64))
  })

  it('loadSessionSecret treats an empty or blank session.key as missing and writes a new key', () => {
    const dataDir = tempDir()
    writeFileSync(join(dataDir, 'session.key'), '  \n')
    const config = loadConfig({ DATA_DIR: dataDir })
    const created = loadSessionSecret(config)
    expect(created).toMatch(/^[0-9a-f]{64}$/)
    expect(readFileSync(join(dataDir, 'session.key'), 'utf8')).toBe(created)
  })
})

describe('createLoginLimiter', () => {
  it('blocks a key after `limit` failures within the window and leaves other keys alone', () => {
    let now = 0
    const limiter = createLoginLimiter({ now: () => now })
    for (let i = 0; i < 10; i++) limiter.fail('a')
    expect(limiter.blocked('a')).toBe(true)
    expect(limiter.blocked('b')).toBe(false)
    now = 60_000
    expect(limiter.blocked('a')).toBe(false)
  })

  it('blocks every key once globalLimit failures from distinct keys hit one window, until the window ends', () => {
    let now = 0
    const limiter = createLoginLimiter({ now: () => now })
    for (let i = 0; i < 99; i++) limiter.fail(`198.51.100.${i}`)
    expect(limiter.blocked('fresh')).toBe(false)
    limiter.fail('198.51.100.99')
    expect(limiter.blocked('fresh')).toBe(true)
    expect(limiter.blocked('198.51.100.0')).toBe(true)
    now = 60_000
    expect(limiter.blocked('fresh')).toBe(false)
    expect(limiter.blocked('198.51.100.0')).toBe(false)
  })

  it('a failure counted with global false (a Telegram start, the bootstrap) blocks its key only, never everyone', () => {
    const limiter = createLoginLimiter({ globalLimit: 3, limit: 2, now: () => 0 })
    for (const key of ['a', 'b', 'c', 'd']) { limiter.fail(key, false); limiter.fail(key, false) }
    expect(limiter.blocked('a')).toBe(true)
    expect(limiter.blocked('fresh')).toBe(false)
  })

  it('takes globalLimit as an option; reset(key) does not lift the global block', () => {
    const limiter = createLoginLimiter({ globalLimit: 3, now: () => 0 })
    for (const key of ['a', 'b', 'c']) limiter.fail(key)
    limiter.reset('a')
    expect(limiter.blocked('a')).toBe(true)
  })

  it('reset(key) clears that key only', () => {
    const limiter = createLoginLimiter({ limit: 2 })
    for (const key of ['a', 'b']) { limiter.fail(key); limiter.fail(key) }
    limiter.reset('a')
    expect(limiter.blocked('a')).toBe(false)
    expect(limiter.blocked('b')).toBe(true)
  })

  it('keeps at most maxKeys addresses: the oldest is evicted', () => {
    const limiter = createLoginLimiter({ limit: 1, now: () => 0, maxKeys: 3 })
    for (const key of ['a', 'b', 'c', 'd']) limiter.fail(key)
    expect(['a', 'b', 'c', 'd'].map(key => limiter.blocked(key))).toEqual([false, true, true, true])
  })

  it('a window that starts again counts as the newest key', () => {
    let now = 0
    const limiter = createLoginLimiter({ limit: 1, now: () => now, maxKeys: 3 })
    limiter.fail('a')
    now = 10_000
    limiter.fail('b')
    now = 20_000
    limiter.fail('c')
    now = 61_000
    limiter.fail('a')
    limiter.fail('d')
    expect(['a', 'b', 'c', 'd'].map(key => limiter.blocked(key))).toEqual([true, false, true, true])
  })
})


describe('explicit no-auth mode', () => {
  it('grants anonymous full access without a cookie, retains same-origin protection and refuses login', async () => {
    const app = await build({ AUTH_MODE: 'none' })
    const response = await app.request('/api/auth')
    expect(await response.json()).toMatchObject({ mode: 'none', authenticated: true, me: { name: null, rights: ALL } })
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect((await app.request('/api/whoami')).status).toBe(200)
    expect((await app.request('/api/edit', jsonBody({}))).status).toBe(200)
    expect((await app.request('/api/edit', { ...jsonBody({}), headers: { Origin: 'https://other.example' } })).status).toBe(403)
    expect((await app.request('/api/auth/login', jsonBody({ password: PASSWORD }))).status).toBe(409)
    expect((await app.request('/api/auth/bootstrap', jsonBody({ password: PASSWORD }))).status).toBe(409)
  })

  it('the environment override keeps stored auth and removing it restores sign-in', async () => {
    const db = createTestDb()
    const original = await loadTestAuthRuntime(db, testConfig({ password: PASSWORD }, 'test-secret'), { log: () => {} })
    const saved = db.sqlite.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'auth_%' ORDER BY key").all()
    const none = await loadTestAuthRuntime(db, testConfig({ AUTH_MODE: 'none' }, 'test-secret'), { log: () => {} })
    expect(none.mode()).toBe('none')
    expect(none.locked()).toBe(true)
    expect(none.bootstrapOpen()).toBe(false)
    expect(none.generation()).toBe(original.generation())
    expect(await none.verifyPassword(PASSWORD)).toBe(true)
    expect(db.sqlite.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'auth_%' ORDER BY key").all()).toEqual(saved)
    const restored = await harness(testConfig({}, 'test-secret'), { db })
    expect(restored.auth.mode()).toBe('password')
    expect(await restored.auth.verifyPassword(PASSWORD)).toBe(true)
    expect((await restored.app.request('/api/whoami')).status).toBe(401)
  })
})

describe('actorOfMember', () => {
  it('acts as a named member without a linked Telegram account, with the current rights', async () => {
    const db = createTestDb()
    const id = addUser(db, 'Ryan', { manage: true })
    expect(await actorOfMember(db, 'Ryan', 'mcp')).toEqual({ name: 'Ryan', source: 'mcp', rights: { edit: true, vote: true, manage: true }, userId: id })
    db.sqlite.exec("UPDATE users SET can_edit = 0 WHERE member = 'Ryan'")
    expect((await actorOfMember(db, 'Ryan', 'mcp'))?.rights.edit).toBe(false)
    expect(await actorOfMember(db, 'Nobody', 'mcp')).toBeNull()
  })
})
