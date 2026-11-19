// The closed month's recap: a fixed table of the month against the month before and the same month a year ago, in the
// snapshot's currency, and one note on net worth. An unknown cell is null (a dash), never 0.
import { addedOf, isMonthChange, marketsOf } from './capitalChange'
import { monthOf, shiftMonth } from './dates'
import { round2 } from './fx'
import { partialCapitalMonths } from './overviewBlocks'
import type { FinanceSnapshot } from './types'

export type RecapRowKey = 'netWorth' | 'added' | 'markets' | 'fund' | 'debt'
export interface RecapRow { key: RecapRowKey; now: number | null; vsPrev: number | null; vsYear: number | null }
export interface MonthRecap {
  month: string; rows: RecapRow[]
  /** "first time above" a net-worth mark (in the family currency), else "highest ever" */
  note: { key: 'highest' } | { key: 'firstAbove'; amount: number; currency: string } | null
}

export function monthRecap(s: FinanceSnapshot, month: string): MonthRecap {
  const partial = partialCapitalMonths(s)
  const capital = (m: string) => (partial.has(m) ? undefined : s.history.find(p => monthOf(p.date) === m))
  const change = (m: string) => {
    const c = s.capitalChange?.find(x => x.month === m)
    return c && isMonthChange(c) && c.form === 'tracked' ? c : null
  }
  const fund = (m: string) => s.fundHistory?.find(f => f.month === m)?.months ?? null
  const row = (key: RecapRowKey, of: (m: string) => number | null | undefined): RecapRow => {
    const now = of(month) ?? null
    const diff = (m: string) => { const then = of(m); return now === null || then == null ? null : round2(now - then) }
    return { key, now, vsPrev: diff(shiftMonth(month, -1)), vsYear: diff(shiftMonth(month, -12)) }
  }
  const flowRows = s.trackFlows ? [row('added', m => { const c = change(m); return c && addedOf(c) }), row('markets', m => { const c = change(m); return c && marketsOf(c) })] : []
  const rows = [row('netWorth', m => capital(m)?.netWorth), ...flowRows, row('fund', fund), row('debt', m => capital(m)?.liabilities)]

  const mark = s.milestones?.find(x => x.month === month && x.kind === 'netWorthMark') ?? s.markCrossings?.find(x => x.month === month)
  const now = capital(month)?.netWorth
  const earlier = s.history.filter(p => monthOf(p.date) < month && !partial.has(monthOf(p.date)))
  const highest = now !== undefined && earlier.length > 0 && earlier.every(p => p.netWorth <= now)
  const note: MonthRecap['note'] = mark ? { key: 'firstAbove', amount: mark.level!, currency: mark.currency! } : highest ? { key: 'highest' } : null
  return { month, rows, note }
}
