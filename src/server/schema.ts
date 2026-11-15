// One current schema: create empty databases, validate existing ones without changing their data.
import { readFileSync } from 'node:fs'
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

/** Validate required columns, including generated-column flags, before opening a database or restoring its data. */
export function validateSchema(db: SqliteDatabase, schemaFile: string): void {
  const version = Number(db.sqlite.prepare('PRAGMA user_version').get()!.user_version)
  if (version > 1) throw new SchemaError('newer')
  const legacy = db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
  if (legacy) {
    const latest = db.sqlite.prepare('SELECT MAX(name) AS name FROM schema_migrations').get()!.name
    if (typeof latest === 'string' && latest > '0031_family_telegram.sql') throw new SchemaError('newer')
    if (version === 0 && latest !== '0031_family_telegram.sql') throw new SchemaError('older')
  } else if (version !== 1) throw new SchemaError()

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

/** Schema SQL runs only on an empty database, atomically; updated legacy databases are read without rewriting history. */
export function initializeSchema(db: SqliteDatabase, schemaFile: string): void {
  if (db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get()) {
    validateSchema(db, schemaFile)
    return
  }
  const version = Number(db.sqlite.prepare('PRAGMA user_version').get()!.user_version)
  if (version > 1) throw new SchemaError('newer')
  transaction(db.sqlite, () => db.sqlite.exec(readFileSync(schemaFile, 'utf8')))
}
