// Proposal views for the Advisor page's tests: a credit proposal by Ryan with Annika and Mila voting, an accepted goal
// proposal, a fake council server over fetch. The numbers are fixed by hand, so the expected texts can be written out.
import type { Scenario } from '../../../src/domain/advisor'
import type { Alternative, Evaluation, GoalShift, Impact, KeyNumbers } from '../../../src/domain/advisorImpact'
import type { AdvisorSettings, ProposalVersionView, ProposalView, ProposalVoteView, ProposalsView, SpendingRecords } from '../../../src/domain/api'
import { jsonResponse as json } from '../../helpers/http'

export const RYAN = 1
export const ANNIKA = 2
export const MILA = 3
const AT = '2031-10-02T09:00:00.000Z'

export const CREDIT: Extract<Scenario, { kind: 'credit' }> = { kind: 'credit', amount: 30000, currency: 'USD', termMonths: 60, ratePct: 9, downPayment: 5000, loanType: 'consumer' }

export const numbers = (n: Partial<KeyNumbers>): KeyNumbers =>
  ({ savingsPerMonth: 900, leftForLiving: 2400.5, debtPaymentPct: 12.34, emergencyMonths: 6.2, liquid: 20000, ...n })

export function impactOf(overrides: Partial<Impact> = {}): Impact {
  return {
    scenario: CREDIT, amountBase: 30000,
    now: numbers({}), after: numbers({ savingsPerMonth: 381, leftForLiving: 1881.54, debtPaymentPct: 21.5, emergencyMonths: 5.04, liquid: 15000 }),
    credit: { principal: 25000, payment: 518.96, overpayment: 6137.6 },
    monthsToSave: 34,
    goals: [{ goalId: 'g1', name: 'Vacation', before: '2032-03', after: '2032-06', shiftMonths: 3, statusBefore: 'on_track', statusAfter: 'at_risk' }],
    incomeShares: [], stress: null, currencyRisk: null, zones: {}, risk: 'caution', gaps: [],
    ...overrides,
  }
}

const SMALLER: Alternative = {
  kind: 'smaller', scenario: { ...CREDIT, amount: 24000 },
  impact: impactOf({ after: numbers({ debtPaymentPct: 18.2, emergencyMonths: 5.3 }) }),
}
export const EVALUATION: Evaluation = { impact: impactOf(), alternatives: [SMALLER] }

type Vote = Pick<ProposalVoteView, 'vote' | 'settled'> & { comment?: string | null }
export const votes = (annika: Vote | null, mila: Vote | null): ProposalVoteView[] => [
  { userId: RYAN, member: 'Ryan', vote: 'agree', settled: true, comment: null, votedAt: AT },
  { userId: ANNIKA, member: 'Annika', vote: annika?.vote ?? null, settled: annika?.settled ?? false, comment: annika?.comment ?? null, votedAt: annika ? AT : null },
  { userId: MILA, member: 'Mila', vote: mila?.vote ?? null, settled: mila?.settled ?? false, comment: mila?.comment ?? null, votedAt: mila ? AT : null },
]

export function versionOf(overrides: Partial<ProposalVersionView> = {}): ProposalVersionView {
  return {
    id: 7, number: 1, title: 'A car on credit', question: 'Shall we buy the car?', scenario: CREDIT, evaluation: EVALUATION, baseCurrency: 'USD',
    verdict: { risk: 'caution', recommended: 'smaller', reason: 'The payment fits, but the fund gets thin' },
    createdAt: AT, votes: votes(null, null), changes: { scenario: [], numbers: [] },
    ...overrides,
  }
}

export function viewOf(overrides: Partial<ProposalView> = {}): ProposalView {
  return {
    id: 3, type: 'credit', status: 'open', author: { userId: RYAN, member: 'Ryan' },
    createdAt: AT, deadlineAt: '2031-10-16T09:00:00.000Z', decidedAt: null, baseCurrency: 'USD', goal: null,
    current: versionOf(), previous: [],
    you: { voter: true, vote: null, settled: false, author: false },
    ...overrides,
  }
}

/**
 * Reference case R7 of the demo family: a renovation, 20,000 USD by December 2027. The new goal is late (January 2029) and
 * gets money only from April 2028, when the nearer goals are reached, 2137.74 a month; FIRE moves 10 months; the payment
 * share, the money left for living and the fund stay as they are. The tool's alternative: a later date, January 2029, on
 * track, from April 2028 at its share of 2013.41 a month.
 */
