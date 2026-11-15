import { describe, expect, it } from 'vitest'
import { convert, convertRounded, round2, roundTo } from '../../src/domain/fx'

const r = { RUB: 90, EUR: 0.9 }

describe('convert', () => {
  it('converts through the per-USD rates', () => {
    expect(convert(900, 'RUB', 'USD', r)).toBe(10)
    expect(convert(10, 'USD', 'RUB', r)).toBe(900)
    expect(convert(9, 'EUR', 'RUB', r)).toBeCloseTo(900)
  })
  it('needs no rate for the same currency', () => {
    expect(convert(5, 'GBP', 'GBP', {})).toBe(5)
    expect(convert(240, 'USD', 'USD', {})).toBe(240)
  })
  it('returns null instead of guessing', () => {
    expect(convert(5, 'GBP', 'USD', r)).toBeNull()
    expect(convert(5, 'USD', 'XYZ', r)).toBeNull()
    expect(convert(900, 'RUB', 'EUR', {})).toBeNull()
  })
  it('treats a rate of 0 or NaN as no rate, on either side', () => {
    expect(convert(10, 'XAU', 'USD', { XAU: 0 })).toBeNull()
    expect(convert(10, 'USD', 'XAU', { XAU: 0 })).toBeNull()
    expect(convert(10, 'XAU', 'USD', { XAU: NaN })).toBeNull()
  })
  // like the database, which refuses such a hand-entered rate (fx_manual_rates CHECK per_usd > 0)
  it.each([-2, -0.5, Infinity, -Infinity])('treats a rate of %s as no rate, on either side', rate => {
    expect(convert(10, 'XAU', 'USD', { XAU: rate })).toBeNull()
    expect(convert(10, 'USD', 'XAU', { XAU: rate })).toBeNull()
  })
})

describe('convert over a grid of rates and amounts (properties)', () => {
  const rates = { AAA: 0.001, BBB: 0.9, CCC: 1, DDD: 90, EEE: 12345.678 }
  const CURRENCIES = ['USD', ...Object.keys(rates)]
  const AMOUNTS = [-1e6, -0.01, 0, 0.01, 1234.56, 1e9]
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))

  it('converting there and back returns the amount, and a direct conversion equals one through USD', () => {
    const violations: string[] = []
    for (const from of CURRENCIES) for (const to of CURRENCIES) for (const v of AMOUNTS) {
      const there = convert(v, from, to, rates)!
      if (!close(convert(there, to, from, rates)!, v)) violations.push(`round trip ${v} ${from}→${to}`)
      if (!close(there, convert(convert(v, from, 'USD', rates)!, 'USD', to, rates)!)) violations.push(`via USD ${v} ${from}→${to}`)
    }
    expect(violations).toEqual([])
  })
})

describe('round2', () => {
  it('rounds to cents', () => {
    expect(round2(2.005 * 1000)).toBe(2005)
    expect(round2(52.784)).toBe(52.78)
  })
  it('rounds a half cent away from zero, a negative amount the mirror of a positive one', () => {
    expect(round2(0.125)).toBe(0.13)
    expect(round2(-0.125)).toBe(-0.13)
    expect(round2(-52.784)).toBe(-52.78)
    expect(round2(-2.5)).toBe(-2.5)
  })
  it('rounds a half cent the binary form stores just below the half away from zero too', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(-1.005)).toBe(-1.01)
    expect(round2(8.345)).toBe(8.35)
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(Object.is(round2(-0.0001), 0)).toBe(true)
  })
  it('never returns -0: a tiny negative amount and -0 itself round to 0', () => {
    expect(Object.is(round2(-0.001), 0)).toBe(true)
    expect(Object.is(round2(-0.004999), 0)).toBe(true)
    expect(Object.is(round2(-0), 0)).toBe(true)
  })
})

describe('roundTo', () => {
  it('rounds to the given number of digits, a half away from zero on both sides', () => {
    expect(roundTo(0.25, 1)).toBe(0.3)
    expect(roundTo(-0.25, 1)).toBe(-0.3)
    expect(roundTo(52.784, 1)).toBe(52.8)
    expect(roundTo(2.5, 0)).toBe(3)
    expect(roundTo(-2.5, 0)).toBe(-3)
  })
  it('never returns -0', () => {
    expect(Object.is(roundTo(-0.04, 1), 0)).toBe(true)
    expect(Object.is(roundTo(-0, 0), 0)).toBe(true)
  })
  it('with two digits is round2', () => {
    for (const v of [0.125, -0.125, 2.005 * 1000, 52.784, -52.784, -0.001, 1e-9, 123456.785]) {
      expect(Object.is(roundTo(v, 2), round2(v))).toBe(true)
    }
  })
})

describe('convertRounded', () => {
  it('converts and rounds to cents, null stays null', () => {
    expect(convertRounded(1000, 'RUB', 'USD', { RUB: 75 })).toBe(13.33)
    expect(convertRounded(200, 'RUB', 'USD', { RUB: 6 })).toBe(33.33)
    expect(convertRounded(70, 'GBP', 'USD', r)).toBeNull()
  })
})
