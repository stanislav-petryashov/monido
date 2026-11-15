import { describe, expect, it, vi } from 'vitest'
import { InputError, requireRight, type Actor } from '../../src/server/http'
import { buildDeleteRow, buildInsertRow, buildUpdateRow, deleteRow, insertRow, insertStatement, logStatement, nextRowid, revertChange, tableColumns, updateRow, validateRow } from '../../src/server/rows'
import { commitMutation } from '../../src/server/mutations'
import { createTestDb, type TestDb } from '../helpers/db'

const actor: Actor = { name: 'owner@example.com', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null }
const log = (db: TestDb) => db.sqlite.prepare('SELECT * FROM change_log ORDER BY id').all() as Record<string, unknown>[]
/** A database with the loans the early payments below belong to (an early payment of no loan is refused) */
const withLoans = (db: TestDb) => {
  db.sqlite.exec(`INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, currency, member) VALUES
    ('Mortgage', '2024-01-01', 1200, 0, 120, 10, 'USD', 'Robin'), ('Old loan', '2024-01-01', 1200, 0, 12, 100, 'USD', 'Robin'), ('New loan', '2024-01-01', 1200, 0, 12, 100, 'USD', 'Robin')`)
  return db
}

describe('requireRight', () => {
  it('throws a 403 no_right_<right> for a right the actor lacks, passes for one they have', () => {
    const limited: Actor = { ...actor, rights: { edit: false, vote: true, manage: false } }
    expect(() => requireRight(limited, 'edit')).toThrowError(expect.objectContaining({ status: 403, code: 'no_right_edit' }))
    expect(() => requireRight(limited, 'vote')).not.toThrow()
  })
})

describe('validateRow', () => {
  const columns = [
    { name: 'key', type: 'TEXT', notnull: 0, pk: 1 },
    { name: 'value', type: 'REAL', notnull: 1, pk: 0 },
  ]
  it('rejects bad input the way the admin API always has, naming the column', () => {
    const refusal = (body: unknown) => { try { validateRow(columns, body); return null } catch (e) { return e } }
    expect(refusal(null)).toMatchObject({ status: 400, code: 'expected_object' })
    expect(refusal({})).toMatchObject({ code: 'no_valid_columns' })
    expect(refusal({ nope: 1 })).toMatchObject({ code: 'unknown_column', params: { column: 'nope' } })
    expect(refusal({ value: null })).toMatchObject({ code: 'required_field', params: { column: 'value' } })
    expect(refusal({ value: 'x' })).toMatchObject({ code: 'expected_number', params: { column: 'value' } })
    expect(refusal({ value: {} })).toMatchObject({ code: 'invalid_value', params: { column: 'value' } })
    expect(refusal({ value: '  ' })).toMatchObject({ code: 'expected_number', params: { column: 'value' } })
    expect(validateRow(columns, { rowid: 5, value: 2 })).toEqual({ value: 2 })
  })

  it('refuses an empty date for a required date column, keeps it for an optional one', () => {
    const dated = [
      { name: 'day', type: 'DATE', notnull: 0, pk: 1 },
      { name: 'issue_date', type: 'DATE', notnull: 1, pk: 0 },
      { name: 'closed_date', type: 'DATE', notnull: 0, pk: 0 },
    ]
    const refusal = (body: unknown) => { try { validateRow(dated, body); return null } catch (e) { return e } }
    expect(refusal({ issue_date: '' })).toMatchObject({ status: 400, code: 'required_field', params: { column: 'issue_date' } })
    expect(refusal({ day: '' })).toMatchObject({ code: 'required_field', params: { column: 'day' } })
    expect(validateRow(dated, { closed_date: '', issue_date: '2014-03-15' })).toEqual({ closed_date: '', issue_date: '2014-03-15' })
  })

  it('refuses a date that is not a real calendar day', () => {
    const dated = [{ name: 'closed_date', type: 'DATE', notnull: 0, pk: 0 }]
    const refusal = (body: unknown) => { try { validateRow(dated, body); return null } catch (e) { return e } }
    for (const bad of ['2026-02-30', '2026-13-01', '15.03.2014', '2014-03', 20140315])
      expect(refusal({ closed_date: bad })).toMatchObject({ status: 400, code: 'invalid_value', params: { column: 'closed_date' } })
  })
})

