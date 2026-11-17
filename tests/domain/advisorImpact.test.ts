import { describe, expect, it } from 'vitest'
import { advisorContext, type AdvisorContext, type Scenario } from '../../src/domain/advisor'
import { contextGaps, currentNumbers, evaluate, evaluateScenario, type AlternativeKind, type Evaluation, type Impact } from '../../src/domain/advisorImpact'
import { zoneOf } from '../../src/domain/health'
import { calcMonthlyPayment } from '../../src/domain/loans'
import type { CashflowRowBase } from '../../src/domain/types'
import { makeSnapshot, SHARED } from '../helpers/snapshot'

const TODAY = new Date('2031-07-03T09:00:00Z')

/** Income 5000 (Robin 3500, Noa 1500), expenses 3500 incl. 600 of loan payments, mandatory 1800, liquid 12000, one goal. */
function ctxOf(over: Partial<AdvisorContext> = {}): AdvisorContext {
  return {
    base: 'USD', today: TODAY, annualReturn: 0.08, month: '2031-06', months: 3,
    incomePerMonth: 5000, expensePerMonth: 3500, closed: { income: 5000, expense: 3500 }, fundExpense: 3500, loanPaymentsPerMonth: 600,
    mandatory: { perMonthBase: 1800, source: 'categories', months: 3, updatedAt: null },
    coverage: [90, 85, 95],
    liquid: 12000,
    earners: [{ member: 'Robin', activePerMonth: 3500 }, { member: 'Noa', activePerMonth: 1500 }],
    sharedActivePerMonth: 0,
    incomeCurrencies: ['USD'],
    // 6000 left over 30 months (2031-07 → 2034-01) needs 200 a month: on track with savings of 1500, reached at the deadline
    goals: [{ id: 'trip', name: 'Trip', target: 8000, current: 2000, target_date: '2034-01-31', emoji: null, currency: 'USD' }],
    rateless: { loans: [], goals: [] },
    trackFlows: true,
    ...over,
    // the recent months as the year unless a test sets them apart
    recent: over.recent ?? { months: over.months ?? 3, incomePerMonth: over.incomePerMonth ?? 5000, expensePerMonth: over.expensePerMonth ?? 3500 },
  }
}

const CREDIT: Scenario = { kind: 'credit', amount: 20000, currency: 'USD', termMonths: 36, ratePct: 12, downPayment: 2000, loanType: 'consumer' }
const PAYMENT = calcMonthlyPayment(18000, 12, 36)
const r2 = (v: number) => Math.round(v * 100) / 100

/** Every number of the impact, deep: none is NaN or ±Infinity. */
function finiteEverywhere(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v)
  if (Array.isArray(v)) return v.every(finiteEverywhere)
  if (v && typeof v === 'object') return Object.values(v).every(finiteEverywhere)
  return true
}
const codes = (i: Impact) => i.gaps.map(g => g.code)

describe('evaluateScenario: credit', () => {
  it('credit: payment by the annuity formula, overpayment = payment × term − principal', () => {
    const i = evaluateScenario(ctxOf(), CREDIT, {})
    expect(i.amountBase).toBe(20000)
    expect(PAYMENT).toBeCloseTo(597.86, 2)
    expect(i.credit).toEqual({ principal: 18000, payment: r2(PAYMENT), overpayment: r2(PAYMENT * 36 - 18000) })
  })

  it('credit converts the amount and the down payment to the base currency', () => {
    const i = evaluateScenario(ctxOf(), { ...CREDIT, currency: 'EUR', amount: 18000, downPayment: 1800 }, { EUR: 0.9 })
    expect(i.amountBase).toBe(20000)
    expect(i.credit?.principal).toBe(18000)
    expect(i.credit?.payment).toBe(r2(PAYMENT))
  })

  it('credit: after = savings − payment; payment share (600 + payment) / income; emergency (liquid − down) / (expenses + payment)', () => {
    const i = evaluateScenario(ctxOf(), CREDIT, {})
    expect(i.now).toEqual({ savingsPerMonth: 1500, leftForLiving: 2600, debtPaymentPct: 12, emergencyMonths: r2(12000 / 3500), liquid: 12000 })
    expect(i.after.savingsPerMonth).toBe(r2(1500 - PAYMENT))
    expect(i.after.debtPaymentPct).toBe(r2(((600 + PAYMENT) / 5000) * 100))
    expect(i.after.emergencyMonths).toBe(r2(10000 / (3500 + PAYMENT)))
    expect(i.after.liquid).toBe(10000)
    expect(i.monthsToSave).toBe(Math.ceil(20000 / 1500))
  })

  it('left for living = income − mandatory − current payments − new payment', () => {
    const i = evaluateScenario(ctxOf(), CREDIT, {})
    expect(i.now.leftForLiving).toBe(5000 - 1800 - 600)
    expect(i.after.leftForLiving).toBe(r2(5000 - 1800 - 600 - PAYMENT))
  })

  it('credit: the payment moves the goals planned on the savings', () => {
    // savings 1500 → 902: a goal needing 1034 a month (30 000 over 29 months) falls behind to 34 months
    const i = evaluateScenario(ctxOf({ goals: [{ id: 'flat', name: 'Flat', target: 30000, current: 0, target_date: '2033-12-31', emoji: null, currency: 'USD' }] }), CREDIT, {})
    expect(i.goals).toEqual([{ goalId: 'flat', name: 'Flat', before: '2033-12', after: '2034-05', shiftMonths: 5, statusBefore: 'on_track', statusAfter: 'at_risk' }])
  })
})

describe('evaluateScenario: buy_now', () => {
  it('buy_now: emergency (liquid − amount) / expenses; savings and payment share unchanged; no goal moves', () => {
    const i = evaluateScenario(ctxOf(), { kind: 'buy_now', amount: 3000, currency: 'USD' }, {})
    expect(i.after).toEqual({ ...i.now, emergencyMonths: r2(9000 / 3500), liquid: 9000 })
    expect(i.credit).toBeNull()
    expect(i.goals).toEqual([])
    expect(i.monthsToSave).toBe(2)
  })

  it('buy_now: the zone comes from the emergency fund as shown — 1.001 months shows as 1, which is red', () => {
    // 12 000 − 8 496.50 = 3 503.50 left, ÷ 3 500 = 1.001 months
    const i = evaluateScenario(ctxOf(), { kind: 'buy_now', amount: 8496.5, currency: 'USD' }, {})
    expect(i.after.emergencyMonths).toBe(1)
    expect(i.zones.emergency_months).toBe('red')
  })

  it('buy_now with goalId reduces that goal’s progress and shows its shift', () => {
    // 24 000 left at 1500 a month: 16 months; 3000 of the 6000 put aside is spent: 27 000, 18 months
    const flat = { id: 'flat', name: 'Flat', target: 30000, current: 6000, target_date: '2032-06-30', emoji: null, currency: 'USD' }
    const i = evaluateScenario(ctxOf({ goals: [flat] }), { kind: 'buy_now', amount: 3000, currency: 'USD', goalId: 'flat' }, {})
    expect(i.goals).toEqual([{ goalId: 'flat', name: 'Flat', before: '2032-11', after: '2033-01', shiftMonths: 2, statusBefore: 'at_risk', statusAfter: 'at_risk' }])
    expect(i.after.savingsPerMonth).toBe(i.now.savingsPerMonth)
    // a goal already late moved by less than a quarter keeps the zone green (3 months and more is amber: R8's 34 months)
    expect(i.zones.goals).toBe('green')

    // a goal the family does not have: a gap, not silence
    const unknown = evaluateScenario(ctxOf({ goals: [flat] }), { kind: 'buy_now', amount: 3000, currency: 'USD', goalId: 'yacht' }, {})
    expect(unknown.goals).toEqual([])
    expect(unknown.gaps).toEqual([{ code: 'unknown_goal', params: { goalId: 'yacht' }, affects: ['goals'] }])

    // the money put aside is all the goal loses: never below zero
    const all = evaluateScenario(ctxOf({ goals: [flat] }), { kind: 'buy_now', amount: 9000, currency: 'USD', goalId: 'flat' }, {})
    expect(all.goals[0].after).toBe('2033-03')
  })
})

describe('evaluateScenario: limits', () => {
  it('paying more than the liquid money leaves 0, never a negative fund', () => {
    const i = evaluateScenario(ctxOf(), { kind: 'buy_now', amount: 15000, currency: 'USD' }, {})
    expect(i.after.liquid).toBe(0)
    expect(i.after.emergencyMonths).toBe(0)
    expect(i.stress?.months).toBe(0)
    expect(i.risk).toBe('risky')
  })

  it('tiny savings and a huge goal do not throw: the goal is unreachable', () => {
    const ctx = ctxOf({ incomePerMonth: 3500.01 })
    for (const s of [
      { kind: 'goal', name: 'Island', amount: 1e9, currency: 'USD', targetDate: '2040-01-31' },
      { kind: 'save_up', amount: 33000, currency: 'USD', targetMonth: '2032-01' },
      { kind: 'buy_now', amount: 1e9, currency: 'USD' },
    ] as Scenario[]) {
      const i = evaluateScenario(ctx, s, {})
      expect(finiteEverywhere(i)).toBe(true)
      if (s.kind !== 'buy_now') expect(i.goals[0]).toMatchObject({ goalId: 'proposed', after: null, statusAfter: 'unreachable' })
    }
  })
})

