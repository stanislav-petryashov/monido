import { describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createApp, runScheduledModules } from '../../src/server/app'
import { mountStatic } from '../../src/server/static'
import type { Database } from '../../src/server/db'
import type { BotHandle } from '../../src/server/bot/reader'
import { createTestDb, testConfig } from '../helpers/db'
import { remindersServer } from '../../src/modules/reminders/server'
import { advisorServer } from '../../src/modules/advisor/server'
import { authFor } from '../helpers/auth'
import { familyCookie, userCookie } from '../helpers/session'
import { withTempDirs } from '../helpers/tmp'
import { createLoginAttempts } from '../../src/server/loginAttempts'

const PASSWORD = 'correct horse battery'
/** Password mode in route tests: the family cookie is the sign-in. */
const config = () => testConfig({ password: PASSWORD })
const AUTH = { Cookie: await familyCookie(authFor(config())) }

function localEnv() {
  const DB = createTestDb()
  return { DB, app: createApp({ db: DB, config: config(), auth: authFor(config()) }) }
}

function fixture() {
  const statement = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results: [{ name: 'value', type: 'REAL', notnull: 1 }] }),
    run: vi.fn().mockResolvedValue({ meta: { changes: 0, last_row_id: 1 } }),
    first: vi.fn().mockResolvedValue(null),
  }
  const DB = { prepare: vi.fn(() => statement), batch: vi.fn(), readToken: vi.fn(() => ({})), guardedBatch: vi.fn().mockResolvedValue([]) }
  const env = { DB, app: createApp({ db: DB as unknown as Database, config: config(), auth: authFor(config()) }) }
  return { env, statement }
}

/** A request from a signed-in user; with auth = false the cookie is not sent. */
function request(path: string, method = 'GET', body?: string, headers: Record<string, string> = {}, auth = true) {
  return new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body }), headers: { ...(auth ? AUTH : {}), ...headers } })
}