describe('insertRow / updateRow / deleteRow', () => {
  it('logs an insert with the stored row as after_json', async () => {
    const db = createTestDb()
    const row = await insertRow(db, 'parameters', { key: 'inflation_rate', value: 9 }, actor)
    expect(row).toMatchObject({ key: 'inflation_rate', value: 9 })
    expect(log(db)).toEqual([expect.objectContaining({
      actor: 'owner@example.com', source: 'admin', table_name: 'parameters', row_id: row.rowid,
      op: 'insert', before_json: null, reverts_id: null,
    })])
    expect(JSON.parse(String(log(db)[0].after_json))).toEqual({ key: 'inflation_rate', value: 9, description: null })
  })

  it('logs the replaced cash-flow row when a month is saved again', async () => {
    const db = createTestDb()
    const month = { date: '2031-08-01', bank: 'Quillmark Bank', member: 'Robin', currency: 'RUB' }
    await insertRow(db, 'monthly_cashflow', { ...month, active_income: 100, passive_income: 0, expense: 50 }, actor)
    await insertRow(db, 'monthly_cashflow', { ...month, active_income: 200, passive_income: 0, expense: 70 }, actor)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM monthly_cashflow').get()).toEqual({ n: 1 })
    expect(JSON.parse(String(log(db)[1].before_json))).toMatchObject({ active_income: 100, expense: 50 })
  })

  it('uses the INTEGER PRIMARY KEY as the row id', async () => {
    const db = withLoans(createTestDb())
    const ep = await insertRow(db, 'loan_early_payments', { loan_name: 'Mortgage', payment_date: '2031-08-15', amount: 1000, strategy: 'reduce_term' }, actor)
    // SQLite reports `SELECT *, rowid` of such a table under the alias name only.
    expect(ep.id).toBe(1)
    expect(log(db)[0].row_id).toBe(1)
  })

  it('logs updates with before and after, and deletes with before', async () => {
    const db = createTestDb()
    const row = await insertRow(db, 'parameters', { key: 'k', value: 1 }, actor)
    await updateRow(db, 'parameters', Number(row.rowid), { value: 2 }, actor)
    await deleteRow(db, 'parameters', Number(row.rowid), actor)
    const [, update, del] = log(db)
    expect(update).toMatchObject({ op: 'update' })
    expect(JSON.parse(String(update.before_json))).toMatchObject({ value: 1 })
    expect(JSON.parse(String(update.after_json))).toMatchObject({ value: 2 })
    expect(del).toMatchObject({ op: 'delete', after_json: null })
    expect(JSON.parse(String(del.before_json))).toMatchObject({ key: 'k', value: 2 })
  })

  it('reports missing rows as 404', async () => {
    const db = createTestDb()
    await expect(updateRow(db, 'parameters', 99, { value: 1 }, actor)).rejects.toMatchObject({ status: 404 })
    await expect(deleteRow(db, 'parameters', 99, actor)).rejects.toBeInstanceOf(InputError)
  })

  it('refuses to write read-only tables', async () => {
    const db = createTestDb()
    const entry = { ts: 't', actor: 'a', source: 'admin', table_name: 'parameters', row_id: 1, op: 'insert' }
    await expect(insertRow(db, 'change_log', entry, actor)).rejects.toMatchObject({ status: 403 })
    db.sqlite.exec("INSERT INTO fx_rates VALUES ('2031-08-31', 'RUB', 90, '2031-08-29')")
    await expect(updateRow(db, 'fx_rates', 1, { per_usd: 1 }, actor)).rejects.toMatchObject({ status: 403 })
    await expect(deleteRow(db, 'fx_rates', 1, actor)).rejects.toMatchObject({ status: 403 })
    expect(log(db)).toEqual([])
    expect(db.sqlite.prepare('SELECT per_usd FROM fx_rates').get()).toEqual({ per_usd: 90 })
  })

  it('writes nothing to the journal when the write fails', async () => {
    const db = createTestDb()
    await insertRow(db, 'goals', { id: 'fire', name: 'FIRE', target: 1, current: 0, target_date: '2040-01-01' }, actor)
    await expect(insertRow(db, 'goals', { id: 'fire', name: 'FIRE', target: 1, current: 0, target_date: '2040-01-01' }, actor)).rejects.toThrow()
    expect(log(db)).toHaveLength(1)
  })
})

describe('revertChange', () => {
  it('undoes an update, an insert and a delete', async () => {
    const db = createTestDb()
    const row = await insertRow(db, 'parameters', { key: 'k', value: 1 }, actor)
    const id = Number(row.rowid)
    await updateRow(db, 'parameters', id, { value: 2 }, actor)
    await revertChange(db, 2, actor)
    expect(db.sqlite.prepare('SELECT value FROM parameters').get()).toEqual({ value: 1 })

    await deleteRow(db, 'parameters', id, actor)
    const del = log(db).find(e => e.op === 'delete')!
    await revertChange(db, Number(del.id), actor)
    expect(db.sqlite.prepare('SELECT key, value FROM parameters').all()).toEqual([{ key: 'k', value: 1 }])

    await revertChange(db, 1, actor)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM parameters').get()).toEqual({ n: 0 })
    expect(log(db).filter(e => e.op === 'revert').map(e => e.reverts_id)).toEqual([2, Number(del.id), 1])
  })

  it('restores the cash-flow row that a second save replaced', async () => {
    const db = createTestDb()
    const month = { date: '2031-08-01', bank: 'Quillmark Bank', member: 'Robin', currency: 'RUB' }
    await insertRow(db, 'monthly_cashflow', { ...month, active_income: 100, passive_income: 0, expense: 50 }, actor)
    await insertRow(db, 'monthly_cashflow', { ...month, active_income: 200, passive_income: 0, expense: 70 }, actor)
    await revertChange(db, 2, actor)
    expect(db.sqlite.prepare('SELECT active_income, expense FROM monthly_cashflow').all()).toEqual([{ active_income: 100, expense: 50 }])
  })

  it('refuses when the row changed later, when reverted twice, and for reverts', async () => {
    const db = createTestDb()
    const row = await insertRow(db, 'parameters', { key: 'k', value: 1 }, actor)
    await updateRow(db, 'parameters', Number(row.rowid), { value: 2 }, actor)
    await updateRow(db, 'parameters', Number(row.rowid), { value: 3 }, actor)
    await expect(revertChange(db, 2, actor)).rejects.toMatchObject({ status: 409 })
    await revertChange(db, 3, actor)
    await expect(revertChange(db, 3, actor)).rejects.toMatchObject({ status: 409 })
    await expect(revertChange(db, 4, actor)).rejects.toMatchObject({ status: 400 })
    await expect(revertChange(db, 99, actor)).rejects.toMatchObject({ status: 404 })
  })

  it('journals a delete revert without the unrelated row that took the freed rowid', async () => {
    const db = createTestDb()
    const row = await insertRow(db, 'parameters', { key: 'k', value: 1 }, actor)
    await deleteRow(db, 'parameters', Number(row.rowid), actor)
    const other = await insertRow(db, 'parameters', { key: 'other', value: 5 }, actor)
    expect(other.rowid).toBe(row.rowid)
    await revertChange(db, 2, actor)
    expect(log(db).find(e => e.op === 'revert')).toMatchObject({ reverts_id: 2, before_json: null })
    expect(db.sqlite.prepare('SELECT key, value FROM parameters ORDER BY key').all()).toEqual([
      { key: 'k', value: 1 }, { key: 'other', value: 5 },
    ])
  })

  it('re-reads when the row changes between its checks and its write: the later edit is not overwritten', async () => {
    const db = createTestDb()
    const row = await insertRow(db, 'parameters', { key: 'k', value: 1 }, actor)
    await updateRow(db, 'parameters', Number(row.rowid), { value: 2 }, actor)
    // another request's edit lands after the revert's reads, just before it writes (whichever write path it takes)
    let fired = false
    const edit = () => { if (!fired) { fired = true; db.sqlite.exec('UPDATE parameters SET value = 3') } }
    const guarded = db.guardedBatch.bind(db)
    const batch = db.batch.bind(db)
    vi.spyOn(db, 'guardedBatch').mockImplementation(async (token, statements) => { edit(); return guarded(token, statements) })
    vi.spyOn(db, 'batch').mockImplementation(async statements => { edit(); return batch(statements) })
    await expect(revertChange(db, 2, actor)).rejects.toMatchObject({ status: 409, code: 'row_changed' })
    expect(db.sqlite.prepare('SELECT value FROM parameters').get()).toEqual({ value: 3 })
    vi.restoreAllMocks()
  })

  it('lets the database refuse a second revert of the same change', () => {
    const db = createTestDb()
    const entry = (op: string, revertsId: number | null) =>
      `INSERT INTO change_log (ts, actor, source, table_name, row_id, op, reverts_id) VALUES ('t', 'a', 'admin', 'parameters', 1, '${op}', ${revertsId ?? 'NULL'})`
    db.sqlite.exec(`${entry('insert', null)}; ${entry('update', null)}; ${entry('revert', 1)}`)
    expect(() => db.sqlite.exec(entry('revert', 1))).toThrow(/UNIQUE constraint failed/)
  })
})