describe('evaluateScenario: goal and save_up', () => {
  it('goal and save_up add the goal to the allocation and show which goals move and by how many months', () => {
    // a car of 40 000 by 2033-11 (28 months) takes 1428.57 of the 1500 saved: the trip gets 71.43 for 28 months (2000) and all
    // 1500 for the last two (3000), 1000 short of its 6000 at its deadline — reached a month late
    const goal = evaluateScenario(ctxOf(), { kind: 'goal', name: 'Car', amount: 40000, currency: 'USD', targetDate: '2033-11-30' }, {})
    expect(goal.goals).toEqual([
      { goalId: 'proposed', name: 'Car', before: null, after: '2033-11', shiftMonths: null, statusBefore: null, statusAfter: 'on_track', requiredMonthly: 1428.57,
        firstShare: { month: '2031-08', perMonth: 1428.57 } },
      { goalId: 'trip', name: 'Trip', before: '2034-01', after: '2034-02', shiftMonths: 1, statusBefore: 'on_track', statusAfter: 'at_risk' },
    ])
    expect(goal.after).toEqual(goal.now)

    // saving 7900 by 2032-01 takes 1316.67 a month and leaves the trip 183.33; once it is saved, its share passes to the trip,
    // which still makes 2034-01: only the purchase is listed
    const saveUp = evaluateScenario(ctxOf(), { kind: 'save_up', amount: 7900, currency: 'USD', targetMonth: '2032-01' }, {})
    expect(saveUp.goals).toEqual([
      { goalId: 'proposed', name: '', before: null, after: '2032-01', shiftMonths: null, statusBefore: null, statusAfter: 'on_track', requiredMonthly: 1316.67,
        firstShare: { month: '2031-08', perMonth: 1316.67 } },
    ])
    expect(saveUp.after).toEqual(saveUp.now)
    expect(saveUp.monthsToSave).toBe(6)
  })

  it('the goals weigh in the risk: the new goal unreachable is risky, at risk or another goal made worse is caution', () => {
    // 40 000 by 2033-11 is on track but makes the trip late: a trade between goals, caution
    const trade = evaluateScenario(ctxOf(), { kind: 'goal', name: 'Car', amount: 40000, currency: 'USD', targetDate: '2033-11-30' }, {})
    expect(trade.zones.goals).toBe('amber')
    expect(trade.risk).toBe('caution')
    // a nearer goal takes all the 1500 saved until 2036-01: a house by 2034-12 is late, caution; one the savings would not
    // collect within the horizon is unreachable, risky — never "ok"
    const busy = ctxOf({ goals: [{ id: 'flat', name: 'Flat', target: 80000, current: 0, target_date: '2032-12-31', emoji: null, currency: 'USD' }] })
    const late = evaluateScenario(busy, { kind: 'goal', name: 'House', amount: 20000, currency: 'USD', targetDate: '2034-12-31' }, {})
    expect(late.goals.find(g => g.goalId === 'proposed')?.statusAfter).toBe('at_risk')
    expect(late.zones.goals).toBe('amber')
    const out = evaluateScenario(busy, { kind: 'goal', name: 'House', amount: 2_000_000, currency: 'USD', targetDate: '2034-12-31' }, {})
    expect(out.goals.find(g => g.goalId === 'proposed')?.statusAfter).toBe('unreachable')
    expect(out.zones.goals).toBe('red')
    expect(out.risk).toBe('risky')
    // a goal far enough away with nothing moved stays ok
    const easy = evaluateScenario(ctxOf({ goals: [] }), { kind: 'goal', name: 'Bike', amount: 1200, currency: 'USD', targetDate: '2033-12-31' }, {})
    expect(easy.zones.goals).toBe('green')
    expect(easy.risk).toBe('ok')
  })

  it('the proposed goal carries the contribution it needs and, when it is late, what the nearer goals take and until when', () => {
    // a flat of 80 000 by 2032-12 takes all 1500 saved until it is reached in 2036-01; a house of 20 000 by 2034-12 needs
    // 20 000 ÷ 41 = 487.80 a month, gets 1000 in 2036-01 and 1500 after: 2037-02
    const busy = ctxOf({ goals: [{ id: 'flat', name: 'Flat', target: 80000, current: 0, target_date: '2032-12-31', emoji: null, currency: 'USD' }] })
    const house = evaluateScenario(busy, { kind: 'goal', name: 'House', amount: 20000, currency: 'USD', targetDate: '2034-12-31' }, {})
    expect(house.goals).toEqual([{
      goalId: 'proposed', name: 'House', before: null, after: '2037-02', shiftMonths: null, statusBefore: null, statusAfter: 'at_risk',
      // the plan pays into it from the month the flat is reached, all 1500 a month from the month after
      requiredMonthly: 487.8, takenAhead: { perMonth: 1500, untilMonth: '2036-01' }, firstShare: { month: '2036-01', perMonth: 1500 },
    }])
    // on track: no takenAhead
    const bike = evaluateScenario(ctxOf(), { kind: 'goal', name: 'Bike', amount: 1200, currency: 'USD', targetDate: '2032-06-30' }, {})
    expect(bike.goals).toEqual([{ goalId: 'proposed', name: 'Bike', before: null, after: '2032-06', shiftMonths: null, statusBefore: null, statusAfter: 'on_track', requiredMonthly: 109.09,
      firstShare: { month: '2031-08', perMonth: 109.09 } }])
    // due this month: no month is left to spread it over, so it needs all of it — and is reached next month, late; nothing is ahead of it
    const now = evaluateScenario(ctxOf(), { kind: 'goal', name: 'Gift', amount: 1200, currency: 'USD', targetDate: '2031-07-31' }, {})
    expect(now.goals).toEqual([{ goalId: 'proposed', name: 'Gift', before: null, after: '2031-08', shiftMonths: null, statusBefore: null, statusAfter: 'at_risk', requiredMonthly: 1200,
      firstShare: { month: '2031-08', perMonth: 1200 } }])
  })
})

describe('evaluateScenario: stress test', () => {
  it('stress: months = liquid after ÷ (mandatory + payments − remaining income); null when the rest covers it', () => {
    const i = evaluateScenario(ctxOf(), CREDIT, {})
    // Robin's 3500 stops: 1500 remains against 1800 + 600 + payment
    expect(i.stress).toEqual({ earner: 'Robin', months: r2(10000 / (1800 + 600 + PAYMENT - 1500)) })
    expect(i.zones.stress).toBe('excellent')

    // the largest income is 1500 of 5000: the remaining 3500 covers 1800 + 600 + payment
    const covered = evaluateScenario(ctxOf({ earners: [{ member: 'Robin', activePerMonth: 1500 }] }), CREDIT, {})
    expect(covered.stress).toEqual({ earner: 'Robin', months: null })
    expect(covered.zones.stress).toBe('excellent')

    const thin = evaluateScenario(ctxOf({ liquid: 3000 }), CREDIT, {})
    expect(thin.stress?.months).toBe(r2(1000 / (1800 + 600 + PAYMENT - 1500)))
    expect(thin.zones.stress).toBe('red')
  })

  it('stress without mandatory spending uses the expenses and adds no_mandatory to the gaps', () => {
    const i = evaluateScenario(ctxOf({ mandatory: null }), CREDIT, {})
    // expenses already hold the current loan payments
    expect(i.stress).toEqual({ earner: 'Robin', months: r2(10000 / (3500 + PAYMENT - 1500)) })
    expect(i.now.leftForLiving).toBeNull()
    expect(i.after.leftForLiving).toBeNull()
    expect(i.gaps).toContainEqual({ code: 'no_mandatory', affects: ['leftForLiving', 'stress'] })
  })

  it('income that is all the Shared member’s has no earner to stop: no stress test, a no_earner gap', () => {
    const i = evaluateScenario(ctxOf({ earners: [], sharedActivePerMonth: 5000 }), CREDIT, {})
    expect(i.stress).toBeNull()
    expect(i.zones.stress).toBeUndefined()
    expect(i.gaps).toEqual([{ code: 'no_earner', affects: ['stress'] }])
    expect(i.incomeShares).toEqual([{ member: SHARED, sharePct: 100 }])
  })

  it('Shared income stays in the remaining income of the stress test', () => {
    // income 5000 = Robin 3000 + Noa 1500 + Shared 500 (not an earner)
    const i = evaluateScenario(ctxOf({ earners: [{ member: 'Robin', activePerMonth: 3000 }, { member: 'Noa', activePerMonth: 1500 }] }), CREDIT, {})
    expect(i.stress).toEqual({ earner: 'Robin', months: r2(10000 / (1800 + 600 + PAYMENT - 2000)) })
  })
})

