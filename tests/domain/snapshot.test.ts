import { describe, expect, it, vi } from 'vitest'
import { METRICS } from '../../src/domain/metricCatalog'
import { capitalMovements, periodBridge } from '../../src/domain/financialAnalysis'
import { assetChanges } from '../../src/domain/assetChanges'
import { buildSnapshot, requiredRateCurrencies, requiredRateDates } from '../../src/domain/snapshot'
import { capitalHistory } from '../../src/domain/capital'
import { computeGrowthBeyondSavings } from '../../src/domain/returns'
import { isoDate, monthEnd, monthOf, shiftMonth } from '../../src/domain/dates'
import { ANNUAL_RETURN, SCENARIO_RETURN, allocateGoals, computeCoastFire, fireValues, monthsUntil, requiredCagr } from '../../src/domain/goals'
import { HEALTH_KEYS } from '../../src/domain/health'
import type { AssetInput, CashflowInput, CategorySpendingInput, FinanceRows, FlowLineInput, LoanPaymentInput, RateLookup, Rates } from '../../src/domain/types'
import { loanRow } from '../helpers/rows'

const TODAY = new Date('2031-05-15T12:00:00Z')
const RATES: Rates = { RUB: 75, EUR: 75 / 90 }
const rateAt: RateLookup = () => RATES

/** Without an explicit list every month with data counts as closed, like the history before the wizard. */
function rows(o: Partial<FinanceRows> = {}): FinanceRows {
  const months = new Set([...(o.assets ?? []), ...(o.cashflow ?? []), ...(o.loanPayments ?? []), ...(o.categorySpending ?? [])].map(r => r.date.slice(0, 7)))
  const closedMonths = [...months].sort().map(month => ({ month, source: 'migration' as const }))
  return { assets: [], cashflow: [], loanPayments: [], spendingCategories: [], categorySpending: [], flowLines: [], manualMandatory: null, members: [], realEstate: [], loans: [], earlyPayments: [], goals: [], parameters: {}, closedMonths, trackFlows: true, currencies: ['EUR', 'RUB', 'USD'], inflationCurrency: null, ...o }
}
const bank = (date: string, name: string, value: number, currency = 'USD'): AssetInput =>
  ({ date, class: 'bank', name, value, currency, member: 'Robin' })
const flow = (date: string, name: string, active: number, expense: number): CashflowInput =>
  ({ date, bank: name, member: 'Robin', active_income: active, passive_income: 0, expense, currency: 'USD' })
const build = (r: FinanceRows, baseCurrency = 'USD', at: RateLookup = rateAt, familyCurrency = 'USD') => buildSnapshot({ rows: r, rateAt: at, baseCurrency, familyCurrency, today: TODAY })

describe('requiredRateDates', () => {
  it('lists month ends of balances, first days of cash flow and today', () => {
    expect(requiredRateDates(rows({
      assets: [bank('2031-03-15', 'A', 1), bank('2031-04-30', 'A', 1)],
      cashflow: [flow('2031-04-01', 'A', 1, 1)],
    }), TODAY)).toEqual(['2031-03-31', '2031-04-01', '2031-04-30', '2031-05-15'])
  })
})

describe('requiredRateCurrencies', () => {
  it('joins the project currencies, the inflation currency and every currency the rows use, without USD', () => {
    expect(requiredRateCurrencies(rows({
      currencies: ['RUB', 'USD'],
      inflationCurrency: 'KZT',
      assets: [bank('2031-03-31', 'A', 1, 'GBP')],
      cashflow: [{ ...flow('2031-04-01', 'A', 1, 1), currency: 'CHF' }],
      realEstate: [{ name: 'Flat', purchase_date: '2020-01-01', purchase_price: 1, purchase_currency: 'EUR', valuation_year: 2031, value: 1, currency: 'TRY', member: null }],
      loans: [{ ...loanRow(), currency: 'JPY' }],
      goals: [{ id: 'g', name: 'G', target: 1, current: 0, target_date: '2040-01-31', emoji: null, currency: 'SEK' }],
    }))).toEqual(['CHF', 'EUR', 'GBP', 'JPY', 'KZT', 'RUB', 'SEK', 'TRY'])
  })
})