describe('reverting a row of a closed month', () => {
  const balance = { date: '2031-06-30', class: 'bank', name: 'Quillmark Bank', value: 100, currency: 'RUB', member: 'Robin' }

  it('refuses to undo the insert: it would leave a hole in a month the dashboard already shows', async () => {
    const db = createTestDb()
    await insertRow(db, 'assets', balance, actor)
    db.sqlite.exec(`INSERT INTO closed_months VALUES ('2031-06', 't', 'owner@example.com')`)
    await expect(revertChange(db, 1, actor)).rejects.toMatchObject({ status: 409, code: 'closed_month_row' })
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM assets').get()).toEqual({ n: 1 })
  })

  it('still undoes an insert into a month that is not closed, an edit of a value, and a deletion', async () => {
    const db = createTestDb()
    await insertRow(db, 'assets', balance, actor)
    await revertChange(db, 1, actor)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM assets').get()).toEqual({ n: 0 })

    const row = await insertRow(db, 'assets', balance, actor)
    db.sqlite.exec(`INSERT INTO closed_months VALUES ('2031-06', 't', 'owner@example.com')`)
    await updateRow(db, 'assets', Number(row.rowid), { value: 150 }, actor)
    const edit = log(db).at(-1)!
    await revertChange(db, Number(edit.id), actor)
    expect(db.sqlite.prepare('SELECT value FROM assets').get()).toEqual({ value: 100 })

    await deleteRow(db, 'assets', Number(row.rowid), actor)
    await revertChange(db, Number(log(db).at(-1)!.id), actor)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM assets').get()).toEqual({ n: 1 })
  })
})

describe('one balance per account a month', () => {
  const balance = { date: '2031-06-30', class: 'bank', name: 'Quillmark Bank', value: 100, currency: 'RUB', member: 'Robin' }
  const count = (db: TestDb) => db.sqlite.prepare('SELECT COUNT(*) AS n FROM assets').get()

  it('refuses a second balance of the account in the month on insert, on a move and on a delete revert', async () => {
    const db = createTestDb()
    await insertRow(db, 'assets', balance, actor)
    await expect(insertRow(db, 'assets', { ...balance, date: '2031-06-15', value: 0 }, actor)).rejects.toMatchObject({ status: 409, code: 'account_exists' })
    // no member and an empty one are the same owner
    await insertRow(db, 'assets', { ...balance, member: null }, actor)
    await expect(insertRow(db, 'assets', { ...balance, member: '' }, actor)).rejects.toMatchObject({ code: 'account_exists' })

    const may = await insertRow(db, 'assets', { ...balance, date: '2031-05-31' }, actor)
    await expect(updateRow(db, 'assets', Number(may.rowid), { date: '2031-06-30' }, actor)).rejects.toMatchObject({ code: 'account_exists' })
    await updateRow(db, 'assets', Number(may.rowid), { value: 7, date: '2031-05-30' }, actor)

    await deleteRow(db, 'assets', 1, actor)
    const del = Number(log(db).at(-1)!.id)
    await insertRow(db, 'assets', balance, actor)
    await expect(revertChange(db, del, actor)).rejects.toMatchObject({ code: 'account_exists' })
    expect(count(db)).toEqual({ n: 3 })
  })

  it('a revert that takes an account away from a confirmed availability is refused', async () => {
    const db = createTestDb()
    const row = await insertRow(db, 'assets', balance, actor)
    await updateRow(db, 'assets', Number(row.rowid), { currency: 'USD' }, actor)
    db.sqlite.exec("INSERT INTO availability_assessments VALUES ('2031-06', 'Quillmark Bank', 'Robin', 'USD', 100, 1, 20, 0, 0)")
    await expect(revertChange(db, Number(log(db).at(-1)!.id), actor)).rejects.toMatchObject({ status: 409, code: 'availability_reconcile' })
    expect(db.sqlite.prepare('SELECT currency FROM assets').get()).toEqual({ currency: 'USD' })
  })
})

describe('reverting an update', () => {
  it('writes back only the table\'s columns', async () => {
    const db = createTestDb()
    const row = await insertRow(db, 'parameters', { key: 'k', value: 1 }, actor)
    await updateRow(db, 'parameters', Number(row.rowid), { value: 2 }, actor)
    db.sqlite.exec(`UPDATE change_log SET before_json = json_set(before_json, '$.nope', 5) WHERE op = 'update'`)
    await revertChange(db, 2, actor)
    expect(db.sqlite.prepare('SELECT key, value FROM parameters').all()).toEqual([{ key: 'k', value: 1 }])
  })
})

describe('loan payments', () => {
  const payment = { date: '2031-06-01', loan_name: 'Car', amount: 400, currency: 'RUB' }
  const refused = { status: 409, code: 'loan_payments_by_wizard' }
  /** What the month-close wizard does: a journaled insert through the statement builders. */
  async function writtenByWizard(db: TestDb) {
    const columns = await tableColumns(db, 'loan_payments')
    const rowid = await nextRowid(db, 'loan_payments')
    await db.batch([
      insertStatement(db, 'loan_payments', columns, payment, rowid, true),
      logStatement(db, actor, { table: 'loan_payments', rowid, op: 'insert', before: null, afterColumns: columns }),
    ])
    return rowid
  }

  it('are written only by the month-close wizard: the generic API refuses insert, update and delete', async () => {
    const db = createTestDb()
    await expect(insertRow(db, 'loan_payments', payment, actor)).rejects.toMatchObject(refused)
    const rowid = await writtenByWizard(db)
    await expect(updateRow(db, 'loan_payments', rowid, { amount: 500 }, actor)).rejects.toMatchObject(refused)
    await expect(deleteRow(db, 'loan_payments', rowid, actor)).rejects.toMatchObject(refused)
    expect(db.sqlite.prepare('SELECT amount FROM loan_payments').all()).toEqual([{ amount: 400 }])
  })

  it('reverting the insert of a loan payment of a closed month answers 409 closed_month_row', async () => {
    const db = createTestDb()
    await writtenByWizard(db)
    db.sqlite.exec(`INSERT INTO closed_months VALUES ('2031-06', 't', 'owner@example.com')`)
    await expect(revertChange(db, 1, actor)).rejects.toMatchObject({ status: 409, code: 'closed_month_row' })
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM loan_payments').get()).toEqual({ n: 1 })
  })
})

