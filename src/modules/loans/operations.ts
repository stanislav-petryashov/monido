// Compound loan writes use authoritative dependencies and one guarded transaction, including journals.
import { MAX_TERM_MONTHS } from '../../domain/loans'
import type { Database, PreparedStatement } from '../../server/db'
import { InputError, plainObject, requireRight, type Actor } from '../../server/http'
import { buildRenameLoan } from '../../server/monthClose'
import { commitMutation } from '../../server/mutations'
import { buildDeleteRow, buildUpdateRow, logStatement, tableColumns } from '../../server/rows'
import { byOwnRoute } from '../ownRoute'

async function storedLoan(db: Database, rowid: number) {
  const row = await db.prepare('SELECT * FROM loans WHERE rowid = ?').bind(rowid).first<{ name: string; term_months: number }>()
  if (!row) throw new InputError('row_not_found', 404)
  return row
}

async function earlyPaymentIds(db: Database, name: string): Promise<number[]> {
  const { results } = await db.prepare('SELECT id FROM loan_early_payments WHERE loan_name = ? ORDER BY id').bind(name).all<{ id: number }>()
  return results.map(row => row.id)
}

/**
 * The journaled rewrites of every loan secured by property `from`: to its new name, or null when it is deleted. Written
 * directly (not through buildUpdateRow): the new name exists only once the same batch renames the property.
 */
export async function planCollateral({ db, actor, ts }: { db: Database; actor: Actor; ts: string }, from: string, to: string | null): Promise<PreparedStatement[]> {
  const [{ results }, columns] = await Promise.all([
    db.prepare('SELECT rowid AS _rowid, * FROM loans WHERE secured_by = ? ORDER BY rowid').bind(from).all<Record<string, unknown>>(),
    tableColumns(db, 'loans'),
  ])
  return results.flatMap(({ _rowid, ...before }) => [
    db.prepare('UPDATE loans SET secured_by = ? WHERE rowid = ?').bind(to, _rowid),
    logStatement(db, actor, { table: 'loans', rowid: Number(_rowid), op: 'update', before, afterColumns: columns, ts }),
  ])
}

export async function updateLoan(db: Database, actor: Actor, rowid: number, body: unknown): Promise<{ saved: true }> {
  requireRight(actor, 'edit')
  const { expectedName, ...request } = plainObject(body)
  if (typeof expectedName !== 'string' || !expectedName.trim()) throw new InputError('invalid_loan', 400, { field: 'expectedName' })
  // the rename carries its early payments, payments and drafts along: the row check lets it through (byOwnRoute)
  return byOwnRoute(() => commitMutation(db, async () => {
    const loan = await storedLoan(db, rowid)
    if (loan.name !== expectedName) throw new InputError('row_changed', 409)
    const data = { ...request }
    if ('name' in data && typeof data.name !== 'string') throw new InputError('invalid_loan', 400, { field: 'name' })
    // The creation limit must not block unrelated edits of a legacy loan, even when a client resends its term.
    const unchangedLegacyTerm = loan.term_months > MAX_TERM_MONTHS && (typeof data.term_months === 'string' || typeof data.term_months === 'number') && Number(data.term_months) === loan.term_months
    if (unchangedLegacyTerm) delete data.term_months
    if (unchangedLegacyTerm && !Object.keys(data).length) return { statements: [], result: { saved: true } }
    const statements: PreparedStatement[] = (await buildUpdateRow(db, 'loans', rowid, data, actor)).statements
    if (typeof data.name === 'string' && data.name !== loan.name) {
      for (const id of await earlyPaymentIds(db, loan.name)) statements.push(...(await buildUpdateRow(db, 'loan_early_payments', id, { loan_name: data.name }, actor)).statements)
      statements.push(...await buildRenameLoan(db, actor, loan.name, data.name))
    }
    return { statements, result: { saved: true } }
  }))
}

export async function deleteLoan(db: Database, actor: Actor, rowid: number): Promise<{ deleted: true }> {
  requireRight(actor, 'edit')
  return commitMutation(db, async () => {
    const loan = await storedLoan(db, rowid)
    const statements = (await buildDeleteRow(db, 'loans', rowid, actor)).statements
    for (const id of await earlyPaymentIds(db, loan.name)) statements.push(...(await buildDeleteRow(db, 'loan_early_payments', id, actor)).statements)
    // Closed-month payments and wizard input remain historical records after deletion.
    return { statements, result: { deleted: true } }
  })
}
