import { afterEach, describe, expect, it, vi } from 'vitest'
import { balanceFromSchedule, calcMonthlyPayment, computeSchedule, LOAN_TYPES, type LoanRow } from '../../../src/domain/loans'
import { round2 } from '../../../src/domain/fx'
import { LOAN_TYPE_OPTIONS } from '../../../src/pages/admin/loans/loanForm'
import { ADVISOR_TOOLS } from '../../../src/modules/advisor/tools/registry'
import { advisorHarness } from './harness'

interface Preview {
  draftId: string
  row: Record<string, unknown>
  summary: { payoffDate: string | null; totalInterest: number; remainingBalanceToday: number; nextPayment: { date: string; amount: number } | null }
  warnings: { code: string; params?: Record<string, unknown> }[]
  note: string | null
  nextStep: string
}
interface Commit { row: Record<string, unknown>; loanLineThisMonth: boolean; warnings: Preview['warnings'] }

const LOAN = { name: 'Lakeview Mortgage', issue_date: '2026-03-15', principal: 120000, rate: 5.5, term_months: 240, currency: 'USD', member: 'Ryan', type: 'mortgage' }
const PAYMENT = round2(calcMonthlyPayment(120000, 5.5, 240))

function setup() {
  const h = advisorHarness()
  const count = () => (h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM loans').get() as { n: number }).n
  const refused = async (tool: string, input: unknown, status: number, code: string, params?: Record<string, unknown>) => {
    const res = await h.call(tool, input)
    expect(await res.json()).toEqual({ error: params ? { code, params } : { code } })
    expect(res.status).toBe(status)
  }
  return { h, count, refused, preview: (over: Record<string, unknown> = {}) => h.result<Preview>('preview_loan', { ...LOAN, ...over }) }
}

describe('the loan tools', () => {
  it('are edit tools; the preview is read-only and the form shares the loan types', () => {
    const tools = Object.fromEntries(ADVISOR_TOOLS.map(t => [t.name, t]))
    expect(tools.preview_loan).toMatchObject({ right: 'edit', readOnly: true })
    expect(tools.commit_loan).toMatchObject({ right: 'edit' })
    expect(tools.commit_loan.readOnly).toBeUndefined()
    expect(LOAN_TYPE_OPTIONS.map(([v]) => v)).toEqual([...LOAN_TYPES])
  })

  it('previews without writing, fills the computed payment and the summary', async () => {
    const t = setup()
    const before = t.count()
    const p = await t.preview({ note: 'from the contract' })
    expect(t.count()).toBe(before)
    expect(p.row).toEqual({ ...LOAN, monthly_payment: PAYMENT })
    expect(p.row).not.toHaveProperty('description')
    expect(p.warnings).toEqual([])
    expect(p.note).toBe('from the contract')
    expect(p.summary.payoffDate).toBe('2046-03-15')
    expect(p.summary.totalInterest).toBeGreaterThan(0)
    expect(p.summary.remainingBalanceToday).toBeGreaterThan(0)
    expect(p.summary.nextPayment).toMatchObject({ amount: PAYMENT })
    expect(p.nextStep).toContain('commit_loan')
  })

  it('warns when a given payment is a cent off the annuity and stores the given one', async () => {
    const t = setup()
    const p = await t.preview({ monthly_payment: PAYMENT + 0.01, payment_day: 5 })
    expect(p.warnings).toEqual([{ code: 'payment_differs', params: { given: PAYMENT + 0.01, computed: PAYMENT } }])
    expect(p.row).toMatchObject({ monthly_payment: PAYMENT + 0.01, payment_day: 5 })
    expect((await t.preview({ monthly_payment: PAYMENT })).warnings).toEqual([])
  })

  it('refuses at preview: a taken name, unknown member and currency, a bad name, a long term, a bad type', async () => {
    const t = setup()
    const existing = (t.h.db.sqlite.prepare('SELECT name FROM loans LIMIT 1').get() as { name: string }).name
    await t.refused('preview_loan', { ...LOAN, name: existing }, 409, 'advisor.loan_exists', { name: existing })
    await t.refused('preview_loan', { ...LOAN, member: 'Nobody' }, 400, 'unknown_member', { members: expect.any(Array) })
    await t.refused('preview_loan', { ...LOAN, currency: 'XXX' }, 400, 'unknown_currency', { currencies: expect.any(Array) })
    await t.refused('preview_loan', { ...LOAN, name: 'Bad‮name' }, 400, 'advisor.invalid_name', { field: 'name' })
    await t.refused('preview_loan', { ...LOAN, term_months: 421 }, 400, 'invalid_value', { column: 'term_months' })
    await t.refused('preview_loan', { ...LOAN, type: 'boat' }, 400, 'invalid_value', { column: 'type' })
    for (const date of ['2026-13-01', '2026-00-10', '2026-02-30']) {
      await t.refused('preview_loan', { ...LOAN, issue_date: date }, 400, 'invalid_param', { param: 'issue_date' })
    }
    expect(t.count()).toBeGreaterThan(0)
  })

  it('commits once: one journaled insert (the actor source passes through) with no description, and the loan line flag', async () => {
    const t = setup()
    const p = await t.preview({ note: 'kept out of the row' })
    const c = await t.h.result<Commit>('commit_loan', { draftId: p.draftId })
    expect(c.row).toEqual(p.row)
    expect(c.loanLineThisMonth).toBe(true)
    const stored = t.h.db.sqlite.prepare('SELECT * FROM loans WHERE name = ?').get(LOAN.name) as Record<string, unknown>
    expect(stored).toMatchObject({ ...LOAN, monthly_payment: PAYMENT, description: null })
    const log = t.h.db.sqlite.prepare("SELECT source, op FROM change_log WHERE table_name = 'loans'").all()
    // the HTTP harness acts as the site's own session; over the MCP endpoint the same actor carries source 'mcp'
    expect(log).toEqual([{ source: 'admin', op: 'insert' }])
    await t.refused('commit_loan', { draftId: p.draftId }, 409, 'advisor.draft_not_found')
  })

  it('reports a loan line this month only when the new loan pays in the open month', async () => {
    const t = setup()
    const open = (await t.h.result<{ month: string }>('get_month_draft')).month
    const later = `${Number(open.slice(0, 4)) + 1}-01-15`
    const p = await t.preview({ name: 'Later Loan', issue_date: later })
    expect((await t.h.result<Commit>('commit_loan', { draftId: p.draftId })).loanLineThisMonth).toBe(false)
  })

  it('refuses a name taken between preview and commit, writing no second row', async () => {
    const t = setup()
    const p = await t.preview()
    t.h.db.sqlite.prepare("INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, currency, member) VALUES (?, '2026-01-01', 1, 1, 12, 1, 'USD', 'Ryan')").run(LOAN.name)
    const before = t.count()
    await t.refused('commit_loan', { draftId: p.draftId }, 409, 'advisor.loan_exists', { name: LOAN.name })
    expect(t.count()).toBe(before)
  })

  it.each([
    ['member', "UPDATE members SET name = 'Gone' WHERE name = 'Ryan'"],
    ['currency', "DELETE FROM currencies WHERE code = 'USD'"],
  ])('refuses advisor.draft_stale when the previewed %s is gone by the commit, writing nothing', async (_what, sql) => {
    const t = setup()
    const p = await t.preview()
    t.h.db.sqlite.exec(sql)
    const before = t.count()
    await t.refused('commit_loan', { draftId: p.draftId }, 409, 'advisor.draft_stale')
    expect(t.count()).toBe(before)
  })

  it('reports no loan line this month while income and expenses are not tracked', async () => {
    const t = setup()
    const p = await t.preview()
    t.h.db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '0')")
    expect((await t.h.result<Commit>('commit_loan', { draftId: p.draftId })).loanLineThisMonth).toBe(false)
  })

  it('a statement draft id is not found by commit_loan and stays committable; a loan draft id likewise by commit_statement', async () => {
    const t = setup()
    const month = (await t.h.result<{ month: string; rows: { name: string; member: string; currency: string }[] }>('get_month_draft'))
    const { name, member, currency } = month.rows[0]
    const statement = await t.h.result<{ draftId: string }>('preview_statement', { month: month.month, account: { name, member, currency }, balance: 1000, active: 10, passive: 0, expense: 5 })
    const loan = await t.preview()
    await t.refused('commit_loan', { draftId: statement.draftId }, 409, 'advisor.draft_not_found')
    await t.refused('commit_statement', { draftId: loan.draftId }, 409, 'advisor.draft_not_found')
    // neither was consumed by the refusal
    await t.h.result('commit_statement', { draftId: statement.draftId })
    await t.h.result('commit_loan', { draftId: loan.draftId })
  })

  it('reports the balance today as the Loans page does: after last month\u2019s payment while this month\u2019s is still ahead', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
      const p = await setup().preview()
      const schedule = computeSchedule({ rowid: 0, ...LOAN, monthly_payment: PAYMENT, payment_day: null, status: 'active', closed_date: null }, [])
      const row = (date: string) => schedule.find(r => r.date === date)!
      expect(p.summary.remainingBalanceToday).toBe(round2(row('2026-10-15').closingBalance))
      expect(p.summary.remainingBalanceToday).not.toBe(round2(row('2026-11-15').closingBalance))
    } finally { vi.useRealTimers() }
  })

  it('a rate of 0 gives a finite schedule and a payment of principal over term', async () => {
    const t = setup()
    const p = await t.preview({ rate: 0 })
    expect(p.row.monthly_payment).toBe(round2(120000 / 240))
    expect(p.warnings).toEqual([])
    expect(p.summary.totalInterest).toBe(0)
    for (const n of [p.summary.totalInterest, p.summary.remainingBalanceToday, p.summary.nextPayment?.amount ?? 0]) expect(Number.isFinite(n)).toBe(true)
    expect(p.summary.payoffDate).toBe('2046-03-15')
  })

  describe('the bank\'s remaining balance', () => {
    const DATE = '2026-09-30'
    /** The schedule's balance of the previewed loan on `date`: a new loan has no early payments */
    const scheduleBalance = (over: Partial<LoanRow> = {}, date = DATE) => {
      const loan: LoanRow = { rowid: 0, ...LOAN, monthly_payment: PAYMENT, payment_day: null, status: 'active', closed_date: null, ...over }
      return balanceFromSchedule(loan, computeSchedule(loan, []), date)!
    }

    it('equal to the schedule\'s on that day warns of nothing; beyond the tolerance it adds loan_balance_differs', async () => {
      const t = setup()
      const raw = scheduleBalance()
      expect((await t.preview({ bank_balance: round2(raw), bank_balance_date: DATE })).warnings).toEqual([])
      // 120,000 at 5.5 %: one month's interest on the principal, 550, is tolerated
      expect((await t.preview({ bank_balance: round2(raw - 550), bank_balance_date: DATE })).warnings).toEqual([])
      const bank = round2(raw - 600)
      const p = await t.preview({ bank_balance: bank, bank_balance_date: DATE })
      const drift = { code: 'loan_balance_differs', params: { name: LOAN.name, bank, scheduled: round2(raw), diff: round2(bank - round2(raw)), tolerance: 550, date: DATE, currency: 'USD' } }
      expect(p.warnings).toEqual([drift])
      expect(p.row).not.toHaveProperty('bank_balance')
      expect(p.row).not.toHaveProperty('bank_balance_date')
      // beside a payment that differs
      expect((await t.preview({ monthly_payment: PAYMENT + 1, bank_balance: bank, bank_balance_date: DATE })).warnings.map(w => w.code)).toEqual(['payment_differs', 'loan_balance_differs'])
    })

    it('on the issue day or later is allowed: before the first installment the schedule holds the principal', async () => {
      const t = setup()
      expect((await t.preview({ bank_balance: 120000, bank_balance_date: LOAN.issue_date })).warnings).toEqual([])
    })

    describe('a date in the future', () => {
      afterEach(() => { vi.useRealTimers() })
      const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)) }

      it('today and tomorrow (one lenient day for time zones) are accepted, the day after tomorrow and 2099 are refused', async () => {
        const t = setup()
        at('2026-10-10T12:00:00Z')
        for (const date of ['2026-10-10', '2026-10-11']) {
          expect((await t.preview({ bank_balance: 120000, bank_balance_date: date })).warnings).toHaveLength(1)
        }
        for (const date of ['2026-10-12', '2099-01-01']) {
          await t.refused('preview_loan', { ...LOAN, bank_balance: 120000, bank_balance_date: date }, 400, 'invalid_param', { param: 'bank_balance_date' })
        }
      })
    })

    it('a rate of 0 tolerates one unit only', async () => {
      const t = setup()
      const raw = scheduleBalance({ rate: 0, monthly_payment: round2(120000 / 240) })
      expect((await t.preview({ rate: 0, bank_balance: raw - 1.5, bank_balance_date: DATE })).warnings).toEqual([
        { code: 'loan_balance_differs', params: expect.objectContaining({ diff: -1.5, tolerance: 1 }) },
      ])
      expect((await t.preview({ rate: 0, bank_balance: raw - 0.99, bank_balance_date: DATE })).warnings).toEqual([])
    })

    it('refuses one without the other, a date that is not a day or comes before the issue, and a negative balance', async () => {
      const t = setup()
      await t.refused('preview_loan', { ...LOAN, bank_balance: 1000 }, 400, 'missing_param', { param: 'bank_balance_date' })
      await t.refused('preview_loan', { ...LOAN, bank_balance_date: DATE }, 400, 'missing_param', { param: 'bank_balance' })
      for (const date of ['yesterday', '2026-02-30', '2026-13-01', '2026-00-10', 5, '2026-03-14']) {
        await t.refused('preview_loan', { ...LOAN, bank_balance: 1000, bank_balance_date: date }, 400, 'invalid_param', { param: 'bank_balance_date' })
      }
      await t.refused('preview_loan', { ...LOAN, bank_balance: -1, bank_balance_date: DATE }, 400, 'invalid_amount')
      await t.refused('preview_loan', { ...LOAN, bank_balance: 'x', bank_balance_date: DATE }, 400, 'invalid_param', { param: 'bank_balance' })
    })

    it('the commit saves the bare row and echoes the preview\'s warnings', async () => {
      const t = setup()
      const p = await t.preview({ bank_balance: round2(scheduleBalance() - 600), bank_balance_date: DATE })
      const c = await t.h.result<Commit>('commit_loan', { draftId: p.draftId })
      expect(c.row).toEqual(p.row)
      expect(c.warnings).toEqual(p.warnings)
      expect(c.warnings).toHaveLength(1)
      const stored = t.h.db.sqlite.prepare('SELECT * FROM loans WHERE name = ?').get(LOAN.name) as Record<string, unknown>
      expect(stored).toMatchObject({ ...LOAN, monthly_payment: PAYMENT })
      expect(stored).not.toHaveProperty('bank_balance')
    })
  })
})