describe('buildSnapshot', () => {
  it('returns an empty snapshot with warnings for an empty database', () => {
    const s = build(rows())
    expect(s.capital).toBeNull()
    expect(s.health).toBeNull()
    expect(s.history).toEqual([])
    expect(s.asOf).toMatchObject({ capitalDate: null, closedMonth: null })
    expect(s.warnings.filter(w => w.code === 'empty_data').map(w => w.params)).toEqual([{ context: 'balances' }, { context: 'cashflow' }])
    expect(s.goals.plan.allocations).toEqual([])
    expect(s.goals.fire).toBeNull()
  })

  const twoMonths = rows({
    assets: [bank('2031-03-31', 'A', 1400), bank('2031-03-31', 'B', 650), bank('2031-04-30', 'A', 1700)],
    cashflow: [flow('2031-03-01', 'A', 3600, 2300), flow('2031-03-01', 'B', 1100, 650), flow('2031-04-01', 'A', 3600, 2000)],
    goals: [
      { id: 'fire', name: 'FIRE', target: 140000, current: 35000, target_date: '2041-05-31', emoji: null, currency: 'USD' },
      { id: 'trip', name: 'Cabin trip', target: 1500, current: 0, target_date: '2032-02-29', emoji: null, currency: 'GBP' },
    ],
  })

  it('uses the latest balances and the closed month', () => {
    const s = build(twoMonths)
    expect(s.asOf).toMatchObject({ capitalDate: '2031-04-30', closedMonth: '2031-04' })
    // B's balance is missing in April: its net worth is partial, so there is no change against March
    expect(s.capital).toMatchObject({ netWorth: 1700, monthDelta: null, yoyDelta: null })
    expect(s.history.map(h => h.netWorth)).toEqual([2050, 1700])
    expect(s.cashflow.closedMonth).toMatchObject({ income: 3600, expense: 2000, net: 1600 })
    expect(s.cashflow.avg3m).toMatchObject({ months: 2, expensePerMonth: 2475, netPerMonth: 1675 })
    expect(s.health?.metrics.savings_rate?.value).toBe(44.44)
    // B's balance is missing in April: the liquid money is partial, so the cushion is unknown
    expect(s.health?.metrics.emergency_months?.value).toBeNull()
  })

  it('warns about accounts missing in the latest month and a short history', () => {
    const s = build(twoMonths)
    expect(s.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_balance', ref: '["B","Robin"]' }),
      expect.objectContaining({ code: 'missing_cashflow', ref: '["B","Robin"]' }),
      expect.objectContaining({ code: 'short_history' }),
      expect.objectContaining({ code: 'fx_unknown_currency', ref: 'goal:trip' }),
    ]))
  })

  it('gives warnings as a code with raw params, not text', () => {
    const s = build(twoMonths)
    expect(s.warnings).toContainEqual({ code: 'missing_balance', ref: '["B","Robin"]', params: { name: 'B', member: 'Robin', month: '2031-04' } })
    expect(s.warnings).toContainEqual({ code: 'missing_cashflow', ref: '["B","Robin"]', params: { name: 'B', member: 'Robin', month: '2031-04' } })
    expect(s.warnings).toContainEqual({ code: 'fx_unknown_currency', ref: 'goal:trip', params: { currency: 'GBP', name: 'Cabin trip' } })
    for (const w of s.warnings) expect(w).not.toHaveProperty('message')
  })

  it('names the month of a missing balance as YYYY-MM', () => {
    const s = build(rows({ assets: [bank('2031-06-30', 'A', 1), bank('2031-06-30', 'B', 1), bank('2031-07-31', 'A', 1)] }))
    expect(s.warnings).toContainEqual({ code: 'missing_balance', ref: '["B","Robin"]', params: { name: 'B', member: 'Robin', month: '2031-07' } })
  })

  it('reports one warning per distinct text', () => {
    const s = build(rows({ assets: [bank('2031-04-30', 'Tarn Savings', 1, 'GBP')], cashflow: [{ ...flow('2031-04-01', 'Tarn Savings', 1, 1), currency: 'GBP' }] }))
    expect(s.warnings.filter(w => w.code === 'fx_unknown_currency')).toHaveLength(1)
  })

  it('plans goals from the 3-month savings pace and summarizes FIRE', () => {
    const s = build(twoMonths)
    expect(s.goals.plan.monthlySavingsBase).toBe(1675)
    expect(s.goals.plan.allocations.map(a => a.goal.id)).toEqual(['fire'])
    expect(s.goals.items.find(g => g.id === 'trip')?.targetBase).toBeNull()
    expect(s.goals.fire).toMatchObject({ goalId: 'fire', targetBase: 140000, currentBase: 35000, progressPct: 25 })
  })

  it('a reached independence goal is reached now, not unreachable: this month, with flows tracked', () => {
    const goals = twoMonths.goals.map(g => (g.id === 'fire' ? { ...g, current: g.target } : g))
    const s = build({ ...twoMonths, goals })
    expect(s.goals.fire).toMatchObject({ reached: true, forecastMonth: monthOf(isoDate(TODAY)) })
    expect(s.asOf.today).toBe(isoDate(TODAY))
    expect(METRICS.fire_progress.facts(s)).toContainEqual({ label: 'metrics.fact.forecastMonth', value: 'metrics.factValue.reached', kind: 'text' })
  })

  it('projects FIRE from what the goal has saved, the same base as its progress — not from net worth', () => {
    const fire = build(twoMonths).goals.fire!
    const months = monthsUntil('2041-05-31', TODAY)
    // net worth in this snapshot is 1,700; the goal has saved 35,000
    // the forecast is the plan's own month with the 8% return; the strategies re-run that plan
    const goal = twoMonths.goals.find(g => g.id === 'fire')!
    const plan = (saving: number, rate = ANNUAL_RETURN) => allocateGoals([goal], saving, TODAY, {}, 'USD', undefined, rate).allocations[0]
    expect(fire.forecastMonth).toBe(plan(1675).projectedDate)
    expect(fire.forecastMonth).not.toBeNull()
    expect(fire.strategies).toEqual({ more: plan(2175).projectedDate, yield: plan(1675, SCENARIO_RETURN).projectedDate, extraBase: 500 })
    expect(fire.atDeadlineBase).toBeCloseTo(fireValues(35000, plan(1675).shares, ANNUAL_RETURN, months)[months], 2)
    expect(fire.series!.pace[0]).toBe(35000)
    expect(fire.series!.pace.at(-1)).toBeGreaterThanOrEqual(140000)
    expect(fire.series!.pace).toHaveLength(plan(1675).shares.length + 1)
    expect(fire.coastFire).toEqual(computeCoastFire(35000, 140000, ANNUAL_RETURN, months))
    expect(fire.requiredCagr).toBe(requiredCagr(35000, 140000, months))
  })

  it('has no FIRE summary when the FIRE target cannot be converted to the base currency', () => {
    const fire = { id: 'fire', name: 'FIRE', target: 140000, current: 35000, target_date: '2041-05-31', emoji: null, currency: 'GBP' }
    const s = build({ ...twoMonths, goals: [fire] })
    expect(s.goals.fire).toBeNull()
    expect(s.warnings).toContainEqual(expect.objectContaining({ code: 'fx_unknown_currency', ref: 'goal:fire' }))
    const noRates = build({ ...twoMonths, goals: [{ ...fire, currency: 'RUB' }] }, 'USD', () => ({}))
    expect(noRates.goals.fire).toBeNull()
  })

  it('takes the month and year change over exactly 1 and 12 months, not from the nearest older observation', () => {
    // 2030-03, then 2030-05 … 2031-02, then 2031-04: no April 2030 and no March 2031
    const assets = [bank('2030-03-31', 'A', 2000), ...Array.from({ length: 10 }, (_, i) => bank(monthEnd(shiftMonth('2030-05', i)), 'A', 2200 + i * 25)), bank('2031-04-30', 'A', 3000)]
    const s = build(rows({ assets, cashflow: [flow('2031-04-01', 'A', 3600, 1800)] }))
    expect(s.capital).toMatchObject({ monthDelta: null, yoyDelta: null })
    expect(s.warnings.map(w => w.code)).toContain('short_history')
  })

  it('computes year-over-year change once there are 12 months of history', () => {
    const assets = Array.from({ length: 13 }, (_, i) => bank(monthEnd(shiftMonth('2030-04', i)), 'A', 2200 + i * 25))
    const s = build(rows({ assets, cashflow: [flow('2031-04-01', 'A', 3600, 1800)], parameters: { inflation_rate: 6 }, inflationCurrency: 'USD' }))
    expect(s.capital?.yoyDelta).toBe(300)
    expect(s.warnings.map(w => w.code)).not.toContain('short_history')
    // (2500 / 2200) / 1.06 − 1: growth beyond inflation, not growth minus inflation
    expect(s.health?.metrics.real_growth_yoy?.value).toBeCloseTo(7.2, 2)
  })

  it('keeps the capital at each period\'s start: 3, 12 months back and the first month', () => {
    // 2030-03, then 2030-05..2031-04: no observation three months before the latest
    const months = ['2030-03', ...Array.from({ length: 12 }, (_, i) => shiftMonth('2030-05', i))].filter(m => m !== '2031-01')
    const s = build(rows({ assets: months.map((m, i) => bank(monthEnd(m), 'A', 1000 + i * 10)) }))
    expect(s.capitalBack).not.toHaveProperty('month')
    expect(s.previousCapital?.date).toBe('2031-03-31')
    expect(s.capitalBack?.quarter).toBeNull()
    expect(s.capitalBack?.year).toBeNull()
    expect(s.capitalBack?.all?.date).toBe('2030-03-31')
    const c = assetChanges(s, 'all')!
    expect(Math.abs(c.change - (s.capital!.assets - s.capitalBack!.all!.assets))).toBeLessThanOrEqual(0.01)
  })

  it('warns about balances in a currency without a rate', () => {
    const s = build(rows({ assets: [{ date: '2031-04-30', class: 'bank', name: 'Tarn Savings', value: 140, currency: 'GBP', member: 'Noa' }] }))
    expect(s.capital?.assets).toBe(0)
    expect(s.warnings).toContainEqual(expect.objectContaining({ code: 'fx_unknown_currency', params: { currency: 'GBP', name: 'Tarn Savings' } }))
  })

  it('warns about a balance without a rate in an earlier month too: history counts it as 0', () => {
    const s = build(rows({ assets: [bank('2031-03-31', 'Tarn Savings', 140, 'GBP'), bank('2031-04-30', 'A', 100)] }))
    expect(s.warnings).toContainEqual(expect.objectContaining({ code: 'fx_unknown_currency', params: { currency: 'GBP', name: 'Tarn Savings' } }))
  })
})

