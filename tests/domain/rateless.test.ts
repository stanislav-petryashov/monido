// A currency without a rate (CLAUDE.md domain rule 1): the figures it touches are unknown (null, "—"), not short by
// that amount. Each case changes one row of the demo family to a rateless currency and rebuilds the snapshot.
import { describe, expect, it } from 'vitest'
import { advisorContext } from '../../src/domain/advisor'
import { familyOverview } from '../../src/domain/advisorOverview'
import { evaluate } from '../../src/domain/advisorImpact'
import type { Scenario } from '../../src/domain/advisor'
import { monthTotals } from '../../src/domain/cashflow'
import { cashflowPeriodView } from '../../src/domain/cashflowPeriod'
import { historicalBudget } from '../../src/domain/financialAnalysis'
import { partialCapitalMonths, selectedDeltas } from '../../src/domain/overviewBlocks'
import type { FinanceRows, HealthKey } from '../../src/domain/types'
import { yearCells } from '../../src/domain/yearCells'
import { METRICS } from '../../src/domain/metricCatalog'
import { cashflowView, compareView, goalMetrics, overviewFlow } from '../../src/lib/snapshotSelectors'
import { averageMonths } from '../../src/pages/goals/view'
import { DEMO_TODAY, demoFamilyData } from '../helpers/demoFamily'

const { snapshot: clean, rows, build } = await demoFamilyData()
const RATELESS = 'XYZ'

/** The demo rows with the first cash-flow row of `month` that matches moved to a currency without a rate */
function ratelessFlow(month: string, pick: (r: FinanceRows['cashflow'][number]) => boolean = () => true): FinanceRows {
  const victim = rows.cashflow.find(r => r.date.startsWith(month) && pick(r))!
  return { ...rows, cashflow: rows.cashflow.map(r => (r === victim ? { ...r, currency: RATELESS } : r)) }
}
/** The demo rows with one more account row in `month`, in a currency without a rate */
function extraRatelessFlow(month: string): FinanceRows {
  const first = rows.cashflow.find(r => r.date.startsWith(month))!
  return { ...rows, cashflow: [...rows.cashflow, { ...first, bank: 'Odd', currency: RATELESS, expense: 10, active_income: 0, passive_income: 0 }] }
}

describe('a month with a rateless flow row has unknown totals (#5)', () => {
  const s = build(ratelessFlow('2026-08', r => r.active_income > 0))

  it('the Overview: no year total and no previous month to compare with', () => {
    expect(overviewFlow(clean)).toMatchObject({ netTotal: expect.any(Number), previous: { month: '2026-08' } })
    const flow = overviewFlow(s)
    expect(flow.netTotal).toBeNull()
    expect(flow.previous).toBeNull()
    expect(flow.trend.find(r => r.month === '2026-08')).toEqual({ month: '2026-08', income: null, expense: null, net: null })
    expect(flow.trend.find(r => r.month === '2026-07')!.net).toBe(cashflowView(clean, '1y').monthlyTrend.find(r => r.month === '2026-07')!.net)
  })

  it('the Income and expenses page: the chart has a gap, the period with the month has no totals', () => {
    const v = cashflowPeriodView(s, 'quarter', '2026-09')!
    expect(v.flows).toBeNull()
    expect(v.chart.find(m => m.month === '2026-08')).toMatchObject({ income: null, expense: null, net: null })
    expect(v.chart.find(m => m.month === '2026-07')!.income).toBeGreaterThan(0)
    expect(v.members.filter(m => m.income === null).length).toBe(1)
  })

  it('Goals: the months the saving averages leave the rateless month out, as avg3m does', () => {
    expect(averageMonths(s).map(m => m.month)).toEqual(['2026-07', '2026-09'])
    expect(s.cashflow.avg3m.months).toBe(2)
  })
})

describe('a rateless row in the last closed month blanks only its periods (#6)', () => {
  const s = build(extraRatelessFlow('2026-09'))

  it('the page still opens on the last closed month; the year with it has no totals, August does', () => {
    expect(s.cashflow.closedMonth).toBeNull()
    const year = cashflowPeriodView(s, 'year', null)!
    expect(year.last).toBe('2026-09')
    expect(year.end).toBe('2026-09')
    expect(year.flows).toBeNull()
    expect(cashflowPeriodView(s, 'month', '2026-08')!.flows).toMatchObject({ months: 1, income: expect.any(Number) })
  })

  it('the historical budget reads the same three months and has no figure for them', () => {
    expect(historicalBudget(clean)!.months).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(historicalBudget(s)).toBeNull()
  })
})

