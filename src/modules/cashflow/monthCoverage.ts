import type { MonthCloseState, SpendingRecords } from '../../domain/api'
import { shiftMonth } from '../../domain/dates'
import { allocationSummary } from '../../domain/spending'

type Closure = Pick<MonthCloseState, 'queue' | 'incomplete' | 'lastClosed'>
export type CoverageStatus = 'notClosed' | 'missingTotals' | 'over' | 'orphaned' | 'unallocated' | 'noActivity' | 'allocated' | 'sourcesOnly' | 'unknown' | 'noRecords'
export interface MonthCoverage { month: string; status: CoverageStatus; selectable: boolean }

/** Presentation of existing records, never a substitute for the close-month validation or a currency total. */
export function monthCoverage(data: SpendingRecords, closure?: Closure): MonthCoverage[] {
  const queue = new Set(closure?.queue ?? [])
  const incomplete = new Set((closure?.incomplete ?? []).map(item => item.month))
  const months = new Set([...data.accounts.map(a => a.month), ...data.sources.map(s => s.month), ...queue, ...incomplete])
  if (closure?.lastClosed) months.add(closure.lastClosed.month)
  const known = [...months].sort()
  const first = known[0]
  const last = known.at(-1)
  if (first && last) for (let month = shiftMonth(first, 1); month < last; month = shiftMonth(month, 1)) months.add(month)
  return [...months].sort().reverse().map(month => {
    const rows = data.accounts.filter(a => a.month === month)
    const own = rows.filter(a => !a.orphaned)
    const summaries = own.flatMap(a => [allocationSummary(a.allocated, a.totals, 'income'), allocationSummary(a.allocated, a.totals, 'expense')])
    const sources = data.sources.filter(s => s.month === month)
    const sourceActivity = sources.some(source => source.items.some(item => item.amount > 0))
    const selectable = rows.length > 0 || sources.length > 0
    const missing = own.some(a => !a.totals || Object.values(a.totals).some(value => value === null)) || incomplete.has(month)
    let status: CoverageStatus
    if (queue.has(month) || (closure && month > (closure.lastClosed?.month ?? ''))) status = 'notClosed'
    else if (missing) status = 'missingTotals'
    else if (summaries.some(s => s.over.length)) status = 'over'
    else if (rows.some(a => a.orphaned)) status = 'orphaned'
    else if (summaries.some(s => (s.rest ?? 0) > 0)) status = 'unallocated'
    else if (!selectable) status = 'noRecords'
    else if (!closure) status = 'unknown'
    else if (!own.length) status = 'sourcesOnly'
    else status = summaries.every(s => s.total === 0) ? (sourceActivity ? 'sourcesOnly' : 'noActivity') : 'allocated'
    return { month, status, selectable }
  })
}