describe('API security and input boundary', () => {
  it('denies API requests without identity, before touching the database', async () => {
    const { env } = fixture()
    for (const path of ['/api/snapshot', '/api/admin/goals']) {
      const response = await env.app.fetch(new Request(`https://example.com${path}`))
      expect(response.status).toBe(401)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    expect(env.DB.prepare).not.toHaveBeenCalled()
  })
  it('password mode: refuses without a session and journals writes as family', async () => {
    const DB = createTestDb()
    const app = createApp({ db: DB, config: config(), auth: authFor(config()) })
    expect((await app.request('/api/snapshot')).status).toBe(401)
    const login = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0]
    const created = await app.request('/api/admin/parameters', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"key":"k","value":1}' })
    expect(created.status).toBe(200)
    expect(DB.sqlite.prepare('SELECT actor FROM change_log').get()).toEqual({ actor: 'family' })
  })
  it('answers /api/health without identity', async () => {
    const env = localEnv()
    const res = await env.app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
  it.each(['null', '[]', '{}', '{', '{"value":{}}', '{"unknown":1}', '{"value":"oops"}'])('rejects invalid bodies: %s', async body => {
    const { env, statement } = fixture()
    const response = await env.app.fetch(request('/api/admin/parameters/1', 'PUT', body, { 'Content-Type': 'application/json' }))
    expect(response.status).toBe(400)
    expect(statement.run).not.toHaveBeenCalled()
  })
  it('rejects cross-origin writes and non-JSON bodies', async () => {
    const { env } = fixture()
    expect((await env.app.fetch(request('/api/admin/goals', 'POST', '{}', { Origin: 'https://attacker.example' }))).status).toBe(403)
    expect((await env.app.fetch(request('/api/admin/goals', 'POST', '{}'))).status).toBe(415)
  })
  it('bounds streamed body size', async () => {
    const { env } = fixture()
    expect((await env.app.fetch(request('/api/admin/goals', 'POST', JSON.stringify({ value: 'a'.repeat(65536) }), { 'Content-Type': 'application/json' }))).status).toBe(413)
  })
  it.each(['\r\n[forged]', '\u0000\t\u001b[2J\u0085\u2028\u2029'])('logs an interrupted body as a single escaped record: %j', async controls => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = localEnv()
    const failure = new Error(`stream interrupted${controls}`)
    const month = `2031-06${controls}`
    const body = new ReadableStream({ start(controller) { controller.error(failure) } })
    try {
      const res = await env.app.fetch(new Request(`http://localhost/api/month-close/${encodeURIComponent(month)}/draft`, {
        method: 'PUT', headers: { ...AUTH, 'Content-Type': 'application/json' }, body, duplex: 'half',
      } as RequestInit))
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: { code: 'save_failed' } })
      expect(log).toHaveBeenCalledExactlyOnceWith(expect.any(String))
      const record = log.mock.calls[0][0] as string
      expect(record).not.toMatch(/[\p{Cc}\p{Zl}\p{Zp}]/u)
      expect(JSON.parse(record)).toEqual({ tag: 'month-close', method: 'PUT', path: `/api/month-close/${month}/draft`, error: failure.stack })
      expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM month_drafts').get()).toEqual({ n: 0 })
    } finally { log.mockRestore(); env.DB.sqlite.close() }
  })
  it('reports missing rows instead of a successful update/delete', async () => {
    const env = localEnv()
    expect((await env.app.fetch(request('/api/admin/goals/12', 'DELETE'))).status).toBe(404)
    expect((await env.app.fetch(request('/api/admin/parameters/12', 'PUT', '{"value":1}', { 'Content-Type': 'application/json' }))).status).toBe(404)
  })
  it('journals admin writes under the signed-in user', async () => {
    const env = localEnv()
    const created = await env.app.fetch(request('/api/admin/parameters', 'POST', '{"key":"k","value":1}', { 'Content-Type': 'application/json' }))
    expect(created.status).toBe(200)
    const entry = env.DB.sqlite.prepare('SELECT actor, source, op FROM change_log').get()
    expect(entry).toEqual({ actor: 'family', source: 'admin', op: 'insert' })
  })
  it('/api/modules is gone: 404 not_found', async () => {
    const env = localEnv()
    for (const [path, method] of [['/api/modules', 'GET'], ['/api/modules/loans', 'PUT']] as const) {
      const res = await env.app.fetch(request(path, method, method === 'PUT' ? '{"enabled":false}' : undefined, { 'Content-Type': 'application/json' }))
      expect(res.status, `${method} ${path}`).toBe(404)
      expect(await res.json()).toEqual({ error: { code: 'not_found' } })
    }
  })
  it('builds the snapshot in the requested project currency, else USD, else the first project currency', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = localEnv()
    const base = async (query: string) => ((await (await env.app.fetch(request(`/api/snapshot${query}`))).json()) as { baseCurrency: string }).baseCurrency
    expect(await base('?currency=RUB')).toBe('RUB')
    expect(await base('?currency=GBP')).toBe('USD')
    expect(await base('?currency=rub')).toBe('USD')
    expect(await base('')).toBe('USD')
    env.DB.sqlite.exec("DELETE FROM currencies WHERE code = 'USD'")
    expect(await base('?currency=GBP')).toBe('EUR')
  })
  it('writes into a module table with no module state', async () => {
    const env = localEnv()
    const response = await env.app.fetch(request('/api/admin/goals', 'POST', '{"id":"g","name":"n","target":1,"current":0,"target_date":"2032-01-01"}', { 'Content-Type': 'application/json' }))
    expect(response.status).toBe(200)
  })
  it('keeps the journal and the rate cache read-only', async () => {
    const env = localEnv()
    expect((await env.app.fetch(request('/api/admin/change_log'))).status).toBe(200)
    expect((await env.app.fetch(request('/api/admin/fx_rates', 'POST', '{"date":"2031-01-01"}', { 'Content-Type': 'application/json' }))).status).toBe(403)
  })
  it('returns JSON 404 for unknown API routes and 405 for invalid methods', async () => {
    const { env } = fixture()
    expect((await env.app.fetch(request('/api/unknown'))).status).toBe(404)
    expect((await env.app.fetch(request('/api/snapshot', 'POST'))).status).toBe(405)
  })
  it('does not expose database exception details, but logs them', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { env, statement } = fixture()
    statement.all.mockRejectedValue(new Error('secret database detail'))
    const response = await env.app.fetch(request('/api/snapshot'))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('secret')
    const admin = await env.app.fetch(request('/api/admin/goals'))
    expect(admin.status).toBe(500)
    expect(await admin.text()).not.toContain('secret')
    expect(error.mock.calls.map(([record]) => JSON.parse(record))).toEqual([
      { tag: 'snapshot', method: 'GET', path: '/api/snapshot', error: expect.stringContaining('secret database detail') },
      { tag: 'admin', method: 'GET', path: '/api/admin/goals', error: expect.stringContaining('secret database detail') },
    ])
    error.mockRestore()
  })
  it('no longer exposes the removed portfolio, trades and liabilities tables', async () => {
    const { env } = fixture()
    for (const table of ['portfolio', 'trades', 'liabilities']) {
      expect((await env.app.fetch(request(`/api/admin/${table}`))).status).toBe(400)
    }
  })
  it('no longer serves the raw table dump', async () => {
    const { env } = fixture()
    expect((await env.app.fetch(request('/api/data'))).status).toBe(404)
  })
  it('reverts a journaled change', async () => {
    const env = localEnv()
    await env.app.fetch(request('/api/admin/parameters', 'POST', '{"key":"k","value":1}', { 'Content-Type': 'application/json' }))
    const res = await env.app.fetch(request('/api/admin/change_log/1/revert', 'POST'))
    expect(res.status).toBe(200)
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM parameters').get()).toEqual({ n: 0 })
  })
})