describe('the advisor divides only the months it summed (#9)', () => {
  const s = build(ratelessFlow('2026-09', r => r.active_income > 0))

  it('the earners and the income sources add up to the average income, as without the rateless month', () => {
    const ctx = advisorContext(s, DEMO_TODAY)
    expect(ctx.months).toBe(2)
    const earned = ctx.earners.reduce((n, e) => n + e.activePerMonth, 0) + ctx.sharedActivePerMonth
    const passive = s.cashflow.avg3m.passivePerMonth
    expect(earned + passive).toBeCloseTo(ctx.incomePerMonth, 0)
    const o = familyOverview(s, DEMO_TODAY)
    const sources = o.incomeSources.reduce((n, x) => n + (x.perMonthBase ?? 0), 0) + (o.unallocatedIncomeBase ?? 0)
    expect(sources).toBeCloseTo(ctx.incomePerMonth, 0)
  })
})

describe('health with a rateless loan or account (#7, #8)', () => {
  const metric = (s: typeof clean, key: string) => s.health!.metrics[key as HealthKey]!.value

  it('a rateless mortgage: the metrics that read it are unknown; the consumer debt and the cushion are not', () => {
    const s = build({ ...rows, loans: rows.loans.map(l => (l.type === 'mortgage' ? { ...l, currency: RATELESS } : l)) })
    for (const key of ['debt_to_asset', 'avg_debt_rate', 'debt_payment_ratio']) expect(metric(s, key), key).toBeNull()
    expect(metric(s, 'consumer_debt_months')).toBe(metric(clean, 'consumer_debt_months'))
    expect(metric(s, 'emergency_months')).toBe(metric(clean, 'emergency_months'))
  })

  it('a rateless bank account: the cushion is unknown', () => {
    const bank = rows.assets.find(a => a.class === 'bank')!
    const s = build({ ...rows, assets: rows.assets.map(a => (a.name === bank.name && a.member === bank.member ? { ...a, currency: RATELESS } : a)) })
    expect(metric(s, 'emergency_months')).toBeNull()
    expect(s.cashflow.emergencyMonths).toBeNull()
  })

  it('a car loan is consumer debt', () => {
    const s = build({ ...rows, loans: rows.loans.map(l => (l.type === 'consumer' ? { ...l, type: 'car' as never } : l)) })
    expect(metric(clean, 'consumer_debt_months')).toBeGreaterThan(0)
    expect(metric(s, 'consumer_debt_months')).toBe(metric(clean, 'consumer_debt_months'))
  })
})

describe('the Overview with a partial net worth (#10)', () => {
  const s = build({ ...rows, loans: rows.loans.map(l => (l.type === 'mortgage' ? { ...l, currency: RATELESS } : l)) })
  const last = s.asOf.closedMonth!

  it('the month is partial: no month or year change, no year-end figure', () => {
    const partial = partialCapitalMonths(s)
    expect(partialCapitalMonths(clean).size).toBe(0)
    expect(partial.has(last)).toBe(true)
    expect(selectedDeltas(clean.history, last, partialCapitalMonths(clean)).month).not.toBeNull()
    expect(selectedDeltas(s.history, last, partial)).toEqual({ month: null, year: null })
    const cell = yearCells(s.history, [], DEMO_TODAY, partial).find(c => c.year === 2026)!
    expect(cell.endNetWorth).toBeNull()
    expect(cell.change).toBeNull()
    expect(cell.months.find(m => m.month === last)).toMatchObject({ state: 'closed', netWorth: null })
  })
})

describe('the month\'s loan payments (#11)', () => {
  it('a rateless payment makes their sum unknown', () => {
    const month = clean.asOf.closedMonth!
    const loans = (s: typeof clean) => s.cashflow.rows.filter(r => r.loan)
    expect(monthTotals(loans(clean), month)!.expense).toBeGreaterThan(0)
    const payment = rows.loanPayments.find(p => p.date.startsWith(month))!
    const s = build({ ...rows, loanPayments: rows.loanPayments.map(p => (p === payment ? { ...p, currency: RATELESS } : p)) })
    expect(monthTotals(loans(s), month)).toBeNull()
  })
})

/** The demo rows with every loan of `type` in a currency without a rate */
const ratelessLoans = (type: string): FinanceRows => ({ ...rows, loans: rows.loans.map(l => (l.type === type ? { ...l, currency: RATELESS } : l)) })
/** The demo rows with the first bank account in a currency without a rate */
function ratelessBank(): FinanceRows {
  const bank = rows.assets.find(a => a.class === 'bank')!
  return { ...rows, assets: rows.assets.map(a => (a.name === bank.name && a.member === bank.member ? { ...a, currency: RATELESS } : a)) }
}
const CREDIT: Scenario = { kind: 'credit', amount: 30000, currency: 'USD', termMonths: 36, ratePct: 12, downPayment: 0, loanType: 'consumer' }
const codes = (s: typeof clean) => familyOverview(s, DEMO_TODAY).gaps.map(g => g.code)

