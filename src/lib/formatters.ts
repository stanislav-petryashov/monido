import { formatDateParts } from '../domain/dateFormat'
import { currentDateFormat } from './dateFormat'
import { currentLanguage, t } from '../i18n/client'
import { formatNumber, GROUPING } from '../i18n/core'
import { dayOfMonth, inMonth, monthShort, monthTitle } from '../i18n/dates'
import type { AccountClass } from '../domain/accounts'
import { roundTo } from '../domain/fx'

// Numbers and month names follow the UI language (src/i18n/client.ts)

/** Intl.NumberFormat objects are costly to build and these formatters run per cell: one per language, kind and currency. A code Intl rejects is remembered too (null). */
const numberFormats = new Map<string, Intl.NumberFormat | null>()

function numberFormat(kind: 'whole' | 'cents' | 'compact' | 'plain-compact', currency: string, digits = 2): Intl.NumberFormat | null {
  const language = currentLanguage()
  const key = `${language}|${kind}|${currency}|${digits}`
  if (!numberFormats.has(key)) {
    const compact = { notation: 'compact', maximumFractionDigits: digits } as const
    try {
      numberFormats.set(key, new Intl.NumberFormat(language,
        kind === 'whole' ? { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: GROUPING }
          : kind === 'cents' ? { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: GROUPING }
          : kind === 'compact' ? { ...compact, style: 'currency', currency, currencyDisplay: 'narrowSymbol' }
            : compact))
    } catch {
      numberFormats.set(key, null)
    }
  }
  return numberFormats.get(key) ?? null
}

/**
 * A whole amount with the currency's sign in the UI language: '$1,235', '−£40', '2 718 $' in Russian.
 * A code Intl rejects is written after the number.
 */
export function fmtCurrency(value: number, currency: string): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value)
  const abs = Math.abs(rounded)
  const format = numberFormat('whole', currency)
  // a code Intl rejects is written after the number
  const formatted = format ? format.format(abs) : `${abs.toLocaleString(currentLanguage(), { useGrouping: GROUPING })} ${currency}`
  return rounded < 0 ? `−${formatted}` : formatted
}

/** An amount to the cent with the currency's sign: '$2,569.75', '2 569,75 $' in Russian; a code Intl rejects is written after the number. */
export function fmtCurrencyCents(value: number, currency: string): string {
  if (!Number.isFinite(value)) return '—'
  const cents = roundTo(value, 2)
  const format = numberFormat('cents', currency)
  const formatted = format ? format.format(Math.abs(cents)) : `${fmtMoney(Math.abs(cents))} ${currency}`
  return cents < 0 ? `−${formatted}` : formatted
}

/**
 * A short amount for a chart axis: '$780K' (in Russian the unit is a word and the sign follows the number), '−$1.2M'. A code Intl rejects is written after the number.
 * `digits` — at most that many decimals of the unit ('$1.135M' with 3), for gridlines closer than the default two keep apart.
 * Not masked: chart code takes `fmtCompact` from `useDashboard()`, which hides it in privacy mode.
 */
export function fmtCompactCurrency(value: number, currency: string, digits = 2): string {
  if (!Number.isFinite(value)) return '—'
  const format = numberFormat('compact', currency, digits)
  const formatted = format ? format.format(value) : `${numberFormat('plain-compact', '', digits)!.format(value)} ${currency}`
  return formatted.replace('-', '−')
}

/** A short number with no unit, as fmtCompactCurrency without the currency: '12.5M', '−780K' (in Russian the unit is a word). Not masked: the caller hides it in privacy mode. */
export function fmtCompact(value: number): string {
  return numberFormat('plain-compact', '')!.format(value).replace('-', '−')
}

/** 1.64 → '1.6' (in Russian '1,6'); with `fixed` the decimals stay: 5 → '5.0'; typographic minus; no number → '—'. */
export function fmtNum(value: number | null | undefined, digits = 1, { fixed = false } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return formatNumber(value, currentLanguage(), digits, { fixed })
}

/** A share: '4.6%' (`digits` — the decimals, 1 by default: a rate takes 2); growth and changes carry a sign: '+6.2%'. */
export function fmtPct(value: number | null | undefined, { sign = false, digits = 1, preserveNonzero = false } = {}): string {
  const n = fmtNum(value, digits)
  if (n === '—') return n
  if (preserveNonzero && value && n === '0') return t(value < 0 ? 'common.percentAboveNegative' : 'common.percentBelow', { value: fmtNum(10 ** -digits, digits) })
  return `${sign && (value as number) > 0 && n !== '0' ? '+' : ''}${n}%`
}

