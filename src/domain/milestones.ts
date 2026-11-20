// Milestones of the closed months: a loan paid off, an emergency fund reached, a share of a year's expenses added, net
// worth passing a mark the family carried it to. Derived from the history each time, never stored (docs/finance-rules.md).
import { addedOf, isMonthChange, marketsOf } from './capitalChange'
import { monthOf, shiftMonth } from './dates'
import { round2 } from './fx'
import type { ClosedMonth } from './monthClose'
import type { Milestone, MilestoneKind, MarkCrossing, MonthChange, MonthChangeGap } from './types'

export interface MilestoneMonth {
  month: string; source: ClosedMonth['source']
  /** When it was closed (ISO); absent: treated as on time */
  closedAt?: string
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
/** The round amount of one significant digit at or below a positive value: 612 000 → 600 000, 1 150 000 → 1 000 000 */
const roundBelow = (v: number) => { const step = 10 ** Math.floor(Math.log10(v)); return Math.floor(v / step) * step }
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
  const found: Omit<Milestone, 'headline' | 'celebrated' | 'announced'>[] = []
  const crossings: MarkCrossing[] = []
  const fundUsed = new Set<number>()
  let fundKnown = false
  const added = new Map<string, { sum: number; months: number; used: Set<number> }>()
  let top: number | null = null
  // the lowest complete month so far: out of the red needs a month below zero first
  let low = 0
  const markYears = new Set<string>()
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
      if (balance !== undefined && balance > 0) owed.add(name)
      if (!zero && !closed) continue
      paid.add(name)
      if (!first && !refinanced) found.push({ month, kind: 'loanPaidOff', params: { name } })
    }

    // The emergency fund: the first known value is no crossing; a rise counts only with a positive saving
    if (mo.fundMonths !== null) {
      const v = round2(mo.fundMonths)
      if (!fundKnown) { fundKnown = true; FUND_LEVELS.filter(l => l < v).forEach(l => fundUsed.add(l)) }
      else {
        // a level passed without saving is used up all the same: it is never announced a month late
        const level = highest(FUND_LEVELS, fundUsed, l => v > l)
        if (level !== null && tracked(change) && (change.rows.saved ?? 0) > 0) found.push({ month, kind: 'emergencyFund', level, params: { months: level } })
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

    // Net worth marks: 0 (out of the red: from below zero to above it), and the round amounts of one significant digit (600 000, 1 000 000), new only above the highest
    // complete month so far; one a calendar year, the later ones are facts
    if (mo.complete && mo.netWorth !== null) {
      const after = mo.netWorth
      if (top !== null && after > top) {
        const level = top > 0 ? roundBelow(after) : low < 0 && top <= 0 && after > 0 ? 0 : null
        if (level !== null && (level > top || level === 0)) {
          const year = month.slice(0, 4)
          const carried = tracked(change) && addedOf(change) > 0 && addedOf(change) >= marketsOf(change)
          if (carried && !markYears.has(year)) { markYears.add(year); found.push({ month, kind: 'netWorthMark', level, params: { amount: level }, currency }) }
          else crossings.push({ month, level, currency })
        }
      }
      top = top === null ? after : Math.max(top, after)
      low = Math.min(low, after)
    }
  })

  const source = new Map(months.map(m => [m.month, m.source]))
  const late = new Set(months.filter(m => closedLate(m.month, m.closedAt)).map(m => m.month))
  const rank = (m: { kind: MilestoneKind }) => PRIORITY.indexOf(m.kind)
  return {
    milestones: found.map(m => ({
      ...m,
      headline: !found.some(o => o.month === m.month && rank(o) < rank(m)) && found.find(o => o.month === m.month && rank(o) === rank(m)) === m,
      celebrated: source.get(m.month) === 'wizard',
      announced: source.get(m.month) === 'wizard' && !late.has(m.month),
    })),
    crossings,
  }
}

/**
 * Closed after the end of the month that follows it: September closed in October is on time, in November late. A family
 * catching up after a pause did not live those months on screen, so their milestones are listed, never announced.
 */
export function closedLate(month: string, closedAt: string | undefined): boolean {
  return closedAt !== undefined && closedAt >= `${shiftMonth(month, 2)}-01`
}

/** Each year's highest "added this year" level, the others dropped: within one period a later level supersedes the earlier */
export function periodMilestones(all: Milestone[], months: string[]): Milestone[] {
  const period = new Set(months)
  const shown = all.filter(m => m.celebrated && period.has(m.month))
  const top = new Map<string, number>()
  for (const m of shown) if (m.kind === 'addedThisYear') top.set(m.month.slice(0, 4), Math.max(top.get(m.month.slice(0, 4)) ?? 0, m.level ?? 0))
  return shown
    .filter(m => m.kind !== 'addedThisYear' || m.level === top.get(m.month.slice(0, 4)))
    .sort((a, b) => a.month.localeCompare(b.month))
}
