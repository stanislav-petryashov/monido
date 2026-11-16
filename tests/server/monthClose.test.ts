import { updateAccount } from '../../src/server/accountOperations'
import { updateLoan } from '../../src/modules/loans/operations'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeMonth as closeDraft, getMonthCloseState, reopenMonth, saveDraft as writeDraft } from '../../src/server/monthClose'
import type { Actor } from '../../src/server/http'
import { createTestDb, type TestDb } from '../helpers/db'

// Existing workflow fixtures always read the revision they are about to edit.
const saveDraft = async (db: TestDb, month: string, body: object, now = NOW) =>
  writeDraft(db, month, { ...body, expectedRevision: (await getMonthCloseState(db, now)).draftRevision }, now)
const closeMonth = async (db: TestDb, month: string, actor: Actor, now = NOW) =>
  closeDraft(db, month, { expectedRevision: (await getMonthCloseState(db, now)).draftRevision! }, actor, now)

const actor: Actor = { name: 'owner@example.com', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null }
const NOW = new Date('2031-08-10T09:00:00Z')
const all = (db: TestDb, sql: string) => db.sqlite.prepare(sql).all().map(r => ({ ...(r as Record<string, unknown>) }))
const account = (name: string, balance: number) => ({
  name, member: 'Robin', currency: 'RUB', class: 'bank' as const,
  balance, active: 10, passive: 0, expense: 5, closing: false, added: false,
})
/** The Accounts screen's rename of one of Robin's RUB bank accounts. */
const renameAccount = (from: string, to: string) =>
  updateAccount(db, actor, { from: { name: from, member: 'Robin' }, values: { name: to, member: 'Robin', currency: 'RUB', class: 'bank' } })
const full = { rows: [account('Quillmark Bank', 120), account('Quillmark Savings', 500)] }

let db: TestDb
beforeEach(() => {
  db = createTestDb()
  db.sqlite.exec(`
    INSERT INTO assets (date, class, name, value, currency, member) VALUES
      ('2031-05-31', 'bank', 'Quillmark Bank', 100, 'RUB', 'Robin'), ('2031-05-31', 'bank', 'Quillmark Savings', 500, 'RUB', 'Robin');
    INSERT INTO monthly_cashflow (date, bank, member, active_income, passive_income, expense, currency) VALUES
      ('2031-05-01', 'Quillmark Bank', 'Robin', 1, 0, 1, 'RUB'), ('2031-05-01', 'Quillmark Savings', 'Robin', 0, 0, 0, 'RUB');
    INSERT INTO closed_months VALUES ('2031-04', 't', 'migration'), ('2031-05', 't', 'migration');
    INSERT OR IGNORE INTO members (name) VALUES ('Robin');
    INSERT OR IGNORE INTO currencies (code) VALUES ('RUB');
  `)
})

