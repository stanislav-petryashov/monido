import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOOTSTRAP_WINDOW_MS, demoAuthRuntime, fallbackOf, hashPassword, loadAuthRuntime, planSharedPassword, resetPasswordRows, verifyHash,
} from '../../src/server/authSettings'
import { InputError, type Actor } from '../../src/server/http'
import { fakeAuthRuntime } from '../helpers/auth'
import { createTestDb, testConfig, type TestDb } from '../helpers/db'

const NONE = { edit: false, vote: false, manage: false }
const FAMILY: Actor = { name: 'family', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null }
const RESET: Actor = { name: 'reset-password', source: 'config', rights: NONE, userId: null }
const PASSWORD = 'correct horse battery'
const TOKEN = '123456:secret-token'

let clock: number
let lines: string[]
beforeEach(() => {
  clock = Date.parse('2031-10-19T10:00:00Z')
  lines = []
})

const load = (db: TestDb, env: Record<string, string> = {}) =>
  loadAuthRuntime(db, testConfig(env), { now: () => clock, log: line => lines.push(line) })

const setting = (db: TestDb, key: string) =>
  (db.sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value

const put = (db: TestDb, key: string, value: string) =>
  db.sqlite.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value)

interface JournalRow { actor: string; source: string; op: string; before: unknown; after: unknown }
const journal = (db: TestDb): JournalRow[] => (db.sqlite.prepare(
  "SELECT actor, source, op, before_json, after_json FROM change_log WHERE table_name = 'app_settings' ORDER BY id",
).all() as { actor: string; source: string; op: string; before_json: string | null; after_json: string | null }[])
  .map(r => ({ actor: r.actor, source: r.source, op: r.op, before: r.before_json && JSON.parse(r.before_json), after: r.after_json && JSON.parse(r.after_json) }))

/** The ordinary tables of the live database, SQLite's own left out. */
const tables = (db: TestDb) => db.sqlite.prepare('PRAGMA main.table_list').all()
  .filter(r => r.type === 'table' && !/^sqlite_/.test(String(r.name))).map(r => String(r.name)).sort()
const rows = (db: TestDb, table: string) => db.sqlite.prepare(`SELECT rowid AS _rowid, * FROM "${table}" ORDER BY rowid`).all()
/** Every table's rows, to compare before and after. */
const everything = (db: TestDb) => Object.fromEntries(tables(db).map(t => [t, rows(db, t)]))

const linkManager = (db: TestDb) => db.sqlite.prepare(
  "INSERT INTO users (member, telegram_id, can_manage, created_at, updated_at) VALUES ('Anna', '100', 1, 't', 't')",
).run()

/** A database whose family password is set in the app. */
async function withPassword(password = PASSWORD): Promise<TestDb> {
  const db = createTestDb()
  put(db, 'auth_password', await hashPassword(password))
  return db
}

/** A database in app-managed telegram mode: a stored password (unless none), a linked manager and a bot token. */
async function telegramDb({ password = true }: { password?: boolean } = {}): Promise<TestDb> {
  const db = password ? await withPassword() : createTestDb()
  put(db, 'auth_mode', 'telegram')
  put(db, 'auth_bot_token', TOKEN)
  linkManager(db)
  return db
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  try { await promise } catch (error) { return error }
  throw new Error('expected a refusal')
}

const keyOf = (mode: string, generation: number) => createHmac('sha256', 'test').update(`${mode}:${generation}`).digest('hex')

