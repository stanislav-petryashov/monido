// Calendar math only (month names live in src/i18n/dates.ts). All math runs in UTC: local Date + toISOString() shifts
// days east of Greenwich (e.g. 2026-09-30 00:00 MSK is 2026-09-29 in UTC).

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** 'YYYY-MM' → last day of that month, 'YYYY-MM-DD'. */
export function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/** 'YYYY-MM' shifted by n months (n may be negative). */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** A calendar month 'YYYY-MM' (01–12) */
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** A real calendar day 'YYYY-MM-DD' (not 2032-02-30). */
export function isDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && isoDate(d) === v
}

/** Months from `from` to `to` ('YYYY-MM…'); negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7))
}

/** The latest 'YYYY-MM' month of the list; null for an empty list. */
export function latestMonth(months: string[]): string | null {
  return months.reduce<string | null>((max, m) => (max === null || m > max ? m : max), null)
}

/** Whole months from the closed month 'YYYY-MM' to the month of `today`; never below 0. */
export function monthsBehind(closedMonth: string, today: Date): number {
  return Math.max(0, monthsBetween(closedMonth, monthOf(isoDate(today))))
}
