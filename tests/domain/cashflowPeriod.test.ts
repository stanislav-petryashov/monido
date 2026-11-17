import { describe, expect, it } from 'vitest'
import {
  cashflowFinding, cashflowPeriodView, categorySeries, categorySources, categoryUsual, flowMonths, periodFlows, periodMembers, periodMonths, unsplitTotals, usualMonth,
} from '../../src/domain/cashflowPeriod'
import { periodBridge } from '../../src/domain/financialAnalysis'
import type { CategorisedMonth } from '../../src/domain/spending'
import type { CashflowRowBase } from '../../src/domain/types'
import { demoFamilyData } from '../helpers/demoFamily'

// the demo family on 12.11.2026: the figures of docs/superpowers/specs/2026-11-12-cashflow-mockup/data.js
const { snapshot, spending } = await demoFamilyData()
const rows = snapshot.cashflow.rows
const months = flowMonths(rows)
const SEP = ['2026-09']
const Q3 = ['2026-07', '2026-08', '2026-09']
const TRAVEL = snapshot.spending.months.at(-1)!.categories.find(c => c.name === 'Travel')!.categoryId

const row = (month: string, active: number, expense: number, over: Partial<CashflowRowBase> = {}): CashflowRowBase => ({
  month, bank: 'Lumiora Bank', member: 'Robin', currency: 'USD', active, passive: 0, expense, activeBase: active, passiveBase: 0, expenseBase: expense, ...over,
})

describe('periodMonths', () => {
  it('a month, a quarter, a year and all time end at the selected month', () => {
    expect(periodMonths(months, '2026-09', 'month')).toEqual(SEP)
    expect(periodMonths(months, '2026-09', 'quarter')).toEqual(Q3)
    expect(periodMonths(months, '2026-09', 'year')).toHaveLength(12)
    expect(periodMonths(months, '2026-09', 'all')).toEqual(months)
    expect(periodMonths(months, '2026-07', 'month')).toEqual(['2026-07'])
  })
})

describe('periodFlows and usualMonth', () => {
  it('September 2026 against the median of March–August', () => {
    expect(periodFlows(rows, SEP)).toMatchObject({ income: 14092.5, expense: 10508.93, net: 3583.57 })
    expect(periodFlows(rows, SEP)!.rate).toBeCloseTo(25.43, 2)
    const usual = usualMonth(rows, '2026-09')!
    expect(usual.months).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'])
    expect(usual).toMatchObject({ income: 13966.29, expense: 11327.93, net: 2701.17 })
    // June's repair is inside the six months: the median expense is higher than without it
    expect(usual.rate).toBeCloseTo(19.3, 1)
  })

  it('the quarter July–September: its sums, the average month and the usual over January–June', () => {
    const q = periodFlows(rows, Q3)!
    expect(q).toMatchObject({ months: 3, income: 41991.25, expense: 35568.96, net: 6422.29 })
    expect(q.rate).toBeCloseTo(15.3, 1)
    expect(q.perMonth.income).toBeCloseTo(13997.08, 2)
    expect(usualMonth(rows, '2026-07')!.months).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'])
  })

  it('the period sums to its months', () => {
    const year = periodMonths(months, '2026-09', 'year')
    const sum = year.reduce((n, m) => n + periodFlows(rows, [m])!.net, 0)
    expect(periodFlows(rows, year)!.net).toBeCloseTo(sum, 2)
  })

  it('fewer months at the start of history; none for all time', () => {
    expect(usualMonth(rows, months[2])!.months).toEqual(months.slice(0, 2))
    expect(usualMonth(rows, months[0])).toBeNull()
    const two = [row('2030-01', 1000, 900), row('2030-02', 1000, 500)]
    expect(usualMonth(two, '2030-03')).toMatchObject({ income: 1000, expense: 700, net: 300 })
  })

  it('a month with a rateless row has no totals and is not part of usual', () => {
    const r = [row('2030-01', 1000, 900), row('2030-02', 1000, 500, { expenseBase: null }), row('2030-03', 1000, 800)]
    expect(periodFlows(r, ['2030-02'])).toBeNull()
    expect(usualMonth(r, '2030-03')!.months).toEqual(['2030-01'])
  })
})