describe('hashing', () => {
  it('stores scrypt$65536$8$2$salt$hash and verifies only the same string', async () => {
    const stored = await hashPassword(' pass phrase 12 ')
    const parts = stored.split('$')
    expect(parts.slice(0, 4)).toEqual(['scrypt', '65536', '8', '2'])
    expect(Buffer.from(parts[4], 'base64')).toHaveLength(16)
    expect(Buffer.from(parts[5], 'base64')).toHaveLength(32)
    expect(await verifyHash(' pass phrase 12 ', stored)).toBe(true)
    expect(await verifyHash('pass phrase 12', stored)).toBe(false)
    expect(await verifyHash(' pass phrase 12', stored)).toBe(false)
    // the salt differs every time
    expect(await hashPassword(' pass phrase 12 ')).not.toBe(stored)
    const emoji = '\u{1F600}'.repeat(12)
    expect(await verifyHash(emoji, await hashPassword(emoji))).toBe(true)
  })

  it('a malformed stored string verifies nothing', async () => {
    for (const stored of ['', 'hash', 'scrypt$32768$8$1$AAAA', 'scrypt$3$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA', 'bcrypt$32768$8$1$AAAA$AAAA', `scrypt$${2 ** 30}$8$1$AAAA$AAAA`]) {
      expect(await verifyHash('anything at all', stored), stored).toBe(false)
    }
  })
})

describe('loadAuthRuntime', () => {
  it('a fresh database with nothing in env is bootstrap with the window open; logs the 15-minute line', async () => {
    const db = createTestDb()
    const auth = await load(db)
    expect(auth.mode()).toBe('bootstrap')
    expect(auth.bootstrapOpen()).toBe(true)
    expect(auth.locked()).toBe(false)
    expect(auth.passwordSource()).toBeNull()
    expect(auth.botTokenSource()).toBeNull()
    expect(auth.botToken()).toBeNull()
    expect(auth.generation()).toBe(1)
    expect(fallbackOf(auth)).toBeNull()
    expect(await auth.verifyPassword('')).toBe(false)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('15 minutes')
    expect(lines[0]).toMatch(/^\[auth\] /)
    expect(journal(db)).toEqual([])
  })

  it('preserves an existing stored password and mode across restarts without rewriting them', async () => {
    const db = await withPassword(' family-pass ')
    put(db, 'auth_mode', 'password')
    const before = everything(db)
    const auth = await load(db)
    expect(auth.mode()).toBe('password')
    expect(auth.locked()).toBe(false)
    expect(auth.passwordSource()).toBe('app')
    expect(await auth.verifyPassword(' family-pass ')).toBe(true)
    expect(await auth.verifyPassword('family-pass')).toBe(false)
    expect(await auth.verifyPassword(undefined)).toBe(false)
    const again = await load(db)
    expect(again.signingKey()).toBe(auth.signingKey())
    expect(everything(db)).toEqual(before)
  })


  it('mirrors only TELEGRAM_BOT_TOKEN without changing the stored mode or generation', async () => {
    const db = await telegramDb()
    db.sqlite.exec("DELETE FROM app_settings WHERE key = 'auth_bot_token'")
    const auth = await load(db, { TELEGRAM_BOT_TOKEN: TOKEN })
    expect(auth.mode()).toBe('telegram')
    expect(auth.locked()).toBe(false)
    expect(auth.botTokenSource()).toBe('env')
    expect(auth.botToken()).toBe(TOKEN)
    expect(auth.generation()).toBe(1)
    expect(journal(db)).toEqual([
      { actor: 'config', source: 'config', op: 'insert', before: null, after: { key: 'auth_bot_token', value: '***' } },
    ])
    const next = await load(db, { TELEGRAM_BOT_TOKEN: '654321:other' })
    expect(setting(db, 'auth_bot_token')).toBe('654321:other')
    expect(next.generation()).toBe(1)
  })

  it('an empty TELEGRAM_BOT_TOKEN= mirrors nothing and locks nothing', async () => {
    const db = createTestDb()
    const auth = await load(db, { TELEGRAM_BOT_TOKEN: '' })
    expect(auth.mode()).toBe('bootstrap')
    expect(auth.locked()).toBe(false)
    expect(auth.passwordSource()).toBeNull()
    expect(auth.botTokenSource()).toBeNull()
    expect(journal(db)).toEqual([])
    // the app may set both
    await auth.completeBootstrap(PASSWORD, FAMILY)
    await auth.setBotToken(TOKEN, FAMILY, async () => ({ username: 'family_bot' }))
    expect(auth.passwordSource()).toBe('app')
    expect(auth.botTokenSource()).toBe('app')
  })

  it('db mode telegram without a linked manager falls back to password (hash present) or bootstrap (none), one [auth] line, fallbackOf says which', async () => {
    const bare = createTestDb()
    put(bare, 'auth_mode', 'telegram')
    const none = await load(bare)
    expect(none.mode()).toBe('bootstrap')
    expect(none.bootstrapOpen()).toBe(true)
    expect(fallbackOf(none)).toBe('bootstrap')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('linked Telegram')
    expect(lines[0]).toContain('15 minutes')

    lines = []
    const hashed = await withPassword()
    put(hashed, 'auth_mode', 'telegram')
    const password = await load(hashed)
    expect(password.mode()).toBe('password')
    expect(fallbackOf(password)).toBe('password')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\[auth\] mode: password .*linked Telegram/)
    // the fallback writes nothing: the stored mode stays for when a manager links
    expect(setting(hashed, 'auth_mode')).toBe('telegram')
    // a write while fallen back keeps the fallback
    await password.setBotToken(TOKEN, FAMILY, async () => ({ username: 'family_bot' }))
    expect(password.mode()).toBe('password')

    lines = []
    const linked = await telegramDb()
    const telegram = await load(linked)
    expect(telegram.mode()).toBe('telegram')
    expect(fallbackOf(telegram)).toBeNull()
    expect(lines).toEqual(['[auth] mode: telegram'])
  })


  it('generation() reads a missing or non-integer auth_generation as 1', async () => {
    for (const stored of [null, 'x', '', '1.5', '-3', '0', 'NaN']) {
      const db = createTestDb()
      if (stored === null) db.sqlite.exec("DELETE FROM app_settings WHERE key = 'auth_generation'")
      else put(db, 'auth_generation', stored)
      const auth = await load(db)
      expect(auth.generation(), String(stored)).toBe(1)
      expect(auth.signingKey()).toBe(keyOf('bootstrap', 1))
      await auth.completeBootstrap(PASSWORD, FAMILY)
      expect(setting(db, 'auth_generation'), String(stored)).toBe('2')
      expect(auth.signingKey()).toBe(keyOf('password', 2))
    }
    const db = createTestDb()
    put(db, 'auth_generation', '7')
    expect((await load(db)).generation()).toBe(7)
  })

  it('signingKey() throws without a loaded session secret', async () => {
    const auth = await loadAuthRuntime(createTestDb(), { ...testConfig(), sessionSecret: null }, { now: () => clock, log: () => {} })
    expect(() => auth.signingKey()).toThrow('sessionSecret is not loaded')
  })
})

