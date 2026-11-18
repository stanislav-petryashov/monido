vi.mock('node:timers/promises', async importOriginal => {
  const timers = await importOriginal<typeof import('node:timers/promises')>()
  return { ...timers, setTimeout: vi.fn(timers.setTimeout) }
})

import { cookieNamed, signInTelegram } from '../helpers/auth'
import { describe, expect, it, vi } from 'vitest'
import { serializeSigned } from 'hono/utils/cookie'
import { createApp } from '../../src/server/app'
import { createLoginLimiter } from '../../src/server/auth'
import { demoAuthRuntime, hashPassword, loadAuthRuntime } from '../../src/server/authSettings'
import { createLoginAttempts, type LoginAttempts } from '../../src/server/loginAttempts'
import type { BotStatus } from '../../src/domain/api'
import { createTestDb, testConfig } from '../helpers/db'
import { heldBody } from '../helpers/heldBody'
import { addUser } from '../helpers/users'

const PASSWORD = 'a long family password'
const NEW_PASSWORD = 'another long password'
const TOKEN = '123456:AAbb_cc-DD'

type Rows = { mode?: 'password' | 'telegram'; password?: string; token?: string }

/** A Telegram that knows `TOKEN` as @newbot and refuses any other token (401). */
function telegramStub() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === `https://api.telegram.org/bot${TOKEN}/getMe`) return new Response(JSON.stringify({ ok: true, result: { username: 'newbot' } }))
    return new Response(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }), { status: 401 })
  })
}

/** The family server's app over a real runtime: the auth_* rows as given, then the env of the test. */
async function setup({ env = {}, rows = {}, users = [], status, telegramFetch = telegramStub(), logins = createLoginAttempts() }: {
  env?: Record<string, string>
  logins?: LoginAttempts
  rows?: Rows
  users?: { member: string; telegramId?: string; manage?: boolean }[]
  status?: BotStatus
  telegramFetch?: typeof fetch
} = {}) {
  const db = createTestDb()
  const put = db.sqlite.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
  if (rows.mode) put.run('auth_mode', rows.mode)
  if (rows.password) put.run('auth_password', await hashPassword(rows.password))
  if (rows.token) put.run('auth_bot_token', rows.token)
  const ids = users.map(u => addUser(db, u.member, u))
  const config = testConfig(env, 'test-secret')
  const auth = await loadAuthRuntime(db, config, { log: () => {} })
  const limiter = createLoginLimiter()
  const bot = { username: () => 'fcbot', status: () => status ?? { configured: true, username: 'fcbot', problem: null } }
  const app = createApp({ db, config, auth, limiter, logins, bot, telegramFetch })
  return { app, db, auth, logins, ids, telegramFetch: telegramFetch as ReturnType<typeof telegramStub> }
}

const send = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
  method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

type App = Awaited<ReturnType<typeof setup>>['app']

/** Password mode: the family session cookie. */
async function signInPassword(app: App, password = PASSWORD): Promise<string> {
  const res = await app.request('/api/auth/login', send('POST', { password }))
  expect(res.status).toBe(200)
  return cookieNamed(res, 'session')
}

/** Telegram mode: start, the bot confirms for the user, the browser takes the session. */

/** Telegram mode from the database: a linked manager Anna and a linked Ryan without manage. */
const TELEGRAM_SETUP = {
  rows: { mode: 'telegram' as const, token: TOKEN },
  users: [{ member: 'Anna', telegramId: '100', manage: true }, { member: 'Ryan', telegramId: '200' }],
}

/** Password mode with the bot connected: a linked manager Anna and a linked Ryan without manage. */
const PROOF_SETUP = {
  rows: { password: PASSWORD, token: TOKEN },
  users: [{ member: 'Anna', telegramId: '100', manage: true }, { member: 'Ryan', telegramId: '200' }],
}

/** Password mode: the test sign-in from the family's browser, confirmed in the bot for the user; returns the switch ticket. */
async function prove(app: App, logins: LoginAttempts, family: string, userId: number): Promise<string> {
  const start = await app.request('/api/auth/telegram', { method: 'POST', headers: { Cookie: family } })
  const { link } = await start.json() as { link: string }
  expect(logins.approve(/login_(.+)$/.exec(link)![1], userId)).toBe(true)
  const done = await app.request('/api/auth/telegram', { headers: { Cookie: cookieNamed(start, 'login') } })
  return cookieNamed(done, 'switch')
}

/** POST /api/auth-settings/mode { mode: 'telegram', ...body } with the family session and the ticket (if any). */
const switchToTelegram = (app: App, family: string, ticket: string, body: { current?: string }) =>
  app.request('/api/auth-settings/mode', send('POST', { mode: 'telegram', ...body }, { Cookie: [family, ticket].filter(Boolean).join('; ') }))

