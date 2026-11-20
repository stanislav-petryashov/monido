// Properties of "What changed our net worth" (capitalChange, src/domain/capitalChange.ts) through buildSnapshot, for
// generated families: bank accounts in several currencies, an investment account with its deposits, a loan with its
// schedule and an early repayment, a property bought (and revalued the next January), rates moving every month.
// docs/finance-rules.md: the rows always add up to the change; a month that cannot be broken down is a gap with its reason.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isMonthChange } from '../../../src/domain/capitalChange'
import { periodChange } from '../../../src/domain/capitalStory'
import { monthEnd, monthOf, monthsBetween, shiftMonth } from '../../../src/domain/dates'
import { convert, round2 } from '../../../src/domain/fx'
import { computeSchedule, scheduledPaymentIn, type LoanEarlyPayment, type LoanRow } from '../../../src/domain/loans'
import { buildSnapshot } from '../../../src/domain/snapshot'
import type { FinanceRows, FinanceSnapshot, MonthChange, Rates } from '../../../src/domain/types'
import { RATELESS, cents, currency, month, rates, runs } from '../../helpers/arbitraries'

const RUNS = runs(80)

const world = fc.record({
  base: fc.constantFrom('USD', 'EUR', 'RUB'),
  start: month().filter(m => m >= '2026-01' && m <= '2030-12'),
  n: fc.integer({ min: 2, max: 6 }),
  banks: fc.array(fc.record({ currency: currency(), opening: cents(0, 1_000_000) }), { minLength: 1, maxLength: 3 }),
  flows: fc.array(fc.record({ active: cents(0, 9_000), passive: cents(0, 300), expense: cents(0, 8_000) }), { minLength: 18, maxLength: 18 }),
  rates: fc.array(rates(), { minLength: 6, maxLength: 6 }),
  broker: fc.option(fc.record({
    opening: cents(0, 100_000),
    months: fc.array(fc.record({ deposit: cents(-2_000, 5_000), gain: cents(-3_000, 3_000), dividend: cents(0, 200) }), { minLength: 6, maxLength: 6 }),
  })),
  loan: fc.option(fc.record({
    principal: cents(5_000, 500_000), rate: fc.integer({ min: 0, max: 2000 }).map(v => v / 100), term: fc.integer({ min: 3, max: 240 }),
    issued: fc.integer({ min: -12, max: 5 }), issueDay: fc.integer({ min: 1, max: 28 }), payDay: fc.option(fc.integer({ min: 1, max: 31 }), { nil: null }),
    early: fc.option(fc.record({ after: fc.integer({ min: 0, max: 8 }), day: fc.integer({ min: 1, max: 28 }), share: fc.integer({ min: 1, max: 30 }), strategy: fc.constantFrom('reduce_term', 'reduce_payment') })),
  })),
  home: fc.option(fc.record({ bought: fc.integer({ min: 0, max: 5 }), day: fc.integer({ min: 1, max: 28 }), price: cents(20_000, 900_000), revalued: fc.integer({ min: -20, max: 20 }) })),
})
type World = typeof world extends fc.Arbitrary<infer T> ? T : never

const add = (a: number, b: number) => round2(a + b)

/**
 * The family's rows where every balance follows from its records: income and expenses, loan payments and early
 * repayments paid from the first bank account, deposits moved from it to the investment account, the loan's money paid
 * into it, the property paid from it. Rates change at month ends only, so a flow's rate (its month's first day) is its
 * month's end rate.
 */