describe('base currency', () => {
  const rub = (date: string, value: number) => bank(date, 'Lumiora Bank', value, 'RUB')
  const byMonth: RateLookup = d => (d.startsWith('2031-03') ? { RUB: 90 } : { RUB: 100 })

  it('history is converted at each month\'s own rate', () => {
    const data = rows({ assets: [rub('2031-03-31', 1_000_000), rub('2031-04-30', 1_000_000)] })
    expect(build(data, 'RUB', byMonth).history.map(h => h.netWorth)).toEqual([1_000_000, 1_000_000])
    expect(build(data, 'USD', byMonth).history.map(h => h.netWorth)).toEqual([11111.11, 10000])
  })

  it('a base currency without a rate leaves only its own amounts', () => {
    const s = build(rows({ assets: [bank('2031-04-30', 'A', 100), bank('2031-04-30', 'B', 50, 'XYZ')] }), 'XYZ', () => ({}))
    expect(s.capital?.netWorth).toBe(50)
    const unknown = s.warnings.filter(w => w.code === 'fx_unknown_currency')
    expect(unknown).toEqual([{ code: 'fx_unknown_currency', ref: '["A","Robin"]', params: { currency: 'USD', name: 'A' } }])
  })

  it('goals convert at today\'s rate', () => {
    const goal = { id: 'flat', name: 'Flat', target: 1000, current: 0, target_date: '2033-05-31', emoji: null, currency: 'EUR' }
    const today: RateLookup = d => (d === '2031-05-15' ? { EUR: 0.8, RUB: 80 } : { EUR: 0.5, RUB: 50 })
    const s = build(rows({ goals: [goal] }), 'RUB', today)
    expect(s.goals.items[0].targetBase).toBe(100000)
  })

  it('rates is the base currency on today', () => {
    const today: RateLookup = () => ({ EUR: 0.8, RUB: 80 })
    expect(build(rows(), 'RUB', today).rates).toEqual({ date: '2031-05-15', perUsd: 80 })
    expect(build(rows(), 'USD', today).rates).toBeNull()
    expect(build(rows(), 'XYZ', today).rates).toBeNull()
  })

  it('asks for today\'s rate only when goals or a non-USD base need it', () => {
    const lookup = vi.fn(rateAt)
    build(rows({ assets: [bank('2031-04-30', 'A', 1)] }), 'USD', lookup)
    expect(lookup).not.toHaveBeenCalledWith('2031-05-15')
    build(rows({ assets: [bank('2031-04-30', 'A', 1)] }), 'RUB', lookup)
    expect(lookup).toHaveBeenCalledWith('2031-05-15')
  })

  it('does not ask for today\'s rate when every goal is in the USD base', () => {
    const goal = { id: 'flat', name: 'Flat', target: 1000, current: 0, target_date: '2033-05-31', emoji: null, currency: 'USD' }
    const lookup = vi.fn(rateAt)
    build(rows({ goals: [goal] }), 'USD', lookup)
    expect(lookup).not.toHaveBeenCalledWith('2031-05-15')
    build(rows({ goals: [{ ...goal, currency: 'EUR' }] }), 'USD', lookup)
    expect(lookup).toHaveBeenCalledWith('2031-05-15')
  })

  it('names the base currency and the project currencies', () => {
    const s = build(rows(), 'RUB')
    expect(s.baseCurrency).toBe('RUB')
    expect(s.currencies).toEqual(['EUR', 'RUB', 'USD'])
  })

  it('echoes the family currency beside the currency it is shown in', () => {
    const s = build(rows(), 'EUR', rateAt, 'RUB')
    expect(s.baseCurrency).toBe('EUR')
    expect(s.familyCurrency).toBe('RUB')
  })
})

describe('inflation', () => {
  // 1,000,000 RUB → 1,100,000 RUB over the year (+10% in RUB) while the rouble falls 80 → 100 per USD (−12% in USD)
  const rub = (date: string, value: number) => bank(date, 'Lumiora Bank', value, 'RUB')
  const assets = [rub('2030-04-30', 1_000_000), rub('2031-04-30', 1_100_000)]
  const falling: RateLookup = d => ({ RUB: d < '2031' ? 80 : 100 })

  it('real growth uses the inflation currency whatever the base', () => {
    const data = rows({ assets, parameters: { inflation_rate: 8 }, inflationCurrency: 'RUB' })
    for (const base of ['USD', 'RUB']) {
      const s = build(data, base, falling)
      expect(s.inflation).toEqual({ ratePct: 8, currency: 'RUB', netWorthNow: 1_100_000, netWorthYearAgo: 1_000_000 })
      expect(s.health?.metrics.real_growth_yoy?.value, base).toBeCloseTo((1.1 / 1.08 - 1) * 100, 2)
    }
  })

  it('the facts of real growth are in the inflation currency and reproduce it, whatever the base', () => {
    const s = build(rows({ assets, parameters: { inflation_rate: 8 }, inflationCurrency: 'RUB' }), 'USD', falling)
    const facts = METRICS.real_growth_yoy.facts(s)
    const now = facts.find(f => f.label === 'metrics.fact.capitalNow')!
    const then = facts.find(f => f.label === 'metrics.fact.capitalYearAgo')!
    expect(now).toMatchObject({ kind: 'money', currency: 'RUB', value: 1_100_000 })
    expect(then).toMatchObject({ kind: 'money', currency: 'RUB', value: 1_000_000 })
    const rate = facts.find(f => f.label === 'metrics.fact.inflationUsedIn')!
    const growth = ((now.value as number) / (then.value as number) / (1 + (rate.value as number) / 100) - 1) * 100
    expect(growth).toBeCloseTo(s.health!.metrics.real_growth_yoy!.value!, 2)
  })

  it('no inflation → no real growth', () => {
    const s = build(rows({ assets, cashflow: [flow('2031-04-01', 'A', 3600, 1800)], parameters: { inflation_rate: 8 } }), 'USD', falling)
    expect(s.inflation).toBeNull()
    expect(s.health?.metrics.real_growth_yoy?.value).toBeNull()
    expect(s.health?.composite).not.toBeNull()
    expect(build(rows({ assets, inflationCurrency: 'RUB' }), 'USD', falling).inflation).toBeNull()
  })

  it('no real growth when the inflation currency has no rate', () => {
    const s = build(rows({ assets, parameters: { inflation_rate: 8 }, inflationCurrency: 'XYZ' }), 'USD', falling)
    expect(s.health?.metrics.real_growth_yoy?.value).toBeNull()
  })
})

