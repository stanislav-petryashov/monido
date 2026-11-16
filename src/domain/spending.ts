// Income and spending by category: a category allocates one of an account's month totals (expense, active or passive
// income); what is left is unallocated (shown as “Unallocated”). Also the mandatory-spending average.
import { groupBy } from './cashflow'
import { shiftMonth } from './dates'
import { convert, convertRounded, round2 } from './fx'
import {
  directionOf,
  type CashflowRowBase, type CategoryDirection, type CategoryFlow, type CategoryKind, type CategorySpendingInput, type FlowLineInput,
  type ManualMandatory, type RateLookup, type Rates, type SpendingCategory, type Warning,
} from './types'

/** How many closed months the mandatory average looks at (calendar months ending at the closed month). */
export const MANDATORY_WINDOW_MONTHS = 3

/** Lines may exceed a total by rounding only. */
const TOLERANCE = 0.005

export interface CategoryTotal {
  categoryId: number
  name: string
  kind: CategoryKind
  flow: CategoryFlow
  oneOff: boolean
  /** The month's sum over every account and source; null — a line is in a currency without a rate */
  amountBase: number | null
}

/** One flow's allocation of the month (income only). */
interface FlowAllocation { allocatedBase: number; totalBase: number; unallocatedBase: number }

export interface CategorisedMonth {
  month: string
  /** The categories with an amount in the month, in the order of the category list, this direction only */
  categories: CategoryTotal[]
  /** The sum of the categories that could be converted */
  allocatedBase: number
  /**
   * The month's total of the direction from the cash flow: income — Σ active and passive of the account rows; expense —
   * every row's expense, loan payments included. Null — the month has no such rows, or a row has no rate
   */
  totalBase: number | null
  /**
   * What the categories leave unallocated (shown as “Unallocated”): per account and flow max(0, total − its lines); for expenses
   * plus the loan rows' expense (they have no account lines) less the free-source lines, at least 0. Null — a rate is missing
   */
  unallocatedBase: number | null
  /** Income only: the allocation per flow; absent when a rate is missing */
  byFlow?: Record<'active' | 'passive', FlowAllocation>
  /** Income only: the sum of the one-off categories */
  oneOffBase?: number
  /** allocatedBase ÷ totalBase, %; null without a total */
  coveragePct: number | null
}

export interface MandatorySpending {
  perMonthBase: number
  source: 'categories' | 'manual'
  /** Months the average is taken over; 0 for a manual amount */
  months: number
  /** The date the manual amount was typed; null for categories */
  updatedAt: string | null
}

/** What categorisedMonths reads: the free-source spending and the account lines. */
type LineRows = { categorySpending: CategorySpendingInput[]; flowLines: FlowLineInput[] }

/** The `monthly_cashflow` totals of each direction: income has two (active, passive), expenses one */
export const FLOWS_OF: Record<CategoryDirection, readonly CategoryFlow[]> = { income: ['active', 'passive'], expense: ['expense'] }
const totalOf = (row: CashflowRowBase, flow: CategoryFlow): number | null =>
  flow === 'active' ? row.activeBase : flow === 'passive' ? row.passiveBase : row.expenseBase
const sumOrNull = (values: (number | null)[]): number | null =>
  values.reduce<number | null>((sum, v) => (sum === null || v === null ? null : sum + v), 0)
const accountOf = (month: string, bank: string, member: string) => JSON.stringify([month, bank, member])

/**
 * The months with a line of the direction, oldest first; each line at the rate of its month's first day, an account
 * line in its account row's currency. A group of lines whose account row is missing is left out (`orphan_lines`); an
 * account's lines over its total are clamped per account, so they cannot hide under another account's remainder, and
 * warned (`lines_exceed_total`), as are free-source lines over the month's pooled expense remainder (the soft cap).
 */