describe('GET /api/auth-settings', () => {
  it('answers the view and never the token or the hash', async () => {
    const { app, db } = await setup({ rows: { password: PASSWORD, token: TOKEN }, users: [{ member: 'Anna', telegramId: '100', manage: true }] })
    const cookie = await signInPassword(app)
    const res = await app.request('/api/auth-settings', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const view = await res.json()
    expect(view).toEqual({
      mode: 'password', locked: false,
      password: { set: true, source: 'app' },
      bot: { source: 'app', username: 'fcbot', problem: null },
      switchToTelegram: { bot: true, linkedManager: true, proof: null },
      fallback: null,
    })
    const hash = (db.sqlite.prepare("SELECT value FROM app_settings WHERE key = 'auth_password'").get() as { value: string }).value
    const text = JSON.stringify(view)
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(hash)
  })

  it('a bot with a problem, no linked manager, the stored password, env bot token and fallback', async () => {
    const problem = { configured: true, username: null, problem: 'telegram.bad_token' }
    const { app } = await setup({ env: { TELEGRAM_BOT_TOKEN: TOKEN }, rows: { mode: 'telegram', password: PASSWORD }, status: problem })
    const cookie = await signInPassword(app, PASSWORD)
    const view = await (await app.request('/api/auth-settings', { headers: { Cookie: cookie } })).json()
    expect(view).toEqual({
      mode: 'password', locked: false,
      password: { set: true, source: 'app' },
      bot: { source: 'env', username: null, problem: 'telegram.bad_token' },
      switchToTelegram: { bot: false, linkedManager: false, proof: null },
      fallback: 'password',
    })
  })

  it('while Telegram fell back at start: the bot cannot be disconnected, and "password" cancels the stored Telegram mode', async () => {
    const { app, db } = await setup({ rows: { mode: 'telegram', password: PASSWORD, token: TOKEN } })
    const cookie = await signInPassword(app, PASSWORD)
    const headers = { Cookie: cookie, Origin: 'http://localhost' }
    const remove = await app.request('/api/auth-settings/bot-token', { method: 'DELETE', headers })
    expect(await remove.json()).toEqual({ error: { code: 'wrong_mode' } })
    const keep = await app.request('/api/auth-settings/mode', send('POST', { mode: 'password' }, headers))
    expect(keep.status).toBe(200)
    expect(db.sqlite.prepare("SELECT value FROM app_settings WHERE key = 'auth_mode'").get()).toEqual({ value: 'password' })
  })

  it('GET and every write need manage: 403 for a telegram user without it', async () => {
    const { app, logins, ids } = await setup(TELEGRAM_SETUP)
    const cookie = await signInTelegram(app, logins, ids[1])
    const headers = { Cookie: cookie }
    expect(await (await app.request('/api/auth-settings', { headers })).json()).toEqual({ error: { code: 'no_right_manage' } })
    for (const [method, path, body] of [
      ['GET', '/api/auth-settings', undefined],
      ['POST', '/api/auth-settings/password', { password: NEW_PASSWORD }],
      ['POST', '/api/auth-settings/bot-token', { token: TOKEN }],
      ['DELETE', '/api/auth-settings/bot-token', undefined],
      ['POST', '/api/auth-settings/mode', { mode: 'password', password: NEW_PASSWORD }],
    ] as const) {
      const res = await app.request(path, send(method, body, headers))
      expect(res.status, `${method} ${path}`).toBe(403)
    }
    // the manager may
    const manager = await signInTelegram(app, logins, ids[0])
    expect((await app.request('/api/auth-settings', { headers: { Cookie: manager } })).status).toBe(200)
  })

  it('without a session every route is 401', async () => {
    const { app } = await setup({ rows: { password: PASSWORD } })
    expect((await app.request('/api/auth-settings')).status).toBe(401)
    expect((await app.request('/api/auth-settings/password', send('POST', { password: NEW_PASSWORD }))).status).toBe(401)
  })
})

describe('POST /api/auth-settings/password', () => {
  it('in password mode needs current: wrong → 401 counted by the limiter (10 → 429), right → ok + a fresh session; the old cookie is 401', async () => {
    const { app, auth } = await setup({ rows: { password: PASSWORD } })
    const old = await signInPassword(app)
    const headers = { Cookie: old }
    for (let i = 0; i < 10; i++) {
      const wrong = await app.request('/api/auth-settings/password', send('POST', { current: 'not the password at all', password: NEW_PASSWORD }, headers))
      expect(wrong.status).toBe(401)
      expect(await wrong.json()).toEqual({ error: { code: 'wrong_current_password' } })
    }
    const blocked = await app.request('/api/auth-settings/password', send('POST', { current: PASSWORD, password: NEW_PASSWORD }, headers))
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: { code: 'too_many_attempts' } })
    expect(await auth.verifyPassword(PASSWORD)).toBe(true)
  })

  it('a missing current is wrong too; the right one changes the password and re-issues the session', async () => {
    const { app, auth } = await setup({ rows: { password: PASSWORD } })
    const old = await signInPassword(app)
    const headers = { Cookie: old }
    const missing = await app.request('/api/auth-settings/password', send('POST', { password: NEW_PASSWORD }, headers))
    expect(await missing.json()).toEqual({ error: { code: 'wrong_current_password' } })
    const done = await app.request('/api/auth-settings/password', send('POST', { current: PASSWORD, password: NEW_PASSWORD }, headers))
    expect(done.status).toBe(200)
    expect(await done.json()).toEqual({ ok: true })
    const fresh = cookieNamed(done, 'session')
    expect(fresh).toMatch(/^session=/)
    expect((await app.request('/api/auth-settings', { headers: { Cookie: old } })).status).toBe(401)
    expect((await app.request('/api/auth-settings', { headers: { Cookie: fresh } })).status).toBe(200)
    expect(await auth.verifyPassword(NEW_PASSWORD)).toBe(true)
    expect(await auth.verifyPassword(PASSWORD)).toBe(false)
  })

  it('in telegram mode needs no current and re-issues the caller\'s telegram session', async () => {
    const { app, auth, logins, ids } = await setup(TELEGRAM_SETUP)
    const anna = await signInTelegram(app, logins, ids[0])
    const ryan = await signInTelegram(app, logins, ids[1])
    const done = await app.request('/api/auth-settings/password', send('POST', { password: NEW_PASSWORD }, { Cookie: anna }))
    expect(done.status).toBe(200)
    const fresh = cookieNamed(done, 'session')
    expect(decodeURIComponent(fresh)).toMatch(new RegExp(`^session=${ids[0]}\\.\\d+\\.`))
    expect(auth.mode()).toBe('telegram')
    expect(await auth.verifyPassword(NEW_PASSWORD)).toBe(true)
    expect(await (await app.request('/api/auth', { headers: { Cookie: fresh } })).json()).toMatchObject({ authenticated: true, me: { name: 'Anna' } })
    // everyone else signs in again
    expect((await app.request('/api/snapshot', { headers: { Cookie: ryan } })).status).toBe(401)
  })

  it('a password change committed while current verifies: wrong_current_password, the other change stands, no session', async () => {
    const { app, auth } = await setup({ rows: { password: PASSWORD } })
    const headers = { Cookie: await signInPassword(app) }
    const verify = auth.verifyPassword.bind(auth)
    vi.spyOn(auth, 'verifyPassword').mockImplementationOnce(async given => {
      const ok = await verify(given)
      await auth.setPassword('a third long password', { name: 'family', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null })
      return ok
    })
    const res = await app.request('/api/auth-settings/password', send('POST', { current: PASSWORD, password: NEW_PASSWORD }, headers))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'wrong_current_password' } })
    expect(res.headers.getSetCookie()).toEqual([])
    expect(await auth.verifyPassword('a third long password')).toBe(true)
  })

  it('a switch committed while the new password hashes: 409 wrong_mode, no session, never a 500', async () => {
    const { app, auth, logins, ids } = await setup(TELEGRAM_SETUP)
    const anna = await signInTelegram(app, logins, ids[0])
    const set = auth.setPassword.bind(auth)
    vi.spyOn(auth, 'setPassword').mockImplementationOnce(async (password, actor) => {
      await set(password, actor)
      await auth.setMode('password', actor)
    })
    const res = await app.request('/api/auth-settings/password', send('POST', { password: NEW_PASSWORD }, { Cookie: anna }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'wrong_mode' } })
    expect(res.headers.getSetCookie()).toEqual([])
    expect(await auth.verifyPassword(NEW_PASSWORD)).toBe(true)
  })

  it('password_too_short, password_too_long', async () => {
    const { app } = await setup({ rows: { password: PASSWORD } })
    const headers = { Cookie: await signInPassword(app) }
    const short = await app.request('/api/auth-settings/password', send('POST', { current: PASSWORD, password: 'short' }, headers))
    expect(short.status).toBe(400)
    expect(await short.json()).toEqual({ error: { code: 'password_too_short' } })
    const long = await app.request('/api/auth-settings/password', send('POST', { current: PASSWORD, password: 'x'.repeat(129) }, headers))
    expect(long.status).toBe(400)
    expect(await long.json()).toEqual({ error: { code: 'password_too_long' } })
  })
})