describe('closed months', () => {
  const data = {
    assets: [bank('2031-03-31', 'A', 1400), bank('2031-04-30', 'A', 1700), bank('2031-05-31', 'A', 8800)],
    cashflow: [flow('2031-03-01', 'A', 3600, 2300), flow('2031-04-01', 'A', 3600, 2000), flow('2031-05-01', 'A', 1, 1)],
  }
  const closed = (...months: string[]) => months.map(month => ({ month, source: 'wizard' as const }))

  it('ignores balances and flows of a month that is not closed, and says so', () => {
    const s = build(rows({ ...data, closedMonths: closed('2031-03', '2031-04') }))
    expect(s.asOf).toMatchObject({ capitalDate: '2031-04-30', closedMonth: '2031-04' })
    expect(s.history.map(h => h.netWorth)).toEqual([1400, 1700])
    expect(s.cashflow.rows.map(r => r.month)).toEqual(['2031-03', '2031-04'])
    expect(s.warnings).toContainEqual({ code: 'open_month_rows', params: { months: ['2031-05'], '2031-05': ['A'], more: 0 } })
  })

  it('names at most three open months with their accounts and counts the rest', () => {
    const open = ['2031-05', '2031-06', '2031-07', '2031-08'].map(m => flow(`${m}-01`, 'C', 1, 1))
    const s = build(rows({ ...data, cashflow: [...data.cashflow, ...open], closedMonths: closed('2031-03', '2031-04') }))
    expect(s.warnings).toContainEqual({
      code: 'open_month_rows',
      params: { months: ['2031-05', '2031-06', '2031-07'], '2031-05': ['A', 'C'], '2031-06': ['C'], '2031-07': ['C'], more: 1 },
    })
  })

  it('lists the months waiting to be closed', () => {
    const s = buildSnapshot({ rows: rows({ ...data, closedMonths: closed('2031-03', '2031-04') }), rateAt, baseCurrency: 'USD', familyCurrency: 'USD', today: new Date('2031-07-10T09:00:00Z') })
    expect(s.asOf.openMonths).toEqual(['2031-05', '2031-06'])
  })

  it('has no open-month warning when every row belongs to a closed month', () => {
    const s = build(rows({ ...data, closedMonths: closed('2031-03', '2031-04', '2031-05') }))
    expect(s.warnings.map(w => w.code)).not.toContain('open_month_rows')
  })

  it('warns about an account missing from the latest month even if the wizard closed it — someone removed rows since', () => {
    const two = { assets: [bank('2031-03-31', 'A', 1), bank('2031-03-31', 'B', 1), bank('2031-04-30', 'A', 1)], cashflow: [flow('2031-03-01', 'A', 1, 1), flow('2031-03-01', 'B', 1, 1), flow('2031-04-01', 'A', 1, 1)] }
    const byWizard = build(rows({ ...two, closedMonths: [{ month: '2031-03', source: 'migration' }, { month: '2031-04', source: 'wizard' }] }))
    expect(byWizard.warnings.map(w => w.code)).toEqual(expect.arrayContaining(['missing_balance', 'missing_cashflow']))
    const migrated = build(rows(two))
    expect(migrated.warnings.map(w => w.code)).toEqual(expect.arrayContaining(['missing_balance', 'missing_cashflow']))
  })

  it('does not warn about an account the wizard closed last month; one closed earlier and taken again still warns', () => {
    const two = { assets: [bank('2031-03-31', 'A', 1), bank('2031-03-31', 'B', 0), bank('2031-04-30', 'A', 1)], cashflow: [flow('2031-03-01', 'A', 1, 1), flow('2031-03-01', 'B', 1, 1), flow('2031-04-01', 'A', 1, 1)] }
    const missing = (r: FinanceRows) => build(r).warnings.filter(w => w.code.startsWith('missing'))
    expect(missing(rows({ ...two, closures: [{ name: 'B', member: 'Robin', closedMonth: '2031-03' }] }))).toEqual([])
    expect(missing(rows({ ...two, closures: [{ name: 'B', member: 'Robin', closedMonth: '2031-01' }] })).map(w => w.code))
      .toEqual(['missing_balance', 'missing_cashflow'])
  })

  it('with nothing closed shows an empty dashboard and offers the month that has just finished', () => {
    const s = build(rows({ ...data, closedMonths: [] }))
    expect(s.capital).toBeNull()
    expect(s.asOf.openMonths).toHaveLength(1)
  })
})

describe('every module counts; income and expenses only while tracked', () => {
  const data = {
    assets: [bank('2031-03-31', 'A', 1400), bank('2031-04-30', 'A', 1700)],
    cashflow: [flow('2031-03-01', 'A', 3600, 2300), flow('2031-04-01', 'A', 3600, 2000)],
    realEstate: [{ name: 'City apartment', purchase_date: '2025-03-01', purchase_price: 220000, purchase_currency: 'USD', valuation_year: 2031, value: 241000, currency: 'USD', member: null }],
    loans: [loanRow({ name: 'Loan', principal: 15000, rate: 8, term_months: 30, issue_date: '2031-03-12', currency: 'USD', member: 'Noa' })],
    goals: [{ id: 'fire', name: 'FIRE', target: 140000, current: 35000, target_date: '2041-05-31', emoji: null, currency: 'USD' }],
  } satisfies Partial<FinanceRows>

  it('counts loans, real estate, goals and flows, with every health metric and no modules key', () => {
    const s = build(rows(data))
    expect(s.capital?.liabilities).toBeGreaterThan(0)
    expect(s.capital?.byClass.map(c => c.class)).toContain('real_estate')
    expect(s.goals.fire).not.toBeNull()
    expect(s.cashflow.closedMonth).not.toBeNull()
    expect(Object.keys(s.health?.metrics ?? {}).sort()).toEqual([...HEALTH_KEYS].sort())
    expect(s.growthBeyondSavings).not.toBeNull()
    expect(s).not.toHaveProperty('modules')
    expect(s.trackFlows).toBe(true)
  })

  it('not tracked: no flow figures, their health metrics have no data, no flow warnings; the rest stays', () => {
    const s = build(rows({ ...data, trackFlows: false }))
    expect(s.trackFlows).toBe(false)
    expect(s.cashflow.closedMonth).toBeNull()
    expect(s.cashflow.rows).toEqual([])
    expect(s.cashflow.savingsRatePct).toBeNull()
    expect(s.cashflow.emergencyMonths).toBeNull()
    expect(s.growthBeyondSavings).toBeNull()
    expect(s.analysisMonths?.every(m => !m.cashflow)).toBe(true)
    for (const k of ['savings_rate', 'emergency_months', 'fi_rate', 'income_diversification', 'consumer_debt_months', 'debt_payment_ratio'] as const) {
      expect(s.health?.metrics[k], k).toEqual({ value: null, zone: null })
    }
    expect(s.health?.metrics.debt_to_asset?.value).not.toBeNull()
    expect(s.warnings.map(w => w.code)).not.toContain('missing_cashflow')
    expect(s.warnings.map(w => w.params)).not.toContainEqual({ context: 'cashflow' })
    expect(s.capital?.liabilities).toBeGreaterThan(0)
    expect(s.goals.fire).not.toBeNull()
  })

  it('not tracked: the goals\' savings are unknown, not zero — no shortfall, no statuses, no FIRE pace', () => {
    const goals = [...data.goals, { id: 'roof', name: 'Roof', target: 50000, current: 1000, target_date: '2033-05-31', emoji: null, currency: 'USD' }]
    const tracked = build(rows({ ...data, goals }))
    expect(tracked.goals.plan.surplusBase).not.toBeNull()
    expect(tracked.goals.plan.surplusBase).toBeLessThan(0)
    const s = build(rows({ ...data, goals, trackFlows: false }))
    expect(s.goals.plan).toMatchObject({ monthlySavingsBase: null, surplusBase: null })
    expect(s.goals.plan.totalRequiredBase).toBeGreaterThan(0)
    expect(s.goals.plan.allocations.map(a => [a.goal.id, a.status, a.projectedDate]).sort()).toEqual([['fire', null, null], ['roof', null, null]])
    expect(s.goals.fire).toMatchObject({ forecastMonth: null, atDeadlineBase: null, series: null, strategies: { more: null, yield: null } })
    expect(s.goals.plan.allocations.every(a => a.shares.length === 0)).toBe(true)
  })

  it('warns about empty flows only while tracked', () => {
    const empty = { ...data, cashflow: [] }
    expect(build(rows(empty)).warnings).toContainEqual({ code: 'empty_data', params: { context: 'cashflow' } })
    expect(build(rows({ ...empty, trackFlows: false })).warnings.map(w => w.params)).not.toContainEqual({ context: 'cashflow' })
  })

  it('the cash-flow numbers of the closed month match the health report', () => {
    const s = build(rows(data))
    // April: (3600 − 2000) ÷ 3600; liquid 1700 ÷ expenses 2000
    expect(s.cashflow.savingsRatePct).toBe(44.44)
    expect(s.cashflow.emergencyMonths).toBe(0.85)
    expect(s.cashflow.savingsRatePct).toBe(s.health?.metrics.savings_rate?.value)
    expect(s.cashflow.emergencyMonths).toBe(s.health?.metrics.emergency_months?.value)
  })
})