describe('writes', () => {
  it('setPassword bumps the generation, changes signingKey, journals ***; password_too_short/long', async () => {
    const db = await withPassword()
    const auth = await load(db)
    expect(auth.mode()).toBe('password')
    expect(auth.passwordSource()).toBe('app')
    const key = auth.signingKey()
    expect(key).toBe(keyOf('password', 1))
    await auth.setPassword('  a new family password ', FAMILY)
    expect(auth.generation()).toBe(2)
    expect(auth.signingKey()).not.toBe(key)
    expect(await auth.verifyPassword('  a new family password ')).toBe(true)
    expect(await auth.verifyPassword(PASSWORD)).toBe(false)
    expect(journal(db)).toEqual([
      { actor: 'family', source: 'admin', op: 'update', before: { key: 'auth_password', value: '***' }, after: { key: 'auth_password', value: '***' } },
      { actor: 'family', source: 'admin', op: 'update', before: { key: 'auth_generation', value: '1' }, after: { key: 'auth_generation', value: '2' } },
    ])
    expect(await refusal(auth.setPassword('a'.repeat(11), FAMILY))).toEqual(new InputError('password_too_short', 400))
    expect(await refusal(auth.setPassword('a'.repeat(129), FAMILY))).toEqual(new InputError('password_too_long', 400))
    expect(journal(db)).toHaveLength(2)
  })

  it('setMode bumps the generation and changes signingKey', async () => {
    const db = await withPassword()
    const auth = await load(db)
    const key = auth.signingKey()
    await auth.setMode('telegram', FAMILY)
    expect(auth.mode()).toBe('telegram')
    expect(auth.generation()).toBe(2)
    expect(auth.signingKey()).toBe(keyOf('telegram', 2))
    expect(auth.signingKey()).not.toBe(key)
    expect(setting(db, 'auth_mode')).toBe('telegram')
    expect(journal(db)[0]).toEqual({ actor: 'family', source: 'admin', op: 'insert', before: null, after: { key: 'auth_mode', value: 'telegram' } })
    await auth.setMode('password', FAMILY)
    expect(auth.mode()).toBe('password')
    expect(auth.generation()).toBe(3)
    expect(await refusal(auth.setMode('basic' as 'password', FAMILY))).toEqual(new InputError('invalid_value', 400, { column: 'mode' }))
  })

  it('setBotToken calls verify before storing; a verify that throws stores nothing; bot_token_locked under env', async () => {
    const db = await withPassword()
    const auth = await load(db)
    const verify = vi.fn(async () => {
      expect(setting(db, 'auth_bot_token')).toBeUndefined()
      return { username: 'family_bot' }
    })
    expect(await auth.setBotToken(TOKEN, FAMILY, verify)).toEqual({ username: 'family_bot' })
    expect(verify).toHaveBeenCalledWith(TOKEN)
    expect(setting(db, 'auth_bot_token')).toBe(TOKEN)
    expect(auth.botToken()).toBe(TOKEN)
    expect(auth.botTokenSource()).toBe('app')
    expect(auth.generation()).toBe(1)
    expect(journal(db)).toEqual([{ actor: 'family', source: 'admin', op: 'insert', before: null, after: { key: 'auth_bot_token', value: '***' } }])

    const failing = new Error('getMe refused')
    expect(await refusal(auth.setBotToken('999:other', FAMILY, async () => { throw failing }))).toBe(failing)
    expect(setting(db, 'auth_bot_token')).toBe(TOKEN)
    expect(auth.botToken()).toBe(TOKEN)

    const env = await load(createTestDb(), { TELEGRAM_BOT_TOKEN: TOKEN })
    const never = vi.fn(async () => ({ username: 'x' }))
    expect(await refusal(env.setBotToken('999:other', FAMILY, never))).toEqual(new InputError('bot_token_locked', 409))
    expect(never).not.toHaveBeenCalled()
  })

  it('clearBotToken deletes the row; bot_token_locked under env', async () => {
    const db = await withPassword()
    put(db, 'auth_bot_token', TOKEN)
    const auth = await load(db)
    expect(auth.botTokenSource()).toBe('app')
    await auth.clearBotToken(FAMILY)
    expect(setting(db, 'auth_bot_token')).toBeUndefined()
    expect(auth.botToken()).toBeNull()
    expect(auth.botTokenSource()).toBeNull()
    expect(journal(db)).toEqual([{ actor: 'family', source: 'admin', op: 'delete', before: { key: 'auth_bot_token', value: '***' }, after: null }])

    const env = await load(createTestDb(), { TELEGRAM_BOT_TOKEN: TOKEN })
    expect(await refusal(env.clearBotToken(FAMILY))).toEqual(new InputError('bot_token_locked', 409))
    expect(env.botToken()).toBe(TOKEN)
  })

  it('a listener that throws does not fail the committed write or silence the other listeners', async () => {
    const auth = await load(await withPassword())
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const after = vi.fn()
    auth.onChange(() => { throw new Error('listener broke') })
    auth.onChange(after)
    await expect(auth.setBotToken(TOKEN, FAMILY, async () => ({ username: 'family_bot' }))).resolves.toBeDefined()
    expect(auth.botToken()).toBe(TOKEN)
    expect(after).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('listener broke'))
    log.mockRestore()
  })

  it('onChange listeners hear setBotToken, clearBotToken, setMode, setPassword and reload; the returned function unsubscribes', async () => {
    const auth = await load(await withPassword())
    const listener = vi.fn()
    const off = auth.onChange(listener)
    await auth.setBotToken(TOKEN, FAMILY, async () => ({ username: 'family_bot' }))
    expect(listener).toHaveBeenCalledTimes(1)
    await auth.clearBotToken(FAMILY)
    expect(listener).toHaveBeenCalledTimes(2)
    await auth.setMode('telegram', FAMILY)
    expect(listener).toHaveBeenCalledTimes(3)
    await auth.setPassword('another family password', FAMILY)
    expect(listener).toHaveBeenCalledTimes(4)
    auth.reload()
    expect(listener).toHaveBeenCalledTimes(5)
    off()
    auth.reload()
    expect(listener).toHaveBeenCalledTimes(5)
  })
})

