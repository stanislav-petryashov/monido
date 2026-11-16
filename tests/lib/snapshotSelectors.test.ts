import { shiftMonth } from '../../src/domain/dates'
import { accountKey } from '../../src/domain/accounts'
import type { CashflowRowBase, HistoryPoint } from '../../src/domain/types'
import {
  beyondSavingsNotes, calculationWarnings, cashflowView, compareView, dataMonth, explanationFacts, goalMetrics, growthForHistory, isDistorting,
  overviewFlow, overviewMetrics, warningText,
} from '../../src/lib/snapshotSelectors'
import { ru, withLanguage } from '../helpers/i18n'
import { emptySnapshot, FIXTURE_MONTHLY_RATE, makeGrowthBeyondSavings, makeSnapshot } from '../helpers/snapshot'
import { METRICS } from '../../src/domain/metricCatalog'

const point = (date: string, netWorth: number): HistoryPoint => ({ date, assets: netWorth, liabilities: 0, netWorth })
const flow = (member: string, active: number, passive: number, expense = 1, bank = 'Lumiora Bank', month = '2031-06'): CashflowRowBase =>
  ({ month, bank, member, currency: 'USD', active, passive, expense, activeBase: active, passiveBase: passive, expenseBase: expense })
const withFlows = (rows: CashflowRowBase[]) => makeSnapshot({ cashflow: { ...makeSnapshot().cashflow, rows } })

describe('calculationWarnings source attribution', () => {
  it.each(['cashflow', 'goals'] as const)('omits same-currency fallback rates for %s but retains cross-currency conversion warnings', source => {
    const snapshot = makeSnapshot({ baseCurrency: 'EUR' })
    snapshot.cashflow.rows = [{ ...flow('Robin', 1, 0), currency: 'EUR' }]
    snapshot.goals.items = [{ ...snapshot.goals.items[0], currency: 'EUR' }]
    const date = source === 'cashflow' ? '2031-06-01' : snapshot.generatedAt.slice(0, 10)
    const warning = { code: 'fx_fallback' as const, params: { currency: 'EUR', date } }
    snapshot.warnings = [warning]
    expect(calculationWarnings(snapshot, [source])).toEqual([])
    if (source === 'cashflow') snapshot.cashflow.rows[0].currency = 'USD'
    else snapshot.goals.items[0].currency = 'USD'
    expect(calculationWarnings(snapshot, [source])).toEqual([warning])
  })

  it.each(['account', 'loan'] as const)('keeps %s conversion failures with the unavailable source and currency', kind => {
    const base = makeSnapshot()
    const name = 'Same entity'
    const member = 'Robin'
    const ref = kind === 'account' ? accountKey(name, member) : `loan:${name}`
    const capitalWarning = { code: 'fx_unknown_currency' as const, ref, params: { currency: 'ABC', name } }
    const flowWarning = { code: 'fx_unknown_currency' as const, ref, params: { currency: 'XYZ', name } }
    const snapshot = makeSnapshot({
      capital: { ...base.capital!,
        accounts: kind === 'account' ? [{ ...base.capital!.accounts[0], name, member, currency: 'ABC', valueBase: null }] : [],
        loans: kind === 'loan' ? [{ ...base.capital!.loans[0], name, member, currency: 'ABC', balanceBase: null }] : [],
      },
      cashflow: { ...base.cashflow, rows: [{ ...flow(member, 10, 0, 1, name), ...(kind === 'loan' ? { loan: true as const } : {}), currency: 'XYZ', activeBase: null, passiveBase: null, expenseBase: null }] },
      warnings: [capitalWarning, flowWarning],
    })
    expect(calculationWarnings(snapshot, ['capital'])).toEqual([capitalWarning])
    expect(calculationWarnings(snapshot, ['cashflow'])).toEqual([flowWarning])
    expect(calculationWarnings(snapshot, ['capital', 'cashflow'])).toEqual([capitalWarning, flowWarning])
    snapshot.capital!.accounts.forEach(a => { a.valueBase = 0 })
    snapshot.capital!.loans.forEach(l => { l.balanceBase = 0 })
    expect(calculationWarnings(snapshot, ['capital'])).toEqual([])
    expect(calculationWarnings(snapshot, ['cashflow'])).toEqual([flowWarning])
    snapshot.cashflow.rows[0].activeBase = 10
    snapshot.cashflow.rows[0].passiveBase = 0
    snapshot.cashflow.rows[0].expenseBase = 1
    expect(calculationWarnings(snapshot, ['cashflow'])).toEqual([])
  })
})