describe('loan payments in month expenses', () => {
  const pay = (date: string, loan_name: string, amount: number, currency = 'USD'): LoanPaymentInput => ({ date, loan_name, amount, currency })
  const base = {
    assets: [bank('2031-04-30', 'A', 1000), bank('2031-05-31', 'A', 1000)],
    cashflow: [flow('2031-04-01', 'A', 3000, 1000), flow('2031-05-01', 'A', 3000, 1000)],
    loans: [loanRow({ name: 'Car', currency: 'USD', member: 'Robin' })],
  }

  it('a month with loan payment rows adds them to the month’s expenses', () => {
    const s = build(rows({ ...base, loanPayments: [pay('2031-05-01', 'Car', 400)] }))
    expect(s.cashflow.closedMonth).toMatchObject({ month: '2031-05', expense: 1400, net: 1600 })
    expect(s.cashflow.rows.filter(r => r.loan)).toHaveLength(1)
    expect(s.cashflow.avg3m.expensePerMonth).toBe(1200)
  })

  it('a legacy month without loan payment rows adds nothing', () => {
    const s = build(rows({ ...base, loanPayments: [pay('2031-05-01', 'Car', 400)], closedMonths: [{ month: '2031-04', source: 'migration' }, { month: '2031-05', source: 'wizard' }] }))
    const april = s.cashflow.rows.filter(r => r.month === '2031-04')
    expect(april.some(r => r.loan)).toBe(false)
    expect(april.reduce((sum, r) => sum + (r.expenseBase ?? 0), 0)).toBe(1000)
  })

  it('loan payments are hidden while income and expenses are not tracked', () => {
    const s = build(rows({ ...base, loanPayments: [pay('2031-05-01', 'Car', 400)], trackFlows: false }))
    expect(s.cashflow.rows.some(r => r.loan)).toBe(false)
  })

  it('only closed months count', () => {
    const s = build(rows({ ...base, loanPayments: [pay('2031-06-01', 'Car', 400)], closedMonths: [{ month: '2031-04', source: 'migration' }, { month: '2031-05', source: 'migration' }] }))
    expect(s.cashflow.rows.some(r => r.loan)).toBe(false)
  })

  it('a loan payment row never raises missing_cashflow', () => {
    const s = build(rows({ ...base, loanPayments: [pay('2031-04-01', 'Car', 400)] }))
    expect(s.cashflow.closedMonth?.month).toBe('2031-05')
    expect(s.warnings.map(w => w.code)).not.toContain('missing_cashflow')
  })

  it('a loan payment in a currency without a rate warns fx_unknown_currency with ref loan:<name>', () => {
    const s = build(rows({ ...base, loanPayments: [pay('2031-05-01', 'Car', 400, 'GBP')] }))
    expect(s.warnings).toContainEqual({ code: 'fx_unknown_currency', ref: 'loan:Car', params: { currency: 'GBP', name: 'Car' } })
    // the month's expenses are unknown, not 1000: no totals, no savings rate, no flow health; the average skips the month
    expect(s.cashflow.closedMonth).toBeNull()
    expect(s.cashflow.savingsRatePct).toBeNull()
    expect(s.cashflow.emergencyMonths).toBeNull()
    expect(s.health?.metrics.savings_rate?.value ?? null).toBeNull()
    expect(s.cashflow.avg3m).toMatchObject({ months: 1, netPerMonth: 2000 })
  })

  it('asks for the rates the payments need', () => {
    const r = rows({ ...base, loanPayments: [pay('2031-07-01', 'Car', 400, 'CHF')] })
    expect(requiredRateDates(r, TODAY)).toContain('2031-07-01')
    expect(requiredRateCurrencies(r)).toContain('CHF')
  })
})