describe('month close on SQLite', () => {
  it('reports the queue, the accounts of its first month and last month’s balances as hints', async () => {
    const state = await getMonthCloseState(db, NOW)
    expect(state.queue).toEqual(['2031-06', '2031-07'])
    expect(state.month).toBe('2031-06')
    expect(state.rows.map(r => r.name)).toEqual(['Quillmark Bank', 'Quillmark Savings'])
    expect(state.hints).toEqual({ '["Quillmark Bank","Robin"]': 100, '["Quillmark Savings","Robin"]': 500 })
    expect(state.problems).toHaveLength(2)
    expect(state.lastClosed).toEqual({ month: '2031-05', reopenable: false })
  })

  it('offers last closed month’s flows, steady when they repeat; without loans every month compares', async () => {
    db.sqlite.exec(`INSERT INTO monthly_cashflow (date, bank, member, active_income, passive_income, expense, currency) VALUES ('2031-04-01', 'Quillmark Bank', 'Robin', 1, 5, 1, 'RUB')`)
    const state = await getMonthCloseState(db, NOW)
    expect(state.flowHints['["Quillmark Bank","Robin"]']).toEqual({
      active: { last: 1, steady: true }, passive: { last: 0, steady: false }, expense: { last: 1, steady: true },
    })
    expect(state.flowHints['["Quillmark Savings","Robin"]']).toEqual({
      active: { last: 0, steady: false }, passive: { last: 0, steady: false }, expense: { last: 0, steady: false },
    })
  })

  it('with loans, an expense is not steady against a closed month without loan payment rows', async () => {
    db.sqlite.exec(`
      INSERT INTO monthly_cashflow (date, bank, member, active_income, passive_income, expense, currency) VALUES ('2031-04-01', 'Quillmark Bank', 'Robin', 1, 0, 1, 'RUB');
      INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, currency, member) VALUES ('Car', '2031-01-15', 1200, 0, 12, 100, 'RUB', 'Robin');
    `)
    expect((await getMonthCloseState(db, NOW)).flowHints['["Quillmark Bank","Robin"]']?.expense).toEqual({ last: 1, steady: false })
  })

  it('keeps a draft across calls and reflects it in the state', async () => {
    const state = await saveDraft(db, '2031-06', { rows: [{ ...full.rows[0], balance: 120 }] }, NOW)
    expect(state.rows.find(r => r.name === 'Quillmark Bank')?.balance).toBe(120)
    expect(state.draftSavedAt).not.toBeNull()
    expect((await getMonthCloseState(db, NOW)).rows.find(r => r.name === 'Quillmark Bank')?.balance).toBe(120)
    expect(state).toEqual(await getMonthCloseState(db, NOW))
  })

  it('refuses a draft for a month that is not first in the queue', async () => {
    await expect(saveDraft(db, '2031-07', full, NOW)).rejects.toMatchObject({ status: 409 })
    await expect(saveDraft(db, '2031-05', full, NOW)).rejects.toMatchObject({ status: 409 })
    await expect(saveDraft(db, 'june', full, NOW)).rejects.toMatchObject({ status: 400 })
  })

  it('closing writes balances, flows, the closed mark and the journal, and removes the draft', async () => {
    await saveDraft(db, '2031-06', full, NOW)
    const state = await closeMonth(db, '2031-06', actor, NOW)
    expect(state.queue).toEqual(['2031-07'])
    expect(all(db, "SELECT name, value, date FROM assets WHERE date = '2031-06-30' ORDER BY name")).toEqual([
      { name: 'Quillmark Bank', value: 120, date: '2031-06-30' }, { name: 'Quillmark Savings', value: 500, date: '2031-06-30' },
    ])
    expect(all(db, "SELECT bank, expense FROM monthly_cashflow WHERE date = '2031-06-01' ORDER BY bank")).toHaveLength(2)
    expect(all(db, "SELECT closed_by FROM closed_months WHERE month = '2031-06'")).toEqual([{ closed_by: 'owner@example.com' }])
    expect(all(db, 'SELECT COUNT(*) AS n FROM month_drafts')).toEqual([{ n: 0 }])
    expect(all(db, "SELECT table_name, op FROM change_log ORDER BY id")).toEqual([
      ...Array(2).fill({ table_name: 'assets', op: 'insert' }), ...Array(2).fill({ table_name: 'monthly_cashflow', op: 'insert' }),
    ])
    expect(state.lastClosed).toEqual({ month: '2031-06', reopenable: true })
  })

  it('does not close an incomplete month and writes nothing', async () => {
    await saveDraft(db, '2031-06', { rows: [full.rows[0]] }, NOW)
    await expect(closeMonth(db, '2031-06', actor, NOW)).rejects.toMatchObject({
      status: 422, code: 'month_has_problems',
      params: { problems: [{ name: 'Quillmark Savings', member: 'Robin', problem: { code: 'missing', fields: ['balance', 'active', 'passive', 'expense'] } }] },
    })
    expect(all(db, "SELECT COUNT(*) AS n FROM assets WHERE date = '2031-06-30'")).toEqual([{ n: 0 }])
    expect(all(db, "SELECT COUNT(*) AS n FROM closed_months WHERE month = '2031-06'")).toEqual([{ n: 0 }])
  })

  it('is all or nothing: a failing statement leaves no rows, no mark, and the draft intact', async () => {
    await saveDraft(db, '2031-06', full, NOW)
    // the last write of the batch is the closed mark; make exactly that one fail
    db.sqlite.exec(`CREATE TRIGGER fail_close BEFORE INSERT ON closed_months BEGIN SELECT RAISE(ABORT, 'boom'); END`)
    await expect(closeMonth(db, '2031-06', actor, NOW)).rejects.toThrow()
    expect(all(db, "SELECT COUNT(*) AS n FROM assets WHERE date = '2031-06-30'")).toEqual([{ n: 0 }])
    expect(all(db, "SELECT COUNT(*) AS n FROM monthly_cashflow WHERE date = '2031-06-01'")).toEqual([{ n: 0 }])
    expect(all(db, "SELECT COUNT(*) AS n FROM closed_months WHERE month = '2031-06'")).toEqual([{ n: 0 }])
    expect(all(db, 'SELECT COUNT(*) AS n FROM month_drafts')).toEqual([{ n: 1 }])
    expect(all(db, 'SELECT COUNT(*) AS n FROM change_log')).toEqual([{ n: 0 }])
  })

  it('shows rows already stored for the open month as the draft instead of ignoring them', async () => {
    db.sqlite.exec(`
      INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2031-06-30', 'bank', 'Quillmark Bank', 777, 'RUB', 'Robin');
      INSERT INTO monthly_cashflow VALUES ('2031-06-01', 'Quillmark Savings', 'Robin', 3, 0, 2, 'RUB');
    `)
    const state = await getMonthCloseState(db, NOW)
    expect(state.rows.find(r => r.name === 'Quillmark Bank')).toMatchObject({ balance: 777, active: null })
    expect(state.rows.find(r => r.name === 'Quillmark Savings')).toMatchObject({ balance: null, active: 3, expense: 2 })
    expect(state.strayRows).toBe(2)
  })

  it('closing replaces rows already stored for that month — no duplicates, no dead end', async () => {
    db.sqlite.exec(`
      INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2031-06-30', 'bank', 'Quillmark Bank', 777, 'RUB', 'Robin');
      INSERT INTO monthly_cashflow VALUES ('2031-06-01', 'Quillmark Savings', 'Robin', 3, 0, 2, 'RUB');
    `)
    await saveDraft(db, '2031-06', full, NOW)
    await closeMonth(db, '2031-06', actor, NOW)
    expect(all(db, "SELECT name, value FROM assets WHERE date = '2031-06-30' ORDER BY name")).toEqual([{ name: 'Quillmark Bank', value: 120 }, { name: 'Quillmark Savings', value: 500 }])
    expect(all(db, "SELECT bank, expense FROM monthly_cashflow WHERE date = '2031-06-01' ORDER BY bank")).toEqual([{ bank: 'Quillmark Bank', expense: 5 }, { bank: 'Quillmark Savings', expense: 5 }])
    expect(all(db, "SELECT COUNT(*) AS n FROM change_log WHERE op = 'delete'")).toEqual([{ n: 2 }])
  })

  it('a name closed earlier and added again is asked for in the following month', async () => {
    await saveDraft(db, '2031-06', { rows: [full.rows[0], { ...full.rows[1], closing: true }] }, NOW)
    await closeMonth(db, '2031-06', actor, NOW)
    await saveDraft(db, '2031-07', { rows: [full.rows[0], { ...full.rows[1], added: true }] }, NOW)
    const august = await closeMonth(db, '2031-07', actor, new Date('2031-09-10T09:00:00Z'))
    expect(august.month).toBe('2031-08')
    expect(august.rows.map(r => r.name)).toEqual(['Quillmark Bank', 'Quillmark Savings'])
  })

  it('offers accounts from earlier months that the last month lacks', async () => {
    db.sqlite.exec(`INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2031-04-30', 'broker', 'Broker', 9, 'USD', 'Robin')`)
    const state = await getMonthCloseState(db, NOW)
    expect(state.suggested).toEqual([{ name: 'Broker', member: 'Robin', currency: 'USD', class: 'broker' }])
  })

  it('refuses to close out of order, twice, or a month that has not finished', async () => {
    await expect(closeMonth(db, '2031-07', actor, NOW)).rejects.toMatchObject({ status: 409, code: 'month_out_of_order' })
    await saveDraft(db, '2031-06', full, NOW); await closeMonth(db, '2031-06', actor, NOW)
    await expect(closeMonth(db, '2031-06', actor, NOW)).rejects.toMatchObject({ status: 409 })
    await expect(closeMonth(db, '2031-08', actor, NOW)).rejects.toMatchObject({ status: 409 })
  })

  it('a closed account is not asked for next month; an added one is', async () => {
    const rows = [{ ...full.rows[0] }, { ...full.rows[1], closing: true, balance: 0 }, { ...full.rows[0], name: 'Quillmark Wallet', added: true }]
    await saveDraft(db, '2031-06', { rows }, NOW)
    const next = await closeMonth(db, '2031-06', actor, NOW)
    expect(next.rows.map(r => r.name)).toEqual(['Quillmark Bank', 'Quillmark Wallet'])
    expect(next.rows.every(r => r.added === false && r.balance === null)).toBe(true)
  })

  it('reopening the last wizard-closed month removes its rows, logs it and brings the values back as a draft', async () => {
    await saveDraft(db, '2031-06', full, NOW); await closeMonth(db, '2031-06', actor, NOW)
    const state = await reopenMonth(db, '2031-06', actor, NOW)
    expect(state.month).toBe('2031-06')
    expect(state.rows.find(r => r.name === 'Quillmark Bank')).toMatchObject({ balance: 120, active: 10 })
    expect(all(db, "SELECT COUNT(*) AS n FROM assets WHERE date = '2031-06-30'")).toEqual([{ n: 0 }])
    expect(all(db, "SELECT COUNT(*) AS n FROM closed_months WHERE month = '2031-06'")).toEqual([{ n: 0 }])
    expect(all(db, "SELECT COUNT(*) AS n FROM change_log WHERE op = 'delete'")).toEqual([{ n: 4 }])
  })

  it('reopening restores a closed account and forgets the closure', async () => {
    await saveDraft(db, '2031-06', { rows: [full.rows[0], { ...full.rows[1], closing: true }] }, NOW); await closeMonth(db, '2031-06', actor, NOW)
    const state = await reopenMonth(db, '2031-06', actor, NOW)
    expect(state.rows.find(r => r.name === 'Quillmark Savings')).toMatchObject({ closing: true })
    expect(all(db, 'SELECT COUNT(*) AS n FROM account_closures')).toEqual([{ n: 0 }])
  })

  it('refuses to reopen migrated history or a month that is not the last closed', async () => {
    await expect(reopenMonth(db, '2031-05', actor, NOW)).rejects.toMatchObject({ status: 409 })
    await saveDraft(db, '2031-06', full, NOW); await closeMonth(db, '2031-06', actor, NOW)
    await saveDraft(db, '2031-07', full, NOW); await closeMonth(db, '2031-07', actor, NOW)
    await expect(reopenMonth(db, '2031-06', actor, NOW)).rejects.toMatchObject({ status: 409 })
  })

  it('says when the next month opens once the queue is empty, and starts an empty database with last month', async () => {
    const state = await getMonthCloseState(db, new Date('2031-06-10T09:00:00Z'))
    expect(state).toMatchObject({ queue: [], month: null, nextOpensOn: '2031-07-01' })
    const empty = await getMonthCloseState(createTestDb(), NOW)
    expect(empty).toMatchObject({ queue: ['2031-07'], month: '2031-07', rows: [] })
  })

  it('journals every written row with its values', async () => {
    await saveDraft(db, '2031-06', full, NOW)
    await closeMonth(db, '2031-06', actor, NOW)
    const entries = all(db, "SELECT actor, source, row_id, after_json FROM change_log WHERE table_name = 'assets' ORDER BY id")
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ actor: 'owner@example.com', source: 'admin' })
    expect(JSON.parse(String(entries[0].after_json))).toEqual({ date: '2031-06-30', class: 'bank', name: 'Quillmark Bank', value: 120, currency: 'RUB', member: 'Robin' })
    const stored = all(db, `SELECT name FROM assets WHERE rowid = ${entries[0].row_id}`)
    expect(stored).toEqual([{ name: 'Quillmark Bank' }])
    const flows = all(db, "SELECT after_json FROM change_log WHERE table_name = 'monthly_cashflow' ORDER BY id")
    expect(JSON.parse(String(flows[0].after_json))).toMatchObject({ date: '2031-06-01', bank: 'Quillmark Bank', active_income: 10, expense: 5 })
  })

  it('journals the rows it replaces and the rows a reopen removes with what they held', async () => {
    db.sqlite.exec(`INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2031-06-30', 'bank', 'Quillmark Bank', 777, 'RUB', 'Robin')`)
    await saveDraft(db, '2031-06', full, NOW)
    await closeMonth(db, '2031-06', actor, NOW)
    const replaced = all(db, "SELECT before_json, after_json FROM change_log WHERE op = 'delete'")
    expect(replaced).toHaveLength(1)
    expect(JSON.parse(String(replaced[0].before_json))).toMatchObject({ name: 'Quillmark Bank', value: 777 })
    expect(replaced[0].after_json).toBeNull()
    await reopenMonth(db, '2031-06', actor, NOW)
    const removed = all(db, "SELECT before_json FROM change_log WHERE op = 'delete' ORDER BY id").slice(1)
    expect(removed.map(r => JSON.parse(String(r.before_json)).value ?? JSON.parse(String(r.before_json)).expense)).toEqual([120, 500, 5, 5])
  })

  it('writes every account of a large month with one journal entry per row', async () => {
    const many = { rows: Array.from({ length: 20 }, (_, i) => ({ ...account(`Account ${i}`, i), added: true })).concat(full.rows) }
    await saveDraft(db, '2031-06', many, NOW)
    await closeMonth(db, '2031-06', actor, NOW)
    expect(all(db, "SELECT COUNT(*) AS n FROM assets WHERE date = '2031-06-30'")).toEqual([{ n: 22 }])
    expect(all(db, "SELECT COUNT(*) AS n FROM monthly_cashflow WHERE date = '2031-06-01'")).toEqual([{ n: 22 }])
    expect(all(db, "SELECT COUNT(*) AS n FROM change_log")).toEqual([{ n: 44 }])
    // the journal holds the address of every row written
    expect(all(db, "SELECT COUNT(*) AS n FROM change_log l JOIN assets a ON a.rowid = l.row_id WHERE l.table_name = 'assets'")).toEqual([{ n: 22 }])
  })

  it('a renamed account keeps its closure and what was typed for it in the draft', async () => {
    await saveDraft(db, '2031-06', { rows: [full.rows[0], { ...full.rows[1], closing: true }] }, NOW)
    await closeMonth(db, '2031-06', actor, NOW)
    await renameAccount('Quillmark Savings', 'Quillmark Savings closed')
    expect(all(db, 'SELECT name, closed_month FROM account_closures')).toEqual([{ name: 'Quillmark Savings closed', closed_month: '2031-06' }])

    await saveDraft(db, '2031-07', { rows: [{ ...full.rows[0], balance: 321 }] }, NOW)
    await renameAccount('Quillmark Bank', 'Quillmark Bank salary')
    const state = await getMonthCloseState(db, new Date('2031-09-10T09:00:00Z'))
    expect(state.rows).toEqual([expect.objectContaining({ name: 'Quillmark Bank salary', balance: 321 })])
  })

  it('with cash flow off, closing writes no flows and leaves hidden flow rows alone', async () => {
    db.sqlite.exec("INSERT INTO monthly_cashflow (date, bank, member, active_income, passive_income, expense, currency) VALUES ('2031-06-01', 'Quillmark Bank', 'Robin', 1, 0, 1, 'RUB')")
    db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '0')")
    const state = await getMonthCloseState(db, NOW)
    expect(state.flows).toBe(false)
    expect(state.strayRows).toBe(0)
    expect(state.totals.every(t => t.income === 0 && t.expense === 0)).toBe(true)
    await saveDraft(db, '2031-06', { rows: state.rows.map(r => ({ ...r, balance: 10 })) }, NOW)
    const closed = await closeMonth(db, '2031-06', actor, NOW)
    expect(closed.queue).toEqual(['2031-07'])
    expect(all(db, "SELECT COUNT(*) AS n FROM assets WHERE date = '2031-06-30'")).toEqual([{ n: 2 }])
    expect(all(db, "SELECT bank, expense FROM monthly_cashflow WHERE date = '2031-06-01'")).toEqual([{ bank: 'Quillmark Bank', expense: 1 }])
    expect(all(db, "SELECT COUNT(*) AS n FROM change_log WHERE table_name = 'monthly_cashflow'")).toEqual([{ n: 0 }])
    await reopenMonth(db, '2031-06', actor, NOW)
    expect(all(db, "SELECT bank, expense FROM monthly_cashflow WHERE date = '2031-06-01'")).toEqual([{ bank: 'Quillmark Bank', expense: 1 }])
    expect(all(db, "SELECT COUNT(*) AS n FROM assets WHERE date = '2031-06-30'")).toEqual([{ n: 0 }])
    expect(all(db, "SELECT COUNT(*) AS n FROM change_log WHERE table_name = 'monthly_cashflow'")).toEqual([{ n: 0 }])
  })

  it('with cash flow on, the state says so', async () => {
    expect((await getMonthCloseState(db, NOW)).flows).toBe(true)
  })

  describe('loan payments', () => {
    const loan = { name: 'Car loan', amount: 1234.5 }
    beforeEach(() => {
      // 1000 a month, due on the 15th: June 2031 asks for 1000
      db.sqlite.exec(`INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, currency, member, payment_day, status)
        VALUES ('Car loan', '2031-01-15', 12000, 0, 12, 1000, 'RUB', 'Robin', 15, 'active')`)
    })
    const withLoan = { ...full, loans: [loan] }

    it('the state lists the loan lines only while income and expenses are tracked', async () => {
      expect((await getMonthCloseState(db, NOW)).loanPayments).toEqual([{ name: 'Car loan', currency: 'RUB', scheduled: 1000, amount: 1000 }])
      db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '0')")
      expect((await getMonthCloseState(db, NOW)).loanPayments).toEqual([])
    })

    it('a typed amount is in the state and counts as an expense in the totals', async () => {
      const state = await saveDraft(db, '2031-06', withLoan, NOW)
      expect(state.loanPayments).toEqual([{ name: 'Car loan', currency: 'RUB', scheduled: 1000, amount: 1234.5 }])
      expect(state.totals.find(t => t.currency === 'RUB')?.expense).toBe(10 + 1234.5)
      const cleared = await saveDraft(db, '2031-06', { ...full, loans: [{ name: 'Car loan', amount: null }] }, NOW)
      expect(cleared.problems).toEqual([{ key: 'loan:Car loan', name: '', member: '', problem: { code: 'loan_payment', name: 'Car loan' } }])
      await expect(closeMonth(db, '2031-06', actor, NOW)).rejects.toMatchObject({ status: 422, code: 'month_has_problems' })
    })

    it('closing writes the edited loan amounts and journals each row', async () => {
      await saveDraft(db, '2031-06', withLoan, NOW)
      await closeMonth(db, '2031-06', actor, NOW)
      expect(all(db, 'SELECT date, loan_name, amount, currency FROM loan_payments')).toEqual([{ date: '2031-06-01', loan_name: 'Car loan', amount: 1234.5, currency: 'RUB' }])
      const entries = all(db, "SELECT row_id, op, after_json FROM change_log WHERE table_name = 'loan_payments'")
      expect(entries).toHaveLength(1)
      expect(entries[0].op).toBe('insert')
      expect(JSON.parse(String(entries[0].after_json))).toEqual({ date: '2031-06-01', loan_name: 'Car loan', amount: 1234.5, currency: 'RUB' })
      expect(all(db, `SELECT loan_name FROM loan_payments WHERE rowid = ${entries[0].row_id}`)).toEqual([{ loan_name: 'Car loan' }])
    })

    it('renaming an account keeps the loan amounts typed in the draft', async () => {
      await saveDraft(db, '2031-06', withLoan, NOW)
      await renameAccount('Quillmark Bank', 'Quillmark Bank salary')
      expect((await getMonthCloseState(db, NOW)).loanPayments[0].amount).toBe(1234.5)
    })

    it('an untouched loan line is closed with the schedule’s amount', async () => {
      await saveDraft(db, '2031-06', full, NOW)
      await closeMonth(db, '2031-06', actor, NOW)
      expect(all(db, 'SELECT loan_name, amount FROM loan_payments')).toEqual([{ loan_name: 'Car loan', amount: 1000 }])
    })

    it('while income and expenses are not tracked no loan payment is written', async () => {
      await saveDraft(db, '2031-06', withLoan, NOW)
      db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '0')")
      await closeMonth(db, '2031-06', actor, NOW)
      expect(all(db, 'SELECT COUNT(*) AS n FROM loan_payments')).toEqual([{ n: 0 }])
    })

    it('reopening returns the edited loan amounts to the draft and deletes the rows', async () => {
      await saveDraft(db, '2031-06', withLoan, NOW)
      await closeMonth(db, '2031-06', actor, NOW)
      const state = await reopenMonth(db, '2031-06', actor, NOW)
      expect(state.loanPayments).toEqual([{ name: 'Car loan', currency: 'RUB', scheduled: 1000, amount: 1234.5 }])
      expect(all(db, 'SELECT COUNT(*) AS n FROM loan_payments')).toEqual([{ n: 0 }])
      expect(all(db, "SELECT op FROM change_log WHERE table_name = 'loan_payments' ORDER BY id")).toEqual([{ op: 'insert' }, { op: 'delete' }])
    })

    it('closing replaces loan payment rows of the month entered past the wizard', async () => {
      db.sqlite.exec("INSERT INTO loan_payments VALUES ('2031-06-01', 'Car loan', 777, 'RUB')")
      const state = await getMonthCloseState(db, NOW)
      expect(state.strayRows).toBe(1)
      expect(state.loanPayments[0]).toMatchObject({ amount: 777, scheduled: 1000 })
      await saveDraft(db, '2031-06', withLoan, NOW)
      await closeMonth(db, '2031-06', actor, NOW)
      expect(all(db, 'SELECT loan_name, amount FROM loan_payments')).toEqual([{ loan_name: 'Car loan', amount: 1234.5 }])
      const deleted = all(db, "SELECT before_json FROM change_log WHERE table_name = 'loan_payments' AND op = 'delete'")
      expect(deleted.map(d => JSON.parse(String(d.before_json)).amount)).toEqual([777])
    })

    it('reopening a month closed without loan payment rows sets its loan lines to 0, so closing it again adds nothing', async () => {
      // closed by the wizard before loan payments existed: the account expense of 5 already holds the payment
      db.sqlite.exec(`
        INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2031-06-30', 'bank', 'Quillmark Bank', 120, 'RUB', 'Robin'), ('2031-06-30', 'bank', 'Quillmark Savings', 500, 'RUB', 'Robin');
        INSERT INTO monthly_cashflow VALUES ('2031-06-01', 'Quillmark Bank', 'Robin', 10, 0, 5, 'RUB'), ('2031-06-01', 'Quillmark Savings', 'Robin', 10, 0, 5, 'RUB');
        INSERT INTO closed_months VALUES ('2031-06', 't', 'owner@example.com');
      `)
      const state = await reopenMonth(db, '2031-06', actor, NOW)
      expect(state.loanPayments).toEqual([{ name: 'Car loan', currency: 'RUB', scheduled: 1000, amount: 0 }])
      expect(state.problems).toEqual([])
      expect(state.totals.find(t => t.currency === 'RUB')?.expense).toBe(10)
      await closeMonth(db, '2031-06', actor, NOW)
      expect(all(db, 'SELECT loan_name, amount FROM loan_payments')).toEqual([{ loan_name: 'Car loan', amount: 0 }])
      expect(all(db, "SELECT SUM(expense) AS e FROM monthly_cashflow WHERE date = '2031-06-01'")).toEqual([{ e: 10 }])
    })
  })
})

