import { describe, expect, it } from 'vitest'
import { bridgeParts, memberSplit, monthWindow, selectedDeltas } from '../../src/domain/overviewBlocks'
import { monthOf } from '../../src/domain/dates'
import { HIST } from '../helpers/history'
import { makeSnapshot, SHARED } from '../helpers/snapshot'

describe('monthWindow', () => {
  it('takes thirteen points ending at the month, with 20 000 ticks around their range', () => {
    const w = monthWindow(HIST, '2026-09')
    expect(w.points).toHaveLength(13)
    expect(w.index).toBe(12)
    expect(monthOf(w.points[0].date)).toBe('2025-09')
    expect(monthOf(w.points[12].date)).toBe('2026-09')
    expect(w.ticks).toEqual([700000, 720000, 740000, 760000])
  })

  it('clamps to the start of history', () => {
    const w = monthWindow(HIST, '2023-12')
    expect(w.index).toBe(2)
    expect(w.points).toHaveLength(3)
    expect(monthOf(w.points[0].date)).toBe('2023-10')
  })

  it('honours the size and ends at the last point not after the month', () => {
    const w = monthWindow(HIST, '2026-10', 6)
    expect(w.points).toHaveLength(6)
    expect(w.index).toBe(5)
    expect(monthOf(w.points[5].date)).toBe('2026-09')
  })

  it('gives each point its change over the previous month, the one before the window included', () => {
    const w = monthWindow(HIST, '2026-09')
    const before = HIST.find(p => monthOf(p.date) === '2025-08')!
    expect(w.changes).toHaveLength(13)
    expect(w.changes[0]).toBeCloseTo(w.points[0].netWorth - before.netWorth, 2)
    expect(w.changes[12]).toBeCloseTo(w.points[12].netWorth - w.points[11].netWorth, 2)
    // the history's first month has nothing to compare with; a gap is not bridged
    expect(monthWindow(HIST, '2023-12').changes[0]).toBeNull()
    const gap = HIST.filter(p => monthOf(p.date) !== '2026-05')
    expect(monthWindow(gap, '2026-09').changes[monthWindow(gap, '2026-09').points.findIndex(p => monthOf(p.date) === '2026-06')]).toBeNull()
  })

  it('keeps the 20 000 grid for net worth, however few ticks it gives', () => {
    expect(monthWindow(HIST, '2023-11').ticks).toEqual([520000, 540000, 560000])
    expect(monthWindow(HIST, '2024-09').ticks).toEqual([520000, 540000, 560000, 580000, 600000, 620000])
  })

  it('reads the assets when asked, with a step that gives three to five ticks', () => {
    const w = monthWindow(HIST, '2026-09', 36, 'assets')
    expect(w.points).toHaveLength(36)
    const values = w.points.map(p => p.assets)
    expect([Math.min(...values), Math.max(...values)]).toEqual([919543, 1144127])
    expect(w.ticks).toEqual([900000, 1000000, 1100000, 1200000])
    expect(w.changes[35]).toBeCloseTo(w.points[35].assets - w.points[34].assets, 2)
    // a narrow range takes a small step
    const narrow = [{ date: '2026-01-31', assets: 101000, liabilities: 0, netWorth: 0 }, { date: '2026-02-28', assets: 112000, liabilities: 0, netWorth: 0 }]
    expect(monthWindow(narrow, '2026-02', 13, 'assets').ticks).toEqual([100000, 105000, 110000, 115000])
  })

  it('steps a window of tens of millions in 10M–50M', () => {
    const big = [40, 90, 150].map((m, i) => ({ date: `2026-0${i + 1}-28`, assets: m * 1000000, liabilities: 0, netWorth: 0 }))
    const { ticks } = monthWindow(big, '2026-03', 13, 'assets')
    expect(ticks).toEqual([0, 50000000, 100000000, 150000000])
  })

  it('always gives at least two ticks', () => {
    expect(monthWindow(HIST, '2023-10').ticks).toEqual([520000, 540000])
    expect(monthWindow([], '2023-10')).toEqual({ points: [], index: -1, ticks: [0, 20000], changes: [] })
  })
})

describe('memberSplit', () => {
  it('shares assets by member and names each member’s two largest holdings', () => {
    const capital = makeSnapshot().capital!
    const split = memberSplit(capital)
    expect(split.map(s => s.member)).toEqual(capital.byMember.map(m => m.member))
    expect(split.reduce((a, s) => a + s.sharePct, 0)).toBeCloseTo(100, 1)
    for (const s of split) expect(s.largest.length).toBeLessThanOrEqual(2)
    expect(split.find(s => s.member === '')).toMatchObject({ valueBase: 134000, largest: ['City apartment'] })
    expect(split.find(s => s.member === SHARED)!.largest).toEqual([])
  })

  it('orders a member’s holdings largest first across accounts and properties', () => {
    const base = makeSnapshot().capital!
    const capital = {
      ...base,
      assets: 60,
      byMember: [{ member: 'A', valueBase: 60 }],
      accounts: [
        { ...base.accounts[0], name: 'Small', member: 'A', valueBase: 10 },
        { ...base.accounts[0], name: 'Rateless', member: 'A', valueBase: null },
        { ...base.accounts[0], name: 'Mid', member: 'A', valueBase: 20 },
      ],
      realEstate: [{ ...base.realEstate[0], name: 'Flat', member: 'A', valueBase: 30 }],
    }
    expect(memberSplit(capital)).toEqual([{ member: 'A', valueBase: 60, sharePct: 100, largest: ['Flat', 'Mid'] }])
  })

  it('gives zero shares when there are no assets', () => {
    const capital = { ...makeSnapshot().capital!, assets: 0, byMember: [{ member: 'A', valueBase: 0 }] }
    expect(memberSplit(capital)[0].sharePct).toBe(0)
  })
})

describe('bridgeParts', () => {
  it('splits assets into net worth and loans, in percent', () => {
    const parts = bridgeParts(makeSnapshot().capital!)
    expect(parts.netPct).toBeCloseTo(74.07, 2)
    expect(parts.loansPct).toBeCloseTo(25.93, 2)
    expect(bridgeParts({ ...makeSnapshot().capital!, assets: 0 })).toEqual({ netPct: 0, loansPct: 0 })
  })

  it('takes a history point: the selected month of the fixture, September 2024', () => {
    const point = HIST[11]
    expect(point).toMatchObject({ netWorth: 603469, liabilities: 385454, assets: 988923 })
    const parts = bridgeParts(point)
    expect(parts.netPct).toBeCloseTo(61.02, 2)
    expect(parts.loansPct).toBeCloseTo(38.98, 2)
  })
})

describe('selectedDeltas', () => {
  it('compares the month with the one before and the one a year earlier', () => {
    expect(selectedDeltas(HIST, '2026-09', new Set())).toEqual({ month: 3122, year: 43278 })
  })

  it('is null where the compared point does not exist', () => {
    expect(selectedDeltas(HIST, '2023-10', new Set())).toEqual({ month: null, year: null })
    expect(selectedDeltas(HIST, '2024-09', new Set())).toEqual({ month: 5908, year: null })
    expect(selectedDeltas(HIST, '2030-01', new Set())).toEqual({ month: null, year: null })
  })
})
