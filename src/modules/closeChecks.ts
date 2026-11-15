// The modules' own checks of a month close: what the wizard's problems (domain/monthClose.ts) cannot see because it lives
// in a module's tables. Server only. Kept apart from SERVER_MODULES (./server.ts): server/monthClose.ts calls these,
// and the server modules import it.
import type { DraftRow } from '../domain/monthClose'
import type { Database } from '../server/db'
import { checkCashflowClose } from './cashflow/closeCheck'
import type { ModuleKey } from './types'

/** Throws an InputError to refuse the close. `rows`: the month's draft rows as they are going to be written. */
export type CloseCheck = (month: string, rows: readonly DraftRow[], ctx: { db: Database }) => Promise<void>

const CLOSE_CHECKS: Partial<Record<ModuleKey, CloseCheck>> = { cashflow: checkCashflowClose }

/** Runs the check of every module that has one. closeMonth calls it after the problems and before the batch. */
export async function checkModuleClose(month: string, rows: readonly DraftRow[], ctx: { db: Database }): Promise<void> {
  for (const check of Object.values(CLOSE_CHECKS)) await check(month, rows, ctx)
}
