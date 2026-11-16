import type { HistoryPoint } from '../../src/domain/types'
import { realReturn } from '../../src/domain/goals'
import { buildCapitalHistory, capitalPresetRange, initialCapitalHistoryState, resolveCapitalHistory } from '../../src/lib/capitalHistory'
import { growthForHistory } from '../../src/lib/snapshotSelectors'

const history: HistoryPoint[] = [
  { date: '2031-01-31', assets: 100, liabilities: 20, netWorth: 80 },
  { date: '2031-03-31', assets: 150, liabilities: 10, netWorth: 140 },
  { date: '2031-04-30', assets: 160, liabilities: 0, netWorth: 160 },
]
const range = { from: '2031-01', to: '2031-04' }
const series = (model: ReturnType<typeof buildCapitalHistory>, key = 'capital') => model.series.find(s => s.key === key)!

it('keeps calendar gaps and actual zeros without mutating snapshot points', () => {
  const before = structuredClone(history)
  const m = buildCapitalHistory(history, range, 'amount')
  expect(m.unit).toBe('amount')
  expect(m.months.map(m => m.month)).toEqual(['2031-01', '2031-02', '2031-03', '2031-04'])
  expect(m.selected[1].point).toBeNull()
  expect(series(m).values).toEqual([80, null, 140, 160])
  expect(series(m, 'liabilities').values).toEqual([20, null, 10, 0])
  expect(history).toEqual(before)
})

it('uses the selected calendar month as the percentage base, including a missing one', () => {
  const m = buildCapitalHistory(history, range, 'percent')
  expect(m.baseMonth).toBe('2031-01')
  expect(series(m).values).toEqual([0, null, 75, 100])
  expect(series(m, 'liabilities').values).toEqual([0, null, -50, -100])
  const missing = buildCapitalHistory(history, { from: '2031-02', to: '2031-04' }, 'percent')
  expect(series(missing).unavailableReason).toBe('missing-base')
  expect(series(missing).values).toEqual([null, null, null])
})

it.each([0, -10, NaN, Infinity])('explains invalid percentage base %s without disabling other rows', base => {
  const h = [{ ...history[0], netWorth: base }, history[2]]
  const m = buildCapitalHistory(h, range, 'percent')
  expect(series(m).unavailableReason).toBe(Number.isFinite(base) ? 'nonpositive-base' : 'invalid-base')
  expect(series(m).values.every(v => v === null)).toBe(true)
  expect(series(m, 'assets').unavailableReason).toBeNull()
})

it('never returns a non-finite observation or overflow result', () => {
  const h = [{ ...history[0], netWorth: Number.MIN_VALUE }, { ...history[2], netWorth: Number.MAX_VALUE, assets: Infinity }]
  expect(series(buildCapitalHistory(h, range, 'percent')).values).toEqual([0, null, null, null])
  expect(series(buildCapitalHistory(h, range, 'amount'), 'assets').values.at(-1)).toBeNull()
})

it('a preset of N months shows N months of change: its first point is the balance N months before the latest', () => {
  const months = Array.from({ length: 24 }, (_, i) => ({ ...history[0], date: `${2030 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-28` }))
  expect(capitalPresetRange(months, '12m')).toEqual({ from: '2030-12', to: '2031-12' })
  expect(capitalPresetRange(months, '3m')).toEqual({ from: '2031-09', to: '2031-12' })
})

it.each(['3m', '6m', '12m', 'all'] as const)('counts preset %s from the latest historical month', preset => {
  expect(capitalPresetRange(history, preset)).toEqual({ from: '2031-01', to: '2031-04' })
})

it('crosses years and leap months by calendar rather than elapsed milliseconds', () => {
  const h = [{ ...history[0], date: '2023-12-31' }, { ...history[2], date: '2024-03-31' }]
  expect(capitalPresetRange(h, '3m')).toEqual({ from: '2023-12', to: '2024-03' })
  expect(capitalPresetRange([{ ...history[0], date: '2023-11-30' }, { ...history[2], date: '2024-02-29' }], '3m')).toEqual({ from: '2023-11', to: '2024-02' })
  expect(buildCapitalHistory(h, null, 'amount').months.map(m => m.month)).toEqual(['2023-12', '2024-01', '2024-02', '2024-03'])
})

it.each([
  [{ from: '2031-04', to: '2031-01' }, range],
  [{ from: '2030-01', to: '2030-02' }, { from: '2031-01', to: '2031-01' }],
  [{ from: '2032-01', to: '2032-02' }, { from: '2031-04', to: '2031-04' }],
  [{ from: '2030-01', to: '2032-02' }, range],
  [{ from: '2031-02', to: '2031-02' }, { from: '2031-02', to: '2031-02' }],
])('normalizes range %j', (input, expected) => {
  expect(buildCapitalHistory(history, input, 'amount').range).toEqual(expected)
})

it('handles empty and single-point histories without inventing points', () => {
  expect(capitalPresetRange([], '12m')).toBeNull()
  expect(buildCapitalHistory([], range, 'percent')).toMatchObject({ months: [], selected: [], range: null, baseMonth: null })
  expect(buildCapitalHistory([history[0]], null, 'amount').selected).toHaveLength(1)
})

