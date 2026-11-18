import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { isoDate } from '../domain/dates'
import type { SqliteDatabase } from './db'
import { attachment, InputError } from './http'

/** Name of the copy: finance-YYYY-MM-DD.sqlite (UTC date). */
function backupFilename(now: Date): string {
  return `finance-${isoDate(now)}.sqlite`
}

/**
 * The database copy as one file to download. `VACUUM INTO` writes a consistent snapshot while running
 * and does not depend on WAL or Docker Desktop shared folders; the temporary folder is removed when the stream closes,
 * so the body must be read: the route answers HEAD with 405 instead of making a copy nobody reads.
 */
/** The databases with a download under way: each holds a whole copy in the temporary folder (a tmpfs in the image: RAM) */
const exporting = new WeakSet<SqliteDatabase>()

export async function exportBackup(db: SqliteDatabase, now = new Date()): Promise<Response> {
  // one at a time: downloads left hanging would each keep a copy of the database in memory
  if (exporting.has(db)) throw new InputError('backup_in_progress', 409)
  exporting.add(db)
  const dir = await mkdtemp(join(tmpdir(), 'finance-backup-')).catch(err => { exporting.delete(db); throw err })
  const name = backupFilename(now)
  const file = join(dir, name)
  const cleanup = () => { exporting.delete(db); return rm(dir, { recursive: true, force: true }).catch(() => {}) }
  try {
    db.sqlite.prepare('VACUUM INTO ?').run(file)
    const { size } = await stat(file)
    const stream = createReadStream(file)
    stream.once('close', () => { void cleanup() })
    return attachment(Readable.toWeb(stream) as ReadableStream, { type: 'application/vnd.sqlite3', length: size, filename: name })
  } catch (err) {
    await cleanup()
    throw err
  }
}