describe('categoryUsual', () => {
  const travel = (m: string[]) => categoryUsual(snapshot.spending.months, m).rows.find(r => r.id === TRAVEL)!

  it('Travel in the quarter: 4 600, 1 533,33 a month, usual 420 (April–June), +1 113,33', () => {
    expect(travel(Q3)).toMatchObject({ value: 4600, perMonth: 1533.33, usual: 420, usualCount: 3, delta: 1113.33 })
  })

  it('Travel in September: 390 against 420, though no month is fully split', () => {
    expect(snapshot.spending.months.every(m => (m.unallocatedBase ?? 0) > 0)).toBe(true)
    expect(travel(SEP)).toMatchObject({ value: 390, usual: 420, delta: -30 })
  })

  it('categories + unallocated = the month expenses, and the income the same', () => {
    const e = categoryUsual(snapshot.spending.months, SEP)
    expect(e.unallocated).toBe(1144.15)
    expect(e.rows.reduce((n, r) => n + r.value!, 0) + e.unallocated!).toBeCloseTo(10508.93, 2)
    const i = categoryUsual(snapshot.income.months, SEP)
    expect(i.unallocated).toBe(280)
    expect(i.rows.reduce((n, r) => n + r.value!, 0) + i.unallocated!).toBeCloseTo(14092.5, 2)
  })

  it('a year has categories in 6 of 12 months and nothing before them to compare', () => {
    const e = categoryUsual(snapshot.spending.months, periodMonths(months, '2026-09', 'year'))
    expect(e.months).toHaveLength(6)
    expect(e.usualMonths).toBe(0)
    expect(e.rows.every(r => r.usual === null && r.delta === null)).toBe(true)
  })

  it('largest first', () => {
    const values = categoryUsual(snapshot.spending.months, SEP).rows.map(r => r.value!)
    expect(values).toEqual([...values].sort((a, b) => b - a))
  })

  const cat = (categoryId: number, amountBase: number | null) => ({ categoryId, name: `C${categoryId}`, kind: 'optional' as const, flow: 'expense' as const, oneOff: false, amountBase })
  const month = (m: string, categories: ReturnType<typeof cat>[], over: Partial<CategorisedMonth> = {}): CategorisedMonth =>
    ({ month: m, categories, allocatedBase: 0, totalBase: 100, unallocatedBase: 10, coveragePct: 90, ...over })

  it('a category usual before the period but without a line in it is 0 with its decrease', () => {
    const source = [month('2030-01', [cat(1, 40), cat(2, 50)]), month('2030-02', [cat(1, 60), cat(2, 50)]), month('2030-03', [cat(1, 70)])]
    const row = categoryUsual(source, ['2030-03']).rows.find(r => r.id === 2)!
    expect(row).toMatchObject({ value: 0, perMonth: 0, usual: 50, delta: -50 })
  })

  it('unknown is not zero: a line or a total without a rate leaves the sum, the remainder or the total unknown', () => {
    const source = [month('2030-01', [cat(1, 40)]), month('2030-02', [cat(1, null), cat(2, 30)], { totalBase: null, unallocatedBase: null })]
    const p = categoryUsual(source, ['2030-02'])
    expect(p.rows.find(r => r.id === 1)).toMatchObject({ value: null, perMonth: null, delta: null, usual: 40 })
    expect(p.total).toBeNull()
    expect(p.unallocated).toBeNull()
    expect(categorySeries(source, 1).months).toEqual([{ month: '2030-01', value: 40 }, { month: '2030-02', value: null }])
  })
})

