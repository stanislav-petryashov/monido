import { describe, expect, it } from 'vitest'
import { HEALTH_KEYS, HEALTH_WEIGHTS, computeHealth, consumerDebtBase, zoneOf, isInverse, zoneThresholds } from '../../src/domain/health'
import type { CapitalSnapshot, HealthKey, MonthTotals, Zone } from '../../src/domain/types'

const capital: CapitalSnapshot = {
  date: '2030-08-31', assets: 120000, liabilities: 24000, netWorth: 96000, liquid: 10800,
  byClass: [], byCurrency: [], byMember: [], accounts: [], realEstate: [], securedLoans: [],
  loans: [{ name: 'Loan', member: 'Robin', type: 'consumer', currency: 'USD', rate: 16.5, repaidPct: null, balance: 24000, balanceBase: 24000, payment: 800, paymentBase: 800, interestNext12m: 3300, interestNext12mBase: 3300 }],
}
const month: MonthTotals = { month: '2030-08', income: 6400, active: 5700, passive: 700, expense: 3600, net: 2800 }
/** Net worth 91,500 a year ago → 96,000 now, beyond 4.5% inflation; the snapshot computes it in the inflation currency */
const realGrowthYoy = (96000 / 91500 - 1) * 100 - 4.5
/** Every balance of the month observed and converted (`capitalCoverage`) */
const KNOWN = { liquidKnown: true, capitalKnown: true }

describe('computeHealth', () => {
  it('computes all metrics, zones and the weighted composite', () => {
    const h = computeHealth({ capital, month, realGrowthYoy, coverage: KNOWN })
    expect(h.metrics).toEqual({
      savings_rate: { value: 43.75, zone: 'excellent' },
      emergency_months: { value: 3, zone: 'amber' },
      fi_rate: { value: 19.44, zone: 'green' },
      debt_to_asset: { value: 20, zone: 'green' },
      real_growth_yoy: { value: 0.42, zone: 'amber' },
      avg_debt_rate: { value: 16.5, zone: 'amber' },
      consumer_debt_months: { value: 3.75, zone: 'excellent' },
      debt_payment_ratio: { value: 12.5, zone: 'green' },
      income_diversification: { value: 10.94, zone: 'amber' },
    })
    // The score follows the zone, boundaries included: emergency_months = 3 is amber (30), debt_to_asset = 20 is green (70)
    // 20 + 4.5 + 12 + 3.5 + 4 + 3 + 4 + 2 + 7 (debt_payment_ratio 12.5 → green, 70 × .10)
    expect(h.composite).toBe(60)
  })

  it('scores a value exactly on a threshold in the zone the card shows', () => {
    // liquid 3600 / expense 3600 = 1 month → red → 0 points (not the amber tier)
    const h = computeHealth({ capital: { ...capital, liquid: 3600 }, month, realGrowthYoy, coverage: KNOWN })
    expect(h.metrics.emergency_months).toEqual({ value: 1, zone: 'red' })
    expect(h.composite).toBe(55.5)
  })

  it('takes the zone and the points from the value the card shows, after rounding', () => {
    // liquid 3614 / expense 3600 = 1.0039 months, shown as 1 → red (≤ 1), 0 points, as for exactly 1
    const h = computeHealth({ capital: { ...capital, liquid: 3614 }, month, realGrowthYoy, coverage: KNOWN })
    expect(h.metrics.emergency_months).toEqual({ value: 1, zone: 'red' })
    expect(h.composite).toBe(55.5)
  })

  it('reports missing inputs as null and re-weights the composite', () => {
    const h = computeHealth({ capital, month: null, realGrowthYoy: null, coverage: KNOWN })
    expect(h.metrics.savings_rate).toEqual({ value: null, zone: null })
    expect(h.metrics.real_growth_yoy).toEqual({ value: null, zone: null })
    expect(h.metrics.emergency_months!.value).toBeNull()
    // only debt_to_asset (20 → green, score 70, w .05) and avg_debt_rate (16.5 → amber, score 30, w .10) remain
    expect(h.composite).toBe(43.3)
  })

  it('leaves real growth out without inflation and weighs the rest', () => {
    const h = computeHealth({ capital, month, realGrowthYoy: null, coverage: KNOWN })
    expect(h.metrics.real_growth_yoy).toEqual({ value: null, zone: null })
    expect(h.composite).not.toBeNull()
  })

  it('treats no debt as a zero rate, not missing data', () => {
    const h = computeHealth({ capital: { ...capital, liabilities: 0, loans: [] }, month, realGrowthYoy, coverage: KNOWN })
    expect(h.metrics.avg_debt_rate).toEqual({ value: 0, zone: 'excellent' })
    expect(h.metrics.consumer_debt_months).toEqual({ value: 0, zone: 'excellent' })
  })
})

