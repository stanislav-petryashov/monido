// Shared fast-check arbitraries for the domain's property tests (tests/domain/properties): amounts in cents, months as
// 'YYYY-MM', a few currencies with plausible per-USD rates, loans with early repayments.
import fc from 'fast-check'
import { monthEnd, shiftMonth } from '../../src/domain/dates'
import { calcMonthlyPayment, type LoanEarlyPayment, type LoanRow } from '../../src/domain/loans'
import type { Rates } from '../../src/domain/types'

/** The currencies the generated families hold; USD is always 1 per USD */
export const CURRENCIES = ['USD', 'EUR', 'RUB', 'GBP'] as const
/** A currency no rate table knows (domain rule 1) */
export const RATELESS = 'XYZ'

/** An amount in whole cents between `min` and `max` units */
export const cents = (min: number, max: number) => fc.integer({ min: Math.round(min * 100), max: Math.round(max * 100) }).map(c => c / 100)

/** A calendar month 'YYYY-MM' between 2024 and 2032 */
export const month = () => fc.record({ y: fc.integer({ min: 2024, max: 2032 }), m: fc.integer({ min: 1, max: 12 }) })
  .map(({ y, m }) => `${y}-${String(m).padStart(2, '0')}`)

/** `count` consecutive months from a generated one, oldest first */
export const months = (minCount: number, maxCount: number) => fc.tuple(month(), fc.integer({ min: minCount, max: maxCount }))
  .map(([first, n]) => Array.from({ length: n }, (_, i) => shiftMonth(first, i)))

export const currency = () => fc.constantFrom(...CURRENCIES)

/** Units per USD, four decimals, in each currency's plausible range */
export const rates = (): fc.Arbitrary<Rates> => fc.record({
  EUR: fc.integer({ min: 8000, max: 10000 }).map(v => v / 10000),
  RUB: fc.integer({ min: 700000, max: 1100000 }).map(v => v / 10000),
  GBP: fc.integer({ min: 7000, max: 9000 }).map(v => v / 10000),
})

/** A loan with a formula payment (monthly_payment 0) or a stored one up to 30 % above it, issued in 2025–2030 */
export const loan = (o: { name?: string; currency?: string; manual?: boolean; maxTerm?: number } = {}): fc.Arbitrary<LoanRow> => fc.record({
  principal: cents(1_000, 3_000_000),
  rate: fc.integer({ min: 0, max: 3000 }).map(v => v / 100),
  term: fc.integer({ min: 1, max: o.maxTerm ?? 360 }),
  issue: fc.date({ min: new Date('2025-01-01T00:00:00Z'), max: new Date('2030-12-31T00:00:00Z'), noInvalidDate: true }),
  day: fc.option(fc.integer({ min: 1, max: 31 }), { nil: null }),
  extra: o.manual ? fc.integer({ min: 0, max: 30 }) : fc.constant(0),
  currency: o.currency ? fc.constant(o.currency) : currency(),
}).map(({ principal, rate, term, issue, day, extra, currency }) => ({
  rowid: 1, name: o.name ?? 'Loan', principal, rate, term_months: term,
  // a stored payment more than 1 above the formula's is a manual one (computeSchedule's hasManualPayment)
  monthly_payment: extra ? Math.round(calcMonthlyPayment(principal, rate, term) * (100 + extra)) / 100 : 0,
  issue_date: issue.toISOString().slice(0, 10), payment_day: day, currency, member: 'Robin', type: 'consumer', status: 'active', closed_date: null,
}))

/** Up to `max` early repayments of `l` between its issue and its last scheduled month, each up to a fifth of the principal */
export const earlyPayments = (l: LoanRow, max = 4): fc.Arbitrary<LoanEarlyPayment[]> => {
  const issueMonth = String(l.issue_date).slice(0, 7)
  return fc.array(fc.record({
    offset: fc.integer({ min: 0, max: Number(l.term_months) }),
    day: fc.integer({ min: 1, max: 31 }),
    share: fc.integer({ min: 1, max: 20 }),
    strategy: fc.constantFrom('reduce_term', 'reduce_payment'),
  }), { maxLength: max }).map(list => list.map(({ offset, day, share, strategy }, i) => {
    const m = shiftMonth(issueMonth, offset)
    const date = `${m}-${String(Math.min(day, Number(monthEnd(m).slice(8)))).padStart(2, '0')}`
    return {
      rowid: i + 1, id: i + 1, loan_name: l.name, payment_date: date < String(l.issue_date) ? String(l.issue_date) : date,
      amount: Math.round(Number(l.principal) * share) / 100, strategy, new_payment: null, principal_credit: null, notes: null,
    }
  }))
}

/** A loan and its early repayments */
export const loanWithEarly = (o: Parameters<typeof loan>[0] = {}) => loan(o).chain(l => earlyPayments(l).map(eps => ({ loan: l, eps })))

/** fast-check's run count: `n`, or PROPERTY_RUNS from the environment for a longer local search */
export const runs = (n: number) => ({ numRuns: Number(process.env.PROPERTY_RUNS) || n })