describe('evaluateScenario: income and currency', () => {
  it('incomeShares give each member’s share of the active income, Shared as its own entry, largest first', () => {
    const rows: CashflowRowBase[] = ['2031-04', '2031-05', '2031-06'].flatMap(month => [
      { month, bank: 'A', member: 'Noa', currency: 'USD', active: 1000, passive: 0, expense: 0, activeBase: 1000, passiveBase: 0, expenseBase: 0 },
      { month, bank: 'B', member: 'Robin', currency: 'USD', active: 3000, passive: 0, expense: 0, activeBase: 3000, passiveBase: 0, expenseBase: 0 },
      { month, bank: 'C', member: SHARED, currency: 'USD', active: 800, passive: 0, expense: 0, activeBase: 800, passiveBase: 0, expenseBase: 0 },
    ])
    const s = makeSnapshot()
    const ctx = advisorContext(makeSnapshot({ cashflow: { ...s.cashflow, rows } }), TODAY)
    const i = evaluateScenario(ctx, { kind: 'buy_now', amount: 100, currency: 'USD' }, {})
    // Shared is listed so the shares add up to 100%; it is still not an earner for the stress test
    expect(i.incomeShares).toEqual([{ member: 'Robin', sharePct: 62.5 }, { member: 'Noa', sharePct: 20.83 }, { member: SHARED, sharePct: 16.67 }])
    expect(i.stress?.earner).toBe('Robin')
  })

  it('a loan in a currency the family earns none in is a currency risk', () => {
    const i = evaluateScenario(ctxOf({ incomeCurrencies: ['RUB', 'USD'] }), { ...CREDIT, currency: 'EUR' }, { EUR: 0.9 })
    expect(i.currencyRisk).toEqual({ currency: 'EUR', incomeCurrencies: ['RUB', 'USD'] })
    expect(evaluateScenario(ctxOf({ incomeCurrencies: ['RUB', 'USD'] }), CREDIT, {}).currencyRisk).toBeNull()
  })
})

describe('evaluateScenario: risk level', () => {
  it('risk is risky with any red zone, caution with any amber, ok otherwise; buy_now beyond the liquid money is risky', () => {
    const ok = evaluateScenario(ctxOf({ liquid: 30000 }), { kind: 'buy_now', amount: 1000, currency: 'USD' }, {})
    expect(ok.zones).toEqual({ emergency_months: 'excellent', debt_payment_ratio: 'green', savings_rate: 'excellent', stress: 'excellent', goals: 'green' })
    expect(ok.risk).toBe('ok')

    // the credit leaves 2.44 months of expenses: amber
    const caution = evaluateScenario(ctxOf(), CREDIT, {})
    expect(caution.zones).toEqual({ emergency_months: 'amber', debt_payment_ratio: 'green', savings_rate: 'green', stress: 'excellent', goals: 'green' })
    expect(caution.risk).toBe('caution')

    // a payment share of 50% and more is red
    const risky = evaluateScenario(ctxOf({ liquid: 60000 }), { ...CREDIT, amount: 60000, downPayment: 0 }, {})
    expect(risky.zones.debt_payment_ratio).toBe('red')
    expect(risky.risk).toBe('risky')

    // spending more than the liquid money, even with no expense data to judge it by
    const beyond = evaluateScenario(ctxOf({ liquid: 2000, months: 0, incomePerMonth: 0, expensePerMonth: 0 }), { kind: 'buy_now', amount: 3000, currency: 'USD' }, {})
    expect(beyond.zones).toEqual({})
    expect(beyond.risk).toBe('risky')
  })

  it('risk is unknown when the scenario cannot be weighed: no months of cash flow, no income', () => {
    const buy: Scenario = { kind: 'buy_now', amount: 1000, currency: 'USD' }
    const noFlows = ctxOf({ months: 0, incomePerMonth: 0, expensePerMonth: 0 })
    expect(evaluateScenario(noFlows, buy, {}).risk).toBe('unknown')
    expect(evaluateScenario(ctxOf({ incomePerMonth: 0 }), buy, {}).risk).toBe('unknown')
    // paying more than there is stays risky without any flows
    expect(evaluateScenario(noFlows, { ...buy, amount: 13000 }, {}).risk).toBe('risky')
  })
})

describe('evaluateScenario: data gaps', () => {
  it('gaps: short_history under 3 months, stale_manual after 6 months, low_coverage under 80%', () => {
    const fine = evaluateScenario(ctxOf(), CREDIT, {})
    expect(fine.gaps).toEqual([])

    const short = evaluateScenario(ctxOf({ months: 2 }), CREDIT, {})
    expect(short.gaps).toEqual([{ code: 'short_history', params: { months: 2 }, affects: expect.arrayContaining(['savingsPerMonth', 'emergencyMonths', 'goals']) }])

    const manual = (updatedAt: string) => evaluateScenario(ctxOf({ mandatory: { perMonthBase: 1800, source: 'manual', months: 0, updatedAt } }), CREDIT, {})
    expect(manual('2030-12-20').gaps).toEqual([{ code: 'stale_manual', params: { month: '2030-12' }, affects: ['leftForLiving', 'stress'] }])
    expect(codes(manual('2031-01-01'))).toEqual([]) // six months is not more than six

    const low = evaluateScenario(ctxOf({ coverage: [90, 79.5, null] }), CREDIT, {})
    expect(low.gaps).toEqual([{ code: 'low_coverage', params: { pct: 79.5 }, affects: ['leftForLiving', 'stress'] }])

    // no months of cash flow (income and expenses not tracked): no monthly figures, no stress test, and a short history
    const noFlows = evaluateScenario(ctxOf({ months: 0, incomePerMonth: 0, expensePerMonth: 0 }), CREDIT, {})
    expect(codes(noFlows)).not.toContain('module_off')
    expect(noFlows.after).toEqual({ savingsPerMonth: null, leftForLiving: null, debtPaymentPct: null, emergencyMonths: null, liquid: 10000 })
    expect(noFlows.stress).toBeNull()
    expect(noFlows.credit?.principal).toBe(18000)

    expect(evaluateScenario(ctxOf({ goals: [] }), CREDIT, {}).gaps).toEqual([{ code: 'no_goals', affects: ['goals'] }])
  })

  it('flows_not_tracked: income and expenses are not tracked — no short_history, no_income or no_mandatory to ask about', () => {
    const off = evaluateScenario(ctxOf({ trackFlows: false, months: 0, incomePerMonth: 0, expensePerMonth: 0, mandatory: null, coverage: [] }), CREDIT, {})
    expect(codes(off)).toEqual(['flows_not_tracked'])
    expect(contextGaps(ctxOf({ trackFlows: false, months: 0, mandatory: null }))[0]).toEqual({ code: 'flows_not_tracked', affects: expect.arrayContaining(['savingsPerMonth', 'goals']) })
  })

  it('a loan or a goal without a rate is a gap, and goals that all lack a rate are not "no goals"', () => {
    const i = evaluateScenario(ctxOf({ goals: [], rateless: { loans: [{ name: 'Car loan', currency: 'XYZ' }], goals: [{ id: 'boat', name: 'Boat', currency: 'XYZ' }] } }), CREDIT, {})
    expect(i.gaps).toEqual([
      { code: 'loan_no_rate', params: { currency: 'XYZ', name: 'Car loan' }, affects: ['debtPaymentPct', 'leftForLiving', 'stress'] },
      { code: 'goal_no_rate', params: { currency: 'XYZ', name: 'Boat', goalId: 'boat' }, affects: ['goals'] },
    ])
  })

  it('a scenario currency without a rate → no_rate, after numbers null, no throw', () => {
    const i = evaluateScenario(ctxOf(), { ...CREDIT, currency: 'XYZ' }, { EUR: 0.9 })
    expect(i.amountBase).toBeNull()
    expect(i.after).toEqual({ savingsPerMonth: null, leftForLiving: null, debtPaymentPct: null, emergencyMonths: null, liquid: null })
    expect(i.now.savingsPerMonth).toBe(1500)
    expect(i.credit).toBeNull()
    expect(i.monthsToSave).toBeNull()
    expect(i.stress).toBeNull()
    expect(i.goals).toEqual([])
    expect(i.zones).toEqual({})
    expect(i.risk).toBe('unknown')
    expect(i.gaps).toContainEqual(expect.objectContaining({ code: 'no_rate', params: { currency: 'XYZ' } }))
    expect(finiteEverywhere(i)).toBe(true)

    for (const s of [{ kind: 'buy_now', amount: 1, currency: 'XYZ' }, { kind: 'goal', name: 'G', amount: 1, currency: 'XYZ', targetDate: '2032-01-31' }] as Scenario[]) {
      const j = evaluateScenario(ctxOf(), s, {})
      expect(codes(j)).toContain('no_rate')
      expect(finiteEverywhere(j)).toBe(true)
    }
  })

  it('as on the Financial health cards: the fund is months of the year’s average expenses, the payment share the closed month’s', () => {
    // 3-month averages 5000 / 3500; the closed month earned 4000 and spent 6000; the year's average expenses 4800
    const i = evaluateScenario(ctxOf({ closed: { income: 4000, expense: 6000 }, fundExpense: 4800 }), { kind: 'buy_now', amount: 0.01, currency: 'USD' }, {})
    expect(i.now.emergencyMonths).toBe(2.5) // 12 000 ÷ 4800
    expect(i.now.debtPaymentPct).toBe(15) // 600 ÷ 4000
    expect(i.now.savingsPerMonth).toBe(1500) // still the averages
    expect(i.zones.emergency_months).toBe(zoneOf('emergency_months', i.after.emergencyMonths!))
  })

  it('zero income → payment share and savings rate null with no_income, no NaN or Infinity', () => {
    const ctx = ctxOf({ incomePerMonth: 0, earners: [], expensePerMonth: 0, closed: { income: 0, expense: 0 }, loanPaymentsPerMonth: 0, liquid: 10000 })
    for (const s of [CREDIT, { kind: 'buy_now', amount: 500, currency: 'USD' }, { kind: 'save_up', amount: 500, currency: 'USD', targetMonth: '2031-08' }] as Scenario[]) {
      const i = evaluateScenario(ctx, s, {})
      expect(i.now.debtPaymentPct).toBeNull()
      expect(i.after.debtPaymentPct).toBeNull()
      expect(i.zones.savings_rate).toBeUndefined()
      expect(i.zones.debt_payment_ratio).toBeUndefined()
      expect(i.incomeShares).toEqual([])
      expect(i.stress).toBeNull()
      expect(i.monthsToSave).toBeNull()
      expect(i.gaps).toContainEqual({ code: 'no_income', affects: ['savingsPerMonth', 'debtPaymentPct', 'stress'] })
      // nothing to weigh the scenario against, though the money to pay is there
      expect(i.risk).toBe('unknown')
      expect(finiteEverywhere(i)).toBe(true)
    }
  })
})

