import { revertChange } from '../../src/server/rows'
import { DATA_TABLES, isRevertibleTable } from '../../src/domain/journal'
import { createTestDb } from '../helpers/db'

// The journal page offers "Revert" by isRevertibleTable; the server puts back by the same predicate: the two cannot drift.
const actor = { name: 'owner@example.com', source: 'admin' as const, rights: { edit: true, vote: true, manage: true }, userId: null }

function logEntry(db: ReturnType<typeof createTestDb>, table: string): number {
  const { id } = db.sqlite.prepare(`INSERT INTO change_log (ts, actor, source, table_name, row_id, op, before_json, after_json)
    VALUES ('2031-04-09T08:00:00Z', 'me', 'admin', ?, 1, 'delete', '{"id":1}', NULL) RETURNING id`).get(table) as { id: number }
  return id
}

describe('the tables a journal entry can be reverted in', () => {
  it('the server refuses a revert in every table the journal page offers no “Revert” for: an old module switch too (409 not_revertible)', async () => {
    const db = createTestDb()
    for (const table of ['modules', 'reminder_settings']) {
      expect(isRevertibleTable(table), table).toBe(false)
      await expect(revertChange(db, logEntry(db, table), actor), table).rejects.toMatchObject({ code: 'not_revertible', status: 409 })
    }
  })

  it('every Data-section table and the family settings are revertible', () => {
    for (const table of [...DATA_TABLES, 'app_settings']) expect(isRevertibleTable(table), table).toBe(true)
    expect(isRevertibleTable('flow_lines')).toBe(true)
  })
})