export function fmtMonths(value: number | null | undefined, { fixed = false } = {}): string {
  const n = fmtNum(value, 1, { fixed })
  return n === '—' ? n : t('units.months', { count: Number((value as number).toFixed(1)), value: n })
}

/** '2026-05' or '2026-05-01' → "May'26" */
export function fmtDate(date: string): string {
  const [year, month] = date.split('-').map(Number)
  return t('dates.monthShortYear', { month: monthShort(t, month), yy: String(year).slice(2) })
}

/** '2026-05' → 'May 2026' */
export function fmtMonthYear(ym: string): string {
  const [year, month] = ym.split('-').map(Number)
  return t('dates.monthYear', { month: monthShort(t, month), year })
}

/** '2026-05' → 'May' */
export const fmtMonthShort = (ym: string): string => monthShort(t, Number(ym.slice(5, 7)))

/** 'YYYY-MM-DD' → 'September 30, 2025' (Russian puts the day first and the month in the genitive, `dates.monthOf`) */
export const fmtDayYear = (date: string): string => t('dates.dayOfYear', { day: Number(date.slice(8, 10)), month: t(`dates.monthOf.${Number(date.slice(5, 7))}`), year: date.slice(0, 4) })

/** 'YYYY-MM' → 'May 2026' */
export const fmtMonth = (ym: string): string => monthTitle(t, ym)

/** Numeric month in the family's date order; the locale is the fallback before settings load. */
export const fmtMonthNumeric = (ym: string): string =>
  currentDateFormat() ? formatDateParts(ym.slice(0, 7), currentDateFormat()!) : new Date(`${ym.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(currentLanguage(), { month: '2-digit', year: 'numeric', timeZone: 'UTC' })

/** 'YYYY-MM' → 'in May' */
export const fmtInMonth = (ym: string): string => inMonth(t, ym)

/** 'YYYY-MM-DD' → 'November 1' */
export const fmtDay = (date: string): string => dayOfMonth(t, date)

/**
 * 'YYYY-MM-DD' → a day in the family's selected order, for dates in tables and field captions;
 * dates are UTC, so the zone cannot shift the day. Empty → '—'; unreadable text — a tail after the day other than a time,
 * a day the month does not have ('2026-02-30' would roll into March) — is returned as is.
 */
export function fmtDayNumeric(date: string | null | undefined): string {
  if (!date) return '—'
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})(?=$|T)/)
  if (!m) return String(date)
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return String(date)
  if (currentDateFormat()) return formatDateParts(date, currentDateFormat()!)
  return d.toLocaleDateString(currentLanguage(), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
}

/** 'YYYY-MM-DD' → the weekday and the long date in the UI language, in UTC: 'Saturday, March 15, 2014' (a date field's caption). */
export function fmtDayLong(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(currentLanguage(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/**
 * A moment (an ISO timestamp, epoch ms or a Date) → its day and time in the browser's zone, in the numeric format of the UI language,
 * the day as fmtDayNumeric writes it (en-US 06/02/2026, 2:05 PM; ru-RU 02.06.2026, 14:05). Nothing or an unreadable value → '—'.
 */
export function fmtDayTime(moment: string | number | Date | null | undefined): string {
  if (moment === null || moment === undefined || moment === '') return '—'
  const d = new Date(moment)
  if (!Number.isFinite(d.getTime())) return '—'
  if (currentDateFormat()) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return `${formatDateParts(iso, currentDateFormat()!)}, ${d.toLocaleTimeString(currentLanguage(), { hour: 'numeric', minute: '2-digit' })}`
  }
  return d.toLocaleString(currentLanguage(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** An account type label; real estate stands next to account types in the capital structure. */
export const classLabel = (cls: AccountClass | 'real_estate'): string => t(`accounts.class.${cls}`)

/** Years with the plural of the UI language, chosen by the rounded value (in Russian a fraction takes the genitive singular). */
export function fmtYears(value: number | null | undefined): string {
  const n = fmtNum(value)
  if (n === '—') return n
  return t('units.years', { count: Number((value as number).toFixed(1)), value: n })
}

/** A span of whole months as years and months, the plural of the UI language: '1 year 6 mo', '5 years 5 mo'; 0 → '0 mo' */
export function fmtSpan(months: number): string {
  const y = Math.floor(months / 12), m = months % 12
  return [y > 0 && t('units.years', { count: y, value: y }), (m > 0 || y === 0) && t('units.months', { count: m, value: m })].filter(Boolean).join(' ')
}

/** An amount in the account currency with two decimals: '12,345.60'; typographic minus; no number → '—'. */
export function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const rounded = Number(value.toFixed(2))
  return (rounded === 0 ? 0 : rounded)
    .toLocaleString(currentLanguage(), { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: GROUPING })
    .replace('-', '−')
}