/** A credit of 40 000 (38 000 borrowed at 12% over 36 months, 1262.14 a month): the payment share (600 + 1262.14) ÷ 5000 = 37.24%, amber */
const BIG_CREDIT: Scenario = { ...CREDIT, amount: 40000 }
const kinds = (e: Evaluation) => e.alternatives.map(a => a.kind)
const monthOfToday = () => '2026-10'
/** Months from one 'YYYY-MM' to another */
const monthsApart = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5))
const alt = (e: Evaluation, kind: AlternativeKind) => e.alternatives.find(a => a.kind === kind)

describe('evaluate: alternatives', () => {
  it('credit: “smaller” is the largest amount whose payment share stays ≤ 30%, rounded down to 1 000 of the currency', () => {
    // cap 0.30 × 5000 − 600 = 900 a month; 900 × (1 − 1.01^−36) / 0.01 = 27 096.75 borrowed + 2000 down = 29 096.75 → 29 000
    const e = evaluate(ctxOf(), BIG_CREDIT, {})
    expect(e.impact).toEqual(evaluateScenario(ctxOf(), BIG_CREDIT, {}))
    const smaller = alt(e, 'smaller')
    expect(smaller?.scenario).toEqual({ ...BIG_CREDIT, amount: 29000 })
    // 27 000 borrowed: 896.79 a month, (600 + 896.79) ÷ 5000 = 29.94%
    expect(smaller?.impact.credit?.payment).toBe(896.79)
    expect(smaller?.impact.after.debtPaymentPct).toBe(29.94)
    expect(smaller?.impact.zones.debt_payment_ratio).toBe('green')

    // in the scenario currency: 36 000 EUR = 40 000 USD; 27 096.75 + 2000 USD = 29 096.75 USD × 0.9 = 26 187.08 EUR → 26 000 EUR
    const eur = evaluate(ctxOf(), { ...BIG_CREDIT, currency: 'EUR', amount: 36000, downPayment: 1800 }, { EUR: 0.9 })
    expect(alt(eur, 'smaller')?.scenario).toMatchObject({ currency: 'EUR', amount: 26000, downPayment: 1800 })

    // at 0%: 900 × 20 = 18 000 + 2000 = 20 000 exactly hits 30%, which is already amber: one step lower, 19 000 (850 a month, 29%)
    const flat = evaluate(ctxOf(), { ...CREDIT, amount: 30000, ratePct: 0, termMonths: 20 }, {})
    expect(alt(flat, 'smaller')?.scenario).toMatchObject({ amount: 19000 })
    expect(alt(flat, 'smaller')?.impact.after.debtPaymentPct).toBe(29)

    // a credit already under the norm: the "smaller" amount 29 000 is above 20 000, none offered
    expect(alt(evaluate(ctxOf(), CREDIT, {}), 'smaller')).toBeUndefined()
    // 29 050: 27 050 borrowed, 898.45 a month, (600 + 898.45) ÷ 5000 = 29.97% — already green, so no "smaller 29 000"
    expect(alt(evaluate(ctxOf(), { ...CREDIT, amount: 29050 }, {}), 'smaller')).toBeUndefined()
  })

  it('credit: no “smaller” when current payments already take 30% or it would not exceed the down payment', () => {
    expect(alt(evaluate(ctxOf({ loanPaymentsPerMonth: 1500 }), BIG_CREDIT, {}), 'smaller')).toBeUndefined()
    // cap 1500 − 1480 = 20: 602.15 borrowed + 2000 down = 2602.15 → 2000, not above the down payment
    expect(alt(evaluate(ctxOf({ loanPaymentsPerMonth: 1480 }), BIG_CREDIT, {}), 'smaller')).toBeUndefined()
    // a loan without a rate leaves the payment share unknown (as on Financial health): no "under 30%" and no longer term for it
    const rateless = ctxOf({ rateless: { loans: [{ name: 'Car loan', currency: 'XYZ' }], goals: [] } })
    expect(evaluate(rateless, BIG_CREDIT, {}).impact.after.debtPaymentPct).toBeNull()
    expect(alt(evaluate(rateless, BIG_CREDIT, {}), 'smaller')).toBeUndefined()
    expect(alt(evaluate(rateless, BIG_CREDIT, {}), 'longer_term')).toBeUndefined()
  })

  it('credit: “save_up” targets the earliest month the savings collect the amount with the trip still on track', () => {
    // 20 000 ÷ 14 = 1428.57 of the 1500 saved (÷ 13 = 1538.46 is more): 2032-09; the trip gets 71.43 meanwhile and catches up after
    const e = evaluate(ctxOf(), CREDIT, {})
    const saveUp = alt(e, 'save_up')
    expect(saveUp?.scenario).toEqual({ kind: 'save_up', amount: 20000, currency: 'USD', targetMonth: '2032-09' })
    expect(saveUp?.impact).toEqual(evaluateScenario(ctxOf(), saveUp!.scenario, {}))
  })

  it('a save_up alternative leaves the existing goals as they are: it saves only what they do not need', () => {
    // credit: 1428.57 a month for 14 months; buy_now: 4500 ÷ 3 = 1500 a month; the trip waits and catches up — still 2034-01
    for (const s of [CREDIT, { kind: 'buy_now', amount: 6000, currency: 'USD' }] as Scenario[]) {
      const saveUp = alt(evaluate(ctxOf(), s, {}), 'save_up')
      // honest: its own impact reaches the purchase on track exactly at the month it names
      const targetMonth = saveUp?.scenario.kind === 'save_up' ? saveUp.scenario.targetMonth : null
      expect(saveUp?.impact.goals).toEqual([expect.objectContaining({ goalId: 'proposed', after: targetMonth, statusAfter: 'on_track' })])
    }
  })

  it('goals with nearer deadlines that take all the savings: the save_up and the later date wait until they are reached', () => {
    // a flat needing 16 000 ÷ 10 = 1600 a month by 2032-05 takes all 1500 saved until 2032-06, 500 of it then: 19 500 ÷ 1500
    // = 13 months more, 2033-07; before the flat's deadline 20 000 would need ≥ 2000 a month
    const flat = { id: 'flat', name: 'Flat', target: 16000, current: 0, target_date: '2032-05-31', emoji: null, currency: 'USD' }
    const greedy = ctxOf({ goals: [flat] })
    const saveUp = alt(evaluate(greedy, CREDIT, {}), 'save_up')
    expect(saveUp?.scenario).toEqual({ kind: 'save_up', amount: 20000, currency: 'USD', targetMonth: '2033-07' })
    // the flat keeps its month
    expect(saveUp?.impact.goals.map(g => g.goalId)).toEqual(['proposed'])
    const car: Scenario = { kind: 'goal', name: 'Car', amount: 20000, currency: 'USD', targetDate: '2032-01-31' }
    expect(alt(evaluate(greedy, car, {}), 'later_date')?.scenario).toEqual({ ...car, targetDate: '2033-07-31' })
    // every save_up or later date offered anywhere names a month its own impact reaches on track, every goal on track stays
    // on track and no status gets worse; a goal already late may move later, and then the goals zone says so
    const rank = { done: 0, on_track: 0, at_risk: 1, unreachable: 2 } as const
    const house = { id: 'house', name: 'House', target: 100000, current: 0, target_date: '2036-06-30', emoji: null, currency: 'USD' }
    for (const s of [CREDIT, BIG_CREDIT, { kind: 'buy_now', amount: 6000, currency: 'USD' }, { kind: 'goal', name: 'Car', amount: 12000, currency: 'USD', targetDate: '2032-01-31' }] as Scenario[]) {
      for (const ctx of [ctxOf(), greedy, ctxOf({ incomePerMonth: 3600 }), ctxOf({ goals: [house] }), ctxOf({ goals: [house, ...ctxOf().goals] })]) {
        for (const a of evaluate(ctx, s, {}).alternatives.filter(x => x.kind === 'save_up' || x.kind === 'later_date')) {
          expect(a.impact.goals.find(g => g.goalId === 'proposed')?.statusAfter).toBe('on_track')
          for (const g of a.impact.goals.filter(x => x.goalId !== 'proposed')) {
            expect(rank[g.statusAfter]).toBeLessThanOrEqual(rank[g.statusBefore!])
            if (g.statusBefore === 'on_track') expect(g.statusAfter).toBe('on_track')
            // a goal reached later than before: only one already late; by a quarter or more, the zone is amber
            if (g.before !== null && (g.after === null || g.after > g.before)) expect(g.statusBefore).toBe('at_risk')
            if ((g.shiftMonths ?? 0) >= 3) expect(a.impact.zones.goals).toBe('amber')
          }
        }
      }
    }
  })

  it('a goal with a later deadline that is already late may move later: the save_up comes first, and its impact shows the move', () => {
    // a house needing 100 000 ÷ 59 = 1694.92 a month takes all 1500 saved (at risk, 2037-02): saving 20 000 by 2032-09 ahead
    // of it pushes it 13 months later, still at risk
    const house = { id: 'house', name: 'House', target: 100000, current: 0, target_date: '2036-06-30', emoji: null, currency: 'USD' }
    const greedy = ctxOf({ goals: [house] })
    const moved = (before: string, after: string, shiftMonths: number) =>
      ({ goalId: 'house', name: 'House', before, after, shiftMonths, statusBefore: 'at_risk', statusAfter: 'at_risk' })
    const saveUp = alt(evaluate(greedy, CREDIT, {}), 'save_up')
    expect(saveUp?.scenario).toEqual({ kind: 'save_up', amount: 20000, currency: 'USD', targetMonth: '2032-09' })
    expect(saveUp?.impact.goals[1]).toEqual(moved('2037-02', '2038-03', 13))
    expect(saveUp?.impact.zones.goals).toBe('amber')
    // the 4500 the purchase would take below the fund: 2031-10, the house 3 months later
    const buy = alt(evaluate(greedy, { kind: 'buy_now', amount: 6000, currency: 'USD' }, {}), 'save_up')
    expect(buy?.scenario).toMatchObject({ amount: 4500, targetMonth: '2031-10' })
    expect(buy?.impact.goals[1]).toEqual(moved('2037-02', '2037-05', 3))
    // exactly a quarter later: amber
    expect(buy?.impact.zones.goals).toBe('amber')
    const car: Scenario = { kind: 'goal', name: 'Car', amount: 12000, currency: 'USD', targetDate: '2032-01-31' }
    const later = alt(evaluate(greedy, car, {}), 'later_date')
    expect(later?.scenario).toEqual({ ...car, targetDate: '2032-03-31' })
    expect(later?.impact.goals[1]).toEqual(moved('2037-02', '2037-10', 8))
  })

  it('credit: “longer_term” adds 12 months only when the payment share zone is amber or red, up to 84 (consumer) / 360 (mortgage)', () => {
    const e = evaluate(ctxOf(), BIG_CREDIT, {})
    expect(alt(e, 'longer_term')?.scenario).toEqual({ ...BIG_CREDIT, termMonths: 48 })
    // 38 000 over 48 months: 1000.69 a month, (600 + 1000.69) ÷ 5000 = 32.01%
    expect(alt(e, 'longer_term')?.impact.after.debtPaymentPct).toBe(32.01)
    // the payment share 23.96% is green: no longer term
    expect(alt(evaluate(ctxOf(), CREDIT, {}), 'longer_term')).toBeUndefined()

    // 58 000 borrowed over 80 months: 1056.69 a month, 33.13%, amber; over 84 months still 32.48%, amber, but no longer than 84
    const long: Scenario = { ...CREDIT, amount: 60000, termMonths: 80 }
    expect(alt(evaluate(ctxOf(), long, {}), 'longer_term')?.scenario).toMatchObject({ termMonths: 84 })
    expect(alt(evaluate(ctxOf(), { ...long, termMonths: 84 }, {}), 'longer_term')).toBeUndefined()
    // 198 000 over 350 months: 2042.77 a month, 52.86%, red
    const mortgage: Scenario = { ...CREDIT, amount: 200000, termMonths: 350, loanType: 'mortgage' }
    expect(alt(evaluate(ctxOf(), mortgage, {}), 'longer_term')?.scenario).toMatchObject({ termMonths: 360 })
    expect(alt(evaluate(ctxOf(), { ...mortgage, termMonths: 360 }, {}), 'longer_term')).toBeUndefined()
  })

  it('credit: “bigger_down_payment” is the largest down payment that keeps the fund above 3 months with the new payment, ≤ 90% of the amount, adding ≥ 10%', () => {
    // liquid − D ≥ 3 × (expenses + payment(amount − D)): 30 000 leaves room for 19 444.66, 90% of 20 000 = 18 000 caps it
    const rich = evaluate(ctxOf({ liquid: 30000 }), CREDIT, {})
    const bigger = alt(rich, 'bigger_down_payment')
    expect(bigger?.scenario).toEqual({ ...CREDIT, downPayment: 18000 })
    expect(bigger?.impact.credit?.principal).toBe(2000)
    expect(bigger?.impact.after.liquid).toBe(12000)
    expect(bigger?.impact.after.emergencyMonths).toBe(r2(12000 / (3500 + calcMonthlyPayment(2000, 12, 36))))

    // 18 000: room for 6116.62 → 6000, adds 4000 ≥ 2000 (10% of 20 000); 12 000 ÷ (3500 + 465) = 3.03 months, green
    const mid = alt(evaluate(ctxOf({ liquid: 18000 }), CREDIT, {}), 'bigger_down_payment')
    expect(mid?.scenario).toMatchObject({ downPayment: 6000 })
    expect(mid?.impact.after.emergencyMonths).toBe(3.03)
    expect(mid?.impact.zones.emergency_months).toBe('green')
    // 16 000: the old rule (liquid above 3 × expenses) gave 5000 and 2.81 months; with the payment counted, room for 3895.28
    // → 3000 adds 1000 < 2000: none
    expect(alt(evaluate(ctxOf({ liquid: 16000 }), CREDIT, {}), 'bigger_down_payment')).toBeUndefined()
    expect(alt(evaluate(ctxOf({ liquid: 13500 }), CREDIT, {}), 'bigger_down_payment')).toBeUndefined()
    expect(alt(evaluate(ctxOf(), CREDIT, {}), 'bigger_down_payment')).toBeUndefined()

    // the 90% cap in the scenario currency: 90% of 90 000 EUR is 81 000, not 80 999.99… after a trip through USD at 0.92
    // (income 20 000 keeps the payment share green, so "smaller" and "longer_term" do not take the three places)
    const eur = evaluate(ctxOf({ liquid: 200000, incomePerMonth: 20000 }), { ...CREDIT, currency: 'EUR', amount: 90000, downPayment: 2000 }, { EUR: 0.92 })
    expect(alt(eur, 'bigger_down_payment')?.scenario).toMatchObject({ currency: 'EUR', downPayment: 81000 })
  })

  it('credit: “bigger_down_payment” in a currency other than the base keeps the fund too', () => {
    // 18 000 USD of liquid money, a 18 000 EUR credit (20 000 USD) at 0.9: room for 6116.62 USD = 5504.96 EUR → 5000 EUR
    const e = evaluate(ctxOf({ liquid: 18000 }), { ...CREDIT, currency: 'EUR', amount: 18000, downPayment: 1800 }, { EUR: 0.9 })
    const bigger = alt(e, 'bigger_down_payment')
    expect(bigger?.scenario).toMatchObject({ currency: 'EUR', downPayment: 5000 })
    expect(bigger!.impact.after.emergencyMonths!).toBeGreaterThan(3)
  })

  it('credit: “bigger_down_payment” at a term so short the payment outweighs the down payment still keeps the fund', () => {
    // 2 months at 0%: each unit put down saves 1.5 units of fund (3 × ½), so the more the better. 35 000 − D > 3 × (3500 +
    // (20 000 − D) ÷ 2) needs D > 11 000: the 90% cap, 18 000, keeps 17 000 ÷ 4500 = 3.78 months
    const short: Scenario = { ...CREDIT, termMonths: 2, ratePct: 0 }
    const withFund = (liquid: number) => ctxOf({ liquid })
    const bigger = alt(evaluate(withFund(35000), short, {}), 'bigger_down_payment')
    expect(bigger?.scenario).toMatchObject({ downPayment: 18000 })
    expect(bigger?.impact.after.emergencyMonths).toBe(3.78)
    // 30 000 needs D > 21 000, above the cap: no down payment keeps the fund
    expect(alt(evaluate(withFund(30000), short, {}), 'bigger_down_payment')).toBeUndefined()
  })

  it('buy_now: “save_up” for the months that keep the emergency fund at 3 months after paying, only when it would drop below', () => {
    // 12 000 − 3 × 3500 = 1500 above the fund; 6000 − 1500 = 4500 to save: ÷ 3 = 1500, all that is saved, by 2031-10 — the
    // trip waits three months and catches up (6000 ÷ 27 = 222.22 a month)
    const e = evaluate(ctxOf(), { kind: 'buy_now', amount: 6000, currency: 'USD' }, {})
    expect(e.alternatives).toEqual([{
      kind: 'save_up', scenario: { kind: 'save_up', amount: 4500, currency: 'USD', targetMonth: '2031-10' },
      purchaseAfterSaving: { price: 6000, additionalSavings: 4500, retainedReserve: 10500, retainedReserveMonths: 3 },
      impact: evaluateScenario(ctxOf(), { kind: 'save_up', amount: 4500, currency: 'USD', targetMonth: '2031-10' }, {}),
    }])
    // 1000 leaves 11 000 ≥ 10 500: nothing to wait for
    expect(evaluate(ctxOf(), { kind: 'buy_now', amount: 1000, currency: 'USD' }, {}).alternatives).toEqual([])
    // the fund is already short: 9000 − 10 500 = −1500, so 1000 + 1500 = 2500 to save: 1.92 → 2 months, 2031-09
    const short = evaluate(ctxOf({ liquid: 9000 }), { kind: 'buy_now', amount: 1000, currency: 'USD' }, {})
    expect(alt(short, 'save_up')?.scenario).toEqual({ kind: 'save_up', amount: 2500, currency: 'USD', targetMonth: '2031-09' })
    // in the scenario currency, rounded up to whole units: 4500 USD × 0.9 = 4050 EUR (6000 USD = 5400 EUR)
    const eur = evaluate(ctxOf(), { kind: 'buy_now', amount: 5400, currency: 'EUR' }, { EUR: 0.9 })
    expect(alt(eur, 'save_up')?.scenario).toEqual({ kind: 'save_up', amount: 4050, currency: 'EUR', targetMonth: '2031-10' })
    // money put aside for a goal: the goal's own projected month already says when; a save_up would compete with it
    expect(evaluate(ctxOf(), { kind: 'buy_now', amount: 6000, currency: 'USD', goalId: 'trip' }, {}).alternatives).toEqual([])
    // the month is searched for the rounded-up amount the alternative names: 1500.10 short → 1501, which 1500.50 a month
    // collects in 2 months, not 1 (the unrounded 1500.10 would fit in 1, and the alternative would then be dropped)
    const tight = ctxOf({ goals: [], incomePerMonth: 5000.5 })
    const rounded = evaluate(tight, { kind: 'buy_now', amount: 3000.1, currency: 'USD' }, {})
    expect(alt(rounded, 'save_up')?.scenario).toEqual({ kind: 'save_up', amount: 1501, currency: 'USD', targetMonth: '2031-09' })
  })

  it('goal: “later_date” when the goal is at risk or unreachable, at the earliest month it is on track with the trip still on track', () => {
    // 12 000 in 6 months needs 2000 > 1500: at risk, reached in 2032-03; by 2032-03 it needs 1500, all that is saved — the trip
    // waits 8 months and catches up (6000 ÷ 22 = 272.73 a month)
    const car: Scenario = { kind: 'goal', name: 'Car', amount: 12000, currency: 'USD', targetDate: '2032-01-31' }
    const e = evaluate(ctxOf(), car, {})
    expect(e.impact.goals).toEqual([{ goalId: 'proposed', name: 'Car', before: null, after: '2032-03', shiftMonths: null, statusBefore: null, statusAfter: 'at_risk', requiredMonthly: 2000,
      firstShare: { month: '2031-08', perMonth: 1500 } }])
    const later = alt(e, 'later_date')
    expect(later?.scenario).toEqual({ ...car, targetDate: '2032-03-31' })
    // the trip does not move
    expect(later?.impact.goals).toEqual([{ goalId: 'proposed', name: 'Car', before: null, after: '2032-03', shiftMonths: null, statusBefore: null, statusAfter: 'on_track', requiredMonthly: 1500,
      firstShare: { month: '2031-08', perMonth: 1500 } }])
    expect(kinds(e)).toEqual(['later_date'])

    // saving up by a month works the same way
    const saveUp = evaluate(ctxOf(), { kind: 'save_up', amount: 12000, currency: 'USD', targetMonth: '2032-01' }, {})
    expect(saveUp.alternatives.map(a => a.scenario)).toEqual([{ kind: 'save_up', amount: 12000, currency: 'USD', targetMonth: '2032-03' }])

    // on track: nothing to move
    expect(evaluate(ctxOf(), { ...car, targetDate: '2032-04-30' }, {}).alternatives).toEqual([])
    // unreachable within the horizon: 1e9 ÷ 1300 = 769 231 months, none offered, nothing thrown
    expect(evaluate(ctxOf(), { ...car, amount: 1e9 }, {}).alternatives).toEqual([])
  })

  it('at most three alternatives in the order smaller, save_up, bigger_down_payment, longer_term; each with its own impact', () => {
    // all four apply (room for a 17 231.26 down payment → 17 000 adds 15 000 ≥ 4000): the longer term is the one left out
    const ctx = ctxOf({ liquid: 30000 })
    const e = evaluate(ctx, BIG_CREDIT, {})
    expect(kinds(e)).toEqual(['smaller', 'save_up', 'bigger_down_payment'])
    // 40 000 ÷ 1300 = 30.77 → 31 months: 2034-02
    expect(alt(e, 'save_up')?.scenario).toMatchObject({ targetMonth: '2034-02' })
    for (const a of e.alternatives) expect(a.impact).toEqual(evaluateScenario(ctx, a.scenario, {}))

    // the payment share is green: no smaller, no longer term, the bigger down payment comes after save_up
    expect(kinds(evaluate(ctx, CREDIT, {}))).toEqual(['save_up', 'bigger_down_payment'])
  })

  it('no savings → no save_up or later_date alternative', () => {
    const none = ctxOf({ incomePerMonth: 3500 })
    // savings of 0.01 a month: 2 000 000 months to save, far beyond the horizon — not offered, nothing thrown
    const tiny = ctxOf({ incomePerMonth: 3500.01, goals: [] })
    for (const ctx of [none, tiny]) {
      const credit = evaluate(ctx, CREDIT, {})
      expect(kinds(credit)).not.toContain('save_up')
      expect(evaluate(ctx, { kind: 'buy_now', amount: 6000, currency: 'USD' }, {}).alternatives).toEqual([])
      expect(evaluate(ctx, { kind: 'goal', name: 'Car', amount: 12000, currency: 'USD', targetDate: '2032-01-31' }, {}).alternatives).toEqual([])
      expect(finiteEverywhere(credit)).toBe(true)
    }
  })

  it('no alternatives without usable numbers: no rate for the amount, no months of cash flow, no income', () => {
    const buy: Scenario = { kind: 'buy_now', amount: 6000, currency: 'USD' }
    expect(evaluate(ctxOf(), { ...BIG_CREDIT, currency: 'XYZ' }, {}).alternatives).toEqual([])
    expect(evaluate(ctxOf({ months: 0, incomePerMonth: 0, expensePerMonth: 0 }), buy, {}).alternatives).toEqual([])
    expect(evaluate(ctxOf({ incomePerMonth: 0, earners: [] }), BIG_CREDIT, {}).alternatives).toEqual([])
  })
})

