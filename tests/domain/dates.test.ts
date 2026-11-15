import { describe, expect, it } from 'vitest'
import { isDay, isoDate, latestMonth, monthEnd, monthOf, monthsBehind, monthsBetween, shiftMonth } from '../../src/domain/dates'

describe('dates', () => {
  it('extracts the month', () => expect(monthOf('2031-04-17')).toBe('2031-04'))
  it('returns the last day of a month, leap years included', () => {
    expect(monthEnd('2029-02')).toBe('2029-02-28')
    expect(monthEnd('2032-02')).toBe('2032-02-29')
    expect(monthEnd('2033-12')).toBe('2033-12-31')
  })
  it('shifts months across year boundaries', () => {
    expect(shiftMonth('2030-01', -1)).toBe('2029-12')
    expect(shiftMonth('2031-07', -12)).toBe('2030-07')
    expect(shiftMonth('2032-11', 3)).toBe('2033-02')
  })
  it('formats a Date as an ISO day in UTC', () => {
    expect(isoDate(new Date('2031-04-17T23:30:00Z'))).toBe('2031-04-17')
  })
})

describe('monthsBetween', () => {
  it('counts months between YYYY-MM values, days ignored, negative backwards', () => {
    expect(monthsBetween('2029-08', '2030-08')).toBe(12)
    expect(monthsBetween('2030-12-31', '2031-01-01')).toBe(1)
    expect(monthsBetween('2032-05', '2032-05')).toBe(0)
    expect(monthsBetween('2032-05', '2031-12')).toBe(-5)
  })
})

describe('shiftMonth, monthsBetween and monthEnd over 1999–2100 (properties)', () => {
  const SHIFTS = [-25, -13, -1, 0, 1, 11, 12, 37]
  const months = Array.from({ length: (2100 - 1999 + 1) * 12 }, (_, i) => `${1999 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`)

  it('monthsBetween undoes shiftMonth, and shifting back returns the month', () => {
    const violations: string[] = []
    for (const ym of months) for (const n of SHIFTS) {
      const shifted = shiftMonth(ym, n)
      if (monthsBetween(ym, shifted) !== n || shiftMonth(shifted, -n) !== ym) violations.push(`${ym} ${n}`)
    }
    expect(months).toHaveLength(1224)
    expect(violations).toEqual([])
  })

  it('monthEnd is a day of that month, and the day after it is the first of the next month', () => {
    const violations = months.filter(ym => {
      const end = monthEnd(ym)
      const next = isoDate(new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000))
      return monthOf(end) !== ym || next !== `${shiftMonth(ym, 1)}-01`
    })
    expect(violations).toEqual([])
  })
})

describe('monthsBehind', () => {
  it('counts whole months from the closed month to today in UTC, never below zero', () => {
    expect(monthsBehind('2031-02', new Date('2031-08-09T09:00:00Z'))).toBe(6)
    expect(monthsBehind('2030-11', new Date('2030-12-31T23:30:00Z'))).toBe(1)
    expect(monthsBehind('2032-09', new Date('2031-12-04T09:00:00Z'))).toBe(0)
  })
})

describe('latestMonth', () => {
  it('picks the latest month and is null for an empty list', () => {
    expect(latestMonth(['2032-03', '2032-08', '2031-11'])).toBe('2032-08')
    expect(latestMonth([])).toBeNull()
  })
})


describe('isDay', () => {
  it('accepts only a real calendar day YYYY-MM-DD', () => {
    expect(isDay('2032-02-29')).toBe(true)
    for (const bad of ['2031-02-29', '2026-13-01', '2026-1-01', '2026-01-01T00:00', '']) expect(isDay(bad)).toBe(false)
  })
})