describe('spending tables', () => {
  const refused = { status: 409, code: 'spending_by_route' }
  const bodies: Record<string, Record<string, string | number>> = {
    spending_categories: { name: 'Groceries', kind: 'mandatory' },
    category_spending: { date: '2031-05-15', category_id: 1, source: 'Bank A', amount: 10, currency: 'USD' },
    flow_lines: { date: '2031-05-01', bank: 'Bank A', member: '', category_id: 1, amount: 10 },
    manual_mandatory_spending: { id: 1, amount: 900, currency: 'USD', updated_at: 't' },
  }

  it.each(Object.keys(bodies))('%s: the generic API refuses insert, update and delete', async table => {
    const db = createTestDb()
    await expect(insertRow(db, table, bodies[table], actor)).rejects.toMatchObject(refused)
    await expect(updateRow(db, table, 1, { currency: 'EUR' }, actor)).rejects.toMatchObject(refused)
    await expect(deleteRow(db, table, 1, actor)).rejects.toMatchObject(refused)
    expect(db.sqlite.prepare('SELECT name, kind FROM spending_categories').all()).toEqual([{ name: 'loan_payments', kind: 'loan_payment' }])
  })
})

describe('flow_lines in the journal', () => {
  it('reverting the insert of a line of a closed month is allowed: it leaves a bigger Other, no hole', async () => {
    const db = createTestDb()
    db.sqlite.exec(`INSERT INTO closed_months VALUES ('2031-05', 't', 'owner@example.com')`)
    const columns = await tableColumns(db, 'flow_lines')
    await db.batch([
      insertStatement(db, 'flow_lines', columns, { date: '2031-05-01', bank: 'Bank A', member: '', category_id: 1, amount: 10 }, 1),
      logStatement(db, actor, { table: 'flow_lines', rowid: 1, op: 'insert', before: null, afterColumns: columns }),
    ])
    await revertChange(db, 1, actor)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM flow_lines').get()).toEqual({ n: 0 })
  })
})

describe('module tables', () => {
  it('writes to a module table need no module switch', async () => {
    const db = createTestDb()
    const goal = { id: 'g1', name: 'Cushion', target: 100, current: 10, target_date: '2032-01-01', emoji: 'x', currency: 'USD' }
    const row = await insertRow(db, 'goals', goal, actor)
    await updateRow(db, 'goals', Number(row.rowid), { current: 20 }, actor)
    expect(db.sqlite.prepare('SELECT current FROM goals').get()).toEqual({ current: 20 })
  })
})

describe('a row named by its TEXT primary key', () => {
  const loan = { issue_date: '2031-01-01', principal: 1000, rate: 5, term_months: 12, monthly_payment: 90, currency: 'EUR', member: 'Robin' }

  it('is not inserted without its name, or with a blank one', async () => {
    const db = createTestDb()
    await expect(insertRow(db, 'loans', loan, actor)).rejects.toMatchObject({ status: 400, code: 'required_field', params: { column: 'name' } })
    await expect(insertRow(db, 'loans', { ...loan, name: null }, actor)).rejects.toMatchObject({ status: 400, code: 'required_field', params: { column: 'name' } })
    await expect(insertRow(db, 'loans', { ...loan, name: '  ' }, actor)).rejects.toMatchObject({ status: 400, code: 'required_field', params: { column: 'name' } })
    await expect(insertRow(db, 'members', { name: '' }, actor)).rejects.toMatchObject({ status: 400, code: 'required_field', params: { column: 'name' } })
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM loans').get()).toEqual({ n: 0 })
  })

  it('keeps its name on an update that leaves it out, and refuses a blank one', async () => {
    const db = createTestDb()
    const row = await insertRow(db, 'loans', { ...loan, name: 'Car loan' }, actor)
    const rowid = Number(row.rowid)
    await updateRow(db, 'loans', rowid, { rate: 6 }, actor)
    await expect(updateRow(db, 'loans', rowid, { name: '' }, actor)).rejects.toMatchObject({ status: 400, code: 'required_field', params: { column: 'name' } })
    expect(db.sqlite.prepare('SELECT name, rate FROM loans').all()).toEqual([{ name: 'Car loan', rate: 6 }])
  })
})

describe('a module table column with a limit', () => {
  const loan = { name: 'Mortgage', issue_date: '2031-01-01', principal: 1000, rate: 5, monthly_payment: 90, currency: 'EUR', member: 'Robin' }

  it('a loan term over 420 months is refused on insert and on update; 420 is accepted', async () => {
    const db = createTestDb()
    const tooLong = { status: 400, code: 'invalid_value', params: { column: 'term_months' } }
    await expect(insertRow(db, 'loans', { ...loan, term_months: 421 }, actor)).rejects.toMatchObject(tooLong)
    await expect(insertRow(db, 'loans', { ...loan, term_months: '421' }, actor)).rejects.toMatchObject(tooLong)
    const row = await insertRow(db, 'loans', { ...loan, term_months: 420 }, actor)
    await expect(updateRow(db, 'loans', Number(row.rowid), { term_months: 421 }, actor)).rejects.toMatchObject(tooLong)
    expect(db.sqlite.prepare('SELECT term_months FROM loans').all()).toEqual([{ term_months: 420 }])
  })
})

