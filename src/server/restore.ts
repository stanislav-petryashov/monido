// Restore from a backup file: Settings → Data → "Restore from file" (POST /api/backup/restore).
// The upload is checked as a separate file; the live database is copied aside (VACUUM INTO) and then
// receives the upload's rows in one transaction on the app's own handle. Any failure before COMMIT leaves it as it was.
import { constants, existsSync } from 'node:fs'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, transaction, type SqliteDatabase } from './db'
import { attachment, InputError, isConstraint, type Actor } from './http'
import { SchemaError, upgradeSchema, validateSchema } from './schema'
import { CHANGE_LOG_INSERT } from './rows'
import { quoteIdent } from './tables'
import { AUTH_KEY_PREFIX } from '../domain/journal'
import { serverModules } from '../modules/server'

/** The largest backup file the server takes. */
export const RESTORE_MAX_BYTES = 100 * 1024 * 1024

/** The first 16 bytes of every SQLite database file. */
const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\0')
/** Tables every Monido database has had in the current schema. */
const CORE_TABLES = ['assets', 'monthly_cashflow', 'currencies', 'members', 'parameters']
/** The schema name the upload is attached under while its rows are copied. */
const SOURCE = 'restore_source'
/** LIKE pattern (ESCAPE '\\') of the sign-in settings' keys. */
const AUTH_LIKE = `${AUTH_KEY_PREFIX.replace('_', '\\_')}%`

const invalid = () => new InputError('backup_invalid', 400)
const names = (rows: unknown[]) => rows.map(r => String((r as { name: unknown }).name))

/** before-restore-YYYYMMDD-HHMMSS.sqlite, UTC. */
function keptName(now: Date): string {
  const iso = now.toISOString()
  return `before-restore-${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}.sqlite`
}

/** An intact SQLite file with the core tables and a compatible current schema. */
function checkUpload(upload: SqliteDatabase, schemaFile: string): void {
  let tables: Set<string>
  try {
    const integrity = upload.sqlite.prepare('PRAGMA integrity_check').all() as { integrity_check: unknown }[]
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw invalid()
    tables = new Set(names(upload.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()))
    if (CORE_TABLES.some(t => !tables.has(t))) throw invalid()
  } catch (err) {
    if (err instanceof InputError) throw err
    throw invalid()
  }
  // an older backup is brought up to date in its staged copy (no copy of its own: the upload itself is one)
  try { upgradeSchema(upload); validateSchema(upload, schemaFile) } catch (err) {
    if (err instanceof SchemaError && err.age === 'newer') throw new InputError('backup_newer', 409)
    if (err instanceof SchemaError && err.age === 'older') throw new InputError('backup_older', 409)
    throw invalid()
  }
}

/** Opens the uploaded file, checks its current schema; it is closed again, in rollback-journal mode. */
function prepareUpload(file: string, schemaFile: string): void {
  let upload: SqliteDatabase
  try { upload = openDatabase(file) } catch { throw invalid() }
  try {
    // the upload is untrusted: functions in its schema (views, triggers) must not run with the app's trust
    upload.sqlite.exec('PRAGMA trusted_schema = OFF')
    checkUpload(upload, schemaFile)
    // no -wal file next to it when it is attached
    upload.sqlite.exec('PRAGMA journal_mode = DELETE')
  } finally {
    upload.close()
  }
}

/** The ordinary tables of a schema (`PRAGMA table_list`): name → whether it is WITHOUT ROWID. */
function tableList(sqlite: SqliteDatabase['sqlite'], schema: string): Map<string, boolean> {
  const rows = sqlite.prepare(`PRAGMA ${schema}.table_list`).all()
  return new Map(rows.filter(r => r.type === 'table').map(r => [String(r.name), Number(r.wr) === 1]))
}