function rowsOf(w: World): { rows: FinanceRows; rateAt: (date: string) => Rates; today: Date; window: string[] } {
  const window = Array.from({ length: w.n }, (_, i) => shiftMonth(w.start, i))
  const rateAt = (date: string) => w.rates[Math.min(w.n - 1, Math.max(0, monthsBetween(w.start, monthOf(date))))]
  const payer = w.banks[0].currency
  const rows: FinanceRows = {
    assets: [], cashflow: [], loanPayments: [], spendingCategories: [], categorySpending: [], flowLines: [], manualMandatory: null, realEstate: [],
    loans: [], earlyPayments: [], accountTransfers: [], goals: [], parameters: {}, closedMonths: window.map(month => ({ month, source: 'wizard' as const })),
    trackFlows: true, currencies: ['EUR', 'GBP', 'RUB', 'USD'], members: ['Robin'], inflationCurrency: null,
  }
  let loan: LoanRow | null = null
  let schedule: ReturnType<typeof computeSchedule> = []
  if (w.loan) {
    const issueMonth = shiftMonth(w.start, w.loan.issued)
    loan = {
      rowid: 1, name: 'Mortgage', principal: w.loan.principal, rate: w.loan.rate, term_months: w.loan.term, monthly_payment: 0,
      issue_date: `${issueMonth}-${String(w.loan.issueDay).padStart(2, '0')}`, payment_day: w.loan.payDay, currency: payer, member: 'Robin',
      type: 'mortgage', status: 'active', closed_date: null,
    }
    if (w.loan.early) {
      const m = shiftMonth(issueMonth, w.loan.early.after)
      const day = `${m}-${String(w.loan.early.day).padStart(2, '0')}`
      const ep: LoanEarlyPayment = {
        rowid: 1, id: 1, loan_name: 'Mortgage', payment_date: day < loan.issue_date ? loan.issue_date : day,
        amount: round2(w.loan.principal * w.loan.early.share / 100), strategy: w.loan.early.strategy, new_payment: null, principal_credit: null, notes: null,
      }
      rows.earlyPayments.push(ep)
    }
    rows.loans.push(loan)
    schedule = computeSchedule(loan, rows.earlyPayments)
  }
  // what the bank actually took for early repayments, on their own days
  const credits = schedule.flatMap(r => r.earlyCredits ?? [])

  const banks = w.banks.map((b, i) => ({ name: `Bank ${i + 1}`, currency: b.currency, value: b.opening }))
  let broker = w.broker?.opening ?? 0
  window.forEach((m, k) => {
    const date = `${m}-01`
    banks.forEach((b, i) => {
      const f = w.flows[(k * 3 + i) % w.flows.length]
      b.value = add(b.value, f.active + f.passive - f.expense)
      rows.cashflow.push({ date, bank: b.name, member: 'Robin', active_income: f.active, passive_income: f.passive, expense: f.expense, currency: b.currency })
    })
    const payerBank = banks[0]
    if (loan) {
      const payment = round2(scheduledPaymentIn(schedule, m))
      if (payment) rows.loanPayments.push({ date, loan_name: loan.name, amount: payment, currency: loan.currency })
      payerBank.value = add(payerBank.value, -payment)
      for (const c of credits.filter(c => monthOf(c.date) === m)) payerBank.value = add(payerBank.value, -c.amount)
      if (monthOf(loan.issue_date) === m) payerBank.value = add(payerBank.value, Number(loan.principal))
    }
    if (w.broker) {
      const { deposit, gain, dividend } = w.broker.months[k]
      broker = add(broker, deposit + gain + dividend)
      payerBank.value = add(payerBank.value, -deposit)
      rows.cashflow.push({ date, bank: 'Broker', member: 'Robin', active_income: 0, passive_income: dividend, expense: 0, currency: payer })
      rows.accountTransfers!.push({ date, name: 'Broker', member: 'Robin', amount: deposit, currency: payer })
    }
    if (w.home && w.home.bought === k) payerBank.value = add(payerBank.value, -w.home.price)
    for (const b of banks) rows.assets.push({ date: monthEnd(m), class: 'bank', name: b.name, value: b.value, currency: b.currency, member: 'Robin' })
    if (w.broker) rows.assets.push({ date: monthEnd(m), class: 'broker', name: 'Broker', value: broker, currency: payer, member: 'Robin' })
  })
  if (w.home) {
    const bought = shiftMonth(w.start, w.home.bought)
    const year = Number(bought.slice(0, 4))
    const home = { name: 'Flat', purchase_date: `${bought}-${String(w.home.day).padStart(2, '0')}`, purchase_price: w.home.price, purchase_currency: payer, currency: payer, member: 'Robin' }
    rows.realEstate.push({ ...home, valuation_year: year, value: w.home.price })
    rows.realEstate.push({ ...home, valuation_year: year + 1, value: round2(w.home.price * (100 + w.home.revalued) / 100) })
  }
  const today = new Date(`${shiftMonth(window.at(-1)!, 1)}-10T12:00:00Z`)
  return { rows, rateAt, today, window }
}

const build = (w: World, rows: FinanceRows, rateAt: (date: string) => Rates, today: Date) =>
  buildSnapshot({ rows, rateAt, baseCurrency: w.base, familyCurrency: w.base, today })

const total = (m: { rows: MonthChange['rows'] }) => round2(Object.values(m.rows).reduce<number>((a, b) => a + (b ?? 0), 0))
const finite = (m: MonthChange) => [m.start, m.end, ...Object.values(m.rows), ...Object.values(m.items).flat().map(i => i.amount), ...m.pairs.map(p => p.amount)]
  .every(v => typeof v === 'number' && Number.isFinite(v))

/** Half a cent of every rounding a month makes, in base units of the dearest currency held */
function slack(w: World, s: FinanceSnapshot, m: MonthChange): number {
  const dearest = Math.max(1, ...w.rates.flatMap(r => ['USD', 'EUR', 'RUB', 'GBP'].map(c => convert(1, c, w.base, r)!)))
  const holdings = w.banks.length + 3
  return 0.005 * dearest * (4 * holdings + 3 * s.cashflow.rows.filter(r => r.month === m.month).length + 10)
}

const changes = (s: FinanceSnapshot) => s.capitalChange ?? []

