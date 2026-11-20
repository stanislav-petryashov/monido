// The years comb of the Overview: the net-worth history laid out as calendar-year cells of twelve month strokes.

import { monthOf } from './dates'
import type { HistoryPoint } from './types'

export type MonthState = 'closed' | 'open' | 'none'

export interface YearCell {
  year: number
  /** Exactly twelve, January first; `netWorth` only for a closed month whose net worth is known (not partial) */
  months: { month: string; netWorth: number | null; state: MonthState }[]
  /** The last closed month's net worth of the year; null when the year has no closed month or that month's is partial */
  endNetWorth: number | null
  /** endNetWorth − the previous year's; for the first year of history, − its own first closed value; null — either is unknown */
  change: number | null
  /** Closed months in the year */
  changeMonths: number
  /** The year of `today` (UTC) */
  current: boolean
}

function yearOf(ym: string): number {
  return Number(ym.slice(0, 4))
}

/**
 * One cell per calendar year from the first history month's year to the latest of the last history year, the first
 * open month's year and today's year. An empty history gives no cells. A `partial` month (`partialCapitalMonths`) is
 * closed without a net worth.
 */
export function yearCells(history: HistoryPoint[], openMonths: string[], today: Date, partial: ReadonlySet<string>): YearCell[] {
  const byMonth = new Map(history.map(p => [monthOf(p.date), p.netWorth]))
  const open = new Set(openMonths)
  const months = [...byMonth.keys()].sort()
  const firstMonth = months[0], lastMonth = months.at(-1)
  if (firstMonth === undefined || lastMonth === undefined) return []
  const firstOpen = [...openMonths].sort()[0]
  const firstYear = yearOf(firstMonth)
  const lastYear = Math.max(
    yearOf(lastMonth),
    firstOpen !== undefined ? yearOf(firstOpen) : -Infinity,
    today.getUTCFullYear(),
  )

  const cells: YearCell[] = []
  // undefined — no year with a closed month yet; null — the previous year's end is partial
  let previousEnd: number | null | undefined
  for (let year = firstYear; year <= lastYear; year++) {
    const cellMonths = Array.from({ length: 12 }, (_, i) => {
      const month = `${year}-${String(i + 1).padStart(2, '0')}`
      const netWorth = byMonth.get(month)
      const state: MonthState = netWorth !== undefined ? 'closed' : open.has(month) ? 'open' : 'none'
      return { month, netWorth: netWorth === undefined || partial.has(month) ? null : netWorth, state }
    })
    const closed = cellMonths.filter(m => m.state === 'closed')
    const endNetWorth = closed.at(-1)?.netWorth ?? null
    const base = previousEnd === undefined ? (closed[0]?.netWorth ?? null) : previousEnd
    const change = endNetWorth === null || base === null ? null : endNetWorth - base
    cells.push({ year, months: cellMonths, endNetWorth, change, changeMonths: closed.length, current: year === today.getUTCFullYear() })
    if (closed.length) previousEnd = endNetWorth
  }
  return cells
}

/** The last `window` cells shifted back by `offset` years, clamped to the range. */
export function visibleYears(cells: YearCell[], window = 4, offset = 0): YearCell[] {
  const end = Math.max(window, cells.length - Math.max(0, offset))
  return cells.slice(Math.max(0, end - window), end)
}

/** A month stroke's height in px, linear over the whole history's range; 0 for no value. */
export function strokeHeight(netWorth: number | null, range: { min: number; max: number }, px = { min: 4, max: 34 }): number {
  if (netWorth === null) return 0
  const span = range.max - range.min
  const share = span > 0 ? Math.min(1, Math.max(0, (netWorth - range.min) / span)) : 0
  return px.min + share * (px.max - px.min)
}
