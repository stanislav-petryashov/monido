// Question-led financial analysis. Every result uses closed monthly observations; unknown is never zero.
import { MONTH_RE, shiftMonth } from './dates'
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
