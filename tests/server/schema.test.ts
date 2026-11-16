import { describe, expect, it, onTestFinished } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openDatabase } from '../../src/server/db'
import { initializeSchema, SCHEMA_VERSION, upgradeSchema, validateSchema } from '../../src/server/schema'
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
  db.sqlite.exec("DROP TABLE account_transfers; PRAGMA user_version = 1; INSERT INTO assets (date, class, name, value, currency) VALUES ('2031-01-31', 'cash', 'Savings', 123, 'USD')")
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