describe('the debt metrics without exchange rates', () => {
  it('are unknown, not «excellent», when a loan does not convert to the base currency', () => {
    const loans = [...capital.loans, { ...capital.loans[0], name: 'Other', balanceBase: null, paymentBase: null }]
    const h = computeHealth({ capital: { ...capital, loans }, month, realGrowthYoy, coverage: { liquidKnown: true, capitalKnown: false } })
    for (const key of ['debt_to_asset', 'avg_debt_rate', 'consumer_debt_months', 'debt_payment_ratio'] as const) expect(h.metrics[key], key).toEqual({ value: null, zone: null })
    expect(h.metrics.emergency_months?.value).toBe(3)
  })

  it('the emergency fund is unknown while an account has no rate or no balance', () => {
    const h = computeHealth({ capital, month, realGrowthYoy, coverage: { liquidKnown: false, capitalKnown: false } })
    expect(h.metrics.emergency_months).toEqual({ value: null, zone: null })
    expect(h.metrics.debt_to_asset).toEqual({ value: null, zone: null })
    expect(h.metrics.avg_debt_rate?.value).toBe(16.5)
  })

  it('each debt metric checks only the loans it reads', () => {
    const mortgage = { ...capital.loans[0], name: 'Home', type: 'mortgage', balanceBase: null, paymentBase: null }
    const h = computeHealth({ capital: { ...capital, loans: [...capital.loans, mortgage] }, month, realGrowthYoy, coverage: KNOWN })
    // a rateless mortgage: the consumer debt is still known, the rate and the payment share are not
    expect(h.metrics.consumer_debt_months?.value).toBe(3.75)
    expect(h.metrics.avg_debt_rate).toEqual({ value: null, zone: null })
    expect(h.metrics.debt_payment_ratio).toEqual({ value: null, zone: null })
    // a rateless loan with nothing to pay this month leaves the payment share known
    const quiet = { ...mortgage, payment: 0 }
    const q = computeHealth({ capital: { ...capital, loans: [...capital.loans, quiet] }, month, realGrowthYoy, coverage: KNOWN })
    expect(q.metrics.debt_payment_ratio?.value).toBe(12.5)
  })
})

describe('consumerDebtBase', () => {
  it('sums every loan but a mortgage (a car loan too), skipping balances without a rate', () => {
    const loan = capital.loans[0]
    expect(consumerDebtBase([loan, { ...loan, type: 'mortgage', balanceBase: 61000 }, { ...loan, balanceBase: null }])).toBe(24000)
    expect(consumerDebtBase([loan, { ...loan, type: 'car', balanceBase: 9000 }])).toBe(33000)
    expect(consumerDebtBase([])).toBe(0)
  })
})

describe('every metric', () => {
  it('the report has all HEALTH_KEYS; without a closed month the flow metrics are no data, not zeros', () => {
    expect(Object.keys(computeHealth({ capital, month, realGrowthYoy, coverage: KNOWN }).metrics).sort()).toEqual([...HEALTH_KEYS].sort())
    const none = computeHealth({ capital, month: null, realGrowthYoy, coverage: KNOWN }).metrics
    for (const key of ['savings_rate', 'emergency_months', 'fi_rate', 'income_diversification', 'consumer_debt_months', 'debt_payment_ratio'] as const) {
      expect(none[key], key).toEqual({ value: null, zone: null })
    }
  })
})