describe('bootstrap', () => {
  it('completeBootstrap stores the hash, sets auth_mode password, bumps the generation; mode() becomes password', async () => {
    const db = createTestDb()
    const auth = await load(db)
    await auth.completeBootstrap(' family pass 12 ', FAMILY)
    expect(auth.mode()).toBe('password')
    expect(auth.bootstrapOpen()).toBe(false)
    expect(auth.passwordSource()).toBe('app')
    expect(auth.generation()).toBe(2)
    expect(setting(db, 'auth_mode')).toBe('password')
    expect(await verifyHash(' family pass 12 ', setting(db, 'auth_password') ?? '')).toBe(true)
    expect(await auth.verifyPassword(' family pass 12 ')).toBe(true)
    expect(journal(db).map(r => [r.op, r.after])).toEqual([
      ['insert', { key: 'auth_password', value: '***' }],
      ['insert', { key: 'auth_mode', value: 'password' }],
      ['update', { key: 'auth_generation', value: '2' }],
    ])
  })

  it('a second call is not_in_bootstrap; two concurrent calls: one resolves, the other rejects not_in_bootstrap', async () => {
    const auth = await load(createTestDb())
    await auth.completeBootstrap(PASSWORD, FAMILY)
    expect(await refusal(auth.completeBootstrap('another family password', FAMILY))).toEqual(new InputError('not_in_bootstrap', 409))
    expect(await auth.verifyPassword(PASSWORD)).toBe(true)

    const db = createTestDb()
    const racing = await load(db)
    const results = await Promise.allSettled([racing.completeBootstrap('first family password', FAMILY), racing.completeBootstrap('second family password', FAMILY)])
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const rejected = results.find(r => r.status === 'rejected')
    expect(rejected?.reason).toEqual(new InputError('not_in_bootstrap', 409))
    const won = results[0].status === 'fulfilled' ? 'first family password' : 'second family password'
    const lost = won === 'first family password' ? 'second family password' : 'first family password'
    expect(await racing.verifyPassword(won)).toBe(true)
    expect(await racing.verifyPassword(lost)).toBe(false)
    expect(racing.generation()).toBe(2)
    expect(journal(db).filter(r => (r.after as { key: string } | null)?.key === 'auth_password')).toHaveLength(1)
  })

  it('bootstrap_closed once the clock passes 15 minutes; bootstrapOpen() follows the clock', async () => {
    const db = createTestDb()
    const auth = await load(db)
    expect(BOOTSTRAP_WINDOW_MS).toBe(15 * 60_000)
    clock += BOOTSTRAP_WINDOW_MS - 1
    expect(auth.bootstrapOpen()).toBe(true)
    clock += 1
    expect(auth.bootstrapOpen()).toBe(false)
    expect(auth.mode()).toBe('bootstrap')
    expect(await refusal(auth.completeBootstrap(PASSWORD, FAMILY))).toEqual(new InputError('bootstrap_closed', 409))
    expect(setting(db, 'auth_password')).toBeUndefined()
  })

  it('rejects a short password with password_too_short before anything is written', async () => {
    const db = createTestDb()
    const auth = await load(db)
    expect(await refusal(auth.completeBootstrap('a'.repeat(11), FAMILY))).toEqual(new InputError('password_too_short', 400))
    expect(await refusal(auth.completeBootstrap(42 as unknown as string, FAMILY))).toEqual(new InputError('password_too_short', 400))
    expect(setting(db, 'auth_password')).toBeUndefined()
    expect(journal(db)).toEqual([])
    expect(auth.mode()).toBe('bootstrap')
  })
})