describe('POST /api/auth-settings/bot-token', () => {
  it('trims, checks digits:letters (invalid_value), calls getMe before storing, answers { username }', async () => {
    const { app, auth, telegramFetch } = await setup({ rows: { password: PASSWORD } })
    const headers = { Cookie: await signInPassword(app) }
    for (const token of ['not a token', '123:', ':abc', '123:a b', 42]) {
      const bad = await app.request('/api/auth-settings/bot-token', send('POST', { token }, headers))
      expect(bad.status).toBe(400)
      expect(await bad.json()).toEqual({ error: { code: 'invalid_value', params: { column: 'token' } } })
    }
    expect(telegramFetch).not.toHaveBeenCalled()
    let storedAtGetMe: string | null = 'unset'
    telegramFetch.mockImplementationOnce(async () => {
      storedAtGetMe = auth.botToken()
      return new Response(JSON.stringify({ ok: true, result: { username: 'newbot' } }))
    })
    const res = await app.request('/api/auth-settings/bot-token', send('POST', { token: `  ${TOKEN}\n` }, headers))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ username: 'newbot' })
    expect(String(telegramFetch.mock.calls[0][0])).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`)
    expect(storedAtGetMe).toBeNull()
    expect(auth.botToken()).toBe(TOKEN)
    expect(auth.botTokenSource()).toBe('app')
  })

  it('getMe refused → 409 telegram.bad_token; nothing stored, old token kept', async () => {
    const { app, auth, db } = await setup({ rows: { password: PASSWORD, token: '111:old' } })
    const headers = { Cookie: await signInPassword(app) }
    const res = await app.request('/api/auth-settings/bot-token', send('POST', { token: '999:refused' }, headers))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'telegram.bad_token' } })
    expect(auth.botToken()).toBe('111:old')
    expect(db.sqlite.prepare("SELECT value FROM app_settings WHERE key = 'auth_bot_token'").get()).toEqual({ value: '111:old' })
  })

  it('Telegram\'s status and its own reason reach the client: 500 with no body → telegram.status, 400 with a description → telegram.external', async () => {
    const empty = vi.fn(async () => new Response('', { status: 500 }))
    const first = await setup({ rows: { password: PASSWORD }, telegramFetch: empty })
    const status = await first.app.request('/api/auth-settings/bot-token', send('POST', { token: TOKEN }, { Cookie: await signInPassword(first.app) }))
    expect(status.status).toBe(409)
    expect(await status.json()).toEqual({ error: { code: 'telegram.status', params: { status: 500 } } })
    expect(first.auth.botToken()).toBeNull()

    const described = vi.fn(async () => new Response(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: try later' }), { status: 400 }))
    const second = await setup({ rows: { password: PASSWORD }, telegramFetch: described })
    const external = await second.app.request('/api/auth-settings/bot-token', send('POST', { token: TOKEN }, { Cookie: await signInPassword(second.app) }))
    expect(external.status).toBe(409)
    expect(await external.json()).toEqual({ error: { code: 'telegram.external', params: { status: 400, detail: 'Bad Request: try later' } } })
    expect(second.auth.botToken()).toBeNull()
  })

  it('fetch rejects → 409 telegram.unavailable, never a 500; nothing stored, the token never logged', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const telegramFetch = vi.fn().mockRejectedValue(new Error(`connect ECONNREFUSED https://api.telegram.org/bot${TOKEN}/getMe`))
    const { app, auth } = await setup({ rows: { password: PASSWORD, token: '111:old' }, telegramFetch })
    const headers = { Cookie: await signInPassword(app) }
    const res = await app.request('/api/auth-settings/bot-token', send('POST', { token: TOKEN }, headers))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'telegram.unavailable' } })
    expect(auth.botToken()).toBe('111:old')
    expect(JSON.stringify(error.mock.calls)).not.toContain(TOKEN)
  })

  it('a failure the route did not expect is a masked 500 log line, the token cut out', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { app, auth } = await setup({ rows: { password: PASSWORD } })
    const headers = { Cookie: await signInPassword(app) }
    vi.spyOn(auth, 'setBotToken').mockRejectedValue(new Error(`disk I/O error near ${TOKEN}`))
    const res = await app.request('/api/auth-settings/bot-token', send('POST', { token: TOKEN }, headers))
    expect(res.status).toBe(500)
    const logged = JSON.stringify(error.mock.calls)
    expect(logged).toContain('***')
    expect(logged).not.toContain(TOKEN)
  })

  it('bot_token_locked under env with getMe never called; a second call within 5 s → 429 too_many_attempts', async () => {
    const locked = await setup({ rows: { password: PASSWORD }, env: { TELEGRAM_BOT_TOKEN: '111:env' } })
    const envHeaders = { Cookie: await signInPassword(locked.app, PASSWORD) }
    const res = await locked.app.request('/api/auth-settings/bot-token', send('POST', { token: TOKEN }, envHeaders))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'bot_token_locked' } })
    expect(locked.telegramFetch).not.toHaveBeenCalled()

    const { app, telegramFetch } = await setup({ rows: { password: PASSWORD } })
    const headers = { Cookie: await signInPassword(app) }
    expect((await app.request('/api/auth-settings/bot-token', send('POST', { token: TOKEN }, headers))).status).toBe(200)
    const again = await app.request('/api/auth-settings/bot-token', send('POST', { token: TOKEN }, headers))
    expect(again.status).toBe(429)
    expect(await again.json()).toEqual({ error: { code: 'too_many_attempts' } })
    expect(telegramFetch).toHaveBeenCalledTimes(1)
  })
})

