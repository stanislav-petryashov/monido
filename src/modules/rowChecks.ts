// The modules' own checks of a rows-API write to their tables: what `ModuleMeta.limits` cannot say. Server only. Kept
// apart from SERVER_MODULES (./server.ts): rows.ts calls these, and the server modules import rows.ts.
import type { Database } from '../server/db'
import { tableOwner } from './catalog'
import { checkCashflowRow } from './cashflow/rowCheck'
import { checkLoanDelete, checkLoanRow } from './loans/rowCheck'
import { checkPropertyRow, checkValuationDelete } from './real-estate/rowCheck'
import type { ModuleKey } from './types'

/** A write a check sees: `data` — the values sent; `row` — the row as it will be (on an update the stored row with `data` over it) */
export interface RowWrite { data: Readonly<Record<string, unknown>>; row: Readonly<Record<string, unknown>> }

/**
 * Throws an InputError to refuse the write. `rowid`: the row updated, null on an insert. `revert`: the write puts back a
 * journaled row ("Change history" → Revert), checked like a rows-API write.
 */
export type RowCheck = (table: string, write: RowWrite, ctx: RowCheckContext) => Promise<void>
export interface RowCheckContext { db: Database; rowid: number | null; revert?: boolean }

const ROW_CHECKS: Partial<Record<ModuleKey, RowCheck>> = { cashflow: checkCashflowRow, loans: checkLoanRow, real_estate: checkPropertyRow }

/**
 * Runs the check of the module that owns `table`, if it has one. rows.ts calls it on an insert and an update, after the
 * core's own checks (the columns, `limits`) and before the write, and on a revert that writes a row back.
 */
export async function checkModuleRow(table: string, write: RowWrite, ctx: RowCheckContext): Promise<void> {
  const owner = tableOwner(table)
  if (owner) await ROW_CHECKS[owner.key]?.(table, write, ctx)
}

/** A generic delete a module refuses: `row` — the row as stored. */
export type DeleteCheck = (table: string, row: Readonly<Record<string, unknown>>, ctx: { db: Database; rowid: number }) => Promise<void>

const DELETE_CHECKS: Partial<Record<ModuleKey, DeleteCheck>> = { loans: checkLoanDelete, real_estate: checkValuationDelete }

/** Runs the delete check of the module that owns `table`; rows.ts calls it on the rows API's delete and on a revert that deletes a row (not on compound writes). */
export async function checkModuleDelete(table: string, row: Readonly<Record<string, unknown>>, ctx: { db: Database; rowid: number }): Promise<void> {
  const owner = tableOwner(table)
  if (owner) await DELETE_CHECKS[owner.key]?.(table, row, ctx)
}
