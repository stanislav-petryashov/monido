// The family currency's leaf: reads app_settings directly so rows.ts and snapshot.ts can use it without an import cycle.
import type { Database } from './db'
import { InputError } from './http'

/** The snapshot's currency: the requested one if it is a project currency; else USD if listed; else the first one. */
export function pickCurrency(requested: string | undefined, currencies: string[]): string {
  if (requested !== undefined && currencies.includes(requested)) return requested
  if (currencies.includes('USD')) return 'USD'
  return currencies[0] ?? 'USD'
}

/** The project's currency codes, sorted. */
export async function projectCurrencies(db: Database): Promise<string[]> {
  const { results } = await db.prepare('SELECT code FROM currencies ORDER BY code').all()
  return results.map(r => String(r.code))
}

/** The family currency: the stored one picked among the project's currencies (`currencies`, when the caller has them already; else read). */
export async function readFamilyCurrency(db: Database, currencies?: string[]): Promise<string> {
  const stored = await db.prepare("SELECT value FROM app_settings WHERE key = 'currency'").first<{ value: string }>()
  return pickCurrency(stored?.value, currencies ?? await projectCurrencies(db))
}

/** Refuses (409) removing or renaming away the `currencies` row whose code is the family currency (as `readFamilySettings` picks it: by code). */
export async function assertNotFamilyCurrency(db: Database, code: unknown): Promise<void> {
  if (code === await readFamilyCurrency(db)) throw new InputError('family_currency_in_use', 409)
}
