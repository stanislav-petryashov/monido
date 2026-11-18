import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, type AppConfig } from '../../src/server/config'
import { openDatabase, type SqliteDatabase } from '../../src/server/db'

/** The current schema used by production and tests. */
export const SCHEMA_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../schema.sql')

export type TestDb = SqliteDatabase

/** An in-memory database with the current schema. */
export function createTestDb(): TestDb {
  const db = openDatabase(':memory:')
  db.sqlite.exec(readFileSync(SCHEMA_FILE, 'utf8'))
  return db
}

/** Marks every month with data as closed, for fixtures representing history entered before the wizard. */
export function closeHistory(db: TestDb): void {
  db.sqlite.exec(`
    INSERT OR IGNORE INTO closed_months (month, closed_at, closed_by)
    SELECT DISTINCT substr(date, 1, 7), 't', 'migration' FROM assets
    UNION SELECT DISTINCT substr(date, 1, 7), 't', 'migration' FROM monthly_cashflow
  `)
}

/** Explicit test auth fixtures are kept outside production environment parsing. */
export type TestConfig = AppConfig & { testAuth?: { mode?: string; password?: string } }
export function testConfig(options: Record<string, string> = {}, sessionSecret = 'test'): TestConfig {
  const { mode, password, ...env } = options
  return { ...loadConfig(env), sessionSecret, testAuth: { mode, password } }
}

/** SQL that turns a database made from schema.sql back into what version 2 left (step 3 undone): closures by account */
export const BACK_TO_V2 = `DROP TABLE account_closings;
CREATE TABLE account_closures (
  name         TEXT NOT NULL,
  member       TEXT NOT NULL,
  closed_month TEXT NOT NULL,
  PRIMARY KEY (name, member)
);
PRAGMA user_version = 2;`

/** The same back to version 1 (steps 2 and 3 undone) */
export const BACK_TO_V1 = `${BACK_TO_V2}
DROP TABLE account_transfers;
PRAGMA user_version = 1;`
