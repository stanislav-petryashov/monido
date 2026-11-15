import { MONTH_RE } from '../domain/dates'
import { validAssessment, type AvailabilityAssessment } from '../domain/availability'
import type { AccountIdentity } from '../domain/api'
import type { Database, PreparedStatement } from './db'
import { InputError, plainObject, requireRight, type Actor } from './http'
import { withoutRowid } from './data'
import { commitMutation } from './mutations'
import { insertStatement, logStatement, nextRowid, tableColumns } from './rows'

const TABLE = 'availability_assessments'
type Stored = Record<string, unknown> & { rowid: number }
export async function readAvailability(db: Database): Promise<AvailabilityAssessment[]> {
  const { results } = await db.prepare(`SELECT * FROM ${TABLE} ORDER BY month DESC, name, member`).all()
  return results.map(row => ({ month: String(row.month), name: String(row.name), member: String(row.member), currency: String(row.currency), balance: Number(row.balance), available: row.available === 1, reserve: Number(row.reserve), goals: Number(row.goals), commitments: Number(row.commitments) }))
}
function identity(body: unknown) {
  const row = plainObject(body)
  if (typeof row.month !== 'string' || !MONTH_RE.test(row.month) || typeof row.name !== 'string' || !row.name.trim() || typeof row.member !== 'string') throw new InputError('invalid_value', 400, { column: 'month' })
  return { month: row.month, name: row.name, member: row.member }
}
async function find(db: Database, key: ReturnType<typeof identity>) {
  return db.prepare(`SELECT rowid, * FROM ${TABLE} WHERE month = ? AND name = ? AND member = ?`).bind(key.month, key.name, key.member).first<Stored>()
}
export async function saveAvailability(db: Database, actor: Actor, body: unknown): Promise<{ saved: true }> {
  requireRight(actor, 'edit')
  const row = plainObject(body)
  const key = identity(row)
  const data = { ...key, currency: row.currency, balance: row.balance, available: row.available, reserve: row.reserve, goals: row.goals, commitments: row.commitments } as AvailabilityAssessment
  if (typeof data.currency !== 'string' || typeof data.available !== 'boolean' || !validAssessment(data)) throw new InputError('invalid_value', 400, { column: 'reserve' })
  return commitMutation(db, async () => {
    const closed = await db.prepare('SELECT month FROM closed_months WHERE month = ?').bind(key.month).first()
    const { results: assets } = await db.prepare("SELECT * FROM assets WHERE substr(date, 1, 7) = ? AND name = ? AND COALESCE(member, '') = ?").bind(key.month, key.name, key.member).all()
    if (!closed || assets.length !== 1 || assets[0].currency !== data.currency || assets[0].value !== data.balance) throw new InputError('data_conflict', 409)
    const before = await find(db, key)
    const rowid = before?.rowid ?? await nextRowid(db, TABLE)
    const columns = await tableColumns(db, TABLE)
    const values = { ...data, available: Number(data.available) }
    const statement = before
      ? db.prepare(`UPDATE ${TABLE} SET currency = ?, balance = ?, available = ?, reserve = ?, goals = ?, commitments = ? WHERE rowid = ?`).bind(data.currency, data.balance, values.available, data.reserve, data.goals, data.commitments, rowid)
      : insertStatement(db, TABLE, columns, values, rowid)
    return { statements: [statement, logStatement(db, actor, { table: TABLE, rowid, op: before ? 'update' : 'insert', before: before ? withoutRowid(before) : null, afterColumns: columns })], result: { saved: true as const } }
  })
}
export async function removeAvailability(db: Database, actor: Actor, body: unknown): Promise<{ deleted: true }> {
  requireRight(actor, 'edit')
  const key = identity(body)
  return commitMutation(db, async () => {
    const before = await find(db, key)
    if (!before) throw new InputError('row_not_found', 404)
    return { statements: [db.prepare(`DELETE FROM ${TABLE} WHERE rowid = ?`).bind(before.rowid), logStatement(db, actor, { table: TABLE, rowid: before.rowid, op: 'delete', before: withoutRowid(before), afterColumns: null })], result: { deleted: true as const } }
  })
}

/** Renaming preserves confirmations, but currency correction/deletion requires explicitly clearing them first. */
export async function planAvailabilityRename(db: Database, actor: Actor, from: AccountIdentity, to: AccountIdentity): Promise<PreparedStatement[]> {
  const { results } = await db.prepare(`SELECT rowid, * FROM ${TABLE} WHERE name = ? AND member = ?`).bind(from.name, from.member).all<Stored>()
  const columns = await tableColumns(db, TABLE)
  return results.flatMap(before => [db.prepare(`UPDATE ${TABLE} SET name = ?, member = ? WHERE rowid = ?`).bind(to.name, to.member, before.rowid), logStatement(db, actor, { table: TABLE, rowid: before.rowid, op: 'update', before: withoutRowid(before), afterColumns: columns })])
}
export async function assertAvailabilityCleared(db: Database, column: 'name' | 'member' | 'currency', value: unknown, member?: string): Promise<void> {
  const row = await db.prepare(`SELECT 1 FROM ${TABLE} WHERE ${column} = ?${member !== undefined ? ' AND member = ?' : ''} LIMIT 1`).bind(value, ...(member !== undefined ? [member] : [])).first()
  if (row) throw new InputError('availability_reconcile', 409)
}