describe('a demo sandbox app', () => {
  const demoApp = (ratesOnline?: boolean) => {
    const DB = createTestDb()
    return { DB, app: createApp({ db: DB, config: testConfig({ AUTH_MODE: 'demo' }, 'demo-secret'), auth: authFor(testConfig({ AUTH_MODE: 'demo' }, 'demo-secret')), ratesOnline }) }
  }

  it('builds the snapshot without any rate download when rates are offline', async () => {
    const f = vi.fn().mockRejectedValue(new Error('no network in the demo'))
    vi.stubGlobal('fetch', f)
    const { app } = demoApp(false)
    const res = await app.fetch(request('/api/snapshot', 'GET', undefined, {}, false))
    expect(res.status).toBe(200)
    expect(f).not.toHaveBeenCalled()
  })

  it('downloads rates by default', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', f)
    const { app } = demoApp()
    expect((await app.fetch(request('/api/snapshot', 'GET', undefined, {}, false))).status).toBe(200)
    expect(f).toHaveBeenCalled()
  })

  it('has no advisor or reminders: their API, the connector and its OAuth answer 404', async () => {
    const { app } = demoApp(false)
    for (const path of ['/api/reminders', '/api/advisor/proposals']) {
      const res = await app.fetch(request(path, 'GET', undefined, {}, false))
      expect(res.status, path).toBe(404)
      expect(await res.json()).toEqual({ error: { code: 'not_found' } })
    }
    for (const path of ['/mcp', '/.well-known/oauth-authorization-server']) {
      expect((await app.fetch(request(path, 'GET', undefined, {}, false))).status, path).toBe(404)
    }
  })

})