describe('the modules’ close checks', () => {
  /** June's draft of Quillmark Bank with 5 of expenses and a 4-unit line under it. */
  async function withLine(amount = 4) {
    db.sqlite.exec(`
      INSERT INTO spending_categories (name, kind) VALUES ('Food', 'mandatory');
      INSERT INTO flow_lines (date, bank, member, category_id, amount) VALUES ('2031-06-01', 'Quillmark Bank', 'Robin', 2, ${amount});
    `)
    await saveDraft(db, '2031-06', full, NOW)
  }

  it('a draft total lowered under its lines refuses the close with 422 lines_exceed_total', async () => {
    await withLine(6)
    await expect(closeMonth(db, '2031-06', actor, NOW)).rejects.toMatchObject({
      status: 422, code: 'lines_exceed_total', params: { name: 'Quillmark Bank', member: 'Robin', flow: 'expense', lines: 6, total: 5 },
    })
    expect(all(db, 'SELECT month FROM closed_months ORDER BY month')).toEqual([{ month: '2031-04' }, { month: '2031-05' }])
  })

  it('lines within the totals close; reopening keeps them and closing again works', async () => {
    await withLine()
    await closeMonth(db, '2031-06', actor, NOW)
    await reopenMonth(db, '2031-06', actor, NOW)
    expect(all(db, 'SELECT bank, amount FROM flow_lines')).toEqual([{ bank: 'Quillmark Bank', amount: 4 }])
    await closeMonth(db, '2031-06', actor, NOW)
    expect(all(db, "SELECT month FROM closed_months WHERE month = '2031-06'")).toEqual([{ month: '2031-06' }])
  })

  it('the cash-flow check does not run while the module is off', async () => {
    await withLine(6)
    db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '0')")
    await expect(closeMonth(db, '2031-06', actor, NOW)).resolves.toMatchObject({ queue: ['2031-07'] })
  })
})


