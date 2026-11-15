import { i18n } from '../../src/i18n/client'
import { goalsClient } from '../../src/modules/goals/client'
import { makeSnapshot } from '../helpers/snapshot'

describe('the goals to-do', () => {
  const todo = goalsClient.overview!.todo!
  const money = (v: number) => `$${v}`
  const goal = { id: 'roof', name: 'Roof', target: 50000, current: 1000, target_date: '2033-05-31', emoji: null, currency: 'USD' }
  const allocation = { goal, progressPct: 2, monthsToDeadline: 24, requiredMonthlyBase: 2000, allocBase: 0, shares: [], status: 'at_risk' as const, projectedDate: null }

  it('names the shortfall while the savings are known', () => {
    const base = makeSnapshot()
    const s = makeSnapshot({ goals: { ...base.goals, plan: { allocations: [allocation], totalRequiredBase: 2000, monthlySavingsBase: 500, surplusBase: -1500 } } })
    expect(todo(s, i18n.t, money)).toEqual([expect.objectContaining({ key: 'goals-short', to: '/goals' })])
  })

  it('has no "short by" row while income and expenses are not tracked (the savings are unknown)', () => {
    const base = makeSnapshot()
    const plan = { allocations: [{ ...allocation, status: null }], totalRequiredBase: 2000, monthlySavingsBase: null, surplusBase: null }
    expect(todo(makeSnapshot({ trackFlows: false, goals: { ...base.goals, plan } }), i18n.t, money)).toEqual([])
  })
})
