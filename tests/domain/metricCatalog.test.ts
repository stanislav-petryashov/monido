import { describe, expect, it } from 'vitest'
import { HEALTH_KEYS, zoneOf } from '../../src/domain/health'
import { METRICS, type MetricKey } from '../../src/domain/metricCatalog'
import { computeCagr } from '../../src/domain/goals'
import { emptySnapshot, makeSnapshot } from '../helpers/snapshot'

const METRIC_KEYS = Object.keys(METRICS) as MetricKey[]

describe('metric catalog', () => {
  it('describes 17 metrics', () => {
    expect(METRIC_KEYS).toHaveLength(17)
  })

  it('gives growth beyond savings its annual rate and the inputs it used', () => {
    const s = makeSnapshot()
    const g = s.growthBeyondSavings!
    expect(METRICS.growth_beyond_savings.value(s)).toEqual({ label: 'metrics.fact.value', value: g.annualRate! * 100, kind: 'pct' })
    expect(METRICS.growth_beyond_savings.facts(s)).toEqual([
      { label: 'metrics.fact.startNetWorth', value: g.startNetWorth, kind: 'money' },
      { label: 'metrics.fact.savingsOverPeriod', value: 10800, kind: 'money' },
      { label: 'metrics.fact.endNetWorth', value: g.endNetWorth, kind: 'money' },
      { label: 'metrics.fact.growthBeyondSavingsAmount', value: g.growthAmount, kind: 'money' },
      { label: 'metrics.fact.monthsUsedOf', labelParams: { count: 14 }, value: 12, kind: 'count' },
    ])
    const off = makeSnapshot({ growthBeyondSavings: null })
    expect(METRICS.growth_beyond_savings.value(off).value).toBeNull()
    expect(METRICS.growth_beyond_savings.facts(off)).toEqual([])
    // too few months: no value, the inputs stay for the explanation
    const few = makeSnapshot({ growthBeyondSavings: { ...g, annualRate: null } })
    expect(METRICS.growth_beyond_savings.value(few).value).toBeNull()
    expect(METRICS.growth_beyond_savings.facts(few)).toHaveLength(5)
    // a month left out inside the span: the growth in money is the used months' own, not end − start − saved
    const gap = makeSnapshot({ growthBeyondSavings: { ...g, endNetWorth: g.endNetWorth! + 50000, growthAmount: 1234 } })
    const amount = METRICS.growth_beyond_savings.facts(gap).find(f => f.label === 'metrics.fact.growthBeyondSavingsAmount')
    expect(amount?.value).toBe(1234)
  })

  it('gives capital growth the whole-history growth with savings, from the history', () => {
    const s = makeSnapshot()
    expect(METRICS.capital_growth.value(s)).toEqual({ label: 'metrics.fact.value', value: computeCagr(s.history, new Set())! * 100, kind: 'pct' })
    expect(METRICS.capital_growth.facts(s)).toEqual([
      { label: 'metrics.fact.capitalStart', value: 127500, kind: 'money' },
      { label: 'metrics.fact.capitalNow', value: 136673, kind: 'money' },
      { label: 'metrics.fact.historyMonths', value: 12, kind: 'count' },
    ])
  })

  it('covers every health metric with card settings', () => {
    for (const key of HEALTH_KEYS) {
      expect(METRICS[key].health, key).toBeDefined()
    }
  })

  it('holds no prose: labels are translation keys', () => {
    const s = makeSnapshot()
    for (const key of METRIC_KEYS) {
      for (const f of [METRICS[key].value(s), ...METRICS[key].facts(s)]) {
        expect(f.label, key).toMatch(/^[a-z]+(\.[a-zA-Z0-9_]+)+$/)
        if (f.kind === 'text' && f.value !== null) expect(f.value, key).toMatch(/^[a-z]+(\.[a-zA-Z0-9_]+)+$/)
      }
    }
  })

  it('builds the loan payments facts from the current scheduled payments', () => {
    const s = makeSnapshot()
    expect(METRICS.debt_payment_ratio.facts(s)).toEqual([
      { label: 'metrics.fact.loanPayments', value: 902, kind: 'money' },
      { label: 'metrics.fact.incomeOfMonth', value: 6730, kind: 'money' },
    ])
  })

  it('zones match the thresholds the norms are written from', () => {
    // «above 3» — exactly 3 is still amber; «up to 6» — 6 is already green
    expect(zoneOf('emergency_months', 3)).toBe('amber')
    expect(zoneOf('emergency_months', 3.01)).toBe('green')
    expect(zoneOf('emergency_months', 6)).toBe('green')
    expect(zoneOf('debt_to_asset', 20)).toBe('green')
    expect(zoneOf('debt_to_asset', 40)).toBe('amber')
  })

  it('takes savings rate and emergency months from cash flow, not from the health report', () => {
    const s = makeSnapshot({ health: null })
    expect(METRICS.savings_rate.value(s)).toMatchObject({ value: -55.72, kind: 'pct' })
    expect(METRICS.emergency_months.value(s)).toMatchObject({ value: 1.84, kind: 'months' })
  })

  it('reads values and parts from the snapshot', () => {
    const s = makeSnapshot()
    const mortgage = s.capital!.loans[0].name
    expect(METRICS.emergency_months.value(s)).toEqual({ label: 'metrics.fact.value', value: 1.84, kind: 'months' })
    expect(METRICS.emergency_months.facts(s)).toContainEqual({ label: 'metrics.fact.liquidAccounts', value: 19268, kind: 'money' })
    expect(METRICS.net_worth.value(s)).toMatchObject({ value: 136673, kind: 'money' })
    expect(METRICS.assets.facts(s)).toContainEqual({ label: 'accounts.class.broker', value: 31240, kind: 'money' })
    expect(METRICS.assets.facts(s)).toContainEqual({ label: 'accounts.class.real_estate', value: 134000, kind: 'money' })
    expect(METRICS.liabilities.facts(s)).toContainEqual({
      label: 'metrics.fact.loanRate', labelParams: { name: mortgage, rate: 10.4 }, value: 43963, kind: 'money',
    })
    expect(METRICS.real_growth_yoy.facts(s)).toContainEqual({ label: 'metrics.fact.capitalYearAgo', value: 127500, kind: 'money', currency: 'USD' })
    // without inflation the net worths are the snapshot's own
    expect(METRICS.real_growth_yoy.facts(makeSnapshot({ inflation: null })))
      .toContainEqual({ label: 'metrics.fact.capitalYearAgo', value: 127500, kind: 'money' })
    // the savings unknown (no series): no month; known and never reached: unreachable; else the plan's month
    const fire = s.goals.fire!
    const withFire = (f: Partial<typeof fire>) => makeSnapshot({ goals: { ...s.goals, fire: { ...fire, ...f } } })
    expect(METRICS.fire_progress.facts(withFire({ forecastMonth: null, series: null })))
      .toContainEqual({ label: 'metrics.fact.forecastMonth', value: null, kind: 'month' })
    expect(METRICS.fire_progress.facts(withFire({ forecastMonth: null, series: { pace: [], more: [], low: [], high: [] } })))
      .toContainEqual({ label: 'metrics.fact.forecastMonth', value: 'metrics.factValue.unreachable', kind: 'text' })
    expect(METRICS.fire_progress.facts(withFire({ forecastMonth: '2046-05', series: { pace: [], more: [], low: [], high: [] } })))
      .toContainEqual({ label: 'metrics.fact.forecastMonth', value: '2046-05', kind: 'month' })
  })

  it('returns null instead of throwing on an empty database', () => {
    const s = emptySnapshot()
    for (const key of METRIC_KEYS) {
      expect(METRICS[key].value(s).value, key).toBeNull()
      expect(() => METRICS[key].facts(s), key).not.toThrow()
    }
  })

  it('has one key per metric — no window variants', () => {
    expect(METRIC_KEYS.filter(k => /_(3m|12m)$/.test(k))).toEqual([])
  })

  it('shows the inflation the metric was really computed with, and its currency', () => {
    expect(METRICS.real_growth_yoy.facts(makeSnapshot({ inflation: { ratePct: 8.7, currency: 'RUB', netWorthNow: null, netWorthYearAgo: null } })))
      .toContainEqual({ label: 'metrics.fact.inflationUsedIn', labelParams: { currency: 'RUB' }, value: 8.7, kind: 'pct' })
    // no default inflation: without one the fact has no value
    expect(METRICS.real_growth_yoy.facts(makeSnapshot({ inflation: null })))
      .toContainEqual({ label: 'metrics.fact.inflationUsed', value: null, kind: 'pct' })
  })

  it('lists loans by balance, drops paid-off ones and marks those without a rate', () => {
    const base = makeSnapshot()
    const loan = base.capital!.loans[0]
    const s = makeSnapshot({ capital: { ...base.capital!, loans: [
      { ...loan, name: 'Small', balanceBase: 140 },
      { ...loan, name: 'Paid off', balanceBase: 0 },
      { ...loan, name: 'Large', balanceBase: 86000 },
      { ...loan, name: 'No rate', balanceBase: null },
    ] } })
    const facts = METRICS.liabilities.facts(s).map(f => `${f.labelParams?.name}=${f.value}`)
    expect(facts).toEqual(['Large=86000', 'Small=140', 'No rate=metrics.factValue.noRate'])
  })

  it('counts the loans beyond the list', () => {
    const base = makeSnapshot()
    const loans = Array.from({ length: 7 }, (_, i) => ({ ...base.capital!.loans[0], name: `Loan ${i + 1}` }))
    const facts = METRICS.liabilities.facts(makeSnapshot({ capital: { ...base.capital!, loans } }))
    expect(facts.at(-1)).toEqual({ label: 'metrics.fact.moreLoans', value: 2, kind: 'count' })
  })

  it('asks the year question only when there is a year of history', () => {
    const base = makeSnapshot()
    const ask = METRICS.net_worth.ask as (s: typeof base) => boolean
    expect(ask(base)).toBe(true)
    expect(ask(makeSnapshot({ capital: { ...base.capital!, yoyDelta: null } }))).toBe(false)
    expect(METRICS.liabilities.ask).toBe(true)
  })
})
