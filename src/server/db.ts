// The database interface the whole server sees, and its node:sqlite implementation.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

export interface DbResult<T = Record<string, unknown>> {
  results: T[]
  meta: { last_row_id: number; changes: number }
}

declare const readTokenBrand: unique symbol
/** Opaque snapshot of one connection's write counters, captured before async preflight reads. */
export interface DbReadToken { readonly [readTokenBrand]: true }

/** Internal optimistic-read conflict; callers may rebuild from a fresh token. */
export class DbReadConflict extends Error {
  constructor() {
    super('Database changed during mutation preflight')
    this.name = 'DbReadConflict'
  }
}

export interface PreparedStatement {
  bind(...values: unknown[]): PreparedStatement
  all<T = Record<string, unknown>>(): Promise<DbResult<T>>
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<DbResult>
}

/**
 * One synchronous BEGIN IMMEDIATE (`immediate: false`: a deferred BEGIN) … COMMIT around `run`, whose result it returns; a throw rolls back and is rethrown.
 * Nothing may await inside `run`: no other request on the connection gets into the transaction.
 */
export function transaction<T>(sqlite: DatabaseSync, run: () => T, { immediate = true }: { immediate?: boolean } = {}): T {
  sqlite.exec(immediate ? 'BEGIN IMMEDIATE' : 'BEGIN')
  try {
    const out = run()
    sqlite.exec('COMMIT')
    return out
  } catch (error) {
    // ROLLBACK must not hide the original error (the transaction may have ended on its own)
    try { sqlite.exec('ROLLBACK') } catch { /* the original error matters more */ }
    throw error
  }
}

export interface Database {
  prepare(sql: string): PreparedStatement
  readToken(): DbReadToken
  /** Checks preflight reads under BEGIN IMMEDIATE, then runs the statements synchronously. */
  guardedBatch(token: DbReadToken, statements: PreparedStatement[]): Promise<DbResult[]>
  /** Runs the statements in order in one transaction; an error rolls everything back. */
  batch(statements: PreparedStatement[]): Promise<DbResult[]>
}

export interface SqliteDatabase extends Database {
  sqlite: DatabaseSync
  close(): void
}

const READS = /^\s*(SELECT|PRAGMA|WITH)\b/i

interface Bound { sql: string; params: SQLInputValue[] }

/** Opens an SQLite file (or ':memory:'): WAL, foreign keys, waiting up to 5 s for a lock. */
export function openDatabase(path: string): SqliteDatabase {
  const sqlite = new DatabaseSync(path)
  try {
    if (path !== ':memory:') sqlite.exec('PRAGMA journal_mode = WAL')
    sqlite.exec('PRAGMA foreign_keys = ON')
    sqlite.exec('PRAGMA busy_timeout = 5000')
  } catch (error) {
    // not a database (an uploaded backup that is not one): the handle is not left open
    sqlite.close()
    throw error
  }
  const plain = (row: unknown) => ({ ...(row as Record<string, unknown>) })
  const run = ({ sql, params }: Bound): DbResult => {
    const r = sqlite.prepare(sql).run(...params)
    return { results: [], meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }
  }
  // batch takes the SQL and params from here and runs them synchronously: with no await between BEGIN and COMMIT
  // another request on the same connection cannot get inside the transaction.
  const bound = new WeakMap<PreparedStatement, Bound>()
  const statement = (sql: string, params: SQLInputValue[] = []): PreparedStatement => {
    const s: PreparedStatement = {
      bind: (...values: unknown[]) => statement(sql, values as SQLInputValue[]),
      async all<T>() {
        if (!READS.test(sql)) return run({ sql, params }) as DbResult<T>
        return { results: sqlite.prepare(sql).all(...params).map(plain) as T[], meta: { last_row_id: 0, changes: 0 } }
      },
      async first<T>() {
        const row = sqlite.prepare(sql).get(...params)
        return (row ? plain(row) : null) as T | null
      },
      async run() { return run({ sql, params }) },
    }
    bound.set(s, { sql, params })
    return s
  }
  const tokens = new WeakMap<DbReadToken, { changes: number; version: number }>()
  const counters = () => ({
    changes: Number(sqlite.prepare('SELECT total_changes() AS n').get()!.n),
    version: Number(sqlite.prepare('PRAGMA data_version').get()!.data_version),
  })
  const batchItems = (statements: PreparedStatement[]) => statements.map(s => {
    const b = bound.get(s)
    if (!b) throw new Error('batch accepts only statements from this database')
    return b
  })
  return {
    sqlite,
    close: () => sqlite.close(),
    prepare: sql => statement(sql),
    readToken() {
      const token = Object.freeze({}) as DbReadToken
      tokens.set(token, counters())
      return token
    },
    async guardedBatch(token, statements) {
      const expected = tokens.get(token)
      if (!expected) throw new Error('read token belongs to another database')
      const items = batchItems(statements)
      return transaction(sqlite, () => {
        const current = counters()
        if (current.changes !== expected.changes || current.version !== expected.version) throw new DbReadConflict()
        return items.map(run)
      })
    },
    async batch(statements) {
      const items = batchItems(statements)
      return transaction(sqlite, () => items.map(run), { immediate: false })
    },
  }
}
