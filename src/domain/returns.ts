// Growth of net worth beyond the family's own savings. Server-only: imported by snapshot.ts, never by the browser.
import { monthTotals, ratelessRow } from './cashflow'
import { monthOf, monthsBetween, shiftMonth } from './dates'
import { round2 } from './fx'
import type { CapitalSnapshot, CashflowRowBase, GrowthBeyondSavings, ReturnMonth, ReturnSkipReason } from './types'

/** Used months below which the annual figure is not given: a few months say little about a year. */
export const MIN_RETURN_MONTHS = 6

/** A point with an amount that had no rate: capital.ts counts it as 0, which would fake a move. */
const hasRatelessAmount = (c: CapitalSnapshot) =>
  c.accounts.some(a => a.valueBase === null) || c.realEstate.some(r => r.valueBase === null) || c.loans.some(l => l.balanceBase === null)

/**
 * Monthly Modified Dietz, chained and annualised over the used months: each month
 * r = (NW_end − NW_start − saving) / (NW_start + saving / 2), the saving being the month's income − expenses of the
 * accounts. Loan payments (`loan` rows) are not part of the saving: a payment moves money from cash to the debt inside
 * net worth, so only its interest lowers net worth, and that counts against the growth. A month without a balance at either
 * end (or with one account's missing there: `partial`, the months whose net worth is partial), with an amount without a rate,
 * without cash-flow rows or with a non-positive start is left out with its reason, never counted as zero.
 * `history` — one point per closed month with balances, ascending; `cfRows` — the closed months' rows in the same currency.
 */
export function computeGrowthBeyondSavings(history: CapitalSnapshot[], cfRows: CashflowRowBase[], partial: ReadonlySet<string> = new Set()): GrowthBeyondSavings {
  const empty: GrowthBeyondSavings = {
    annualRate: null, growthTotal: null, months: [], monthsSkipped: [], monthsConsidered: 0, minMonths: MIN_RETURN_MONTHS,
    startNetWorth: null, endNetWorth: null, savingsTotal: null, growthAmount: null,
  }
  const firstPoint = history[0], lastPoint = history.at(-1)
  if (history.length < 2 || !firstPoint || !lastPoint) return empty
  const byMonth = new Map(history.map(c => [monthOf(c.date), c]))
  const rowsByMonth = new Map<string, CashflowRowBase[]>()
  for (const r of cfRows) rowsByMonth.set(r.month, [...(rowsByMonth.get(r.month) ?? []), r])

  const first = monthOf(firstPoint.date)
  const last = monthOf(lastPoint.date)
  const monthsConsidered = monthsBetween(first, last)
  const months: ReturnMonth[] = []
  const monthsSkipped: { month: string; reason: ReturnSkipReason }[] = []
  for (let i = 1; i <= monthsConsidered; i++) {
    const m = shiftMonth(first, i)
    const start = byMonth.get(shiftMonth(m, -1))
    const end = byMonth.get(m)
    // the accounts' rows only: a loan payment is a transfer inside net worth, not saving
    const rows = (rowsByMonth.get(m) ?? []).filter(r => !r.loan)
    const skip = (reason: ReturnSkipReason) => monthsSkipped.push({ month: m, reason })
    if (!start || !end) { skip('no_balance'); continue }
    if (hasRatelessAmount(start) || hasRatelessAmount(end) || rows.some(ratelessRow)) { skip('no_rate'); continue }
    // an account's balance missing at either end would count as 0: the month's net worth is partial
    if (partial.has(m) || partial.has(shiftMonth(m, -1))) { skip('no_balance'); continue }
    if (!rows.length) { skip('no_cashflow'); continue }
    const saving = monthTotals(rows, m)!.net
    const nw0 = start.netWorth
    const base = nw0 + saving / 2
    if (nw0 <= 0 || base <= 0) { skip('nonpositive_start'); continue }
    months.push({ month: m, startNetWorth: nw0, endNetWorth: end.netWorth, saving, monthlyRate: (end.netWorth - nw0 - saving) / base })
  }
  const firstMonth = months[0], lastMonth = months.at(-1)
  if (!firstMonth || !lastMonth) return { ...empty, monthsSkipped, monthsConsidered }

  const growth = months.reduce((p, m) => p * (1 + m.monthlyRate), 1)
  // a month that lost everything (or more) breaks the chain: no annual figure rather than NaN or a sign flipped twice
  const chainable = months.every(m => 1 + m.monthlyRate > 0)
  const annualRate = months.length >= MIN_RETURN_MONTHS && chainable ? Math.pow(growth, 12 / months.length) - 1 : null
  return {
    annualRate,
    growthTotal: growth - 1,
    months,
    monthsSkipped,
    monthsConsidered,
    minMonths: MIN_RETURN_MONTHS,
    startNetWorth: firstMonth.startNetWorth,
    endNetWorth: lastMonth.endNetWorth,
    savingsTotal: round2(months.reduce((a, m) => a + m.saving, 0)),
    growthAmount: round2(months.reduce((a, m) => a + m.endNetWorth - m.startNetWorth - m.saving, 0)),
  }
}
