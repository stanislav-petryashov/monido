// A database made by every released schema (tests/fixtures/releases, one per schema) upgrades to the current one, data intact.
import { describe, expect, it, onTestFinished } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openDatabase, type SqliteDatabase } from '../../src/server/db'
import { initializeSchema, SCHEMA_VERSION, validateSchema } from '../../src/server/schema'
import { getSnapshot } from '../../src/server/snapshot'
import { withTempDirs } from '../helpers/tmp'

const schemaFile = resolve('schema.sql')
const fixturesDir = resolve('tests/fixtures/releases')
const fixtures = readdirSync(fixturesDir).filter(f => f.endsWith('.sql')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
const tempDir = withTempDirs('release-upgrade-')

const version = (sql: string) => Number(/PRAGMA user_version = (\d+);/.exec(sql)![1])
const all = (db: SqliteDatabase, sql: string) => db.sqlite.prepare(sql).all()
/** Rows of every table but SQLite's own; account_closures counts as the account_closings step 3 fills from it */
function counts(db: SqliteDatabase): Record<string, number> {
  const tables = all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map(r => String(r.name))
  return Object.fromEntries(tables.map(t => [t === 'account_closures' ? 'account_closings' : t, Number(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get()!.n)]))
}

describe('databases of released versions', () => {
  it('a fixture of the current schema exists: a schema change adds its fixture (tests/fixtures/releases/README.md)', () => {
    expect(Math.max(...fixtures.map(f => version(readFileSync(join(fixturesDir, f), 'utf8'))))).toBe(SCHEMA_VERSION)
  })

  it.each(fixtures)('%s upgrades to the current schema with its family intact', async fixture => {
    const sql = readFileSync(join(fixturesDir, fixture), 'utf8')
    const dir = tempDir()
    const db = openDatabase(join(dir, 'finance.sqlite'))
    onTestFinished(() => db.close())
    db.sqlite.exec(sql)
    const before = counts(db)

    // what the server and the MCP connector do at start
    initializeSchema(db, schemaFile, dir)
    validateSchema(db, schemaFile)
    expect(db.sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(readdirSync(dir).some(f => f.startsWith('before-upgrade-'))).toBe(version(sql) !== SCHEMA_VERSION)
    expect(counts(db)).toMatchObject(before)
    // nothing but the tables the steps add is new, and those of an older release are empty
    const added = Object.entries(counts(db)).filter(([t]) => !(t in before))
    expect(added.every(([, n]) => n === 0)).toBe(true)

    expect(all(db, "SELECT name, value, currency FROM assets WHERE date = '2026-03-31' ORDER BY name"))
      .toEqual([{ name: 'Brokerage', value: 8500, currency: 'EUR' }, { name: 'Checking', value: 12000, currency: 'USD' }])
    expect(all(db, "SELECT amount, currency FROM loan_payments WHERE date = '2026-02-01' AND loan_name = 'Mortgage'")).toEqual([{ amount: 859.72, currency: 'USD' }])
    expect(all(db, "SELECT c.name, s.source, s.amount FROM category_spending s JOIN spending_categories c ON c.id = s.category_id WHERE s.date = '2026-03-01' ORDER BY c.id"))
      .toEqual([{ name: 'loan_payments', source: 'Checking', amount: 859.72 }, { name: 'Groceries', source: 'Checking', amount: 900 }])
    expect(all(db, 'SELECT month, closed_by FROM closed_months ORDER BY month').map(r => r.month)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(all(db, 'SELECT name, member, closed_month FROM account_closings')).toEqual([{ name: 'Old card', member: 'Robin', closed_month: '2026-01' }])
    expect(all(db, 'SELECT member, email, telegram_id, can_edit, can_vote, can_manage FROM users ORDER BY id')).toEqual([
      { member: 'Robin', email: 'robin@example.test', telegram_id: null, can_edit: 1, can_vote: 1, can_manage: 1 },
      { member: 'Noa', email: null, telegram_id: '1002', can_edit: 0, can_vote: 1, can_manage: 0 },
    ])
    expect(all(db, 'SELECT status FROM proposals')).toEqual([{ status: 'accepted' }])
    if (version(sql) === 0) expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 31 })

    const snapshot = await getSnapshot(db, { now: new Date('2026-04-10T12:00:00Z'), download: false })
    expect(snapshot.asOf.closedMonth).toBe('2026-03')
    // Checking 12 000 USD + Brokerage 8 500 EUR at 0.91 + the flat 180 000 USD; the mortgage after its early payment
    expect(snapshot.capital).toMatchObject({ assets: 201340.66, liabilities: 107787.06, netWorth: 93553.6 })
  })
})