describe('the loans module checks its rows (ServerModule.checkRow)', () => {
  // 1200 at 0%, 100 a month on the 10th from 2031-01-10: the last installment, 2032-01-10, repays it
  const loan = { name: 'Boat loan', issue_date: '2031-01-10', principal: 1200, rate: 0, term_months: 12, monthly_payment: 100, payment_day: 10, currency: 'EUR', member: 'Robin' }
  const ep = { loan_name: 'Boat loan', payment_date: '2031-06-01', amount: 200, strategy: 'reduce_term' }
  const invalid = (column: string) => ({ status: 400, code: 'invalid_value', params: { column } })
  /** 409 for a payment dated `payment` that the loan, repaid on `date`, leaves nothing to reduce */
  const late = (date: string, payment: string) => ({ status: 409, code: 'early_payment_after_payoff', params: { date, payment } })

  it.each([0, 32, -1, '0', '32'])('a payment day of %j is refused on insert and on update', async day => {
    const db = createTestDb()
    await expect(insertRow(db, 'loans', { ...loan, payment_day: day }, actor)).rejects.toMatchObject(invalid('payment_day'))
    const row = await insertRow(db, 'loans', loan, actor)
    await expect(updateRow(db, 'loans', Number(row.rowid), { payment_day: day }, actor)).rejects.toMatchObject(invalid('payment_day'))
    expect(db.sqlite.prepare('SELECT payment_day FROM loans').all()).toEqual([{ payment_day: 10 }])
  })

  it('a payment day 1–31 or none is stored', async () => {
    const db = createTestDb()
    const row = await insertRow(db, 'loans', { ...loan, payment_day: 1 }, actor)
    await updateRow(db, 'loans', Number(row.rowid), { payment_day: '31' }, actor)
    await insertRow(db, 'loans', { ...loan, name: 'Car loan', payment_day: null }, actor)
    expect(db.sqlite.prepare('SELECT payment_day FROM loans ORDER BY rowid').all()).toEqual([{ payment_day: 31 }, { payment_day: null }])
  })

  it('a loan stored with a day outside 1–31 can still be closed: only the columns sent are checked', async () => {
    const db = createTestDb()
    db.sqlite.exec(`INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, payment_day, currency, member)
      VALUES ('Old loan', '2031-01-10', 1200, 0, 12, 100, 32, 'EUR', 'Robin')`)
    await updateRow(db, 'loans', 1, { status: 'closed', closed_date: '2032-01-10' }, actor)
    expect(db.sqlite.prepare('SELECT status FROM loans').all()).toEqual([{ status: 'closed' }])
  })

  it('an early payment strategy other than reduce_term / reduce_payment is refused on insert and on update', async () => {
    const db = createTestDb()
    await insertRow(db, 'loans', loan, actor)
    await expect(insertRow(db, 'loan_early_payments', { ...ep, strategy: 'skip' }, actor)).rejects.toMatchObject(invalid('strategy'))
    const row = await insertRow(db, 'loan_early_payments', { ...ep, strategy: 'reduce_payment' }, actor)
    await expect(updateRow(db, 'loan_early_payments', Number(row.id), { strategy: 'REDUCE_TERM' }, actor)).rejects.toMatchObject(invalid('strategy'))
    expect(db.sqlite.prepare('SELECT strategy FROM loan_early_payments').all()).toEqual([{ strategy: 'reduce_payment' }])
  })

  it('an early payment after the loan is repaid is refused, 409 with the payoff day; one before it is stored', async () => {
    const db = createTestDb()
    await insertRow(db, 'loans', loan, actor)
    await expect(insertRow(db, 'loan_early_payments', { ...ep, payment_date: '2032-02-01' }, actor)).rejects.toMatchObject(late('2032-01-10', '2032-02-01'))
    // on the last installment's day only a reduce_payment one is taken: the bank applies it before the installment
    await expect(insertRow(db, 'loan_early_payments', { ...ep, payment_date: '2032-01-10' }, actor)).rejects.toMatchObject(late('2032-01-10', '2032-01-10'))
    await insertRow(db, 'loan_early_payments', { ...ep, payment_date: '2032-01-10', strategy: 'reduce_payment', amount: 50 }, actor)
    // 20 the day before leaves 80, of which the stored 50 still reduces some
    await insertRow(db, 'loan_early_payments', { ...ep, payment_date: '2032-01-09', amount: 20 }, actor)
    expect(db.sqlite.prepare('SELECT payment_date FROM loan_early_payments ORDER BY id').all()).toEqual([{ payment_date: '2032-01-10' }, { payment_date: '2032-01-09' }])
  })

  it('the loan\'s other early payments count, the row updated does not', async () => {
    const db = createTestDb()
    await insertRow(db, 'loans', loan, actor)
    // the whole 1200 on 2031-01-20, before the first installment, repays the loan that day
    const whole = await insertRow(db, 'loan_early_payments', { ...ep, payment_date: '2031-01-20', amount: 1200 }, actor)
    await expect(insertRow(db, 'loan_early_payments', ep, actor)).rejects.toMatchObject(late('2031-01-20', '2031-06-01'))
    // moved later, the payment is checked against the schedule without itself
    await updateRow(db, 'loan_early_payments', Number(whole.id), { payment_date: '2031-03-20' }, actor)
    await expect(updateRow(db, 'loan_early_payments', Number(whole.id), { payment_date: '2032-03-20' }, actor)).rejects.toMatchObject(late('2032-01-10', '2032-03-20'))
    expect(db.sqlite.prepare('SELECT payment_date FROM loan_early_payments').all()).toEqual([{ payment_date: '2031-03-20' }])
  })

  it('an early payment that repays the loan before a stored one is refused, naming the stored one; so is a move that does', async () => {
    const db = createTestDb()
    await insertRow(db, 'loans', loan, actor)
    // 100 is left before the last installment of 2032-01-10; 50 on its morning still reduces it
    await insertRow(db, 'loan_early_payments', { ...ep, payment_date: '2032-01-10', strategy: 'reduce_payment', amount: 50 }, actor)
    // 200 the day before repays the loan on 2032-01-09: the stored payment would reduce nothing
    await expect(insertRow(db, 'loan_early_payments', { ...ep, payment_date: '2032-01-09' }, actor)).rejects.toMatchObject(late('2032-01-09', '2032-01-10'))
    const small = await insertRow(db, 'loan_early_payments', { ...ep, payment_date: '2031-03-01', amount: 20 }, actor)
    await expect(updateRow(db, 'loan_early_payments', Number(small.id), { payment_date: '2032-01-09', amount: 200 }, actor)).rejects.toMatchObject(late('2032-01-09', '2032-01-10'))
    expect(db.sqlite.prepare('SELECT payment_date, amount FROM loan_early_payments ORDER BY id').all())
      .toEqual([{ payment_date: '2032-01-10', amount: 50 }, { payment_date: '2031-03-01', amount: 20 }])
  })

  it('a stored payment already late is not the new one\'s doing: a payment that reduces something is stored beside it', async () => {
    const db = createTestDb()
    await insertRow(db, 'loans', loan, actor)
    db.sqlite.exec("INSERT INTO loan_early_payments (loan_name, payment_date, amount, strategy) VALUES ('Boat loan', '2033-01-01', 100, 'reduce_term')")
    await insertRow(db, 'loan_early_payments', ep, actor)
    expect(db.sqlite.prepare('SELECT payment_date FROM loan_early_payments ORDER BY id').all()).toEqual([{ payment_date: '2033-01-01' }, { payment_date: '2031-06-01' }])
  })

  it('a client cannot choose or change the INTEGER PRIMARY KEY: `id` is dropped like `rowid`', async () => {
    const db = createTestDb()
    await insertRow(db, 'loans', loan, actor)
    const first = await insertRow(db, 'loan_early_payments', { ...ep, id: Number.MAX_SAFE_INTEGER }, actor)
    expect(first.id).toBe(1)
    expect((await insertRow(db, 'loan_early_payments', { ...ep, payment_date: '2031-07-01' }, actor)).id).toBe(2)
    await updateRow(db, 'loan_early_payments', 1, { id: 99, notes: 'kept in place' }, actor)
    expect(db.sqlite.prepare('SELECT id, notes FROM loan_early_payments ORDER BY id').all()).toEqual([{ id: 1, notes: 'kept in place' }, { id: 2, notes: null }])
    // the journal entry still points at the row, so it can be reverted
    const { id } = db.sqlite.prepare("SELECT id FROM change_log WHERE op = 'update' ORDER BY id DESC").get() as { id: number }
    await expect(revertChange(db, id, actor)).resolves.toEqual({ reverted: id })
  })

  it('a stored late early payment can still be renamed with its loan or annotated: the date and strategy are not sent', async () => {
    const db = createTestDb()
    await insertRow(db, 'loans', loan, actor)
    db.sqlite.exec("INSERT INTO loan_early_payments (loan_name, payment_date, amount, strategy) VALUES ('Boat loan', '2033-01-01', 100, 'reduce_term')")
    await updateRow(db, 'loan_early_payments', 1, { notes: 'typed before the check' }, actor)
    await updateRow(db, 'loan_early_payments', 1, { loan_name: 'Yacht loan' }, actor)
    expect(db.sqlite.prepare('SELECT loan_name, notes FROM loan_early_payments').all()).toEqual([{ loan_name: 'Yacht loan', notes: 'typed before the check' }])
  })
})