describe('overviewMetrics', () => {

  it('summarizes the overview and has no year delta without capital', () => {
    expect(overviewMetrics(makeSnapshot())).toEqual({ nw: { assets_total: 184508, liabilities_total: 47835, net_worth: 136673 } })
    expect(overviewMetrics(emptySnapshot())).toEqual({ nw: { assets_total: 0, liabilities_total: 0, net_worth: 0 } })
  })
})

describe('dataMonth', () => {
  it('is the last closed flow month, else the month of the balances, else nothing', () => {
    expect(dataMonth({ capitalDate: '2031-05-31', closedMonth: '2031-06', openMonths: [], today: '2031-07-03' })).toBe('2031-06')
    // Cash flow off: no flow month, the balances still name a month
    expect(dataMonth({ capitalDate: '2031-06-30', closedMonth: null, openMonths: [], today: '2031-07-03' })).toBe('2031-06')
    expect(dataMonth(emptySnapshot().asOf)).toBeNull()
  })
})

describe('growth', () => {
  const history = (points: HistoryPoint[]) => makeSnapshot({ history: points })

  it('annualises the change over the window and derives doubling time', () => {
    const s = history(Array.from({ length: 12 }, (_, i) => point(`2030-${String(i + 1).padStart(2, '0')}-28`, 150 + 2 * i)))
    const g = growthForHistory(s.history)
    // 12 points are 11 months between the first and the last
    expect(g.months).toBe(11)
    // (172 / 150)^(12 / 11) − 1 = 16.102 %; the rule of 72: 72 / 16.102 = 4.471 years
    expect(g.cagrPct).toBeCloseTo(16.102, 3)
    expect(g.doublingYears).toBeCloseTo(4.471, 3)
  })
  it('measures the span by dates, not by the number of points', () => {
    const g = growthForHistory(makeSnapshot().history)
    expect(g.months).toBe(12)
    expect(g.cagrPct).toBeCloseTo(7.19, 1)
  })

  it.each([
    ['one point', [point('2031-06-30', 100)]],
    ['no points', []],
    ['starts at zero', [point('2031-05-31', 0), point('2031-06-30', 100)]],
    ['starts negative', [point('2031-05-31', -70), point('2031-06-30', 100)]],
    ['ends negative', [point('2031-05-31', 60), point('2031-06-30', -90)]],
  ])('gives no growth for %s', (_, points) => {
    expect(growthForHistory(points)).toMatchObject({ cagrPct: null, doublingYears: null })
  })
  it('gives no doubling time when capital shrinks', () => {
    const g = growthForHistory([point('2031-05-31', 120), point('2031-06-30', 108)])
    expect(g.cagrPct).toBeLessThan(0)
    expect(g.doublingYears).toBeNull()
  })
})

describe('cashflowView', () => {

  it('keeps the net of every month in the trend', () => {
    const v = cashflowView(withFlows([flow('Robin', 3600, 0, 1700, 'A', '2031-05'), flow('Robin', 4300, 120, 1250, 'A')]), '1y')
    expect(v.monthlyTrend).toEqual([
      { month: '2031-05', income: 3600, expense: 1700, net: 1900 },
      { month: '2031-06', income: 4420, expense: 1250, net: 3170 },
    ])
    expect(cashflowView(withFlows([flow('Robin', 1, 0, 1, 'A', '2030-05')]), 'ytd').monthlyTrend).toEqual([])
  })

  it('is zero on an empty database', () => {
    expect(cashflowView(emptySnapshot(), '1y')).toMatchObject({ month: null, monthlyTrend: [] })
  })
})