describe('unexpected failures', () => {
  it('answers JSON 500 without the error text when an exception escapes a route', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = createApp({ db: createTestDb(), config: config(), auth: authFor(config()) })
    // no route lets an exception escape on its own: add one after createApp
    const failure = new Error('boom\r\nforged error')
    app.get('/api/boom/:value', () => { throw failure })
    const res = await app.fetch(request('/api/boom/first%0D%0Aforged'))
    expect(res.status).toBe(500)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: { code: 'load_failed' } })
    expect(text).not.toContain('boom')
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.any(String))
    const record = log.mock.calls[0][0] as string
    expect(record).not.toMatch(/[\p{Cc}\p{Zl}\p{Zp}]/u)
    expect(JSON.parse(record)).toEqual({ tag: 'app', method: 'GET', path: '/api/boom/first\r\nforged', error: failure.stack })
    log.mockRestore()
  })

  it('answers JSON 500 when the database throws synchronously', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = { prepare: () => { throw new Error('boom') }, batch: vi.fn(), readToken: vi.fn(() => ({})), guardedBatch: vi.fn().mockResolvedValue([]) } as unknown as Database
    const res = await createApp({ db, config: config(), auth: authFor(config()) }).fetch(request('/api/admin/goals'))
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: { code: 'load_failed' } })
    expect(text).not.toContain('boom')
    log.mockRestore()
  })
})

it('accepts an integer property valuation year when all required fields are valid', async () => {
  const env = localEnv()
  const body = { name: 'House', purchase_date: '2020-01-01', purchase_price: 100, purchase_currency: 'USD', valuation_year: 2024, value: 200, currency: 'USD' }
  const response = await env.app.fetch(request('/api/admin/real_estate', 'POST', JSON.stringify(body), { 'Content-Type': 'application/json' }))
  expect(response.status).toBe(200)
})

describe('month-close routes', () => {
  const jsonHeaders = { 'Content-Type': 'application/json' }
  const row = { name: 'Quillmark Bank', member: 'Robin', currency: 'RUB', class: 'bank', balance: 1, active: 0, passive: 0, expense: 0, closing: false, added: true }
  // today is not faked: on an empty database the first month in the queue is the last finished one
  const firstOpen = async (env: ReturnType<typeof localEnv>) =>
    ((await (await env.app.fetch(request('/api/month-close'))).json()) as { month: string }).month

  const revision = async (env: ReturnType<typeof localEnv>) =>
    ((await (await env.app.fetch(request('/api/month-close'))).json()) as { draftRevision: string }).draftRevision

  it('serves the state, keeps a draft and closes the month through the API', async () => {
    const env = localEnv()
    const month = await firstOpen(env)
    expect(month).toMatch(/^\d{4}-\d{2}$/)
    const saved = await env.app.fetch(request(`/api/month-close/${month}/draft`, 'PUT', JSON.stringify({ rows: [row], expectedRevision: await revision(env) }), jsonHeaders))
    expect(saved.status).toBe(200)
    const closed = await env.app.fetch(request(`/api/month-close/${month}/close`, 'POST', JSON.stringify({ expectedRevision: await revision(env) }), jsonHeaders))
    expect(closed.status).toBe(200)
    expect(env.DB.sqlite.prepare('SELECT closed_by FROM closed_months').get()).toEqual({ closed_by: 'family' })
    expect(env.DB.sqlite.prepare("SELECT actor, source FROM change_log WHERE table_name = 'assets'").get()).toEqual({ actor: 'family', source: 'admin' })
  })

  it('saves a bounded long-name draft without relaxing other request limits', async () => {
    const env = localEnv()
    const month = await firstOpen(env)
    const rows = Array.from({ length: 156 }, (_, i) => ({ ...row, name: `${'Family account '.repeat(38)}${i}` }))
    const body = JSON.stringify({ rows, expectedRevision: await revision(env) })
    expect(Buffer.byteLength(body)).toBeGreaterThan(65536)
    const saved = await env.app.fetch(request(`/api/month-close/${month}/draft`, 'PUT', body, jsonHeaders))
    expect(saved.status).toBe(200)
    const invalidName = await env.app.fetch(request(`/api/month-close/${month}/draft`, 'PUT', JSON.stringify({ rows: [{ ...row, name: 'x'.repeat(1001) }], expectedRevision: await revision(env) }), jsonHeaders))
    expect(invalidName.status).toBe(400)
    const tooLarge = await env.app.fetch(request(`/api/month-close/${month}/draft`, 'PUT', JSON.stringify({ rows: [], extra: 'x'.repeat(524288) }), jsonHeaders))
    expect(tooLarge.status).toBe(413)
  })

  it('answers with the reason and the right status when it refuses', async () => {
    const env = localEnv()
    const month = await firstOpen(env)
    const incomplete = await env.app.fetch(request(`/api/month-close/${month}/close`, 'POST', JSON.stringify({ expectedRevision: await revision(env) }), jsonHeaders))
    expect(incomplete.status).toBe(422)
    expect(await incomplete.json()).toEqual({ error: { code: 'month_has_problems', params: { problems: [{ name: '', member: '', problem: { code: 'no_accounts' } }] } } })
    const outOfOrder = await env.app.fetch(request('/api/month-close/2001-01/draft', 'PUT', '{"rows":[]}', jsonHeaders))
    expect(outOfOrder.status).toBe(409)
    expect(await outOfOrder.json()).toEqual({ error: { code: 'month_out_of_order' } })
    expect((await env.app.fetch(request(`/api/month-close/${month}/draft`, 'PUT', '{"rows":[]}'))).status).toBe(415)
    expect((await env.app.fetch(request(`/api/month-close/${month}/draft`, 'PUT', '{"rows":"x"}', jsonHeaders))).status).toBe(400)
    expect((await env.app.fetch(request(`/api/month-close/${month}/reopen`, 'POST'))).status).toBe(409)
    expect((await env.app.fetch(request('/api/month-close', 'POST'))).status).toBe(405)
    expect((await env.app.fetch(request(`/api/month-close/${month}/close`, 'GET'))).status).toBe(405)
    // a path that only looks like an action is a 404, not a 405
    expect((await env.app.fetch(request('/api/month-close/2031-06/closeX'))).status).toBe(404)
  })
})

