// One current schema: create empty databases; bring an older one up to date by steps that add (a copy of it kept first),
// then validate it. Rows are never edited in place.
import { existsSync, readFileSync, rmSync } from 'node:fs'
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
export const SCHEMA_VERSION = 4
/**
 * Step n brings a database of version n − 1 to n: it adds tables or indexes and may fill a new table from existing ones,
 * then drop the table it replaces; it never edits rows in place. The copy made before the upgrade is the way back.
 */
const STEPS: Record<number, string> = {
  2: `CREATE TABLE account_transfers (
  date     DATE NOT NULL,
  name     TEXT NOT NULL,
  member   TEXT NOT NULL,
  amount   REAL NOT NULL,
  currency TEXT NOT NULL,
  PRIMARY KEY (date, name, member)
);`,
  // one row per closing, not per account: a reused name closed again kept only its latest closing, and the months
  // between its two lives read as missing a balance
  3: `CREATE TABLE account_closings (
  name         TEXT NOT NULL,
  member       TEXT NOT NULL,
  closed_month TEXT NOT NULL,
  PRIMARY KEY (name, member, closed_month)
);
INSERT INTO account_closings (name, member, closed_month) SELECT name, member, closed_month FROM account_closures;
DROP TABLE account_closures;`,
  4: `CREATE TABLE user_identities (
  id        INTEGER PRIMARY KEY,
  user_id   INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  issuer    TEXT NOT NULL,
  subject   TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  UNIQUE (issuer, subject)
);

CREATE TABLE identity_invites (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hash       TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL
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

/** before-upgrade-v1-YYYYMMDD-HHMMSS.sqlite, UTC; -2, -3… when that name is taken (two processes in one second). */
function copyPath(dir: string, from: number, now: Date): string {
  const iso = now.toISOString()
  const stem = join(dir, `before-upgrade-v${from}-${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`)
  let path = `${stem}.sqlite`
  for (let n = 2; existsSync(path); n++) path = `${stem}-${n}.sqlite`
  return path
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
    copy = copyPath(copyDir, from, now)
    try { db.sqlite.prepare('VACUUM INTO ?').run(copy) } catch (error) {
      // a part written before the failure (a full disk) must not pass for a safety copy
      rmSync(copy, { force: true })
      throw error
    }
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