export function categorisedMonths(
  rows: LineRows, categories: SpendingCategory[], cfRows: CashflowRowBase[], direction: CategoryDirection,
  rateAt: RateLookup, base: string, warn: (w: Warning) => void = () => {},
): CategorisedMonth[] {
  const own = categories.filter(c => directionOf(c.flow) === direction)
  const byId = new Map(own.map(c => [c.id, c]))
  const flows = FLOWS_OF[direction]
  const accountRows = new Map(cfRows.filter(r => !r.loan).map(r => [accountOf(r.month, r.bank, r.member), r]))
  // grouped by month once: a long history would otherwise scan every row for every month
  const linesByMonth = groupBy(rows.flowLines, l => l.date.slice(0, 7))
  const sourcesByMonth = groupBy(direction === 'expense' ? rows.categorySpending.filter(r => byId.has(r.category_id)) : [], r => r.date.slice(0, 7))
  const cfByMonth = groupBy(cfRows, r => r.month)
  const months = [...new Set([...rows.flowLines.map(l => l.date.slice(0, 7)), ...rows.categorySpending.map(r => r.date.slice(0, 7))])].sort()

  return months.map((month): CategorisedMonth => {
    const rates = rateAt(`${month}-01`)
    const monthLines = linesByMonth.get(month) ?? []
    const orphaned = monthLines.filter(l => !accountRows.has(accountOf(month, l.bank, l.member)))
    if (orphaned.length) warn({ code: 'orphan_lines', params: { month, count: orphaned.length } })
    // each kept line with its account row and its amount in the base currency
    const lines = monthLines.flatMap(l => {
      const row = accountRows.get(accountOf(month, l.bank, l.member))
      const category = byId.get(l.category_id)
      return row && category ? [{ line: l, row, category, base: convert(l.amount, row.currency, base, rates) }] : []
    })
    const sources = (sourcesByMonth.get(month) ?? []).map(r => ({ category: byId.get(r.category_id)!, base: convert(r.amount, r.currency, base, rates) }))

    const totals: CategoryTotal[] = []
    for (const c of own) {
      const amounts = [...lines.filter(l => l.category.id === c.id), ...sources.filter(r => r.category.id === c.id)].map(l => l.base)
      if (!amounts.length) continue
      const sum = sumOrNull(amounts)
      totals.push({ categoryId: c.id, name: c.name, kind: c.kind, flow: c.flow, oneOff: c.oneOff, amountBase: sum === null ? null : round2(sum) })
    }
    const allocated = round2(totals.reduce((sum, c) => sum + (c.amountBase ?? 0), 0))

    const monthRows = (cfByMonth.get(month) ?? []).filter(r => direction === 'expense' || !r.loan)
    const linesByRow = groupBy(lines, l => l.row)
    const total = monthRows.length ? sumOrNull(monthRows.flatMap(r => flows.map(f => totalOf(r, f)))) : null

    // per account and flow: the remainder the lines leave, an excess clamped and warned
    const remainder: Record<CategoryFlow, number | null> = { active: 0, passive: 0, expense: 0 }
    const allocatedOf: Record<CategoryFlow, number> = { active: 0, passive: 0, expense: 0 }
    for (const row of monthRows.filter(r => !r.loan)) {
      for (const flow of flows) {
        const rowTotal = totalOf(row, flow)
        const own = (linesByRow.get(row) ?? []).filter(l => l.category.flow === flow).map(l => l.base)
        const sum = sumOrNull(own)
        if (sum !== null) allocatedOf[flow] += sum
        if (rowTotal === null || sum === null) { remainder[flow] = null; continue }
        if (sum - rowTotal > TOLERANCE) {
          warn({ code: 'lines_exceed_total', params: { context: flow, month, name: row.bank, member: row.member, lines: round2(sum), total: round2(rowTotal) } })
        }
        if (remainder[flow] !== null) remainder[flow] = remainder[flow] + Math.max(0, rowTotal - sum)
      }
    }
    let unallocated: number | null
    if (direction === 'expense') {
      // the pool: the account remainders and the loan rows' whole expense, less the free-source lines (a soft cap)
      const loans = sumOrNull(monthRows.filter(r => r.loan).map(r => r.expenseBase))
      const free = sumOrNull(sources.map(r => r.base))
      const pool = remainder.expense === null || loans === null ? null : remainder.expense + loans
      if (pool === null || free === null || total === null) unallocated = null
      else {
        if (free - pool > TOLERANCE) warn({ code: 'lines_exceed_total', params: { context: 'sources', month, lines: round2(free), total: round2(pool) } })
        unallocated = round2(Math.max(0, pool - free))
      }
    } else {
      unallocated = total === null || remainder.active === null || remainder.passive === null ? null : round2(remainder.active + remainder.passive)
    }

    const out: CategorisedMonth = {
      month, categories: totals, allocatedBase: allocated, totalBase: total === null ? null : round2(total), unallocatedBase: unallocated,
      coveragePct: total !== null && total > 0 ? round2((allocated / total) * 100) : null,
    }
    if (direction === 'income') {
      const flowTotal = (flow: 'active' | 'passive') => sumOrNull(monthRows.map(r => totalOf(r, flow)))
      const active = flowTotal('active')
      const passive = flowTotal('passive')
      if (active !== null && passive !== null && remainder.active !== null && remainder.passive !== null) {
        out.byFlow = {
          active: { allocatedBase: round2(allocatedOf.active), totalBase: round2(active), unallocatedBase: round2(remainder.active) },
          passive: { allocatedBase: round2(allocatedOf.passive), totalBase: round2(passive), unallocatedBase: round2(remainder.passive) },
        }
      }
      out.oneOffBase = round2(totals.filter(c => c.oneOff).reduce((sum, c) => sum + (c.amountBase ?? 0), 0))
    }
    return out
  }).filter(m => m.categories.length)
}

