// Milestones of the closed months: a loan paid off, an emergency fund reached, a share of a year's expenses added, net
// worth passing a mark the family carried it to. Derived from the history each time, never stored (docs/finance-rules.md).
import { addedOf, isMonthChange, marketsOf } from './capitalChange'
import { monthOf } from './dates'
import { round2 } from './fx'
import type { ClosedMonth } from './monthClose'
import type { Milestone, MilestoneKind, MarkCrossing, MonthChange, MonthChangeGap } from './types'

export interface MilestoneMonth {
  month: string; source: ClosedMonth['source']
  /** Every balance of the month observed and converted (capitalCoverage.capitalKnown) */
  complete: boolean
  netWorth: number | null
  /** Liquid money over the 12-month average expense; null — liquid unknown, no flows in the month or under 3 months of them */
  fundMonths: number | null
  /** The 12-month average expense ending at the month, with the same nulls */
  expensePerMonth: number | null
  change: MonthChange | MonthChangeGap
  /** Each loan of the month's capital by name, in its own currency */
  loanBalances: Record<string, number>
}
export interface MilestoneInput { months: MilestoneMonth[]; loans: { name: string; closedDate: string | null }[]; currency: string }

export const FUND_LEVELS = [3, 6]
export const ADDED_LEVELS = [3, 6, 12]
/** Months of a year's tracked flows before "added this year" can fire */
const MIN_TRACKED_MONTHS = 3
const PRIORITY: MilestoneKind[] = ['loanPaidOff', 'emergencyFund', 'addedThisYear', 'netWorthMark']

const tracked = (c: MonthChange | MonthChangeGap): c is MonthChange => isMonthChange(c) && c.form === 'tracked'
/** The highest level passed: `pass(level)` says whether it is */
const highest = (levels: number[], used: Set<number>, pass: (level: number) => boolean) => {
  const passed = levels.filter(pass)
  const fresh = passed.filter(l => !used.has(l))
  passed.forEach(l => used.add(l))
  return fresh.length ? Math.max(...fresh) : null
}

export function milestones({ months, loans, currency }: MilestoneInput): { milestones: Milestone[]; crossings: MarkCrossing[] } {
  const found: Omit<Milestone, 'headline' | 'celebrated'>[] = []
  const crossings: MarkCrossing[] = []
  const fundUsed = new Set<number>()
  let fundKnown = false
  const added = new Map<string, { sum: number; months: number; used: Set<number> }>()
  let before: number | null = null
  let top: number | null = null
  const paid = new Set<string>()
  const owed = new Set<string>()

  months.forEach((mo, i) => {
    const { month, change } = mo
    const first = i === 0
    // Loans: the earliest of the balance reaching 0 and the closing date's month; a refinancing is not a payoff
    const refinanced = isMonthChange(change) && change.pairs.some(p => p.kind === 'newLoan')
    const names = new Map(loans.map(l => [l.name, l.closedDate]))
    for (const name of Object.keys(mo.loanBalances)) if (!names.has(name)) names.set(name, null)
    for (const [name, closedDate] of names) {
      if (paid.has(name)) continue
      const balance = mo.loanBalances[name]
      const zero = balance === 0 && owed.has(name)
      const closed = closedDate !== null && monthOf(closedDate) <= month
      if (balance > 0) owed.add(name)
      if (!zero && !closed) continue
      paid.add(name)
      if (!first && !refinanced) found.push({ month, kind: 'loanPaidOff', params: { name } })
    }

    // The emergency fund: the first known value is no crossing; a rise counts only with a positive saving
    if (mo.fundMonths !== null) {
      const v = round2(mo.fundMonths)
      if (!fundKnown) { fundKnown = true; FUND_LEVELS.filter(l => l <= v).forEach(l => fundUsed.add(l)) }
      else if (tracked(change) && (change.rows.saved ?? 0) > 0) {
        const level = highest(FUND_LEVELS, fundUsed, l => v > l)
        if (level !== null) found.push({ month, kind: 'emergencyFund', level, params: { months: level } })
      }
    }

    // Added this year, in months of the year's average expense: never in January, from the third tracked month
    if (!first && tracked(change)) {
      const year = month.slice(0, 4)
      const y = added.get(year) ?? { sum: 0, months: 0, used: new Set<number>() }
      added.set(year, y)
      y.sum = round2(y.sum + addedOf(change))
      y.months++
      if (!month.endsWith('-01') && y.months >= MIN_TRACKED_MONTHS && mo.expensePerMonth && mo.expensePerMonth > 0) {
        const share = y.sum / mo.expensePerMonth
        const level = highest(ADDED_LEVELS, y.used, l => share >= l)
        if (level !== null) found.push({ month, kind: 'addedThisYear', level, params: { months: level } })
      }
    }

    // Net worth marks: 0 and the multiples of 10^k of the value before, new only above the highest complete month so far
    if (mo.complete && mo.netWorth !== null) {
      const after = mo.netWorth
      if (before !== null && top !== null && after > top) {
        const marks = before < 0 ? [0] : before > 0 ? (() => {
          const step = 10 ** Math.floor(Math.log10(before))
          return [Math.floor(after / step) * step]
        })() : []
        const level = marks.filter(l => l > top! && l <= after && l > before!).at(-1)
        if (level !== undefined) {
          const carried = tracked(change) && addedOf(change) > 0 && addedOf(change) >= marketsOf(change)
          if (carried) found.push({ month, kind: 'netWorthMark', level, params: { amount: level }, currency })
          else crossings.push({ month, level, currency })
        }
      }
      before = after
      top = top === null ? after : Math.max(top, after)
    }
  })

  const source = new Map(months.map(m => [m.month, m.source]))
  const rank = (m: { kind: MilestoneKind }) => PRIORITY.indexOf(m.kind)
  return {
    milestones: found.map(m => ({
      ...m,
      headline: !found.some(o => o.month === m.month && rank(o) < rank(m)) && found.find(o => o.month === m.month && rank(o) === rank(m)) === m,
      celebrated: source.get(m.month) === 'wizard',
    })),
    crossings,
  }
}
