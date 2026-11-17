import { describe, expect, it } from 'vitest'
import { DEMO_FAMILIES } from '../../src/demo/family'
import { advisorContext } from '../../src/domain/advisor'
import { currentNumbers } from '../../src/domain/advisorImpact'
import { familyOverview } from '../../src/domain/advisorOverview'
import { HEALTH_KEYS } from '../../src/domain/health'
import type { CategorisedMonth, CategoryTotal } from '../../src/domain/spending'
import type { CashflowRowBase, FinanceSnapshot, GoalAllocation, GoalItem } from '../../src/domain/types'
import { emptySnapshot, makeSnapshot } from '../helpers/snapshot'

const TODAY = new Date('2031-07-03T09:00:00Z')

const item = (over: Partial<GoalItem>): GoalItem => ({
  id: 'trip', name: 'Trip', target: 8000, current: 2000, target_date: '2034-01-31', emoji: null, currency: 'USD', targetBase: 8000, currentBase: 2000, ...over,
})
const allocation = (goal: GoalItem, over: Partial<GoalAllocation>): GoalAllocation => ({
  goal, progressPct: 25, monthsToDeadline: 30, requiredMonthlyBase: 200, allocBase: 200, shares: [], status: 'on_track', projectedDate: '2034-01', ...over,
})

/** The 2031-06 snapshot: income 6220 and expenses 10120 a month over twelve months (6530 and 10010 over three), loan payments 538 + 364. */
function snapshotOf(over: Partial<FinanceSnapshot> = {}): FinanceSnapshot {
  const trip = item({})
  const boat = item({ id: 'boat', name: 'Boat', target: 90000, targetBase: null, currentBase: null, currency: 'XYZ' })
  return makeSnapshot({
    goals: {
      items: [trip, boat],
      plan: { allocations: [allocation(trip, {})], totalRequiredBase: 200, monthlySavingsBase: 0, surplusBase: -200 },
      fire: null,
    },
    ...over,
  })
}

