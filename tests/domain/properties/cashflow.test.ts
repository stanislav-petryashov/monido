// Properties of the Income and expenses figures (src/domain/cashflowPeriod.ts) and of the allocation by category
// (src/domain/spending.ts) for generated months of account rows, loan payments, lines and free sources.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { convertCashflow, convertLoanPayments } from '../../../src/domain/cashflow'
import { categoryUsual, periodFlows, periodMembers, periodMonths } from '../../../src/domain/cashflowPeriod'
import { monthsBetween } from '../../../src/domain/dates'
import { round2 } from '../../../src/domain/fx'
import { allocatedByFlow, allocationExcess, allocationSummary, categorisedMonths, FLOWS_OF } from '../../../src/domain/spending'
import type { CashflowInput, CategoryFlow, CategorySpendingInput, FlowLineInput, LoanPaymentInput, Rates, SpendingCategory, Warning } from '../../../src/domain/types'
import { RATELESS, cents, currency, months, rates, runs } from '../../helpers/arbitraries'

const RUNS = runs(120)
const BASE = 'USD'
const MEMBERS = ['Robin', 'Noa']
const CATEGORIES: SpendingCategory[] = [
  { id: 1, name: 'Groceries', kind: 'mandatory', flow: 'expense', oneOff: false },
  { id: 2, name: 'Travel', kind: 'optional', flow: 'expense', oneOff: false },
  { id: 3, name: 'Loans', kind: 'loan_payment', flow: 'expense', oneOff: false },
  { id: 4, name: 'Salary', kind: 'optional', flow: 'active', oneOff: false },
  { id: 5, name: 'Bonus', kind: 'optional', flow: 'active', oneOff: true },
  { id: 6, name: 'Dividends', kind: 'optional', flow: 'passive', oneOff: false },
]
const USABLE = CATEGORIES.filter(c => c.kind !== 'loan_payment')
const flowOf = (id: number) => CATEGORIES.find(c => c.id === id)!.flow
const amountOf = (r: CashflowInput, flow: CategoryFlow) => (flow === 'active' ? r.active_income : flow === 'passive' ? r.passive_income : r.expense)

/** One account of a member in a currency, some of them rateless when `rateless` */
const account = (rateless: boolean) => fc.record({
  bank: fc.constantFrom('Checking', 'Savings', 'Card'), member: fc.constantFrom(...MEMBERS),
  currency: rateless ? fc.oneof({ weight: 9, arbitrary: currency() }, { weight: 1, arbitrary: fc.constant(RATELESS) }) : currency(),
})

/**
 * Months of account rows, loan payments, lines and free-source spending. `fit` keeps every account's lines within its
 * totals and the free sources within the month's pool (no `lines_exceed_total`); otherwise a line may be anything.
 */