describe('DELETE /api/auth-settings/bot-token', () => {
  it('ok in password mode; wrong_mode in telegram mode; bot_token_locked under env', async () => {
    const password = await setup({ rows: { password: PASSWORD, token: TOKEN } })
    const res = await password.app.request('/api/auth-settings/bot-token', send('DELETE', undefined, { Cookie: await signInPassword(password.app) }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(password.auth.botToken()).toBeNull()

    const telegram = await setup(TELEGRAM_SETUP)
    const anna = await signInTelegram(telegram.app, telegram.logins, telegram.ids[0])
    const wrong = await telegram.app.request('/api/auth-settings/bot-token', send('DELETE', undefined, { Cookie: anna }))
    expect(wrong.status).toBe(409)
    expect(await wrong.json()).toEqual({ error: { code: 'wrong_mode' } })
    expect(telegram.auth.botToken()).toBe(TOKEN)

    const locked = await setup({ rows: { password: PASSWORD }, env: { TELEGRAM_BOT_TOKEN: TOKEN } })
    const refused = await locked.app.request('/api/auth-settings/bot-token', send('DELETE', undefined, { Cookie: await signInPassword(locked.app, PASSWORD) }))
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: { code: 'bot_token_locked' } })
  })
})

describe('POST /api/auth-settings/mode', () => {
  it('password from telegram keeps the stored password: a password session for the caller, everyone else is 401', async () => {
    const { app, auth, logins, ids } = await setup({ ...TELEGRAM_SETUP, rows: { ...TELEGRAM_SETUP.rows, password: PASSWORD } })
    const anna = await signInTelegram(app, logins, ids[0])
    const ryan = await signInTelegram(app, logins, ids[1])
    const res = await app.request('/api/auth-settings/mode', send('POST', { mode: 'password' }, { Cookie: anna }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(auth.mode()).toBe('password')
    const fresh = cookieNamed(res, 'session')
    expect(decodeURIComponent(fresh)).toMatch(/^session=\d+\./)
    expect(await (await app.request('/api/auth', { headers: { Cookie: fresh } })).json()).toMatchObject({ mode: 'password', authenticated: true, me: { name: null } })
    expect((await app.request('/api/snapshot', { headers: { Cookie: anna } })).status).toBe(401)
    expect((await app.request('/api/snapshot', { headers: { Cookie: ryan } })).status).toBe(401)
    expect(await auth.verifyPassword(PASSWORD)).toBe(true)
  })

  it('password from telegram sets a given password', async () => {
    const { app, auth, logins, ids } = await setup(TELEGRAM_SETUP)
    const anna = await signInTelegram(app, logins, ids[0])
    const res = await app.request('/api/auth-settings/mode', send('POST', { mode: 'password', password: NEW_PASSWORD }, { Cookie: anna }))
    expect(res.status).toBe(200)
    expect(auth.mode()).toBe('password')
    expect(await auth.verifyPassword(NEW_PASSWORD)).toBe(true)
    await signInPassword(app, NEW_PASSWORD)
  })

  it('a session revoked while the body was held open cannot switch: 401, only the concurrent change happened, no cookie', async () => {
    const { app, db, auth, logins, ids } = await setup(TELEGRAM_SETUP)
    const anna = await signInTelegram(app, logins, ids[0])
    const held = heldBody({ mode: 'password', password: NEW_PASSWORD })
    const pending = app.request(new Request('http://localhost/api/auth-settings/mode', {
      method: 'POST', body: held.body, headers: { 'Content-Type': 'application/json', Cookie: anna }, duplex: 'half',
    } as RequestInit))
    // the owner sets the family password while the request waits for its body: Anna's session is revoked
    await held.reading
    await auth.setPassword('the owner new password', { name: 'family', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null })
    const settings = () => db.sqlite.prepare('SELECT key, value FROM app_settings ORDER BY key').all()
    const after = settings()
    const journal = db.sqlite.prepare('SELECT COUNT(*) AS n FROM change_log').get()
    const generation = auth.generation()
    held.release()
    const res = await pending
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized' } })
    expect(res.headers.getSetCookie()).toEqual([])
    expect(settings()).toEqual(after)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM change_log').get()).toEqual(journal)
    expect(auth.generation()).toBe(generation)
    expect(auth.mode()).toBe('telegram')
    expect(await auth.verifyPassword('the owner new password')).toBe(true)
  })

  it('password_needed with none anywhere, password_too_short, same_mode in password mode', async () => {
    const { app, auth, logins, ids } = await setup(TELEGRAM_SETUP)
    const headers = { Cookie: await signInTelegram(app, logins, ids[0]) }
    const needed = await app.request('/api/auth-settings/mode', send('POST', { mode: 'password' }, headers))
    expect(needed.status).toBe(409)
    expect(await needed.json()).toEqual({ error: { code: 'password_needed' } })
    const short = await app.request('/api/auth-settings/mode', send('POST', { mode: 'password', password: 'short' }, headers))
    expect(short.status).toBe(400)
    expect(await short.json()).toEqual({ error: { code: 'password_too_short' } })
    const invalid = await app.request('/api/auth-settings/mode', send('POST', { mode: 'basic' }, headers))
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: { code: 'invalid_value', params: { column: 'mode' } } })
    expect(auth.mode()).toBe('telegram')

    const password = await setup({ rows: { password: PASSWORD } })
    const same = await password.app.request('/api/auth-settings/mode', send('POST', { mode: 'password' }, { Cookie: await signInPassword(password.app) }))
    expect(same.status).toBe(409)
    expect(await same.json()).toEqual({ error: { code: 'same_mode' } })
  })

  it('switches to telegram with the ticket and the current password: a telegram session for that user, the ticket deleted, the family session 401', async () => {
    const { app, auth, logins, ids } = await setup(PROOF_SETUP)
    const family = await signInPassword(app)
    const ticket = await prove(app, logins, family, ids[0])
    const res = await switchToTelegram(app, family, ticket, { current: PASSWORD })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(auth.mode()).toBe('telegram')
    const fresh = cookieNamed(res, 'session')
    expect(decodeURIComponent(fresh)).toMatch(new RegExp(`^session=${ids[0]}\\.\\d+\\.`))
    expect(await (await app.request('/api/auth', { headers: { Cookie: fresh } })).json())
      .toMatchObject({ mode: 'telegram', authenticated: true, me: { name: 'Anna', rights: { manage: true } } })
    const deleted = res.headers.getSetCookie().find(line => line.startsWith('switch='))
    expect(deleted).toMatch(/^switch=;/)
    expect(deleted).toContain('Path=/api/auth-settings')
    expect(deleted).toContain('Max-Age=0')
    expect((await app.request('/api/snapshot', { headers: { Cookie: family } })).status).toBe(401)
    // the password stays saved for switching back
    expect(await auth.verifyPassword(PASSWORD)).toBe(true)
  })

  it('wrong or missing current → 401 wrong_current_password (counted) even with a valid ticket', async () => {
    const { app, auth, logins, ids } = await setup(PROOF_SETUP)
    const family = await signInPassword(app)
    const ticket = await prove(app, logins, family, ids[0])
    const missing = await switchToTelegram(app, family, ticket, {})
    expect(missing.status).toBe(401)
    expect(await missing.json()).toEqual({ error: { code: 'wrong_current_password' } })
    // the test sign-in's start and the missing current are two failures of this client already
    for (let i = 2; i < 10; i++) {
      const wrong = await switchToTelegram(app, family, ticket, { current: 'not the family password' })
      expect(wrong.status).toBe(401)
      expect(await wrong.json()).toEqual({ error: { code: 'wrong_current_password' } })
    }
    // ten failures from this client: even the right password is refused now
    const blocked = await switchToTelegram(app, family, ticket, { current: PASSWORD })
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: { code: 'too_many_attempts' } })
    expect(auth.mode()).toBe('password')
    expect(blocked.headers.getSetCookie()).toEqual([])
  })

  it('a password change committed while current verifies: wrong_current_password, the mode stays password', async () => {
    const { app, auth, logins, ids } = await setup(PROOF_SETUP)
    const family = await signInPassword(app)
    const ticket = await prove(app, logins, family, ids[0])
    const verify = auth.verifyPassword.bind(auth)
    vi.spyOn(auth, 'verifyPassword').mockImplementationOnce(async given => {
      const ok = await verify(given)
      await auth.setPassword(NEW_PASSWORD, { name: 'family', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null })
      return ok
    })
    const res = await switchToTelegram(app, family, ticket, { current: PASSWORD })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'wrong_current_password' } })
    expect(auth.mode()).toBe('password')
  })

  it('no_bot, no_linked_manager, no_proof (no cookie, or the user re-linked since), proof_expired (approvedAt older than 10 min, injected now), proof_not_manager with { member }', async () => {
    const refusal = async (res: Response, code: string, params?: Record<string, unknown>) => {
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: params ? { code, params } : { code } })
    }

    const noBot = await setup({ ...PROOF_SETUP, status: { configured: true, username: null, problem: 'telegram.bad_token' } })
    const noBotFamily = await signInPassword(noBot.app)
    await refusal(await switchToTelegram(noBot.app, noBotFamily, await prove(noBot.app, noBot.logins, noBotFamily, noBot.ids[0]), { current: PASSWORD }), 'no_bot')
    const noToken = await setup({ ...PROOF_SETUP, rows: { password: PASSWORD } })
    await refusal(await switchToTelegram(noToken.app, await signInPassword(noToken.app), '', { current: PASSWORD }), 'no_bot')

    const noManager = await setup({ ...PROOF_SETUP, users: [{ member: 'Ryan', telegramId: '200' }] })
    const noManagerFamily = await signInPassword(noManager.app)
    await refusal(await switchToTelegram(noManager.app, noManagerFamily, await prove(noManager.app, noManager.logins, noManagerFamily, noManager.ids[0]), { current: PASSWORD }), 'no_linked_manager')

    const { app, auth, db, logins, ids } = await setup(PROOF_SETUP)
    const family = await signInPassword(app)
    await refusal(await switchToTelegram(app, family, '', { current: PASSWORD }), 'no_proof')
    // a ticket not signed by the server is none
    await refusal(await switchToTelegram(app, family, `switch=${ids[0]}.${Date.now()}`, { current: PASSWORD }), 'no_proof')
    const relinked = await prove(app, logins, family, ids[0])
    db.sqlite.prepare('UPDATE users SET telegram_linked_at = ? WHERE id = ?').run(new Date(Date.now() + 1000).toISOString(), ids[0])
    await refusal(await switchToTelegram(app, family, relinked, { current: PASSWORD }), 'no_proof')
    db.sqlite.prepare('UPDATE users SET telegram_linked_at = NULL WHERE id = ?').run(ids[0])
    await refusal(await switchToTelegram(app, family, await prove(app, logins, family, ids[1]), { current: PASSWORD }), 'proof_not_manager', { member: 'Ryan' })
    expect(auth.mode()).toBe('password')

    // the bot approved more than 10 minutes ago
    let clock = Date.now() - 10 * 60_000
    const old = await setup({ ...PROOF_SETUP, logins: createLoginAttempts({ now: () => clock }) })
    const oldFamily = await signInPassword(old.app)
    const expired = await prove(old.app, old.logins, oldFamily, old.ids[0])
    await refusal(await switchToTelegram(old.app, oldFamily, expired, { current: PASSWORD }), 'proof_expired')
    // a minute younger is in time
    clock = Date.now() - 9 * 60_000
    const fresh = await prove(old.app, old.logins, oldFamily, old.ids[0])
    expect((await switchToTelegram(old.app, oldFamily, fresh, { current: PASSWORD })).status).toBe(200)
  })

  it('same_mode in telegram mode', async () => {
    const { app, logins, ids } = await setup(TELEGRAM_SETUP)
    const same = await switchToTelegram(app, await signInTelegram(app, logins, ids[0]), '', { current: PASSWORD })
    expect(same.status).toBe(409)
    expect(await same.json()).toEqual({ error: { code: 'same_mode' } })
  })

  it('GET /api/auth-settings shows the proof from the ticket: { member, manage }', async () => {
    const { app, logins, ids } = await setup(PROOF_SETUP)
    const family = await signInPassword(app)
    const view = async (ticket: string) => ((await (await app.request('/api/auth-settings', { headers: { Cookie: [family, ticket].filter(Boolean).join('; ') } })).json()) as { switchToTelegram: unknown }).switchToTelegram
    expect(await view('')).toEqual({ bot: true, linkedManager: true, proof: null })
    expect(await view(await prove(app, logins, family, ids[0]))).toEqual({ bot: true, linkedManager: true, proof: { member: 'Anna', manage: true } })
    expect(await view(await prove(app, logins, family, ids[1]))).toEqual({ bot: true, linkedManager: true, proof: { member: 'Ryan', manage: false } })
  })
})