describe('reminder routes', () => {
  const jsonHeaders = { 'Content-Type': 'application/json' }
  const schedule = (startDay: number) => JSON.stringify({ enabled: true, startDay, hour: 9, timezone: 'Europe/Moscow' })

  it('serve the settings and save a schedule', async () => {
    const env = localEnv()
    const view = await (await env.app.fetch(request('/api/reminders'))).json() as { configured: boolean; linked: boolean }
    expect(view).toMatchObject({ configured: false, linked: false })
    expect((await env.app.fetch(request('/api/reminders', 'PUT', schedule(5), jsonHeaders))).status).toBe(200)
    expect(env.DB.sqlite.prepare('SELECT start_day, enabled FROM reminder_settings').get()).toEqual({ start_day: 5, enabled: 1 })
  })

  it('answer with the reason and the right status when they refuse', async () => {
    const env = localEnv()
    const bad = await env.app.fetch(request('/api/reminders', 'PUT', schedule(16), jsonHeaders))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: { code: 'reminders.invalid_schedule', params: { detail: 'Invalid startDay: 1–15' } } })
    expect((await env.app.fetch(request('/api/reminders', 'PUT', schedule(5)))).status).toBe(415)
    expect((await env.app.fetch(request('/api/reminders/link', 'POST', '{}', jsonHeaders))).status).toBe(409)
    expect((await env.app.fetch(request('/api/reminders/pairing', 'POST'))).status).toBe(409)
    expect((await env.app.fetch(request('/api/reminders/test', 'POST'))).status).toBe(409)
    expect((await env.app.fetch(request('/api/reminders/link', 'DELETE'))).status).toBe(200)
    expect((await env.app.fetch(request('/api/reminders', 'POST'))).status).toBe(405)
    expect((await env.app.fetch(request('/api/reminders/test', 'GET'))).status).toBe(405)
    expect((await env.app.fetch(request('/api/reminders/nope'))).status).toBe(404)
  })

  it('keeps reminder error redaction when escaping log records', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const DB = createTestDb()
    const app = createApp({ db: DB, config: testConfig({ password: PASSWORD, TELEGRAM_BOT_TOKEN: '123:SECRET' }), auth: authFor(testConfig({ password: PASSWORD, TELEGRAM_BOT_TOKEN: '123:SECRET' })) })
    const body = new ReadableStream({ start(controller) { controller.error(new Error('https://api.telegram.org/bot123:SECRET/\nforged')) } })
    try {
      const res = await app.fetch(new Request('http://localhost/api/reminders', {
        method: 'PUT', headers: { ...AUTH, ...jsonHeaders }, body, duplex: 'half',
      } as RequestInit))
      expect(res.status).toBe(500)
      expect(log).toHaveBeenCalledExactlyOnceWith(expect.any(String))
      const record = log.mock.calls[0][0] as string
      expect(record).not.toContain('SECRET')
      expect(record).not.toMatch(/[\p{Cc}\p{Zl}\p{Zp}]/u)
      expect(JSON.parse(record).error).toBe('Error: https://api.telegram.org/bot***/\nforged')
    } finally { log.mockRestore(); DB.sqlite.close() }
  })

  it('the hourly run does nothing and calls nobody when the bot is not set up', async () => {
    const outbound = vi.fn()
    vi.stubGlobal('fetch', outbound)
    await runScheduledModules({ db: localEnv().DB, config: config(), auth: authFor(config()) })
    expect(outbound).not.toHaveBeenCalled()
  })
})