const family = (o: { rateless?: boolean; fit?: boolean } = {}) => fc.record({
  months: months(1, 8),
  accounts: fc.uniqueArray(account(!!o.rateless), { minLength: 1, maxLength: 3, selector: a => `${a.bank}|${a.member}` }),
  rates: rates(),
  seeds: fc.array(fc.record({
    active: cents(0, 9_000), passive: cents(0, 500), expense: cents(0, 8_000), loan: fc.option(cents(1, 1_500), { freq: 3 }),
    lines: fc.array(fc.record({ category: fc.constantFrom(...USABLE.map(c => c.id)), share: fc.integer({ min: 0, max: o.fit ? 50 : 150 }) }), { maxLength: 4 }),
    free: fc.option(fc.record({ category: fc.constantFrom(1, 2), share: fc.integer({ min: 0, max: o.fit ? 100 : 300 }) }), { freq: 3 }),
    present: fc.integer({ min: 0, max: 9 }),
  }), { minLength: 24, maxLength: 24 }),
}).map(({ months, accounts, rates, seeds }) => {
  const cashflow: CashflowInput[] = [], loanPayments: LoanPaymentInput[] = [], flowLines: FlowLineInput[] = [], categorySpending: CategorySpendingInput[] = []
  let k = 0
  for (const m of months) {
    const date = `${m}-01`
    let freeRoom = 0
    for (const a of accounts) {
      const s = seeds[k++ % seeds.length]
      if (s.present === 0 && a !== accounts[0]) continue // an account without its row this month
      const row: CashflowInput = { date, bank: a.bank, member: a.member, currency: a.currency, active_income: s.active, passive_income: s.passive, expense: s.expense }
      cashflow.push(row)
      // two lines of the same category on one account are kept apart; `fit` lines take at most half of what is left each
      const used: Record<CategoryFlow, number> = { active: 0, passive: 0, expense: 0 }
      for (const l of s.lines) {
        const flow = flowOf(l.category), total = amountOf(row, flow)
        const amount = o.fit ? Math.floor((total - used[flow]) * l.share) / 100 : Math.round(total * l.share) / 100
        used[flow] = round2(used[flow] + amount)
        flowLines.push({ date, bank: a.bank, member: a.member, category_id: l.category, amount })
      }
      if (a.currency === BASE) freeRoom += row.expense - used.expense
      if (s.loan !== null) loanPayments.push({ date, loan_name: `Loan ${a.member}`, amount: s.loan, currency: BASE })
      if (s.free && (!o.fit || a.currency === BASE)) {
        // `fit`: a free source in the base currency within the base-currency accounts' remainder
        const amount = o.fit ? Math.floor(freeRoom * s.free.share / 2) / 100 : round2(s.expense * s.free.share / 100)
        freeRoom -= amount
        categorySpending.push({ date, category_id: s.free.category, source: 'Cash', amount, currency: BASE })
      }
    }
  }
  const rateAt = (): Rates => rates
  const loans = MEMBERS.map(member => ({ name: `Loan ${member}`, member }))
  const cfRows = [...convertCashflow(cashflow, rateAt, BASE), ...convertLoanPayments(loanPayments, loans, rateAt, BASE)]
  return { months, cfRows, rateAt, lines: { flowLines, categorySpending } }
})

const monthsOf = (rows: { month: string }[]) => [...new Set(rows.map(r => r.month))].sort()
const ratelessIn = (rows: ReturnType<typeof convertCashflow>, ms: string[]) =>
  rows.some(r => ms.includes(r.month) && [r.activeBase, r.passiveBase, r.expenseBase].includes(null))

describe('periodFlows', () => {
  it('income is active plus passive, net is income less expenses, to the cent', () => {
    fc.assert(fc.property(family({ rateless: true }), ({ cfRows }) => {
      const ms = monthsOf(cfRows)
      const p = periodFlows(cfRows, ms)
      if (ratelessIn(cfRows, ms)) return p === null
      return p !== null && p.income === round2(p.active + p.passive) && p.net === round2(p.income - p.expense) && p.months === ms.length
    }), RUNS)
  })

  it('a period is the sum of its months; unknown when any of its months has a rateless row', () => {
    fc.assert(fc.property(family({ rateless: true }), ({ cfRows }) => {
      const ms = monthsOf(cfRows)
      const whole = periodFlows(cfRows, ms)
      const each = ms.map(m => periodFlows(cfRows, [m]))
      if (each.some(e => e === null)) return whole === null
      for (const k of ['income', 'active', 'passive', 'expense', 'net'] as const) {
        expect(whole![k]).toBe(round2(each.reduce((s, e) => s + e![k], 0)))
      }
    }), RUNS)
  })

  it('the members split the period: their income and expenses sum to the period\'s', () => {
    fc.assert(fc.property(family({ rateless: true }), ({ cfRows }) => {
      const ms = monthsOf(cfRows)
      const p = periodFlows(cfRows, ms)
      const members = periodMembers(cfRows, ms)
      if (!p) return members.some(m => m.income === null)
      expect(round2(members.reduce((s, m) => s + m.income!, 0))).toBe(p.income)
      expect(round2(members.reduce((s, m) => s + m.expense!, 0))).toBe(p.expense)
    }), RUNS)
  })
})

describe('periodMonths', () => {
  it('takes exactly the months with flows within the period ending at `end`', () => {
    fc.assert(fc.property(months(1, 30), fc.constantFrom('month', 'quarter', 'year', 'all') as fc.Arbitrary<'month' | 'quarter' | 'year' | 'all'>, fc.nat(), (all, kind, i) => {
      const end = all[i % all.length]
      const length = { month: 1, quarter: 3, year: 12, all: Infinity }[kind]
      const holes = all.filter((_, k) => k % 3 !== 1)
      expect(periodMonths(holes, end, kind)).toEqual(holes.filter(m => m <= end && monthsBetween(m, end) < length))
    }), RUNS)
  })
})

