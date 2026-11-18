// Property metadata and deletion span every stored valuation, including rows absent from the client cache.
import type { Database, PreparedStatement } from '../../server/db'
import { InputError, plainObject, requireRight, type Actor } from '../../server/http'
import { commitMutation } from '../../server/mutations'
import { buildDeleteRow, buildUpdateRow } from '../../server/rows'
import { byOwnRoute } from '../ownRoute'
import { planCollateral } from '../loans/operations'
import { sameDetails, storedProperty } from './rowCheck'

const DETAIL_COLUMNS = ['purchase_date', 'purchase_price', 'purchase_currency', 'member']

function scopedObject(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  const data = plainObject(body)
  for (const column of Object.keys(data)) if (!allowed.includes(column)) throw new InputError('unknown_column', 400, { column })
  return data
}

function requiredText(value: unknown, column: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new InputError('required_field', 400, { column })
  return value
}

async function valuationIds(db: Database, name: string): Promise<number[]> {
  const { results } = await db.prepare('SELECT rowid FROM real_estate WHERE name = ? ORDER BY rowid').bind(name).all<{ rowid: number }>()
  if (!results.length) throw new InputError('row_not_found', 404)
  return results.map(row => row.rowid)
}

export async function updateProperty(db: Database, actor: Actor, body: unknown): Promise<{ saved: true }> {
  requireRight(actor, 'edit')
  const request = scopedObject(body, ['name', 'values', 'expected'])
  const name = requiredText(request.name, 'name')
  const values = scopedObject(request.values, ['name', ...DETAIL_COLUMNS])
  // the details the editor opened with: changed meanwhile (another tab, Claude) — 409 row_changed, not overwritten unseen
  const expected = request.expected === undefined ? null : scopedObject(request.expected, DETAIL_COLUMNS)
  for (const column of ['name', 'purchase_date', 'purchase_currency']) requiredText(values[column], column)
  if (typeof values.purchase_price !== 'number' || !Number.isFinite(values.purchase_price)) throw new InputError('expected_number', 400, { column: 'purchase_price' })
  if (values.member !== null && typeof values.member !== 'string') throw new InputError('invalid_value', 400, { column: 'member' })
  return byOwnRoute(() => commitMutation(db, async () => {
    const statements: PreparedStatement[] = []
    const ts = new Date().toISOString()
    const ids = await valuationIds(db, name)
    const stored = await storedProperty(db, name)
    if (expected && stored && !sameDetails(stored, expected)) throw new InputError('row_changed', 409)
    // a rename onto another property's name would merge the two: one of them would drop out of net worth
    if (values.name !== name && await storedProperty(db, values.name)) throw new InputError('property_exists', 409)
    for (const rowid of ids) statements.push(...(await buildUpdateRow(db, 'real_estate', rowid, values, actor, ts)).statements)
    // the links to the property (a loan's collateral) follow the new name in the same transaction
    if (values.name !== name) statements.push(...await planCollateral({ db, actor, ts }, name, String(values.name)))
    return { statements, result: { saved: true } }
  }))
}

export async function deleteProperty(db: Database, actor: Actor, body: unknown): Promise<{ deleted: true }> {
  requireRight(actor, 'edit')
  const request = scopedObject(body, ['name'])
  const name = requiredText(request.name, 'name')
  return commitMutation(db, async () => {
    const statements: PreparedStatement[] = []
    const ts = new Date().toISOString()
    for (const rowid of await valuationIds(db, name)) statements.push(...(await buildDeleteRow(db, 'real_estate', rowid, actor, ts)).statements)
    // the links to the property (a loan's collateral) are cleared with it
    statements.push(...await planCollateral({ db, actor, ts }, name, null))
    return { statements, result: { deleted: true } }
  })
}