describe('the hourly run', () => {
  it('isolates a synchronous task failure and still runs the following module', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(advisorServer, 'scheduled').mockImplementation(() => { throw new Error('SECRET') })
    const next = vi.spyOn(remindersServer, 'scheduled').mockResolvedValue(undefined)
    await expect(runScheduledModules({ db: localEnv().DB, config: config(), auth: authFor(config()) })).resolves.toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith('[scheduled]', 'advisor', 'failed')
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET')
  })

  it('logs a failed module task by key, without the error that may carry the bot token', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const task = vi.spyOn(remindersServer, 'scheduled').mockRejectedValue(new Error('https://api.telegram.org/bot123:SECRET/sendMessage'))
    await runScheduledModules({ db: localEnv().DB, config: config(), auth: authFor(config()) })
    expect(log).toHaveBeenCalledWith('[scheduled]', 'reminders', 'failed')
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET')
    task.mockRestore()
    log.mockRestore()
  })
})

const clientDir = withTempDirs('ffd-csp-')

/** The CSP header as { directive: sources }. */
function cspOf(res: Response): Record<string, string> {
  const header = res.headers.get('Content-Security-Policy') ?? ''
  return Object.fromEntries(header.split(';').map(d => d.trim()).filter(Boolean).map(d => {
    const [name, ...sources] = d.split(/\s+/)
    return [name, sources.join(' ')]
  }))
}

describe('security headers', () => {
  it('sends a CSP on the HTML page: scripts only from the own origin, no framing', async () => {
    const dir = clientDir()
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>')
    const app = createApp({ db: createTestDb(), config: config(), auth: authFor(config()) })
    mountStatic(app, dir)
    const res = await app.request('/')
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/)
    const csp = cspOf(res)
    expect(csp['script-src']).toBe("'self'")
    expect(csp['default-src']).toBe("'self'")
    expect(csp['object-src']).toBe("'none'")
    expect(csp['frame-ancestors']).toBe("'none'")
  })

  it('sends no HSTS when APP_URL is not https', async () => {
    const app = createApp({ db: createTestDb(), config: config(), auth: authFor(config()) })
    const res = await app.request('/api/health')
    expect(res.headers.get('Strict-Transport-Security')).toBeNull()
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
  })

  it('sends HSTS without includeSubDomains when APP_URL is https', async () => {
    const config = testConfig({ password: PASSWORD, APP_URL: 'https://finance.example' })
    const res = await createApp({ db: createTestDb(), config, auth: authFor(config) }).request('/api/health')
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=15552000')
  })
})