describe('resetPasswordRows and reload', () => {
  it('clears the hash, bumps the generation, telegram → password; journals with source config; touches no other table', async () => {
    const db = await telegramDb()
    const config = testConfig()
    await loadAuthRuntime(db, config, { now: () => clock, log: () => {} })
    const before = everything(db)
    const entries = journal(db).length
    resetPasswordRows(db.sqlite, config, RESET)
    expect(setting(db, 'auth_password')).toBeUndefined()
    expect(setting(db, 'auth_mode')).toBe('password')
    expect(setting(db, 'auth_generation')).toBe('2')
    expect(setting(db, 'auth_bot_token')).toBe(TOKEN)
    expect(journal(db).slice(entries)).toEqual([
      { actor: 'reset-password', source: 'config', op: 'delete', before: { key: 'auth_password', value: '***' }, after: null },
      { actor: 'reset-password', source: 'config', op: 'update', before: { key: 'auth_mode', value: 'telegram' }, after: { key: 'auth_mode', value: 'password' } },
      { actor: 'reset-password', source: 'config', op: 'update', before: { key: 'auth_generation', value: '1' }, after: { key: 'auth_generation', value: '2' } },
    ])
    const after = everything(db)
    for (const table of tables(db)) {
      if (table === 'app_settings' || table === 'change_log') continue
      expect(after[table], table).toEqual(before[table])
    }
  })


  it('throws wrong_mode under AUTH_MODE=demo, writing nothing', async () => {
    const db = await telegramDb()
    const before = everything(db)
    expect(() => resetPasswordRows(db.sqlite, testConfig({ AUTH_MODE: 'demo' }), RESET)).toThrow(new InputError('wrong_mode', 409))
    expect(everything(db)).toEqual(before)
  })

  it('reload() after it lands in bootstrap with a fresh window at the current clock', async () => {
    const db = createTestDb()
    const config = testConfig()
    const auth = await loadAuthRuntime(db, config, { now: () => clock, log: line => lines.push(line) })
    await auth.completeBootstrap(PASSWORD, FAMILY)
    clock += 16 * 60_000
    resetPasswordRows(db.sqlite, config, RESET)
    // the running server knows nothing until the signal
    expect(auth.mode()).toBe('password')
    lines = []
    const key = auth.signingKey()
    auth.reload()
    expect(auth.mode()).toBe('bootstrap')
    expect(auth.bootstrapOpen()).toBe(true)
    expect(auth.passwordSource()).toBeNull()
    expect(auth.generation()).toBe(3)
    expect(auth.signingKey()).not.toBe(key)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('15 minutes')
    clock += BOOTSTRAP_WINDOW_MS
    expect(auth.bootstrapOpen()).toBe(false)
  })

  it('reload() while a password exists does not open a window', async () => {
    const db = createTestDb()
    const auth = await load(db)
    clock += BOOTSTRAP_WINDOW_MS
    expect(auth.bootstrapOpen()).toBe(false)
    put(db, 'auth_password', await hashPassword(PASSWORD))
    lines = []
    auth.reload()
    expect(auth.mode()).toBe('password')
    expect(auth.bootstrapOpen()).toBe(false)
    expect(lines).toEqual(['[auth] mode: password'])
    expect(await refusal(auth.completeBootstrap('another family password', FAMILY))).toEqual(new InputError('not_in_bootstrap', 409))
  })
})