it('resolves defaults, custom selection, gaps and history replacements without losing intent', () => {
  const defaults = initialCapitalHistoryState()
  expect(defaults).toMatchObject({ unit: 'amount', preset: '12m', visibleSeries: ['capital', 'assets', 'liabilities'] })
  expect(resolveCapitalHistory(history, defaults).selectedMonth).toBe('2031-04')
  const state = { ...defaults, preset: null, customRange: range, selectedMonth: '2031-02', unit: 'percent' as const }
  expect(resolveCapitalHistory(history, state).selectedMonth).toBe('2031-02')
  expect(resolveCapitalHistory([], state)).toMatchObject({ selectedMonth: null, model: { range: null } })
  expect(resolveCapitalHistory(history.slice(1), state)).toMatchObject({ selectedMonth: '2031-03', model: { range: { from: '2031-03', to: '2031-04' } } })
  expect(resolveCapitalHistory(history, state).selectedMonth).toBe('2031-02')
  expect(state.customRange).toEqual(range)
})

it('moves presets with appended snapshots but preserves valid custom bounds', () => {
  const h = [...history, { ...history[2], date: '2031-05-31' }]
  expect(resolveCapitalHistory(h, { ...initialCapitalHistoryState(), preset: '3m' }).model.range).toEqual({ from: '2031-02', to: '2031-05' })
  expect(resolveCapitalHistory(h, { ...initialCapitalHistoryState(), preset: null, customRange: range }).model.range).toEqual(range)
})

it('uses actual endpoint dates and the existing CAGR/rule of 72', () => {
  const h = [history[0], { ...history[0], date: '2032-01-31', netWorth: 96.8 }]
  const g = growthForHistory(h)
  expect(g.months).toBe(12)
  expect(g.cagrPct).toBeCloseTo(21)
  expect(g.doublingYears).toBeCloseTo(72 / 21)
})

it('suppresses CAGR when a finite ratio overflows after conversion to percent', () => {
  expect(growthForHistory([{ ...history[0], netWorth: 1 }, { ...history[0], date: '2032-01-31', netWorth: 1e308 }])).toEqual({ months: 12, cagrPct: null, doublingYears: null })
})

it.each([0, -10, NaN, Infinity])('suppresses invalid growth endpoint %s', netWorth => {
  expect(growthForHistory([history[0], { ...history[2], netWorth }]).cagrPct).toBeNull()
  expect(growthForHistory([{ ...history[0], netWorth }, history[2]]).cagrPct).toBeNull()
  expect(growthForHistory([])).toEqual({ months: 0, cagrPct: null, doublingYears: null })
  expect(growthForHistory([history[0]]).cagrPct).toBeNull()
})

it('masks unavailable slots without shifting the requested range or baseline', () => {
  const history = [
    { date: '2031-08-31', assets: 100, liabilities: 0, netWorth: 100 },
    { date: '2031-09-30', assets: 999, liabilities: 0, netWorth: 999 },
    { date: '2031-10-31', assets: 120, liabilities: 0, netWorth: 120 },
  ]
  const model = buildCapitalHistory(history, { from: '2031-08', to: '2031-10' }, 'amount', ['2031-09'])
  expect(model.selected.map(m => m.point?.assets ?? null)).toEqual([100, null, 120])
  const percent = buildCapitalHistory(history, { from: '2031-08', to: '2031-10' }, 'percent', ['2031-08'])
  expect(percent.range).toEqual({ from: '2031-08', to: '2031-10' })
  expect(percent.series[0].values).toEqual([null, null, null])
})

describe('net worth in today\'s money', () => {
  const year: HistoryPoint[] = [
    { date: '2030-04-30', assets: 1000, liabilities: 0, netWorth: 1000 },
    { date: '2030-10-31', assets: 1100, liabilities: 0, netWorth: 1100 },
    { date: '2031-04-30', assets: 1200, liabilities: 0, netWorth: 1200 },
  ]
  const yearRange = { from: '2030-04', to: '2031-04' }
  const real = (m: ReturnType<typeof buildCapitalHistory>) => m.series.find(s => s.key === 'capitalReal')!

  it('lifts each month to the last month\'s prices: the last point is the nominal one, a year back by the year\'s inflation', () => {
    const m = buildCapitalHistory(year, yearRange, 'amount', [], { ratePct: 10 })
    const v = real(m).values
    expect(v[0]).toBeCloseTo(1100, 6)
    expect(v[6]).toBeCloseTo(1100 * Math.sqrt(1.1), 6)
    expect(v[12]).toBe(1200)
    expect(v[1]).toBeNull()
    expect(real(m).amounts[12]).toBe(1200)
  })

  it('in percent it is the real growth over the range: the year\'s figure is realReturn', () => {
    const m = buildCapitalHistory(year, yearRange, 'percent', [], { ratePct: 10 })
    expect(real(m).values[12]! / 100).toBeCloseTo(realReturn(0.2, 0.1), 10)
  })

  it('is absent with its reason when there is no inflation or the dashboard is in another currency, and off at first', () => {
    expect(real(buildCapitalHistory(year, yearRange, 'amount', [], { unavailable: 'no-inflation' }))).toMatchObject({ unavailableReason: 'no-inflation', values: Array(13).fill(null) })
    expect(real(buildCapitalHistory(year, yearRange, 'amount', [], { unavailable: 'other-currency', currency: 'RUB' })).unavailableReason).toBe('other-currency')
    expect(buildCapitalHistory(year, yearRange, 'amount').series.map(s => s.key)).not.toContain('capitalReal')
    expect(initialCapitalHistoryState().visibleSeries).not.toContain('capitalReal')
  })
})
