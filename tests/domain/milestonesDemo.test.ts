import { buildFamily, familyCurrency } from '../../src/demo/family'
import { isMonthChange } from '../../src/domain/capitalChange'
import { buildSnapshot } from '../../src/domain/snapshot'
import type { FinanceSnapshot } from '../../src/domain/types'
import { LANGUAGES } from '../../src/i18n/languages'
import { loadAll } from '../../src/server/data'
import { writeFamily } from '../../src/server/demo/writeFamily'
import { DEMO_TODAY, demoFamilyData } from '../helpers/demoFamily'
import { createTestDb } from '../helpers/db'

// Each demo family's snapshot in its own currency with its own rates, as the demo server builds it
async function demoSnapshot(family: (typeof LANGUAGES)[number]): Promise<FinanceSnapshot> {
  const demo = buildFamily({ today: '2026-11-12', family })
  const db = createTestDb()
  writeFamily(db.sqlite, demo)
  const byDate = new Map<string, Record<string, number>>()
  for (const r of demo.fxRates) byDate.set(r.date, { ...byDate.get(r.date), [r.currency]: r.per_usd })
  const rows = await loadAll(db)
  db.close()
  // the demo server stores the family's own currency (template.ts); writeFamily alone leaves the default, USD
  const currency = familyCurrency(demo)
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

  it('pays a loan off once, in a month the wizard closed, a year before the last one, and the loan leaves the debts', async () => {
    const s = await demoSnapshot(family)
    const paidOff = (s.milestones ?? []).filter(m => m.kind === 'loanPaidOff')
    expect(paidOff).toMatchObject([{ month: '2025-09', headline: true, celebrated: true }])
    const name = paidOff[0].params.name
    // its principal is repaid month by month up to the payoff, then it is gone from the changes and from the debts
    const repaying = (s.capitalChange ?? []).filter(c => isMonthChange(c) && c.items.debtPaid?.some(i => i.name === name)).map(c => c.month)
    expect(repaying.at(-1)).toBe('2025-09')
    expect(repaying).toHaveLength(23)
    expect(s.capital?.loans.map(l => l.name)).not.toContain(name)
    expect(s.capital?.loans).toHaveLength(2)
  })
})

describe('milestones on the snapshot', () => {
  it('the fund history ends at the health list figure', async () => {
    const { snapshot } = await demoFamilyData()
    expect(snapshot.fundHistory?.at(-1)?.months).toBe(snapshot.cashflow.emergencyMonths)
  })

  it('without flow tracking only a loan payoff can fire', async () => {
    const { rows, build } = await demoFamilyData()
    const s = build({ ...rows, trackFlows: false })
    expect((s.milestones ?? []).filter(m => m.kind !== 'loanPaidOff')).toEqual([])
  })

  it('with flows in the last two months only, nothing that needs a year of them fires', async () => {
    const { rows, build } = await demoFamilyData()
    const recent = (d: string) => d >= '2026-08-01'
    const s = build({
      ...rows, cashflow: rows.cashflow.filter(r => recent(r.date)), loanPayments: rows.loanPayments.filter(r => recent(r.date)),
      flowLines: rows.flowLines.filter(r => recent(r.date)), categorySpending: rows.categorySpending.filter(r => recent(r.date)),
    })
    expect((s.milestones ?? []).filter(m => m.kind === 'emergencyFund' || m.kind === 'addedThisYear')).toEqual([])
  })
})
