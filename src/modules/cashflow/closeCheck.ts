// The Cash flow module's check of a month close (registered in ../closeChecks.ts). Server only. Imports the domain, the
// Database type and ./allocation.ts only: ./spending.ts imports server/monthClose.ts, the caller (a cycle).
import { allocationExcess } from '../../domain/spending'
import { InputError } from '../../server/http'
import type { CloseCheck } from '../closeChecks'
import { linesOfMonth } from './allocation'

/**
 * An account's lines may not exceed its draft totals (a total lowered after the lines were typed, by hand or by Claude):
 * 422 lines_exceed_total { name, member, flow, lines, total } for the first such account.
 */
export const checkCashflowClose: CloseCheck = async (month, rows, { db }) => {
  const lines = await linesOfMonth(db, month)
  if (!lines.length) return
  for (const r of rows) {
    const own = lines.filter(l => l.bank === r.name && l.member === r.member)
    const [excess] = allocationExcess(own, own.map(l => l.category), { active: r.active, passive: r.passive, expense: r.expense })
    if (excess) throw new InputError('lines_exceed_total', 422, { name: r.name, member: r.member, ...excess })
  }
}
