import type { SpendingRecords } from '../../src/domain/api'
import type { FinanceRows, FinanceSnapshot } from '../../src/domain/types'
import { buildFamily } from '../../src/demo/family'
import { buildSnapshot } from '../../src/domain/snapshot'
import { getSpending } from '../../src/modules/cashflow/spending'
import { loadAll } from '../../src/server/data'
import { writeFamily } from '../../src/server/demo/writeFamily'
import { createTestDb } from './db'

/** The day the cash-flow mock-up's figures were read from the dev database: September 2026 is the last closed month */
export const DEMO_TODAY = new Date('2026-11-12T12:00:00Z')

let cached: Promise<{ snapshot: FinanceSnapshot; spending: SpendingRecords; rows: FinanceRows; build: (rows: FinanceRows) => FinanceSnapshot }> | null = null

/**
 * The en-US demo family's snapshot and /api/spending as the server builds them on 12.11.2026 (rates from the family's
 * own table): the figures of docs/superpowers/specs/2026-11-12-cashflow-mockup/data.js. Built once per test file.
 * `rows` and `build` rebuild the snapshot from changed rows (a currency without a rate) with the same rates and day.
 */
export function demoFamilyData() {
  cached ??= (async () => {
    const family = buildFamily({ today: '2026-11-12' })
    const db = createTestDb()
    writeFamily(db.sqlite, family)
    const byDate = new Map<string, Record<string, number>>()
    for (const r of family.fxRates) byDate.set(r.date, { ...byDate.get(r.date), [r.currency]: r.per_usd })
    const build = (rows: FinanceRows) => buildSnapshot({ rows, rateAt: date => byDate.get(date) ?? {}, baseCurrency: 'USD', familyCurrency: 'USD', today: DEMO_TODAY })
    const rows = await loadAll(db)
    const snapshot = build(rows)
    const spending = await getSpending(db, DEMO_TODAY)
    db.close()
    return { snapshot, spending, rows, build }
  })()
  return cached
}
