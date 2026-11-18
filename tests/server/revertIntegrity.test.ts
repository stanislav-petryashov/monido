// "Change history" → Revert never leaves a record split or a link dangling: a compound rename is put back on its own
// screen, and a revert runs the modules' checks as a rows-API write would.
import { afterEach, describe, expect, it } from 'vitest'
import { insertRow, revertChange, updateRow } from '../../src/server/rows'
import { updateLoan } from '../../src/modules/loans/operations'
import { updateAccount } from '../../src/server/accountOperations'
import { createTestDb, type TestDb } from '../helpers/db'
import type { Actor } from '../../src/server/http'

const actor: Actor = { name: 'a', source: 'admin', userId: null, rights: { edit: true, vote: true, manage: true } }
const loan = { name: 'Car', issue_date: '2024-01-01', principal: 12000, rate: 5, term_months: 36, monthly_payment: 360, currency: 'USD', member: 'Robin' }

const opened: TestDb[] = []
afterEach(() => { opened.splice(0).forEach(db => db.close()) })
function setup() {
  const db = createTestDb()
  opened.push(db)
  db.sqlite.exec("INSERT OR IGNORE INTO members (name) VALUES ('Robin')")
  const all = (sql: string) => db.sqlite.prepare(sql).all()
  const lastId = (where: string) => (db.sqlite.prepare(`SELECT id FROM change_log WHERE ${where} ORDER BY id DESC LIMIT 1`).get() as { id: number }).id
  const refusal = async (id: number) => revertChange(db, id, actor).then(() => 'reverted', (e: { code?: string }) => e.code)
  return { db, all, lastId, refusal }
}

describe('revert keeps records whole', () => {
  it('one line of a loan rename is refused: the loan, its early payments and payments keep one name', async () => {
    const { db, all, lastId, refusal } = setup()
    await insertRow(db, 'loans', loan, actor)
    await insertRow(db, 'loan_early_payments', { loan_name: 'Car', payment_date: '2024-06-10', amount: 500, strategy: 'reduce_term' }, actor)
    db.sqlite.exec("INSERT INTO loan_payments (date, loan_name, amount, currency) VALUES ('2024-02-01', 'Car', 360, 'USD')")
    await updateLoan(db, actor, 1, { expectedName: 'Car', name: 'Auto' })
    expect(await refusal(lastId("table_name = 'loans' AND op = 'update'"))).toBe('loan_by_route')
    expect(await refusal(lastId("table_name = 'loan_early_payments' AND op = 'update'"))).toBe('invalid_value')
    expect(all('SELECT name FROM loans')).toEqual([{ name: 'Auto' }])
    expect(all('SELECT loan_name FROM loan_early_payments')).toEqual([{ loan_name: 'Auto' }])
    expect(all('SELECT loan_name FROM loan_payments')).toEqual([{ loan_name: 'Auto' }])
  })

  it('one balance of an account rename is refused while the account has other rows; the last one goes back', async () => {
    const { db, all, lastId, refusal } = setup()
    for (const date of ['2025-01-31', '2025-02-28']) await insertRow(db, 'assets', { date, name: 'Bank', member: 'Robin', value: 100, currency: 'USD', class: 'bank' }, actor)
    await insertRow(db, 'monthly_cashflow', { date: '2025-01-01', bank: 'Bank', member: 'Robin', active_income: 10, passive_income: 0, expense: 5, currency: 'USD' }, actor)
    await updateAccount(db, actor, { from: { name: 'Bank', member: 'Robin' }, values: { name: 'Bank2', member: 'Robin', currency: 'USD', class: 'bank' } })
    expect(await refusal(lastId("table_name = 'assets' AND op = 'update'"))).toBe('account_by_route')
    expect(all('SELECT DISTINCT name FROM assets')).toEqual([{ name: 'Bank2' }])
    expect(all('SELECT bank FROM monthly_cashflow')).toEqual([{ bank: 'Bank2' }])
  })

  it('a balance renamed alone on Records goes back alone', async () => {
    const { db, all, lastId, refusal } = setup()
    await insertRow(db, 'assets', { date: '2025-01-31', name: 'Bank', member: 'Robin', value: 100, currency: 'USD', class: 'bank' }, actor)
    await updateRow(db, 'assets', 1, { name: 'Typo' }, actor)
    expect(await refusal(lastId("table_name = 'assets' AND op = 'update'"))).toBe('reverted')
    expect(all('SELECT name FROM assets')).toEqual([{ name: 'Bank' }])
  })
})

describe('revert runs the modules\' checks', () => {
  it('undoing a loan insert is refused like its delete: its early payments would be left behind', async () => {
    const { db, all, lastId, refusal } = setup()
    await insertRow(db, 'loans', loan, actor)
    await insertRow(db, 'loan_early_payments', { loan_name: 'Car', payment_date: '2024-06-10', amount: 500, strategy: 'reduce_term' }, actor)
    expect(await refusal(lastId("table_name = 'loans' AND op = 'insert'"))).toBe('loan_by_route')
    expect(all('SELECT name FROM loans')).toEqual([{ name: 'Car' }])
  })

  it('undoing the insert of a property\'s only valuation is refused like its delete: a loan it secures would dangle', async () => {
    const { db, all, lastId, refusal } = setup()
    await insertRow(db, 'real_estate', { name: 'House', purchase_date: '2022-09-15', purchase_price: 520000, purchase_currency: 'USD', valuation_year: 2022, value: 520000, currency: 'USD' }, actor)
    await insertRow(db, 'loans', { ...loan, secured_by: 'House' }, actor)
    expect(await refusal(lastId("table_name = 'real_estate' AND op = 'insert'"))).toBe('last_valuation')
    expect(all('SELECT name, secured_by FROM loans')).toEqual([{ name: 'Car', secured_by: 'House' }])
  })

  it('undoing a cash-flow edit is refused when the old total is below the lines filed since', async () => {
    const { db, all, lastId, refusal } = setup()
    await insertRow(db, 'monthly_cashflow', { date: '2025-01-01', bank: 'Bank', member: 'Robin', active_income: 10, passive_income: 0, expense: 100, currency: 'USD' }, actor)
    await updateRow(db, 'monthly_cashflow', 1, { expense: 500 }, actor)
    db.sqlite.exec("INSERT INTO spending_categories (name, kind) VALUES ('Food', 'mandatory'); INSERT INTO flow_lines (date, bank, member, category_id, amount) SELECT '2025-01-01', 'Bank', 'Robin', id, 400 FROM spending_categories WHERE name = 'Food'")
    expect(await refusal(lastId("table_name = 'monthly_cashflow' AND op = 'update'"))).toBe('lines_exceed_total')
    expect(all('SELECT expense FROM monthly_cashflow')).toEqual([{ expense: 500 }])
  })
})