describe('the advisor grades only what it knows (review 1–3, 6)', () => {
  it('a closed month with a rateless row: no payment share or fund after a credit, not one built on zero expenses', () => {
    const before = evaluate(advisorContext(clean, DEMO_TODAY), CREDIT, {}).impact
    expect(before.after.emergencyMonths).toBeGreaterThan(0)
    const s = build(extraRatelessFlow('2026-09'))
    const ctx = advisorContext(s, DEMO_TODAY)
    expect(ctx.closed).toBeNull()
    const { impact, alternatives } = evaluate(ctx, CREDIT, {})
    expect(impact.after).toMatchObject({ emergencyMonths: null, debtPaymentPct: null })
    expect(impact.now).toMatchObject({ emergencyMonths: null, debtPaymentPct: null })
    expect(impact.risk).toBe('unknown')
    expect(alternatives.map(a => a.kind)).not.toContain('bigger_down_payment')
    expect(impact.gaps).toContainEqual(expect.objectContaining({ code: 'month_no_rate', params: { month: '2026-09' } }))
  })

  it('a rateless bank account: no liquid money, fund or stress test, the same as health', () => {
    const s = build(ratelessBank())
    const o = familyOverview(s, DEMO_TODAY)
    expect(o.now).toMatchObject({ liquid: null, emergencyMonths: null })
    expect(o.health.find(h => h.key === 'emergency_months')?.value).toBeNull()
    expect(codes(s)).toContain('liquid_unknown')
    expect(codes(clean)).not.toContain('liquid_unknown')
    expect(evaluate(advisorContext(s, DEMO_TODAY), CREDIT, {}).impact.stress).toBeNull()
  })

  it('a loan with a payment and no rate: no payment share, the same as health', () => {
    const s = build(ratelessLoans('consumer'))
    expect(familyOverview(clean, DEMO_TODAY).now.debtPaymentPct).not.toBeNull()
    expect(familyOverview(s, DEMO_TODAY).now.debtPaymentPct).toBeNull()
    expect(s.health!.metrics.debt_payment_ratio!.value).toBeNull()
  })

  it('every month of the window rateless: the income sources and the unallocated income are unknown', () => {
    let changed = rows
    for (const m of ['2026-07', '2026-08', '2026-09']) {
      const first = changed.cashflow.find(r => r.date.startsWith(m))!
      changed = { ...changed, cashflow: [...changed.cashflow, { ...first, bank: `Odd ${m}`, currency: RATELESS, expense: 10, active_income: 0, passive_income: 0 }] }
    }
    const o = familyOverview(build(changed), DEMO_TODAY)
    expect(o.monthsOfData).toBe(0)
    expect(o).toMatchObject({ incomeSources: [], unallocatedIncomeBase: null })
  })
})

describe('real growth over the year needs both net worths known (review 4)', () => {
  const withInflation = (r: FinanceRows): FinanceRows => ({ ...r, parameters: { ...r.parameters, inflation_rate: 4 }, inflationCurrency: 'USD' })

  it('a partial latest month: no real growth', () => {
    expect(build(withInflation(rows)).health!.metrics.real_growth_yoy!.value).not.toBeNull()
    const s = build(withInflation(ratelessLoans('mortgage')))
    expect(s.inflation).toMatchObject({ netWorthNow: null })
    expect(s.health!.metrics.real_growth_yoy!.value).toBeNull()
  })
})

describe('a partial month is unknown wherever net worth is read (review 9)', () => {
  const s = build(ratelessLoans('mortgage'))

  it('no month or year change, no net worth in the metric drawer, no capital growth', () => {
    expect(clean.capital).toMatchObject({ monthDelta: expect.any(Number), yoyDelta: expect.any(Number) })
    expect(s.capital).toMatchObject({ monthDelta: null, yoyDelta: null })
    expect(METRICS.net_worth.value(s).value).toBeNull()
    expect(METRICS.net_worth.value(clean).value).toBe(clean.capital!.netWorth)
    expect(METRICS.capital_growth.value(s).value).toBeNull()
    expect(METRICS.capital_growth.value(clean).value).not.toBeNull()
    expect(goalMetrics(s).actualCagrPct).toBeNull()
    expect(s.goals.fire?.actualCagr ?? null).toBeNull()
  })
})

describe('the cushion against typical spending (review 5)', () => {
  it('reads "—" when a bank account has no rate', () => {
    const typical = (x: typeof clean) => compareView(x, 'emergency_months', String).rows[0].value
    expect(typical(clean)).not.toBe('—')
    expect(typical(build(ratelessBank()))).toBe('—')
  })
})
