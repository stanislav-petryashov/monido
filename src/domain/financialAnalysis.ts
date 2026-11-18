// Question-led financial analysis. Every result uses closed monthly observations; unknown is never zero.
import { MONTH_RE, monthOf, shiftMonth } from './dates'
import { round2 } from './fx'
import type { FinanceSnapshot } from './types'

const finite = (n: number | null): n is number => n !== null && Number.isFinite(n)
const flowKnown = (s: FinanceSnapshot, month: string) => {
  if (s.analysisMonths && !s.analysisMonths.find(m => m.month === month)?.cashflow) return false
  const rows = s.cashflow.rows.filter(r => r.month === month)
  return rows.length > 0 && rows.every(r => [r.activeBase, r.passiveBase, r.expenseBase].every(finite))
}
/** A closed month's income and expenses in the base currency; null while any of its flows is unknown */
export function monthFlow(s: FinanceSnapshot, month: string): { income: number; expense: number } | null {
  if (!flowKnown(s, month)) return null
  const rows = s.cashflow.rows.filter(r => r.month === month)
  return { income: rows.reduce((n, r) => n + r.activeBase! + r.passiveBase!, 0), expense: rows.reduce((n, r) => n + r.expenseBase!, 0) }
}
const hasGaps = (s: FinanceSnapshot) => s.warnings.some(w => ['missing_balance', 'missing_cashflow', 'fx_unknown_currency'].includes(w.code))

/**
 * The bridge over a run of closed months (`months`, contiguous, oldest first): net worth at the end of the month before,
 * what the months saved, the rest, net worth at the end. Null when any month has incomplete capital or cashflow.
 */
export function periodBridge(s: FinanceSnapshot, months: string[]) {
  // the months' own completeness (analysisMonths, checked below) decides; a gap elsewhere (a goal's currency without a
  // rate, another month) does not hide the bridge. An older snapshot without analysisMonths falls back to every warning
  if (!s.trackFlows || !months.length || (!s.analysisMonths && hasGaps(s))) return null
  const from = shiftMonth(months[0], -1), to = months[months.length - 1]
  if (months.some((m, i) => i > 0 && shiftMonth(months[i - 1], 1) !== m)) return null
  if (s.analysisMonths && ![from, ...months].every(m => s.analysisMonths!.find(a => a.month === m)?.capital)) return null
  if (s.growthBeyondSavings?.monthsSkipped.some(m => months.includes(m.month) && ['no_rate', 'no_balance', 'no_cashflow'].includes(m.reason))) return null
  const start = s.history.find(h => monthOf(h.date) === from)?.netWorth ?? null
  const end = s.history.find(h => monthOf(h.date) === to)?.netWorth ?? null
  const flows = months.map(m => monthFlow(s, m))
  if (!finite(start) || !finite(end) || flows.some(f => f === null)) return null
  const saving = round2(flows.reduce((n, f) => n + f!.income - f!.expense, 0))
  return { from, to, start, end, saving, other: round2(end - start - saving) }
}