describe('members a user points to', () => {
  it('cannot be deleted or renamed', async () => {
    const db = createTestDb()
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Anna'), ('Ben'); INSERT INTO users (member, created_at, updated_at) VALUES ('Anna', 't', 't')")
    const anna = (db.sqlite.prepare("SELECT rowid FROM members WHERE name = 'Anna'").get() as { rowid: number }).rowid
    const ben = (db.sqlite.prepare("SELECT rowid FROM members WHERE name = 'Ben'").get() as { rowid: number }).rowid
    await expect(deleteRow(db, 'members', anna, actor)).rejects.toMatchObject({ code: 'member_has_user', status: 409 })
    await deleteRow(db, 'members', ben, actor)
    expect(db.sqlite.prepare('SELECT name FROM members').all()).toEqual([{ name: 'Anna' }])
  })
})

describe('members with records', () => {
  const memberId = (db: TestDb, name: string) => (db.sqlite.prepare('SELECT rowid FROM members WHERE name = ?').get(name) as { rowid: number }).rowid

  it.each([
    ['assets', "INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2026-09-30', 'bank', 'Main', 1000, 'USD', 'Sam')"],
    ['loans', "INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, currency, member) VALUES ('Car', '2025-01-01', 1000, 5, 12, 90, 'USD', 'Sam')"],
    ['real_estate', "INSERT INTO real_estate (name, purchase_date, purchase_price, purchase_currency, valuation_year, value, currency, member) VALUES ('Flat', '2020-01-01', 900, 'USD', 2026, 1000, 'USD', 'Sam')"],
  ])('cannot be deleted while %s names them: the records would pass to the next member of that name', async (_, sql) => {
    const db = createTestDb()
    db.sqlite.exec(`INSERT INTO members (name) VALUES ('Sam'); ${sql}`)
    await expect(deleteRow(db, 'members', memberId(db, 'Sam'), actor)).rejects.toMatchObject({ code: 'member_in_use', status: 409 })
    expect(db.sqlite.prepare('SELECT name FROM members').all()).toEqual([{ name: 'Sam' }])
  })

  it('cannot be deleted while a saved month draft names them: closing it would write their rows', async () => {
    const db = createTestDb()
    const draft = { rows: [{ name: 'Bank', member: 'Sam', currency: 'USD', class: 'bank', balance: 100, active: 0, passive: 0, expense: 0, closing: false, added: false }] }
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Sam'), ('Kim')")
    db.sqlite.prepare('INSERT INTO month_drafts VALUES (?, ?, ?)').run('2026-02', JSON.stringify(draft), 'r')
    await expect(deleteRow(db, 'members', memberId(db, 'Sam'), actor)).rejects.toMatchObject({ code: 'member_in_use', status: 409 })
    await deleteRow(db, 'members', memberId(db, 'Kim'), actor)
    expect(db.sqlite.prepare('SELECT name FROM members').all()).toEqual([{ name: 'Sam' }])
  })

  it('are renamed only through /api/members/:rowid/rename, never by the generic write', async () => {
    const db = createTestDb()
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Robin')")
    await expect(updateRow(db, 'members', memberId(db, 'Robin'), { name: 'Robyn' }, actor)).rejects.toMatchObject({ code: 'member_rename_by_route', status: 409 })
    expect(db.sqlite.prepare('SELECT name FROM members').all()).toEqual([{ name: 'Robin' }])
  })

  it('a revert that would delete or rename a member gets the same refusals', async () => {
    const db = createTestDb()
    await insertRow(db, 'members', { name: 'Sam' }, actor)
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Robyn')")
    db.sqlite.exec(`INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2026-09-30', 'bank', 'Main', 1000, 'USD', 'Sam');
      INSERT INTO change_log (ts, actor, source, table_name, row_id, op, before_json, after_json) VALUES ('t', 'a', 'admin', 'members', ${memberId(db, 'Robyn')}, 'update', '{"name":"Robin"}', '{"name":"Robyn"}')`)
    const [insert, rename] = db.sqlite.prepare('SELECT id FROM change_log ORDER BY id').all() as { id: number }[]
    await expect(revertChange(db, insert.id, actor)).rejects.toMatchObject({ code: 'member_in_use', status: 409 })
    await expect(revertChange(db, rename.id, actor)).rejects.toMatchObject({ code: 'member_rename_by_route', status: 409 })
    expect(db.sqlite.prepare('SELECT name FROM members ORDER BY name').all()).toEqual([{ name: 'Robyn' }, { name: 'Sam' }])
  })
})

