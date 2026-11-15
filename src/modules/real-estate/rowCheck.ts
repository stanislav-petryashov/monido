// The Real estate module's checks of rows-API writes (registered in ../rowChecks.ts). Server only.
import type { Database } from '../../server/db'
import { InputError } from '../../server/http'
import { isOwnRoute } from '../ownRoute'
import type { DeleteCheck, RowCheck } from '../rowChecks'

/** The oldest valuation year accepted; the newest is the module's limit (meta.ts) */
const MIN_VALUATION_YEAR = 1900

/** The columns every valuation of a property repeats: its purchase and its owner */
const DETAILS = ['purchase_date', 'purchase_price', 'purchase_currency', 'member'] as const

/** The property's newest valuation row (the one the screen reads its details from); null — no such property. */
export async function storedProperty(db: Database, name: unknown): Promise<Record<string, unknown> | null> {
  return db.prepare('SELECT * FROM real_estate WHERE name = ? ORDER BY rowid DESC LIMIT 1').bind(name).first()
}

/** Whether `values` hold the property's stored purchase and owner (no owner: NULL or ''; a price by its number). */
export const sameDetails = (stored: Record<string, unknown>, values: Readonly<Record<string, unknown>>): boolean =>
  DETAILS.every(c => (c === 'purchase_price' ? Number(stored[c]) === Number(values[c]) : String(stored[c] ?? '') === String(values[c] ?? '')))

/**
 * A valuation year is at least 1900 (400 invalid_value). A row added under an existing property's name repeats its
 * purchase and owner, else 409 property_mismatch: a second property of that name, or a stale tab putting back details
 * changed meanwhile. A property is renamed only by POST /api/real-estate/update, which moves every valuation and the
 * loans it secures: the rows API's rename is 409 property_by_route.
 */
export const checkPropertyRow: RowCheck = async (table, { data, row }, { db, rowid }) => {
  if (table !== 'real_estate') return
  if ('valuation_year' in data && data.valuation_year !== null && Number(data.valuation_year) < MIN_VALUATION_YEAR) {
    throw new InputError('invalid_value', 400, { column: 'valuation_year' })
  }
  if (rowid === null) {
    const stored = await storedProperty(db, row.name)
    if (stored && !sameDetails(stored, row)) throw new InputError('property_mismatch', 409)
    return
  }
  if ('name' in data && !isOwnRoute()) {
    const stored = await db.prepare('SELECT name FROM real_estate WHERE rowid = ?').bind(rowid).first<{ name: string }>()
    if (stored && stored.name !== data.name) throw new InputError('property_by_route', 409)
  }
}

/**
 * A property's last valuation is the property: the generic delete refuses it (409 last_valuation), so a loan secured by
 * it is never left pointing at nothing; POST /api/real-estate/delete deletes the property with its links.
 */
export const checkValuationDelete: DeleteCheck = async (table, row, { db, rowid }) => {
  if (table !== 'real_estate') return
  const other = await db.prepare('SELECT 1 FROM real_estate WHERE name = ? AND rowid <> ? LIMIT 1').bind(row.name, rowid).first()
  if (!other) throw new InputError('last_valuation', 409)
}
