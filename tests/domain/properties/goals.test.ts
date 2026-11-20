// Properties of the goal plan (allocateGoals, src/domain/goals.ts): the monthly savings are shared, never exceeded, and
// no goal takes more than it still needs.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { monthOf } from '../../../src/domain/dates'
import { convert } from '../../../src/domain/fx'
import { allocateGoals } from '../../../src/domain/goals'
import type { GoalRow } from '../../../src/domain/types'
import { cents, currency, month, rates, runs } from '../../helpers/arbitraries'

const RUNS = runs(100)
const TODAY = new Date('2031-05-15T12:00:00Z')
const BASE = 'USD'

/** Goals without the independence one (its value also grows at a return), deadlines from a year back to 15 years ahead */
const goals = fc.uniqueArray(fc.record({
  id: fc.constantFrom('car', 'flat', 'trip', 'school', 'reserve'), target: cents(100, 200_000), done: fc.integer({ min: 0, max: 120 }),
  deadline: month().filter(m => m >= '2030-05' && m <= '2046-05'), currency: currency(),
}), { maxLength: 5, selector: g => g.id }).map(list => list.map((g): GoalRow => ({
  id: g.id, name: g.id, target: g.target, current: Math.round(g.target * g.done) / 100, target_date: `${g.deadline}-28`, emoji: null, currency: g.currency,
})))

describe('allocateGoals', () => {
  it('each month the goals together take at most the savings, never a negative share', () => {
    fc.assert(fc.property(goals, cents(-2_000, 10_000), rates(), (gs, savings, r) => {
      const plan = allocateGoals(gs, savings, TODAY, r, BASE)
      const longest = Math.max(0, ...plan.allocations.map(a => a.shares.length))
      for (let n = 0; n < longest; n++) {
        const taken = plan.allocations.reduce((s, a) => s + (a.shares[n] ?? 0), 0)
        expect(taken).toBeLessThanOrEqual(Math.max(0, savings) * (1 + 1e-9) + 1e-9)
      }
      for (const a of plan.allocations) {
        expect(a.shares.every(v => v >= 0 && Number.isFinite(v))).toBe(true)
        expect(a.allocBase).toBe(a.shares[0] ?? 0)
      }
    }), RUNS)
  })

  it('no goal takes more than it still needs; a reached one is done or has its month', () => {
    fc.assert(fc.property(goals, cents(0, 10_000), rates(), (gs, savings, r) => {
      for (const a of allocateGoals(gs, savings, TODAY, r, BASE).allocations) {
        const target = convert(a.goal.target, a.goal.currency, BASE, r)!, current = convert(a.goal.current, a.goal.currency, BASE, r)!
        const need = Math.max(0, target - current)
        const taken = a.shares.reduce((s, v) => s + v, 0)
        expect(taken).toBeLessThanOrEqual(need * (1 + 1e-9) + 1e-9)
        expect(a.status === 'done').toBe(current >= target)
        const deadline = monthOf(a.goal.target_date)
        if (a.status === 'on_track') expect(a.projectedDate! <= deadline).toBe(true)
        if (a.status === 'at_risk') expect(a.projectedDate! > deadline).toBe(true)
        if (a.status === 'unreachable' || a.status === 'done') expect(a.projectedDate).toBeNull()
      }
    }), RUNS)
  })
})
