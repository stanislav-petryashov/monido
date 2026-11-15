import { emergencyMonths, savingsRate } from './cashflow'
import { round2, roundTo } from './fx'
import type { CapitalSnapshot, HealthKey, HealthReport, LoanBalance, MonthTotals, Zone } from './types'

export const HEALTH_KEYS: readonly HealthKey[] = [
  'savings_rate', 'emergency_months', 'fi_rate', 'debt_to_asset',
  'real_growth_yoy', 'avg_debt_rate', 'consumer_debt_months', 'debt_payment_ratio', 'income_diversification',
]

/** Passive-income progress is separate from current financial stability. */
export const isIndependenceMetric = (key: HealthKey): boolean => key === 'fi_rate' || key === 'income_diversification'

// [a, b, c]: normal metrics — ≤a red, ≤b amber, ≤c green, above excellent;
// inverse metrics — ≥c red, ≥b amber, ≥a green, below excellent.
const ZONES: Record<HealthKey, { thresholds: [number, number, number]; inverse?: boolean }> = {
  emergency_months:       { thresholds: [1, 3, 6] },
  savings_rate:           { thresholds: [5, 15, 25] },
  fi_rate:                { thresholds: [3, 10, 25] },
  debt_to_asset:          { thresholds: [20, 40, 60], inverse: true },
  real_growth_yoy:        { thresholds: [0, 3, 7] },
  avg_debt_rate:          { thresholds: [10, 15, 20], inverse: true },
  consumer_debt_months:   { thresholds: [6, 12, 24], inverse: true },
  debt_payment_ratio:     { thresholds: [10, 30, 50], inverse: true },
  income_diversification: { thresholds: [5, 15, 30] },
}

/** A metric's zone thresholds — the norms are written from them. */
export function zoneThresholds(key: HealthKey): readonly [number, number, number] {
  return ZONES[key].thresholds
}

/** The payment share's norm, %: where the debt_payment_ratio zone stops being green (the "smaller" alternative stays under it; both advisor cards print it) */
export const DEBT_NORM_PCT = zoneThresholds('debt_payment_ratio')[1]

/** true — «less is better» (debts, rates). */
export function isInverse(key: HealthKey): boolean {
  return ZONES[key].inverse === true
}

export function zoneOf(key: HealthKey, value: number): Zone {
  const { thresholds: [a, b, c], inverse } = ZONES[key]
  if (inverse) {
    if (value >= c) return 'red'
    if (value >= b) return 'amber'
    if (value >= a) return 'green'
    return 'excellent'
  }
  if (value <= a) return 'red'
  if (value <= b) return 'amber'
  if (value <= c) return 'green'
  return 'excellent'
}

/** @public Composite weights; they add up to 1. */
export const HEALTH_WEIGHTS: Record<HealthKey, number> = {
  emergency_months: 0.15, savings_rate: 0.20, fi_rate: 0.20, debt_to_asset: 0.05,
  real_growth_yoy: 0.10, avg_debt_rate: 0.10, consumer_debt_months: 0.05, debt_payment_ratio: 0.10, income_diversification: 0.05,
}

/** Points per zone: red 0, excellent 100 (or the `top` step inside the zone). Zone borders are ZONES, via zoneOf. */
const SCORES: Record<HealthKey, { amber: number; green: number; top?: (v: number) => number }> = {
  emergency_months:       { amber: 30, green: 70 },
  savings_rate:           { amber: 40, green: 70, top: v => v < 40 ? 90 : 100 },
  fi_rate:                { amber: 30, green: 60, top: v => v < 50 ? 80 : 100 },
  debt_to_asset:          { amber: 30, green: 70 },
  real_growth_yoy:        { amber: 40, green: 70 },
  avg_debt_rate:          { amber: 30, green: 60, top: v => v > 5 ? 85 : 100 },
  consumer_debt_months:   { amber: 30, green: 60, top: v => v > 0 ? 80 : 100 },
  debt_payment_ratio:     { amber: 30, green: 70 },
  income_diversification: { amber: 40, green: 70 },
}

