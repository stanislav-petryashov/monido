import type { Database } from './db'
import { loadAll } from './data'
import { pickCurrency, readFamilyCurrency } from './familyCurrency'
import { ensureRates } from './fx'
import { isoDate } from '../domain/dates'
import { buildSnapshot, requiredRateCurrencies, requiredRateDates } from '../domain/snapshot'
import type { FinanceSnapshot } from '../domain/types'

interface SnapshotOptions {
  now?: Date
  fetchImpl?: typeof fetch
  /** The requested currency of the snapshot (default: the family currency); one not in the project is replaced by `pickCurrency` */
  currency?: string
  /** false: no rate downloads (the demo), only the rates in the database; default true */
  download?: boolean
}

export async function getSnapshot(db: Database, { now = new Date(), fetchImpl, currency, download = true }: SnapshotOptions = {}): Promise<FinanceSnapshot> {
  const rows = await loadAll(db)
  const fx = await ensureRates(db, requiredRateDates(rows, now), requiredRateCurrencies(rows), isoDate(now), download ? fetchImpl : null)
  const familyCurrency = await readFamilyCurrency(db, rows.currencies)
  const baseCurrency = currency === undefined ? familyCurrency : pickCurrency(currency, rows.currencies)
  const snapshot = buildSnapshot({ rows, rateAt: fx.lookup, baseCurrency, familyCurrency, today: now })
  // fx.warnings is filled by lookups made while building the snapshot.
  return { ...snapshot, warnings: [...fx.warnings, ...snapshot.warnings] }
}