describe('planSharedPassword', () => {
  const commit = (db: TestDb, run: () => void) => {
    db.sqlite.exec('BEGIN IMMEDIATE')
    run()
    db.sqlite.exec('COMMIT')
  }

  it('keeps a stored password: apply sets auth_mode password and bumps the generation only', async () => {
    const db = await telegramDb()
    const auth = await load(db)
    expect(auth.mode()).toBe('telegram')
    const hash = setting(db, 'auth_password')
    const entries = journal(db).length
    const plan = await planSharedPassword(auth, FAMILY, {})
    expect(journal(db)).toHaveLength(entries)
    commit(db, () => plan.apply(db.sqlite))
    plan.committed()
    expect(setting(db, 'auth_password')).toBe(hash)
    expect(setting(db, 'auth_mode')).toBe('password')
    expect(auth.mode()).toBe('password')
    expect(auth.generation()).toBe(2)
    expect(journal(db).slice(entries)).toEqual([
      { actor: 'family', source: 'admin', op: 'update', before: { key: 'auth_mode', value: 'telegram' }, after: { key: 'auth_mode', value: 'password' } },
      { actor: 'family', source: 'admin', op: 'update', before: { key: 'auth_generation', value: '1' }, after: { key: 'auth_generation', value: '2' } },
    ])
  })

  it('sets a given password (hashed before apply)', async () => {
    const db = await telegramDb({ password: false })
    const auth = await load(db)
    const plan = await planSharedPassword(auth, FAMILY, { password: ' shared family pass ' })
    expect(setting(db, 'auth_password')).toBeUndefined()
    commit(db, () => plan.apply(db.sqlite))
    plan.committed()
    expect(auth.mode()).toBe('password')
    expect(auth.passwordSource()).toBe('app')
    expect(await auth.verifyPassword(' shared family pass ')).toBe(true)
    expect(journal(db).map(r => r.after)).toContainEqual({ key: 'auth_password', value: '***' })
  })

  it('password_needed with no password anywhere and none given', async () => {
    const auth = await load(await telegramDb({ password: false }))
    expect(await refusal(planSharedPassword(auth, FAMILY, {}))).toEqual(new InputError('password_needed', 409))
  })


  it('password_too_short for a given short password; nothing written in phase 1', async () => {
    const db = await telegramDb()
    const auth = await load(db)
    const before = everything(db)
    expect(await refusal(planSharedPassword(auth, FAMILY, { password: 'short' }))).toEqual(new InputError('password_too_short', 400))
    await planSharedPassword(auth, FAMILY, { password: 'a long enough family password' })
    expect(everything(db)).toEqual(before)
  })

  it('apply inside BEGIN … ROLLBACK leaves rows and runtime unchanged; apply + COMMIT + committed() changes mode, generation and signingKey', async () => {
    const db = await telegramDb()
    const auth = await load(db)
    const before = everything(db)
    const key = auth.signingKey()
    const dropped = await planSharedPassword(auth, FAMILY, { password: 'a long enough family password' })
    db.sqlite.exec('BEGIN IMMEDIATE')
    dropped.apply(db.sqlite)
    db.sqlite.exec('ROLLBACK')
    expect(everything(db)).toEqual(before)
    expect(auth.mode()).toBe('telegram')
    expect(auth.generation()).toBe(1)
    expect(auth.signingKey()).toBe(key)
    expect(await auth.verifyPassword(PASSWORD)).toBe(true)

    const listener = vi.fn()
    auth.onChange(listener)
    const plan = await planSharedPassword(auth, FAMILY, {})
    commit(db, () => plan.apply(db.sqlite))
    expect(listener).not.toHaveBeenCalled()
    plan.committed()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(auth.mode()).toBe('password')
    expect(auth.generation()).toBe(2)
    expect(auth.signingKey()).toBe(keyOf('password', 2))
  })

  it('needs a loaded runtime', async () => {
    await expect(planSharedPassword(fakeAuthRuntime(), FAMILY, {})).rejects.toThrow('planSharedPassword needs a loaded runtime')
    expect(fallbackOf(fakeAuthRuntime())).toBeNull()
  })
})

