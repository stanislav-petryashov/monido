import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEMO_FAMILY_CARDS } from '../../../src/demo/family'
import { LANGUAGES } from '../../../src/i18n/languages'
import { createDemoApp } from '../../../src/server/demo/app'
import { createSandboxPool, type OpenResult } from '../../../src/server/demo/pool'
import { mountStatic } from '../../../src/server/static'
import { buildTemplate } from '../../../src/server/demo/template'
import { SCHEMA_FILE, testConfig } from '../../helpers/db'
import { withTempDirs } from '../../helpers/tmp'

const MINUTE = 60_000
const PASSWORD = 'demo-family'
const ORIGIN = 'http://localhost'

let templateDir: string
let template: string
beforeAll(() => {
  templateDir = mkdtempSync(join(tmpdir(), 'demo-app-template-'))
  template = buildTemplate({ dir: templateDir, schemaFile: SCHEMA_FILE, today: '2026-10-21' })
})
afterAll(() => { rmSync(templateDir, { recursive: true, force: true }) })

// registered before the afterEach below, so it runs after it: the pools close before their folders go
const tempDir = withTempDirs('demo-app-')
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup.splice(0)) f()
})

const config = (env: Record<string, string> = {}) =>
  testConfig({ AUTH_MODE: 'demo', CLIENT_IP_HEADER: 'X-Forwarded-For', DEMO_INSTALL_URL: 'https://example.com/install', ...env }, 'demo-secret')

/** A demo router over a pool on a fresh directory, with a clock the test moves. */
function makeDemo({ secret = 'router-secret', capacity, maxBytes }: { secret?: string; capacity?: number; maxBytes?: number } = {}) {
  const clock = { t: 0 }
  const cfg = config()
  const pool = createSandboxPool({ dir: tempDir(), templatePath: () => template, config: cfg, capacity, maxBytes, now: () => clock.t })
  cleanup.push(() => { pool.closeAll() })
  return { clock, pool, app: createDemoApp({ config: cfg, pool, secret }) }
}

type App = ReturnType<typeof createDemoApp>

/** Every Set-Cookie of an answer as name → "name=value". */
function cookiesOf(res: Response): Record<string, string> {
  return Object.fromEntries(res.headers.getSetCookie().map(c => {
    const pair = c.split(';')[0]
    return [pair.split('=')[0], pair]
  }))
}

interface Visitor { cookies: Record<string, string>; ip: string }