/** Changes in observed balances, not a causal attribution of the cashflow residual. */
export function capitalMovements(s: FinanceSnapshot) {
  const before = s.previousCapital
  const after = s.capital
  if (!before || !after || monthOf(before.date) !== shiftMonth(monthOf(after.date), -1)) return null
  if (!s.analysisMonths && s.warnings.some(w => ['missing_balance', 'fx_unknown_currency'].includes(w.code))) return null
  if (s.analysisMonths && ![before, after].every(c => s.analysisMonths!.find(m => m.month === monthOf(c.date))?.capital)) return null
  type Item = { kind: 'account' | 'realEstate' | 'loan'; name: string; member: string; amount: number | null }
  const records = (c: typeof before): Item[] => [
    ...c.accounts.map(a => ({ kind: 'account' as const, name: a.name, member: a.member, amount: a.valueBase })),
    ...c.realEstate.map(a => ({ kind: 'realEstate' as const, name: a.name, member: a.member, amount: a.valueBase })),
    ...c.loans.map(a => ({ kind: 'loan' as const, name: a.name, member: a.member, amount: a.balanceBase === null ? null : -a.balanceBase })),
  ]
  const old = records(before), next = records(after)
  if ([...old, ...next].some(r => !finite(r.amount))) return null
  const key = (r: Item) => JSON.stringify([r.kind, r.name, r.kind === 'account' ? r.member : ''])
  const oldByKey = new Map(old.map(r => [key(r), r]))
  const newByKey = new Map(next.map(r => [key(r), r]))
  return [...new Map([...old, ...next].map(r => [key(r), r])).values()].map(r => {
    const start = oldByKey.get(key(r))?.amount ?? 0
    const end = newByKey.get(key(r))?.amount ?? 0
    return { kind: r.kind, name: r.name, member: r.member, start, end, change: round2(end - start) }
  }).filter(r => r.change !== 0).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
}

/** Three contiguous months, all-in expenses (including debt once), known one-off income excluded.
 * Unallocated income remains an estimate; callers must label these as editable historical assumptions.
 */
export function historicalBudget(s: FinanceSnapshot) {
  const end = s.asOf.closedMonth
  if (!end || !s.trackFlows) return null
  const months = Array.from({ length: 3 }, (_, i) => shiftMonth(end, i - 2))
  const flows = months.map(m => monthFlow(s, m))
  if (flows.some(f => f === null)) return null
  let income = 0, expense = 0
  for (const [i, month] of months.entries()) {
    income += flows[i]!.income
    expense += flows[i]!.expense
    const oneOff = s.income.months.find(m => m.month === month)?.categories.filter(c => c.oneOff) ?? []
    if (oneOff.some(c => !finite(c.amountBase))) return null
    income -= oneOff.reduce((sum, c) => sum + c.amountBase!, 0)
  }
  return { income: round2(Math.max(0, income / 3)), expense: round2(expense / 3), months }
}

export interface ForecastInput {
  month: string; horizon: 3 | 6 | 12; starting: number; income: number; expense: number; reserve: number
  incomeLossPct: number; lossMonths: number; expenseIncreasePct: number; purchase: number; purchaseMonth: number; goalContribution: number
}

/** Finite monthly what-if, no yield assumptions and no automatic sale of investments. */
export function forecastCash(input: ForecastInput) {
  const { month, horizon, starting, income, expense, reserve, incomeLossPct, lossMonths, expenseIncreasePct, purchase, purchaseMonth, goalContribution } = input
  if (!MONTH_RE.test(month) || ![3, 6, 12].includes(horizon)) return null
  if (![starting, income, expense, reserve, incomeLossPct, lossMonths, expenseIncreasePct, purchase, purchaseMonth, goalContribution].every(n => Number.isFinite(n) && n >= 0)) return null
  if (incomeLossPct > 100 || expenseIncreasePct > 300 || !Number.isInteger(lossMonths) || lossMonths > 12 || !Number.isInteger(purchaseMonth) || purchaseMonth < 1 || purchaseMonth > horizon) return null
  const points = [{ month, baseline: starting, stress: starting }]
  for (let i = 1; i <= horizon; i++) {
    const previous = points[i - 1]
    const monthlyIncome = income * (i <= lossMonths ? 1 - incomeLossPct / 100 : 1)
    points.push({ month: shiftMonth(month, i), baseline: round2(previous.baseline + income - expense - goalContribution),
      stress: round2(previous.stress + monthlyIncome - expense * (1 + expenseIncreasePct / 100) - goalContribution - (i === purchaseMonth ? purchase : 0)) })
  }
  return { points, minimum: Math.min(...points.map(p => p.stress)), belowReserve: points.find(p => p.stress < reserve)?.month ?? null,
    negative: points.find(p => p.stress < 0)?.month ?? null }
}
