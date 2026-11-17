// The advisor's view of the family as it is now, before any scenario: the 3-month averages, the key numbers, the loans, the goals and
// their plan, the income shares and sources, the health metrics and what the data lack. Numbers and codes only, no text.
import { advisorContext } from './advisor'
import { contextGaps, currentNumbers, incomeSharesOf, type Gap, type Impact, type KeyNumbers } from './advisorImpact'
import { averagedRows, PLAN_MONTHS } from './cashflow'
import { round2 } from './fx'
import { HEALTH_KEYS } from './health'
import type { MandatorySpending } from './spending'
import type { CategoryFlow, FinanceSnapshot, GoalStatus, HealthKey, Zone } from './types'

export interface FamilyOverview {
  baseCurrency: string
  /** The last closed month with cash flow; null — none */
  closedMonth: string | null
  /** Closed months with flows in the 3-month window */
  monthsOfData: number
  /** The rounded key numbers now, and the 3-month averages (expenses include the loan payments) with the loans' scheduled payments, per month */
  now: KeyNumbers & { incomePerMonth: number; expensePerMonth: number; loanPaymentsPerMonth: number }
  mandatory: MandatorySpending | null
  loans: { name: string; member: string; type: string; currency: string; balance: number; balanceBase: number | null; ratePct: number; payment: number; paymentBase: number | null }[]
  /** `status` and `projectedDate` come from the goals plan; null for a goal the plan does not hold (no rate), and for every goal while the savings are unknown (Cash flow off, or no closed month of it) — then the plan would read "unreachable" for want of data */
  goals: { id: string; name: string; targetBase: number | null; currentBase: number | null; targetDate: string; status: GoalStatus | null; projectedDate: string | null }[]
  incomeShares: Impact['incomeShares']
  /**
   * Income by category over the 12-month window (the income a month's), as an average a month (Σ ÷ monthsOfData, at least 1), largest first;
   * `perMonthBase` null — a line has no rate. Empty without income lines in the window
   */
  incomeSources: { name: string; flow: Exclude<CategoryFlow, 'expense'>; oneOff: boolean; perMonthBase: number | null }[]
  /**
   * The income a month the categories leave unallocated, over the same window: a month with lines gives its
   * remainder, a month without them its whole income. Null — no closed month, a rate is missing, or every month of the window has a rateless row
   */
  unallocatedIncomeBase: number | null
  /** The metrics of the report in HEALTH_KEYS order; empty without the report (no balances yet) */
  health: { key: HealthKey; value: number | null; zone: Zone | null }[]
  gaps: Gap[]
}

/** The window's income sources and unallocated income, each an average a month over `divisor` months: the months avg12m reads, a month with a rateless row left out, so they add up to the income a month. */
function incomeSourcesOf(s: FinanceSnapshot, month: string | null, divisor: number): Pick<FamilyOverview, 'incomeSources' | 'unallocatedIncomeBase'> {
  if (month === null) return { incomeSources: [], unallocatedIncomeBase: null }
  const averaged = new Set(averagedRows(s.cashflow.rows, month, PLAN_MONTHS).map(r => r.month))
  // every month of the window has a row without a rate: no month to average, the income is unknown, not 0
  if (!averaged.size) return { incomeSources: [], unallocatedIncomeBase: null }
  const inWindow = (m: string) => averaged.has(m)
  const months = s.income.months.filter(m => inWindow(m.month))
  const sources = new Map<number, { name: string; flow: Exclude<CategoryFlow, 'expense'>; oneOff: boolean; sum: number | null }>()
  for (const m of months) {
    for (const c of m.categories) {
      if (c.flow === 'expense') continue
      const entry = sources.get(c.categoryId) ?? { name: c.name, flow: c.flow, oneOff: c.oneOff, sum: 0 }
      entry.sum = entry.sum === null || c.amountBase === null ? null : entry.sum + c.amountBase
      sources.set(c.categoryId, entry)
    }
  }
  const incomeSources = [...sources.values()]
    .map(({ name, flow, oneOff, sum }) => ({ name, flow, oneOff, perMonthBase: sum === null ? null : round2(sum / divisor) }))
    .sort((a, b) => (b.perMonthBase ?? -1) - (a.perMonthBase ?? -1) || a.name.localeCompare(b.name))

  // a month with lines has its remainder; a month with cash flow but no lines is all unallocated
  let rest: number | null = 0
  const withLines = new Set(months.map(m => m.month))
  for (const m of months) rest = rest === null || m.unallocatedBase === null ? null : rest + m.unallocatedBase
  for (const r of s.cashflow.rows) {
    if (r.loan || !inWindow(r.month) || withLines.has(r.month)) continue
    rest = rest === null || r.activeBase === null || r.passiveBase === null ? null : rest + r.activeBase + r.passiveBase
  }
  return { incomeSources, unallocatedIncomeBase: rest === null ? null : round2(rest / divisor) }
}

/** The family's overview from a snapshot: reads only the snapshot and `advisorContext`, nothing is recomputed from raw rows but the window's unallocated income. */
export function familyOverview(s: FinanceSnapshot, today: Date): FamilyOverview {
  const ctx = advisorContext(s, today)
  const plan = new Map(s.goals.plan.allocations.map(a => [a.goal.id, a]))
  const savingsKnown = ctx.months > 0
  const metrics = s.health?.metrics ?? {}
  return {
    baseCurrency: ctx.base,
    closedMonth: ctx.month,
    monthsOfData: ctx.months,
    now: {
      ...currentNumbers(ctx),
      incomePerMonth: ctx.incomePerMonth,
      expensePerMonth: ctx.expensePerMonth,
      loanPaymentsPerMonth: ctx.loanPaymentsPerMonth,
    },
    mandatory: ctx.mandatory,
    loans: (s.capital?.loans ?? []).map(l => ({
      name: l.name, member: l.member, type: l.type, currency: l.currency, balance: l.balance, balanceBase: l.balanceBase, ratePct: l.rate, payment: l.payment, paymentBase: l.paymentBase,
    })),
    goals: s.goals.items.map(g => {
      const weighed = savingsKnown ? plan.get(g.id) : undefined
      return {
        id: g.id, name: g.name, targetBase: g.targetBase, currentBase: g.currentBase, targetDate: g.target_date,
        status: weighed?.status ?? null, projectedDate: weighed?.projectedDate ?? null,
      }
    }),
    incomeShares: incomeSharesOf(ctx),
    ...incomeSourcesOf(s, ctx.month, Math.max(1, ctx.months)),
    health: HEALTH_KEYS.flatMap(key => {
      const m = metrics[key]
      return m ? [{ key, value: m.value, zone: m.zone }] : []
    }),
    gaps: contextGaps(ctx),
  }
}