describe('spending by category', () => {
  const spendingCategories = [{ id: 1, name: 'loan_payments', kind: 'loan_payment' as const, flow: 'expense' as const, oneOff: false }, { id: 2, name: 'Groceries', kind: 'mandatory' as const, flow: 'expense' as const, oneOff: false }]
  const spend = (date: string, category_id: number, amount: number, currency = 'USD'): CategorySpendingInput => ({ date, category_id, source: 'Bank A', amount, currency })
  const base = {
    assets: [bank('2031-04-30', 'A', 1000), bank('2031-05-31', 'A', 1000)],
    cashflow: [flow('2031-04-01', 'A', 3000, 1000), flow('2031-05-01', 'A', 3000, 1000)],
    spendingCategories,
    categorySpending: [spend('2031-04-01', 2, 300), spend('2031-05-01', 2, 500), spend('2031-05-01', 1, 200)],
  }

  it('totals the closed months and averages the mandatory ones', () => {
    const s = build(rows(base))
    expect(s.spending.months.map(m => m.month)).toEqual(['2031-04', '2031-05'])
    expect(s.spending.months[1]).toMatchObject({ allocatedBase: 700, totalBase: 1000, coveragePct: 70 })
    expect(s.spending.mandatory).toEqual({ perMonthBase: 400, source: 'categories', months: 2, updatedAt: null })
  })

  it('spending is empty and mandatory null while income and expenses are not tracked', () => {
    const s = build(rows({ ...base, manualMandatory: { amount: 900, currency: 'USD', updated_at: 't' }, trackFlows: false }))
    expect(s.spending).toEqual({ months: [], mandatory: null })
    expect(s.income).toEqual({ months: [] })
  })

  it('spending sees only closed months', () => {
    const s = build(rows({ ...base, closedMonths: [{ month: '2031-04', source: 'migration' }] }))
    expect(s.spending.months.map(m => m.month)).toEqual(['2031-04'])
    expect(s.spending.mandatory).toMatchObject({ perMonthBase: 300, months: 1 })
  })

  it('falls back to the manual amount at today’s rate', () => {
    const s = build(rows({ ...base, categorySpending: [], manualMandatory: { amount: 7500, currency: 'RUB', updated_at: '2031-03-01' } }))
    expect(s.spending.mandatory).toEqual({ perMonthBase: 100, source: 'manual', months: 0, updatedAt: '2031-03-01' })
  })

  it('a manual amount without a rate gives null and warns', () => {
    const s = build(rows({ ...base, categorySpending: [], manualMandatory: { amount: 900, currency: 'GBP', updated_at: 't' } }))
    expect(s.spending.mandatory).toBeNull()
    expect(s.warnings.filter(w => w.code === 'fx_unknown_currency' && w.ref === 'mandatory_spending')).toHaveLength(1)
  })

  it('a category amount without a rate warns with the category name', () => {
    const s = build(rows({ ...base, categorySpending: [spend('2031-05-01', 2, 50, 'GBP')] }))
    expect(s.warnings).toContainEqual({ code: 'fx_unknown_currency', ref: 'category:2', params: { currency: 'GBP', name: 'Groceries' } })
  })

  it('the reserved category and the manual amount are named by a context, not by their raw names', () => {
    const reserved = build(rows({ ...base, categorySpending: [spend('2031-05-01', 1, 50, 'GBP')] }))
    expect(reserved.warnings).toContainEqual({ code: 'fx_unknown_currency', ref: 'category:1', params: { currency: 'GBP', name: 'loan_payments', context: 'loan_payments' } })
    const manual = build(rows({ ...base, categorySpending: [], manualMandatory: { amount: 900, currency: 'GBP', updated_at: 't' } }))
    expect(manual.warnings).toContainEqual({ code: 'fx_unknown_currency', ref: 'mandatory_spending', params: { currency: 'GBP', name: 'mandatory_spending', context: 'mandatory_spending' } })
  })

  it('a mandatory amount without a rate leaves no mandatory spending (nothing falls back to the manual amount)', () => {
    const s = build(rows({ ...base, categorySpending: [spend('2031-05-01', 2, 50, 'GBP')], manualMandatory: { amount: 900, currency: 'USD', updated_at: 't' } }))
    expect(s.spending.mandatory).toBeNull()
  })

  it('asks for the rates the spending needs', () => {
    const r = rows({ ...base, categorySpending: [spend('2031-07-01', 2, 5, 'CHF')], manualMandatory: { amount: 1, currency: 'SEK', updated_at: 't' } })
    expect(requiredRateDates(r, TODAY)).toContain('2031-07-01')
    expect(requiredRateCurrencies(r)).toEqual(expect.arrayContaining(['CHF', 'SEK']))
  })
})

describe('growth beyond savings', () => {
  const months = Array.from({ length: 14 }, (_, i) => shiftMonth('2030-03', i))
  const fourteen = rows({
    assets: months.map((m, i) => bank(monthEnd(m), 'A', 20000 + i * 1500 + (i % 3) * 400)),
    cashflow: months.map(m => flow(`${m}-01`, 'A', 4000, 3000)),
  })

  it('is on the snapshot, null for too few months', () => {
    const s = build(rows({
      assets: [bank('2031-03-31', 'A', 1400), bank('2031-04-30', 'A', 1700)],
      cashflow: [flow('2031-03-01', 'A', 3600, 2300), flow('2031-04-01', 'A', 3600, 2000)],
    }))
    expect(s.growthBeyondSavings).toMatchObject({ monthsConsidered: 1, annualRate: null })
    expect(s.growthBeyondSavings?.months).toHaveLength(1)
  })

  it('is the domain function over the snapshot history and its cash-flow rows', () => {
    const s = build(fourteen)
    const direct = computeGrowthBeyondSavings(capitalHistory(fourteen, rateAt, 'USD'), s.cashflow.rows)
    expect(s.growthBeyondSavings).toEqual(direct)
    expect(s.growthBeyondSavings?.annualRate).not.toBeNull()
    expect(s.growthBeyondSavings?.months).toHaveLength(13)
  })

  it('is null while income and expenses are not tracked', () => {
    const s = build(rows({ ...fourteen, trackFlows: false }))
    expect(s.growthBeyondSavings).toBeNull()
  })

  it('skips the months around a balance without a rate and keeps the warning', () => {
    const k = months[5]
    const r = rows({ ...fourteen, assets: [...fourteen.assets, bank(monthEnd(k), 'Tarn Savings', 140, 'GBP')] })
    const s = build(r)
    expect(s.growthBeyondSavings?.monthsSkipped).toEqual([
      { month: k, reason: 'no_rate' }, { month: months[6], reason: 'no_rate' },
    ])
    // the latest month has no GBP balance, so the banner warning comes from the other path; it still names the currency
    const withLatest = build(rows({ ...fourteen, assets: [...fourteen.assets, bank(monthEnd(months[13]), 'Tarn Savings', 140, 'GBP')] }))
    expect(withLatest.warnings).toContainEqual(expect.objectContaining({ code: 'fx_unknown_currency' }))
    expect(withLatest.growthBeyondSavings?.monthsSkipped).toEqual([{ month: months[13], reason: 'no_rate' }])
  })
})