describe('capitalChange of records that explain every balance', () => {
  it('every month after the first is broken down from its records: nothing unexplained beyond rounding', () => {
    fc.assert(fc.property(world, w => {
      const { rows, rateAt, today, window } = rowsOf(w)
      const s = build(w, rows, rateAt, today)
      const all = changes(s)
      expect(all.map(m => m.month)).toEqual(window)
      expect(all[0]).toEqual({ month: window[0], reason: 'no_previous' })
      for (const m of all.slice(1)) {
        if (!isMonthChange(m)) throw new Error(`${m.month}: a gap (${m.reason}) in a complete history`)
        expect(m.form).toBe('tracked')
        expect(finite(m)).toBe(true)
        expect(total(m)).toBe(round2(m.end - m.start))
        expect(Math.abs(m.rows.unexplained ?? 0)).toBeLessThanOrEqual(slack(w, s, m))
      }
    }), RUNS)
  })
})

/** The same families with some balances left out, some in a currency without a rate and some off by an amount */
const damaged = world.chain(w => fc.tuple(fc.constant(w), fc.array(fc.record({
  at: fc.nat(), how: fc.constantFrom('drop', 'rateless', 'noise'), by: cents(-5_000, 5_000),
}), { maxLength: 3 })))

describe('capitalChange of any records', () => {
  it('a month is either rows that add up to its change or a gap with its reason, never NaN', () => {
    fc.assert(fc.property(damaged, ([w, harms]) => {
      const { rows, rateAt, today } = rowsOf(w)
      for (const h of harms) {
        if (!rows.assets.length) break
        const i = h.at % rows.assets.length
        if (h.how === 'drop') rows.assets.splice(i, 1)
        else if (h.how === 'rateless') rows.assets[i] = { ...rows.assets[i], currency: RATELESS }
        else rows.assets[i] = { ...rows.assets[i], value: add(rows.assets[i].value, h.by) }
      }
      const s = build(w, rows, rateAt, today)
      const known = new Map((s.capitalCoverage ?? []).map(c => [c.month, c.capitalKnown]))
      const history = new Map(s.history.map(h => [monthOf(h.date), h.netWorth]))
      for (const m of changes(s)) {
        if (!isMonthChange(m)) {
          expect(['no_previous', 'no_balance', 'no_rate']).toContain(m.reason)
          continue
        }
        // rows only for two complete months in a row
        expect(known.get(m.month)).toBe(true)
        expect(known.get(shiftMonth(m.month, -1))).toBe(true)
        expect(finite(m)).toBe(true)
        expect(total(m)).toBe(round2(m.end - m.start))
        expect([m.start, m.end]).toEqual([history.get(shiftMonth(m.month, -1)), history.get(m.month)])
        // each holding's part of a row adds up to the row
        for (const k of ['debtPaid', 'fx', 'property', 'investments'] as const) {
          if (m.items[k]) expect(round2(m.items[k].reduce((a, i) => a + i.amount, 0))).toBe(m.rows[k] ?? 0)
        }
      }
      // a month whose end holds a balance in a currency without a rate is a rate gap, not rows
      for (const a of rows.assets.filter(a => a.currency === RATELESS)) {
        expect(isMonthChange(changes(s).find(c => c.month === monthOf(a.date))!)).toBe(false)
      }
    }), RUNS)
  })

  it('a period of months is the sum of its months and adds up to its own change', () => {
    fc.assert(fc.property(damaged, ([w, harms]) => {
      const { rows, rateAt, today } = rowsOf(w)
      for (const h of harms) if (h.how === 'noise') rows.assets[h.at % rows.assets.length].value = add(rows.assets[h.at % rows.assets.length].value, h.by)
      const all = changes(build(w, rows, rateAt, today)).filter(isMonthChange)
      for (let i = 0; i < all.length; i++) for (let j = i; j < all.length; j++) {
        const ms = all.slice(i, j + 1).map(m => m.month)
        // a period is consecutive months: a gap inside it makes the whole period a gap
        if (monthsBetween(ms[0], ms.at(-1)!) !== ms.length - 1) continue
        const p = periodChange(all, ms)
        if (!('rows' in p)) throw new Error('a period of broken-down months has rows')
        expect(total(p)).toBe(round2(p.end - p.start))
      }
    }), RUNS)
  })
})

describe('capital at a month end', () => {
  it('net worth is assets less liabilities, and the breakdowns by class, currency and member sum to the assets', () => {
    fc.assert(fc.property(world, w => {
      const { rows, rateAt, today } = rowsOf(w)
      const s = build(w, rows, rateAt, today)
      for (const h of s.history) expect(Math.abs(h.netWorth - (h.assets - h.liabilities))).toBeLessThanOrEqual(0.01)
      const c = s.capital!
      const parts = c.accounts.length + c.realEstate.length
      for (const breakdown of [c.byClass, c.byCurrency, c.byMember]) {
        expect(Math.abs(breakdown.reduce((a, b) => a + b.valueBase, 0) - c.assets)).toBeLessThanOrEqual(0.01 * (parts + 1))
      }
    }), RUNS)
  })
})
