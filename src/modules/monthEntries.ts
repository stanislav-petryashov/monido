// Whether a module keeps entries of its own for a month (the cashflow module's category lines): the catch-up grid leaves such
// a month to the wizard instead of closing it with balances only. Server only, kept apart from SERVER_MODULES like closeChecks.ts.
import type { Database } from '../server/db'
import { cashflowMonthEntries } from './cashflow/monthEntries'
import type { ModuleKey } from './types'

/** True when the module has an entry dated in `month` ('YYYY-MM') */
export type MonthEntries = (month: string, ctx: { db: Database }) => Promise<boolean>

const MONTH_ENTRIES: Partial<Record<ModuleKey, MonthEntries>> = { cashflow: cashflowMonthEntries }

/** True when any module has entries of its own in the month. */
export async function moduleHasEntries(month: string, ctx: { db: Database }): Promise<boolean> {
  for (const has of Object.values(MONTH_ENTRIES)) if (await has(month, ctx)) return true
  return false
}