describe('income and expenses by category from account lines', () => {
  const spendingCategories = [
    { id: 1, name: 'loan_payments', kind: 'loan_payment' as const, flow: 'expense' as const, oneOff: false },
    { id: 2, name: 'Groceries', kind: 'mandatory' as const, flow: 'expense' as const, oneOff: false },
    { id: 3, name: 'Salary', kind: 'optional' as const, flow: 'active' as const, oneOff: false },
  ]
  const line = (date: string, category_id: number, amount: number, bank = 'A'): FlowLineInput => ({ date, bank, member: 'Robin', category_id, amount })
  const base = {
    assets: [bank('2031-04-30', 'A', 1000), bank('2031-05-31', 'A', 1000)],
    cashflow: [flow('2031-04-01', 'A', 3000, 1000), flow('2031-05-01', 'A', 3000, 1000)],
    spendingCategories,
    flowLines: [line('2031-05-01', 3, 2500), line('2031-05-01', 2, 400)],
  }

  it('income months from the lines, the expense months with their unallocated rest; the health values do not move', () => {
    const without = build(rows({ ...base, flowLines: [] }))
    const s = build(rows(base))
    expect(s.income.months).toEqual([{
      month: '2031-05', categories: [{ categoryId: 3, name: 'Salary', kind: 'optional', flow: 'active', oneOff: false, amountBase: 2500 }],
      allocatedBase: 2500, totalBase: 3000, unallocatedBase: 500, coveragePct: 83.33, oneOffBase: 0,
      byFlow: { active: { allocatedBase: 2500, totalBase: 3000, unallocatedBase: 500 }, passive: { allocatedBase: 0, totalBase: 0, unallocatedBase: 0 } },
    }])
    expect(s.spending.months).toEqual([expect.objectContaining({ month: '2031-05', allocatedBase: 400, totalBase: 1000, unallocatedBase: 600, coveragePct: 40 })])
    expect(s.spending.mandatory).toMatchObject({ perMonthBase: 400 })
    expect(s.health).toEqual(without.health)
    expect(s.cashflow).toEqual(without.cashflow)
    expect(s.warnings).toEqual(without.warnings)
  })

  it('no lines while not tracked, and none of a month that is not closed', () => {
    expect(build(rows({ ...base, trackFlows: false })).income.months).toEqual([])
    const closedApril = build(rows({ ...base, closedMonths: [{ month: '2031-04', source: 'migration' }] }))
    expect(closedApril.income.months).toEqual([])
    expect(closedApril.warnings.map(w => w.code)).not.toContain('orphan_lines')
  })

  it('warns about lines over their account’s total and about lines without an account row', () => {
    const s = build(rows({ ...base, flowLines: [line('2031-05-01', 3, 3200), line('2031-05-01', 3, 50, 'Gone')] }))
    expect(s.income.months[0]).toMatchObject({ allocatedBase: 3200, unallocatedBase: 0 })
    expect(s.warnings).toContainEqual({ code: 'lines_exceed_total', params: { context: 'active', month: '2031-05', name: 'A', member: 'Robin', lines: 3200, total: 3000 } })
    expect(s.warnings.filter(w => w.code === 'orphan_lines')).toEqual([{ code: 'orphan_lines', params: { month: '2031-05', count: 1 } }])
  })
})

it('keeps pipe-colliding identities distinct in snapshot totals and closure warnings', () => {
  const s = build(rows({
    assets: [
      { ...bank('2031-03-31', 'A|B', 10), member: 'C' },
      { ...bank('2031-03-31', 'A', 20), member: 'B|C' },
      bank('2031-04-30', 'Other', 1),
    ],
    closures: [{ name: 'A|B', member: 'C', closedMonth: '2031-03' }],
  }))
  expect(s.history[0].assets).toBe(30)
  expect(s.warnings.filter(w => w.code === 'missing_balance')).toEqual([
    { code: 'missing_balance', ref: '["A","B|C"]', params: { name: 'A', member: 'B|C', month: '2031-04' } },
  ])
})

describe('analysis month completeness', () => {
  it('keeps historical missing FX and partial account flows out of financial answers', () => {
    const s = build(rows({
      assets: [bank('2031-02-28', 'A', 100), bank('2031-02-28', 'B', 100, 'EUR'), bank('2031-03-31', 'A', 100), bank('2031-03-31', 'B', 100, 'EUR'), bank('2031-04-30', 'A', 100), bank('2031-04-30', 'B', 100, 'EUR')],
      cashflow: [flow('2031-02-01', 'A', 100, 50), flow('2031-02-01', 'B', 100, 50), flow('2031-03-01', 'A', 100, 50), flow('2031-04-01', 'A', 100, 50), flow('2031-04-01', 'B', 100, 50)],
    }), 'USD', (date): Rates => date === '2031-03-31' ? {} : { EUR: 1 })
    expect(s.analysisMonths).toEqual([
      { month: '2031-02', capital: true, cashflow: true },
      { month: '2031-03', capital: false, cashflow: false },
      { month: '2031-04', capital: true, cashflow: true },
    ])
  })
})

describe('buildSnapshot on a long history', () => {
  it('10 years × 30 accounts with lines and sources: the totals the per-month indexes must keep', () => {
    const currencies = ['USD', 'EUR', 'RUB']
    const months = Array.from({ length: 120 }, (_, k) => shiftMonth('2021-01', k))
    const accounts = Array.from({ length: 30 }, (_, i) => ({ name: `Bank ${i}`, member: i % 2 ? 'Robin' : 'Noa', currency: currencies[i % 3] }))
    const line = (m: string, a: (typeof accounts)[number], category_id: number, amount: number): FlowLineInput => ({ date: `${m}-01`, bank: a.name, member: a.member, category_id, amount })
    const s = build(rows({
      assets: months.flatMap((m, k) => accounts.map((a, i) => ({ date: monthEnd(m), class: 'bank', name: a.name, value: 1000 + i * 10 + k, currency: a.currency, member: a.member }))),
      cashflow: months.flatMap((m, k) => accounts.map((a, i) => ({ date: `${m}-01`, bank: a.name, member: a.member, active_income: 500 + i, passive_income: 10, expense: 300 + (k % 7), currency: a.currency }))),
      spendingCategories: [
        { id: 1, name: 'Food', kind: 'mandatory', flow: 'expense', oneOff: false },
        { id: 2, name: 'Fun', kind: 'optional', flow: 'expense', oneOff: false },
        { id: 10, name: 'Salary', kind: 'optional', flow: 'active', oneOff: false },
      ],
      categorySpending: months.flatMap(m => [
        { date: `${m}-01`, category_id: 1, source: 'Card', amount: 40, currency: 'EUR' },
        { date: `${m}-01`, category_id: 2, source: 'Cash', amount: 15, currency: 'USD' },
      ]),
      flowLines: months.flatMap(m => accounts.flatMap(a => [line(m, a, 1, 100), line(m, a, 2, 50), line(m, a, 10, 400)])),
      currencies,
    }), 'USD', () => ({ RUB: 80, EUR: 0.9 }), 'USD')
    expect(s.capital?.netWorth).toBe(26743.68)
    expect(s.cashflow.avg3m).toEqual({ months: 3, expensePerMonth: 6448.7, passivePerMonth: 212.4, netPerMonth: 4679.82, ratePct: 42.05 })
    expect(s.spending.months).toHaveLength(120)
    expect(s.spending.months.at(-1)).toMatchObject({
      month: '2030-12', allocatedBase: 3244.87, totalBase: 6370.8, unallocatedBase: 3125.94, coveragePct: 50.93,
      categories: [expect.objectContaining({ categoryId: 1, amountBase: 2168.06 }), expect.objectContaining({ categoryId: 2, amountBase: 1076.81 })],
    })
    expect(s.income.months.at(-1)).toMatchObject({
      month: '2030-12', allocatedBase: 8494.44, totalBase: 11128.52, unallocatedBase: 2634.08, coveragePct: 76.33,
      byFlow: { active: { allocatedBase: 8494.44, totalBase: 10916.12, unallocatedBase: 2421.68 }, passive: { allocatedBase: 0, totalBase: 212.4, unallocatedBase: 212.4 } },
    })
    expect(s.warnings).toEqual([])
    expect(s.analysisMonths?.every(m => m.capital && m.cashflow)).toBe(true)
  })
})


