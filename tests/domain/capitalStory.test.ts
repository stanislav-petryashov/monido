import { describe, expect, it } from 'vitest'
import { changeHistory, changeStory, historyWindow, periodChange, yardstick, type PeriodChange } from '../../src/domain/capitalStory'
import { shiftMonth } from '../../src/domain/dates'
import type { ChangeRowKey, MonthChange, MonthChangeGap } from '../../src/domain/types'

// The year of the mockup, in thousands: what the family added (saved), markets and rates (fx) and the unexplained rest
const YEAR: [string, number, number, number][] = [
  ['2025-04', 100, 60, -5], ['2025-05', 95, -20, 3], ['2025-06', 110, 80, -4], ['2025-07', 90, 40, 0], ['2025-08', 105, -120, -6],
  ['2025-09', 98, 30, 2], ['2025-10', 120, 150, -3], ['2025-11', 100, -60, -8], ['2025-12', 180, 90, -10], ['2026-01', 70, 40, -2],
  ['2026-02', 102, -30, 4], ['2026-03', 107, -350, -12],
]
const mc = (month: string, start: number, rows: Partial<Record<ChangeRowKey, number>>, o: Partial<MonthChange> = {}): MonthChange => ({
  month, form: 'tracked', start, end: start + Object.values(rows).reduce((a, b) => a + (b ?? 0), 0),
  rows, items: {}, pairs: [], candidates: [], rates: [], ...o,
})
function year(): MonthChange[] {
  let nw = 11_079_000
  return YEAR.map(([month, you, markets, rest]) => {
    const m = mc(month, nw, { saved: you * 1000, debtPaid: 0, investments: 0, fx: markets * 1000, property: 0, unexplained: rest * 1000 })
    nw = m.end
    return m
  })
}
const window12 = YEAR.map(([m]) => m)

const march: PeriodChange = {
  months: ['2026-03'], form: 'tracked', start: 12_480_000, end: 12_225_000,
  rows: { saved: 85_000, debtPaid: 22_000, investments: -40_000, fx: -310_000, property: 0, unexplained: -12_000 },
  items: { fx: [{ kind: 'account', name: 'USD deposit', member: 'Ira', currency: 'USD', amount: -310_000, native: 38_750 }] },
  pairs: [], candidates: [], rates: [{ currency: 'USD', start: 92, end: 84 }],
}

describe('periodChange', () => {
  const quarter = [
    mc('2026-01', 100, { saved: 10, fx: -310_000 + 0, unexplained: 0 }),
    mc('2026-02', 100, { saved: 20, fx: 20_000, unexplained: 1 }),
    mc('2026-03', 100, { saved: 30, fx: -5_000, unexplained: 2 }, { rates: [{ currency: 'USD', start: 90, end: 84 }] }),
  ]
  quarter[0].rates = [{ currency: 'USD', start: 92, end: 91 }]

  it('sums the months of a quarter into one bridge', () => {
    const p = periodChange(quarter, ['2026-01', '2026-02', '2026-03']) as PeriodChange
    expect(p.rows).toMatchObject({ saved: 60, fx: -310_000 + 20_000 - 5_000, unexplained: 3 })
    expect(p.start).toBe(100)
    expect(p.end).toBe(quarter[2].end)
    expect(p.rates).toEqual([{ currency: 'USD', start: 92, end: 84 }])
  })

  it('returns the gap of a quarter with an incomplete month', () => {
    const gap: MonthChangeGap = { month: '2026-02', reason: 'no_balance' }
    expect(periodChange([quarter[0], gap, quarter[2]], ['2026-01', '2026-02', '2026-03'])).toEqual(gap)
  })

  it('shows a mixed period whole in the balances form', () => {
    const balances = mc('2026-02', 100, { accounts: 50, fx: 1 }, { form: 'balances' })
    const p = periodChange([quarter[0], balances, quarter[2]], ['2026-01', '2026-02', '2026-03']) as PeriodChange
    expect(p.form).toBe('balances')
    expect(p.rows).toMatchObject({ accounts: 10 + 0 + 50 + 30 + 2 })
    expect(p.rows.saved).toBeUndefined()
    expect(p.rows.unexplained).toBeUndefined()
  })
})

