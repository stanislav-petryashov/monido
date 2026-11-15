import { describe, expect, it } from 'vitest'
import { advisorContext, parseScenario, ScenarioError } from '../../src/domain/advisor'
import type { CashflowRowBase, GoalItem } from '../../src/domain/types'
import { makeSnapshot, SHARED } from '../helpers/snapshot'

const TODAY = new Date('2031-07-03T09:00:00Z')

/** The error parseScenario throws for `body`, or null when it parses. */
function errorOf(body: unknown): { code: string; param: string } | null {
  try {
    parseScenario(body, TODAY)
    return null
  } catch (e) {
    if (!(e instanceof ScenarioError)) throw e
    return { code: e.code, param: e.param }
  }
}

const CREDIT = { kind: 'credit', amount: 20000, currency: 'USD', termMonths: 36, ratePct: 12, downPayment: 2000, loanType: 'consumer' }

describe('parseScenario', () => {
  it('parses each kind', () => {
    expect(parseScenario({ kind: 'buy_now', amount: 900, currency: 'EUR' }, TODAY)).toEqual({ kind: 'buy_now', amount: 900, currency: 'EUR' })
    expect(parseScenario({ kind: 'buy_now', amount: 900, currency: 'EUR', goalId: 'car' }, TODAY)).toEqual({ kind: 'buy_now', amount: 900, currency: 'EUR', goalId: 'car' })
    expect(parseScenario(CREDIT, TODAY)).toEqual(CREDIT)
    expect(parseScenario({ kind: 'save_up', amount: 5000, currency: 'USD', targetMonth: '2032-01' }, TODAY))
      .toEqual({ kind: 'save_up', amount: 5000, currency: 'USD', targetMonth: '2032-01' })
    expect(parseScenario({ kind: 'goal', name: ' New car ', amount: 30000, currency: 'USD', targetDate: '2033-06-30' }, TODAY))
      .toEqual({ kind: 'goal', name: 'New car', amount: 30000, currency: 'USD', targetDate: '2033-06-30' })
  })

  it('parseScenario requires term, rate, down payment and loan type for a credit, naming the missing one', () => {
    for (const param of ['termMonths', 'ratePct', 'downPayment', 'loanType']) {
      const body: Record<string, unknown> = { ...CREDIT }
      delete body[param]
      expect(errorOf(body)).toEqual({ code: 'missing_param', param })
    }
    expect(errorOf({ ...CREDIT, loanType: 'card' })).toEqual({ code: 'invalid_param', param: 'loanType' })
    expect(errorOf({ ...CREDIT, termMonths: 0 })).toEqual({ code: 'invalid_param', param: 'termMonths' })
    expect(errorOf({ ...CREDIT, termMonths: 12.5 })).toEqual({ code: 'invalid_param', param: 'termMonths' })
    expect(errorOf({ ...CREDIT, termMonths: 421 })).toEqual({ code: 'invalid_param', param: 'termMonths' })
    expect(errorOf({ ...CREDIT, termMonths: 420 })).toBeNull()
    expect(errorOf({ ...CREDIT, ratePct: -1 })).toEqual({ code: 'invalid_param', param: 'ratePct' })
    expect(errorOf({ ...CREDIT, ratePct: '12' })).toEqual({ code: 'invalid_param', param: 'ratePct' })
  })

  it('parseScenario rejects a save_up month in the past and a down payment ≥ the amount', () => {
    expect(errorOf({ kind: 'save_up', amount: 5000, currency: 'USD', targetMonth: '2031-06' })).toEqual({ code: 'invalid_param', param: 'targetMonth' })
    expect(errorOf({ kind: 'save_up', amount: 5000, currency: 'USD', targetMonth: '2031-13' })).toEqual({ code: 'invalid_param', param: 'targetMonth' })
    // this month is too late to save anything: strictly after the current month
    expect(errorOf({ kind: 'save_up', amount: 5000, currency: 'USD', targetMonth: '2031-07' })).toEqual({ code: 'invalid_param', param: 'targetMonth' })
    expect(errorOf({ kind: 'save_up', amount: 5000, currency: 'USD', targetMonth: '2031-08' })).toBeNull()
    expect(errorOf({ kind: 'save_up', amount: 5000, currency: 'USD' })).toEqual({ code: 'missing_param', param: 'targetMonth' })
    expect(errorOf({ ...CREDIT, downPayment: 20000 })).toEqual({ code: 'invalid_param', param: 'downPayment' })
    expect(errorOf({ ...CREDIT, downPayment: 25000 })).toEqual({ code: 'invalid_param', param: 'downPayment' })
    expect(errorOf({ ...CREDIT, downPayment: -1 })).toEqual({ code: 'invalid_param', param: 'downPayment' })
    expect(errorOf({ ...CREDIT, downPayment: 0 })).toBeNull()
  })

  it('rejects a missing or bad kind, amount, currency, goal name and date', () => {
    expect(errorOf(null)).toEqual({ code: 'missing_param', param: 'kind' })
    expect(errorOf('buy_now')).toEqual({ code: 'missing_param', param: 'kind' })
    expect(errorOf({ amount: 1, currency: 'USD' })).toEqual({ code: 'missing_param', param: 'kind' })
    expect(errorOf({ kind: 'windfall', amount: 1, currency: 'USD' })).toEqual({ code: 'invalid_param', param: 'kind' })
    expect(errorOf({ kind: 'buy_now', currency: 'USD' })).toEqual({ code: 'missing_param', param: 'amount' })
    expect(errorOf({ kind: 'buy_now', amount: 0, currency: 'USD' })).toEqual({ code: 'invalid_param', param: 'amount' })
    expect(errorOf({ kind: 'buy_now', amount: Infinity, currency: 'USD' })).toEqual({ code: 'invalid_param', param: 'amount' })
    expect(errorOf({ kind: 'buy_now', amount: 2e9, currency: 'USD' })).toEqual({ code: 'invalid_param', param: 'amount' })
    expect(errorOf({ kind: 'buy_now', amount: 1e9, currency: 'USD' })).toBeNull()
    expect(errorOf({ kind: 'buy_now', amount: 1 })).toEqual({ code: 'missing_param', param: 'currency' })
    expect(errorOf({ kind: 'buy_now', amount: 1, currency: 'usd' })).toEqual({ code: 'invalid_param', param: 'currency' })
    expect(errorOf({ kind: 'buy_now', amount: 1, currency: 'USD', goalId: '' })).toEqual({ code: 'invalid_param', param: 'goalId' })
    expect(errorOf({ kind: 'goal', amount: 1, currency: 'USD', targetDate: '2032-01-31' })).toEqual({ code: 'missing_param', param: 'name' })
    expect(errorOf({ kind: 'goal', name: '  ', amount: 1, currency: 'USD', targetDate: '2032-01-31' })).toEqual({ code: 'invalid_param', param: 'name' })
    expect(errorOf({ kind: 'goal', name: 'Car‮', amount: 1, currency: 'USD', targetDate: '2032-01-31' })).toEqual({ code: 'invalid_param', param: 'name' })
    expect(errorOf({ kind: 'goal', name: 'x'.repeat(61), amount: 1, currency: 'USD', targetDate: '2032-01-31' })).toEqual({ code: 'invalid_param', param: 'name' })
    expect(errorOf({ kind: 'goal', name: 'Car', amount: 1, currency: 'USD' })).toEqual({ code: 'missing_param', param: 'targetDate' })
    expect(errorOf({ kind: 'goal', name: 'Car', amount: 1, currency: 'USD', targetDate: '2032-02-30' })).toEqual({ code: 'invalid_param', param: 'targetDate' })
    expect(errorOf({ kind: 'goal', name: 'Car', amount: 1, currency: 'USD', targetDate: '2031-07-02' })).toEqual({ code: 'invalid_param', param: 'targetDate' })
    expect(errorOf({ kind: 'goal', name: 'Car', amount: 1, currency: 'USD', targetDate: '2031-07-03' })).toBeNull()
  })
})