describe('overviewFlow', () => {
  it('pairs the closed month with the month before it from the rows and adds up the nets of the year', () => {
    const v = overviewFlow(withFlows([flow('Robin', 3600, 0, 1700, 'A', '2031-05'), flow('Robin', 4300, 120, 1250, 'A')]))
    expect(v.month?.month).toBe('2031-06')
    expect(v.previous).toEqual({ month: '2031-05', income: 3600, expense: 1700, net: 1900 })
    expect(v.trend.map(r => r.month)).toEqual(['2031-05', '2031-06'])
    expect(v.netTotal).toBe(5070)
  })
  it('has no previous month across a gap, and no total without months', () => {
    expect(overviewFlow(withFlows([flow('Robin', 3600, 0, 1700, 'A', '2031-04'), flow('Robin', 4300, 120, 1250, 'A')])).previous).toBeNull()
    expect(overviewFlow(withFlows([]))).toMatchObject({ previous: null, trend: [], netTotal: null })
    expect(overviewFlow(emptySnapshot())).toMatchObject({ month: null, previous: null, trend: [], netTotal: null })
  })
})

describe('goalMetrics', () => {
  it('gives growth and the required pace in percent', () => {
    const m = goalMetrics(makeSnapshot())
    expect(m.actualCagrPct).toBeCloseTo(7.19, 1)
    expect(m.requiredCagrPct).toBeCloseTo(11.8)
  })
  it('has no pace without history or a FIRE goal', () => {
    expect(goalMetrics(emptySnapshot())).toMatchObject({ actualCagrPct: null, requiredCagrPct: null, inflation: null, fire: null })
    const base = makeSnapshot()
    expect(goalMetrics(makeSnapshot({ goals: { ...base.goals, fire: { ...base.goals.fire!, requiredCagr: null } } })).requiredCagrPct).toBeNull()
  })
  it('gives the real return for the inflation and its currency, and none without them', () => {
    const m = goalMetrics(makeSnapshot({ inflation: { ratePct: 8.7, currency: 'RUB', netWorthNow: null, netWorthYearAgo: null } }))
    expect(m.inflation).toEqual({ ratePct: 8.7, currency: 'RUB', netWorthNow: null, netWorthYearAgo: null })
    expect(m.realReturnPct).toBeCloseTo((1.08 / 1.087 - 1) * 100)
    // the parameter alone is not enough: the inflation needs its currency
    const none = goalMetrics(makeSnapshot({ parameters: { inflation_rate: 8.7 }, inflation: null }))
    expect(none).toMatchObject({ inflation: null, realReturnPct: null })
  })
})

describe('growth beyond savings', () => {
  const money = (v: number) => `$${v}`

  it('gives the annual rate in percent, none with the module off', () => {
    const m = goalMetrics(makeSnapshot())
    expect(m.beyondSavings).toEqual(makeGrowthBeyondSavings())
    expect(m.beyondSavingsPct).toBeCloseTo((Math.pow(1 + FIXTURE_MONTHLY_RATE, 12) - 1) * 100, 9)
    expect(goalMetrics(emptySnapshot())).toMatchObject({ beyondSavings: null, beyondSavingsPct: null })
    expect(goalMetrics(makeSnapshot({ growthBeyondSavings: makeGrowthBeyondSavings({ annualRate: null }) })).beyondSavingsPct).toBeNull()
  })

  it('explains a metric with its value first, then its catalog facts', () => {
    const s = makeSnapshot()
    expect(explanationFacts(s, 'growth_beyond_savings')).toEqual([
      METRICS.growth_beyond_savings.value(s), ...METRICS.growth_beyond_savings.facts(s),
    ])
    expect(explanationFacts(s, 'capital_growth')[0]).toMatchObject({ label: 'metrics.fact.value', kind: 'pct' })
  })

  it('writes the latest month with its numbers and each reason for the months left out (the count of months is a fact row, not a note)', () => {
    const g = makeGrowthBeyondSavings()
    const last = g.months[11]
    expect(beyondSavingsNotes(g, money)).toEqual([
      `Latest month used, Jun 2031: from $${last.startNetWorth} with $900 saved to $${last.endNetWorth}, +0.5% for the month`,
      'Left out, no income and expense data: May 2030, Jun 2030',
    ])
  })

  it('names at most six months per reason and counts the rest', () => {
    const months = Array.from({ length: 7 }, (_, i) => shiftMonth('2029-01', i))
    const g = makeGrowthBeyondSavings({
      monthsSkipped: [...months.map(month => ({ month, reason: 'no_balance' as const })), { month: '2029-12', reason: 'nonpositive_start' }],
    })
    const notes = beyondSavingsNotes(g, money)
    expect(notes).toContain('Left out, no balances at the start or the end: Jan 2029, Feb 2029, Mar 2029, Apr 2029, May 2029, Jun 2029 and 1 more')
    expect(notes).toContain('Left out, net worth at the start was not above zero: Dec 2029')
    expect(notes.some(n => n.includes('cash-flow'))).toBe(false)
  })

  it('passes every amount through the money formatter, so privacy can mask it', () => {
    const notes = beyondSavingsNotes(makeGrowthBeyondSavings(), () => '•••')
    expect(notes[0]).toBe('Latest month used, Jun 2031: from ••• with ••• saved to •••, +0.5% for the month')
  })

  it('without a used month gives only the reasons', () => {
    const g = makeGrowthBeyondSavings({ months: [], monthsSkipped: [{ month: '2031-06', reason: 'no_rate' }], monthsConsidered: 1 })
    expect(beyondSavingsNotes(g, money)).toEqual(['Left out, an amount without an exchange rate: Jun 2031'])
  })
})

