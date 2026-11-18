import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createApp } from '../../src/server/app'
import { openDatabase, type SqliteDatabase } from '../../src/server/db'
import { InputError, type Actor } from '../../src/server/http'
import { initializeSchema, SCHEMA_VERSION, validateSchema } from '../../src/server/schema'
import { RESTORE_MAX_BYTES, restoreBackup } from '../../src/server/restore'
import { deleteRow, insertRow, revertChange } from '../../src/server/rows'
import { BACK_TO_V1, SCHEMA_FILE, testConfig } from '../helpers/db'
import { authFor } from '../helpers/auth'
import { FAMILY_PASSWORD, familyCookie, userCookie, withCookie } from '../helpers/session'
import { withTempDirs } from '../helpers/tmp'

const NOW = new Date('2031-10-19T10:00:00Z')
const KEPT = 'before-restore-20311019-100000.sqlite'
const ACTOR: Actor = { name: 'owner@example.com', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null }

const freshDir = withTempDirs('restore-test-')

/**
 * Points os.tmpdir() at a fresh folder of this test's own (it reads TMPDIR on every call) until the test ends; returns
 * the temporary folders restoreBackup left there, apart from any other file's: none may be left behind.
 */
function ownTmp(): () => string[] {
  const dir = freshDir()
  const saved = process.env.TMPDIR
  process.env.TMPDIR = dir
  onTestFinished(() => {
    if (saved === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = saved
  })
  return () => readdirSync(dir).filter(n => n.startsWith('finance-restore-'))
}

/** A live database the way the server opens it: a file in DATA_DIR, migrated. */
function liveDb(): { db: SqliteDatabase; dataDir: string } {
  const dataDir = freshDir()
  const db = openDatabase(join(dataDir, 'finance.sqlite'))
  initializeSchema(db, SCHEMA_FILE)
  db.sqlite.exec("INSERT INTO parameters (key, value, description) VALUES ('inflation_rate', 1, 'live')")
  db.sqlite.exec("INSERT INTO assets (date, class, name, value, currency) VALUES ('2031-01-31', 'cash', 'Live bank', 100, 'USD')")
  return { db, dataDir }
}

/** A backup file's bytes: a database made by `build`, copied as "Download database copy" does. */
function backupBytes(build: (db: SqliteDatabase) => void): Uint8Array {
  const dir = freshDir()
  const db = openDatabase(join(dir, 'source.sqlite'))
  build(db)
  const out = join(dir, 'copy.sqlite')
  db.sqlite.prepare('VACUUM INTO ?').run(out)
  db.close()
  return readFileSync(out)
}

/** A backup at the app's migration level with a known parameter and account. */
const currentBackup = (extra: (db: SqliteDatabase) => void = () => {}) => backupBytes(db => {
  initializeSchema(db, SCHEMA_FILE)
  db.sqlite.exec("INSERT INTO parameters (key, value, description) VALUES ('inflation_rate', 9.5, 'backup')")
  db.sqlite.exec("INSERT INTO assets (date, class, name, value, currency) VALUES ('2030-12-31', 'deposit', 'Backup bank', 777, 'EUR')")
  extra(db)
})

/** Databases attached besides main and temp: the upload must not stay attached. */
const attached = (db: SqliteDatabase) => db.sqlite.prepare('PRAGMA database_list').all().map(r => (r as { name: string }).name).filter(n => n !== 'main' && n !== 'temp')

/** What a failed restore must leave exactly as it was. */
function liveState(db: SqliteDatabase) {
  return {
    parameters: db.sqlite.prepare('SELECT * FROM parameters ORDER BY rowid').all(),
    assets: db.sqlite.prepare('SELECT * FROM assets ORDER BY rowid').all(),
    journal: db.sqlite.prepare('SELECT * FROM change_log ORDER BY id').all(),
    schemaVersion: db.sqlite.prepare('PRAGMA user_version').get(),
  }
}

async function expectRefused(promise: Promise<unknown>, code: string, status: number) {
  const err = await promise.then(() => null, (e: unknown) => e)
  expect(err).toBeInstanceOf(InputError)
  expect(err).toMatchObject({ code, status })
}

const opts = (dataDir: string) => ({ schemaFile: SCHEMA_FILE, dataDir, actor: ACTOR, now: NOW })

describe('restoreBackup', () => {
  it('restores a backup and keeps the old database', async () => {
    const leftovers = ownTmp()
    const { db, dataDir } = liveDb()
    const result = await restoreBackup(db, currentBackup(), opts(dataDir))

    expect(result).toEqual({ kept: KEPT })
    expect(db.sqlite.prepare("SELECT value FROM parameters WHERE key = 'inflation_rate'").all()).toEqual([{ value: 9.5 }])
    expect(db.sqlite.prepare('SELECT name, value FROM assets').all()).toEqual([{ name: 'Backup bank', value: 777 }])
    // the journal is the backup's plus one restore entry
    const journal = db.sqlite.prepare('SELECT actor, source, table_name, row_id, op, after_json FROM change_log').all()
    expect(journal).toEqual([{ actor: ACTOR.name, source: 'admin', table_name: '*', row_id: 0, op: 'restore', after_json: JSON.stringify({ kept: KEPT }) }])

    // the kept copy is the database as it was before
    const kept = new DatabaseSync(join(dataDir, KEPT), { readOnly: true })
    expect(kept.prepare("SELECT value FROM parameters WHERE key = 'inflation_rate'").all()).toEqual([{ value: 1 }])
    expect(kept.prepare('SELECT name FROM assets').all()).toEqual([{ name: 'Live bank' }])
    kept.close()
    expect(leftovers()).toEqual([])
    // nothing stays attached
    expect(attached(db)).toEqual([])
  })

  it('the current users are kept, not the file\'s', async () => {
    const { db, dataDir } = liveDb()
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Ann'); INSERT INTO users (member, email, created_at, updated_at) VALUES ('Ann', 'ann@example.com', 'live', 'live')")
    const users = db.sqlite.prepare('SELECT * FROM users ORDER BY id').all()
    const bytes = currentBackup(b => b.sqlite.exec("INSERT INTO members (name) VALUES ('Bob'); INSERT INTO users (member, email, created_at, updated_at) VALUES ('Bob', 'bob@example.com', 'file', 'file')"))
    await restoreBackup(db, bytes, opts(dataDir))
    expect(db.sqlite.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(users)
    // Ann is not among the file's members: she is back
    expect(db.sqlite.prepare('SELECT name FROM members ORDER BY name').all()).toEqual([{ name: 'Ann' }, { name: 'Bob' }])
  })

  it('keeps the live auth_* rows: a backup with other auth values changes none of them', async () => {
    const { db, dataDir } = liveDb()
    const put = (b: SqliteDatabase, mode: string, password: string, token: string, gen: string) => b.sqlite.exec(`
      INSERT OR REPLACE INTO app_settings (key, value) VALUES ('auth_mode', '${mode}'), ('auth_password', '${password}'), ('auth_bot_token', '${token}'), ('auth_generation', '${gen}')`)
    put(db, 'telegram', 'A', 'T', '5')
    const auth = () => db.sqlite.prepare("SELECT key, value FROM app_settings WHERE key LIKE 'auth\\_%' ESCAPE '\\' ORDER BY key").all()
    const live = auth()
    expect(live).toHaveLength(4)
    const bytes = currentBackup(b => {
      put(b, 'password', 'B', 'U', '1')
      b.sqlite.exec("UPDATE app_settings SET value = 'ru-RU' WHERE key = 'language'")
    })
    await restoreBackup(db, bytes, opts(dataDir))
    expect(auth()).toEqual(live)
    expect(db.sqlite.prepare("SELECT value FROM app_settings WHERE key = 'language'").get()).toEqual({ value: 'ru-RU' })
  })

  it('the live OAuth clients and tokens (a person\'s and the family\'s) are kept: a backup file brings back no connection', async () => {
    const { db, dataDir } = liveDb()
    const oauth = (b: SqliteDatabase, id: string) => b.sqlite.exec(`
      INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES ('${id}', NULL, '[]', 't');
      INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, chain_id, expires_at, created_at) VALUES ('${id}-hash', 'refresh', '${id}', 1, 'ch', '2099-01-01T00:00:00.000Z', 't');
      -- a family token (password mode): user 0, the generation it was approved at
      INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, telegram_id, chain_id, expires_at, created_at) VALUES ('${id}-family', 'refresh', '${id}', 0, 'family:3', 'fch', '2099-01-01T00:00:00.000Z', 't')`)
    oauth(db, 'live')
    const clients = db.sqlite.prepare('SELECT * FROM oauth_clients').all()
    const tokens = db.sqlite.prepare('SELECT * FROM oauth_tokens').all()
    await restoreBackup(db, currentBackup(b => oauth(b, 'file')), opts(dataDir))
    expect(db.sqlite.prepare('SELECT * FROM oauth_clients').all()).toEqual(clients)
    expect(db.sqlite.prepare('SELECT * FROM oauth_tokens').all()).toEqual(tokens)
  })

  it('the live Telegram reminder link is kept: a backup file does not re-link an unlinked chat', async () => {
    const { db, dataDir } = liveDb()
    const live = db.sqlite.prepare('SELECT * FROM reminder_settings').all()
    await restoreBackup(db, currentBackup(b => b.sqlite.exec("UPDATE reminder_settings SET enabled = 1, chat_id = '42' WHERE id = 1")), opts(dataDir))
    expect(db.sqlite.prepare('SELECT * FROM reminder_settings').all()).toEqual(live)
  })

  it.each([0, 999999])('resets the retained group cursor %s to restored history without replaying old notifications', async cursor => {
    const { db, dataDir } = liveDb()
    db.sqlite.prepare("INSERT INTO family_telegram_groups (chat_id, title, proposals, proposal_cursor) VALUES ('-100', 'Live group', 1, ?)").run(cursor)
    const bytes = currentBackup(b => b.sqlite.exec(`
      INSERT INTO family_telegram_groups (chat_id, title, proposals) VALUES ('-200', 'Disconnected group', 1);
      INSERT INTO proposals (type, author_id, status, created_at, deadline_at) VALUES ('goal', 1, 'open', 't', 't');
      INSERT INTO proposal_versions (proposal_id, number, title, question, scenario_json, evaluation_json, base_currency, verdict_json, voters_json, created_at)
        VALUES (1, 1, 'Historic proposal', 'Q', '{}', '{}', 'USD', '{}', '[]', 't');
      INSERT INTO change_log (id, ts, actor, source, table_name, row_id, op) VALUES (100, 't', 'a', 'admin', 'proposals', 1, 'insert');
    `))
    await restoreBackup(db, bytes, opts(dataDir))
    const baseline = Number(db.sqlite.prepare('SELECT MAX(id) AS id FROM change_log').get()!.id)
    expect(db.sqlite.prepare('SELECT chat_id, proposal_cursor FROM family_telegram_groups').all()).toEqual([{ chat_id: '-100', proposal_cursor: baseline }])
    const { deliverGroupProposals } = await import('../../src/server/familyTelegramDelivery')
    const { fakeTelegram } = await import('../helpers/telegram')
    const tg = fakeTelegram()
    await deliverGroupProposals(db, { TELEGRAM_BOT_TOKEN: 'token' }, tg.fetchImpl)
    expect(tg.calls).toHaveLength(0)
    db.sqlite.exec("INSERT INTO change_log (ts, actor, source, table_name, row_id, op) VALUES ('t', 'a', 'admin', 'proposals', 1, 'update')")
    await deliverGroupProposals(db, { TELEGRAM_BOT_TOKEN: 'token' }, tg.fetchImpl)
    expect(tg.calls.map(c => c.chat)).toEqual(['-100'])
  })

  it('restores a current legacy backup without migration files', async () => {
    const { db, dataDir } = liveDb()
    // a legacy backup is of version 1: without the tables added since
    const bytes = currentBackup(b => b.sqlite.exec(`${BACK_TO_V1}; PRAGMA user_version = 0; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT, checksum TEXT); INSERT INTO schema_migrations VALUES ('0031_family_telegram.sql', 't', 'hash')`))
    await restoreBackup(db, bytes, opts(dataDir))
    expect(db.sqlite.prepare('SELECT name, value FROM assets').all()).toEqual([{ name: 'Backup bank', value: 777 }])
    expect(db.sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
  })

  it('restores a version 1 backup: brought up to date, its data kept', async () => {
    const { db, dataDir } = liveDb()
    db.sqlite.exec("INSERT INTO account_transfers VALUES ('2030-11-01', 'Live broker', 'Robin', 5, 'EUR')")
    await restoreBackup(db, currentBackup(b => b.sqlite.exec(BACK_TO_V1)), opts(dataDir))
    expect(db.sqlite.prepare('SELECT name, value FROM assets').all()).toEqual([{ name: 'Backup bank', value: 777 }])
    expect(db.sqlite.prepare('SELECT * FROM account_transfers').all()).toEqual([])
  })

  it('restores into a current legacy installation without changing its bookkeeping', async () => {
    const { db, dataDir } = liveDb()
    // the installation was upgraded at start: the current version, its legacy history kept
    db.sqlite.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT, checksum TEXT); INSERT INTO schema_migrations VALUES ('0031_family_telegram.sql', 't', 'hash')")
    await restoreBackup(db, currentBackup(), opts(dataDir))
    expect(db.sqlite.prepare('SELECT name, value FROM assets').all()).toEqual([{ name: 'Backup bank', value: 777 }])
    expect(db.sqlite.prepare('SELECT checksum FROM schema_migrations').get()).toEqual({ checksum: 'hash' })
    expect(db.sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
  })

  // refused on the header, before any temporary folder exists: no leftovers check here
  it('rejects random bytes', async () => {
    const { db, dataDir } = liveDb()
    const state = liveState(db)
    await expectRefused(restoreBackup(db, randomBytes(64 * 1024), opts(dataDir)), 'backup_invalid', 400)
    expect(liveState(db)).toEqual(state)
    expect(existsSync(join(dataDir, KEPT))).toBe(false)
  })

  it('rejects a truncated backup', async () => {
    const { db, dataDir } = liveDb()
    const state = liveState(db)
    const bytes = currentBackup()
    await expectRefused(restoreBackup(db, bytes.slice(0, Math.floor(bytes.length / 2)), opts(dataDir)), 'backup_invalid', 400)
    expect(liveState(db)).toEqual(state)
  })

  it('rejects a backup missing a required column without touching live data', async () => {
    const { db, dataDir } = liveDb()
    const state = liveState(db)
    const bytes = currentBackup(b => b.sqlite.exec('ALTER TABLE loans DROP COLUMN secured_by'))
    await expectRefused(restoreBackup(db, bytes, opts(dataDir)), 'backup_invalid', 400)
    expect(liveState(db)).toEqual(state)
  })

  it('rejects an SQLite file of another application', async () => {
    const leftovers = ownTmp()
    const { db, dataDir } = liveDb()
    const state = liveState(db)
    const bytes = backupBytes(b => b.sqlite.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT, checksum TEXT); CREATE TABLE notes (body TEXT)'))
    await expectRefused(restoreBackup(db, bytes, opts(dataDir)), 'backup_invalid', 400)
    expect(liveState(db)).toEqual(state)
    expect(existsSync(join(dataDir, KEPT))).toBe(false)
    expect(leftovers()).toEqual([])
  })

  it('keeps the rowids, so a restored journal entry can still be reverted', async () => {
    const { db, dataDir } = liveDb()
    const bytes = currentBackup(b => {
      // a gap: Ann's row is gone, Bob keeps rowid 2
      b.sqlite.exec("INSERT INTO members (name) VALUES ('Ann'), ('Bob'); DELETE FROM members WHERE name = 'Ann'")
    })
    // the journal entry is written through rows.ts in the source before it is copied
    const withEntry = await (async () => {
      const dir = freshDir()
      const file = join(dir, 'b.sqlite')
      writeFileSync(file, bytes)
      const b = openDatabase(file)
      await insertRow(b, 'members', { name: 'Cleo' }, ACTOR)
      await deleteRow(b, 'members', 2, ACTOR)
      const out = join(dir, 'copy.sqlite')
      b.sqlite.prepare('VACUUM INTO ?').run(out)
      b.close()
      return readFileSync(out)
    })()

    await restoreBackup(db, withEntry, opts(dataDir))
    expect(db.sqlite.prepare('SELECT rowid, name FROM members ORDER BY rowid').all()).toEqual([{ rowid: 3, name: 'Cleo' }])
    const insert = db.sqlite.prepare("SELECT id, row_id FROM change_log WHERE op = 'insert'").get() as { id: number; row_id: number }
    expect(insert.row_id).toBe(3)
    await revertChange(db, insert.id, ACTOR)
    expect(db.sqlite.prepare('SELECT count(*) AS n FROM members').get()).toEqual({ n: 0 })
  })

  it('carries the file\'s AUTOINCREMENT counters: an id the backup had used is not given again', async () => {
    const { db, dataDir } = liveDb()
    db.sqlite.exec("INSERT INTO spending_categories (name, kind) VALUES ('Live', 'mandatory')")
    // the file's last category was deleted: its counter is ahead of its rows
    let deleted = 0
    const bytes = currentBackup(b => {
      b.sqlite.exec("INSERT INTO spending_categories (name, kind) VALUES ('A', 'mandatory'), ('B', 'mandatory'), ('C', 'mandatory')")
      deleted = Number((b.sqlite.prepare("SELECT id FROM spending_categories WHERE name = 'C'").get() as { id: number }).id)
      b.sqlite.exec("DELETE FROM spending_categories WHERE name = 'C'")
    })
    await restoreBackup(db, bytes, opts(dataDir))
    db.sqlite.exec("INSERT INTO spending_categories (name, kind) VALUES ('New', 'mandatory')")
    expect(db.sqlite.prepare("SELECT id FROM spending_categories WHERE name = 'New'").get()).toEqual({ id: deleted + 1 })
    // a live counter ahead of the file's stays: never lowered
    expect(Number((db.sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'change_log'").get() as { seq: number }).seq))
      .toBeGreaterThanOrEqual(Number((db.sqlite.prepare('SELECT MAX(id) AS m FROM change_log').get() as { m: number }).m))
  })

  it('rejects a table with a generated column, and reads the upload with an untrusted schema', async () => {
    const { db, dataDir } = liveDb()
    const state = liveState(db)
    const generated = currentBackup(b => b.sqlite.exec('DROP TABLE members; CREATE TABLE members (name TEXT PRIMARY KEY, shout TEXT GENERATED ALWAYS AS (upper(name)) VIRTUAL)'))
    await expectRefused(restoreBackup(db, generated, opts(dataDir)), 'backup_invalid', 400)
    expect(liveState(db)).toEqual(state)

    // the live handle reads the attached file with trusted_schema off and gets its own setting back
    const trusted = db.sqlite.prepare('PRAGMA trusted_schema').get()
    const statements: string[] = []
    const exec = db.sqlite.exec.bind(db.sqlite)
    const prepare = db.sqlite.prepare.bind(db.sqlite)
    const execSpy = vi.spyOn(db.sqlite, 'exec').mockImplementation(sql => { statements.push(sql); return exec(sql) })
    const prepareSpy = vi.spyOn(db.sqlite, 'prepare').mockImplementation(sql => { statements.push(sql); return prepare(sql) })
    await restoreBackup(db, currentBackup(), opts(dataDir))
    execSpy.mockRestore()
    prepareSpy.mockRestore()
    const at = (pattern: RegExp) => statements.findIndex(sql => pattern.test(sql))
    expect(at(/^PRAGMA trusted_schema = OFF$/)).toBeGreaterThanOrEqual(0)
    expect(at(/^PRAGMA trusted_schema = OFF$/)).toBeLessThan(at(/^ATTACH/))
    expect(statements.findLastIndex(sql => /^PRAGMA trusted_schema = /.test(sql))).toBeGreaterThan(at(/^DETACH/))
    expect(db.sqlite.prepare('PRAGMA trusted_schema').get()).toEqual(trusted)
  })

  it('rejects a backup newer than the app', async () => {
    const { db, dataDir } = liveDb()
    const state = liveState(db)
    const bytes = currentBackup(b => b.sqlite.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`))
    await expectRefused(restoreBackup(db, bytes, opts(dataDir)), 'backup_newer', 409)
    expect(liveState(db)).toEqual(state)
  })

  it('names a backup from before migration 0031 as older, not damaged', async () => {
    const { db, dataDir } = liveDb()
    const state = liveState(db)
    const bytes = currentBackup(b => b.sqlite.exec("PRAGMA user_version = 0; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT, checksum TEXT); INSERT INTO schema_migrations VALUES ('0030_spending.sql', 't', 'hash')"))
    await expectRefused(restoreBackup(db, bytes, opts(dataDir)), 'backup_older', 409)
    expect(liveState(db)).toEqual(state)
  })

  it('leaves the live database untouched when the copy fails half-way', async () => {
    const leftovers = ownTmp()
    const { db, dataDir } = liveDb()
    const state = liveState(db)
    // Columns still match, but duplicate reverts fail the live unique index after assets have been copied.
    const bytes = currentBackup(b => {
      b.sqlite.exec("DROP INDEX idx_change_log_reverts; INSERT INTO change_log (ts, actor, source, table_name, row_id, op, reverts_id) VALUES ('t', 'a', 'admin', 'assets', 1, 'update', 42), ('t', 'a', 'admin', 'assets', 1, 'update', 42)")
      expect(() => validateSchema(b, SCHEMA_FILE)).not.toThrow()
    })
    await expectRefused(restoreBackup(db, bytes, opts(dataDir)), 'backup_invalid', 400)
    expect(liveState(db)).toEqual(state)
    // nothing changed, so there is nothing to keep
    expect(existsSync(join(dataDir, KEPT))).toBe(false)
    expect(leftovers()).toEqual([])
    expect(attached(db)).toEqual([])
  })
})

describe('POST /api/backup/restore', () => {
  function setup(env: Record<string, string> = { password: FAMILY_PASSWORD }) {
    const live = liveDb()
    const config = testConfig({ ...env, DATA_DIR: live.dataDir, SCHEMA_FILE })
    const auth = authFor(config)
    return { ...live, app: withCookie(createApp({ db: live.db, config, auth }), () => familyCookie(auth)) }
  }
  const upload = (body: BodyInit | Uint8Array, headers: Record<string, string> = {}) =>
    ({ method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream', ...headers }, duplex: 'half' }) as RequestInit

  it('previews a verified backup without changing live data or keeping a copy', async () => {
    const { db, app, dataDir } = setup()
    const before = liveState(db)
    const res = await app.request('/api/backup/preview', upload(currentBackup()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ lastPeriod: '2030-12-31', accounts: 1, goals: 0 })
    expect(liveState(db)).toEqual(before)
    expect(readdirSync(dataDir).filter(n => n.startsWith('before-restore-'))).toEqual([])
    expect((await app.request('/api/backup/preview', upload(randomBytes(64)))).status).toBe(400)
    expect((await app.request('/api/backup/preview', upload('x', { 'Content-Length': String(RESTORE_MAX_BYTES + 1) }))).status).toBe(413)
  })

  it('counts separate owners of identically named accounts', async () => {
    const { app } = setup()
    const bytes = currentBackup(b => b.sqlite.exec(`
      DELETE FROM assets;
      INSERT INTO assets (date, class, name, value, currency, member) VALUES
        ('2030-12-31', 'bank', 'Shared bank', 10, 'USD', 'Ann'),
        ('2030-12-31', 'bank', 'Shared bank', 20, 'USD', 'Bob');
    `))
    const response = await app.request('/api/backup/preview', upload(bytes))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ accounts: 2 })
  })

  it('counts one account across type, currency and null-or-empty owner history', async () => {
    const { app } = setup()
    const bytes = currentBackup(b => b.sqlite.exec(`
      DELETE FROM assets;
      INSERT INTO assets (date, class, name, value, currency, member) VALUES
        ('2030-10-31', 'bank', 'My account', 10, 'USD', NULL),
        ('2030-11-30', 'broker', 'My account', 20, 'EUR', ''),
        ('2030-12-31', 'bank', 'My account', 30, 'RUB', NULL);
    `))
    const response = await app.request('/api/backup/preview', upload(bytes))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ accounts: 1 })
  })

  it('preview rejects hostile schemas and constraint violations without live changes', async () => {
    const { db, app } = setup()
    const state = liveState(db)
    for (const sql of [
      'DROP TABLE members; CREATE TABLE members (name TEXT PRIMARY KEY, shout TEXT GENERATED ALWAYS AS (upper(name)) VIRTUAL)',
      "DROP TABLE members; CREATE TABLE members (name TEXT); INSERT INTO members VALUES ('Ann'), ('Ann')",
    ]) {
      const res = await app.request('/api/backup/preview', upload(currentBackup(b => b.sqlite.exec(sql))))
      expect(res.status).toBe(400)
      expect(liveState(db)).toEqual(state)
    }
  })

  it('requires manage rights for preview, persistent result and kept-copy download', async () => {
    const { db, dataDir } = liveDb()
    const config = testConfig({ mode: 'telegram', TELEGRAM_BOT_TOKEN: '1:x', DATA_DIR: dataDir, SCHEMA_FILE })
    const auth = authFor(config)
    const id = Number(db.sqlite.prepare("INSERT INTO users (member, telegram_id, can_manage, created_at, updated_at) VALUES ('Reader', '100', 0, '2020-01-01', '2020-01-01')").run().lastInsertRowid)
    const server = createApp({ db, config, auth })
    const headers = { Cookie: await userCookie(auth, id) }
    for (const [url, init] of [
      ['/api/backup/preview', upload(currentBackup())],
      ['/api/backup/result', {}],
      [`/api/backup/kept/${KEPT}`, {}],
    ] as const) {
      expect((await server.request(url, init)).status).toBe(401)
      const denied = await server.request(url, { ...init, headers: { ...init.headers, ...headers } })
      expect(denied.status).toBe(403)
      expect(await denied.json()).toEqual({ error: { code: 'no_right_manage' } })
    }
  })

  it('keeps a durable restore result and downloads only safe kept copies', async () => {
    const { app, dataDir } = setup()
    expect(await (await app.request('/api/backup/result')).json()).toEqual({ result: null })
    const { kept } = await (await app.request('/api/backup/restore', upload(currentBackup()))).json() as { kept: string }
    expect(await (await app.request('/api/backup/result')).json()).toEqual({ result: { kept, restoredAt: expect.any(String) } })
    const res = await app.request(`/api/backup/kept/${kept}`)
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(readFileSync(join(dataDir, kept))))
    expect((await app.request('/api/backup/kept/finance.sqlite')).status).toBe(404)
    expect((await app.request('/api/backup/kept/..%2Ffinance.sqlite')).status).toBe(404)
    const link = 'before-restore-20000101-000000.sqlite'
    symlinkSync(join(dataDir, 'finance.sqlite'), join(dataDir, link))
    expect((await app.request(`/api/backup/kept/${link}`)).status).toBe(404)
  })

  it('restores the uploaded file', async () => {
    const { db, app } = setup()
    const res = await app.request('/api/backup/restore', upload(currentBackup()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ kept: expect.stringMatching(/^before-restore-\d{8}-\d{6}\.sqlite$/) })
    expect(db.sqlite.prepare("SELECT value FROM parameters WHERE key = 'inflation_rate'").all()).toEqual([{ value: 9.5 }])
  })

  it('answers a translated error for random bytes', async () => {
    const { app } = setup()
    const res = await app.request('/api/backup/restore', upload(randomBytes(1024)))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 'backup_invalid' } })
  })

  it('rejects a file over the limit', async () => {
    const { db, app } = setup()
    const state = liveState(db)
    // the declared size is refused before the body is read
    const declared = await app.request('/api/backup/restore', upload('x', { 'Content-Length': String(RESTORE_MAX_BYTES + 1) }))
    expect(declared.status).toBe(413)
    expect(await declared.json()).toEqual({ error: { code: 'backup_too_large' } })
    // a body without a size stops being read once it passes the limit
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > RESTORE_MAX_BYTES) { controller.close(); return }
        sent += chunk.length
        controller.enqueue(chunk)
      },
    })
    const streamed = await app.request('/api/backup/restore', upload(stream))
    expect(streamed.status).toBe(413)
    expect(liveState(db)).toEqual(state)
  })

  it('refuses in the demo', async () => {
    const { db, dataDir, app } = setup({ AUTH_MODE: 'demo' })
    const state = liveState(db)
    const res = await app.request('/api/backup/restore', upload(currentBackup()))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: { code: 'not_in_demo' } })
    expect(liveState(db)).toEqual(state)
    expect(readdirSync(dataDir).filter(n => n.startsWith('before-restore-'))).toEqual([])
  })

  it('refuses another body type and other methods', async () => {
    const { app } = setup()
    const wrongType = await app.request('/api/backup/restore', upload(currentBackup(), { 'Content-Type': 'text/plain' }))
    expect(wrongType.status).toBe(415)
    expect(await wrongType.json()).toEqual({ error: { code: 'backup_media_type' } })
    expect((await app.request('/api/backup/restore')).status).toBe(405)
  })

  it('a restore cannot be reverted', async () => {
    const { db, app } = setup()
    expect((await app.request('/api/backup/restore', upload(currentBackup()))).status).toBe(200)
    const { id } = db.sqlite.prepare("SELECT id FROM change_log WHERE op = 'restore'").get() as { id: number }
    const res = await app.request(`/api/admin/change_log/${id}/revert`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'not_revertible' } })
    // a wipe entry (Task 9) is refused the same way
    db.sqlite.exec("INSERT INTO change_log (ts, actor, source, table_name, row_id, op) VALUES ('t', 'a', 'admin', '*', 0, 'wipe')")
    const wipe = db.sqlite.prepare("SELECT id FROM change_log WHERE op = 'wipe'").get() as { id: number }
    expect((await app.request(`/api/admin/change_log/${wipe.id}/revert`, { method: 'POST' })).status).toBe(409)
  })
})

