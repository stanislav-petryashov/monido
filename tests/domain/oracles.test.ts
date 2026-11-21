// Reference cases: every expected figure comes from outside this code (a published worked example or a closed form written
// out here), so a wrong formula cannot be pinned as right. docs/architecture.md, "Testing".
import { IPMT, PMT, PPMT, XIRR } from '@formulajs/formulajs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { accountReturn } from '../../src/domain/accountReturn'
import { emergencyMonths, savingsRate } from '../../src/domain/cashflow'
import { shiftMonth } from '../../src/domain/dates'
import { convert, convertRounded, round2 } from '../../src/domain/fx'
import { calcMonthlyPayment, computeSchedule } from '../../src/domain/loans'
import { runs } from '../helpers/arbitraries'
import { loanRow } from '../helpers/rows'

const schedule = (principal: number, rate: number, term: number) =>
  computeSchedule(loanRow({ principal, rate, term_months: term, monthly_payment: 0 }), [])
const interestOf = (rows: { interest: number }[], from: number, to: number) =>
  rows.slice(from - 1, to).reduce((s, r) => s + r.interest, 0)

describe('annuity loans: published worked examples', () => {
  it('a 10,000 loan at 8% over 10 months pays 1,037.03 a month', () => {
    // https://support.microsoft.com/en-us/office/pmt-function-0214da64-9a63-4996-bc20-214433fa6441 (=PMT(8%/12,10,10000))
    expect(round2(calcMonthlyPayment(10000, 8, 10))).toBe(1037.03)
  })

  it('an 8,000 loan at 10% over 3 years charges 66.67 interest in the first month', () => {
    // https://support.microsoft.com/en-us/office/ipmt-function-5cce0ad6-8402-4a41-8d29-61a0b054cb6f (=IPMT(10%/12,1,36,8000))
    expect(round2(schedule(8000, 10, 36)[0].interest)).toBe(66.67)
  })

  it('a 2,000 loan at 10% over 2 years repays 75.62 of principal in the first month', () => {
    // https://support.microsoft.com/en-us/office/ppmt-function-c370d9e3-7749-4ca4-beea-b06c6ac95e1b (=PPMT(10%/12,1,24,2000))
    expect(round2(schedule(2000, 10, 24)[0].principalPart)).toBe(75.62)
  })

  it('a 125,000 loan at 9% over 30 years: 937.50 interest in month 1, 11,135.23 in the second year', () => {
    // https://support.microsoft.com/en-us/office/cumipmt-function-61067bb0-9016-427d-b95b-1a752af0e606 (CUMIPMT, 13–24: −11135.23213)
    const rows = schedule(125000, 9, 360)
    expect(rows[0].interest).toBeCloseTo(937.5, 9)
    expect(interestOf(rows, 13, 24)).toBeCloseTo(11135.23213, 4)
  })
})

describe('annuity loans: the closed form', () => {
  // P = L·r / (1 − (1 + r)^−n); the balance after k payments B_k = L·(1 + r)^k − P·((1 + r)^k − 1) / r; interest in month k
  // is r·B_(k−1); the whole loan's interest is n·P − L
  const closedForm = (L: number, annualPct: number, n: number) => {
    const r = annualPct / 1200
    const P = (L * r) / (1 - (1 + r) ** -n)
    const balance = (k: number) => L * (1 + r) ** k - (P * ((1 + r) ** k - 1)) / r
    return { P, balance, interest: (k: number) => r * balance(k - 1), total: n * P - L }
  }

  it.each([
    [300000, 6.5, 360],
    [50000, 12, 60],
    [2500000, 16.9, 240],
    [96000, 9, 12],
  ])('%d at %d%% over %d months: payment, first months’ split, balance and total interest', (L, pct, n) => {
    const ref = closedForm(L, pct, n)
    const rows = schedule(L, pct, n)
    expect(rows).toHaveLength(n)
    expect(calcMonthlyPayment(L, pct, n)).toBeCloseTo(ref.P, 6)
    for (const k of [1, 2, 3]) {
      expect(rows[k - 1].interest).toBeCloseTo(ref.interest(k), 6)
      expect(rows[k - 1].principalPart).toBeCloseTo(ref.P - ref.interest(k), 6)
      expect(rows[k - 1].closingBalance).toBeCloseTo(ref.balance(k), 4)
    }
    expect(rows[Math.floor(n / 2) - 1].closingBalance).toBeCloseTo(ref.balance(Math.floor(n / 2)), 4)
    expect(interestOf(rows, 1, n)).toBeCloseTo(ref.total, 2)
    expect(rows[n - 1].closingBalance).toBeLessThanOrEqual(0.01)
  })

  it('an interest-free loan repays equal parts: 1,200 over 12 months is 100 a month, no interest', () => {
    const rows = schedule(1200, 0, 12)
    expect(calcMonthlyPayment(1200, 0, 12)).toBe(100)
    expect(rows.every(r => r.interest === 0 && r.principalPart === 100)).toBe(true)
  })
})

