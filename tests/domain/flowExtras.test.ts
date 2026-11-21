import { describe, expect, it } from 'vitest'
import { monthFlowExtras } from '../../src/domain/flowExtras'
import { round2 } from '../../src/domain/fx'
import type { ScheduleRow } from '../../src/domain/loans'
import type { LoanRow } from '../../src/domain/loans'
import type { CashflowRowBase, FlowExtra, MonthChange } from '../../src/domain/types'
import { demoFamilyData } from '../helpers/demoFamily'

// the English demo family on 12.11.2026; its year runs October 2025 – September 2026
const { snapshot } = await demoFamilyData()
const YEAR = Array.from({ length: 12 }, (_, i) => `${i < 3 ? 2025 : 2026}-${String(((i + 9) % 12) + 1).padStart(2, '0')}`)
type Known = Exclude<FlowExtra, { noRate: true }>
const known = (e: FlowExtra | undefined): Known | null => (e && !('noRate' in e) ? e : null)
const inYear = () => (snapshot.flowExtras ?? []).filter(e => YEAR.includes(e.month)).map(e => known(e)!)
const total = (pick: (e: Exclude<FlowExtra, { noRate: true }>) => number) => round2(inYear().reduce((n, e) => n + pick(e), 0))
const loansTotal = (key: 'payment' | 'principal' | 'interest') => total(e => e.loans.reduce((n, l) => n + l[key], 0))

describe('the flow extras of the demo year', () => {
  it('cover every month of the year with known rates', () => {
    expect(inYear().map(e => e.month)).toEqual(YEAR)
  })

  it('payments 36,777.36, principal 11,084.22, interest 25,693.14, invested 4,200.00', () => {
    expect(loansTotal('payment')).toBe(36777.36)
    expect(loansTotal('principal')).toBe(11084.22)
    expect(loansTotal('interest')).toBe(25693.14)
    expect(total(e => e.invested)).toBe(4200)
  })

  it('principal is rounded per loan and month as What changed our net worth rounds it', () => {
    for (const change of snapshot.capitalChange ?? []) {
      if (!YEAR.includes(change.month) || !('items' in change)) continue
      const paid = (change as MonthChange).items.debtPaid ?? []
      const extra = known(snapshot.flowExtras?.find(e => e.month === change.month))!
      for (const l of extra.loans) expect(l.principal, `${change.month} ${l.name}`).toBe(paid.find(p => p.name === l.name)?.amount ?? 0)
    }
  })

  it('February 2026 has principal 929 and no trace of the 7,500 early repayment', () => {
    const feb = known(snapshot.flowExtras?.find(e => e.month === '2026-02'))!
    expect(round2(feb.loans.reduce((n, l) => n + l.principal, 0))).toBe(929)
    expect(feb.loans.every(l => round2(l.principal + l.interest) === l.payment)).toBe(true)
  })
})

// a small hand-built month: one USD loan with a schedule, one EUR loan without, an EUR investment deposit
const loan = (name: string, currency: string, issue = '2024-01-01'): LoanRow =>
  ({ name, currency, issue_date: issue, principal: 10000, member: 'Robin' }) as LoanRow
const sched = (date: string, principalPart: number): ScheduleRow => ({ date, principalPart }) as ScheduleRow
const pay = (month: string, name: string, expenseBase: number | null): CashflowRowBase =>
  ({ month, bank: name, member: 'Robin', currency: 'USD', loan: true, active: 0, passive: 0, expense: expenseBase ?? 0, activeBase: 0, passiveBase: 0, expenseBase })
// rates are units of a currency per US dollar
const rates = (eur: number | null) => (): Record<string, number> => (eur === null ? { USD: 1 } : { USD: 1, EUR: eur })
const base = { schedules: new Map([['Home', [sched('2026-05-15', 300.004), sched('2026-05-20', 0.003), sched('2026-06-15', 301)]], ['Car', [sched('2026-05-10', 900)]]]), loans: [loan('Home', 'USD'), loan('Car', 'EUR', '2026-05-03'), loan('Old', 'USD')], transfers: [], base: 'USD' }

