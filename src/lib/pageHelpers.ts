import { monthOf } from '../domain/dates'
import { fmtMonth } from './formatters'
import { PRIVACY_MASK } from './privacy'

/** « · May 2026» after the headline label; a month or a date; no period — an empty string. */
export const periodSuffix = (ym: string | null | undefined) => (ym ? ` · ${fmtMonth(monthOf(ym))}` : '')

/** «+$1,200» for growth; a drop or zero as is; the privacy mask without a sign, so it does not tell the direction. */
export const signed = (usd: number, fmt: (v: number) => string) => {
  const text = fmt(usd)
  return usd > 0 && text !== PRIVACY_MASK ? `+${text}` : text
}