it('the journal holds *** for auth_password and the real values for auth_mode', async () => {
  const { app, db, logins, ids } = await setup(TELEGRAM_SETUP)
  const anna = { Cookie: await signInTelegram(app, logins, ids[0]) }
  const start = (db.sqlite.prepare('SELECT MAX(id) AS id FROM change_log').get() as { id: number | null }).id ?? 0
  expect((await app.request('/api/auth-settings/password', send('POST', { password: NEW_PASSWORD }, anna))).status).toBe(200)
  const fresh = { Cookie: await signInTelegram(app, logins, ids[0]) }
  expect((await app.request('/api/auth-settings/mode', send('POST', { mode: 'password' }, fresh))).status).toBe(200)
  const entries = db.sqlite.prepare("SELECT actor, before_json, after_json FROM change_log WHERE id > ? AND table_name = 'app_settings' ORDER BY id").all(start) as { actor: string; before_json: string | null; after_json: string | null }[]
  const byKey = (key: string) => entries.filter(e => (e.after_json ?? e.before_json ?? '').includes(`"key":"${key}"`))
  expect(byKey('auth_password').map(e => [e.actor, e.after_json])).toEqual([
    ['Anna', JSON.stringify({ key: 'auth_password', value: '***' })],
  ])
  expect(byKey('auth_mode').map(e => [e.actor, e.before_json, e.after_json])).toEqual([
    ['Anna', JSON.stringify({ key: 'auth_mode', value: 'telegram' }), JSON.stringify({ key: 'auth_mode', value: 'password' })],
  ])
})

