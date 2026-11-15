import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { openDatabase } from '../../src/server/db'
import { initializeSchema } from '../../src/server/schema'
import { SCHEMA_FILE } from '../helpers/db'
import { withTempDirs } from '../helpers/tmp'

const tempDir = withTempDirs('seed-script-')

describe('npm run db:seed', () => {
  it('seeds a current database that can be reopened without schema changes', () => {
    const dataDir = tempDir()
    const db = openDatabase(join(dataDir, 'finance.sqlite'))
    try { initializeSchema(db, SCHEMA_FILE) } finally { db.close() }
    execFileSync('node', ['--import', 'tsx', 'scripts/seed.ts', '--reset-demo'], { env: { ...process.env, DATA_DIR: dataDir }, stdio: 'pipe' })
    const seeded = openDatabase(join(dataDir, 'finance.sqlite'))
    try {
      initializeSchema(seeded, SCHEMA_FILE)
      expect(Number(seeded.sqlite.prepare('SELECT count(*) AS n FROM assets').get()!.n)).toBeGreaterThan(0)
    } finally { seeded.close() }
  }, 60_000)
})
