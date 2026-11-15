import { describe, expect, it } from 'vitest'
import type { Actor } from '../../../src/server/http'
import { insertRow, updateRow } from '../../../src/server/rows'
import { createTestDb } from '../../helpers/db'

const actor: Actor = { name: 'owner@example.com', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null }

/** May's cash-flow row of Bank A (rowid 1) with 800 of its 1000 active income and 50 of its 200 expenses allocated. */
function withLines() {
  const db = createTestDb()
  db.sqlite.exec(`
    INSERT INTO spending_categories (name, flow) VALUES ('Salary', 'active');
    INSERT INTO spending_categories (name, kind) VALUES ('Food', 'mandatory');
    INSERT INTO monthly_cashflow (date, bank, member, active_income, passive_income, expense, currency) VALUES ('2031-05-01', 'Bank A', 'Robin', 1000, 0, 200, 'USD');
    INSERT INTO flow_lines (date, bank, member, category_id, amount) VALUES ('2031-05-01', 'Bank A', 'Robin', 2, 800), ('2031-05-01', 'Bank A', 'Robin', 3, 50);
  `)
  return db
}
const row = { date: '2031-05-01', bank: 'Bank A', member: 'Robin', active_income: 1000, passive_income: 0, expense: 200, currency: 'USD' }
const totals = (db: ReturnType<typeof createTestDb>) => db.sqlite.prepare('SELECT bank, active_income, expense FROM monthly_cashflow ORDER BY rowid').all()

describe('the Cash flow row check', () => {
  it('refuses an update that drops a total below its lines, naming the flow and both sums', async () => {
    const db = withLines()
    await expect(updateRow(db, 'monthly_cashflow', 1, { active_income: 700 }, actor))
      .rejects.toMatchObject({ status: 409, code: 'lines_exceed_total', params: { flow: 'active', lines: 800, total: 700 } })
    await expect(updateRow(db, 'monthly_cashflow', 1, { expense: '49.99' }, actor))
      .rejects.toMatchObject({ status: 409, code: 'lines_exceed_total', params: { flow: 'expense', lines: 50, total: 49.99 } })
    await updateRow(db, 'monthly_cashflow', 1, { active_income: 800, expense: 50 }, actor)
    expect(totals(db)).toEqual([{ bank: 'Bank A', active_income: 800, expense: 50 }])
  })

  it('refuses an insert that would replace the row with a smaller total', async () => {
    const db = withLines()
    await expect(insertRow(db, 'monthly_cashflow', { ...row, active_income: 500 }, actor)).rejects.toMatchObject({ code: 'lines_exceed_total' })
    await insertRow(db, 'monthly_cashflow', { ...row, bank: 'Bank B', active_income: 0, expense: 0 }, actor)
    expect(totals(db)).toEqual([{ bank: 'Bank A', active_income: 1000, expense: 200 }, { bank: 'Bank B', active_income: 0, expense: 0 }])
  })

  it('does not refuse a rename: the lines are under the old key until the rename hook moves them', async () => {
    const db = withLines()
    await updateRow(db, 'monthly_cashflow', 1, { bank: 'Bank C', active_income: 100 }, actor)
    expect(totals(db)).toEqual([{ bank: 'Bank C', active_income: 100, expense: 200 }])
  })
})
