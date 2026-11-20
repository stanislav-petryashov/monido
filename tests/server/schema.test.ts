import { describe, expect, it, onTestFinished } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openDatabase } from '../../src/server/db'
import { initializeSchema, SCHEMA_VERSION, upgradeSchema, validateSchema } from '../../src/server/schema'
import { BACK_TO_V1, BACK_TO_V2, BACK_TO_V3 } from '../helpers/db'
import { withTempDirs } from '../helpers/tmp'

const schemaFile = resolve('schema.sql')
const tempDir = withTempDirs('schema-test-')
function database() {
  const db = openDatabase(':memory:')
  onTestFinished(() => db.close())
  return db
}

/** A database as version 1 left it: the current schema without what the steps add, with a row of data. */
function versionOne(db: ReturnType<typeof openDatabase>) {
  db.sqlite.exec(readFileSync(schemaFile, 'utf8'))
  db.sqlite.exec(BACK_TO_V1)
  db.sqlite.exec("INSERT INTO assets (date, class, name, value, currency) VALUES ('2031-01-31', 'cash', 'Savings', 123, 'USD')")
}

describe('current database schema', () => {
  it('creates a usable empty database once, preserving data on the next start', () => {
    const db = database()
    initializeSchema(db, schemaFile)
    db.sqlite.exec("INSERT INTO assets (date, class, name, value, currency) VALUES ('2031-01-31', 'cash', 'Savings', 123, 'USD')")
    const before = db.sqlite.prepare('SELECT total_changes() AS n').get()
    initializeSchema(db, schemaFile)
    expect(db.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before)
    expect(db.sqlite.prepare('SELECT value FROM assets').get()).toEqual({ value: 123 })
    expect(db.sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").get()).toBeUndefined()
  })

  it('upgrades an updated legacy database (version 1) without rewriting its history or data', () => {
    const db = database()
    versionOne(db)
    db.sqlite.exec("PRAGMA user_version = 0; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT, checksum TEXT); INSERT INTO schema_migrations VALUES ('0031_family_telegram.sql', 'old', 'hash')")
    initializeSchema(db, schemaFile)
    validateSchema(db, schemaFile)
    expect(db.sqlite.prepare('SELECT value FROM assets').get()).toEqual({ value: 123 })
    expect(db.sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(db.sqlite.prepare('SELECT applied_at FROM schema_migrations').get()).toEqual({ applied_at: 'old' })
    // the next start changes nothing
    const before = db.sqlite.prepare('SELECT total_changes() AS n').get()
    initializeSchema(db, schemaFile)
    expect(db.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before)
  })

  it('a version 1 database plus the steps is exactly schema.sql; a copy of it is kept first', () => {
    const dir = tempDir()
    const db = openDatabase(join(dir, 'finance.sqlite'))
    onTestFinished(() => db.close())
    versionOne(db)
    expect(() => validateSchema(db, schemaFile)).toThrow(/schema/i)
    const copy = upgradeSchema(db, dir, new Date('2031-02-03T04:05:06Z'))
    expect(copy).toBe(join(dir, 'before-upgrade-v1-20310203-040506.sqlite'))
    validateSchema(db, schemaFile)
    const kept = openDatabase(copy!)
    onTestFinished(() => kept.close())
    expect(kept.sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    expect(kept.sqlite.prepare('SELECT value FROM assets').get()).toEqual({ value: 123 })
    expect(upgradeSchema(db, dir)).toBeNull()
    expect(readdirSync(dir).filter(f => f.startsWith('before-upgrade') && f.endsWith('.sqlite'))).toHaveLength(1)
  })

  it('an upgraded database has the very tables of a fresh one: rowid tables, strictness and columns alike', () => {
    const upgraded = database()
    versionOne(upgraded)
    upgradeSchema(upgraded)
    const fresh = database()
    initializeSchema(fresh, schemaFile)
    const tables = (db: ReturnType<typeof openDatabase>) => db.sqlite.prepare("SELECT name, type, ncol, wr, strict FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    expect(tables(upgraded)).toEqual(tables(fresh))
  })

  it('step 3 keeps every account closure, one row per closing, and drops the table keyed by account', () => {
    const dir = tempDir()
    const db = openDatabase(join(dir, 'finance.sqlite'))
    onTestFinished(() => db.close())
    db.sqlite.exec(readFileSync(schemaFile, 'utf8'))
    db.sqlite.exec(BACK_TO_V2)
    db.sqlite.exec("INSERT INTO account_closures VALUES ('Card', 'Robin', '2026-09'), ('Old bank', '', '2025-01')")
    const copy = upgradeSchema(db, dir, new Date('2031-02-03T04:05:06Z'))
    validateSchema(db, schemaFile)
    expect(db.sqlite.prepare('SELECT name, member, closed_month FROM account_closings ORDER BY name').all())
      .toEqual([{ name: 'Card', member: 'Robin', closed_month: '2026-09' }, { name: 'Old bank', member: '', closed_month: '2025-01' }])
    expect(db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'account_closures'").get()).toBeUndefined()
    // the copy made first still has them as they were
    const kept = openDatabase(copy!)
    onTestFinished(() => kept.close())
    expect(kept.sqlite.prepare('SELECT COUNT(*) AS n FROM account_closures').get()).toEqual({ n: 2 })
    // a second closing of a reused name is kept beside the first
    db.sqlite.exec("INSERT INTO account_closings VALUES ('Card', 'Robin', '2026-03')")
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM account_closings WHERE name = 'Card'").get()).toEqual({ n: 2 })
  })

  it('step 4 adds the provider identity tables and keeps every row', () => {
    const db = database()
    db.sqlite.exec(readFileSync(schemaFile, 'utf8'))
    db.sqlite.exec(BACK_TO_V3)
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Ann'); INSERT INTO users (member, created_at, updated_at) VALUES ('Ann', 't', 't')")
    upgradeSchema(db)
    validateSchema(db, schemaFile)
    expect(db.sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 })
    expect(db.sqlite.prepare('SELECT member FROM users').all()).toEqual([{ member: 'Ann' }])
    db.sqlite.exec("INSERT INTO user_identities (user_id, issuer, subject, linked_at) VALUES (1, 'https://idp.test', 'ann', 't')")
    db.sqlite.exec("INSERT INTO identity_invites (user_id, hash, expires_at) VALUES (1, 'h', 't')")
    // a user's deletion takes their identity and invitation with it
    db.sqlite.exec('DELETE FROM users')
    expect(db.sqlite.prepare('SELECT (SELECT COUNT(*) FROM user_identities) + (SELECT COUNT(*) FROM identity_invites) AS n').get()).toEqual({ n: 0 })
  })

  it('one identity per user and one user per identity', () => {
    const db = database()
    initializeSchema(db, schemaFile)
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Ann'), ('Bob'); INSERT INTO users (member, created_at, updated_at) VALUES ('Ann', 't', 't'), ('Bob', 't', 't')")
    db.sqlite.exec("INSERT INTO user_identities (user_id, issuer, subject, linked_at) VALUES (1, 'https://idp.test', 'ann', 't')")
    expect(() => db.sqlite.exec("INSERT INTO user_identities (user_id, issuer, subject, linked_at) VALUES (1, 'https://idp.test', 'other', 't')")).toThrow(/UNIQUE/)
    expect(() => db.sqlite.exec("INSERT INTO user_identities (user_id, issuer, subject, linked_at) VALUES (2, 'https://idp.test', 'ann', 't')")).toThrow(/UNIQUE/)
  })

  it('a failing step 3 leaves version 2 whole: nothing created, copied or dropped', () => {
    const db = database()
    db.sqlite.exec(readFileSync(schemaFile, 'utf8'))
    db.sqlite.exec(BACK_TO_V2)
    db.sqlite.exec("INSERT INTO account_closures VALUES ('Card', 'Robin', '2026-09')")
    // a table already named like the new one makes the step fail half way
    db.sqlite.exec('CREATE TABLE account_closings (x)')
    expect(() => upgradeSchema(db)).toThrow()
    expect(db.sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 })
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM account_closures').get()).toEqual({ n: 1 })
  })

  it('a copy of the same second gets a name of its own (the MCP connector starting with the server)', () => {
    const dir = tempDir()
    const now = new Date('2031-02-03T04:05:06Z')
    writeFileSync(join(dir, 'before-upgrade-v1-20310203-040506.sqlite'), 'taken')
    const db = database()
    versionOne(db)
    expect(upgradeSchema(db, dir, now)).toBe(join(dir, 'before-upgrade-v1-20310203-040506-2.sqlite'))
    expect(readFileSync(join(dir, 'before-upgrade-v1-20310203-040506.sqlite'), 'utf8')).toBe('taken')
  })

  it('a copy that cannot be written stops the upgrade with the database untouched', () => {
    const db = database()
    versionOne(db)
    expect(() => upgradeSchema(db, join(tempDir(), 'missing', 'dir'))).toThrow()
    expect(db.sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    expect(db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'account_transfers'").get()).toBeUndefined()
    expect(existsSync(join(tempDir(), 'missing'))).toBe(false)
  })

  it('refuses an incomplete database instead of silently filling or resetting it', () => {
    const db = database()
    db.sqlite.exec('CREATE TABLE assets (value REAL); INSERT INTO assets VALUES (321)')
    expect(() => initializeSchema(db, schemaFile)).toThrow(/schema/i)
    expect(db.sqlite.prepare('SELECT value FROM assets').get()).toEqual({ value: 321 })
  })

  it('refuses an empty upload, a newer schema and newer legacy history', () => {
    const db = database()
    expect(() => validateSchema(db, schemaFile)).toThrow(/schema/i)
    initializeSchema(db, schemaFile)
    db.sqlite.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    expect(() => initializeSchema(db, schemaFile)).toThrow(/newer/i)
    db.sqlite.exec("PRAGMA user_version = 0; CREATE TABLE schema_migrations (name TEXT); INSERT INTO schema_migrations VALUES ('0999_future.sql')")
    expect(() => validateSchema(db, schemaFile)).toThrow(/newer/i)
  })

  it('rolls back failed initialization including the schema version', () => {
    const db = database()
    const broken = join(tempDir(), 'broken.sql')
    writeFileSync(broken, 'CREATE TABLE assets (value); PRAGMA user_version = 1; invalid SQL;')
    expect(() => initializeSchema(db, broken)).toThrow()
    expect(db.sqlite.prepare('SELECT name FROM sqlite_master').all()).toEqual([])
    expect(db.sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 })
  })
})
