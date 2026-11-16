import { cookieNamed, signInTelegram } from '../helpers/auth'
import { describe, expect, it, vi } from 'vitest'
import { buildFamily, DEMO_FAMILIES } from '../../src/demo/family'
import { createApp } from '../../src/server/app'
import { createLoginLimiter } from '../../src/server/auth'
import { demoAuthRuntime, hashPassword, loadAuthRuntime, planSharedPassword } from '../../src/server/authSettings'
import { loadDemoData } from '../../src/server/demoData'
import type { Actor } from '../../src/server/http'
import { writeFamily } from '../../src/server/demo/writeFamily'
import { createLoginAttempts } from '../../src/server/loginAttempts'
import { getSnapshot } from '../../src/server/snapshot'
import { createTestDb, testConfig, type TestDb } from '../helpers/db'
import { heldBody } from '../helpers/heldBody'

const PASSWORD = 'a long family password'
const NEW_PASSWORD = 'another long password'
const TOKEN = '123456:AAbb_cc-DD'
const FAMILY_ACTOR: Actor = { name: 'family', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null }

/** The ordinary tables of the live database, SQLite's own left out. */
const tables = (db: TestDb) => db.sqlite.prepare('PRAGMA main.table_list').all()
  .filter(r => r.type === 'table' && !/^sqlite_/.test(String(r.name))).map(r => String(r.name)).sort()

const rows = (db: TestDb, table: string) => db.sqlite.prepare(`SELECT rowid AS _rowid, * FROM "${table}" ORDER BY rowid`).all()

/** Every table's rows, to compare before and after. */
const everything = (db: TestDb) => Object.fromEntries(tables(db).map(t => [t, rows(db, t)]))