describe('compareView', () => {
  const money = (v: number) => `$${Math.round(v)}`

  it('puts the closed month first and the 3- and 12-month averages beside it', () => {
    expect(compareView(makeSnapshot(), 'savings_rate', money)).toEqual({
      value: '−55.7%',
      rows: [{ label: '3-month average', short: '3 mo', value: '−52.4%' }, { label: '12-month average', short: '12 mo', value: '−61%' }],
    })
    expect(compareView(makeSnapshot(), 'cashflow_net', money)).toEqual({
      value: '$-3750',
      rows: [{ label: '3-month average', short: '3 mo', value: '$-3480' }, { label: '12-month average', short: '12 mo', value: '$-3900' }],
    })
    expect(compareView(makeSnapshot(), 'passive_income', money).value).toBe('$410')
  })
  it('words the windows from the Russian locale in Russian', async () => {
    await withLanguage('ru-RU', () => {
      const [three, twelve] = compareView(makeSnapshot(), 'savings_rate', money).rows
      expect([three.label, twelve.label]).toEqual([ru('metrics.fact.avg3m'), ru('metrics.fact.avg12m')])
      expect([three.short, twelve.short]).toEqual([ru('units.months', { count: 3, value: 3 }), ru('units.months', { count: 12, value: 12 })])
      const [typical] = compareView(makeSnapshot(), 'emergency_months', money).rows
      expect(typical).toMatchObject({ label: ru('cards.compare.typical'), short: ru('cards.compare.typicalShort') })
    })
  })
  it('compares the cushion against typical spending', () => {
    const view = compareView(makeSnapshot(), 'emergency_months', money)
    expect(view.value).toBe('1.8 mo')
    expect(view.rows).toEqual([{ label: 'Based on average expenses over 3 mo', short: 'on the 3 mo average', value: '1.9 mo' }])
  })
  it('shows dashes on an empty database', () => {
    for (const key of ['cashflow_net', 'savings_rate', 'emergency_months', 'passive_income'] as const) {
      const view = compareView(emptySnapshot(), key, money)
      expect(view.value, key).toBe('—')
      expect(view.rows.every(r => r.value === '—'), key).toBe(true)
    }
  })
  it.each([14.65, -0.03, 0.06, 3.35, -55.72, 98.45])('the cards never round %s to a signed zero', value => withLanguage('ru-RU', () => {
    const base = makeSnapshot()
    const metrics = { ...base.health!.metrics, savings_rate: { value, zone: 'amber' as const } }
    // the snapshot holds one number: the health report takes it from the cash flow
    const s = makeSnapshot({ health: { ...base.health!, metrics }, cashflow: { ...base.cashflow, savingsRatePct: value } })
    const shown = compareView(s, 'savings_rate', v => String(v)).value.replace('%', '')
    expect(shown).not.toBe('−0')
  }))
})

