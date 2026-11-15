import { describe, expect, it } from 'vitest'
import { strokeHeight, visibleYears, yearCells } from '../../src/domain/yearCells'
import { HIST, LONG_HIST } from '../helpers/history'

describe('yearCells', () => {
  it('one cell per calendar year, twelve months each, with closed/open/none states', () => {
    const cells = yearCells(HIST, ['2026-10'], new Date('2026-11-06T00:00:00Z'), new Set())
    expect(cells.map(c => c.year)).toEqual([2023, 2024, 2025, 2026])
    expect(cells.every(c => c.months.length === 12)).toBe(true)
    expect(cells[0].months.filter(m => m.state === 'closed')).toHaveLength(3)
    expect(cells[0].months[8].state).toBe('none')
    expect(cells[0].months[9]).toEqual({ month: '2023-10', state: 'closed', netWorth: 534089 })
    expect(cells[3].months[9]).toMatchObject({ month: '2026-10', state: 'open', netWorth: null })
    expect(cells[3].months[10].state).toBe('none')
    expect(cells[3].current).toBe(true)
    expect(cells[2].current).toBe(false)
  })

  it('year change is against the previous year end, and the first year against its own first month', () => {
    const cells = yearCells(HIST, [], new Date('2026-11-06T00:00:00Z'), new Set())
    expect(cells[0].endNetWorth).toBe(549684)
    expect(cells[1].endNetWorth).toBe(593481)
    expect(cells[1].change).toBe(cells[1].endNetWorth! - cells[0].endNetWorth!)
    expect(cells[1].changeMonths).toBe(12)
    expect(cells[0].change).toBe(cells[0].endNetWorth! - HIST[0].netWorth)
    expect(cells[0].changeMonths).toBe(3)
    expect(cells[3].endNetWorth).toBe(758673)
    expect(cells[3].changeMonths).toBe(9)
  })

  it('an open January adds a cell for the new year with no closed month', () => {
    const cells = yearCells(HIST.slice(0, 27), ['2026-01'], new Date('2026-01-15T00:00:00Z'), new Set())
    expect(cells.map(c => c.year)).toEqual([2023, 2024, 2025, 2026])
    expect(cells.at(-1)).toMatchObject({ year: 2026, endNetWorth: null, change: null, changeMonths: 0, current: true })
    expect(cells.at(-1)!.months[0].state).toBe('open')
  })

  it('today alone extends the range, and an empty history gives no cells', () => {
    const cells = yearCells(HIST, [], new Date('2027-02-01T00:00:00Z'), new Set())
    expect(cells.map(c => c.year)).toEqual([2023, 2024, 2025, 2026, 2027])
    expect(cells.at(-1)).toMatchObject({ year: 2027, endNetWorth: null, change: null, current: true })
    expect(yearCells([], ['2026-10'], new Date('2026-11-06T00:00:00Z'), new Set())).toEqual([])
  })

  it('visibleYears shows the last four and shifts back', () => {
    const five = yearCells(LONG_HIST, [], new Date('2027-03-01T00:00:00Z'), new Set())
    expect(five.map(c => c.year)).toEqual([2023, 2024, 2025, 2026, 2027])
    expect(visibleYears(five).map(c => c.year)).toEqual([2024, 2025, 2026, 2027])
    expect(visibleYears(five, 4, 1).map(c => c.year)).toEqual([2023, 2024, 2025, 2026])
    expect(visibleYears(five, 4, 9).map(c => c.year)).toEqual([2023, 2024, 2025, 2026])
    expect(visibleYears(five, 2).map(c => c.year)).toEqual([2026, 2027])
    expect(visibleYears(five.slice(0, 2)).map(c => c.year)).toEqual([2023, 2024])
  })

  it('strokeHeight is linear over the given range and 4px at the minimum', () => {
    expect(strokeHeight(500000, { min: 500000, max: 800000 })).toBe(4)
    expect(strokeHeight(800000, { min: 500000, max: 800000 })).toBe(34)
    expect(strokeHeight(650000, { min: 500000, max: 800000 })).toBe(19)
    expect(strokeHeight(null, { min: 1, max: 2 })).toBe(0)
    expect(strokeHeight(5, { min: 5, max: 5 })).toBe(4)
    expect(strokeHeight(100, { min: 0, max: 10 }, { min: 2, max: 12 })).toBe(12)
  })
})