export const R7_SCENARIO: Extract<Scenario, { kind: 'goal' }> = { kind: 'goal', name: 'Renovation', amount: 20000, currency: 'USD', targetDate: '2027-12-31' }
const R7_SAME = numbers({ savingsPerMonth: 2137.74, leftForLiving: 6326.1, debtPaymentPct: 21.9, emergencyMonths: 5 })
const R7_FIRE: GoalShift = { goalId: 'fire', name: 'Financial independence (FIRE) by 55', before: '2041-03', after: '2042-01', shiftMonths: 10, statusBefore: 'at_risk', statusAfter: 'at_risk' }
const R7_AHEAD = { perMonth: 2137.74, untilMonth: '2028-04' }
export const R7_PROPOSED: GoalShift = {
  goalId: 'proposed', name: 'Renovation', before: null, after: '2029-01', shiftMonths: null, statusBefore: null, statusAfter: 'at_risk',
  requiredMonthly: 1428.57, takenAhead: R7_AHEAD, firstShare: { month: '2028-04', perMonth: 2137.74 },
}
const R7_LATER: Alternative = {
  kind: 'later_date', scenario: { ...R7_SCENARIO, targetDate: '2029-01-31' },
  impact: impactOf({
    scenario: { ...R7_SCENARIO, targetDate: '2029-01-31' }, amountBase: 20000, credit: null, now: R7_SAME, after: R7_SAME,
    goals: [{ ...R7_PROPOSED, statusAfter: 'on_track', requiredMonthly: 740.74, firstShare: { month: '2028-04', perMonth: 2013.41 } }, R7_FIRE],
  }),
}
export const R7_EVALUATION: Evaluation = {
  impact: impactOf({ scenario: R7_SCENARIO, amountBase: 20000, credit: null, now: R7_SAME, after: R7_SAME, goals: [R7_PROPOSED, R7_FIRE], monthsToSave: 10 }),
  alternatives: [R7_LATER],
}
export const R7_VERDICT: ProposalVersionView['verdict'] = { risk: 'caution', recommended: 'later_date', reason: 'The renovation comes later than asked' }

const GOAL_SCENARIO: Scenario = { kind: 'goal', name: 'New kitchen', amount: 12000, currency: 'EUR', targetDate: '2032-06-15' }
/** An accepted goal proposal by Annika, decided on 2031-10-05, agreed by all three */
export const acceptedGoal = (overrides: Partial<ProposalView> = {}): ProposalView => viewOf({
  id: 5, type: 'goal', status: 'accepted', author: { userId: ANNIKA, member: 'Annika' }, decidedAt: '2031-10-05T10:00:00.000Z',
  current: versionOf({
    id: 11, title: 'A new kitchen', question: 'Shall we save for the kitchen?', scenario: GOAL_SCENARIO,
    // no loan: the payment share stays as it is
    evaluation: { impact: impactOf({ scenario: GOAL_SCENARIO, credit: null, after: numbers({ savingsPerMonth: 381, leftForLiving: 1881.54, emergencyMonths: 5.04, liquid: 15000 }) }), alternatives: [] },
    verdict: { risk: 'ok', recommended: null, reason: 'It fits the savings' },
    votes: votes({ vote: 'agree', settled: true, comment: 'Finally' }, { vote: 'agree', settled: true }),
  }),
  you: { voter: true, vote: 'agree', settled: true, author: false },
  ...overrides,
})

export const SETTINGS: AdvisorSettings = { decideDays: 14, remindDays: 3 }

export const pageOf = (proposals: ProposalView[], overrides: Partial<ProposalsView> = {}): ProposalsView =>
  ({ available: true, proposals, settings: SETTINGS, canCreateGoal: true, ...overrides })

export interface Call { url: string; method: string; body?: unknown }

/**
 * A fake council server over fetch: GET /api/advisor/proposals answers `state`; a write to /api/advisor/… is recorded and
 * answered by `onWrite` (the new state, a Response for a refusal; none — the same state). Also the goals and currencies
 * rows, the family settings, the spending records the page reads. Returns the writes seen.
 */
export function stubCouncil(initial: ProposalsView, {
  onWrite, goals = [], spending,
}: {
  onWrite?: (call: Call, state: ProposalsView) => ProposalsView | Response | unknown
  goals?: Record<string, unknown>[]
  spending?: SpendingRecords
} = {}) {
  let state = initial
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method === 'GET') {
      if (url === '/api/advisor/proposals') return json(state)
      if (url === '/api/advisor/connector') return json({ available: false, reason: 'auth_mode', mcpUrl: null, connected: [] })
      if (url === '/api/admin/goals') return json({ rows: goals, columns: ['id', 'name', 'target', 'current', 'target_date', 'currency', 'emoji'] })
      if (url === '/api/admin/currencies') return json({ rows: [{ rowid: 1, code: 'EUR' }, { rowid: 2, code: 'USD' }], columns: ['code'] })
      if (url === '/api/settings') return json({ language: 'en-US', currency: 'USD' })
      if (url === '/api/spending' && spending) return json(spending)
      if (url.startsWith('/api/snapshot')) return json({ error: { code: 'not_found' } }, 404)
      return json({ error: { code: 'not_found' } }, 404)
    }
    const call: Call = { url, method, ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}) }
    calls.push(call)
    const answer = onWrite ? onWrite(call, state) : state
    if (answer instanceof Response) return answer
    if (url === '/api/advisor/settings') return json(answer)
    if (url.startsWith('/api/advisor/')) { state = answer as ProposalsView; return json(state) }
    return json(answer)
  }))
  return calls
}
