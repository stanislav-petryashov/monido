import type { FinanceSnapshot, HistoryPoint } from '../../src/domain/types'
import { monthEnd, monthOf, shiftMonth } from '../../src/domain/dates'
import { makeSnapshot } from './snapshot'

const LIABILITIES = 385454

function points(firstMonth: string, netWorths: number[]): HistoryPoint[] {
  return netWorths.map((netWorth, i) => ({
    date: monthEnd(shiftMonth(firstMonth, i)),
    assets: netWorth + LIABILITIES,
    liabilities: LIABILITIES,
    netWorth,
  }))
}

/** The demo's shape: 36 month-end points from October 2023 to September 2026, net worth rising with two dips. */
export const HIST: HistoryPoint[] = points('2023-10', [
  534089, 544331, 549684, 589358, 572395, 577750, 576657, 582192, 584155, 589473, 597561, 603469,
  600922, 596115, 593481, 621407, 632380, 647307, 665311, 672576, 688172, 699880, 709007, 715395,
  716010, 716721, 723371, 728796, 742490, 737812, 745067, 748055, 746679, 746978, 755551, 758673,
])

/** HIST plus six more months, October 2026 to March 2027: a fifth calendar year. */
export const LONG_HIST: HistoryPoint[] = [...HIST, ...points('2026-10', [760000, 762000, 765000, 767000, 770000, 772000])]

/** @public (read from Task 16 on) A snapshot whose history and `asOf` are the given points, the last one being the closed month. */
export function withHistory(history: HistoryPoint[], openMonths: string[] = []): FinanceSnapshot {
  const last = history.at(-1)
  return makeSnapshot({
    history,
    asOf: { capitalDate: last?.date ?? null, closedMonth: last ? monthOf(last.date) : null, openMonths, today: '2031-07-03' },
  })
}