describe('draft revision protection', () => {
  const snapshot = () => Object.fromEntries(['month_drafts', 'month_draft_revisions', 'assets', 'monthly_cashflow', 'loan_payments', 'closed_months', 'change_log'].map(table => [table, all(db, `SELECT * FROM ${table}`)]))

  it('accepts only one of two saves based on the same revision', async () => {
    const state = await getMonthCloseState(db, NOW)
    expect(state.draftRevision).toEqual(expect.any(String))
    const request = { ...full, expectedRevision: state.draftRevision }
    const first = await writeDraft(db, state.month!, request, NOW)
    expect(first.draftRevision).not.toBe(state.draftRevision)
    const before = snapshot()
    await expect(writeDraft(db, state.month!, request, NOW)).rejects.toMatchObject({ code: 'draft_conflict', status: 409 })
    expect(snapshot()).toEqual(before)
  })

  it.each([undefined, null, 0, {}, []])('refuses invalid revision %j without writing', async expectedRevision => {
    const before = snapshot()
    await expect(writeDraft(db, '2031-06', { ...full, expectedRevision }, NOW)).rejects.toMatchObject({ code: 'invalid_draft_revision', status: 400 })
    expect(snapshot()).toEqual(before)
  })

  it.each([false, true])('acknowledges its own committed revision when another writer commits before its response (retry=%s)', async retry => {
    const state = await getMonthCloseState(db, NOW)
    const body = (balance: number, expectedRevision: string | null) => ({ rows: full.rows.map(r => ({ ...r, balance })), expectedRevision })
    const batch = db.guardedBatch.bind(db)
    let otherRevision: string | null = null
    const guard = vi.spyOn(db, 'guardedBatch')
    if (retry) guard.mockImplementationOnce(async (token, statements) => {
      // An unrelated write invalidates the read token but leaves the client's draft revision current.
      db.sqlite.exec("INSERT OR REPLACE INTO parameters (key, value) VALUES ('inflation_rate', 4)")
      return batch(token, statements)
    })
    guard.mockImplementationOnce(async (token, statements) => {
      const result = await batch(token, statements)
      const committed = await getMonthCloseState(db, NOW)
      const other = await writeDraft(db, '2031-06', body(999, committed.draftRevision), NOW)
      otherRevision = other.draftRevision
      return result
    })
    const acknowledged = await writeDraft(db, '2031-06', body(100, state.draftRevision), NOW)
    expect(acknowledged.rows.map(r => r.balance)).toEqual([100, 100])
    expect(acknowledged.draftRevision).not.toBe(otherRevision)
    expect(guard).toHaveBeenCalledTimes(retry ? 3 : 2)
    expect(all(db, 'SELECT revision FROM month_draft_revisions')).toEqual([{ revision: 2 }])
    // A typed 101 while its save of 100 was pending. Its acknowledgment cannot authorize overwriting B's 999.
    const before = snapshot()
    await expect(writeDraft(db, '2031-06', body(101, acknowledged.draftRevision), NOW)).rejects.toMatchObject({ code: 'draft_conflict', status: 409 })
    expect(snapshot()).toEqual(before)
    expect((await getMonthCloseState(db, NOW)).rows.map(r => r.balance)).toEqual([999, 999])
    guard.mockRestore()
  })

  it('two overlapping saves have one winner and one conflict', async () => {
    const { draftRevision } = await getMonthCloseState(db, NOW)
    const results = await Promise.allSettled([1, 2].map(balance => writeDraft(db, '2031-06', { rows: full.rows.map(r => ({ ...r, balance })), expectedRevision: draftRevision }, NOW)))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'draft_conflict', status: 409 } })
    expect(all(db, 'SELECT revision FROM month_draft_revisions')).toEqual([{ revision: 1 }])
    expect(all(db, 'SELECT * FROM change_log')).toEqual([])
  })

  it('a failing counter write rolls back the draft payload too', async () => {
    const state = await saveDraft(db, '2031-06', full)
    db.sqlite.exec("CREATE TRIGGER fail_counter BEFORE UPDATE ON month_draft_revisions BEGIN SELECT RAISE(ABORT, 'counter failed'); END")
    const before = snapshot()
    await expect(writeDraft(db, '2031-06', { rows: [], expectedRevision: state.draftRevision }, NOW)).rejects.toThrow('counter failed')
    expect(snapshot()).toEqual(before)
  })

  it('category flush does not invalidate the draft but close checks the latest caps under its guard', async () => {
    const state = await saveDraft(db, '2031-06', full)
    db.sqlite.exec("INSERT INTO spending_categories (id, name, flow) VALUES (999, 'Food', 'expense')")
    expect((await getMonthCloseState(db, NOW)).draftRevision).toBe(state.draftRevision)
    const batch = db.guardedBatch.bind(db)
    let afterExternalWrite: ReturnType<typeof snapshot>
    const guard = vi.spyOn(db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
      db.sqlite.exec("INSERT INTO flow_lines VALUES ('2031-06-01', 'Quillmark Bank', 'Robin', 999, 100)")
      afterExternalWrite = snapshot()
      return batch(token, statements)
    })
    await expect(closeDraft(db, '2031-06', { expectedRevision: state.draftRevision! }, actor, NOW)).rejects.toMatchObject({ code: 'lines_exceed_total', status: 422 })
    expect(snapshot()).toEqual(afterExternalWrite!)
    expect((await getMonthCloseState(db, NOW)).draftRevision).toBe(state.draftRevision)
    guard.mockRestore()
  })

  it('account and loan rename advance the affected draft counter and reject old input', async () => {
    const state = await saveDraft(db, '2031-06', { ...full, loans: [{ name: 'Loan', amount: 10 }] })
    await renameAccount('Quillmark Bank', 'Renamed')
    const afterAccount = await getMonthCloseState(db, NOW)
    expect(afterAccount.draftRevision).not.toBe(state.draftRevision)
    const before = snapshot()
    await expect(writeDraft(db, '2031-06', { ...full, expectedRevision: state.draftRevision }, NOW)).rejects.toMatchObject({ code: 'draft_conflict' })
    expect(snapshot()).toEqual(before)
    db.sqlite.exec("INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, currency, member) VALUES ('Loan', '2031-01-15', 1200, 0, 12, 100, 'RUB', 'Robin')")
    await updateLoan(db, actor, Number(all(db, "SELECT rowid FROM loans WHERE name = 'Loan'")[0].rowid), { expectedName: 'Loan', name: 'Renamed loan' })
    const afterLoan = snapshot()
    expect(all(db, 'SELECT revision FROM month_draft_revisions')).toEqual([{ revision: 3 }])
    await expect(writeDraft(db, '2031-06', { ...full, expectedRevision: afterAccount.draftRevision }, NOW)).rejects.toMatchObject({ code: 'draft_conflict' })
    expect(snapshot()).toEqual(afterLoan)
  })

  it('rejects close after an intervening save and never revives a revision after reopen', async () => {
    const saved = await saveDraft(db, '2031-06', full)
    const next = await saveDraft(db, '2031-06', full)
    const before = snapshot()
    await expect(closeDraft(db, '2031-06', { expectedRevision: saved.draftRevision! }, actor, NOW)).rejects.toMatchObject({ code: 'draft_conflict', status: 409 })
    expect(snapshot()).toEqual(before)
    await closeDraft(db, '2031-06', { expectedRevision: next.draftRevision! }, actor, NOW)
    const reopened = await reopenMonth(db, '2031-06', actor, NOW)
    expect(reopened.draftRevision).not.toBe(next.draftRevision)
    const after = snapshot()
    await expect(writeDraft(db, '2031-06', { ...full, expectedRevision: next.draftRevision }, NOW)).rejects.toMatchObject({ code: 'draft_conflict' })
    expect(snapshot()).toEqual(after)
  })

  it('schedule inputs invalidate typed loan amounts even when the effective amounts stay the same', async () => {
    db.sqlite.exec("INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, currency, member) VALUES ('Loan', '2031-01-15', 12000, 0, 12, 1000, 'RUB', 'Robin')")
    const saved = await saveDraft(db, '2031-06', { ...full, loans: [{ name: 'Loan', amount: 42 }] })
    db.sqlite.exec("INSERT INTO loan_early_payments (loan_name, payment_date, amount, strategy) VALUES ('Loan', '2031-05-01', 100, 'reduce_term')")
    expect((await getMonthCloseState(db, NOW)).loanPayments[0].amount).toBe(42)
    const before = snapshot()
    await expect(writeDraft(db, '2031-06', { ...full, expectedRevision: saved.draftRevision }, NOW)).rejects.toMatchObject({ code: 'draft_conflict' })
    expect(snapshot()).toEqual(before)
  })

  it('reads current modules after a guarded retry instead of reusing the first attempt', async () => {
    const saved = await saveDraft(db, '2031-06', full)
    const batch = db.guardedBatch.bind(db)
    const guard = vi.spyOn(db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
      db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '0')")
      return batch(token, statements)
    })
    const before = snapshot()
    await expect(writeDraft(db, '2031-06', { ...full, expectedRevision: saved.draftRevision }, NOW)).rejects.toMatchObject({ code: 'draft_conflict' })
    expect(snapshot()).toEqual(before)
    guard.mockRestore()
  })

  it.each([
    "UPDATE assets SET value = value + 1 WHERE date = '2031-05-31'",
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '0')",
    "INSERT INTO account_closures VALUES ('Other', '', '2031-05')",
  ])('invalidates input after authoritative dependency changes: %s', async sql => {
    const saved = await saveDraft(db, '2031-06', full)
    db.sqlite.exec(sql)
    const before = snapshot()
    await expect(writeDraft(db, '2031-06', { ...full, expectedRevision: saved.draftRevision }, NOW)).rejects.toMatchObject({ code: 'draft_conflict', status: 409 })
    expect(snapshot()).toEqual(before)
  })
})