/**
 * Tables a restore leaves as they are: the migration bookkeeping, the live users (their sessions are checked against
 * `created_at`), the advisor connector's OAuth clients and tokens and the Telegram reminders' link — credentials, like the
 * users: a backup file never brings back a connection or a chat that was unlinked, or tokens of a user re-created since.
 */
const RESTORE_KEEP = new Set(['schema_migrations', 'users', 'oauth_clients', 'oauth_tokens', 'reminder_settings', 'family_telegram_groups', 'family_telegram_pairing', 'family_telegram_reminder_delivery', 'user_identities', 'identity_invites'])

/**
 * Each user id of the file and the live user of the same member (null: none); null when every id is the same live user,
 * or the file has no users table.
 */
function restoredUserIds(sqlite: SqliteDatabase['sqlite'], source: ReadonlyMap<string, boolean>): Map<number, number | null> | null {
  if (!source.has('users')) return null
  const live = new Map((sqlite.prepare('SELECT id, member FROM main.users').all() as { id: number; member: string }[]).map(u => [u.member, u.id]))
  const map = new Map<number, number | null>()
  let same = true
  for (const u of sqlite.prepare(`SELECT id, member FROM ${SOURCE}.users`).all() as { id: number; member: string }[]) {
    const to = live.get(u.member) ?? null
    map.set(u.id, to)
    if (to !== u.id) same = false
  }
  return same ? null : map
}

/**
 * Replaces every table of the live database but RESTORE_KEEP (and SQLite's own) with the attached upload's rows
 * and journals the restore, in one transaction. Rowids are copied too: change_log.row_id addresses rows by rowid, so the
 * restored journal can still revert its entries. The upload is read with trusted_schema off and may not have generated
 * columns: nothing in its schema runs on the live handle. Synchronous from ATTACH to DETACH: no other request runs in between.
 */