/** 0–100 score of one metric; the same zone the card shows gives the same tier. */
function score(key: HealthKey, v: number): number {
  const zone = zoneOf(key, v)
  const s = SCORES[key]
  if (zone === 'red') return 0
  if (zone === 'amber') return s.amber
  if (zone === 'green') return s.green
  return s.top ? s.top(v) : 100
}

/** Scheduled payments of the snapshot month in the base currency; a loan without a rate is left out. */
export function loanPaymentsBase(loans: LoanBalance[]): number {
  return loans.reduce((s, l) => s + (l.paymentBase ?? 0), 0)
}

const isConsumer = (l: LoanBalance) => l.type !== 'mortgage'

/** Balance of consumer loans (every loan but a mortgage: a car loan too) in the base currency; a loan without a rate is left out. */
export function consumerDebtBase(loans: LoanBalance[]): number {
  return loans.filter(isConsumer).reduce((s, l) => s + (l.balanceBase ?? 0), 0)
}

export interface HealthInputs {
  capital: CapitalSnapshot
  month: MonthTotals | null      // the closed month
  /** The month's `capitalCoverage`: every bank account (the liquid money), and every balance with the loans, observed and converted */
  coverage: { liquidKnown: boolean; capitalKnown: boolean }
  /** Net worth growth over the year beyond inflation, %, in the inflation currency; null — no inflation or no year-ago point */
  realGrowthYoy: number | null
}

export function computeHealth({ capital, month, coverage, realGrowthYoy }: HealthInputs): HealthReport {
  const income = month?.income ?? 0
  const expense = month?.expense ?? 0
  const passive = month?.passive ?? 0
  const debt = capital.loans.reduce((s, l) => s + (l.balanceBase ?? 0), 0)
  const consumer = consumerDebtBase(capital.loans)
  const weightedRate = capital.loans.reduce((s, l) => s + (l.balanceBase ?? 0) * l.rate, 0)
  // a loan or an account without a rate (or a missing balance) makes the figures built on it unknown, not better;
  // each figure checks only what it reads
  const known = (loans: LoanBalance[], pick: (l: LoanBalance) => number | null) => loans.every(l => pick(l) !== null)
  const ifKnown = (ok: boolean, v: number | null) => (ok ? v : null)

  const values: Record<HealthKey, number | null> = {
    savings_rate: savingsRate(income, expense),
    emergency_months: ifKnown(coverage.liquidKnown, emergencyMonths(capital.liquid, expense)),
    fi_rate: expense > 0 ? (passive / expense) * 100 : null,
    debt_to_asset: coverage.capitalKnown && capital.assets > 0 ? (capital.liabilities / capital.assets) * 100 : null,
    real_growth_yoy: realGrowthYoy,
    // no debt is a zero rate
    avg_debt_rate: ifKnown(known(capital.loans, l => l.balanceBase), debt > 0 ? weightedRate / debt : 0),
    consumer_debt_months: ifKnown(known(capital.loans.filter(isConsumer), l => l.balanceBase), income > 0 ? consumer / income : null),
    debt_payment_ratio: ifKnown(known(capital.loans.filter(l => l.payment > 0), l => l.paymentBase), income > 0 ? (loanPaymentsBase(capital.loans) / income) * 100 : null),
    income_diversification: income > 0 ? (passive / income) * 100 : null,
  }

  let weighted = 0
  let weights = 0
  const metrics: HealthReport['metrics'] = {}
  for (const key of HEALTH_KEYS) {
    // the zone and the points come from the value the card shows: 1.004 months shows as 1, which is red
    const raw = values[key]
    const v = raw === null ? null : round2(raw)
    metrics[key] = v === null ? { value: null, zone: null } : { value: v, zone: zoneOf(key, v) }
    if (v !== null) {
      weighted += score(key, v) * HEALTH_WEIGHTS[key]
      weights += HEALTH_WEIGHTS[key]
    }
  }
  return {
    composite: weights > 0 ? roundTo(weighted / weights, 1) : null,
    metrics,
  }
}