/** Lines of one account: a category and an amount, in the account's currency. */
type Lines = readonly { categoryId: number; amount: number }[]

/**
 * The sum of the lines per flow, for a total the statement does not print.
 * @throws Error('invalid_category_flow') for an unknown category or the reserved `loan_payment` one
 */
export function totalsOfLines(lines: Lines, categories: SpendingCategory[]): Record<CategoryFlow, number> {
  const sums: Record<CategoryFlow, number> = { active: 0, passive: 0, expense: 0 }
  for (const l of lines) {
    const category = categories.find(c => c.id === l.categoryId)
    if (!category || category.kind === 'loan_payment') throw new Error('invalid_category_flow')
    sums[category.flow] += l.amount
  }
  return { active: round2(sums.active), passive: round2(sums.passive), expense: round2(sums.expense) }
}

/**
 * Each flow whose lines exceed the account's total (beyond rounding), with both sums; empty — within the cap. A null
 * total (not filled in) caps nothing. One rule for every write path, the close, the wizard and the snapshot.
 */
export function allocationExcess(
  lines: Lines, categories: SpendingCategory[], totals: Record<CategoryFlow, number | null>,
): { flow: CategoryFlow; lines: number; total: number }[] {
  const out: { flow: CategoryFlow; lines: number; total: number }[] = []
  for (const flow of ['active', 'passive', 'expense'] as const) {
    const total = totals[flow]
    if (total === null) continue
    const sum = round2(lines.filter(l => categories.find(c => c.id === l.categoryId)?.flow === flow).reduce((s, l) => s + l.amount, 0))
    if (sum - total > TOLERANCE) out.push({ flow, lines: sum, total: round2(total) })
  }
  return out
}

/** The sum of an account's lines per flow; a line of a category not in the list (deleted meanwhile) counts nowhere. */
export function allocatedByFlow(lines: Lines, categories: SpendingCategory[]): Record<CategoryFlow, number> {
  const sums: Record<CategoryFlow, number> = { active: 0, passive: 0, expense: 0 }
  for (const l of lines) {
    const flow = categories.find(c => c.id === l.categoryId)?.flow
    if (flow) sums[flow] += l.amount
  }
  return { active: round2(sums.active), passive: round2(sums.passive), expense: round2(sums.expense) }
}

