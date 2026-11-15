import { latestMonth, monthOf, shiftMonth } from './dates'
import { convertRounded, round2 } from './fx'
import type { CashflowInput, CashflowRowBase, LoanPaymentInput, MonthFlow, MonthTotals, RateLookup, SavingsSummary } from './types'

/** Every row converted to the `base` currency at the rate of the first day of its month. */
export function convertCashflow(rows: CashflowInput[], rateAt: RateLookup, base: string): CashflowRowBase[] {
  return rows
    .map(r => {
      const month = monthOf(r.date)
      const rates = rateAt(`${month}-01`)
      const toBase = (v: number) => convertRounded(v, r.currency, base, rates)
      return {
        month, bank: r.bank, member: r.member, currency: r.currency,
        active: r.active_income, passive: r.passive_income, expense: r.expense,
        activeBase: toBase(r.active_income), passiveBase: toBase(r.passive_income), expenseBase: toBase(r.expense),
      }
    })
    .sort(byMonthMemberName)
}

/** Loan payments as expense rows of the loan, at the rate of the first day of their month; the member comes from the loan (none for a deleted one). */
export function convertLoanPayments(
  payments: LoanPaymentInput[], loans: { name: string; member: string }[], rateAt: RateLookup, base: string,
): CashflowRowBase[] {
  return payments.map(p => {
    const month = monthOf(p.date)
    return {
      month, bank: p.loan_name, member: loans.find(l => l.name === p.loan_name)?.member ?? '', currency: p.currency, loan: true as const,
      active: 0, passive: 0, expense: p.amount,
      activeBase: 0, passiveBase: 0, expenseBase: convertRounded(p.amount, p.currency, base, rateAt(`${month}-01`)),
    }
  })
}

/** The items by key, each group in the items' order (Map.groupBy, which ES2023 lacks). */
export function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const group = out.get(k)
    if (group) group.push(item)
    else out.set(k, [item])
  }
  return out
}

/** Rows in the display order: month, member, name. */
export const byMonthMemberName = (a: CashflowRowBase, b: CashflowRowBase) =>
  a.month.localeCompare(b.month) || a.member.localeCompare(b.member) || a.bank.localeCompare(b.bank)

/** The latest month with cash-flow rows — the «closed» month all monthly metrics use. */
export function closedMonth(rows: { month: string }[]): string | null {
  return latestMonth(rows.map(r => r.month))
}

/** The rows' sums; null — a row has no rate, so the sums are unknown, not that amount short */
function totals(rows: CashflowRowBase[]) {
  if (rows.some(ratelessRow)) return null
  let active = 0, passive = 0, expense = 0
  for (const r of rows) {
    active += r.activeBase!
    passive += r.passiveBase!
    expense += r.expenseBase!
  }
  return { active, passive, expense, income: active + passive }
}

/** The month's totals; null — a row of the month has no rate */
export function monthTotals(rows: CashflowRowBase[], month: string): MonthTotals | null {
  const t = totals(rows.filter(r => r.month === month))
  return t && {
    month, income: round2(t.income), active: round2(t.active), passive: round2(t.passive),
    expense: round2(t.expense), net: round2(t.income - t.expense),
  }
}

/** Each month with rows, oldest first; a month with a rateless row has null totals (a gap on a chart) */
export function trend(rows: CashflowRowBase[]): MonthFlow[] {
  return [...groupBy(rows, r => r.month)].sort(([a], [b]) => a.localeCompare(b))
    .map(([month, group]) => monthTotals(group, month) ?? { month, income: null, active: null, passive: null, expense: null, net: null })
}

/** Rows from `startMonth` to `endMonth`, both inclusive; a null start keeps all earlier months. */
export function windowRows(rows: CashflowRowBase[], endMonth: string | null, startMonth: string | null): CashflowRowBase[] {
  if (!endMonth) return []
  const start = startMonth ?? ''
  return rows.filter(r => r.month >= start && r.month <= endMonth)
}

/** Savings rate, %: (income − expenses) ÷ income; null without income. One formula for cash flow and health. */
export function savingsRate(income: number, expense: number): number | null {
  return income > 0 ? ((income - expense) / income) * 100 : null
}

/** How many months of expenses liquid money covers; null without expenses. */
export function emergencyMonths(liquid: number, expense: number): number | null {
  return expense > 0 ? liquid / expense : null
}

/** The months of the "now" averages (`avg3m`, the advisor's figures), ending at the closed month */
export const AVERAGE_MONTHS = 3

/** A row with an amount that had no rate: its month's totals are unknown, not that amount short. */
export const ratelessRow = (r: CashflowRowBase) => r.activeBase === null || r.passiveBase === null || r.expenseBase === null

/** The rows of the `months` up to `endMonth` that monthly averages read: a month with a rateless row is left out. */
export function averagedRows(rows: CashflowRowBase[], endMonth: string | null, months: number): CashflowRowBase[] {
  const rateless = new Set(rows.filter(ratelessRow).map(r => r.month))
  return windowRows(rows, endMonth, endMonth && Number.isFinite(months) ? shiftMonth(endMonth, -(months - 1)) : null)
    .filter(r => !rateless.has(r.month))
}

/** Monthly averages over the window (`averagedRows`); the divisor is the number of months with data. */
export function summarize(rows: CashflowRowBase[], endMonth: string | null, months: number): SavingsSummary {
  const window = averagedRows(rows, endMonth, months)
  const n = new Set(window.map(r => r.month)).size
  const t = totals(window)!
  const d = Math.max(1, n)
  const rate = savingsRate(t.income, t.expense)
  return {
    months: n,
    expensePerMonth: round2(t.expense / d),
    passivePerMonth: round2(t.passive / d),
    netPerMonth: round2((t.income - t.expense) / d),
    ratePct: rate === null ? null : round2(rate),
  }
}

export type CashflowGroupBy = 'month' | 'member' | 'account' | 'currency'
/** A group's sums; null — a row of it has no rate */
export interface CashflowGroup {
  month?: string; bank?: string; member?: string; currency?: string
  income: number | null; active: number | null; passive: number | null; expense: number | null
}

export function groupCashflow(rows: CashflowRowBase[], by: CashflowGroupBy): CashflowGroup[] {
  const dims = (r: CashflowRowBase) =>
    by === 'month' ? { month: r.month }
      : by === 'member' ? { member: r.member }
        : by === 'currency' ? { currency: r.currency }
          : { bank: r.bank, member: r.member }
  const groups = new Map<string, { dims: ReturnType<typeof dims>; rows: CashflowRowBase[] }>()
  for (const r of rows) {
    const d = dims(r)
    const key = JSON.stringify(d)
    const group = groups.get(key)
    if (group) group.rows.push(r)
    else groups.set(key, { dims: d, rows: [r] })
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, g]) => {
      const t = totals(g.rows)
      return t ? { ...g.dims, income: round2(t.income), active: round2(t.active), passive: round2(t.passive), expense: round2(t.expense) }
        : { ...g.dims, income: null, active: null, passive: null, expense: null }
    })
}
