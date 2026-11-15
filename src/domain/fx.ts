import type { Rates } from './types'

/** Units of `currency` per 1 USD; USD is always 1. Undefined when the currency has no rate. */
const perUsd = (currency: string, rates: Rates): number | undefined => (currency === 'USD' ? 1 : rates[currency])

/**
 * Converts `value` from one currency to another through the per-USD cross rate.
 * The same currency needs no rate; a side without a rate gives null: an amount
 * is never silently treated as another currency. A rate that is not a positive finite number (0, negative, NaN, ∞)
 * counts as no rate.
 */
export function convert(value: number, from: string, to: string, rates: Rates): number | null {
  if (from === to) return value
  const f = perUsd(from, rates)
  const t = perUsd(to, rates)
  if (!isRate(f) || !isRate(t)) return null
  return (value / f) * t
}

const isRate = (rate: number | undefined): rate is number => rate !== undefined && Number.isFinite(rate) && rate > 0

/** Rounds to `digits` decimals, a half away from zero on both sides (0.25 → 0.3, −0.25 → −0.3 for one digit); never −0. The one rounding of the domain. */
export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits
  // toPrecision(15) drops the binary error first: 1.005 * 100 is 100.49999999999999, which is 100.5
  const rounded = Math.sign(value) * Math.round(Number((Math.abs(value) * factor).toPrecision(15))) / factor
  return rounded === 0 ? 0 : rounded
}

/** Rounds to the cent, a half cent away from zero on both sides (0.125 → 0.13, −0.125 → −0.13); never −0. */
export function round2(value: number): number {
  return roundTo(value, 2)
}

/** convert rounded to the cent; null without a rate, like convert. */
export function convertRounded(value: number, from: string, to: string, rates: Rates): number | null {
  const v = convert(value, from, to, rates)
  return v === null ? null : round2(v)
}