describe('a category opened', () => {
  it('Travel since April 2026, the largest month July with 3 820', () => {
    const s = categorySeries(snapshot.spending.months, TRAVEL)
    expect(s.months.map(m => m.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'])
    expect(s.top).toEqual({ month: '2026-07', value: 3820 })
  })

  it('Travel in September comes from Bluefinch High-Yield Savings, 390', () => {
    expect(categorySources(spending, TRAVEL, '2026-09')).toEqual([{ bank: 'Bluefinch High-Yield Savings', member: 'Annika', currency: 'USD', amount: 390, other: false }])
  })

  it('the other sources (a card, cash) count too: the sources add up to the category', () => {
    const loans = snapshot.spending.months.at(-1)!.categories.find(c => c.kind === 'loan_payment')!
    const sources = categorySources(spending, loans.categoryId, '2026-09')
    expect(sources.every(s => s.other)).toBe(true)
    expect(sources.reduce((n, s) => n + s.amount, 0)).toBeCloseTo(loans.amountBase!, 2)
  })
})

describe('periodMembers', () => {
  it('the members add up to the totals; loan payments go to their owner', () => {
    const m = periodMembers(rows, SEP)
    expect(m.reduce((n, x) => n + x.income!, 0)).toBeCloseTo(14092.5, 2)
    expect(m.reduce((n, x) => n + x.expense!, 0)).toBeCloseTo(10508.93, 2)
    expect(m.find(x => x.member === 'Ryan')).toMatchObject({ income: 7240, expense: 6099.75 })
  })
})

describe('a one-time category is not usual', () => {
  it('June’s repair has no usual in September and no zero row there; in June itself it is the period’s own line', () => {
    const repair = (rows: ReturnType<typeof categoryUsual>['rows']) => rows.find(r => r.name === 'Home repair')
    expect(repair(categoryUsual(snapshot.spending.months, SEP).rows)).toBeUndefined()
    expect(repair(categoryUsual(snapshot.spending.months, ['2026-06']).rows)).toMatchObject({ value: 7200, usual: null, delta: null })
  })
})

describe('periodBridge', () => {
  it('September reconciles: 748 351,41 → +3 583,57 → −461,78 → 751 473,20', () => {
    expect(periodBridge(snapshot, SEP)).toMatchObject({ from: '2026-08', to: '2026-09', start: 748351.41, saving: 3583.57, other: -461.78, end: 751473.2 })
  })

  it('the quarter runs from 30.06.2026; its parts add up to the change', () => {
    const b = periodBridge(snapshot, Q3)!
    expect(b).toMatchObject({ from: '2026-06', start: 739479.22, end: 751473.2, saving: 6422.29 })
    expect(b.start + b.saving + b.other).toBeCloseTo(b.end, 2)
  })

  it('null with a month missing', () => {
    expect(periodBridge(snapshot, ['2026-07', '2026-09'])).toBeNull()
    const analysisMonths = snapshot.analysisMonths!.map(m => (m.month === '2026-08' ? { ...m, capital: false } : m))
    expect(periodBridge({ ...snapshot, analysisMonths }, Q3)).toBeNull()
  })
})

describe('cashflowFinding', () => {
  const sep = periodFlows(rows, SEP)!
  it('September: saved 3 584 — 25,4%, usual 19,3%; expenses 819 below the usual month', () => {
    const [saved, expenses] = cashflowFinding(sep, usualMonth(rows, '2026-09'), null)
    expect(saved.key).toBe('cashflowPage.finding.savedUsual')
    expect(saved.params.net).toBe(3583.57)
    expect(expenses.key).toBe('cashflowPage.finding.expenseBelow')
    expect(expenses.params.amount).toBeCloseTo(819, 2)
  })

  it('the quarter: expenses above the usual month per month, most of all travel +1 113', () => {
    const q = periodFlows(rows, Q3)!
    const grew = categoryUsual(snapshot.spending.months, Q3).rows.reduce((a, b) => ((b.delta ?? 0) > (a.delta ?? 0) ? b : a))
    const [, expenses] = cashflowFinding(q, usualMonth(rows, '2026-07'), grew)
    expect(expenses.key).toBe('cashflowPage.finding.expenseAbovePerMonthTop')
    expect(expenses.params).toMatchObject({ category: 'Travel', delta: 1113.33 })
  })

  it('overspent July; all time has only the first sentence', () => {
    expect(cashflowFinding(periodFlows(rows, ['2026-07'])!, usualMonth(rows, '2026-07'), null)[0]).toMatchObject({ key: 'cashflowPage.finding.overspentUsual', params: { net: 527.87 } })
    expect(cashflowFinding(periodFlows(rows, months)!, null, null).map(p => p.key)).toEqual(['cashflowPage.finding.saved'])
  })
})

describe('cashflowPeriodView and unsplitTotals', () => {
  it('defaults to the last closed month; a month without flows falls back to it', () => {
    expect(cashflowPeriodView(snapshot, 'month', null)).toMatchObject({ last: '2026-09', end: '2026-09', months: SEP })
    expect(cashflowPeriodView(snapshot, 'month', '2026-10')!.end).toBe('2026-09')
    expect(cashflowPeriodView(snapshot, 'quarter', '2026-07')!.months).toEqual(['2026-05', '2026-06', '2026-07'])
  })

  it('the chart window: 13 months for a month or a quarter, 24 for a year, all for all time', () => {
    expect(cashflowPeriodView(snapshot, 'month', null)!.chart.map(m => m.month)).toHaveLength(13)
    expect(cashflowPeriodView(snapshot, 'quarter', null)!.chart).toHaveLength(13)
    expect(cashflowPeriodView(snapshot, 'year', null)!.chart).toHaveLength(24)
    expect(cashflowPeriodView(snapshot, 'all', null)!.chart).toHaveLength(months.length)
  })

  it('September leaves 1 144,15 of expenses unsplit; nothing once every line is split', () => {
    expect(unsplitTotals(snapshot)).toEqual({ month: '2026-09', expense: 1144.15, income: 280 })
    const split = (m: (typeof snapshot.spending.months)[number]) => ({ ...m, unallocatedBase: 0 })
    const done = { ...snapshot, spending: { ...snapshot.spending, months: snapshot.spending.months.map(split) }, income: { months: snapshot.income.months.map(split) } }
    expect(unsplitTotals(done)).toBeNull()
    expect(unsplitTotals({ ...snapshot, spending: { ...snapshot.spending, months: snapshot.spending.months.map(split) } })).toEqual({ month: '2026-09', expense: 0, income: 280 })
    expect(unsplitTotals({ ...snapshot, trackFlows: false })).toBeNull()
    // a remainder without a rate is unknown, not split
    const unknown = (m: (typeof snapshot.spending.months)[number]) => (m.month === '2026-09' ? { ...m, unallocatedBase: null } : split(m))
    expect(unsplitTotals({ ...done, spending: { ...snapshot.spending, months: snapshot.spending.months.map(unknown) } })).toEqual({ month: '2026-09', expense: null, income: 0 })
    // a month without a single line: all of it is without a category
    expect(unsplitTotals({ ...snapshot, spending: { ...snapshot.spending, months: [] } })!.expense).toBe(10508.93)
  })
})