describe('account return (money-weighted, monthly steps)', () => {
  // Microsoft's XIRR example (support.microsoft.com/en-us/office/xirr-function-de1242ec-6477-445b-b11b-a303ad9adc9d, 0.373362535)
  // dates its flows by the day; accountReturn steps by whole months with transfers at mid-month, so that example does not map
  // onto it. The cases below have an exact answer under either convention.
  const run = (n: number) => Array.from({ length: n }, (_, i) => shiftMonth('2030-01', i + 1))

  it('one balance growing exactly 10% over a year with nothing put in returns 10% a year', () => {
    // 1,000 → 1,100 in 12 months: (1100 / 1000) − 1 by definition
    const months = run(12)
    const balances = [{ month: '2030-01', value: 1000 }, ...months.map((m, i) => ({ month: m, value: i === 11 ? 1100 : 1000 }))]
    const r = accountReturn(balances, months.map(m => ({ month: m, amount: 0 })), months[11])!
    expect(r.annualRate).toBeCloseTo(0.1, 9)
    expect(r.gain).toBe(100)
  })

  it('deposits and a withdrawal that all earn exactly 1% a month return 1.01^12 − 1 a year', () => {
    // the end balance is built from the rate: start·1.01^n + Σ transfer_i·1.01^(n − i − 0.5) (mid-month transfers)
    const months = run(8)
    const flows = [500, 0, -200, 300, 0, 0, 1000, -50]
    const start = 2000
    const end = start * 1.01 ** 8 + flows.reduce((s, t, i) => s + t * 1.01 ** (8 - i - 0.5), 0)
    const balances = [{ month: '2030-01', value: start }, ...months.map((m, i) => ({ month: m, value: i === 7 ? end : start }))]
    const r = accountReturn(balances, months.map((m, i) => ({ month: m, amount: flows[i] })), months[7])!
    expect(r.annualRate).toBeCloseTo(1.01 ** 12 - 1, 9)
    expect(r.gain).toBe(round2(end - start - 1550))
  })
})

describe('rounding and conversion against hand-computed cents', () => {
  it('rounds a half cent away from zero, also where binary floating point stores it just below', () => {
    // 2.675 and 10.005 are stored as 2.67499999… and 10.00499999…; half away from zero gives 2.68 and 10.01
    expect(round2(2.675)).toBe(2.68)
    expect(round2(10.005)).toBe(10.01)
    expect(round2(-2.675)).toBe(-2.68)
    expect(round2(0.004999)).toBe(0)
    expect(Object.is(round2(-0.004), 0)).toBe(true)
  })

  it('converts through the per-USD cross rate to the cent', () => {
    // 100 EUR at 0.92 EUR per USD = 100 / 0.92 = 108.695652… USD → 108.70
    expect(convertRounded(100, 'EUR', 'USD', { EUR: 0.92 })).toBe(108.7)
    // 1,000 RUB → EUR at 92.5 RUB and 0.925 EUR per USD: 1000 / 92.5 · 0.925 = 10 exactly
    expect(convert(1000, 'RUB', 'EUR', { RUB: 92.5, EUR: 0.925 })).toBeCloseTo(10, 12)
    // 0.25 USD at 0.5 GBP per USD = 0.125 GBP, a half cent → 0.13
    expect(convertRounded(0.25, 'USD', 'GBP', { GBP: 0.5 })).toBe(0.13)
    // 33.33 USD at 3 PLN per USD = 99.99 exactly, no rounding drift
    expect(convertRounded(33.33, 'USD', 'PLN', { PLN: 3 })).toBe(99.99)
  })
})

describe('ratios by definition', () => {
  it('savings rate is (income − expenses) ÷ income; the emergency fund is liquid money ÷ monthly expenses', () => {
    expect(savingsRate(5000, 4000)).toBeCloseTo(20, 12)
    expect(savingsRate(5000, 6000)).toBeCloseTo(-20, 12)
    expect(emergencyMonths(30000, 5000)).toBe(6)
  })

  it('neither ratio is defined without its divisor: no income, no expenses', () => {
    expect(savingsRate(0, 4000)).toBeNull()
    expect(emergencyMonths(30000, 0)).toBeNull()
  })
})