/**
 * The first real session, 2026-10-25, the demo family (base USD), its overview: income 13 997.21, expenses 11 859.47 with 3067.92
 * of loan payments (savings 2137.74), liquid 58 816.79; the demo goals (src/demo/family.ts): Japan 9000 (3400 saved) by
 * 2027-05-31, the emergency fund 63 000 (32 000 saved) by 2027-12-31, FIRE 2 000 000 (205 000 saved) by 2040-12-31. The mandatory
 * spending and the earners are not from the session (they only feed left-for-living and the stress test). A $35 000 car at 26%
 * over 36 months, 5000 down.
 */
describe('evaluate: the first real session', () => {
  const REAL_TODAY = new Date('2026-10-25T09:00:00Z')
  const GOALS = [
    { id: 'emergency', name: 'Emergency fund (6 months)', target: 63000, current: 32000, target_date: '2027-12-31', emoji: null, currency: 'USD' },
    { id: 'vacation', name: 'Vacation in Japan', target: 9000, current: 3400, target_date: '2027-05-31', emoji: null, currency: 'USD' },
    { id: 'fire', name: 'Financial independence (FIRE) by 55', target: 2000000, current: 205000, target_date: '2040-12-31', emoji: null, currency: 'USD' },
  ]
  const real = (over: Partial<AdvisorContext> = {}) => ctxOf({
    today: REAL_TODAY, month: '2026-09',
    incomePerMonth: 13997.21, expensePerMonth: 11859.47, closed: { income: 13997.21, expense: 11859.47 }, fundExpense: 11859.47, loanPaymentsPerMonth: 3067.92, liquid: 58816.79,
    mandatory: { perMonthBase: 7000, source: 'categories', months: 3, updatedAt: null },
    earners: [{ member: 'Ryan', activePerMonth: 9000 }, { member: 'Annika', activePerMonth: 4997.21 }],
    goals: GOALS,
    ...over,
  })
  const CAR: Scenario = { kind: 'credit', amount: 35000, currency: 'USD', termMonths: 36, ratePct: 26, downPayment: 5000, loanType: 'consumer' }

  it('the car: smaller, saving up once the emergency fund is reached (FIRE, already late, moves), a longer term; a bigger down payment that keeps the fund', () => {
    // Japan needs 5600 ÷ 7 = 800 a month and the fund 31 000 ÷ 14 = 2214.29: more than the 2137.74 saved, so the fund is late,
    // reached in 2028-04 (1879.32 left over that month); then 33 120.68 ÷ 2137.74 = 15.49 → 16 months more: 2029-08.
    // FIRE (with its 8% return inside the plan: 2046-04) waits for the car and moves 10 months
    const e = evaluate(real(), CAR, {})
    expect(kinds(e)).toEqual(['smaller', 'save_up', 'bigger_down_payment'])
    const saveUp = alt(e, 'save_up')
    expect(saveUp?.scenario).toEqual({ kind: 'save_up', amount: 35000, currency: 'USD', targetMonth: '2029-08' })
    expect(saveUp?.impact.goals).toEqual([
      { goalId: 'proposed', name: '', before: null, after: '2029-08', shiftMonths: null, statusBefore: null, statusAfter: 'on_track', requiredMonthly: 1029.41,
        takenAhead: { perMonth: 2137.74, untilMonth: '2028-04' }, firstShare: { month: '2028-04', perMonth: 2070.04 } },
      { goalId: 'fire', name: GOALS[2].name, before: '2046-04', after: '2047-02', shiftMonths: 10, statusBefore: 'at_risk', statusAfter: 'at_risk' },
    ])
    expect(saveUp?.impact.zones.goals).toBe('amber')
    // the payment share (3067.92 + 1208.72) ÷ 13 997.21 = 30.55% is amber: under 30% at 33 000 (28 000 borrowed)
    expect(alt(e, 'smaller')?.scenario).toEqual({ ...CAR, amount: 33000 })
    expect(alt(e, 'smaller')?.impact.zones.debt_payment_ratio).toBe('green')
    // 58 816.79 − D > 3 × (11 859.47 + payment(35 000 − D)) up to D = 21 621.27 → 21 000 (the old rule: 23 000, 2.90 months, amber)
    const bigger = alt(e, 'bigger_down_payment')
    expect(bigger?.scenario).toEqual({ ...CAR, downPayment: 21000 })
    // 37 816.79 ÷ (11 859.47 + 564.07) = 3.04 months
    expect(bigger?.impact.credit?.payment).toBe(564.07)
    expect(bigger!.impact.after.emergencyMonths!).toBeGreaterThan(3)
    expect(bigger?.impact.after.emergencyMonths).toBe(3.04)
    expect(bigger?.impact.zones.emergency_months).toBe('green')
    // the longer term is fourth: left out here; a loan without a rate leaves the payment share unknown, so neither
    // "smaller" nor the longer term is offered
    const rateless = evaluate(real({ rateless: { loans: [{ name: 'Car loan', currency: 'XYZ' }], goals: [] } }), CAR, {})
    expect(kinds(rateless)).toEqual(['save_up', 'bigger_down_payment'])

    // a car as a goal by 2027-06 needs 35 000 ÷ 8 = 4375 a month and gets the 1337.74 Japan leaves until 2027-05: at risk; before
    // the fund's deadline it would need ≥ 2500 a month, so the later date is the save_up's month, after the fund
    const carGoal: Scenario = { kind: 'goal', name: 'Car', amount: 35000, currency: 'USD', targetDate: '2027-06-30' }
    const goal = evaluate(real(), carGoal, {})
    expect(goal.impact.goals[0]).toMatchObject({ goalId: 'proposed', statusAfter: 'at_risk', requiredMonthly: 4375, takenAhead: { perMonth: 800, untilMonth: '2027-05' } })
    expect(goal.alternatives.map(a => a.scenario)).toEqual([{ ...carGoal, targetDate: '2029-08-31' }])
  })

  it('with the emergency fund reached, save_up is honest: the earliest month the car is on track next to Japan', () => {
    // Japan's 800 comes first; the car gets the 1337.74 left for 7 months (9364.18), then all 2137.74: by 2028-05 (19 months)
    // 25 635.82 ÷ 12 = 2136.32 fits, by 2028-04 it does not
    const reached = real({ goals: GOALS.map(g => (g.id === 'emergency' ? { ...g, current: 63000 } : g)) })
    const e = evaluate(reached, CAR, {})
    expect(kinds(e)).toEqual(['smaller', 'save_up', 'bigger_down_payment'])
    const saveUp = alt(e, 'save_up')
    expect(saveUp?.scenario).toEqual({ kind: 'save_up', amount: 35000, currency: 'USD', targetMonth: '2028-05' })
    // Japan keeps its month; FIRE, late already (2045-08 with its 8% return), moves 9 months
    expect(saveUp?.impact.goals).toEqual([
      { goalId: 'proposed', name: '', before: null, after: '2028-05', shiftMonths: null, statusBefore: null, statusAfter: 'on_track', requiredMonthly: 1842.11,
        takenAhead: { perMonth: 800, untilMonth: '2027-05' }, firstShare: { month: '2026-11', perMonth: 1337.74 } },
      { goalId: 'fire', name: GOALS[2].name, before: '2045-08', after: '2046-05', shiftMonths: 9, statusBefore: 'at_risk', statusAfter: 'at_risk' },
    ])
  })

  it('R7, 2026-10-26: a renovation of 20 000 by 2027-12 waits for the emergency fund; its later date moves only FIRE, already late', () => {
    // Japan's 800 and the fund's 1337.74 are all the savings until the fund is reached in 2028-04; the renovation, behind the
    // fund on the same deadline, gets 1879.32 then and 2137.74 after: 2029-01. FIRE, late already (2046-04 with its 8% return),
    // moves 6 months
    const r7 = real({ today: new Date('2026-10-26T09:00:00Z') })
    const reno: Scenario = { kind: 'goal', name: 'Renovation', amount: 20000, currency: 'USD', targetDate: '2027-12-31' }
    const fireMoves = { goalId: 'fire', name: GOALS[2].name, before: '2046-04', after: '2046-10', shiftMonths: 6, statusBefore: 'at_risk', statusAfter: 'at_risk' }
    const e = evaluate(r7, reno, {})
    expect(e.impact.goals).toEqual([
      { goalId: 'proposed', name: 'Renovation', before: null, after: '2029-01', shiftMonths: null, statusBefore: null, statusAfter: 'at_risk',
        requiredMonthly: 1428.57, takenAhead: { perMonth: 2137.74, untilMonth: '2028-04' }, firstShare: { month: '2028-04', perMonth: 2137.74 } },
      fireMoves,
    ])
    expect(e.impact.zones.goals).toBe('amber')
    // the later date: the month it is reached anyway, now on track; Japan and the fund keep their months, FIRE's move is listed
    const later = alt(e, 'later_date')
    expect(later?.scenario).toEqual({ ...reno, targetDate: '2029-01-31' })
    expect(later?.impact.goals).toEqual([
      { goalId: 'proposed', name: 'Renovation', before: null, after: '2029-01', shiftMonths: null, statusBefore: null, statusAfter: 'on_track', requiredMonthly: 740.74,
        // on track, it takes no more than its share: 20 000 − 1879.32 over the ten months to 2029-01 → 2013.41 a month
        takenAhead: { perMonth: 2137.74, untilMonth: '2028-04' }, firstShare: { month: '2028-04', perMonth: 2013.41 } },
      fireMoves,
    ])
    expect(later?.impact.zones.goals).toBe('amber')
    // asked by 2029-12, it is on track as it stands
    expect(evaluate(r7, { ...reno, targetDate: '2029-12-31' }, {}).impact.goals[0]).toMatchObject({ statusAfter: 'on_track', after: '2029-12' })
  })

  it('R7 in a EUR base (amounts at 0.92 EUR per USD): the same verdict, zone, months and alternatives, the amounts scaled', () => {
    const k = 0.92
    const eur = (v: number) => Math.round(v * k * 100) / 100
    const ctx = real({
      today: new Date('2026-10-26T09:00:00Z'), base: 'EUR', incomeCurrencies: ['EUR'],
      incomePerMonth: eur(13997.21), expensePerMonth: eur(11859.47), closed: { income: eur(13997.21), expense: eur(11859.47) },
      loanPaymentsPerMonth: eur(3067.92), liquid: eur(58816.79), mandatory: { perMonthBase: eur(7000), source: 'categories', months: 3, updatedAt: null },
      earners: [{ member: 'Ryan', activePerMonth: eur(9000) }, { member: 'Annika', activePerMonth: eur(4997.21) }],
      goals: GOALS.map(g => ({ ...g, target: eur(g.target), current: eur(g.current), currency: 'EUR' })),
    })
    const usd = evaluate(real({ today: new Date('2026-10-26T09:00:00Z') }), { kind: 'goal', name: 'Renovation', amount: 20000, currency: 'USD', targetDate: '2027-12-31' }, {})
    const e = evaluate(ctx, { kind: 'goal', name: 'Renovation', amount: eur(20000), currency: 'EUR', targetDate: '2027-12-31' }, {})
    const months = (x: typeof e) => x.impact.goals.map(g => [g.goalId, g.before, g.after, g.statusAfter])
    expect(months(e)).toEqual(months(usd))
    expect(e.impact.zones.goals).toBe(usd.impact.zones.goals)
    expect(e.alternatives.map(a => [a.kind, a.scenario.kind === 'goal' ? a.scenario.targetDate : null])).toEqual(usd.alternatives.map(a => [a.kind, a.scenario.kind === 'goal' ? a.scenario.targetDate : null]))
    expect(e.impact.goals[0].requiredMonthly).toBeCloseTo(usd.impact.goals[0].requiredMonthly! * k, 1)
  })

  it('a goal behind FIRE is funded from FIRE\'s month: its later date, with FIRE unmoved; one before FIRE\'s deadline moves it', () => {
    // a boat of 60 000 by 2045-12 comes after FIRE (its deadline 2040-12), which takes all the savings until it is reached with
    // its 8% return in 2046-04: at risk; then 2137.74 a month reach it in 2048-09, which is the later date
    const boat: Scenario = { kind: 'goal', name: 'Boat', amount: 60000, currency: 'USD', targetDate: '2045-12-31' }
    const e = evaluate(real(), boat, {})
    expect(e.impact.goals[0]).toMatchObject({ goalId: 'proposed', statusAfter: 'at_risk', after: '2048-09' })
    expect(e.impact.goals.find(g => g.goalId === 'fire')).toBeUndefined()
    expect(kinds(e)).toEqual(['later_date'])
    const later = alt(e, 'later_date')
    expect(later?.scenario).toEqual({ ...boat, targetDate: '2048-09-30' })
    expect(later?.impact.goals.map(g => [g.goalId, g.after, g.statusAfter])).toEqual([['proposed', '2048-09', 'on_track']])
    // by 2040-11, before FIRE's deadline, it is funded ahead of FIRE, which moves
    const early = evaluate(real(), { ...boat, targetDate: '2040-11-30' }, {})
    expect(early.impact.goals.find(g => g.goalId === 'fire')).toMatchObject({ before: '2046-04', after: '2047-03', statusAfter: 'at_risk' })
  })

  it('no save_up or date alternative is more than thirty years away', () => {
    const today = monthOfToday()
    for (const s of [
      { kind: 'credit', amount: 400000, currency: 'USD', termMonths: 360, ratePct: 10, downPayment: 40000, loanType: 'mortgage' },
      { kind: 'goal', name: 'Boat', amount: 60000, currency: 'USD', targetDate: '2045-12-31' },
      { kind: 'goal', name: 'Yacht', amount: 900000, currency: 'USD', targetDate: '2027-12-31' },
      { kind: 'save_up', amount: 3_000_000, currency: 'USD', targetMonth: '2027-12' },
    ] as Scenario[]) {
      for (const a of evaluate(real(), s, {}).alternatives) {
        const m = a.scenario.kind === 'save_up' ? a.scenario.targetMonth : a.scenario.kind === 'goal' ? a.scenario.targetDate.slice(0, 7) : null
        if (m !== null) expect(monthsApart(today, m)).toBeLessThanOrEqual(360)
      }
    }
    // the mortgage: saving 400 000 would take until 2113 — not offered
    expect(alt(evaluate(real(), { kind: 'credit', amount: 400000, currency: 'USD', termMonths: 360, ratePct: 10, downPayment: 40000, loanType: 'mortgage' }, {}), 'save_up')).toBeUndefined()
  })

  it('a loan moves the goals only while it is paid: a 1000 credit over 12 months moves FIRE by about its own cost', () => {
    // 88.85 a month for 12 months is 1066.19, half a month of the 2137.74 saved: FIRE moves a month at most
    const e = evaluate(real(), { kind: 'credit', amount: 1000, currency: 'USD', termMonths: 12, ratePct: 12, downPayment: 0, loanType: 'consumer' }, {})
    for (const g of e.impact.goals) expect(g.shiftMonths ?? Infinity).toBeLessThanOrEqual(1)
    // a month later is less than a quarter: the goals zone stays green
    expect(e.impact.zones.goals).toBe('green')
    // the payment still lowers the savings in the key numbers, for as long as it is paid
    expect(e.impact.after.savingsPerMonth).toBe(r2(2137.74 - calcMonthlyPayment(1000, 12, 12)))
  })

  it('takenAhead names no month when the nearer goal that takes the savings is never reached', () => {
    const huge = real({ goals: [{ id: 'big', name: 'Big', target: 5e9, current: 0, target_date: '2027-01-31', emoji: null, currency: 'USD' }] })
    const e = evaluate(huge, { kind: 'goal', name: 'Bike', amount: 1000, currency: 'USD', targetDate: '2027-06-30' }, {})
    expect(e.impact.goals[0]).toMatchObject({ goalId: 'proposed', statusAfter: 'unreachable', takenAhead: { perMonth: 2137.74, untilMonth: null } })
  })
})