describe('reverting a member change', () => {
  it('user changes cannot be reverted', async () => {
    const db = createTestDb()
    db.sqlite.exec(`INSERT INTO users (member, created_at, updated_at) VALUES ('Ben', 't', 't');
      INSERT INTO change_log (ts, actor, source, table_name, row_id, op, before_json, after_json) VALUES ('t', 'a', 'admin', 'users', 1, 'update', '{}', '{}')`)
    const { id } = db.sqlite.prepare('SELECT id FROM change_log').get() as { id: number }
    await expect(revertChange(db, id, actor)).rejects.toMatchObject({ code: 'not_revertible', status: 409 })
  })

  it.each(['proposals', 'proposal_versions', 'proposal_votes', 'advisor_settings'])('a %s journal entry is 409 not_revertible', async table => {
    const db = createTestDb()
    db.sqlite.exec(`INSERT INTO change_log (ts, actor, source, table_name, row_id, op, before_json, after_json) VALUES ('t', 'a', 'bot', '${table}', 1, 'update', '{}', '{}')`)
    const { id } = db.sqlite.prepare('SELECT id FROM change_log').get() as { id: number }
    await expect(revertChange(db, id, actor)).rejects.toMatchObject({ code: 'not_revertible', status: 409 })
  })

  it('a demo_data entry is 409 not_revertible: the load replaced whole tables', async () => {
    const db = createTestDb()
    db.sqlite.exec(`INSERT INTO change_log (ts, actor, source, table_name, row_id, op, after_json) VALUES ('t', 'a', 'admin', '*', 0, 'demo_data', '{"family":"en-US"}')`)
    const { id } = db.sqlite.prepare('SELECT id FROM change_log').get() as { id: number }
    await expect(revertChange(db, id, actor)).rejects.toMatchObject({ code: 'not_revertible', status: 409 })
  })

  it('refuses to revert an app_settings entry whose key starts with auth_', async () => {
    const db = createTestDb()
    db.sqlite.exec(`INSERT INTO app_settings (key, value) VALUES ('auth_mode', 'telegram');
      INSERT INTO change_log (ts, actor, source, table_name, row_id, op, before_json, after_json)
      VALUES ('t', 'a', 'admin', 'app_settings', 99, 'insert', NULL, '{"key":"auth_mode","value":"telegram"}'),
             ('t', 'a', 'admin', 'app_settings', 99, 'delete', '{"key":"auth_mode","value":"telegram"}', NULL)`)
    for (const { id } of db.sqlite.prepare('SELECT id FROM change_log').all() as { id: number }[]) {
      await expect(revertChange(db, id, actor)).rejects.toMatchObject({ code: 'not_revertible', status: 409 })
    }
    expect(db.sqlite.prepare("SELECT value FROM app_settings WHERE key = 'auth_mode'").get()).toEqual({ value: 'telegram' })
  })

  it('is refused while a user points to the member', async () => {
    const db = createTestDb()
    await insertRow(db, 'members', { name: 'Ben' }, actor)
    db.sqlite.exec("INSERT INTO users (member, created_at, updated_at) VALUES ('Ben', 't', 't')")
    const ids = (db.sqlite.prepare('SELECT id, op FROM change_log ORDER BY id').all() as { id: number; op: string }[])
    await expect(revertChange(db, ids[0].id, actor)).rejects.toMatchObject({ code: 'member_has_user', status: 409 })
  })
})


describe('guarded row plans', () => {
  it('builds inserts without writes and reserves consecutive explicit rowids for a compound plan', async () => {
    const db = createTestDb()
    const token = db.readToken()
    const firstId = await nextRowid(db, 'parameters')
    const first = await buildInsertRow(db, 'parameters', { key: 'first', value: 1 }, actor, firstId)
    const second = await buildInsertRow(db, 'parameters', { key: 'second', value: 2 }, actor, firstId + 1)
    expect(first.result).toBe(1)
    expect(second.result).toBe(2)
    expect(db.sqlite.prepare('SELECT * FROM parameters').all()).toEqual([])
    expect(log(db)).toEqual([])
    await db.guardedBatch(token, [...first.statements, ...second.statements])
    expect(db.sqlite.prepare('SELECT rowid, key, value FROM parameters ORDER BY rowid').all())
      .toEqual([{ rowid: 1, key: 'first', value: 1 }, { rowid: 2, key: 'second', value: 2 }])
    expect(log(db).map(entry => entry.row_id)).toEqual([1, 2])
  })

  it('builds updates and deletes without writing, preserving their public results', async () => {
    const db = createTestDb()
    db.sqlite.exec("INSERT INTO parameters (key, value) VALUES ('first', 1), ('second', 2)")
    await commitMutation(db, async () => {
      const update = await buildUpdateRow(db, 'parameters', 1, { value: '3' }, actor)
      const del = await buildDeleteRow(db, 'parameters', 2, actor)
      expect(update.result).toEqual({ rowid: 1, value: '3' })
      expect(del.result).toBeUndefined()
      expect(db.sqlite.prepare('SELECT value FROM parameters ORDER BY rowid').all()).toEqual([{ value: 1 }, { value: 2 }])
      expect(log(db)).toEqual([])
      return { statements: [...update.statements, ...del.statements], result: undefined }
    })
    expect(db.sqlite.prepare('SELECT key, value FROM parameters').all()).toEqual([{ key: 'first', value: 3 }])
    expect(log(db).map(entry => entry.op)).toEqual(['update', 'delete'])
  })

  it('rolls back prior rows and journal entries when a schema trigger refuses a later row', async () => {
    const db = createTestDb()
    db.sqlite.exec("CREATE TRIGGER refuse_second BEFORE INSERT ON parameters WHEN NEW.key = 'second' BEGIN SELECT RAISE(ABORT, 'row refused'); END")
    await expect(commitMutation(db, async () => {
      const id = await nextRowid(db, 'parameters')
      const first = await buildInsertRow(db, 'parameters', { key: 'first', value: 1 }, actor, id)
      const second = await buildInsertRow(db, 'parameters', { key: 'second', value: 2 }, actor, id + 1)
      return { statements: [...first.statements, ...second.statements], result: undefined }
    })).rejects.toThrow('row refused')
    expect(db.sqlite.prepare('SELECT * FROM parameters').all()).toEqual([])
    expect(log(db)).toEqual([])
  })

  it('rolls back a public row write when its journal insert fails', async () => {
    const db = createTestDb()
    db.sqlite.exec("CREATE TRIGGER refuse_log BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT, 'journal refused'); END")
    await expect(insertRow(db, 'parameters', { key: 'first', value: 1 }, actor)).rejects.toThrow('journal refused')
    expect(db.sqlite.prepare('SELECT * FROM parameters').all()).toEqual([])
    expect(log(db)).toEqual([])
  })

  it('revalidates two interleaving valid inserts and preserves an unrelated write', async () => {
    const db = createTestDb()
    const first = insertRow(db, 'parameters', { key: 'first', value: 1 }, actor)
    const second = insertRow(db, 'parameters', { key: 'second', value: 2 }, actor)
    await db.prepare("INSERT INTO parameters (key, value) VALUES ('unrelated', 10)").run()
    const result = await Promise.all([first, second])
    expect(result.map(row => row.key)).toEqual(['first', 'second'])
    expect(db.sqlite.prepare('SELECT key, value FROM parameters ORDER BY key').all())
      .toEqual([{ key: 'first', value: 1 }, { key: 'second', value: 2 }, { key: 'unrelated', value: 10 }])
    expect(log(db)).toHaveLength(2)
  })
})