describe('familyOverview', () => {
  it('gives the year’s averages, the scheduled loan payments and the current key numbers of advisorContext', () => {
    const s = snapshotOf()
    const o = familyOverview(s, TODAY)
    expect(o.baseCurrency).toBe('USD')
    expect(o.closedMonth).toBe('2031-06')
    expect(o.monthsOfData).toBe(12)
    expect(o.now).toMatchObject({ incomePerMonth: 6220, expensePerMonth: 10120, loanPaymentsPerMonth: 902 })
    expect(o.now).toMatchObject(currentNumbers(advisorContext(s, TODAY)))
    expect(o.now.liquid).toBe(19268)
    expect(o.mandatory).toBeNull()
    expect(o).not.toHaveProperty('modules')
  })

  it('without the savings (no month of cash flow) a goal status and month are unknown, not unreachable', () => {
    // the reference run of 2026-10-25: without cash flow every goal read "unreachable", and Claude repeated it
    const o = familyOverview(snapshotOf({ cashflow: { ...makeSnapshot().cashflow, avg3m: { ...makeSnapshot().cashflow.avg3m, months: 0 }, avg12m: { ...makeSnapshot().cashflow.avg12m, months: 0 } } }), TODAY)
    expect(o.goals.length).toBeGreaterThan(0)
    expect(o.goals.every(g => g.status === null && g.projectedDate === null)).toBe(true)
  })

  it('loans list name, member, type, balance, rate and the scheduled payment from the snapshot', () => {
    const o = familyOverview(snapshotOf(), TODAY)
    expect(o.loans).toEqual([
      { name: 'City apartment mortgage', member: DEMO_FAMILIES['en-US'].members[0], type: 'mortgage', currency: 'RUB', balance: 3350000, balanceBase: 43963, ratePct: 10.4, payment: 41000, paymentBase: 538 },
      { name: 'Car loan', member: DEMO_FAMILIES['en-US'].members[1], type: 'consumer', currency: 'EUR', balance: 3300, balanceBase: 3872, ratePct: 11.2, payment: 310, paymentBase: 364 },
    ])
    expect(Object.keys(o.loans[0]).sort()).toEqual(['balance', 'balanceBase', 'currency', 'member', 'name', 'payment', 'paymentBase', 'ratePct', 'type'])
  })

  it('goals list the plan status and projected month', () => {
    const o = familyOverview(snapshotOf(), TODAY)
    expect(o.goals).toEqual([
      { id: 'trip', name: 'Trip', targetBase: 8000, currentBase: 2000, targetDate: '2034-01-31', status: 'on_track', projectedDate: '2034-01' },
      // a goal without a rate is not in the plan: no status, but it is listed with null amounts
      { id: 'boat', name: 'Boat', targetBase: null, currentBase: null, targetDate: '2034-01-31', status: null, projectedDate: null },
    ])
  })

  it('health lists the metrics in HEALTH_KEYS order, empty without the report', () => {
    const o = familyOverview(snapshotOf(), TODAY)
    expect(o.health.map(h => h.key)).toEqual([...HEALTH_KEYS])
    expect(o.health[0]).toEqual({ key: 'savings_rate', value: -55.72, zone: 'red' })
    const partial = familyOverview(snapshotOf({ health: { composite: null, metrics: { debt_to_asset: { value: null, zone: null }, savings_rate: { value: 10, zone: 'green' } } } }), TODAY)
    expect(partial.health).toEqual([{ key: 'savings_rate', value: 10, zone: 'green' }, { key: 'debt_to_asset', value: null, zone: null }])
    expect(familyOverview(snapshotOf({ health: null }), TODAY).health).toEqual([])
  })

  it('income shares come from the earners, the Shared member as its own entry', () => {
    const row = (member: string, activeBase: number) => ({ month: '2031-06', bank: 'B', member, currency: 'USD', active: activeBase, passive: 0, expense: 0, activeBase, passiveBase: 0, expenseBase: 0 })
    const s = snapshotOf({ cashflow: { ...makeSnapshot().cashflow, rows: [row('Robin', 3000), row('Noa', 1000), row('Shared', 1000)] } })
    const o = familyOverview(s, TODAY)
    expect(o.incomeShares.map(x => x.member)).toEqual(['Robin', 'Noa', 'Shared'])
    expect(o.incomeShares.reduce((sum, x) => sum + x.sharePct, 0)).toBeCloseTo(100, 1)
  })

  it('gaps are contextGaps: short_history, no_mandatory … without scenario gaps', () => {
    const s = snapshotOf({
      cashflow: { ...makeSnapshot().cashflow, avg3m: { ...makeSnapshot().cashflow.avg3m, months: 2 }, avg12m: { ...makeSnapshot().cashflow.avg12m, months: 2 } },
    })
    const o = familyOverview(s, TODAY)
    const codes = o.gaps.map(g => g.code)
    expect(codes).toEqual(['short_history', 'no_earner', 'no_mandatory', 'goal_no_rate'])
    expect(codes).not.toContain('no_rate')
    expect(codes).not.toContain('unknown_goal')
  })

  it('an empty family gives zeros/nulls and the gaps, never NaN', () => {
    const o = familyOverview(emptySnapshot(), TODAY)
    expect(o.closedMonth).toBeNull()
    expect(o.monthsOfData).toBe(0)
    expect(o.now).toEqual({ savingsPerMonth: null, leftForLiving: null, debtPaymentPct: null, emergencyMonths: null, liquid: null, incomePerMonth: 0, expensePerMonth: 0, loanPaymentsPerMonth: 0 })
    expect(o.loans).toEqual([])
    expect(o.goals).toEqual([])
    expect(o.health).toEqual([])
    expect(o.incomeShares).toEqual([])
    expect(o.gaps.map(g => g.code)).toEqual(expect.arrayContaining(['short_history', 'no_mandatory', 'no_goals', 'liquid_unknown']))
    expect(JSON.stringify(o)).not.toMatch(/NaN|Infinity/)
  })

  it('income sources: each category\'s average a month over the window, with its flow and one-off flag; the unallocated income a month', () => {
    const cat = (categoryId: number, name: string, flow: 'active' | 'passive', amountBase: number | null, oneOff = false): CategoryTotal =>
      ({ categoryId, name, kind: 'optional', flow, oneOff, amountBase })
    const month = (m: string, categories: CategoryTotal[], unallocatedBase: number | null): CategorisedMonth =>
      ({ month: m, categories, allocatedBase: 0, totalBase: null, unallocatedBase, coveragePct: null })
    const row = (m: string, activeBase: number, loan = false): CashflowRowBase =>
      ({ month: m, bank: loan ? 'Car loan' : 'Bank', member: 'Robin', currency: 'USD', ...(loan ? { loan: true as const } : {}), active: activeBase, passive: 0, expense: 0, activeBase, passiveBase: 0, expenseBase: 0 })
    const base = makeSnapshot()
    const s = snapshotOf({
      // 2030-06 lies outside the 12-month window that ends at 2031-06
      income: { months: [
        month('2030-06', [cat(10, 'Salary', 'active', 9999)], 0),
        month('2031-05', [cat(10, 'Salary', 'active', 6000), cat(12, 'Bonus', 'active', 900, true)], 100),
        month('2031-06', [cat(10, 'Salary', 'active', 6000), cat(11, 'Dividends', 'passive', 30)], 200),
      ] },
      // 2031-04 has no lines: its whole income is unallocated; a loan row is no income
      cashflow: { ...base.cashflow, rows: [row('2031-04', 6100), row('2031-04', 500, true), row('2031-05', 7000), row('2031-06', 6230)], avg12m: { ...base.cashflow.avg12m, months: 3 } },
    })
    const o = familyOverview(s, TODAY)
    expect(o.incomeSources).toEqual([
      { name: 'Salary', flow: 'active', oneOff: false, perMonthBase: 4000 },
      { name: 'Bonus', flow: 'active', oneOff: true, perMonthBase: 300 },
      { name: 'Dividends', flow: 'passive', oneOff: false, perMonthBase: 10 },
    ])
    expect(o.unallocatedIncomeBase).toBe(2133.33)
    // a line without a rate makes its source and the rest unknown
    const rateless = familyOverview(snapshotOf({ ...s, income: { months: [month('2031-06', [cat(11, 'Dividends', 'passive', null)], null)] } }), TODAY)
    expect(rateless.incomeSources).toEqual([{ name: 'Dividends', flow: 'passive', oneOff: false, perMonthBase: null }])
    expect(rateless.unallocatedIncomeBase).toBeNull()
  })

  it('without income lines the sources are empty, and without a month to average the rest is unknown', () => {
    // the fixture has no flow rows: no month of the window to average, so the income left unallocated is unknown, not 0
    expect(familyOverview(snapshotOf(), TODAY)).toMatchObject({ incomeSources: [], unallocatedIncomeBase: null })
    expect(familyOverview(emptySnapshot(), TODAY)).toMatchObject({ incomeSources: [], unallocatedIncomeBase: null })
  })
})
