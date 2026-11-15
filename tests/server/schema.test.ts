import { describe, expect, it, onTestFinished } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openDatabase } from '../../src/server/db'
import { initializeSchema, validateSchema } from '../../src/server/schema'
import { withTempDirs } from '../helpers/tmp'

const schemaFile = resolve('schema.sql')
const tempDir = withTempDirs('schema-test-')
function database() {
  const db = openDatabase(':memory:')
  onTestFinished(() => db.close())
  return db
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
    expect(db.sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").get()).toBeUndefined()
  })

  it('accepts an already updated legacy database without rewriting its history or data', () => {
    const db = database()
    db.sqlite.exec(readFileSync(schemaFile, 'utf8'))
    db.sqlite.exec("PRAGMA user_version = 0; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT, checksum TEXT); INSERT INTO schema_migrations VALUES ('0031_family_telegram.sql', 'old', 'hash')")
    const before = db.sqlite.prepare('SELECT total_changes() AS n').get()
    initializeSchema(db, schemaFile)
    validateSchema(db, schemaFile)
    expect(db.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before)
    expect(db.sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 })
    expect(db.sqlite.prepare('SELECT applied_at FROM schema_migrations').get()).toEqual({ applied_at: 'old' })
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
    db.sqlite.exec('PRAGMA user_version = 2')
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