describe('account lifecycle and capital coverage', () => {
  it('exposes closed-only account lifecycle by owner', () => {
    const s = build(rows({
      assets: [
        { ...bank('2026-06-30', 'account97', 1), member: 'Alex' },
        { ...bank('2026-08-31', 'account97', 2), member: 'Alex' },
        bank('2026-08-31', 'account97', 3), { ...bank('2026-08-31', 'Property', 1), class: 'real_estate' }, bank('2026-10-31', 'Open', 4),
      ],
      closedMonths: ['2026-06', '2026-07', '2026-08', '2026-09'].map(month => ({ month, source: 'migration' as const })),
      closures: [{ name: 'account97', member: 'Alex', closedMonth: '2026-07' }, { name: 'account97', member: 'Robin', closedMonth: '2026-09' }],
    }))
    expect(s.accountLifecycle).toContainEqual({ name: 'account97', member: 'Alex', firstObservedMonth: '2026-06', lastObservedMonth: '2026-08', closedMonth: '2026-07' })
    expect(s.accountLifecycle?.find(a => a.name === 'account97' && a.member === 'Robin')?.closedMonth).toBeNull()
    expect(s.accountLifecycle?.some(a => a.lastObservedMonth === '2026-10' || a.name === 'Property')).toBe(false)
    expect(build(rows()).accountLifecycle).toEqual([])
    expect(build(rows()).capitalCoverage).toEqual([])
  })

  it('keeps a historical closure distinguishable from a later observation', () => {
    const assets = [bank('2026-08-31', 'A', 100), bank('2026-08-31', 'B', 50), bank('2026-09-30', 'B', 60), bank('2026-10-31', 'B', 70), bank('2026-11-30', 'A', 110), bank('2026-11-30', 'B', 80)]
    const cashflow = [flow('2026-11-01', 'B', 40, 10)]
    const s = build(rows({ assets, cashflow }))
    expect(s.capitalCoverage?.map(m => [m.month, m.assetsKnown, m.capitalKnown])).toEqual([
      ['2026-08', true, true], ['2026-09', false, false], ['2026-10', false, false], ['2026-11', true, true],
    ])
    expect(s.capitalCoverage?.[1].missingAccounts).toEqual([{ name: 'A', member: 'Robin', class: 'bank', currency: 'USD', lastObservedMonth: '2026-08' }])
    expect(s.analysisMonths?.map(m => m.capital)).toEqual([true, false, false, true])
    expect(s.history.map(h => h.netWorth)).toEqual([150, 60, 70, 190])
    expect(s.capital?.netWorth).toBe(190)
    expect(s.cashflow.closedMonth).toMatchObject({ income: 40, expense: 10, net: 30 })
    const closed = build(rows({ assets, closures: [{ name: 'A', member: 'Robin', closedMonth: '2026-08' }] }))
    expect(closed.capitalCoverage?.map(m => m.capitalKnown)).toEqual([true, true, true, true])
    expect(closed.analysisMonths?.every(m => m.capital)).toBe(true)
    const reopened = build(rows({ assets: [...assets, bank('2026-12-31', 'B', 90)], closures: [{ name: 'A', member: 'Robin', closedMonth: '2026-08' }] }))
    expect(reopened.analysisMonths?.at(-1)?.capital).toBe(false)
    expect(reopened.capitalCoverage?.at(-1)?.missingAccounts).toEqual([{ name: 'A', member: 'Robin', class: 'bank', currency: 'USD', lastObservedMonth: '2026-11' }])
  })

  it('account lifecycle coverage keeps earlier missing accounts and owner identities', () => {
    const s = build(rows({ assets: [
      bank('2026-06-30', 'B', 1), bank('2026-07-31', 'B', 1),
      { ...bank('2026-08-31', 'A', 1, 'EUR'), class: 'broker', member: 'Alex' }, bank('2026-08-31', 'B', 1),
      bank('2026-09-30', 'A', 1), bank('2026-09-30', 'B', 1), bank('2026-10-31', 'A', 1), bank('2026-10-31', 'B', 1),
    ] }))
    expect(s.capitalCoverage?.at(-1)?.missingAccounts).toEqual([{ name: 'A', member: 'Alex', class: 'broker', currency: 'EUR', lastObservedMonth: '2026-08' }])
  })

  it('account lifecycle coverage distinguishes unknown assets and loans', () => {
    const s = build(rows({ assets: [bank('2031-04-30', 'A', 100), bank('2031-05-31', 'A', 100, 'GBP')], loans: [loanRow({ currency: 'GBP', issue_date: '2031-04-01' })] }))
    expect(s.capitalCoverage?.map(m => [m.assetsKnown, m.capitalKnown])).toEqual([[true, false], [false, false]])
  })
})

it('keeps a mid-window account discoverable when absent from both period endpoints', () => {
  const s = build(rows({ assets: [
    ...['06', '07', '08', '09', '10'].map(m => bank(`2031-${m}-30`, 'B', 100)),
    bank('2031-08-31', 'A', 1000000096),
  ] }))
  for (const period of ['month', 'quarter', 'all'] as const) {
    const changes = assetChanges(s, period)!
    expect(changes.holdings.find(h => h.name === 'A')).toMatchObject({ missingEnd: true, closed: false, valueKnown: false, changeKnown: false })
    expect(changes.finding).toBeNull()
  }
})

it('keeps group changes unavailable when a missing starting account closed before the end', () => {
  const s = build(rows({ assets: [
    bank('2031-05-31', 'A', 500), bank('2031-06-30', 'B', 100),
    bank('2031-07-31', 'A', 0), bank('2031-07-31', 'B', 100),
    bank('2031-08-31', 'B', 100), bank('2031-09-30', 'B', 120),
  ], closures: [{ name: 'A', member: 'Robin', closedMonth: '2031-07' }] }))
  const changes = assetChanges(s, 'quarter')!
  expect(changes.startMonth).toBe('2031-06')
  expect(changes).toMatchObject({ startComplete: false, endComplete: true, complete: false })
  expect(changes.holdings).toMatchObject([{ name: 'B', valueBase: 120, change: 20, valueKnown: true, changeKnown: true }])
  for (const group of [changes.groups.type[0], changes.groups.member[0], changes.groups.currency[0]]) {
    expect(group).toMatchObject({ valueBase: 120, valueKnown: true, changeKnown: false })
  }
})

it.each([true, false])('retains missing balances across multiple months (flows=%s)', trackFlows => {
  const months = ['2031-01', '2031-02', '2031-03']
  const s = build(rows({ trackFlows,
    assets: [bank('2031-01-31', 'Missing', 1000), ...months.map(m => bank(`${m}-28`, 'Present', 1000))],
    cashflow: [flow('2031-01-01', 'Missing', 100, 50), ...months.map(m => flow(`${m}-01`, 'Present', 100, 50))],
  }))
  expect(s.capitalCoverage?.at(-1)?.capitalKnown).toBe(false)
  expect(s.analysisMonths?.at(-1)?.capital).toBe(false)
  expect(periodBridge(s, ['2031-03'])).toBeNull()
  expect(capitalMovements(s)).toBeNull()
  expect(s.warnings.filter(w => w.code === 'missing_balance')).toEqual([
    expect.objectContaining({ params: expect.objectContaining({ month: '2031-03', name: 'Missing' }) }),
  ])
})