describe('retained row editor target identity', () => {
  it('compares the identity without validating it: a legacy row with a malformed date can still be corrected', async () => {
    const db = createTestDb()
    try {
      db.sqlite.exec("INSERT INTO goals (id, name, target, current, target_date, currency) VALUES ('car', 'Car', 100, 0, '2031-02-30', 'USD')")
      const { rowid } = db.sqlite.prepare("SELECT rowid FROM goals WHERE id = 'car'").get() as { rowid: number }
      const opened = { id: 'car', name: 'Car', target: 100, current: 0, target_date: '2031-02-30', currency: 'USD' }
      await updateRow(db, 'goals', rowid, { target_date: '2031-02-28', expectedIdentity: opened }, actor)
      expect(db.sqlite.prepare('SELECT target_date FROM goals WHERE rowid = ?').get(rowid)).toEqual({ target_date: '2031-02-28' })
      await expect(updateRow(db, 'goals', rowid, { target: 5, expectedIdentity: { ...opened, target: 99 } }, actor)).rejects.toMatchObject({ status: 409, code: 'row_changed' })
    } finally { db.close() }
  })

  it.each([{}, { key: {} }, null, []])('rejects invalid identity metadata %j without changing a row or its journal', async expectedIdentity => {
    const db = createTestDb()
    try {
      const row = await insertRow(db, 'parameters', { key: 'original', value: 1 }, actor)
      const before = log(db)
      await expect(updateRow(db, 'parameters', Number(row.rowid), { value: 2, expectedIdentity }, actor)).rejects.toMatchObject({ status: 400 })
      expect(db.sqlite.prepare('SELECT value FROM parameters WHERE key = ?').get('original')).toEqual({ value: 1 })
      expect(log(db)).toEqual(before)
    } finally { db.close() }
  })

  const cases = [
    { table: 'real_estate', original: { name: 'Home', valuation_year: 2024, value: 100, currency: 'USD', purchase_date: '2020-01-01', purchase_price: 90, purchase_currency: 'USD' }, replacement: { name: 'New home', valuation_year: 2025, value: 200, currency: 'USD', purchase_date: '2020-01-01', purchase_price: 90, purchase_currency: 'USD' }, expectedIdentity: { name: 'Home', valuation_year: 2024 }, change: { value: 123 } },
    { table: 'loan_early_payments', original: { loan_name: 'Old loan', payment_date: '2024-03-01', amount: 10, strategy: 'reduce_term' }, replacement: { loan_name: 'New loan', payment_date: '2024-04-01', amount: 20, strategy: 'reduce_term' }, expectedIdentity: { loan_name: 'Old loan', payment_date: '2024-03-01' }, change: { amount: 12 } },
  ]
  it.each(cases)('rejects a reused $table rowid before build and during guarded retry without journaling the edit', async ({ table, original, replacement, expectedIdentity, change }) => {
    for (const duringCommit of [false, true]) {
      const db = withLoans(createTestDb())
      try {
        const old = await insertRow(db, table, original, actor)
        const id = Number(old.rowid ?? old.id)
        const replace = async () => {
          // the row goes elsewhere (a property's last valuation is not deleted through the rows API: 409 last_valuation)
          db.sqlite.prepare(`DELETE FROM ${table} WHERE rowid = ?`).run(id)
          const next = await insertRow(db, table, replacement, actor)
          expect(Number(next.rowid ?? next.id)).toBe(id)
        }
        const snapshot = () => ({ rows: db.sqlite.prepare(`SELECT * FROM ${table}`).all(), journal: log(db) })
        let before: ReturnType<typeof snapshot>
        if (duringCommit) {
          const guarded = db.guardedBatch.bind(db)
          vi.spyOn(db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
            await replace()
            before = snapshot()
            return guarded(token, statements)
          })
        } else { await replace(); before = snapshot() }
        await expect(updateRow(db, table, id, { ...change, expectedIdentity }, actor)).rejects.toMatchObject({ code: 'row_changed', status: 409 })
        expect(snapshot()).toEqual(before!)
      } finally { db.close() }
    }
  })
  it.each(cases)('preserves a successful $table update with its original identity', async ({ table, original, expectedIdentity, change }) => {
    const db = withLoans(createTestDb())
    try {
      const old = await insertRow(db, table, original, actor)
      await updateRow(db, table, Number(old.rowid ?? old.id), { ...change, expectedIdentity }, actor)
      expect(db.sqlite.prepare(`SELECT * FROM ${table}`).get()).toMatchObject(change)
      expect(JSON.parse(String(log(db).at(-1)!.after_json))).not.toHaveProperty('expectedIdentity')
    } finally { db.close() }
  })
})