function copyFromUpload(db: SqliteDatabase, file: string, kept: string, actor: Actor, now: Date): void {
  const { sqlite } = db
  const live = tableList(sqlite, 'main')
  const tables = [...live.keys()].filter(t => !/^sqlite_/.test(t) && !RESTORE_KEEP.has(t)).sort()
  const trusted = Number((sqlite.prepare('PRAGMA trusted_schema').get() as { trusted_schema: unknown }).trusted_schema) ? 'ON' : 'OFF'
  sqlite.exec('PRAGMA trusted_schema = OFF')
  try {
    sqlite.prepare(`ATTACH DATABASE ? AS ${SOURCE}`).run(file)
    try {
      const source = tableList(sqlite, SOURCE)
      const columns = new Map<string, string>()
      for (const table of tables) {
        const withoutRowid = live.get(table)
        const liveColumns = names(sqlite.prepare(`PRAGMA main.table_info(${quoteIdent(table)})`).all())
        const sourceColumns = sqlite.prepare(`PRAGMA ${SOURCE}.table_xinfo(${quoteIdent(table)})`).all() as { name: string; hidden: number }[]
        // hidden 2 and 3: generated columns, whose expressions would run on the live handle
        if (!source.has(table) || source.get(table) !== withoutRowid || sourceColumns.some(c => c.hidden === 2 || c.hidden === 3)) throw invalid()
        const present = new Set(sourceColumns.filter(c => c.hidden === 0).map(c => c.name))
        if (liveColumns.some(c => !present.has(c))) throw invalid()
        columns.set(table, [...(withoutRowid ? [] : ['rowid']), ...liveColumns.map(quoteIdent)].join(', '))
      }
      try {
        transaction(sqlite, () => {
          // the live sign-in settings stay: a backup brings back no old password, mode or token
          const liveAuth = sqlite.prepare("SELECT key, value FROM main.app_settings WHERE key LIKE ? ESCAPE '\\'")
            .all(AUTH_LIKE) as { key: string; value: string }[]
          // every row goes first, then every row comes back: a foreign key is checked once, at COMMIT
          sqlite.exec('PRAGMA defer_foreign_keys = ON')
          for (const table of tables) sqlite.exec(`DELETE FROM main.${quoteIdent(table)}`)
          for (const table of tables) {
            const cols = columns.get(table)
            sqlite.exec(`INSERT INTO main.${quoteIdent(table)} (${cols}) SELECT ${cols} FROM ${SOURCE}.${quoteIdent(table)}`)
          }
          // the inserts raised each AUTOINCREMENT counter to the file's largest row; the file's own counter may be higher
          // (its last rows deleted): an id it had used, still named in its journal, must not be given again
          const raise = sqlite.prepare(`INSERT INTO main.sqlite_sequence (name, seq) SELECT name, seq FROM ${SOURCE}.sqlite_sequence s WHERE s.name = ?
            AND NOT EXISTS (SELECT 1 FROM main.sqlite_sequence WHERE name = s.name)`)
          const lift = sqlite.prepare(`UPDATE main.sqlite_sequence SET seq = MAX(seq, (SELECT seq FROM ${SOURCE}.sqlite_sequence s WHERE s.name = ?)) WHERE name = ?
            AND EXISTS (SELECT 1 FROM ${SOURCE}.sqlite_sequence s WHERE s.name = ?)`)
          for (const table of tables) { lift.run(table, table, table); raise.run(table) }
          sqlite.prepare("DELETE FROM main.app_settings WHERE key LIKE ? ESCAPE '\\'").run(AUTH_LIKE)
          const putAuth = sqlite.prepare('INSERT INTO main.app_settings (key, value) VALUES (?, ?)')
          for (const row of liveAuth) putAuth.run(row.key, row.value)
          // a user's member that the file lacks is back, so the user still points to a member
          sqlite.exec('INSERT OR IGNORE INTO main.members (name) SELECT member FROM main.users')
          // the live users stay: rows the file names by its own user ids (the council's) follow the member instead
          const userIds = restoredUserIds(sqlite, source)
          if (userIds) for (const module of serverModules({ demo: false })) module.remapRestoredUsers?.(sqlite, userIds)
          sqlite.prepare(`${CHANGE_LOG_INSERT} VALUES (?, ?, ?, '*', 0, 'restore', NULL, ?, NULL)`)
            .run(now.toISOString(), actor.name, actor.source, JSON.stringify({ kept }))
          // A restored journal is a new notification baseline, never a queue of old family events.
          sqlite.exec('UPDATE main.family_telegram_groups SET proposal_cursor = (SELECT COALESCE(MAX(id), 0) FROM main.change_log)')
          })
      } catch (err) {
        // the upload's rows do not fit the live tables (a hand-edited file)
        if (isConstraint(err)) throw invalid()
        throw err
      }
    } finally {
      try { sqlite.exec(`DETACH DATABASE ${SOURCE}`) } catch (err) {
        console.error('[restore] detach failed:', err instanceof Error ? err.message : String(err))
      }
    }
  } finally {
    sqlite.exec(`PRAGMA trusted_schema = ${trusted}`)
  }
}

/**
 * The upload in a temporary folder (the caller removes `dir`), checked by prepareUpload; `backup_invalid` 400
 * without the SQLite header. The folder is removed again when the check fails.
 */