describe('monthFlowExtras', () => {
  it('rounds a loan’s principal once per month, at the month-end rate', () => {
    const [may] = monthFlowExtras({ ...base, months: ['2026-05'], cashflow: [pay('2026-05', 'Home', 1000)], rateAt: rates(1.1) })
    expect(may).toEqual({ month: '2026-05', loans: [{ name: 'Home', payment: 1000, principal: 300.01, interest: 699.99 }], invested: 0, newLoans: ['Car'] })
  })

  it('principal never exceeds the recorded payment, interest never negative', () => {
    const [may] = monthFlowExtras({ ...base, months: ['2026-05'], cashflow: [pay('2026-05', 'Car', 500)], rateAt: rates(1.1) })
    expect(known(may)!.loans).toEqual([{ name: 'Car', payment: 500, principal: 500, interest: 0 }])
  })

  it('a month without loan rows has no loans; a payment without its schedule row in the month stays out (it lands in Not split)', () => {
    const [jun, jul] = monthFlowExtras({ ...base, months: ['2026-06', '2026-07'], cashflow: [pay('2026-07', 'Old', 120), pay('2026-07', 'Home', 300)], rateAt: rates(1.1) })
    expect(known(jun)!.loans).toEqual([])
    // Old has no schedule at all; Home's schedule has no row in July (paid late, or after its end)
    expect(known(jul)!.loans).toEqual([])
  })

  it('deposits into investment accounts count at the month-end rate, withdrawals subtract', () => {
    const transfers = [
      { date: '2026-06-03', name: 'Broker', member: 'Robin', amount: 1000, currency: 'EUR' },
      { date: '2026-06-20', name: 'Broker', member: 'Robin', amount: -250, currency: 'EUR' },
    ]
    const [jun] = monthFlowExtras({ ...base, transfers, months: ['2026-06'], cashflow: [], rateAt: rates(1.1) })
    expect(known(jun)!.invested).toBe(681.82) // 750 EUR at 1.1 EUR a dollar
  })

  it('a missing rate makes the month noRate', () => {
    const noEur = monthFlowExtras({ ...base, months: ['2026-05'], cashflow: [pay('2026-05', 'Car', 500)], rateAt: rates(null) })
    expect(noEur).toEqual([{ month: '2026-05', noRate: true }])
    const unknownPayment = monthFlowExtras({ ...base, months: ['2026-05'], cashflow: [pay('2026-05', 'Home', null)], rateAt: rates(1.1) })
    expect(unknownPayment).toEqual([{ month: '2026-05', noRate: true }])
    const transfers = [{ date: '2026-06-03', name: 'Broker', member: 'Robin', amount: 1000, currency: 'EUR' }]
    expect(monthFlowExtras({ ...base, transfers, months: ['2026-06'], cashflow: [], rateAt: rates(null) })).toEqual([{ month: '2026-06', noRate: true }])
  })
})

describe('monthFlowExtras and capitalChange agree on a foreign loan', () => {
  it('the native principal is rounded to cents before the rate, as capitalChange rounds it', () => {
    // 100.002 + 100.002 EUR = 200.004, rounded 200.00, at 2 USD a euro: 400.00 (the unrounded sum would give 400.01)
    const schedules = new Map([['Flat', [sched('2026-05-10', 100.002), sched('2026-05-20', 100.002)]]])
    const [may] = monthFlowExtras({ ...base, schedules, loans: [loan('Flat', 'EUR')], months: ['2026-05'], cashflow: [pay('2026-05', 'Flat', 1000)], rateAt: rates(0.5) })
    expect(known(may)!.loans[0]).toMatchObject({ principal: 400, interest: 600 })
  })
})