describe('contextGaps and currentNumbers', () => {
  it('contextGaps + scenario gaps equal the old dataGaps for every existing gap test', () => {
    const variants = [
      ctxOf(), ctxOf({ months: 2 }), ctxOf({ coverage: [90, 79.5, null] }), ctxOf({ goals: [] }),
      ctxOf({ mandatory: null }), ctxOf({ mandatory: { perMonthBase: 1800, source: 'manual', months: 0, updatedAt: '2030-12-20' } }),
      ctxOf({ months: 0, incomePerMonth: 0, expensePerMonth: 0 }),
      ctxOf({ goals: [], rateless: { loans: [{ name: 'Car loan', currency: 'XYZ' }], goals: [{ id: 'boat', name: 'Boat', currency: 'XYZ' }] } }),
    ]
    for (const ctx of variants) {
      const scenarioCodes = new Set(['no_rate', 'unknown_goal'])
      for (const scenario of [CREDIT, { ...CREDIT, currency: 'XYZ' }, { kind: 'buy_now', amount: 100, currency: 'USD', goalId: 'nope' } as Scenario]) {
        const gaps = evaluateScenario(ctx, scenario, {}).gaps
        expect(gaps.filter(g => !scenarioCodes.has(g.code))).toEqual(contextGaps(ctx))
      }
    }
  })

  it('currentNumbers are the rounded "now" numbers of every evaluation', () => {
    const ctx = ctxOf()
    expect(currentNumbers(ctx)).toEqual(evaluateScenario(ctx, CREDIT, {}).now)
    expect(currentNumbers(ctx)).toEqual({ savingsPerMonth: 1500, leftForLiving: 2600, debtPaymentPct: 12, emergencyMonths: 3.43, liquid: 12000 })
  })
})