describe('changeStory', () => {
  it('says a down month and names the dollar', () => {
    expect(changeStory(march)).toEqual({
      key: 'capitalChange.sentence.downFx', params: { change: 255_000, amount: -310_000, currency: 'USD', from: 92, to: 84 },
      tail: { key: 'capitalChange.sentence.added', params: { amount: 107_000 } },
    })
  })

  it('phrases the rate from the display currency', () => {
    const inUsd: PeriodChange = { ...march, start: 135_652, end: 145_536, rows: { saved: 1_000, debtPaid: 260, investments: -480, fx: 9_104, property: 0, unexplained: 0 },
      items: { fx: [{ kind: 'account', name: 'Checking', member: 'Ira', currency: 'RUB', amount: 9_104 }] },
      rates: [{ currency: 'RUB', start: 1 / 92, end: 1 / 84 }] }
    expect(changeStory(inUsd)).toMatchObject({ key: 'capitalChange.sentence.upFxPer', params: { currency: 'RUB', from: 92, to: 84 } })
  })

  it('says flat under 0.5% of the start', () => {
    const april: PeriodChange = { ...march, start: 12_000_000, end: 12_001_000, rows: { saved: 104_000, fx: -101_000, debtPaid: 0, investments: -2_000, property: 0, unexplained: 0 } }
    expect(changeStory(april).key).toBe('capitalChange.sentence.flat')
  })

  it('says the family took out when its part is negative', () => {
    const overspent: PeriodChange = { ...march, end: 12_100_000, rows: { saved: -60_000, debtPaid: 22_000, investments: 0, fx: -342_000, property: 0, unexplained: 0 } }
    expect(changeStory(overspent).tail).toEqual({ key: 'capitalChange.sentence.tookOut', params: { amount: 38_000 } })
  })

  it('has no tail in the balances form', () => {
    const balances: PeriodChange = { ...march, form: 'balances', rows: { accounts: 45_000, debtPaid: 22_000, fx: -310_000, property: 0 } }
    expect(changeStory(balances).tail).toBeNull()
  })
})

describe('yardstick', () => {
  it('counts negative markets months: 5 of 12, March the largest', () => {
    expect(yardstick(year(), window12, ['2026-03'])).toEqual({ negative: 5, total: 12, largest: true })
  })

  it('gives no yardstick under 6 months', () => {
    expect(yardstick(year(), window12.slice(-5), ['2026-03'])).toBeNull()
  })
})

describe('changeHistory', () => {
  it('accumulates since the window start: 1 277 000 added, 1 146 000 grown', () => {
    const h = changeHistory(year(), window12)
    expect(h.points).toHaveLength(13)
    expect(h.points[0]).toEqual({ month: '2025-03', netWorth: 0, added: 0, markets: 0, unexplained: 0 })
    expect(h.points.at(-1)).toEqual({ month: '2026-03', netWorth: 1_146_000, added: 1_277_000, markets: -90_000, unexplained: -41_000 })
  })

  it('marks the largest difference and says markets took more than they gave', () => {
    const h = changeHistory(year(), window12)
    expect(h.largestGap).toEqual({ month: '2026-01', amount: 257_000 })
    expect(h.takeaway).toEqual({ key: 'capitalChange.takeaway.marketsTookMore', params: { until: '2026-02' }, tail: null })
  })

  it('breaks the lines at a gap', () => {
    const all: (MonthChange | MonthChangeGap)[] = year()
    all[4] = { month: '2025-08', reason: 'no_rate' }
    const point = changeHistory(all, window12).points.find(p => p.month === '2025-08')!
    expect(point).toEqual({ month: '2025-08', netWorth: null, added: null, markets: null, unexplained: null })
  })

  it('starts the added line at the first month with flows', () => {
    const all: MonthChange[] = year().map((m, i) => (i < 3 ? { ...m, form: 'balances' as const, rows: { accounts: m.rows.saved! + m.rows.unexplained!, fx: m.rows.fx } } : m))
    const h = changeHistory(all, window12)
    expect(h.points[1].added).toBeNull()
    // the added line starts on the net worth line, so the gap between them is what markets did from there
    expect(h.points[3].added).toBe(h.points[3].netWorth)
    expect(h.points[4].added).toBe(h.points[3].netWorth! + 90_000)
  })
})

describe('historyWindow', () => {
  const closed = Array.from({ length: 40 }, (_, i) => shiftMonth('2023-01', i))   // 2023-01 … 2026-04
  it('is the twelve months to the last closed one for a month or a quarter', () => {
    expect(historyWindow(closed, 'quarter', '2025-12')).toEqual(closed.slice(-12))
  })
  it('is the calendar year of the period for a year', () => {
    expect(historyWindow(closed, 'year', '2025-12')).toEqual(closed.filter(m => m.startsWith('2025')))
  })
  it('is everything for all time', () => {
    expect(historyWindow(closed, 'all', '2026-04')).toEqual(closed)
  })
})