describe('demoAuthRuntime', () => {
  it('is password mode, locked, with nothing set; every setter is not_in_demo', async () => {
    const auth = demoAuthRuntime(testConfig({ AUTH_MODE: 'demo' }))
    expect(auth.mode()).toBe('password')
    expect(auth.locked()).toBe(true)
    expect(auth.passwordSource()).toBeNull()
    expect(auth.botToken()).toBeNull()
    expect(auth.bootstrapOpen()).toBe(false)
    expect(auth.signingKey()).toBe('test')
    const notInDemo = new InputError('not_in_demo', 403)
    expect(await refusal(auth.setPassword(PASSWORD, FAMILY))).toEqual(notInDemo)
    expect(await refusal(auth.setBotToken(TOKEN, FAMILY, async () => ({ username: 'x' })))).toEqual(notInDemo)
    expect(await refusal(auth.clearBotToken(FAMILY))).toEqual(notInDemo)
    expect(await refusal(auth.setMode('telegram', FAMILY))).toEqual(notInDemo)
    expect(await refusal(auth.completeBootstrap(PASSWORD, FAMILY))).toEqual(notInDemo)
  })
})

it('fakeAuthRuntime switches mode and token at runtime and notifies', () => {
  const auth = fakeAuthRuntime({ mode: 'password' })
  expect(auth.mode()).toBe('password')
  expect(auth.botToken()).toBeNull()
  const listener = vi.fn()
  const off = auth.onChange(listener)
  auth.set({ mode: 'telegram', botToken: TOKEN })
  expect(auth.mode()).toBe('telegram')
  expect(auth.botToken()).toBe(TOKEN)
  expect(listener).toHaveBeenCalledTimes(1)
  off()
  auth.set({ botToken: null })
  expect(auth.botToken()).toBeNull()
  expect(listener).toHaveBeenCalledTimes(1)
})