function send(app: App, who: Visitor, path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const cookie = Object.values(who.cookies).join('; ')
  return app.request(path, {
    method,
    headers: {
      'X-Forwarded-For': who.ip,
      ...(method === 'GET' ? {} : { Origin: ORIGIN }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** Signs a visitor in and keeps the cookies the answer set. */
async function signIn(app: App, who: Visitor, password = PASSWORD, language?: string): Promise<Response> {
  const res = await send(app, who, '/api/auth/login', 'POST', { password, ...(language ? { language } : {}) })
  Object.assign(who.cookies, cookiesOf(res))
  return res
}

const visitor = (ip = '10.0.0.1'): Visitor => ({ cookies: {}, ip })

async function currencies(app: App, who: Visitor): Promise<string[]> {
  const res = await send(app, who, '/api/admin/currencies')
  expect(res.status).toBe(200)
  return (await res.json() as { rows: { code: string }[] }).rows.map(r => r.code)
}

describe('createDemoApp', () => {
  it('answers health without a sandbox', async () => {
    const { app } = makeDemo()
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('tells crawlers to stay out', async () => {
    const { app } = makeDemo()
    const res = await app.request('/robots.txt')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/)
    expect(await res.text()).toBe('User-agent: *\nDisallow: /\n')
  })

  it('has no sitemap', async () => {
    const { app } = makeDemo()
    expect((await app.request('/sitemap.xml')).status).toBe(404)
  })

  it('marks every answer noindex', async () => {
    const { app } = makeDemo()
    const res = await app.request('/api/health')
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })

  it('keeps crawlers out with the static layer mounted', async () => {
    const { app } = makeDemo()
    const client = tempDir()
    mkdirSync(join(client, 'assets'))
    writeFileSync(join(client, 'index.html'), '<!doctype html><html><body>spa</body></html>')
    writeFileSync(join(client, 'assets', 'x.js'), 'export {}')
    mountStatic(app, client)

    const sitemap = await app.request('/sitemap.xml')
    expect(sitemap.status).toBe(404)
    expect(await sitemap.text()).not.toContain('<html')

    const robots = await app.request('/robots.txt')
    expect(robots.headers.get('content-type')).toMatch(/^text\/plain/)
    expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n')

    for (const path of ['/', '/assets', '/assets/x.js', '/assets/y.js']) {
      const res = await app.request(path)
      expect(res.headers.get('x-robots-tag'), path).toBe('noindex, nofollow')
    }
  })

  it('a sandbox makes no database copy: GET /api/backup is 403 not_in_demo (each copy would fill the shared /tmp), HEAD 405', async () => {
    const { app } = makeDemo()
    const who = visitor()
    await signIn(app, who)
    expect((await send(app, who, '/api/backup', 'HEAD')).status).toBe(405)
    const got = await send(app, who, '/api/backup')
    expect(got.status).toBe(403)
    expect(await got.json()).toEqual({ error: { code: 'not_in_demo' } })
  })

  it('wrong password → 401', async () => {
    const { app, pool } = makeDemo()
    const res = await signIn(app, visitor(), 'not the password')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'wrong_password' } })
    expect(res.headers.getSetCookie()).toEqual([])
    expect(pool.status().live).toBe(0)
  })

  it('a missing password → 400', async () => {
    const { app } = makeDemo()
    const res = await send(app, visitor(), '/api/auth/login', 'POST', {})
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 'password_required' } })
  })

  it('too many wrong passwords from one address → 429', async () => {
    const { app } = makeDemo()
    const who = visitor()
    for (let i = 0; i < 10; i++) expect((await signIn(app, who, 'wrong-password')).status).toBe(401)
    const res = await signIn(app, who)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: { code: 'too_many_attempts' } })
  })

  it('concurrent wrong passwords from one address are bounded by the limit: the check is repeated after the body is read', async () => {
    const { app } = makeDemo()
    const responses = await Promise.all(Array.from({ length: 15 }, () => signIn(app, visitor(), 'wrong-password')))
    expect(responses.filter(res => res.status === 401)).toHaveLength(10)
    expect(responses.filter(res => res.status === 429)).toHaveLength(5)
  })

  it('right password → 200 with expiresAt and both cookies', async () => {
    const { app, clock } = makeDemo()
    clock.t = 1000
    const res = await signIn(app, visitor())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, expiresAt: 1000 + 15 * MINUTE, now: 1000 })
    const [session, visitorCookie] = ['demo_session', 'demo_visitor'].map(name => res.headers.getSetCookie().find(c => c.startsWith(`${name}=`)))
    expect(session).toMatch(/Max-Age=900;.*HttpOnly.*SameSite=Lax/)
    expect(visitorCookie).toMatch(/Max-Age=2592000;.*HttpOnly.*SameSite=Lax/)
    expect(session).not.toMatch(/Secure/)
  })

  it('a demo sandbox opens in the language chosen at sign-in, and /api/auth names it', async () => {
    const { app } = makeDemo()
    const who = visitor()
    expect((await send(app, who, '/api/auth')).status).toBe(200)
    expect(await (await send(app, who, '/api/auth')).json()).not.toHaveProperty('language')
    expect((await signIn(app, who, PASSWORD, 'ru-RU')).status).toBe(200)
    expect(await (await send(app, who, '/api/auth')).json()).toMatchObject({ authenticated: true, language: 'ru-RU' })
  })

  it('another language at sign-in brings a fresh copy of its family, at most once per cooldown; the same language never waits', async () => {
    const { app, clock, pool } = makeDemo()
    const who = visitor()
    expect((await signIn(app, who, PASSWORD, 'de-DE')).status).toBe(200)
    clock.t = 20_000
    expect((await signIn(app, who, PASSWORD, 'zh-CN')).status).toBe(200)
    // a second switch within ten seconds would copy a template again: refused, the sandbox stays
    const refused = await signIn(app, who, PASSWORD, 'de-DE')
    expect(refused.status).toBe(429)
    expect(await refused.json()).toMatchObject({ error: { code: 'demo_restart_cooldown' } })
    expect((await signIn(app, who, PASSWORD, 'zh-CN')).status).toBe(200)
    clock.t = 31_000
    expect((await signIn(app, who, PASSWORD, 'de-DE')).status).toBe(200)
    expect(pool.status().live).toBe(1)
  })

  it('an unknown sign-in language falls back to English', async () => {
    const { app } = makeDemo()
    const who = visitor()
    await signIn(app, who, PASSWORD, 'xx-XX')
    expect(await (await send(app, who, '/api/auth')).json()).toMatchObject({ language: 'en-US' })
  })

  it('marks the cookies Secure behind HTTPS', async () => {
    const cfg = config({ APP_URL: 'https://demo.example.com' })
    const pool = createSandboxPool({ dir: tempDir(), templatePath: () => template, config: cfg })
    cleanup.push(() => { pool.closeAll() })
    const res = await signIn(createDemoApp({ config: cfg, pool, secret: 's' }), visitor())
    expect(res.headers.getSetCookie().every(c => /; Secure/.test(c))).toBe(true)
  })

  it('GET /api/auth shows the demo mode, the hint, the server clock, the install link and the open month; authenticated after sign-in', async () => {
    const { app, clock } = makeDemo()
    const who = visitor()
    const before = await (await send(app, who, '/api/auth')).json() as Record<string, unknown>
    expect(before).toEqual({
      mode: 'demo', authenticated: false, hint: PASSWORD, expiresAt: null, now: 0, installUrl: 'https://example.com/install', me: null,
      families: DEMO_FAMILY_CARDS, launches: 0,
    })
    await signIn(app, who)
    clock.t = MINUTE
    expect(await (await send(app, who, '/api/auth')).json()).toEqual({
      mode: 'demo', authenticated: true, hint: PASSWORD, expiresAt: 15 * MINUTE, now: MINUTE, installUrl: 'https://example.com/install', language: 'en-US',
      me: { name: null, rights: { edit: true, vote: true, manage: true } }, families: DEMO_FAMILY_CARDS, launches: 1,
    })
  })

  it('the sign-in card lists the family of every language in its own words: the names, the country and the two currencies', () => {
    expect(DEMO_FAMILY_CARDS.map(f => f.language)).toEqual([...LANGUAGES])
    expect(DEMO_FAMILY_CARDS[0]).toEqual({ language: 'en-US', members: ['Ryan', 'Annika'], place: 'USA', currencies: ['USD', 'EUR'] })
    expect(DEMO_FAMILY_CARDS.find(f => f.language === 'zh-CN')).toMatchObject({ place: '中国', currencies: ['CNY', 'USD'] })
  })

  it('a wrong password from many addresses does not lock others out: the password is public, only the per-address limit applies', async () => {
    const { app } = makeDemo()
    for (let i = 0; i < 120; i++) expect((await signIn(app, visitor(`10.1.${i >> 8}.${i & 255}`), 'wrong-password')).status).toBe(401)
    expect((await signIn(app, visitor('10.2.0.1'))).status).toBe(200)
  })

  it('a sandbox that reaches its size cap answers demo_full, and start over gives a fresh one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { app, clock } = makeDemo({ maxBytes: statSync(template).size + 512 * 1024 })
    const who = visitor()
    await signIn(app, who)
    let res: Response | undefined
    for (let i = 0; i < 100; i++) {
      res = await send(app, who, '/api/admin/members', 'POST', { name: `${i}`.padEnd(60_000, 'x') })
      if (res.status !== 200) break
    }
    expect(res?.status).toBe(409)
    expect(await res?.json()).toEqual({ error: { code: 'demo_full' } })
    // reads still work in a full sandbox
    expect(await currencies(app, who)).toContain('USD')
    clock.t = 1000
    const restart = await send(app, who, '/api/demo/restart', 'POST')
    expect(restart.status).toBe(200)
    Object.assign(who.cookies, cookiesOf(restart))
    expect((await send(app, who, '/api/admin/members', 'POST', { name: 'Fresh' })).status).toBe(200)
  })

  it('signing in again returns to the same sandbox', async () => {
    const { app, pool } = makeDemo()
    const who = visitor()
    await signIn(app, who)
    await send(app, who, '/api/admin/currencies', 'POST', { code: 'CHF' })
    expect((await signIn(app, who)).status).toBe(200)
    expect(await currencies(app, who)).toContain('CHF')
    expect(pool.status().live).toBe(1)
  })

  it('snapshot is forwarded', async () => {
    const { app } = makeDemo()
    const who = visitor()
    await signIn(app, who)
    const res = await send(app, who, '/api/snapshot')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(await res.json()).toMatchObject({ baseCurrency: 'USD' })
  })

  it('sandboxes are isolated', async () => {
    const { app } = makeDemo()
    const [a, b] = [visitor('10.0.0.1'), visitor('10.0.0.2')]
    await signIn(app, a)
    await signIn(app, b)
    expect((await send(app, a, '/api/admin/currencies', 'POST', { code: 'CHF' })).status).toBe(200)
    expect(await currencies(app, a)).toContain('CHF')
    expect(await currencies(app, b)).not.toContain('CHF')
  })

  it('no cookie → unauthorized', async () => {
    const { app } = makeDemo()
    const res = await send(app, visitor(), '/api/snapshot')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized' } })
  })

  it('expired cookie → demo_expired', async () => {
    const { app, clock } = makeDemo()
    const who = visitor()
    await signIn(app, who)
    clock.t = 15 * MINUTE + 1
    const res = await send(app, who, '/api/snapshot')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'demo_expired' } })
    expect(await (await send(app, who, '/api/auth')).json()).toMatchObject({ authenticated: false, expiresAt: null })
  })

  it('a forged or unknown session cookie → demo_expired', async () => {
    const { app, pool } = makeDemo()
    const forged = await send(app, { cookies: { demo_session: 'demo_session=not-signed' }, ip: '10.0.0.1' }, '/api/snapshot')
    expect(forged.status).toBe(401)
    expect(await forged.json()).toEqual({ error: { code: 'demo_expired' } })
    const who = visitor()
    await signIn(app, who)
    const session = who.cookies.demo_session
    pool.closeAll()
    // still signed, but its sandbox is gone
    const res = await send(app, { ip: who.ip, cookies: { demo_session: session } }, '/api/snapshot')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'demo_expired' } })
  })

  it('cookie from a previous process → demo_expired', async () => {
    const { app, pool } = makeDemo({ secret: 'first-process' })
    const who = visitor()
    await signIn(app, who)
    const restarted = createDemoApp({ config: config(), pool, secret: 'second-process' })
    const res = await send(restarted, who, '/api/snapshot')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'demo_expired' } })
  })

  it('a sandbox that expires during a request answers demo_expired, not a 500', async () => {
    const { app, pool } = makeDemo()
    const opened = vi.spyOn(pool, 'open')
    const who = visitor()
    await signIn(app, who)
    const result = opened.mock.results[0].value as OpenResult
    if (!('sandbox' in result)) throw new Error('expected a sandbox')
    const { sandbox } = result
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetch = sandbox.app.fetch
    // the sweep closes the database while the request is inside the sandbox
    sandbox.app.fetch = req => { pool.close(sandbox.id); return fetch(req) }
    const res = await send(app, who, '/api/snapshot')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'demo_expired' } })
  })

  it('logout clears the session cookie and keeps the sandbox: signing in again returns to it', async () => {
    const { app, pool } = makeDemo()
    const who = visitor()
    await signIn(app, who)
    await send(app, who, '/api/admin/currencies', 'POST', { code: 'CHF' })
    const res = await send(app, who, '/api/auth/logout', 'POST')
    expect(res.status).toBe(200)
    expect(cookiesOf(res).demo_session).toBe('demo_session=')
    expect(pool.status().live).toBe(1)
    await signIn(app, who)
    expect(await currencies(app, who)).toContain('CHF')
    expect(pool.status().live).toBe(1)
  })

  it('a sign-in/sign-out loop from one address without a visitor cookie opens no more sandboxes than the per-address cap', async () => {
    const { app, pool } = makeDemo()
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      const who = visitor()
      statuses.push((await signIn(app, who)).status)
      await send(app, who, '/api/auth/logout', 'POST')
    }
    expect(statuses).toEqual([200, 200, 429, 429, 429])
    expect(pool.status().live).toBe(2)
  })

  it('the advisor\'s OAuth paths never reach a sandbox, signed in or not', async () => {
    const { app } = makeDemo()
    const who = visitor()
    await signIn(app, who)
    for (const [path, method] of [['/oauth/register', 'POST'], ['/.well-known/oauth-authorization-server', 'GET'], ['/.well-known/oauth-protected-resource', 'GET']] as const) {
      for (const as of [who, visitor('10.0.0.2')]) {
        const res = await send(app, as, path, method, method === 'POST' ? { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] } : undefined)
        expect(res.status, path).toBe(404)
        expect(await res.text(), path).toBe('Not found')
      }
    }
  })

  it('restart gives fresh data', async () => {
    const { app, pool } = makeDemo()
    const who = visitor()
    await signIn(app, who)
    await send(app, who, '/api/admin/currencies', 'POST', { code: 'CHF' })
    const before = who.cookies.demo_session
    const res = await send(app, who, '/api/demo/restart', 'POST')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, expiresAt: 15 * MINUTE, now: 0 })
    Object.assign(who.cookies, cookiesOf(res))
    expect(who.cookies.demo_session).not.toBe(before)
    expect(await currencies(app, who)).not.toContain('CHF')
    expect(pool.status().live).toBe(1)
  })

  it('restart after expiry needs no password', async () => {
    const { app, clock } = makeDemo()
    const who = visitor()
    await signIn(app, who)
    clock.t = 20 * MINUTE
    const res = await send(app, who, '/api/demo/restart', 'POST')
    expect(res.status).toBe(200)
    Object.assign(who.cookies, cookiesOf(res))
    expect((await send(app, who, '/api/snapshot')).status).toBe(200)
  })

  it('restart after expiry opens in the language the browser sends; an unknown one falls back to English', async () => {
    const { app, clock } = makeDemo()
    const who = visitor()
    await signIn(app, who, PASSWORD, 'ru-RU')
    clock.t = 20 * MINUTE
    const res = await send(app, who, '/api/demo/restart', 'POST', { language: 'ru-RU' })
    expect(res.status).toBe(200)
    Object.assign(who.cookies, cookiesOf(res))
    expect(await (await send(app, who, '/api/auth')).json()).toMatchObject({ authenticated: true, language: 'ru-RU' })

    const other = visitor('10.0.0.2')
    await signIn(app, other, PASSWORD, 'ru-RU')
    clock.t = 40 * MINUTE
    const unknown = await send(app, other, '/api/demo/restart', 'POST', { language: 'xx-XX' })
    Object.assign(other.cookies, cookiesOf(unknown))
    expect(await (await send(app, other, '/api/auth')).json()).toMatchObject({ authenticated: true, language: 'en-US' })
  })

  it('restart of a live sandbox keeps its language', async () => {
    const { app } = makeDemo()
    const who = visitor()
    await signIn(app, who, PASSWORD, 'ru-RU')
    const res = await send(app, who, '/api/demo/restart', 'POST', { language: 'en-US' })
    Object.assign(who.cookies, cookiesOf(res))
    expect(await (await send(app, who, '/api/auth')).json()).toMatchObject({ authenticated: true, language: 'ru-RU' })
  })

  it('one visitor starts over at most once in 10 seconds: 429 with retryAfter', async () => {
    const { app, clock, pool } = makeDemo()
    const who = visitor()
    await signIn(app, who)
    const first = await send(app, who, '/api/demo/restart', 'POST')
    expect(first.status).toBe(200)
    Object.assign(who.cookies, cookiesOf(first))
    clock.t = 3000
    const again = await send(app, who, '/api/demo/restart', 'POST')
    expect(again.status).toBe(429)
    expect(again.headers.get('Retry-After')).toBe('7')
    expect(await again.json()).toEqual({ error: { code: 'demo_restart_cooldown', params: { retryAfter: 7 } } })
    // the refusal keeps the sandbox, and another visitor is not affected
    expect((await send(app, who, '/api/snapshot')).status).toBe(200)
    const other = visitor('10.0.0.2')
    await signIn(app, other)
    expect((await send(app, other, '/api/demo/restart', 'POST')).status).toBe(200)
    clock.t = 10_000
    expect((await send(app, who, '/api/demo/restart', 'POST')).status).toBe(200)
    expect(pool.status().live).toBe(2)
  })

  it('restart without a visitor cookie → 401', async () => {
    const { app } = makeDemo()
    const res = await send(app, visitor(), '/api/demo/restart', 'POST')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized' } })
    const forged = await send(app, { cookies: { demo_visitor: 'demo_visitor=someone' }, ip: '10.0.0.1' }, '/api/demo/restart', 'POST')
    expect(forged.status).toBe(401)
  })

  describe('busy, ip limit and updating carry retryAfter', () => {
    const refusal = async (res: Response, status: number, code: string, retryAfter: number) => {
      expect(res.status).toBe(status)
      expect(res.headers.get('Retry-After')).toBe(String(retryAfter))
      expect(await res.json()).toEqual({ error: { code, params: { retryAfter } } })
    }

    it('busy', async () => {
      const { app, clock } = makeDemo()
      for (let i = 1; i <= 15; i++) expect((await signIn(app, visitor(`10.0.0.${i}`))).status).toBe(200)
      clock.t = MINUTE
      await refusal(await signIn(app, visitor('10.0.0.16')), 503, 'demo_busy', 840)
    })

    it('ip limit', async () => {
      const { app } = makeDemo()
      await signIn(app, visitor())
      await signIn(app, visitor())
      await refusal(await signIn(app, visitor()), 429, 'demo_ip_limit', 900)
    })

    it('updating, for sign-in and restart', async () => {
      const { app, pool } = makeDemo()
      const who = visitor()
      await signIn(app, who)
      pool.draining = true
      await refusal(await signIn(app, visitor('10.0.0.9')), 503, 'demo_updating', 900)
      await refusal(await send(app, who, '/api/demo/restart', 'POST'), 503, 'demo_updating', 900)
      expect((await send(app, who, '/api/snapshot')).status).toBe(200)
    })
  })

  it('cross-origin POST → 403', async () => {
    const { app, pool } = makeDemo()
    const who = visitor()
    const login = await send(app, who, '/api/auth/login', 'POST', { password: PASSWORD }, { Origin: 'https://attacker.example' })
    expect(login.status).toBe(403)
    await signIn(app, who)
    const write = await send(app, who, '/api/admin/currencies', 'POST', { code: 'CHF' }, { Origin: 'https://attacker.example' })
    expect(write.status).toBe(403)
    const restart = await send(app, who, '/api/demo/restart', 'POST', undefined, { 'Sec-Fetch-Site': 'cross-site' })
    expect(restart.status).toBe(403)
    expect(pool.status().live).toBe(1)
  })
})

