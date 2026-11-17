// The Goals page's model: each goal with what the plan (the snapshot's goals.plan, computed by the domain) says about it,
// in the plan's order, the goals without a rate last. Selection, finding and figures read it; nothing here sums rows.
import { AVERAGE_MONTHS } from '../../domain/cashflow'
import { isoDate, monthOf, shiftMonth } from '../../domain/dates'
import { fireValues, isFireGoal, shareSteps } from '../../domain/goals'
import type { FinanceSnapshot, GoalAllocation, GoalItem, GoalsPlan, Rates } from '../../domain/types'
import { cashflowView } from '../../lib/snapshotSelectors'

export interface GoalLine {
  id: string
  name: string
  item: GoalItem
  /** The plan's allocation; null — the goal's currency has no rate, so it is not in the plan */
  alloc: GoalAllocation | null
  isFire: boolean
  /** The place in the plan, 1 the nearest deadline; null — not in the plan */
  order: number | null
  /** What the plan gives it now and from when it gets more (shareSteps); null — the savings are unknown or not in the plan */
  steps: ReturnType<typeof shareSteps> | null
  /** What it holds by its deadline month on the plan (independence: with its return); null — unknown */
  atDeadline: number | null
}

/** The goals plan uses the snapshot's day, independent of the browser clock. */
export const planToday = (s: FinanceSnapshot): Date => new Date(`${s.asOf.today}T12:00:00Z`)

/** The plan's month 0: the snapshot's month */
export const thisMonth = (s: FinanceSnapshot): string => monthOf(isoDate(planToday(s)))

/**
 * The goals in the plan's order, then the ones outside it (no rate). `plan` — another run of the plan (the page's "what if
 * we saved X a month"); the independence goal's amount by its deadline is then grown at the family's expected return on that plan's shares,
 * as fireSummary does for the snapshot's.
 */
export function goalLines(s: FinanceSnapshot, month: string, plan: GoalsPlan = s.goals.plan): GoalLine[] {
  const known = plan.monthlySavingsBase !== null
  const fire = s.goals.fire
  const own = plan === s.goals.plan
  const inPlan = plan.allocations.map((a, i): GoalLine => {
    const item = s.goals.items.find(g => g.id === a.goal.id) ?? { ...a.goal, targetBase: null, currentBase: null }
    const isFire = fire?.goalId === a.goal.id
    const current = item.currentBase ?? 0
    return {
      id: a.goal.id, name: a.goal.name, item, alloc: a, isFire, order: i + 1,
      steps: known ? shareSteps(a.shares, month) : null,
      atDeadline: !known ? null
        : isFire ? (own ? fire?.atDeadlineBase ?? null : fireValues(current, a.shares, s.expectedReturn, a.monthsToDeadline)[a.monthsToDeadline])
          : fireValues(current, a.shares, 0, a.monthsToDeadline)[a.monthsToDeadline],
    }
  })
  const outside = s.goals.items.filter(g => !inPlan.some(l => l.id === g.id))
    .map((item): GoalLine => ({ id: item.id, name: item.name, item, alloc: null, isFire: isFireGoal(item), order: null, steps: null, atDeadline: null }))
  return [...inPlan, ...outside]
}

/** The goal the page opens on: the first one off track (late or never reached), else the first */
export function defaultGoal(lines: GoalLine[]): string | null {
  const off = lines.find(l => l.alloc?.status === 'at_risk' || l.alloc?.status === 'unreachable')
  return (off ?? lines[0])?.id ?? null
}

/** The closed months the saving is the average of (`cashflow.avg3m`: the last AVERAGE_MONTHS up to the closed month, a rateless month left out), with each month's net */
export function averageMonths(s: FinanceSnapshot): { month: string; net: number }[] {
  const end = s.asOf.closedMonth
  if (!end || !s.trackFlows) return []
  const start = shiftMonth(end, -(AVERAGE_MONTHS - 1))
  return cashflowView(s, '1y').monthlyTrend.flatMap(r => (r.month >= start && r.month <= end && r.net !== null ? [{ month: r.month, net: r.net }] : []))
}

/**
 * The rates the page knows today, per USD: the base currency's (`s.rates`, 1 for USD) and, through it, each goal currency's
 * from the goal's own base amounts. A draft in another currency has none: its preview says so.
 */
export function knownRates(s: FinanceSnapshot): Rates {
  const base = s.baseCurrency === 'USD' ? 1 : s.rates?.perUsd
  if (base === undefined) return {}
  const known = s.goals.items.filter(g => g.targetBase !== null && g.targetBase > 0 && g.target > 0)
  return Object.fromEntries([[s.baseCurrency, base], ...known.map(g => [g.currency, base * (g.target / g.targetBase!)])])
}