it('the journal holds *** for auth_bot_token, set and cleared', async () => {
  const { app, db } = await setup({ rows: { password: PASSWORD } })
  const headers = { Cookie: await signInPassword(app) }
  expect((await app.request('/api/auth-settings/bot-token', send('POST', { token: TOKEN }, headers))).status).toBe(200)
  expect((await app.request('/api/auth-settings/bot-token', send('DELETE', undefined, headers))).status).toBe(200)
  const masked = JSON.stringify({ key: 'auth_bot_token', value: '***' })
  const entries = db.sqlite.prepare("SELECT actor, op, before_json, after_json FROM change_log WHERE table_name = 'app_settings' AND (after_json LIKE '%auth_bot_token%' OR before_json LIKE '%auth_bot_token%') ORDER BY id").all()
  expect(entries).toEqual([
    { actor: 'family', op: 'insert', before_json: null, after_json: masked },
    { actor: 'family', op: 'delete', before_json: masked, after_json: null },
  ])
})

it('in the demo every /api/auth-settings route is 403 not_in_demo', async () => {
  const db = createTestDb()
  const config = testConfig({ AUTH_MODE: 'demo' }, 'demo-secret')
  const app = createApp({ db, config, auth: demoAuthRuntime(config), ratesOnline: false })
  for (const [method, path, body] of [
    ['GET', '/api/auth-settings', undefined],
    ['POST', '/api/auth-settings/password', { password: NEW_PASSWORD }],
    ['POST', '/api/auth-settings/bot-token', { token: TOKEN }],
    ['DELETE', '/api/auth-settings/bot-token', undefined],
    ['POST', '/api/auth-settings/mode', { mode: 'password' }],
  ] as const) {
    const res = await app.request(path, send(method, body))
    expect(res.status, `${method} ${path}`).toBe(403)
    expect(await res.json()).toEqual({ error: { code: 'not_in_demo' } })
  }
})

