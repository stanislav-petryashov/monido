// The Income and expenses page's figures over a period the person picks (a month, a quarter, a year, all time, ending at
// a closed month) and the one baseline the page compares with: "usual" — the median month of the last six closed months
// before the period. The 3-month averages elsewhere (avg3m, historicalBudget, the cushion) are not this page's.
import type { SpendingRecords } from './api'
import { groupCashflow, ratelessRow, savingsRate, trend } from './cashflow'
import { monthsBetween, shiftMonth } from './dates'
import { round2 } from './fx'
import type { CategorisedMonth } from './spending'
import type { AssetPeriod, CashflowRowBase, CategoryFlow, CategoryKind, FinanceSnapshot, MonthFlow, MonthTotals } from './types'

/** How many closed months before the period "usual" reads */
export const USUAL_MONTHS = 6
const LENGTH: Record<AssetPeriod, number> = { month: 1, quarter: 3, year: 12, all: Infinity }

const median = (values: number[]): number | null => {
  const s = [...values].sort((a, b) => a - b), n = s.length
  return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

/** The closed months with flows, oldest first */
export const flowMonths = (rows: CashflowRowBase[]): string[] => [...new Set(rows.map(r => r.month))].sort()

/** The period's months that have flows: the calendar months up to `end` (1, 3, 12 or all of them) */
export function periodMonths(months: string[], end: string, kind: AssetPeriod): string[] {
  const from = kind === 'all' ? '' : shiftMonth(end, -(LENGTH[kind] - 1))
  return months.filter(m => m >= from && m <= end)
}

export interface PeriodFlows {
  months: number
  income: number; active: number; passive: number; expense: number; net: number
  /** Savings rate of the period, %; null without income */
  rate: number | null
  /** The average month: what a longer period is compared with "usual" by */
  perMonth: { income: number; expense: number; net: number }
}

/** The period's sums and its average month; null — no month, or a month has a row without a rate (its totals are unknown) */
export function periodFlows(rows: CashflowRowBase[], months: string[]): PeriodFlows | null {
  const inPeriod = rows.filter(r => months.includes(r.month))
  if (!months.length || inPeriod.some(ratelessRow)) return null
  // no rateless row: every month's totals are known
  const t = trend(inPeriod) as MonthTotals[]
  const sum = (k: 'income' | 'active' | 'passive' | 'expense') => round2(t.reduce((n, m) => n + m[k], 0))
  const income = sum('income'), expense = sum('expense'), n = t.length
  const net = round2(income - expense)
  return {
    months: n, income, active: sum('active'), passive: sum('passive'), expense, net, rate: savingsRate(income, expense),
    perMonth: { income: round2(income / n), expense: round2(expense / n), net: round2(net / n) },
  }
}

export interface UsualMonth { months: string[]; income: number; expense: number; net: number; rate: number | null }

/**
 * "Usual": the median month (income, expenses, net and the savings rate each on its own) of the last `count` closed
 * months before `first`, fewer at the start of history; months with a rateless row are left out. Null — none before.
 */
export function usualMonth(rows: CashflowRowBase[], first: string, count = USUAL_MONTHS): UsualMonth | null {
  const rateless = new Set(rows.filter(ratelessRow).map(r => r.month))
  const before = (trend(rows.filter(r => r.month < first && !rateless.has(r.month))) as MonthTotals[]).slice(-count)
  if (!before.length) return null
  const med = (pick: (m: (typeof before)[number]) => number) => round2(median(before.map(pick))!)
  const rates = before.map(m => savingsRate(m.income, m.expense)).filter((r): r is number => r !== null)
  return { months: before.map(m => m.month), income: med(m => m.income), expense: med(m => m.expense), net: med(m => m.net), rate: median(rates) }
}

export interface CategoryRow {
  id: number; name: string; kind: CategoryKind; flow: CategoryFlow; oneOff: boolean
  /**
   * The period's sum and its average month over the period's months with category data: 0 for a category with a usual
   * and no line in the period; null — a line of it has no rate, its sum is unknown
   */
  value: number | null; perMonth: number | null
  /**
   * The median of the up-to-six months with category data before the period where the category has a line; null — none,
   * or the category has a line in fewer than half of those months (a one-time repair is not usual)
   */
  usual: number | null
  /** How many months `usual` read */
  usualCount: number
  /** perMonth − usual; null without a usual or without a known sum */
  delta: number | null
}

export interface CategoryPeriod {
  /** Largest first */
  rows: CategoryRow[]
  /** What the categories leave unallocated in the period; null — a month's is unknown (a rate is missing) */
  unallocated: number | null
  /** The direction's total over the months with category data */
  total: number | null
  /** The period's months that have category data, and how many months the period has */
  months: string[]
  /** How many months before the period with category data the usual reads (0 — no comparison) */
  usualMonths: number
}

/** Months with at least one category line: a month the screen never split is not a month of zeros */
const withData = (source: CategorisedMonth[]) => source.filter(m => m.categories.length > 0)

/**
 * One direction's categories over the period against usual. A month need not be fully split: a category's usual reads
 * the months where it has a line, so a month with an unallocated remainder still compares.
 */
export function categoryUsual(source: CategorisedMonth[], months: string[]): CategoryPeriod {
  const data = withData(source)
  const have = data.filter(m => months.includes(m.month))
  const prior = data.filter(m => m.month < months[0]).slice(-USUAL_MONTHS)
  // usual needs the category in at least half of those months: a one-time repair is not a usual expense to compare with
  const usualIn = (id: number) => 2 * prior.filter(m => m.categories.some(x => x.categoryId === id)).length >= prior.length
  // a line without a rate makes its category's sum unknown, not smaller
  const sums = new Map<number, { c: CategorisedMonth['categories'][number]; value: number | null }>()
  for (const m of have) for (const c of m.categories) {
    const was = sums.get(c.categoryId)
    sums.set(c.categoryId, { c, value: was?.value === null || c.amountBase === null ? null : (was?.value ?? 0) + c.amountBase })
  }
  // a category usual before the period but without a line in it: it went to 0 there (the period has category data)
  if (have.length) for (const m of prior) for (const c of m.categories) if (!sums.has(c.categoryId) && usualIn(c.categoryId)) sums.set(c.categoryId, { c, value: 0 })
  const k = Math.max(1, have.length)
  const rows = [...sums.values()].map(({ c, value }): CategoryRow => {
    const values = usualIn(c.categoryId) ? prior.flatMap(m => m.categories.filter(x => x.categoryId === c.categoryId && x.amountBase !== null).map(x => x.amountBase!)) : []
    const usual = median(values), perMonth = value === null ? null : round2(value / k)
    return {
      id: c.categoryId, name: c.name, kind: c.kind, flow: c.flow, oneOff: c.oneOff, value: value === null ? null : round2(value), perMonth,
      usual: usual === null ? null : round2(usual), usualCount: values.length, delta: usual === null || perMonth === null ? null : round2(perMonth - usual),
    }
  }).sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
  const known = (pick: (m: CategorisedMonth) => number | null) => have.some(m => pick(m) === null) ? null : round2(have.reduce((n, m) => n + pick(m)!, 0))
  return { rows, unallocated: known(m => m.unallocatedBase), total: known(m => m.totalBase), months: have.map(m => m.month), usualMonths: prior.length }
}

/** One category month by month since categories began (0 in a month with data but no line) and its largest month */
export function categorySeries(source: CategorisedMonth[], id: number): { months: { month: string; value: number | null }[]; top: { month: string; value: number } | null } {
  // a line without a rate: that month's amount is unknown (null), not 0
  const months = withData(source).map(m => {
    const c = m.categories.find(x => x.categoryId === id)
    return { month: m.month, value: c ? (c.amountBase === null ? null : round2(c.amountBase)) : 0 }
  })
  const top = months.reduce<{ month: string; value: number } | null>((best, m) => (m.value !== null && m.value > 0 && (!best || m.value > best.value) ? { month: m.month, value: m.value } : best), null)
  return { months, top }
}

/**
 * Where a category's money of `month` came from: the accounts whose lines hold it (in the account's currency) and the
 * other sources (a card, cash) with their lines (in the line's currency), largest first
 */
export function categorySources(records: Pick<SpendingRecords, 'accounts' | 'sources'>, id: number, month: string) {
  const accounts = records.accounts.filter(a => a.month === month).flatMap(a => a.items.filter(i => i.categoryId === id)
    .map(i => ({ bank: a.bank, member: a.member, currency: a.currency, amount: i.amount, other: false })))
  const sources = records.sources.filter(s => s.month === month).flatMap(s => s.items.filter(i => i.categoryId === id)
    .map(i => ({ bank: s.source, member: '', currency: i.currency, amount: i.amount, other: true })))
  return [...accounts, ...sources].sort((a, b) => b.amount - a.amount)
}

/** Who brought and who spent over the period; a loan payment counts to the loan's owner; null — a row of theirs has no rate */
export const periodMembers = (rows: CashflowRowBase[], months: string[]) =>
  groupCashflow(rows.filter(r => months.includes(r.month)), 'member').map(g => ({ member: g.member ?? '', income: g.income, expense: g.expense }))

/** A sentence of the page's finding: a translation key and its params (amounts and rates as numbers, formatted by the page) */
export interface FindingPart { key: string; params: Record<string, string | number> }

const F = 'cashflowPage.finding'

/**
 * The finding under the title: what was saved (or overspent) and its rate against the usual rate; then the expenses
 * against the usual month — per month for a longer period, with the category that grew most when they grew.
 */
export function cashflowFinding(flows: PeriodFlows, usual: UsualMonth | null, grew: CategoryRow | null): FindingPart[] {
  const overspent = Math.round(flows.net) < 0
  const parts: FindingPart[] = [overspent
    ? { key: `${F}.overspent${usual ? 'Usual' : ''}`, params: { net: -flows.net, ...(usual ? { usualRate: usual.rate ?? 0 } : {}) } }
    : { key: `${F}.saved${usual ? 'Usual' : ''}`, params: { net: flows.net, rate: flows.rate ?? 0, ...(usual ? { usualRate: usual.rate ?? 0 } : {}) } }]
  if (!usual) return parts
  const diff = round2(flows.perMonth.expense - usual.expense)
  const each = flows.months > 1 ? 'PerMonth' : ''
  if (Math.round(diff) === 0) parts.push({ key: `${F}.expenseUsual`, params: {} })
  else if (diff < 0) parts.push({ key: `${F}.expenseBelow${each}`, params: { amount: -diff } })
  else if (grew && grew.delta !== null && Math.round(grew.delta) > 0) parts.push({ key: `${F}.expenseAbove${each}Top`, params: { amount: diff, category: grew.name, delta: grew.delta } })
  else parts.push({ key: `${F}.expenseAbove${each}`, params: { amount: diff } })
  return parts
}

/** The chart's window around the period: 13 months for a month or a quarter, 24 for a year, the whole history for all time */
const WINDOW: Record<AssetPeriod, number> = { month: 13, quarter: 13, year: 24, all: Infinity }

export interface CashflowPeriodView {
  /** The last closed month with flows (rule 4): the default end, and the month the categories screen's action names */
  last: string
  /** The period's last month and its months with flows, oldest first */
  end: string
  months: string[]
  /** Every month with flows, oldest first: what "‹ ›" steps through */
  all: string[]
  /** The calendar months the period spans, from its start (not before the first month with flows) to `end`: more than `months` when some have no flows (a catch-up) */
  calendarMonths: number
  flows: PeriodFlows | null
  /** null — nothing before the period (all time, the start of history) */
  usual: UsualMonth | null
  expenses: CategoryPeriod
  income: CategoryPeriod
  members: ReturnType<typeof periodMembers>
  /** The chart's months, oldest first, ending at the period's end; a month with a rateless row has null totals */
  chart: MonthFlow[]
  finding: FindingPart[]
}

/** Everything the page shows for a period ending at `month` (the last closed one when it is not a month with flows); null — no flows */
export function cashflowPeriodView(s: FinanceSnapshot, kind: AssetPeriod, month: string | null): CashflowPeriodView | null {
  // the closed months' boundary, not the closed month's totals: a rateless row blanks its periods, not the page
  const last = s.asOf.closedMonth
  const rows = s.cashflow.rows
  const all = flowMonths(rows)
  if (!last || !all.length) return null
  const end = month && all.includes(month) ? month : last
  const months = periodMonths(all, end, kind)
  const start = kind === 'all' ? all[0] : shiftMonth(end, -(LENGTH[kind] - 1))
  const calendarMonths = monthsBetween(start < all[0] ? all[0] : start, end) + 1
  const flows = periodFlows(rows, months)
  const usual = usualMonth(rows, months[0])
  const expenses = categoryUsual(s.spending.months, months)
  const grew = expenses.rows.reduce<CategoryRow | null>((top, r) => ((r.delta ?? 0) > (top?.delta ?? 0) ? r : top), null)
  const window = all.filter(m => m <= end).slice(-Math.min(WINDOW[kind], all.length))
  return {
    last, end, months, all, calendarMonths, flows, usual, expenses, income: categoryUsual(s.income.months, months),
    members: periodMembers(rows, months),
    chart: trend(rows.filter(r => window.includes(r.month))),
    finding: flows ? cashflowFinding(flows, usual, grew) : [],
  }
}

/**
 * What the last closed month leaves without a category, expenses and income; an amount is null when it is unknown (a line
 * without a rate). Null — all of it is split (or no month)
 */
export function unsplitTotals(s: FinanceSnapshot): { month: string; expense: number | null; income: number | null } | null {
  // which month: the closed one; its totals are null when a row has no rate
  const month = s.asOf.closedMonth
  const flow = s.cashflow.closedMonth
  if (!month || !s.trackFlows) return null
  // a month with no line at all is not in the categorised months: all of it is without a category
  const left = (source: CategorisedMonth[], total: number | null) => {
    const m = source.find(x => x.month === month)
    const v = m ? m.unallocatedBase : total
    return v === null ? null : Math.max(0, round2(v))
  }
  const expense = left(s.spending.months, flow?.expense ?? null), income = left(s.income.months, flow?.income ?? null)
  const open = (v: number | null) => v === null || v > 0.005
  return open(expense) || open(income) ? { month, expense, income } : null
}

/** How many accounts of `month` leave part of their expenses without a category */
export const unsplitAccounts = (accounts: SpendingRecords['accounts'], month: string) =>
  accounts.filter(a => a.month === month && !a.orphaned && (a.totals?.expense ?? 0) - a.allocated.expense > 0.005).length

/** The first month with category lines of a direction; null — none */
export const categoriesSince = (source: CategorisedMonth[]): string | null => withData(source)[0]?.month ?? null
