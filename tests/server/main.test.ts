import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase } from '../../src/server/db'
import { ConfigError } from '../../src/server/config'
import { startServer } from '../../src/server/main'
import { initializeSchema } from '../../src/server/schema'
import { withTempDirs } from '../helpers/tmp'

// registered before the afterEach below, so it runs after it: the server stops before its folder goes
const tempDir = withTempDirs('ffd-main-')
let stop: (() => Promise<void>) | null = null

const envFor = (dataDir: string, extra: Record<string, string> = {}) =>
  ({ DATA_DIR: dataDir, PORT: '0', HOST: '127.0.0.1', CLIENT_DIR: 'does-not-exist', ...extra })

/**
 * Telegram for a server started with a token: getMe answers, getUpdates waits like a quiet long poll until the
 * reader aborts it; every other request goes to the real fetch (the tests' own requests to the server).
 */
function fakeTelegram() {
  const realFetch = globalThis.fetch
  const polls: AbortSignal[] = []
  const telegram = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (!url.startsWith('https://api.telegram.org/')) return realFetch(input, init)
    if (url.endsWith('/getMe')) return new Response(JSON.stringify({ ok: true, result: { username: 'fcbot' } }))
    polls.push(init!.signal!)
    return new Promise((_, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))) })
  })
  vi.stubGlobal('fetch', telegram)
  const asked = () => telegram.mock.calls.map(([u]) => String(u)).filter(u => u.startsWith('https://api.telegram.org/'))
  return { polls, asked }
}

/**
 * Telegram that hands the reader the updates pushed to it (a poll waits for the next push) and says yes to every
 * other bot call, remembering it; the tests' own requests go to the real fetch.
 */
function scriptedTelegram() {
  const realFetch = globalThis.fetch
  const queue: Record<string, unknown>[] = []
  const calls: { method: string; body: Record<string, unknown> }[] = []
  let wake = () => {}
  let nextId = 1
  const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }))
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (!url.startsWith('https://api.telegram.org/')) return realFetch(input, init)
    const method = url.slice(url.lastIndexOf('/') + 1)
    if (method === 'getMe') return ok({ username: 'fcbot' })
    if (method === 'getUpdates') {
      // the reader's stop() confirms the last batch with a zero timeout: nothing more to hand over
      if ((JSON.parse(String(init?.body)) as { timeout: number }).timeout === 0) return ok([])
      while (!queue.length) {
        await new Promise<void>((resolve, reject) => {
          wake = resolve
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      }
      return ok(queue.splice(0).map(update => ({ update_id: nextId++, ...update })))
    }
    calls.push({ method, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return ok(method === 'sendMessage' ? { message_id: 7 } : true)
  }))
  return { calls, push: (update: Record<string, unknown>) => { queue.push(update); wake() } }
}

// the startup lines [initializeSchema] and [server] are noise in test output
beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}) })
afterEach(async () => {
  await stop?.()
  stop = null
})

