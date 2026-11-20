import { closeCatchUp, getCatchUpState } from '../../src/server/catchUp'
import { getMonthCloseState, reopenMonth, saveDraft } from '../../src/server/monthClose'
import { getSnapshot } from '../../src/server/snapshot'
import type { Actor } from '../../src/server/http'
import { createTestDb, type TestDb } from '../helpers/db'

// Back on 10 November after closing June: July to October are open, the grid takes July to September
const NOW = new Date('2031-11-10T09:00:00Z')
const actor: Actor = { name: 'owner@example.com', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null }
const all = (db: TestDb, sql: string) => db.sqlite.prepare(sql).all().map(r => ({ ...(r as Record<string, unknown>) }))
const MONTHS = ['2031-07', '2031-08', '2031-09']
let db: TestDb

beforeEach(() => {
  db = createTestDb()
  db.sqlite.exec(`
    INSERT INTO assets (date, class, name, value, currency, member) VALUES
      ('2031-06-30', 'bank', 'Bank', 1000, 'RUB', 'Robin'), ('2031-06-30', 'bank', 'Card', -50, 'RUB', 'Robin');
    INSERT INTO monthly_cashflow (date, bank, member, active_income, passive_income, expense, currency) VALUES
      ('2031-06-01', 'Bank', 'Robin', 100, 0, 80, 'RUB'), ('2031-06-01', 'Card', 'Robin', 0, 0, 20, 'RUB');
    INSERT INTO closed_months VALUES ('2031-05', 't', 'migration'), ('2031-06', '2031-07-02T08:00:00.000Z', 'owner@example.com');
    INSERT OR IGNORE INTO members (name) VALUES ('Robin');
    INSERT OR IGNORE INTO currencies (code) VALUES ('RUB');
  `)
})

const cells = (bank: (number | null)[], card: (number | null)[]) => [
  { name: 'Bank', member: 'Robin', cells: bank }, { name: 'Card', member: 'Robin', cells: card },
]
const close = async (rows = cells([1100, 1200, 1300], [-40, -30, -20]), expectedRevision?: string) =>
  closeCatchUp(db, { expectedRevision: expectedRevision ?? (await getCatchUpState(db, NOW))!.revision, rows }, actor, NOW)