describe('environment-only open access', () => {
  it('skips password setup on a fresh database until the environment override is removed', async () => {
    const db = createTestDb()
    const auth = await load(db, { AUTH_MODE: 'none' })
    expect(auth.mode()).toBe('none')
    expect(auth.bootstrapOpen()).toBe(false)
    expect(setting(db, 'auth_password')).toBeUndefined()
    const restored = await load(db)
    expect(restored.mode()).toBe('bootstrap')
    expect(restored.bootstrapOpen()).toBe(true)
  })

  it('temporarily overrides the stored mode without changing settings, and restores password after removal', async () => {
    const db = await withPassword()
    put(db, 'auth_mode', 'password')
    const before = everything(db)
    const auth = await load(db, { AUTH_MODE: 'none' })
    expect(auth.mode()).toBe('none')
    expect(auth.locked()).toBe(true)
    expect(auth.bootstrapOpen()).toBe(false)
    await expect(auth.setMode('password', FAMILY)).rejects.toEqual(new InputError('auth_mode_locked', 409))
    await expect(planSharedPassword(auth, FAMILY, {})).rejects.toEqual(new InputError('auth_mode_locked', 409))
    expect(() => resetPasswordRows(db.sqlite, testConfig({ AUTH_MODE: 'none' }), RESET)).toThrow(new InputError('wrong_mode', 409))
    expect(everything(db)).toEqual(before)
    const restored = await load(db)
    expect(restored.mode()).toBe('password')
    expect(await restored.verifyPassword(PASSWORD)).toBe(true)
  })

  it('cannot set open access through the runtime or retain a legacy stored none mode', async () => {
    const db = await withPassword()
    put(db, 'auth_mode', 'none')
    const auth = await load(db)
    expect(auth.mode()).toBe('password')
    await expect(auth.setMode('none' as 'password', FAMILY)).rejects.toEqual(new InputError('invalid_value', 400, { column: 'mode' }))
  })
})
