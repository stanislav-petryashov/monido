import { statusLine } from '../../../src/pages/goals/text'
import type { GoalLine } from '../../../src/pages/goals/view'
import type { GoalAllocation } from '../../../src/domain/types'
import { loadLocaleChunk, t } from '../../../src/i18n/client'

beforeAll(() => loadLocaleChunk('planning'))
const lineWith = (alloc: Partial<GoalAllocation>): GoalLine => ({
  id: 'trip', name: 'Trip', isFire: false, order: 1, steps: null, atDeadline: null,
  item: { id: 'trip', name: 'Trip', target: 1000, current: 0, target_date: '2030-06-30', emoji: null, currency: 'USD', targetBase: 1000, currentBase: 0 },
  alloc: { goal: { id: 'trip', name: 'Trip', target: 1000, current: 0, target_date: '2030-06-30', emoji: null, currency: 'USD' }, progressPct: 0, monthsToDeadline: 40, requiredMonthlyBase: 25, allocBase: 0, shares: [], status: 'unreachable', projectedDate: null, ...alloc },
})

it('says why a goal is never reached, each reason its own words; without a reason, the general line', () => {
  expect(statusLine(t, lineWith({ unreachableReason: 'no_savings' })).text).toBe('not reached: nothing was saved in the last closed months')
  expect(statusLine(t, lineWith({ unreachableReason: 'taken_ahead' })).text).toBe('not reached: goals with nearer deadlines take all the savings')
  expect(statusLine(t, lineWith({ unreachableReason: 'over_horizon' })).text).toBe('not reached within 100 years at the current savings')
  expect(statusLine(t, lineWith({})).text).toBe('not reached at the current savings')
  expect(statusLine(t, lineWith({ unreachableReason: 'no_savings' })).tone).toBe('gl-late')
})