describe('DNS rebinding: the Host allowlist without sign-in', () => {
  const appWith = (env: Record<string, string>) => {
    const config = testConfig(env)
    return createApp({ db: createTestDb(), config, auth: authFor(config) })
  }
  const status = async (app: ReturnType<typeof createApp>, url: string, init?: RequestInit) => (await app.request(url, init)).status

  it.each([
    ['AUTH_MODE=none', { AUTH_MODE: 'none' }],
    ['bootstrap', {}],
  ])('%s: refuses a request for a foreign name, reads and writes alike', async (_, env) => {
    const app = appWith(env)
    const refused = await app.request('http://rebind.attacker.example:8080/api/auth')
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: { code: 'host_not_allowed' } })
    expect(await status(app, 'http://rebind.attacker.example:8080/api/wipe', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://rebind.attacker.example:8080' }, body: '{"confirm":true}' })).toBe(403)
    expect(await status(app, 'http://rebind.attacker.example/')).toBe(403)
  })

  it.each(['http://localhost:5173', 'http://127.0.0.1:8080', 'http://192.168.1.20', 'http://[::1]:8080', 'http://[fd00::5]'])('allows %s', async origin => {
    expect(await status(appWith({ AUTH_MODE: 'none' }), `${origin}/api/auth`)).toBe(200)
  })

  it('allows the APP_URL host on any port, and nothing else by name', async () => {
    const app = appWith({ AUTH_MODE: 'none', APP_URL: 'https://Finance.Example/' })
    expect(await status(app, 'https://finance.example/api/auth')).toBe(200)
    expect(await status(app, 'http://finance.example:8443/api/auth')).toBe(200)
    expect(await status(app, 'https://other.example/api/auth')).toBe(403)
  })

  it('a signed-in mode does not check the Host: the session is the guard', async () => {
    expect(await status(appWith({ password: PASSWORD }), 'http://any.example/api/auth')).toBe(200)
  })
})

describe('Telegram sign-in attempts behind a proxy', () => {
  it('the route ranks eviction by /48: a flood over one /48\'s /64s makes room, a lone attempt stays', async () => {
    const config = testConfig({ mode: 'telegram', TELEGRAM_BOT_TOKEN: '123:token', CLIENT_IP_HEADER: 'X-Forwarded-For' })
    const bot = { username: () => 'fcbot', status: () => ({ configured: true, username: 'fcbot', problem: null }) }
    const app = createApp({ db: createTestDb(), config, auth: authFor(config), logins: createLoginAttempts({ max: 4 }), bot })
    const start = (ip: string) => app.request('/api/auth/telegram', { method: 'POST', headers: { 'X-Forwarded-For': ip } })
    const family = await start('198.51.100.7')
    const login = family.headers.getSetCookie().find(line => line.startsWith('login='))!.split(';')[0]
    // one attempt from each of three /64s in one /48: per /64 no key holds more than one, the /48 holds three
    for (let i = 0; i < 3; i++) expect((await start(`2001:db8:1:${i}::1`)).status).toBe(200)
    expect((await start('203.0.113.9')).status).toBe(200)
    expect(await (await app.request('/api/auth/telegram', { headers: { Cookie: login } })).json()).toEqual({ status: 'waiting' })
  })
})

describe('bare /api', () => {
  it('is a JSON answer of the API, not the SPA page', async () => {
    const res = await localEnv().app.fetch(request('/api'))
    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/)
  })
})