async function stageUpload(bytes: Uint8Array, schemaFile: string): Promise<{ dir: string; file: string }> {
  if (bytes.length < SQLITE_HEADER.length || SQLITE_HEADER.some((b, i) => bytes[i] !== b)) throw invalid()
  const dir = await mkdtemp(join(tmpdir(), 'finance-restore-'))
  const file = join(dir, 'upload.sqlite')
  try {
    await writeFile(file, bytes)
    prepareUpload(file, schemaFile)
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
  return { dir, file }
}

/**
 * Replaces all the family's data with a backup file made by "Download database copy". The upload is written to a temporary
 * folder, checked (`backup_invalid` 400: not an intact Monido database; `backup_newer` 409: made by a newer app).
 * The live database is kept as DATA_DIR/before-restore-YYYYMMDD-HHMMSS.sqlite; then its tables take the
 * upload's rows in one transaction, with one journal entry (op 'restore'). On any failure the live database is unchanged,
 * the kept copy is removed again, and the temporary folder is always removed. Returns the kept copy's file name.
 */
export async function restoreBackup(
  db: SqliteDatabase, bytes: Uint8Array,
  { schemaFile, dataDir, actor, now }: { schemaFile: string; dataDir: string; actor: Actor; now: Date },
): Promise<{ kept: string }> {
  const { dir, file } = await stageUpload(bytes, schemaFile)
  try {
    const kept = keptName(now)
    const keptPath = join(dataDir, kept)
    // a restore in the same second: never touch the file another restore kept
    if (existsSync(keptPath)) throw new Error(`${kept} already exists`)
    // from here to the end of the copy nothing awaits: no other request touches the database in between
    try {
      db.sqlite.prepare('VACUUM INTO ?').run(keptPath)
      copyFromUpload(db, file, kept, actor, now)
    } catch (err) {
      // nothing changed: a copy of the unchanged database (or a part of one, if VACUUM INTO failed) is not needed
      await rm(keptPath, { force: true }).catch(() => {})
      throw err
    }
    return { kept }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Verify the entire restore against an isolated copy, including live constraints, without writing to the live database. */
export async function previewBackup(db: SqliteDatabase, bytes: Uint8Array, schemaFile: string) {
  const { dir, file } = await stageUpload(bytes, schemaFile)
  try {
    const target = join(dir, 'verify.sqlite')
    db.sqlite.prepare('VACUUM INTO ?').run(target)
    const copy = openDatabase(target)
    try {
      copyFromUpload(copy, file, '', { name: 'preview', source: 'admin', userId: null, rights: { edit: true, vote: true, manage: true } }, new Date())
      const lastPeriod = copy.sqlite.prepare('SELECT MAX(date) AS date FROM (SELECT date FROM assets UNION ALL SELECT date FROM monthly_cashflow)').get()!.date
      const accounts = copy.sqlite.prepare("SELECT COUNT(*) AS n FROM (SELECT DISTINCT name, COALESCE(member, '') FROM assets)").get()!.n
      const goals = copy.sqlite.prepare('SELECT COUNT(*) AS n FROM goals').get()!.n
      return { lastPeriod: lastPeriod === null ? null : String(lastPeriod), accounts: Number(accounts), goals: Number(goals) }
    } finally { copy.close() }
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}) }
}

const KEPT_NAME = /^before-restore-\d{8}-\d{6}\.sqlite$/

/** The journal is committed with the data, so this result survives reloads and server restarts. */
export function restoreResult(db: SqliteDatabase) {
  const row = db.sqlite.prepare("SELECT ts, after_json FROM change_log WHERE op = 'restore' ORDER BY id DESC LIMIT 1").get()
  if (!row) return { result: null }
  try {
    const { kept } = JSON.parse(String(row.after_json)) as { kept?: unknown }
    if (typeof kept === 'string' && KEPT_NAME.test(kept)) return { result: { kept, restoredAt: String(row.ts) } }
  } catch { /* an imported journal can contain malformed metadata */ }
  return { result: null }
}

/** Only exact kept-copy filenames, opened without following symlinks; stream the already checked handle. */
export async function downloadKeptBackup(dataDir: string, name: string): Promise<Response> {
  if (!KEPT_NAME.test(name)) throw new InputError('not_found', 404)
  let file
  try { file = await open(join(dataDir, name), constants.O_RDONLY | constants.O_NOFOLLOW) }
  catch { throw new InputError('not_found', 404) }
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new InputError('not_found', 404)
    return attachment(Readable.toWeb(file.createReadStream()) as ReadableStream, { type: 'application/vnd.sqlite3', length: stat.size, filename: name })
  } catch (err) { await file.close(); throw err }
}
