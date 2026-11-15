// The Cash flow module's check of rows-API writes to its tables (registered in ../rowChecks.ts). Server only. Imports
// the domain, the Database type and ./allocation.ts only: ./spending.ts imports server/rows.ts, the caller (a cycle).
import { allocationExcess } from '../../domain/spending'
import { InputError } from '../../server/http'
import type { RowCheck } from '../rowChecks'
import { linesOfMonth } from './allocation'

const totalOf = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number(v))

/**
 * A monthly_cashflow row may not drop a total below the lines that allocate it: 409 lines_exceed_total { flow, lines,
 * total }. The lines are looked up under the key the row will have; a bank or member change is not refused (the
 * account operation validates destination totals before composing row and line moves in the same transaction).
 */
export const checkCashflowRow: RowCheck = async (table, { row }, { db }) => {
  if (table !== 'monthly_cashflow' || typeof row.date !== 'string') return
  const lines = (await linesOfMonth(db, row.date.slice(0, 7))).filter(l => l.bank === String(row.bank ?? '') && l.member === String(row.member ?? ''))
  if (!lines.length) return
  const [excess] = allocationExcess(lines, lines.map(l => l.category), {
    active: totalOf(row.active_income), passive: totalOf(row.passive_income), expense: totalOf(row.expense),
  })
  if (excess) throw new InputError('lines_exceed_total', 409, { ...excess })
}