describe('rights', () => {
  const IDS = { viewer: 1, editor: 2, manager: 3 }
  function family(bot: Pick<BotHandle, 'username' | 'status'> | undefined = undefined) {
    const db = createTestDb()
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Viewer'), ('Editor'), ('Manager'), ('Newcomer')")
    const add = (member: string, telegramId: string, e: number, m: number) =>
      db.sqlite.prepare("INSERT INTO users (member, telegram_id, can_edit, can_vote, can_manage, created_at, updated_at) VALUES (?, ?, ?, 0, ?, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')").run(member, telegramId, e, m)
    add('Viewer', '101', 0, 0)
    add('Editor', '102', 1, 0)
    add('Manager', '103', 1, 1)
    const telegram = testConfig({ mode: 'telegram', TELEGRAM_BOT_TOKEN: '1:x' })
    const auth = authFor(telegram)
    const app = createApp({ db, config: telegram, auth, bot, ratesOnline: false })
    const as = (who: keyof typeof IDS) => async (path: string, method = 'GET', body?: unknown) =>
      app.request(path, { method, headers: { Cookie: await userCookie(auth, IDS[who]), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { db, as }
  }
  const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code

  it('a viewer reads but cannot write', async () => {
    const viewer = family().as('viewer')
    expect((await viewer('/api/snapshot')).status).toBe(200)
    const edit = await viewer('/api/admin/assets', 'POST', {})
    expect([edit.status, await code(edit)]).toEqual([403, 'no_right_edit'])
    const manage = await viewer('/api/settings', 'PUT', { currency: 'EUR' })
    expect([manage.status, await code(manage)]).toEqual([403, 'no_right_manage'])
  })

  it('an editor cannot manage', async () => {
    const editor = family().as('editor')
    for (const [path, method] of [['/api/wipe', 'POST'], ['/api/users', 'POST'], ['/api/settings', 'PUT']]) {
      const res = await editor(path, method, {})
      expect([res.status, await code(res)]).toEqual([403, 'no_right_manage'])
    }
  })

  it('the users routes', async () => {
    const { as } = family()
    const manager = as('manager')
    const list = await (await manager('/api/users')).json()
    expect(list).toMatchObject({ mode: 'telegram', bot: { configured: true, username: null }, meId: 3 })
    expect(list.users).toHaveLength(3)
    const created = await manager('/api/users', 'POST', { member: 'Newcomer' })
    expect(created.status).toBe(200)
    const view = await created.json()
    const added = view.users.find((u: { member: string }) => u.member === 'Newcomer')
    expect(added.rights).toEqual({ edit: true, vote: true, manage: false })
    const updated = await (await manager(`/api/users/${added.id}`, 'PUT', { rights: { edit: false } })).json()
    expect(updated.users.find((u: { id: number }) => u.id === added.id).rights.edit).toBe(false)
    const after = await (await manager(`/api/users/${added.id}`, 'DELETE')).json()
    expect(after.users).toHaveLength(3)
  })

  const fakeBot = (username: string | null, problem: string | null = null) =>
    ({ username: () => username, status: () => ({ configured: true, username, problem }) })

  it('the users view carries the bot reader\'s status', async () => {
    const manager = family(fakeBot('fcbot', 'telegram.webhook')).as('manager')
    expect((await (await manager('/api/users')).json()).bot).toEqual({ configured: true, username: 'fcbot', problem: 'telegram.webhook' })
  })

  it('an invite needs the bot', async () => {
    const withoutBot = family().as('manager')
    const res = await withoutBot('/api/users/1/invite', 'POST')
    expect([res.status, await code(res)]).toEqual([409, 'bot_not_configured'])
    const withBot = family(fakeBot('fcbot')).as('manager')
    const ok = await withBot('/api/users/1/invite', 'POST')
    expect(ok.status).toBe(200)
    expect((await ok.json()).link).toMatch(/^https:\/\/t\.me\/fcbot\?start=link_/)
  })
})
