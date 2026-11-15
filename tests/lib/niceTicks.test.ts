import { niceStep, niceTicks } from '../../src/lib/niceTicks'

describe('niceTicks', () => {
  it('rounds the scale to steps of 1, 2, 2.5 or 5 and covers the range', () => {
    expect(niceTicks(712300, 760837)).toEqual([700000, 720000, 740000, 760000, 780000])
    expect(niceTicks(0, 9)).toEqual([0, 5, 10])
  })

  it('gives a flat series at least two distinct ticks around the value', () => {
    const ticks = niceTicks(5, 5)
    expect(new Set(ticks).size).toBeGreaterThanOrEqual(2)
    expect(ticks[0]).toBeLessThanOrEqual(5)
    expect(ticks[ticks.length - 1]).toBeGreaterThan(5)
  })

  it('handles negatives and fractions without float noise', () => {
    expect(niceTicks(-3, 4).every(Number.isInteger)).toBe(true)
    expect(niceTicks(0.1, 0.35)).toEqual([0.1, 0.2, 0.3, 0.4])
  })
})

describe('niceTicks edge cases', () => {
  it('returns a safe scale instead of looping on non-finite input', () => {
    for (const [a, b] of [[NaN, 1], [0, Infinity], [-Infinity, 3]]) expect(niceTicks(a, b)).toEqual([0, 1])
  })
  it('pads a flat range so the ticks differ and the value sits inside', () => {
    for (const v of [5, 5_000_000, 0, -40]) {
      const ticks = niceTicks(v, v)
      expect(new Set(ticks.map(String)).size).toBe(ticks.length)
      expect(ticks.length).toBeGreaterThanOrEqual(3)
      expect(ticks[0]).toBeLessThan(v)
      expect(ticks[ticks.length - 1]).toBeGreaterThan(v)
    }
  })
  it('covers an all-negative range', () => {
    const ticks = niceTicks(-9, -1)
    expect(ticks[0]).toBeLessThanOrEqual(-9)
    expect(ticks[ticks.length - 1]).toBeGreaterThan(-1)
  })
})

// The zero-based goal and loan charts keep their existing scale when sharing the step calculation.
it('keeps the zero-based chart steps across fractional and large amounts', () => {
  expect([0.45, 9, 10, 100, 1_000_000].map(value => niceStep(value))).toEqual([0.1, 2, 2.5, 25, 250_000])
})

it('retains the sparser property grid', () => {
  expect([0.45, 9, 10, 100, 1_000_000].map(value => niceStep(value, 3))).toEqual([0.2, 5, 5, 50, 500_000])
})