describe('the year as the baseline, the last three months as the recent trend', () => {
  const year = { months: 12, incomePerMonth: 5000, expensePerMonth: 3500 }
  const drop = (expense: number) => contextGaps(ctxOf({ ...year, recent: { months: 3, incomePerMonth: 5000, expensePerMonth: expense } })).find(g => g.code === 'recent_drop')

  it('recent_drop: the last three months saved more than 10 points of the year’s income less than the year', () => {
    // the year saves 1500; the recent 900 is 600 lower, over 500 (10% of 5000)
    expect(drop(4100)).toEqual({ code: 'recent_drop', params: { recentPerMonth: 900, yearPerMonth: 1500 }, affects: ['savingsPerMonth', 'goals'] })
    // exactly 500 lower is not a drop worth saying
    expect(drop(4000)).toBeUndefined()
    // no year longer than the recent months: nothing to compare
    expect(contextGaps(ctxOf({ months: 3, recent: { months: 3, incomePerMonth: 5000, expensePerMonth: 4900 } })).map(g => g.code)).not.toContain('recent_drop')
  })

  it('no_earner is judged on the recent months the earners come from: no recent month is not a missing salary', () => {
    const codes = (recent: { months: number; incomePerMonth: number; expensePerMonth: number }) => contextGaps(ctxOf({ ...year, recent, earners: [] })).map(g => g.code)
    expect(codes({ months: 0, incomePerMonth: 0, expensePerMonth: 0 })).not.toContain('no_earner')
    expect(codes({ months: 3, incomePerMonth: 400, expensePerMonth: 300 })).toContain('no_earner')
  })

  it('the stress test weighs the recent income the earners come from, not the year’s', () => {
    // Robin's 3500 stops: the recent 4000 leaves 500 against mandatory 1800 + payments 600: 12 000 ÷ 1900 = 6.32 months
    const i = evaluateScenario(ctxOf({ ...year, recent: { months: 3, incomePerMonth: 4000, expensePerMonth: 3500 } }), { kind: 'buy_now', amount: 0.01, currency: 'USD' }, {})
    expect(i.stress).toEqual({ earner: 'Robin', months: 6.32 })
    // the savings are the year's: 5000 − 3500
    expect(i.now.savingsPerMonth).toBe(1500)
  })
})

