import { monthRecap } from '../../src/domain/monthRecap'
import type { FinanceSnapshot, MonthChange, MonthChangeGap } from '../../src/domain/types'

const tracked = (month: string, saved: number, fx: number): MonthChange =>
  ({ month, form: 'tracked', start: 0, end: 0, rows: { saved, debtPaid: 100, fx, investments: 0, property: 0, unexplained: 0 }, items: {}, pairs: [], candidates: [], rates: [] })
// Thirteen closed months, 2025-03 to 2026-03: net worth +1 000 a month, debt −100 a month
function snapshot(o: { partial?: string[]; gap?: string; trackFlows?: boolean; milestones?: FinanceSnapshot['milestones']; crossings?: FinanceSnapshot['markCrossings'] } = {}): FinanceSnapshot {
  const months = Array.from({ length: 13 }, (_, i) => `${2025 + Math.floor((i + 2) / 12)}-${String(((i + 2) % 12) + 1).padStart(2, '0')}`)
  return {
    trackFlows: o.trackFlows ?? true,
    history: months.map((m, i) => ({ date: `${m}-28`, assets: 0, liabilities: 5000 - 100 * i, netWorth: 10_000 + 1000 * i })),
    capitalCoverage: months.map(m => ({ month: m, assetsKnown: true, liquidKnown: true, capitalKnown: !o.partial?.includes(m), missingAccounts: [] })),
    capitalChange: months.map((m, i): MonthChange | MonthChangeGap => (m === o.gap ? { month: m, reason: 'no_rate' } : tracked(m, 800 + i * 10, 100))),
    fundHistory: months.map((m, i) => ({ month: m, months: 2 + i / 10 })),
    milestones: o.milestones ?? [], markCrossings: o.crossings ?? [],
  } as unknown as FinanceSnapshot
}
const row = (r: ReturnType<typeof monthRecap>, key: string) => r.rows.find(x => x.key === key)

describe('monthRecap', () => {
  it('compares the month with the one before and the same month a year ago', () => {
    const r = monthRecap(snapshot(), '2026-03')
    expect(row(r, 'netWorth')).toEqual({ key: 'netWorth', now: 22_000, vsPrev: 1000, vsYear: 12_000 })
    expect(row(r, 'added')).toEqual({ key: 'added', now: 1020, vsPrev: 10, vsYear: 120 })
    expect(row(r, 'markets')).toEqual({ key: 'markets', now: 100, vsPrev: 0, vsYear: 0 })
    expect(row(r, 'fund')).toEqual({ key: 'fund', now: 3.2, vsPrev: 0.1, vsYear: 1.2 })
    expect(row(r, 'debt')).toEqual({ key: 'debt', now: 3800, vsPrev: -100, vsYear: -1200 })
  })

  it('a partial month before gives a dash, never 0', () => {
    const r = monthRecap(snapshot({ partial: ['2026-02'] }), '2026-03')
    expect(row(r, 'netWorth')!.vsPrev).toBeNull()
    expect(row(r, 'debt')!.vsPrev).toBeNull()
  })

  it('without flow tracking there are no flow rows', () => {
    expect(monthRecap(snapshot({ trackFlows: false }), '2026-03').rows.map(x => x.key)).toEqual(['netWorth', 'fund', 'debt'])
  })

  it('a gap month has no added figure', () => {
    expect(row(monthRecap(snapshot({ gap: '2026-03' }), '2026-03'), 'added')).toEqual({ key: 'added', now: null, vsPrev: null, vsYear: null })
  })

  it('notes the first time above a mark before the highest ever', () => {
    expect(monthRecap(snapshot(), '2026-03').note).toEqual({ key: 'highest' })
    const crossed = snapshot({ crossings: [{ month: '2026-03', level: 20_000, currency: 'EUR' }] })
    expect(monthRecap(crossed, '2026-03').note).toEqual({ key: 'firstAbove', amount: 20_000, currency: 'EUR' })
    const earned = snapshot({ milestones: [{ month: '2026-03', kind: 'netWorthMark', level: 20_000, params: { amount: 20_000 }, currency: 'EUR', headline: true, celebrated: true }] })
    expect(monthRecap(earned, '2026-03').note).toEqual({ key: 'firstAbove', amount: 20_000, currency: 'EUR' })
    expect(monthRecap(snapshot(), '2026-01').note).toEqual({ key: 'highest' })
  })
})