describe('main', () => {
  it('creates DATA_DIR, the database and the session key, migrates, and serves the API', async () => {
    const dataDir = join(tempDir(), 'data')
    const server = await startServer(envFor(dataDir))
    stop = server.stop
    expect(existsSync(join(dataDir, 'finance.sqlite'))).toBe(true)
    expect(existsSync(join(dataDir, 'session.key'))).toBe(true)
    const base = `http://127.0.0.1:${server.port}`
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true })
    expect((await fetch(`${base}/api/snapshot`)).status).toBe(401)
    const login = await fetch(`${base}/api/auth/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"mode":"password","password":"correct horse"}' })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    expect((await fetch(`${base}/api/settings`, { headers: { Cookie: cookie } })).status).toBe(200)
  })

  it('serves the built client from CLIENT_DIR: SPA fallback, immutable assets, 404 for a missing asset', async () => {
    const clientDir = join(tempDir(), 'client')
    mkdirSync(join(clientDir, 'assets'), { recursive: true })
    writeFileSync(join(clientDir, 'index.html'), '<!doctype html><div id="root"></div>')
    writeFileSync(join(clientDir, 'assets', 'app-abc123.js'), 'console.log(1)')
    const server = await startServer(envFor(join(tempDir(), 'data'), { CLIENT_DIR: clientDir }))
    stop = server.stop
    const base = `http://127.0.0.1:${server.port}`
    for (const path of ['/', '/capital', '/loans', '/accounts', '/real-estate']) {
      const page = await fetch(`${base}${path}`)
      expect(page.status).toBe(200)
      expect(page.headers.get('Cache-Control')).toBe('no-cache')
      expect(await page.text()).toContain('id="root"')
    }
    const asset = await fetch(`${base}/assets/app-abc123.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(await asset.text()).toBe('console.log(1)')
    expect((await fetch(`${base}/assets/app-old999.js`)).status).toBe(404)
    expect((await fetch(`${base}/api/nope`)).headers.get('Content-Type')).toMatch(/application\/json/)
  })

  // root may write anywhere, so the refusal cannot be seen when the tests run as root
  it.skipIf(process.getuid?.() === 0)('a DATA_DIR it may not write is a ConfigError with the fix, not a raw SQLite error', async () => {
    const dataDir = join(tempDir(), 'data')
    mkdirSync(dataDir)
    chmodSync(dataDir, 0o500)
    try {
      const refusal = await startServer(envFor(dataDir)).catch((err: unknown) => err)
      expect(refusal).toBeInstanceOf(ConfigError)
      expect((refusal as ConfigError).message).toMatch(/cannot write to DATA_DIR .* as uid \d+.*chown -R 1000:1000 data.*docker compose up -d/)
      expect(existsSync(join(dataDir, 'finance.sqlite'))).toBe(false)
    } finally {
      chmodSync(dataDir, 0o700)
    }
  })

  it.skipIf(process.getuid?.() === 0)('a missing DATA_DIR inside a folder it may not write is the same ConfigError', async () => {
    const parent = tempDir()
    chmodSync(parent, 0o500)
    try {
      const refusal = await startServer(envFor(join(parent, 'data'))).catch((err: unknown) => err)
      expect(refusal).toBeInstanceOf(ConfigError)
      expect((refusal as ConfigError).message).toMatch(/cannot write to DATA_DIR/)
    } finally {
      chmodSync(parent, 0o700)
    }
  })

  it.each(['password', 'telegram'])('rejects legacy AUTH_MODE=%s before creating data', async AUTH_MODE => {
    const dataDir = join(tempDir(), 'data')
    await expect(startServer(envFor(dataDir, { AUTH_MODE }))).rejects.toThrow(/AUTH_MODE only accepts "none" or "demo"/)
    expect(existsSync(dataDir)).toBe(false)
  })

  it('starts a fresh installation in bootstrap and prints the [auth] line naming 15 minutes once', async () => {
    const log = vi.mocked(console.log)
    const server = await startServer(envFor(join(tempDir(), 'data'), {}))
    stop = server.stop
    const base = `http://127.0.0.1:${server.port}`
    expect(await (await fetch(`${base}/api/auth`)).json()).toMatchObject({ mode: 'bootstrap', authenticated: false, bootstrapOpen: true })
    expect((await fetch(`${base}/api/settings`)).status).toBe(401)
    const lines = log.mock.calls.map(args => String(args[0]))
    expect(lines.filter(line => line.startsWith('[auth]'))).toEqual([expect.stringContaining('within 15 minutes')])
    // the listening line names the address only: the [auth] line names the mode
    expect(lines.find(line => line.startsWith('[server] listening'))).toMatch(/^\[server\] listening on http:\/\/127\.0\.0\.1:\d+$/)
    const done = await fetch(`${base}/api/auth/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"mode":"password","password":"a long family password"}' })
    expect(done.status).toBe(200)
    const cookie = done.headers.getSetCookie().find(line => line.startsWith('session='))!.split(';')[0]
    expect((await fetch(`${base}/api/settings`, { headers: { Cookie: cookie } })).status).toBe(200)
  })

  it('a token saved through POST /api/auth-settings/bot-token starts the bot without a restart', async () => {
    const tg = fakeTelegram()
    const server = await startServer(envFor(join(tempDir(), 'data')))
    stop = server.stop
    const base = `http://127.0.0.1:${server.port}`
    const login = await fetch(`${base}/api/auth/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"mode":"password","password":"correct horse"}' })
    const cookie = login.headers.getSetCookie().find(line => line.startsWith('session='))!.split(';')[0]
    expect(tg.asked()).toEqual([])
    const saved = await fetch(`${base}/api/auth-settings/bot-token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{"token":"123:saved\\n"}',
    })
    expect(await saved.json()).toEqual({ username: 'fcbot' })
    await vi.waitFor(() => expect(tg.polls).toHaveLength(1))
    // the route's check, then the reader's own getMe and its first long poll
    expect(tg.asked()).toEqual([
      'https://api.telegram.org/bot123:saved/getMe',
      'https://api.telegram.org/bot123:saved/getMe',
      'https://api.telegram.org/bot123:saved/getUpdates',
    ])
  })

  it('stored Telegram mode takes the token the app stored when .env has none', async () => {
    const tg = fakeTelegram()
    const dataDir = join(tempDir(), 'data')
    mkdirSync(dataDir)
    const db = openDatabase(join(dataDir, 'finance.sqlite'))
    initializeSchema(db, 'schema.sql')
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Anna'); INSERT INTO users (member, telegram_id, can_manage, created_at, updated_at) VALUES ('Anna', '42', 1, 't', 't')")
    db.sqlite.exec("INSERT INTO app_settings (key, value) VALUES ('auth_bot_token', '123:stored'), ('auth_mode', 'telegram')")
    db.close()
    const server = await startServer(envFor(dataDir))
    stop = server.stop
    await vi.waitFor(() => expect(tg.polls).toHaveLength(1))
    expect(tg.asked()[0]).toBe('https://api.telegram.org/bot123:stored/getMe')
  })

  it('db mode telegram without a linked manager starts (fallback) instead of refusing', async () => {
    const dataDir = join(tempDir(), 'data')
    mkdirSync(dataDir)
    const db = openDatabase(join(dataDir, 'finance.sqlite'))
    initializeSchema(db, 'schema.sql')
    db.sqlite.exec("INSERT INTO app_settings (key, value) VALUES ('auth_mode', 'telegram')")
    db.close()
    const server = await startServer(envFor(dataDir))
    stop = server.stop
    const auth = await (await fetch(`http://127.0.0.1:${server.port}/api/auth`)).json()
    expect(auth).toMatchObject({ mode: 'bootstrap', authenticated: false })
    const lines = vi.mocked(console.log).mock.calls.map(args => String(args[0]))
    expect(lines.filter(line => line.startsWith('[auth]'))).toEqual([expect.stringMatching(/within 15 minutes/)])
  })

  it('with a bot token the bot reader runs, and stops with the server', async () => {
    const tg = fakeTelegram()
    const server = await startServer(envFor(join(tempDir(), 'data'), { TELEGRAM_BOT_TOKEN: '123:abc' }))
    await vi.waitFor(() => expect(tg.polls).toHaveLength(1))
    expect(tg.asked()).toEqual(['https://api.telegram.org/bot123:abc/getMe', 'https://api.telegram.org/bot123:abc/getUpdates'])
    await server.stop()
    expect(tg.polls[0].aborted).toBe(true)
    expect(tg.asked()).toHaveLength(2)
  })

  it('a Confirm pressed in the bot completes the browser\'s sign-in: the bot and the app share the attempts', async () => {
    const tg = scriptedTelegram()
    const dataDir = join(tempDir(), 'data')
    mkdirSync(dataDir)
    const db = openDatabase(join(dataDir, 'finance.sqlite'))
    initializeSchema(db, 'schema.sql')
    // created before the session, or the session would belong to an earlier user with the same id
    const at = '2020-01-01T00:00:00.000Z'
    db.sqlite.exec(`INSERT INTO members (name) VALUES ('Anna'); INSERT INTO users (member, telegram_id, can_manage, created_at, updated_at) VALUES ('Anna', '42', 1, '${at}', '${at}')`)
    db.sqlite.exec("INSERT INTO app_settings (key, value) VALUES ('auth_mode', 'telegram')")
    db.close()
    const server = await startServer(envFor(dataDir, { TELEGRAM_BOT_TOKEN: '123:abc' }))
    stop = server.stop
    const base = `http://127.0.0.1:${server.port}`

    // until the bot has introduced itself the browser gets 409 bot_not_configured
    const started = await vi.waitFor(async () => {
      const res = await fetch(`${base}/api/auth/telegram`, { method: 'POST' })
      expect(res.status).toBe(200)
      return res
    })
    const code = /login_(.+)$/.exec((await started.json() as { link: string }).link)![1]
    const login = started.headers.getSetCookie().find(line => line.startsWith('login='))!.split(';')[0]
    const poll = () => fetch(`${base}/api/auth/telegram`, { headers: { Cookie: login } })

    const anna = { id: 42, first_name: 'Anna' }
    const chat = { id: 42, type: 'private' }
    tg.push({ message: { message_id: 6, date: 1, chat, from: anna, text: `/start login_${code}` } })
    await vi.waitFor(() => expect(tg.calls.some(c => c.method === 'sendMessage')).toBe(true))
    expect(await (await poll()).json()).toEqual({ status: 'waiting' })

    tg.push({ callback_query: { id: 'cb', from: anna, message: { message_id: 7, chat }, data: `login:${code}` } })
    await vi.waitFor(() => expect(tg.calls.some(c => c.method === 'editMessageText')).toBe(true))
    const done = await poll()
    expect(await done.json()).toEqual({ status: 'done' })
    const session = done.headers.getSetCookie().find(line => line.startsWith('session='))!.split(';')[0]
    const auth = await (await fetch(`${base}/api/auth`, { headers: { Cookie: session } })).json() as { authenticated: boolean; me: { name: string } }
    expect(auth).toMatchObject({ authenticated: true, me: { name: 'Anna' } })
  })

  it('without a token, or in the demo, nothing reads the bot', async () => {
    const tg = fakeTelegram()
    const family = await startServer(envFor(join(tempDir(), 'data')))
    await family.stop()
    const demo = await startServer(envFor(join(tempDir(), 'data'), { AUTH_MODE: 'demo', TELEGRAM_BOT_TOKEN: '123:abc' }))
    stop = demo.stop
    expect(tg.asked()).toEqual([])
  })

  it('stop() is idempotent: a second call waits for the same shutdown and does not throw', async () => {
    const server = await startServer(envFor(join(tempDir(), 'data')))
    const first = server.stop()
    const second = server.stop()
    expect(second).toBe(first)
    await expect(Promise.all([first, second, server.stop()])).resolves.toBeDefined()
  })

  it('rejects when the port is taken and releases the database', async () => {
    const env = envFor(join(tempDir(), 'data'))
    const taken = await startServer(env)
    stop = taken.stop
    await expect(startServer({ ...env, PORT: String(taken.port) })).rejects.toThrow(/EADDRINUSE/)
  })

  it('starts the demo server in demo mode: no finance.sqlite, no session.key', async () => {
    const dataDir = join(tempDir(), 'data')
    const server = await startServer(envFor(dataDir, { AUTH_MODE: 'demo' }))
    stop = server.stop
    const auth = await (await fetch(`http://127.0.0.1:${server.port}/api/auth`)).json()
    expect(auth).toMatchObject({ mode: 'demo', authenticated: false, hint: 'demo-family' })
    expect(existsSync(join(dataDir, 'finance.sqlite'))).toBe(false)
    expect(existsSync(join(dataDir, 'session.key'))).toBe(false)
  })

  it('refuses to start on a retired APP_PASSWORD configuration', async () => {
    await expect(startServer({ DATA_DIR: tempDir(), PORT: '0', APP_PASSWORD: 'short' })).rejects.toThrow(/APP_PASSWORD/)
  })
})

describe('onReloadSignal', () => {
  it('SIGHUP reloads sign-in and nudges the modules', async () => {
    const { onReloadSignal } = await import('../../src/server/main')
    const order: string[] = []
    const reload = vi.fn(() => { order.push('reload') })
    const nudge = vi.fn(() => { order.push('nudge') })
    const on = vi.fn()
    onReloadSignal({ reload } as never, nudge, on as never)
    expect(on).toHaveBeenCalledWith('SIGHUP', expect.any(Function))
    expect(order).toEqual([])
    on.mock.calls[0][1]()
    expect(order).toEqual(['reload', 'nudge'])
  })
})