it('other methods are 405', async () => {
  const { app } = await setup({ rows: { password: PASSWORD } })
  const headers = { Cookie: await signInPassword(app) }
  expect((await app.request('/api/auth-settings', send('POST', {}, headers))).status).toBe(405)
  expect((await app.request('/api/auth-settings/password', send('GET', undefined, headers))).status).toBe(405)
  expect((await app.request('/api/auth-settings/mode', send('PUT', {}, headers))).status).toBe(405)
})

describe('environment-only no-sign-in mode', () => {
  it('rejects disabling sign-in through the settings API without changing stored auth', async () => {
    const { app, auth, db } = await setup({ rows: { password: PASSWORD } })
    const headers = { Cookie: await signInPassword(app) }
    const before = db.sqlite.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'auth_%' ORDER BY key").all()
    for (const current of ['wrong', PASSWORD]) {
      const res = await app.request('/api/auth-settings/mode', send('POST', { mode: 'none', current }, headers))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: { code: 'invalid_value', params: { column: 'mode' } } })
    }
    expect(auth.mode()).toBe('password')
    expect(db.sqlite.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'auth_%' ORDER BY key").all()).toEqual(before)
  })

  it('shows the environment lock and refuses web mode changes', async () => {
    const { app, auth, ids } = await setup({ ...PROOF_SETUP, env: { AUTH_MODE: 'none' } })
    const ticket = await serializeSigned('switch', `${ids[0]}.${Date.now()}`, auth.signingKey())
    const view = await (await app.request('/api/auth-settings', { headers: { Cookie: ticket.split(';')[0] } })).json()
    expect(view).toMatchObject({ mode: 'none', locked: true, password: { set: true, source: 'app' }, switchToTelegram: { proof: null } })
    for (const mode of ['password', 'telegram']) {
      const res = await app.request('/api/auth-settings/mode', send('POST', { mode, password: NEW_PASSWORD }))
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: { code: 'auth_mode_locked' } })
    }
    expect(auth.mode()).toBe('none')
    expect(await auth.verifyPassword(PASSWORD)).toBe(true)
  })
})

describe('targeted Telegram switch confirmation', () => {
  it('waits until the approval clock is strictly newer even if a timer wakes early', async () => {
    const { app, logins, ids } = await setup({ logins: createLoginAttempts({ now: () => Date.now() }), rows: { password: PASSWORD, token: TOKEN }, users: [{ member: 'Anna', manage: true }] })
    const family = await signInPassword(app)
    const start = await app.request('/api/auth/telegram', send('POST', { userId: ids[0] }, { Cookie: family }))
    const { attempt } = await start.json() as { attempt: string }
    const now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    const timers = await import('node:timers/promises')
    let wakes = 0
    vi.mocked(timers.setTimeout).mockImplementation(async () => {
      if (++wakes > 1) vi.setSystemTime(now + 2)
    })
    try {
      expect(await logins.confirm(attempt, { id: '100', name: 'Anna T' })).toBe(true)
      const done = await app.request('/api/auth/telegram', { headers: { Cookie: cookieNamed(start, 'login') } })
      expect(await done.json()).toEqual({ status: 'done', member: 'Anna', manage: true })
    } finally { vi.useRealTimers() }
  })

  it('links an unlinked selected user and creates browser proof with one confirmation', async () => {
    const { app, db, logins, ids } = await setup({ rows: { password: PASSWORD, token: TOKEN }, users: [{ member: 'Anna', manage: true }] })
    const family = await signInPassword(app)
    const start = await app.request('/api/auth/telegram', send('POST', { userId: ids[0] }, { Cookie: family }))
    const { link } = await start.json() as { link: string }
    const code = /login_(.+)$/.exec(link)![1]
    const { handleSignIn } = await import('../../src/server/bot/signIn')
    const fetchImpl = async () => new Response(JSON.stringify({ ok: true, result: true }))
    await handleSignIn({ kind: 'callback', id: 'confirm', chatId: '100', messageId: 1, from: { id: '100', name: 'Anna T' }, data: `login:${code}` }, { db, token: TOKEN, logins, fetchImpl })
    const done = await app.request('/api/auth/telegram', { headers: { Cookie: cookieNamed(start, 'login') } })
    expect(await done.json()).toEqual({ status: 'done', member: 'Anna', manage: true })
    expect(db.sqlite.prepare('SELECT telegram_id FROM users WHERE id = ?').get(ids[0])).toEqual({ telegram_id: '100' })
    expect((await switchToTelegram(app, family, cookieNamed(done, 'switch'), { current: PASSWORD })).status).toBe(200)
    db.close()
  })
})


