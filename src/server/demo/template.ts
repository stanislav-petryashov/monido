// The demo's template database: a fresh initialized file holding the fictional family of the given day.
// Sandboxes are file copies of it, so it is built beside them and swapped in with one rename.
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { buildFamily } from '../../demo/family'
import { DEFAULT_DECIDE_DAYS, DEFAULT_REMIND_DAYS } from '../../domain/proposals'
import { openDatabase } from '../db'
import { initializeSchema } from '../schema'
import { writeFamily } from './writeFamily'

/** Removes an SQLite file together with its WAL and shared-memory files. */
export function removeDatabaseFile(file: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(file + suffix, { force: true })
}

/** The demo never talks to Telegram: no linked chat, no pending pairing code, the council's days back to the defaults. */
export function resetTelegramForDemo(sqlite: DatabaseSync): void {
  sqlite.exec('UPDATE reminder_settings SET enabled = 0, chat_id = NULL, chat_title = NULL, pairing_hash = NULL, pairing_expires_at = NULL, last_sent_at = NULL, last_error = NULL')
  sqlite.prepare('UPDATE advisor_settings SET decide_days = ?, remind_days = ?').run(DEFAULT_DECIDE_DAYS, DEFAULT_REMIND_DAYS)
}

/**
 * Builds dir/template.tmp (schema initialization, then buildFamily({ today })) and renames it to dir/template.sqlite, which it returns.
 * The rename replaces the previous template in one step: a copy taken meanwhile gets the old or the new file, never a half.
 */
export function buildTemplate({ dir, schemaFile, today }: { dir: string; schemaFile: string; today: string }): string {
  mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, 'template.tmp')
  const target = path.join(dir, 'template.sqlite')
  removeDatabaseFile(tmp)
  const db = openDatabase(tmp)
  try {
    initializeSchema(db, schemaFile)
    writeFamily(db.sqlite, buildFamily({ today }))
    resetTelegramForDemo(db.sqlite)
    // back to a rollback journal: the WAL is folded into the file, so a plain file copy is the whole database
    db.sqlite.exec('PRAGMA journal_mode = DELETE')
  } catch (error) {
    db.close()
    removeDatabaseFile(tmp)
    throw error
  }
  db.close()
  renameSync(tmp, target)
  return target
}