/**
 * One direction of an account's allocation, as the allocation editor's header says it: the total (null — a total not
 * filled in, or no account row), what the lines allocate, the rest left unallocated (per flow, so an over-allocated
 * flow does not eat another's remainder; null without a total) and the flows whose lines exceed their total.
 */
export function allocationSummary(
  allocated: Record<CategoryFlow, number>, totals: Record<CategoryFlow, number | null> | null, direction: CategoryDirection,
): { total: number | null; allocated: number; rest: number | null; over: CategoryFlow[] } {
  const flows = FLOWS_OF[direction]
  const sum = round2(flows.reduce((s, f) => s + allocated[f], 0))
  const known = totals && flows.every(f => totals[f] !== null) ? (totals as Record<CategoryFlow, number>) : null
  const over = totals ? flows.filter(f => totals[f] !== null && allocated[f] - totals[f] > TOLERANCE) : []
  if (!known) return { total: null, allocated: sum, rest: null, over }
  return {
    total: round2(flows.reduce((s, f) => s + known[f], 0)),
    allocated: sum,
    rest: round2(flows.reduce((s, f) => s + Math.max(0, known[f] - allocated[f]), 0)),
    over,
  }
}

/** The months of the window (the last three calendar months up to the closed month) that have an amount in a `mandatory` category. */
export function mandatoryMonths(months: CategorisedMonth[], closedMonth: string | null): CategorisedMonth[] {
  if (!closedMonth) return []
  const start = shiftMonth(closedMonth, -(MANDATORY_WINDOW_MONTHS - 1))
  return months.filter(m => m.month >= start && m.month <= closedMonth && m.categories.some(c => c.kind === 'mandatory'))
}

/**
 * What the family must spend each month: the mandatory categories averaged over the months with such data among the last
 * three calendar months up to the closed month (the divisor is the number of those months). Without a mandatory amount in
 * the window the manual amount at today's rate is used (a list of only optional categories says nothing about the
 * mandatory spending). Null when there is nothing, when the manual currency has no rate, or when a mandatory amount in the
 * window has no rate (a sum without it would understate; the manual amount does not replace it). Loan payments are never mandatory.
 */
export function mandatorySpending(
  months: CategorisedMonth[], closedMonth: string | null, manual: ManualMandatory | null, todayRates: Rates, base: string,
): MandatorySpending | null {
  const window = mandatoryMonths(months, closedMonth)
  if (window.length) {
    const amounts = window.flatMap(m => m.categories.filter(c => c.kind === 'mandatory').map(c => c.amountBase))
    if (amounts.some(v => v === null)) return null
    const total = amounts.reduce<number>((sum, v) => sum + (v ?? 0), 0)
    return { perMonthBase: round2(total / window.length), source: 'categories', months: window.length, updatedAt: null }
  }
  if (!manual) return null
  const perMonth = convertRounded(manual.amount, manual.currency, base, todayRates)
  return perMonth === null ? null : { perMonthBase: perMonth, source: 'manual', months: 0, updatedAt: manual.updated_at }
}

/**
 * An account's usual lines for `month`: last month's lines whose category holds the same amount in one of the two months
 * before (exact repeats, no average). Learned from the history, never declared; the wizard offers them, nothing adds them.
 */
export function steadyLines(
  accounts: readonly { month: string; bank: string; member: string; items: readonly { categoryId: number; amount: number }[] }[],
  month: string, bank: string, member: string,
): { categoryId: number; amount: number }[] {
  const itemsIn = (m: string) => accounts.find(a => a.month === m && a.bank === bank && a.member === member)?.items ?? []
  const before = [shiftMonth(month, -2), shiftMonth(month, -3)].map(itemsIn)
  return itemsIn(shiftMonth(month, -1))
    .filter(l => before.some(items => items.some(i => i.categoryId === l.categoryId && round2(i.amount) === round2(l.amount))))
    .map(l => ({ categoryId: l.categoryId, amount: l.amount }))
}