const setting = (db: TestDb, key: string) =>
  (db.sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value

const count = (db: TestDb, sql: string) => Number((db.sqlite.prepare(sql).get() as { n: number }).n)

/**
 * The family server over a real runtime: the English family written with a stale asset of its own and a linked
 * Telegram chat, then the auth_* rows as given; `telegram` replaces the family's users with a linked manager Anna and
 * a linked editor Ryan.
 */
async function setup({ env = {}, password, mode, token, telegram = false, demo = false }: {
  env?: Record<string, string>; password?: string; mode?: 'password' | 'telegram'; token?: string; telegram?: boolean; demo?: boolean
} = {}) {
  const db = createTestDb()
  writeFamily(db.sqlite, buildFamily({ today: '2031-10-19' }))
  db.sqlite.exec(`
    INSERT INTO month_draft_revisions VALUES ('2020-01', 9);
    INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2020-01-31', 'cash', 'Stale account', 1, 'USD', 'Ryan');
    UPDATE reminder_settings SET chat_id = '42';
  `)
  const put = db.sqlite.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
  if (password) put.run('auth_password', await hashPassword(password))
  if (mode) put.run('auth_mode', mode)
  if (token) put.run('auth_bot_token', token)
  const ids: number[] = []
  if (telegram) {
    db.sqlite.exec('DELETE FROM users')
    const add = db.sqlite.prepare("INSERT INTO users (member, telegram_id, can_manage, created_at, updated_at) VALUES (?, ?, ?, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')")
    ids.push(Number(add.run(DEMO_FAMILIES['en-US'].members[0], '100', 1).lastInsertRowid), Number(add.run(DEMO_FAMILIES['en-US'].members[1], '200', 0).lastInsertRowid))
  }
  const config = testConfig(env, 'test-secret')
  const auth = demo ? demoAuthRuntime(config) : await loadAuthRuntime(db, config, { log: () => {} })
  const logins = createLoginAttempts()
  const bot = { username: () => 'fcbot', status: () => ({ configured: true, username: 'fcbot', problem: null }) }
  const app = createApp({ db, config, auth, ratesOnline: false, limiter: createLoginLimiter(), logins, bot })
  return { db, app, auth, logins, ids }
}

type App = Awaited<ReturnType<typeof setup>>['app']

const send = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
  method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

async function signInPassword(app: App, password = PASSWORD): Promise<string> {
  const res = await app.request('/api/auth/login', send('POST', { password }))
  expect(res.status).toBe(200)
  return cookieNamed(res, 'session')
}


const load = (app: App, cookie: string, body: unknown = { confirm: true }) => app.request('/api/demo-data', send('POST', body, { Cookie: cookie }))
const snapshotWith = (app: App, cookie: string) => app.request('/api/snapshot', { headers: { Cookie: cookie } })

describe('POST /api/demo-data', () => {
  it('403 not_in_demo in the demo', async () => {
    const { db, app } = await setup({ env: { AUTH_MODE: 'demo' }, demo: true })
    const before = everything(db)
    const res = await app.request('/api/demo-data', send('POST', { confirm: true }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: { code: 'not_in_demo' } })
    expect(everything(db)).toEqual(before)
  })

  it('403 no_right_manage without manage', async () => {
    const { db, app, logins, ids } = await setup({ mode: 'telegram', token: TOKEN, telegram: true })
    const editor = await signInTelegram(app, logins, ids[1])
    const before = everything(db)
    const res = await load(app, editor, { confirm: true, password: NEW_PASSWORD })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: { code: 'no_right_manage' } })
    expect(everything(db)).toEqual(before)
  })

  it('400 confirm_required without confirm: true; 405 for another method', async () => {
    const { db, app } = await setup({ password: PASSWORD })
    const cookie = await signInPassword(app)
    const before = everything(db)
    for (const body of [{}, { confirm: 'true' }, { confirm: 1 }, null, []]) {
      const res = await load(app, cookie, body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: { code: 'confirm_required' } })
    }
    expect((await app.request('/api/demo-data', { headers: { Cookie: cookie } })).status).toBe(405)
    expect(everything(db)).toEqual(before)
  })

  it('400 invalid_language for "xx-XX"; nothing changed', async () => {
    const { db, app, auth } = await setup({ password: PASSWORD })
    const cookie = await signInPassword(app)
    const before = everything(db)
    const generation = auth.generation()
    const res = await load(app, cookie, { confirm: true, language: 'xx-XX' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 'invalid_language' } })
    expect(everything(db)).toEqual(before)
    expect(auth.generation()).toBe(generation)
  })

  it('marks the setup done', async () => {
    const { db, app } = await setup({ password: PASSWORD })
    db.sqlite.exec("DELETE FROM app_settings WHERE key = 'setup_state'")
    const cookie = await signInPassword(app)
    const res = await load(app, cookie)
    expect(res.status).toBe(200)
    const after = cookieNamed(res, 'session') || cookie
    const view = await app.request('/api/setup', { headers: { Cookie: after } })
    expect(await view.json()).toMatchObject({ state: 'done', hasData: true })
    const auth = await app.request('/api/auth', { headers: { Cookie: after } })
    expect(await auth.json()).toMatchObject({ authenticated: true, setup: 'done' })
  })

  it('password mode: replaces every table but LOAD_KEEP and signs the presser in again', async () => {
    const { db, app, auth } = await setup({ password: PASSWORD })
    const storedHash = setting(db, 'auth_password')
    const generation = auth.generation()
    const cookie = await signInPassword(app)
    const res = await load(app, cookie)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ loaded: true, language: 'en-US', currency: 'USD' })

    expect(db.sqlite.prepare('SELECT name FROM members ORDER BY rowid').all().map(r => r.name)).toEqual([...DEMO_FAMILIES['en-US'].members])
    expect(db.sqlite.prepare('SELECT member FROM users WHERE can_manage = 1').all().map(r => r.member)).toEqual([DEMO_FAMILIES['en-US'].members[0]])
    expect(count(db, "SELECT COUNT(*) AS n FROM assets WHERE name = 'Stale account'")).toBe(0)
    expect([setting(db, 'language'), setting(db, 'currency'), setting(db, 'setup_state')]).toEqual(['en-US', 'USD', 'done'])
    expect(setting(db, 'auth_mode')).toBe('password')
    expect(setting(db, 'auth_password')).toBe(storedHash)
    expect(auth.generation()).toBe(generation + 1)
    expect(setting(db, 'auth_generation')).toBe(String(generation + 1))
    expect(db.sqlite.prepare('SELECT chat_id FROM reminder_settings').get()).toEqual({ chat_id: '42' })

    const journal = db.sqlite.prepare('SELECT table_name, row_id, op, before_json, after_json FROM change_log').all()
    expect(journal.filter(e => e.op === 'demo_data')).toEqual([{ table_name: '*', row_id: 0, op: 'demo_data', before_json: null, after_json: '{"family":"en-US"}' }])
    // the rest are the plan's auth_* entries
    expect(journal.filter(e => e.op !== 'demo_data').every(e => e.table_name === 'app_settings' && String(e.after_json ?? e.before_json).includes('"auth_'))).toBe(true)

    expect((await snapshotWith(app, cookie)).status).toBe(401)
    const fresh = cookieNamed(res, 'session')
    expect(fresh).not.toBe('')
    const snapshot = await snapshotWith(app, fresh)
    expect(snapshot.status).toBe(200)
    // the same snapshot the server builds, but for the moment it was built at
    const built = JSON.parse(JSON.stringify(await getSnapshot(db, { download: false }))) as { generatedAt: string }
    expect(await snapshot.json()).toEqual({ ...built, generatedAt: expect.any(String) })
  })

  it('language ru-RU loads the Russian family and the snapshot is in rubles', async () => {
    const { db, app } = await setup({ password: PASSWORD })
    const res = await load(app, await signInPassword(app), { confirm: true, language: 'ru-RU' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ loaded: true, language: 'ru-RU', currency: 'RUB' })
    expect(db.sqlite.prepare('SELECT name FROM members ORDER BY rowid').all().map(r => r.name)).toEqual([...DEMO_FAMILIES['ru-RU'].members])
    expect([setting(db, 'language'), setting(db, 'currency')]).toEqual(['ru-RU', 'RUB'])
    const snapshot = await (await snapshotWith(app, cookieNamed(res, 'session'))).json() as { baseCurrency: string; warnings: { code: string }[] }
    expect(snapshot.baseCurrency).toBe('RUB')
    expect(snapshot.warnings.filter(w => w.code.startsWith('fx_'))).toEqual([])
  })

  it('without a language in the body the family language decides', async () => {
    const { db, app } = await setup({ password: PASSWORD })
    db.sqlite.exec("UPDATE app_settings SET value = 'ru-RU' WHERE key = 'language'")
    const res = await load(app, await signInPassword(app))
    expect(await res.json()).toEqual({ loaded: true, language: 'ru-RU', currency: 'RUB' })
  })

  it('a second load replaces the first: no duplicate rows, one demo_data entry', async () => {
    const { db, app } = await setup({ password: PASSWORD })
    const first = await load(app, await signInPassword(app), { confirm: true, language: 'en-US' })
    expect(first.status).toBe(200)
    const second = await load(app, cookieNamed(first, 'session'), { confirm: true, language: 'ru-RU' })
    expect(second.status).toBe(200)
    expect(count(db, 'SELECT COUNT(*) AS n FROM members')).toBe(2)
    expect(count(db, 'SELECT COUNT(*) AS n FROM (SELECT 1 FROM fx_rates GROUP BY date, currency HAVING COUNT(*) > 1)')).toBe(0)
    expect(count(db, "SELECT COUNT(*) AS n FROM change_log WHERE op = 'demo_data'")).toBe(1)
    expect(db.sqlite.prepare("SELECT after_json FROM change_log WHERE op = 'demo_data'").get()).toEqual({ after_json: '{"family":"ru-RU"}' })
  })

  it('tracking off, then a wipe, then the test data: income and expenses are tracked again', async () => {
    const { db, app } = await setup({ password: PASSWORD })
    const cookie = await signInPassword(app)
    expect((await app.request('/api/settings', send('PUT', { trackFlows: false }, { Cookie: cookie }))).status).toBe(200)
    expect((await app.request('/api/wipe', send('POST', { confirm: true }, { Cookie: cookie }))).status).toBe(200)
    expect((await getSnapshot(db, { download: false })).trackFlows).toBe(false)
    const res = await load(app, cookie)
    expect(res.status).toBe(200)
    expect(db.sqlite.prepare("SELECT value FROM app_settings WHERE key = 'track_flows'").get()).toEqual({ value: '1' })
    expect((await getSnapshot(db, { download: false })).trackFlows).toBe(true)
  })

  it('reverting the demo_data entry is 409 not_revertible', async () => {
    const { db, app } = await setup({ password: PASSWORD })
    const res = await load(app, await signInPassword(app))
    const { id } = db.sqlite.prepare("SELECT id FROM change_log WHERE op = 'demo_data'").get() as { id: number }
    const revert = await app.request(`/api/admin/change_log/${id}/revert`, send('POST', undefined, { Cookie: cookieNamed(res, 'session') }))
    expect(revert.status).toBe(409)
    expect(await revert.json()).toEqual({ error: { code: 'not_revertible' } })
  })

  it('telegram mode: afterwards the mode is password, the presser holds a password-mode session, the former user is 401', async () => {
    const { db, app, auth, logins, ids } = await setup({ mode: 'telegram', token: TOKEN, telegram: true })
    const manager = await signInTelegram(app, logins, ids[0])
    const editor = await signInTelegram(app, logins, ids[1])
    expect(auth.mode()).toBe('telegram')
    const res = await load(app, manager, { confirm: true, password: NEW_PASSWORD })
    expect(res.status).toBe(200)
    expect(auth.mode()).toBe('password')
    expect(setting(db, 'auth_mode')).toBe('password')
    expect((await snapshotWith(app, cookieNamed(res, 'session'))).status).toBe(200)
    expect((await snapshotWith(app, manager)).status).toBe(401)
    expect((await snapshotWith(app, editor)).status).toBe(401)
    expect(count(db, 'SELECT COUNT(*) AS n FROM users WHERE telegram_id IS NOT NULL')).toBe(0)
    expect(count(db, 'SELECT COUNT(*) AS n FROM users')).toBe(2)
  })

  it('409 password_needed when no password exists anywhere and none is given; nothing changed', async () => {
    const { db, app, auth, logins, ids } = await setup({ mode: 'telegram', token: TOKEN, telegram: true })
    const manager = await signInTelegram(app, logins, ids[0])
    const before = everything(db)
    const generation = auth.generation()
    const res = await load(app, manager)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'password_needed' } })
    expect(everything(db)).toEqual(before)
    expect(auth.generation()).toBe(generation)
    expect(auth.mode()).toBe('telegram')
    expect((await snapshotWith(app, manager)).status).toBe(200)
  })

  it('a password in the body is stored and signs in afterwards', async () => {
    const { app, logins, ids } = await setup({ mode: 'telegram', token: TOKEN, telegram: true })
    const manager = await signInTelegram(app, logins, ids[0])
    expect((await load(app, manager, { confirm: true, password: NEW_PASSWORD })).status).toBe(200)
    const login = await app.request('/api/auth/login', send('POST', { password: NEW_PASSWORD }))
    expect(login.status).toBe(200)
  })

  it('a body password never replaces a stored one: ignored, the old password still signs in, the given one does not', async () => {
    for (const rows of [{}, { mode: 'telegram' as const, token: TOKEN, telegram: true }]) {
      const { db, app, logins, ids } = await setup({ ...rows, password: PASSWORD })
      const cookie = rows.telegram ? await signInTelegram(app, logins, ids[0]) : await signInPassword(app)
      const hash = setting(db, 'auth_password')
      const res = await load(app, cookie, { confirm: true, password: NEW_PASSWORD })
      expect(res.status).toBe(200)
      expect(setting(db, 'auth_password')).toBe(hash)
      expect((await app.request('/api/auth/login', send('POST', { password: PASSWORD }))).status).toBe(200)
      expect((await app.request('/api/auth/login', send('POST', { password: NEW_PASSWORD }))).status).toBe(401)
    }
  })

  it('400 password_too_short before anything is deleted', async () => {
    const { db, app, logins, ids } = await setup({ mode: 'telegram', token: TOKEN, telegram: true })
    const manager = await signInTelegram(app, logins, ids[0])
    const before = everything(db)
    const res = await load(app, manager, { confirm: true, password: 'short' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 'password_too_short' } })
    expect(everything(db)).toEqual(before)
  })

  it('400 invalid_value for a password that is not a string; nothing changed', async () => {
    const { db, app } = await setup({ password: PASSWORD })
    const cookie = await signInPassword(app)
    const before = everything(db)
    for (const password of [123, true, {}, ['x']]) {
      const res = await load(app, cookie, { confirm: true, password })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: { code: 'invalid_value', params: { column: 'password' } } })
    }
    expect(everything(db)).toEqual(before)
  })

  it('a session revoked while the body was held open cannot load: 401, only the concurrent change happened', async () => {
    const { db, app, auth } = await setup({ password: PASSWORD })
    const cookie = await signInPassword(app)
    const held = heldBody({ confirm: true, password: NEW_PASSWORD })
    const pending = app.request(new Request('http://localhost/api/demo-data', {
      method: 'POST', body: held.body, headers: { 'Content-Type': 'application/json', Cookie: cookie }, duplex: 'half',
    } as RequestInit))
    // the owner changes the password while the request waits for its body
    await held.reading
    await auth.setPassword('the owner new password', FAMILY_ACTOR)
    const after = everything(db)
    const generation = auth.generation()
    held.release()
    const res = await pending
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: 'unauthorized' } })
    expect(res.headers.getSetCookie()).toEqual([])
    expect(everything(db)).toEqual(after)
    expect(auth.generation()).toBe(generation)
    expect(auth.mode()).toBe('password')
    expect(await auth.verifyPassword('the owner new password')).toBe(true)
  })

  it('the stored password deleted between the plan and the load: password_needed, rolled back', async () => {
    const { db, auth } = await setup({ mode: 'telegram', token: TOKEN, telegram: true, password: PASSWORD })
    const plan = await planSharedPassword(auth, FAMILY_ACTOR, {})
    // the reset-password command, from another process
    db.sqlite.exec("DELETE FROM app_settings WHERE key = 'auth_password'")
    const before = everything(db)
    expect(() => loadDemoData(db, { language: 'en-US', actor: FAMILY_ACTOR, now: new Date(), plan }))
      .toThrow(expect.objectContaining({ code: 'password_needed', status: 409 }))
    expect(everything(db)).toEqual(before)
  })

  it('a failing insert leaves every table, the mode and the generation as they were', async () => {
    const { db, app, auth } = await setup({ password: PASSWORD })
    const cookie = await signInPassword(app)
    db.sqlite.exec("CREATE TRIGGER boom BEFORE INSERT ON goals BEGIN SELECT RAISE(ABORT, 'boom'); END")
    const before = everything(db)
    const generation = auth.generation()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await load(app, cookie)
    expect(res.status).toBe(500)
    expect(errors).toHaveBeenCalled()
    expect(everything(db)).toEqual(before)
    expect(auth.mode()).toBe('password')
    expect(auth.generation()).toBe(generation)
    expect((await snapshotWith(app, cookie)).status).toBe(200)
  })
})


it('loads test data in none mode without a password or cookie and preserves stored auth', async () => {
  const { app, db, auth } = await setup({ env: { AUTH_MODE: 'none' }, password: PASSWORD })
  const before = db.sqlite.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'auth_%' ORDER BY key").all()
  const response = await load(app, '')
  expect(response.status).toBe(200)
  expect(response.headers.get('Set-Cookie')).toBeNull()
  expect(auth.mode()).toBe('none')
  expect(db.sqlite.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'auth_%' ORDER BY key").all()).toEqual(before)
})