describe('the catch-up state', () => {
  it('offers July to September and leaves October to the wizard', async () => {
    const state = await getCatchUpState(db, NOW)
    expect(state).toMatchObject({ months: MONTHS, leftOut: null, newest: '2031-10' })
    expect(state!.rows.map(r => [r.name, r.cells])).toEqual([['Bank', [null, null, null]], ['Card', [null, null, null]]])
    expect(state!.lastKnown).toMatchObject({ '["Bank","Robin"]': 1000, '["Card","Robin"]': -50 })
  })

  it('is not offered with one open month', async () => {
    expect(await getCatchUpState(db, new Date('2031-08-10T09:00:00Z'))).toBeNull()
  })

  it.each([
    ['flow rows', "INSERT INTO monthly_cashflow (date, bank, member, active_income, passive_income, expense, currency) VALUES ('2031-08-01', 'Bank', 'Robin', 1, 0, 0, 'RUB')"],
    ['an account transfer', "INSERT INTO account_transfers (date, name, member, amount, currency) VALUES ('2031-08-01', 'Bank', 'Robin', 5, 'RUB')"],
    ['module lines', "INSERT INTO spending_categories (name, kind) VALUES ('Food', 'mandatory'); INSERT INTO category_spending (date, category_id, source, amount, currency) SELECT '2031-08-01', id, 'manual', 9, 'RUB' FROM spending_categories WHERE name = 'Food'"],
    ['a balance of an account the grid does not ask for', "INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2031-08-31', 'bank', 'New', 7, 'RUB', 'Robin')"],
  ])('leaves a month with %s to the wizard', async (_what, sql) => {
    db.sqlite.exec(sql)
    expect(await getCatchUpState(db, NOW)).toMatchObject({ months: ['2031-07'], leftOut: '2031-08' })
  })

  it('leaves a month with loan payments to the wizard', async () => {
    db.sqlite.exec(`INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, currency, member, payment_day, status)
      VALUES ('Car', '2031-01-15', 12000, 0, 12, 1000, 'RUB', 'Robin', 15, 'active');
      INSERT INTO loan_payments (date, loan_name, amount, currency) VALUES ('2031-08-01', 'Car', 1000, 'RUB')`)
    expect(await getCatchUpState(db, NOW)).toMatchObject({ months: ['2031-07'], leftOut: '2031-08' })
  })

  it('leaves a month whose draft has flows to the wizard; a balances-only draft fills the cells', async () => {
    db.sqlite.prepare('INSERT INTO month_drafts (month, payload, updated_at) VALUES (?, ?, ?)').run('2031-07', JSON.stringify({ rows: [
      { name: 'Bank', member: 'Robin', currency: 'RUB', class: 'bank', balance: 1100, active: null, passive: null, expense: null, closing: false, added: false },
    ] }), 't')
    expect((await getCatchUpState(db, NOW))!.rows[0].cells).toEqual([1100, null, null])
    db.sqlite.prepare('UPDATE month_drafts SET payload = ? WHERE month = ?').run(JSON.stringify({ rows: [
      { name: 'Bank', member: 'Robin', currency: 'RUB', class: 'bank', balance: 1100, active: 10, passive: null, expense: null, closing: false, added: false },
    ] }), '2031-07')
    expect(await getCatchUpState(db, NOW)).toBeNull()
  })

  it('with flows off checks drafts, transfers and module lines', async () => {
    db.sqlite.exec(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '0');
      INSERT INTO monthly_cashflow (date, bank, member, active_income, passive_income, expense, currency) VALUES ('2031-08-01', 'Bank', 'Robin', 1, 0, 0, 'RUB')`)
    expect(await getCatchUpState(db, NOW)).toMatchObject({ months: MONTHS, leftOut: null })
    db.sqlite.exec("INSERT INTO account_transfers (date, name, member, amount, currency) VALUES ('2031-09-01', 'Bank', 'Robin', 5, 'RUB')")
    expect(await getCatchUpState(db, NOW)).toMatchObject({ months: ['2031-07', '2031-08'], leftOut: '2031-09' })
  })
})

describe('closing the grid', () => {
  it('closes every grid month in one write, closed_by the member, no cashflow rows', async () => {
    const state = await close()
    expect(state.queue).toEqual(['2031-10'])
    const closed = all(db, "SELECT month, closed_at, closed_by FROM closed_months WHERE month >= '2031-07' ORDER BY month")
    expect(closed.map(c => c.month)).toEqual(MONTHS)
    expect(new Set(closed.map(c => c.closed_at)).size).toBe(1)
    expect(closed.every(c => c.closed_by === 'owner@example.com')).toBe(true)
    expect(all(db, "SELECT date, name, value FROM assets WHERE date > '2031-06-30' ORDER BY date, name")).toEqual([
      { date: '2031-07-31', name: 'Bank', value: 1100 }, { date: '2031-07-31', name: 'Card', value: -40 },
      { date: '2031-08-31', name: 'Bank', value: 1200 }, { date: '2031-08-31', name: 'Card', value: -30 },
      { date: '2031-09-30', name: 'Bank', value: 1300 }, { date: '2031-09-30', name: 'Card', value: -20 },
    ])
    expect(all(db, "SELECT COUNT(*) AS n FROM monthly_cashflow WHERE date > '2031-06-01'")).toEqual([{ n: 0 }])
    expect(all(db, "SELECT month, revision FROM month_draft_revisions WHERE month >= '2031-07' ORDER BY month")).toEqual(MONTHS.map(month => ({ month, revision: 1 })))
  })

  it('writes distinct rowids and journal entries for every month', async () => {
    await close()
    const rows = all(db, "SELECT rowid FROM assets WHERE date > '2031-06-30'")
    expect(new Set(rows.map(r => r.rowid)).size).toBe(6)
    const log = all(db, "SELECT row_id, ts FROM change_log WHERE table_name = 'assets' AND op = 'insert'")
    expect(log).toHaveLength(6)
    expect(new Set(log.map(l => l.row_id))).toEqual(new Set(rows.map(r => r.rowid)))
    expect(new Set(log.map(l => l.ts)).size).toBe(1)
  })

  it('replaces a balance entered outside the wizard', async () => {
    db.sqlite.exec("INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2031-07-31', 'bank', 'Bank', 999, 'RUB', 'Robin')")
    expect((await getCatchUpState(db, NOW))!.rows[0].cells[0]).toBe(999)
    await close()
    expect(all(db, "SELECT value FROM assets WHERE date = '2031-07-31' AND name = 'Bank'")).toEqual([{ value: 1100 }])
  })

  it('refuses a stale token and writes nothing', async () => {
    const stale = (await getCatchUpState(db, NOW))!.revision
    await saveDraft(db, '2031-07', { rows: [], expectedRevision: (await getMonthCloseState(db, NOW)).draftRevision }, NOW)
    const before = all(db, 'SELECT * FROM closed_months')
    await expect(close(undefined, stale)).rejects.toMatchObject({ code: 'draft_conflict', status: 409 })
    expect(all(db, 'SELECT * FROM closed_months')).toEqual(before)
  })

  it('refuses empty cells with the months that miss them', async () => {
    await expect(close(cells([1100, null, 1300], [-40, -30, -20]))).rejects.toMatchObject({ code: 'month_has_problems', status: 422, params: { months: ['2031-08'] } })
    expect(all(db, "SELECT COUNT(*) AS n FROM closed_months WHERE month >= '2031-07'")).toEqual([{ n: 0 }])
  })

  it('refuses rows that do not match the grid', async () => {
    await expect(close([{ name: 'Bank', member: 'Robin', cells: [1, 2, 3] }])).rejects.toMatchObject({ code: 'invalid_catch_up', status: 400 })
    await expect(close(cells([1.234, 2, 3], [1, 2, 3]))).rejects.toMatchObject({ code: 'invalid_catch_up' })
  })

  it('then leaves October to the wizard, and the newest grid month reopens into it with its balances', async () => {
    await close()
    expect((await getMonthCloseState(db, NOW)).month).toBe('2031-10')
    expect(await getCatchUpState(db, NOW)).toBeNull()
    const reopened = await reopenMonth(db, '2031-09', actor, NOW)
    expect(reopened.month).toBe('2031-09')
    expect(reopened.rows.map(r => [r.name, r.balance, r.active])).toEqual([['Bank', 1300, null], ['Card', -20, null]])
  })

  it('lists the grid months\' milestones without announcing them', async () => {
    db.sqlite.exec(`INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, currency, member, payment_day, status, closed_date)
      VALUES ('Car', '2030-08-15', 1200, 0, 12, 100, 'RUB', 'Robin', 15, 'closed', '2031-07-15')`)
    await close()
    const s = await getSnapshot(db, { download: false })
    expect(s.milestones?.filter(m => m.kind === 'loanPaidOff')).toMatchObject([{ month: '2031-07', celebrated: true, announced: false }])
  })
})