const row = (month: string, member: string, active: number, expense: number, currency = 'USD', passive = 0): CashflowRowBase => ({
  month, bank: `${member} bank`, member, currency,
  active, passive, expense, activeBase: active, passiveBase: passive, expenseBase: expense,
})
const loanRow = (month: string, expense: number): CashflowRowBase => ({
  month, bank: 'Car loan', member: 'Robin', currency: 'USD', loan: true,
  active: 0, passive: 0, expense, activeBase: 0, passiveBase: 0, expenseBase: expense,
})

describe('advisorContext', () => {
  it('advisorContext takes 3-month averages, the scheduled loan payments and the earners without Shared', () => {
    const rows = [
      row('2031-03', 'Robin', 9000, 0), // outside the 3-month window
      ...['2031-04', '2031-05', '2031-06'].flatMap(m => [
        row(m, 'Robin', 3500, 2000), row(m, 'Noa', 1500, 900, 'EUR'), row(m, SHARED, 300, 0, 'USD', 100), loanRow(m, 600),
      ]),
    ]
    const goal: GoalItem = { id: 'car', name: 'Car', target: 10000, current: 2000, target_date: '2033-01-31', emoji: null, currency: 'EUR', targetBase: 11000, currentBase: 2200 }
    const noRate: GoalItem = { ...goal, id: 'boat', currency: 'XYZ', targetBase: null, currentBase: null }
    const s = makeSnapshot()
    const [mortgage, car] = s.capital!.loans
    const ctx = advisorContext(makeSnapshot({
      capital: { ...s.capital!, loans: [mortgage, { ...car, currency: 'XYZ', balanceBase: null, paymentBase: null }, { ...car, name: 'Done', currency: 'XYZ', payment: 0, paymentBase: null }] },
      cashflow: { ...s.cashflow, rows, avg3m: { months: 3, expensePerMonth: 3500, passivePerMonth: 100, netPerMonth: 1900, ratePct: 35.19 } },
      spending: {
        months: [
          { month: '2031-02', categories: [], allocatedBase: 0, totalBase: 1, unallocatedBase: null, coveragePct: 10 },
          { month: '2031-05', categories: [], allocatedBase: 0, totalBase: 1, unallocatedBase: null, coveragePct: 85 },
          { month: '2031-06', categories: [], allocatedBase: 0, totalBase: 0, unallocatedBase: null, coveragePct: null },
        ],
        mandatory: { perMonthBase: 1800, source: 'categories', months: 2, updatedAt: null },
      },
      goals: { ...s.goals, items: [goal, noRate] },
    }), TODAY)

    expect(ctx.base).toBe('USD')
    expect(ctx.today).toBe(TODAY)
    expect(ctx.month).toBe('2031-06')
    expect(ctx.months).toBe(3)
    expect(ctx.incomePerMonth).toBe(5400)
    expect(ctx.expensePerMonth).toBe(3500)
    expect(ctx.closed).toEqual({ income: s.cashflow.closedMonth!.income, expense: s.cashflow.closedMonth!.expense })
    expect(ctx.loanPaymentsPerMonth).toBe(538)
    // a loan without a rate is left out of the payments but named; one with no payment this month changes nothing
    expect(ctx.rateless).toEqual({ loans: [{ name: 'Car loan', currency: 'XYZ' }], goals: [{ id: 'boat', name: 'Car', currency: 'XYZ' }] })
    expect(ctx.mandatory).toEqual({ perMonthBase: 1800, source: 'categories', months: 2, updatedAt: null })
    expect(ctx.coverage).toEqual([85, null])
    expect(ctx.liquid).toBe(19268)
    expect(ctx.earners).toEqual([{ member: 'Robin', activePerMonth: 3500 }, { member: 'Noa', activePerMonth: 1500 }])
    expect(ctx.sharedActivePerMonth).toBe(300)
    expect(ctx.incomeCurrencies).toEqual(['EUR', 'USD'])
    expect(ctx.goals).toEqual([{ id: 'car', name: 'Car', target: 11000, current: 2200, target_date: '2033-01-31', emoji: null, currency: 'USD' }])
  })

  it('an empty snapshot gives zeros, unknown liquid money and no earners, never NaN', () => {
    const s = makeSnapshot()
    const ctx = advisorContext(makeSnapshot({
      asOf: { capitalDate: null, closedMonth: null, openMonths: [], today: '2031-07-03' },
      capital: null,
      cashflow: { ...s.cashflow, closedMonth: null, rows: [], avg3m: { months: 0, expensePerMonth: 0, passivePerMonth: 0, netPerMonth: 0, ratePct: null } },
    }), TODAY)
    expect(ctx).toMatchObject({ month: null, months: 0, incomePerMonth: 0, expensePerMonth: 0, loanPaymentsPerMonth: 0, liquid: null, closed: null, earners: [], sharedActivePerMonth: 0, incomeCurrencies: [], coverage: [], rateless: { loans: [], goals: [] } })
  })
})
