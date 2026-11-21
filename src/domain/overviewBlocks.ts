import { monthOf, shiftMonth } from './dates'
import { round2 } from './fx'
import type { FinanceSnapshot, HistoryPoint } from './types'

/** The assets window's gridline steps, the smallest first */
const TICK_STEPS = [5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000, 10000000, 20000000, 50000000]
/** The net-worth window's step (the Overview's grid), and a flat assets window's (no step giving three ticks) */
const FIXED_STEP = 20000

/** The multiples of `step` from the floor of the lowest value to the ceiling of the highest, at least two */
function ticksAt(values: number[], step: number): number[] {
  const low = values.length ? Math.floor(Math.min(...values) / step) : 0
  const high = Math.max(low + 1, values.length ? Math.ceil(Math.max(...values) / step) : 0)
  return Array.from({ length: high - low + 1 }, (_, i) => (low + i) * step)
}

function adaptiveTicks(values: number[]): number[] {
  const fits = TICK_STEPS.map(step => ticksAt(values, step)).find(t => t.length >= 3 && t.length <= 5)
  const largest = ticksAt(values, Math.max(...TICK_STEPS))
  return fits ?? (largest.length > 5 ? largest : ticksAt(values, FIXED_STEP))
}

/**
 * The last `size` points up to the month (the last point not after it ends the window; clamped to the start, so the
 * window may be shorter), `index` the position of that point and `ticks` the gridlines around the window's `field`:
 * multiples of 20 000 for net worth (the Overview's grid); for the assets the smallest step of TICK_STEPS giving three
 * to five of them (a flat window keeps 20 000; a range past the largest step takes it, however many ticks). `changes[i]` is the point's `field` less the previous month's point (the one
 * before the window counts for the first); null after a gap or for the first month.
 */
export function monthWindow(history: HistoryPoint[], month: string, size = 13, field: 'netWorth' | 'assets' = 'netWorth'): { points: HistoryPoint[]; index: number; ticks: number[]; changes: (number | null)[] } {
  const upTo = history.filter(p => monthOf(p.date) <= month)
  const start = Math.max(0, upTo.length - size)
  const points = upTo.slice(start)
  const index = points.length - 1
  const values = points.map(p => p[field])
  const ticks = field === 'netWorth' ? ticksAt(values, FIXED_STEP) : adaptiveTicks(values)
  const changes = points.map((p, i) => {
    const prev = upTo[start + i - 1]
    return prev && monthOf(prev.date) === shiftMonth(monthOf(p.date), -1) ? round2(p[field] - prev[field]) : null
  })
  return { points, index, ticks, changes }
}

/** The closed months whose net worth is partial: a balance is missing or has no rate (`capitalCoverage[].capitalKnown` false) */
export const partialCapitalMonths = (s: Pick<FinanceSnapshot, 'capitalCoverage'>): Set<string> =>
  new Set((s.capitalCoverage ?? []).filter(c => !c.capitalKnown).map(c => c.month))

/** The latest balances' liquid money (the bank accounts) is known: there are balances and none of them is missing or without a rate (`liquidKnown`) */
export const liquidKnown = (s: Pick<FinanceSnapshot, 'capital' | 'capitalCoverage'>): boolean =>
  !!s.capital && s.capitalCoverage?.find(c => c.month === monthOf(s.capital!.date))?.liquidKnown !== false

/**
 * The month's net worth less the previous month's and less the same month a year earlier's; null when the month or
 * the compared one has no point (a gap is not bridged) or a partial one (`partial`).
 */
export function selectedDeltas(history: HistoryPoint[], month: string, partial: ReadonlySet<string>): { month: number | null; year: number | null } {
  const byMonth = new Map(history.filter(p => !partial.has(monthOf(p.date))).map(p => [monthOf(p.date), p.netWorth]))
  const now = byMonth.get(month)
  const delta = (ago: number): number | null => {
    const then = byMonth.get(shiftMonth(month, -ago))
    return now === undefined || then === undefined ? null : now - then
  }
  return { month: delta(1), year: delta(12) }
}
