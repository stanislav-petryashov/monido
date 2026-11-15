// The demo family's goals on 12.11.2026 (the mock-up's figures): the snapshot the Goals page tests draw, its plan and
// forecast computed by the domain itself
import { allocateGoals, unknownSavingsPlan } from '../../src/domain/goals'
import { fireSummary } from '../../src/domain/snapshot'
import type { CashflowRowBase, FinanceSnapshot, GoalRow } from '../../src/domain/types'
import { makeSnapshot } from './snapshot'

export const GOALS_TODAY = new Date('2026-11-12T09:00:00Z')
export const DEMO_SAVING = 2140.76

const goal = (id: string, name: string, target: number, current: number, target_date: string, currency = 'USD'): GoalRow =>
  ({ id, name, target, current, target_date, emoji: null, currency })

export const DEMO_GOALS: GoalRow[] = [
  goal('vacation', 'Trip to Japan', 9000, 3400, '2027-05-31'),
  goal('emergency', 'Emergency fund (6 months)', 63000, 32000, '2027-12-31'),
  goal('fire', 'Financial independence by 55', 2000000, 205000, '2040-12-31'),
]

/** July −527.87, August 3366.59, September 3583.57: their mean is the saving */
const NETS: [string, number][] = [['2026-07', -527.87], ['2026-08', 3366.59], ['2026-09', 3583.57]]
const row = ([month, net]: [string, number]): CashflowRowBase =>
  ({ month, bank: 'Bank', member: 'Robin', currency: 'USD', active: 10000, passive: 0, expense: 10000 - net, activeBase: 10000, passiveBase: 0, expenseBase: 10000 - net })

/** The Goals snapshot: `track` false — income and expenses not tracked; `goals` in USD unless one says otherwise (no rate then) */
export function goalsSnapshot({ track = true, goals = DEMO_GOALS, saving = DEMO_SAVING }: { track?: boolean; goals?: GoalRow[]; saving?: number } = {}): FinanceSnapshot {
  const base = makeSnapshot()
  const inUsd = goals.filter(g => g.currency === 'USD')
  const plan = allocateGoals(goals, saving, GOALS_TODAY, {}, 'USD')
  const fire = fireSummary(inUsd, {}, 'USD', track ? saving : null, GOALS_TODAY, [])
  return makeSnapshot({
    trackFlows: track,
    asOf: { ...base.asOf, closedMonth: '2026-09', today: '2026-11-12' },
    cashflow: { ...base.cashflow, rows: track ? NETS.map(row) : [], avg3m: { ...base.cashflow.avg3m, netPerMonth: track ? saving : 0 } },
    goals: {
      items: goals.map(g => ({ ...g, targetBase: g.currency === 'USD' ? g.target : null, currentBase: g.currency === 'USD' ? g.current : null })),
      plan: track ? plan : unknownSavingsPlan(plan),
      // the snapshot's own growth figures beside the plan's forecast
      fire: fire && { ...fire, actualCagr: 0.1279, requiredCagr: 0.1756 },
    },
  })
}