describe('live purchase explanation regressions', () => {
  const family = () => ctxOf({ base: 'RUB', liquid: 2400000, incomePerMonth: 500000,
    expensePerMonth: 300000, closed: { income: 500000, expense: 300000 }, fundExpense: 300000,
    loanPaymentsPerMonth: 0, goals: [] })

  it('exposes the cash shortfall instead of implying a zero balance makes the purchase possible', () => {
    const result = evaluate(family(), { kind: 'buy_now', amount: 2500000, currency: 'RUB' }, {})
    expect(result.impact.cashFunding).toEqual({ requiredNow: 2500000, shortfall: 100000 })
    expect(result.alternatives[0].purchaseAfterSaving).toEqual({
      price: 2500000, additionalSavings: 1000000, retainedReserve: 900000, retainedReserveMonths: 3,
    })
    expect(result.alternatives[0].scenario.amount).toBe(1000000)
  })

  it('converts the purchase explanation into base currency and does not attach it to ordinary saving', () => {
    const result = evaluate(family(), { kind: 'buy_now', amount: 25000, currency: 'USD' }, { RUB: 100 })
    expect(result.impact.cashFunding?.shortfall).toBe(100000)
    expect(result.alternatives[0].purchaseAfterSaving?.additionalSavings).toBe(1000000)
    expect(evaluate(family(), { kind: 'save_up', amount: 1000000, currency: 'RUB', targetMonth: '2032-01' }, {}).impact.cashFunding).toBeUndefined()
    expect(evaluate(family(), { kind: 'buy_now', amount: 25000, currency: 'EUR' }, {}).impact.cashFunding).toBeUndefined()
  })

  it('reports an unaffordable down payment and zero shortfall when cash covers a purchase', () => {
    expect(evaluateScenario(family(), { kind: 'credit', amount: 3000000, currency: 'RUB', downPayment: 2500000, ratePct: 9, termMonths: 36, loanType: 'consumer' }, {}).cashFunding)
      .toEqual({ requiredNow: 2500000, shortfall: 100000 })
    expect(evaluateScenario(family(), { kind: 'buy_now', amount: 1000000, currency: 'RUB' }, {}).cashFunding?.shortfall).toBe(0)
  })
})
