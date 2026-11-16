// One current schema: create empty databases; bring an older one up to date by additive steps (a copy of it kept first),
// then validate it. Data is never rewritten.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { transaction, type SqliteDatabase } from './db'
import { quoteIdent } from './tables'

/** `age`: the database is from a newer release, or from an older one (before migration 0031); null: just incompatible */
export class SchemaError extends Error {
  readonly age: 'newer' | 'older' | null
  constructor(age: 'newer' | 'older' | null = null) {
    super(age === 'newer' ? 'Database schema is newer than this application'
      : age === 'older' ? 'Database schema is from an older release; update it with the previous release (0.41.0) first'
        : 'Database schema is incompatible; use a backup from an updated installation')
    this.age = age
  }
}

/** The version `schema.sql` creates (`PRAGMA user_version`). */
export const SCHEMA_VERSION = 2
/** Step n brings a database of version n − 1 to n: additive DDL only (a new table or index), never a rewrite of data. */
const STEPS: Record<number, string> = {
  2: `CREATE TABLE account_transfers (
  date     DATE NOT NULL,
  name     TEXT NOT NULL,
  member   TEXT NOT NULL,
  amount   REAL NOT NULL,
  currency TEXT NOT NULL,
  PRIMARY KEY (date, name, member)
);`,
}

/** The database's schema version; an updated legacy database (user_version 0, history up to migration 0031) is version 1. */
function versionOf(db: SqliteDatabase): number {
  const version = Number(db.sqlite.prepare('PRAGMA user_version').get()!.user_version)
  if (version > SCHEMA_VERSION) throw new SchemaError('newer')
  const legacy = db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
  if (legacy) {
    const latest = db.sqlite.prepare('SELECT MAX(name) AS name FROM schema_migrations').get()!.name
    if (typeof latest === 'string' && latest > '0031_family_telegram.sql') throw new SchemaError('newer')
    if (version === 0) {
      if (latest !== '0031_family_telegram.sql') throw new SchemaError('older')
      return 1
    }
  }
  if (version < 1) throw new SchemaError()
  return version
}

/** before-upgrade-v1-YYYYMMDD-HHMMSS.sqlite, UTC. */
function copyName(from: number, now: Date): string {
  const iso = now.toISOString()
  return `before-upgrade-v${from}-${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}.sqlite`
}

/**
 * Brings an older database to SCHEMA_VERSION: with `copyDir`, first a consistent copy of it there (VACUUM INTO; a failed
 * copy stops the upgrade with the database untouched), then every missing step and the new version in one transaction.
 * Returns the copy's path, or null when nothing was needed (or no copy was asked for).
 */
export function upgradeSchema(db: SqliteDatabase, copyDir?: string, now = new Date()): string | null {
  const from = versionOf(db)
  if (from === SCHEMA_VERSION) return null
  let copy: string | null = null
  if (copyDir !== undefined) {
    copy = join(copyDir, copyName(from, now))
    db.sqlite.prepare('VACUUM INTO ?').run(copy)
  }
  transaction(db.sqlite, () => {
    // another process (the MCP connector) may have upgraded it meanwhile
    for (let v = versionOf(db) + 1; v <= SCHEMA_VERSION; v++) db.sqlite.exec(STEPS[v])
    db.sqlite.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  })
  return copy
}

/** Validate required columns, including generated-column flags, before opening a database or restoring its data. */
export function validateSchema(db: SqliteDatabase, schemaFile: string): void {
  if (versionOf(db) !== SCHEMA_VERSION) throw new SchemaError()

  const reference = new DatabaseSync(':memory:')
  try {
    reference.exec(readFileSync(schemaFile, 'utf8'))
    const tables = reference.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
    for (const { name } of tables) {
      const query = `PRAGMA table_xinfo(${quoteIdent(String(name))})`
      if (JSON.stringify(db.sqlite.prepare(query).all()) !== JSON.stringify(reference.prepare(query).all())) throw new SchemaError()
    }
  } finally { reference.close() }
}

/**
 * Schema SQL runs only on an empty database, atomically; an existing one is upgraded (upgradeSchema, its copy kept in
 * `copyDir`) and validated. Updated legacy databases keep their history table.
 */
export function initializeSchema(db: SqliteDatabase, schemaFile: string, copyDir?: string): void {
  if (db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get()) {
    const copy = upgradeSchema(db, copyDir)
    if (copy) console.log(`[schema] updated to version ${SCHEMA_VERSION}; the database before it: ${copy}`)
    validateSchema(db, schemaFile)
    return
  }
  const version = Number(db.sqlite.prepare('PRAGMA user_version').get()!.user_version)
  if (version > SCHEMA_VERSION) throw new SchemaError('newer')
  transaction(db.sqlite, () => db.sqlite.exec(readFileSync(schemaFile, 'utf8')))
}