describe('categorisedMonths', () => {
  const both = (f: ReturnType<typeof family> extends fc.Arbitrary<infer T> ? T : never) => {
    const warnings: Warning[] = []
    const run = (direction: 'expense' | 'income') => categorisedMonths(f.lines, CATEGORIES, f.cfRows, direction, f.rateAt, BASE, w => warnings.push(w))
    return { expense: run('expense'), income: run('income'), warnings }
  }

  it('the unallocated rest is never below zero, whatever the lines', () => {
    fc.assert(fc.property(family({ rateless: true }), f => {
      const { expense, income } = both(f)
      return [...expense, ...income].every(m => m.unallocatedBase === null || m.unallocatedBase >= 0)
    }), RUNS)
  })

  it('lines within their totals: the categories plus the unallocated rest are the direction\'s total', () => {
    fc.assert(fc.property(family({ fit: true }), f => {
      const { expense, income, warnings } = both(f)
      expect(warnings.filter(w => w.code === 'lines_exceed_total')).toEqual([])
      for (const m of [...expense, ...income]) {
        // one rounding per category and per account row
        const slack = 0.01 * (m.categories.length + f.cfRows.length + 1)
        expect(m.totalBase).not.toBeNull()
        expect(Math.abs(m.allocatedBase + m.unallocatedBase! - m.totalBase!)).toBeLessThanOrEqual(slack)
        expect(Math.abs(round2(m.categories.reduce((s, c) => s + c.amountBase!, 0)) - m.allocatedBase)).toBeLessThanOrEqual(0.01)
      }
      for (const m of income) {
        for (const flow of ['active', 'passive'] as const) {
          const b = m.byFlow![flow]
          expect(Math.abs(b.allocatedBase + b.unallocatedBase - b.totalBase)).toBeLessThanOrEqual(0.01 * (f.cfRows.length + 1))
        }
      }
    }), RUNS)
  })

  it('categoryUsual over a period: its categories plus the unallocated rest are its total', () => {
    fc.assert(fc.property(family({ fit: true }), f => {
      const { expense, income } = both(f)
      for (const source of [expense, income]) {
        const p = categoryUsual(source, f.months)
        if (p.total === null) continue
        const slack = 0.01 * (source.reduce((n, m) => n + m.categories.length, 0) + f.cfRows.length + 1)
        expect(Math.abs(p.rows.reduce((s, r) => s + r.value!, 0) + p.unallocated! - p.total)).toBeLessThanOrEqual(slack)
      }
    }), RUNS)
  })
})

describe('the allocation editor and the close agree', () => {
  const lines = fc.array(fc.record({ categoryId: fc.constantFrom(...CATEGORIES.map(c => c.id), 99), amount: cents(0, 5_000) }), { maxLength: 6 })
  const totals = fc.record({ active: fc.option(cents(0, 9_000)), passive: fc.option(cents(0, 500)), expense: fc.option(cents(0, 8_000)) })

  it('the header marks a flow over exactly when closing refuses it; within the totals, allocated plus the rest is the total', () => {
    fc.assert(fc.property(lines, totals, (ls, t) => {
      const allocated = allocatedByFlow(ls, CATEGORIES)
      const refused = allocationExcess(ls, CATEGORIES, t).map(e => e.flow)
      for (const direction of ['expense', 'income'] as const) {
        const s = allocationSummary(allocated, t, direction)
        expect(s.over).toEqual(refused.filter(f => FLOWS_OF[direction].includes(f)))
        if (s.rest === null) continue
        expect(s.rest).toBeGreaterThanOrEqual(0)
        if (!s.over.length) expect(round2(s.allocated + s.rest)).toBe(s.total)
      }
    }), RUNS)
  })

  it('an over-allocated flow does not eat another flow\'s remainder', () => {
    fc.assert(fc.property(fc.record({ active: cents(0, 9_000), passive: cents(0, 500), expense: cents(0, 8_000) }), totals, cents(0.01, 1_000), (allocated, t, more) => {
      const over = { ...allocated, active: round2(Math.max(allocated.active, t.active ?? 0) + more) }
      const before = allocationSummary(over, t, 'income').rest
      const after = allocationSummary({ ...over, active: round2(over.active + more) }, t, 'income').rest
      return before === after
    }), RUNS)
  })
})