// Differential checks against Formula.js (@formulajs/formulajs, MIT, dev only), an independent implementation of Excel's
// financial functions
const fjs = (v: unknown): number => {
  if (typeof v !== 'number') throw v
  return v
}

describe('Formula.js as an oracle', () => {
  it('reproduces Microsoft’s documented PMT and XIRR examples', () => {
    // the PMT page above; https://support.microsoft.com/en-us/office/xirr-function-de1242ec-6477-445b-b11b-a303ad9adc9d (0.373362535)
    expect(fjs(PMT(0.08 / 12, 10, 10000))).toBeCloseTo(-1037.03, 2)
    const dates = ['2008-01-01', '2008-03-01', '2008-10-30', '2009-02-15', '2009-04-01'].map(d => new Date(`${d}T00:00:00Z`))
    expect(fjs(XIRR([-10000, 2750, 4250, 3250, 2750], dates, 0.1))).toBeCloseTo(0.373362535, 8)
  })
})

describe('annuity loans against Formula.js PMT, IPMT and PPMT', () => {
  it.each([
    [300000, 6.5, 360],
    [50000, 12, 60],
    [2500000, 16.9, 240],
    [8000, 10, 36],
    [1000000, 0.5, 120],
  ])('%d at %d%% over %d months: the payment and every month’s interest and principal', (L, pct, n) => {
    const r = pct / 1200
    const rows = schedule(L, pct, n)
    expect(rows).toHaveLength(n)
    expect(calcMonthlyPayment(L, pct, n)).toBeCloseTo(-fjs(PMT(r, n, L)), 6)
    for (const row of rows) {
      expect(row.interest).toBeCloseTo(-fjs(IPMT(r, row.rowNum, n, L)), 4)
      expect(row.principalPart).toBeCloseTo(-fjs(PPMT(r, row.rowNum, n, L)), 4)
    }
  })
})

describe('account return against Formula.js XIRR on generated cash flows', () => {
  // accountReturn steps by whole months with each transfer at mid-month; XIRR counts days / 365. On a real calendar the two
  // differ by the month lengths (up to 0.7 percentage points a year on a 6-month span, annualised). Here every half-month is
  // 365 days, so XIRR solves the same equation per half-month, and its rate compounded 24 times is the annual one: the two
  // solvers must find the same root, to within 1e-6
  const HALF_MONTH = 365 * 86_400_000
  const at = (halfMonths: number) => new Date(Date.UTC(2000, 0, 1) + halfMonths * HALF_MONTH)
  const account = fc.record({
    start: fc.integer({ min: 1000, max: 100_000 }),
    // each month's transfer in thousandths of the start balance: a withdrawal up to 2%, a deposit up to 10%
    flows: fc.array(fc.integer({ min: -20, max: 100 }), { minLength: 6, maxLength: 36 }),
    // the end balance is drawn on its own, not built from either solver: −15% … +40% on what went in
    growth: fc.integer({ min: 850, max: 1400 }),
  }).map(({ start, flows, growth }) => {
    const amounts = flows.map(f => Math.round((f * start) / 1000))
    return { start, flows: amounts, end: Math.round(((start + amounts.reduce((s, t) => s + t, 0)) * growth) / 1000) }
  })

  it('finds the same annual rate as XIRR', () => {
    fc.assert(fc.property(account, ({ start, flows, end }) => {
      const n = flows.length
      const months = flows.map((_, i) => shiftMonth('2030-01', i + 1))
      const balances = [{ month: '2030-01', value: start }, ...months.map((m, i) => ({ month: m, value: i === n - 1 ? end : start }))]
      const ours = accountReturn(balances, months.map((m, i) => ({ month: m, amount: flows[i] })), months[n - 1])!.annualRate!
      // the investor's view: the start balance and each deposit go in (negative), withdrawals and the end balance come out
      const values = [-start, ...flows.map(t => -t), end]
      const dates = [at(0), ...flows.map((_, i) => at(2 * i + 1)), at(2 * n)]
      // a guess near zero: from XIRR's default of 10% a period, its Newton steps run off to Infinity over 12–72 periods
      return Math.abs(ours - ((1 + fjs(XIRR(values, dates, 0.001))) ** 24 - 1)) < 1e-6
    }), runs(100))
  })
})