describe('zoneOf at every border', () => {
  // The borders written out: a change to ZONES has to change this table too
  const BORDERS: [HealthKey, readonly [number, number, number], 'more is better' | 'less is better'][] = [
    ['emergency_months', [1, 3, 6], 'more is better'],
    ['savings_rate', [5, 15, 25], 'more is better'],
    ['fi_rate', [3, 10, 25], 'more is better'],
    ['real_growth_yoy', [0, 3, 7], 'more is better'],
    ['income_diversification', [5, 15, 30], 'more is better'],
    ['debt_to_asset', [20, 40, 60], 'less is better'],
    ['avg_debt_rate', [10, 15, 20], 'less is better'],
    ['consumer_debt_months', [6, 12, 24], 'less is better'],
    ['debt_payment_ratio', [10, 30, 50], 'less is better'],
  ]
  // The zones just below, on and just above the first, second and third border: on a border, more-is-better
  // metrics take the lower (worse) zone and less-is-better metrics the higher (worse) one
  const AROUND: Record<'more is better' | 'less is better', [Zone, Zone, Zone][]> = {
    'more is better': [['red', 'red', 'amber'], ['amber', 'amber', 'green'], ['green', 'green', 'excellent']],
    'less is better': [['excellent', 'green', 'green'], ['green', 'amber', 'amber'], ['amber', 'red', 'red']],
  }
  const EPS = 1e-9
  const cases = BORDERS.flatMap(([key, borders, direction]) =>
    borders.map((border, i) => [key, border, direction, AROUND[direction][i]] as const))

  it('covers every metric', () => {
    expect(BORDERS.map(([key]) => key).sort()).toEqual([...HEALTH_KEYS].sort())
  })

  it.each(cases)('%s around %s (%s): below, on, above → %j', (key, border, _, [below, on, above]) => {
    expect(zoneOf(key, border - EPS)).toBe(below)
    expect(zoneOf(key, border)).toBe(on)
    expect(zoneOf(key, border + EPS)).toBe(above)
  })

  it.each([...HEALTH_KEYS])('%s: zoneThresholds are the values zoneOf changes zone at, isInverse its direction', key => {
    for (const border of zoneThresholds(key)) expect(zoneOf(key, border - EPS), String(border)).not.toBe(zoneOf(key, border + EPS))
    expect(isInverse(key)).toBe(zoneOf(key, zoneThresholds(key)[0] - EPS) === 'excellent')
  })
})

describe('debt_payment_ratio', () => {
  const loanOf = (paymentBase: number | null) => ({ ...capital.loans[0], paymentBase })

  it('is the payments’ share of the closed month’s income', () => {
    const h = computeHealth({ capital: { ...capital, loans: [loanOf(300), loanOf(200)] }, month: { ...month, income: 2000 }, realGrowthYoy, coverage: KNOWN })
    expect(h.metrics.debt_payment_ratio).toEqual({ value: 25, zone: 'green' })
  })

  it('is unknown when a payment has no base amount, not that payment short', () => {
    const h = computeHealth({ capital: { ...capital, loans: [loanOf(300), loanOf(null)] }, month: { ...month, income: 2000 }, realGrowthYoy, coverage: KNOWN })
    expect(h.metrics.debt_payment_ratio).toEqual({ value: null, zone: null })
  })

  it('no loans → 0; no income → null', () => {
    expect(computeHealth({ capital: { ...capital, loans: [] }, month, realGrowthYoy, coverage: KNOWN }).metrics.debt_payment_ratio).toEqual({ value: 0, zone: 'excellent' })
    expect(computeHealth({ capital, month: null, realGrowthYoy, coverage: KNOWN }).metrics.debt_payment_ratio).toEqual({ value: null, zone: null })
  })
})

describe('the composite', () => {
  it('weights add up to 1', () => {
    expect(HEALTH_KEYS.reduce((s, k) => s + HEALTH_WEIGHTS[k], 0)).toBeCloseTo(1, 10)
  })

  it('weights add up to 1: all-excellent metrics give 100', () => {
    const h = computeHealth({
      capital: { ...capital, liquid: 100000, liabilities: 0, loans: [] },
      month: { ...month, income: 10000, active: 5000, passive: 5000, expense: 1000, net: 9000 },
      realGrowthYoy: 20,
      coverage: KNOWN,
    })
    expect(Object.values(h.metrics).every(m => m.zone === 'excellent')).toBe(true)
    expect(h.composite).toBe(100)
  })
})