describe('targeted Telegram proof security', () => {
  async function startTarget(telegramId?: string) {
    const ctx = await setup({ rows: { password: PASSWORD, token: TOKEN }, users: [{ member: 'Anna', telegramId, manage: true }, { member: 'Ryan', telegramId: '200' }] })
    const family = await signInPassword(ctx.app)
    const start = await ctx.app.request('/api/auth/telegram', send('POST', { userId: ctx.ids[0] }, { Cookie: family }))
    const { attempt } = await start.json() as { attempt: string }
    const cookie = cookieNamed(start, 'login')
    const confirm = async (id = '100') => {
      const { handleSignIn } = await import('../../src/server/bot/signIn')
      return handleSignIn({ kind: 'callback', id: 'confirm', chatId: id, messageId: 1, from: { id, name: 'Telegram name' }, data: `login:${attempt}` }, { db: ctx.db, token: TOKEN, logins: ctx.logins, fetchImpl: async () => new Response(JSON.stringify({ ok: true, result: true })) })
    }
    const poll = () => ctx.app.request('/api/auth/telegram', { headers: { Cookie: cookie } })
    return { ...ctx, family, attempt, cookie, confirm, poll }
  }

  it.each(['100', undefined])('rejects another account without moving a link (selected link: %s)', async telegramId => {
    const ctx = await startTarget(telegramId)
    await ctx.confirm('200')
    expect(await (await ctx.poll()).json()).toEqual({ status: 'mismatch' })
    expect(ctx.db.sqlite.prepare('SELECT telegram_id FROM users WHERE id = ?').get(ctx.ids[0])).toEqual({ telegram_id: telegramId ?? null })
    ctx.db.close()
  })

  it.each(['bot', 'mode', 'generation', 'deleted', 'relinked', 'disabled', 'cancelled'] as const)('expires before confirmation when %s changes', async change => {
    const ctx = await startTarget()
    if (change === 'bot') await ctx.auth.setBotToken('456:new', { name: 'test', source: 'admin', rights: { manage: true, edit: true, vote: true }, userId: null }, async () => ({ username: 'newbot' }))
    if (change === 'mode') await ctx.auth.setMode('telegram', { name: 'test', source: 'admin', rights: { manage: true, edit: true, vote: true }, userId: null })
    if (change === 'generation') await ctx.auth.setPassword(NEW_PASSWORD, { name: 'test', source: 'admin', rights: { manage: true, edit: true, vote: true }, userId: null })
    if (change === 'deleted') ctx.db.sqlite.prepare('DELETE FROM users WHERE id = ?').run(ctx.ids[0])
    if (change === 'relinked') ctx.db.sqlite.prepare("UPDATE users SET telegram_id = '300' WHERE id = ?").run(ctx.ids[0])
    if (change === 'disabled') ctx.db.sqlite.prepare('UPDATE users SET telegram_sign_in = 0 WHERE id = ?').run(ctx.ids[0])
    if (change === 'cancelled') await ctx.app.request('/api/auth/telegram', send('DELETE', { attempt: ctx.attempt }, { Cookie: ctx.cookie }))
    await ctx.confirm()
    expect(await (await ctx.poll()).json()).toEqual({ status: 'expired' })
    const user = ctx.db.sqlite.prepare('SELECT telegram_id FROM users WHERE id = ?').get(ctx.ids[0])
    expect(user?.telegram_id ?? null).toBe(change === 'relinked' ? '300' : null)
    ctx.db.close()
  })

  it('cancels while confirmation is reading without linking the selected profile', async () => {
    const ctx = await startTarget()
    const confirming = ctx.logins.confirm(ctx.attempt, { id: '100', name: 'Anna' })
    const secret = decodeURIComponent(ctx.cookie.slice('login='.length)).split('.')[1]
    ctx.logins.cancel(ctx.attempt, secret)
    await confirming
    expect(await (await ctx.poll()).json()).toEqual({ status: 'expired' })
    expect(ctx.db.sqlite.prepare('SELECT telegram_id FROM users WHERE id = ?').get(ctx.ids[0])).toEqual({ telegram_id: null })
    ctx.db.close()
  })

  it('expires proof if the bot changes after taking approval while the actor is being read', async () => {
    const ctx = await startTarget('100')
    await ctx.confirm()
    const take = ctx.logins.take.bind(ctx.logins)
    let replaced: Promise<unknown> | undefined
    vi.spyOn(ctx.logins, 'take').mockImplementation((code, secret) => {
      const result = take(code, secret)
      expect(result.status).toBe('done')
      replaced = ctx.auth.setBotToken('456:new', { name: 'test', source: 'admin', rights: { manage: true, edit: true, vote: true }, userId: null }, async () => ({ username: 'newbot' }))
      return result
    })
    const done = await ctx.poll()
    await replaced
    expect(await done.json()).toEqual({ status: 'expired' })
    expect(cookieNamed(done, 'switch')).toBe('')
    ctx.db.close()
  })

  it('invalidates completed proof when the bot is replaced', async () => {
    const ctx = await startTarget('100')
    await ctx.confirm()
    const done = await ctx.poll()
    expect(await done.json()).toEqual({ status: 'done', member: 'Anna', manage: true })
    await ctx.auth.setBotToken('456:new', { name: 'test', source: 'admin', rights: { manage: true, edit: true, vote: true }, userId: null }, async () => ({ username: 'newbot' }))
    const rejected = await switchToTelegram(ctx.app, ctx.family, cookieNamed(done, 'switch'), { current: PASSWORD })
    expect(rejected.status).toBe(409)
    expect(await rejected.json()).toMatchObject({ error: { code: 'no_proof' } })
    ctx.db.close()
  })
})
