import { describe, expect, it } from 'vitest'
import { buildFamily, DEMO_FAMILIES } from '../../src/demo/family'
import { writeFamily } from '../../src/server/demo/writeFamily'
import { clearFamilyTables } from '../../src/server/tables'
import { createTestDb } from '../helpers/db'

function cleared(keep: string[], opts?: { keepCurrency?: string }) {
  const db = createTestDb()
  writeFamily(db.sqlite, buildFamily({ today: '2031-10-19' }))
  db.sqlite.exec('BEGIN')
  const emptied = clearFamilyTables(db.sqlite, keep, opts)
  db.sqlite.exec('COMMIT')
  return { db, emptied }
}

describe('clearFamilyTables', () => {
  it("empties everything but the keep-list, keeps the reserved category, the users' members and the family currency", () => {
    const { db, emptied } = cleared(['schema_migrations', 'app_settings', 'users'], { keepCurrency: 'USD' })
    expect(emptied).not.toContain('users')
    expect(emptied).toContain('assets')
    expect(db.sqlite.prepare('SELECT name FROM members ORDER BY name').all().map(r => r.name)).toEqual([...DEMO_FAMILIES['en-US'].members].sort())
    expect(db.sqlite.prepare('SELECT code, inflation FROM currencies').all()).toEqual([{ code: 'USD', inflation: 0 }])
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM spending_categories WHERE kind = 'loan_payment'").get()).toEqual({ n: 1 })
  })

  it('without users in the keep-list every member goes; without keepCurrency every currency goes', () => {
    const { db } = cleared(['schema_migrations', 'app_settings'])
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM members').get()).toEqual({ n: 0 })
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM currencies').get()).toEqual({ n: 0 })
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 })
  })
})