describe('isDistorting', () => {
  it('separates warnings that change totals from housekeeping ones', () => {
    expect(isDistorting({ code: 'fx_unknown_currency' })).toBe(true)
    expect(isDistorting({ code: 'fx_fallback' })).toBe(true)
    expect(isDistorting({ code: 'empty_data' })).toBe(true)
    expect(isDistorting({ code: 'missing_balance' })).toBe(false)
    expect(isDistorting({ code: 'short_history' })).toBe(false)
  })
})

describe('warningText', () => {
  it('renders a warning from its code and params', async () => {
    expect(warningText({ code: 'fx_unknown_currency', ref: 'goal:trip', params: { currency: 'GBP', name: 'Cabin trip' } }))
      .toBe('No exchange rate for GBP: “Cabin trip” is left out of the totals')
    expect(warningText({ code: 'empty_data', params: { context: 'cashflow' } })).toBe('No income and expense data')
    for (const context of ['loan_payments', 'mandatory_spending']) {
      const text = warningText({ code: 'fx_unknown_currency', params: { currency: 'GBP', name: context, context } })
      expect(text, context).toContain('GBP')
      expect(text, context).not.toContain(context)
      expect(await withLanguage('ru-RU', () => warningText({ code: 'fx_unknown_currency', params: { currency: 'GBP', name: context, context } }))).not.toContain(context)
    }
    expect(warningText({ code: 'short_history' })).toMatch(/^Less than 12 months/)
  })

  it('renders an excess of lines per flow and for the free sources', () => {
    const params = { month: '2031-05', name: 'A', member: 'Robin', lines: 700, total: 500 }
    const text = (context: string) => warningText({ code: 'lines_exceed_total', params: { ...params, context } })
    expect(text('active')).toMatch(/^The lines by category of “A” in May 2031 exceed its active income \(.*700.* of .*500.*\): the breakdown shows more than the income$/)
    expect(text('passive')).toMatch(/exceed its passive income .*: the breakdown shows more than the income$/)
    expect(text('expense')).toMatch(/exceed its expenses .*: the breakdown shows more than the expenses$/)
    expect(text('sources')).toMatch(/^Spending by category of other sources in May 2031 is more than the expenses left unallocated .*: check for spending counted twice$/)
  })

  it('lists the open months with their accounts and says when there are more', () => {
    const params = { months: ['2031-05', '2031-06'], '2031-05': ['A', 'C'], '2031-06': ['C'] }
    expect(warningText({ code: 'open_month_rows', params: { ...params, more: 0 } }))
      .toBe('Rows of a month that is not closed are not counted: May 2031: A, C; June 2031: C. Close the month in the month-close wizard')
    expect(warningText({ code: 'open_month_rows', params: { ...params, more: 2 } })).toContain('June 2031: C and others.')
  })

  it('words an empty-data warning with and without a context', () => {
    expect(warningText({ code: 'empty_data', params: { context: 'balances' } })).toBe('No account balances. Enter them in “Close month”')
    expect(warningText({ code: 'empty_data' })).toBe('No data yet')
  })

  it('in Russian is built from the Russian locale', async () => {
    await withLanguage('ru-RU', () => {
      const list = `${ru('dates.month.8')} 2031 — A`
      expect(warningText({ code: 'open_month_rows', params: { months: ['2031-08'], '2031-08': ['A'], more: 1 } }))
        .toBe(ru('warnings.open_month_rows_more', { list }))
    })
  })
})

describe('periods', () => {
  const months = (from: string, to: string) => {
    const out: string[] = []
    for (let m = from; m <= to; m = shiftMonth(m, 1)) out.push(m)
    return out
  }
  it('1y cash flow sums 12 months', () => {
    const rows = months('2025-01', '2026-09').map(m => flow('Robin', 1, 0, 1, 'A', m))
    const base = makeSnapshot()
    const s = makeSnapshot({ asOf: { ...base.asOf, closedMonth: '2026-09' }, cashflow: { ...base.cashflow, rows } })
    const v = cashflowView(s, '1y')
    expect(v.monthlyTrend).toHaveLength(12)
    expect(v.monthlyTrend[0].month).toBe('2025-10')
  })
})

