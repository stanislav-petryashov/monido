import { buildFamily } from '../../src/demo/family'
import { isMonthChange } from '../../src/domain/capitalChange'
import { buildSnapshot } from '../../src/domain/snapshot'
import type { FinanceSnapshot } from '../../src/domain/types'
import { LANGUAGES } from '../../src/i18n/languages'
import { loadAll } from '../../src/server/data'
import { writeFamily } from '../../src/server/demo/writeFamily'
import { readFamilyCurrency } from '../../src/server/familyCurrency'
import { DEMO_TODAY } from '../helpers/demoFamily'
import { createTestDb } from '../helpers/db'

// Each demo family's snapshot in its own currency with its own rates, as the demo server builds it
async function demoSnapshot(family: (typeof LANGUAGES)[number]): Promise<FinanceSnapshot> {
  const demo = buildFamily({ today: '2026-11-12', family })
  const db = createTestDb()
  writeFamily(db.sqlite, demo)
  const byDate = new Map<string, Record<string, number>>()
  for (const r of demo.fxRates) byDate.set(r.date, { ...byDate.get(r.date), [r.currency]: r.per_usd })
  const rows = await loadAll(db)
  const currency = await readFamilyCurrency(db, rows.currencies)
  db.close()
  return buildSnapshot({ rows, rateAt: date => byDate.get(date) ?? {}, baseCurrency: currency, familyCurrency: currency, today: DEMO_TODAY })
}

// The rules are rare by design: every demo family earns some milestones, never a burst (docs/finance-rules.md)
describe.each(LANGUAGES)('the %s demo family milestones', family => {
  it('at least two over the history, at most three a calendar year, one headline a month, and a down month', async () => {
    const s = await demoSnapshot(family)
    const all = s.milestones ?? []
    const byYear = Map.groupBy(all, m => m.month.slice(0, 4))
    const headlines = Map.groupBy(all.filter(m => m.headline), m => m.month)
    expect(all.length, JSON.stringify(all)).toBeGreaterThanOrEqual(2)
    expect(Math.max(...[...byYear.values()].map(v => v.length)), JSON.stringify(all)).toBeLessThanOrEqual(3)
    expect([...headlines.values()].every(v => v.length === 1)).toBe(true)
    expect((s.capitalChange ?? []).some(c => isMonthChange(c) && c.form === 'tracked' && c.end < c.start)).toBe(true)
  })
})
