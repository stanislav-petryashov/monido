// Page-shaped views over the one snapshot the dashboard loads. Pure functions.
import { emergencyMonths, trend, windowRows } from '../domain/cashflow'
import { accountKey } from '../domain/accounts'
import { liquidKnown, partialCapitalMonths } from '../domain/overviewBlocks'
import { monthOf, monthsBetween, shiftMonth } from '../domain/dates'
import { round2 } from '../domain/fx'
import { ANNUAL_RETURN, computeCagr, realReturn } from '../domain/goals'
import { METRICS, type Fact, type MetricKey } from '../domain/metricCatalog'
import type {
  FinanceSnapshot, FireSummary, GoalItem, GoalsPlan, GrowthBeyondSavings, HistoryPoint, Inflation, MonthTotals, ReturnSkipReason,
  SavingsSummary, Warning,
} from '../domain/types'
import { t } from '../i18n/client'
import { fmtMonthYear, fmtMonths, fmtPct } from './formatters'
import { flowStart, type PeriodKey } from './period'
import type { MonthlyTrendRow, NetWorthTotals } from './types'

/**
 * The month the dashboard data is for: the last closed month with flows,
 * else the balances' month (Cash flow off or no flows yet); null — no data at all.
 */
export function dataMonth(asOf: FinanceSnapshot['asOf']): string | null {
  return asOf.closedMonth ?? (asOf.capitalDate ? monthOf(asOf.capitalDate) : null)
}

export interface OverviewMetrics {
  nw: NetWorthTotals
}

export function overviewMetrics(s: FinanceSnapshot): OverviewMetrics {
  const c = s.capital
  return {
    nw: { assets_total: c?.assets ?? 0, liabilities_total: c?.liabilities ?? 0, net_worth: c?.netWorth ?? 0 },
  }
}

/** months — the length of the window the growth is computed over */
export interface Growth { months: number; cagrPct: number | null; doublingYears: number | null }

/**
 * Net worth growth per year over the history points inside the period (the same computeCagr as the FIRE goal)
 * and the doubling time by the rule of 72; no base — no estimate.
 * months in the result — months between the first and the last point: the history may have gaps.
 */
/** The same growth methodology over the actual points in an explicitly selected range. */
export function growthForHistory(points: HistoryPoint[]): Growth {
  const first = points[0]
  const last = points[points.length - 1]
  const span = first ? monthsBetween(monthOf(first.date), monthOf(last.date)) : 0
  // net worth went negative — growth is undefined (computeCagr does not rule this out)
  // the caller passes known points only (CapitalHistoryPanel leaves partial months out and shows growth only when complete)
  const cagr = last && last.netWorth > 0 && Number.isFinite(last.netWorth) && Number.isFinite(first.netWorth) ? computeCagr(points, new Set()) : null
  if (cagr === null || !Number.isFinite(cagr)) return { months: span, cagrPct: null, doublingYears: null }
  const cagrPct = cagr * 100
  if (!Number.isFinite(cagrPct)) return { months: span, cagrPct: null, doublingYears: null }
  return { months: span, cagrPct, doublingYears: cagrPct > 0 ? 72 / cagrPct : null }
}

export function cashflowView(s: FinanceSnapshot, period: PeriodKey): { month: MonthTotals | null; monthlyTrend: MonthlyTrendRow[] } {
  const end = s.asOf.closedMonth
  const rows = windowRows(s.cashflow.rows, end, end ? flowStart(period, end) : null)
  return {
    month: s.cashflow.closedMonth,
    monthlyTrend: trend(rows).map(t => (t.net === null ? { month: t.month, income: null, expense: null, net: null } : { month: t.month, income: t.income, expense: t.expense, net: t.net })),
  }
}

/** The Overview's cash flow: the closed month beside the month before it, and the last twelve months as bars */
export interface OverviewFlow {
  /** The closed month's totals; null — no closed month with flows */
  month: MonthTotals | null
  /** The month right before the closed one, from the rows; null — not in the rows (a gap is not bridged) or its totals are unknown (no rate) */
  previous: Extract<MonthlyTrendRow, { net: number }> | null
  /** The months of the year up to the closed one, oldest first, as the rows give them */
  trend: MonthlyTrendRow[]
  /** The nets of `trend` added up; null — no months, or a month's totals are unknown (no rate) */
  netTotal: number | null
}

export function overviewFlow(s: FinanceSnapshot): OverviewFlow {
  const { month, monthlyTrend: trend } = cashflowView(s, '1y')
  const closed = s.asOf.closedMonth
  const before = closed ? trend.find(r => r.month === shiftMonth(closed, -1)) : undefined
  const previous = before && before.net !== null ? before : null
  const unknown = !trend.length || trend.some(r => r.net === null)
  return { month, previous, trend, netTotal: unknown ? null : round2(trend.reduce((sum, r) => sum + r.net!, 0)) }
}

export interface GoalMetrics {
  goals: GoalItem[]
  plan: GoalsPlan
  fire: FireSummary | null
  avg3m: SavingsSummary
  /** Capital growth per year over the whole history, the family's savings included, %; null — fewer than two points */
  actualCagrPct: number | null
  /** Growth beyond savings with its inputs; null — income and expenses are not tracked */
  beyondSavings: GrowthBeyondSavings | null
  /** Growth beyond savings per year, %; null — not tracked, or too few usable months */
  beyondSavingsPct: number | null
  /** Growth per year needed by the independence goal's deadline, %; null — no goal or no defined pace */
  requiredCagrPct: number | null
  /** The inflation, % and the currency it is measured in; null — not set */
  inflation: Inflation | null
  /** The assumed return minus inflation, %; null — the inflation or its currency is not set */
  realReturnPct: number | null
}

/** Share → percent; no share — no percent */
const pct = (ratio: number | null | undefined) => (ratio == null ? null : ratio * 100)

export function goalMetrics(s: FinanceSnapshot): GoalMetrics {
  const inflation = s.inflation
  return {
    goals: s.goals.items,
    plan: s.goals.plan,
    fire: s.goals.fire,
    avg3m: s.cashflow.avg3m,
    actualCagrPct: pct(computeCagr(s.history, partialCapitalMonths(s))),
    beyondSavings: s.growthBeyondSavings,
    beyondSavingsPct: pct(s.growthBeyondSavings?.annualRate),
    requiredCagrPct: pct(s.goals.fire?.requiredCagr),
    inflation,
    realReturnPct: inflation === null ? null : realReturn(ANNUAL_RETURN, inflation.ratePct / 100) * 100,
  }
}

/** What a metric's «How it is calculated» lists: its value first, then the catalog's facts. */
export const explanationFacts = (s: FinanceSnapshot, key: MetricKey): Fact[] => [METRICS[key].value(s), ...METRICS[key].facts(s)]

/** Months named per skip reason; the rest are counted */
const SKIPPED_NAMED = 6
const SKIP_REASONS: readonly ReturnSkipReason[] = ['no_balance', 'no_rate', 'no_cashflow', 'nonpositive_start']

/**
 * The lines under growth beyond savings in its explanation, all from the domain's own numbers: the months used,
 * the latest used month with its figures substituted, and the months left out by reason. Amounts go through `money`.
 */
export function beyondSavingsNotes(g: GrowthBeyondSavings, money: (v: number) => string): string[] {
  // how many months were used is already a row of the panel's inputs (the catalog's `monthsUsedOf` fact)
  const notes: string[] = []
  const last = g.months.at(-1)
  if (last) {
    notes.push(t('metrics.explain.lastMonth', {
      month: fmtMonthYear(last.month), start: money(last.startNetWorth), saving: money(last.saving), end: money(last.endNetWorth),
      rate: fmtPct(last.monthlyRate * 100, { sign: true }),
    }))
  }
  for (const reason of SKIP_REASONS) {
    const months = g.monthsSkipped.filter(m => m.reason === reason).map(m => fmtMonthYear(m.month))
    if (!months.length) continue
    const named = months.slice(0, SKIPPED_NAMED).join(', ')
    const list = months.length > SKIPPED_NAMED ? `${named} ${t('metrics.explain.more', { n: months.length - SKIPPED_NAMED })}` : named
    notes.push(t(`metrics.explain.skipped.${reason}`, { months: list }))
  }
  return notes
}

/** short — the label for the phone list: «3 mo: −73.1%» */
export interface CompareRow { label: string; short: string; value: string }
export interface CompareView { value: string; rows: CompareRow[] }
export type CompareKey = 'cashflow_net' | 'savings_rate' | 'emergency_months' | 'passive_income'
/** A metric's main number is the closed month; next to it the same values over 3- and 12-month windows. */
export function compareView(s: FinanceSnapshot, key: CompareKey, money: (usd: number) => string): CompareView {
  const { closedMonth, avg3m, avg12m } = s.cashflow
  const cash = (v: number | null | undefined) => (v === null || v === undefined ? '—' : money(v))
  const windows = (pick: (w: typeof avg3m) => string): CompareRow[] => [
    { label: t('metrics.fact.avg3m'), short: t('units.months', { count: 3, value: 3 }), value: avg3m.months > 0 ? pick(avg3m) : '—' },
    { label: t('metrics.fact.avg12m'), short: t('units.months', { count: 12, value: 12 }), value: avg12m.months > 0 ? pick(avg12m) : '—' },
  ]
  switch (key) {
    case 'cashflow_net':
      return { value: cash(closedMonth?.net), rows: windows(w => money(w.netPerMonth)) }
    case 'passive_income':
      return { value: cash(closedMonth?.passive), rows: windows(w => money(w.passivePerMonth)) }
    // cash-flow numbers, not the health report's: they stay without a report
    case 'savings_rate':
      return { value: fmtPct(s.cashflow.savingsRatePct), rows: windows(w => fmtPct(w.ratePct)) }
    case 'emergency_months': {
      // a bank account missing or without a rate: the liquid money is unknown, so is the cushion
      const typical = s.capital && liquidKnown(s) && avg3m.months > 0 ? emergencyMonths(s.capital.liquid, avg3m.expensePerMonth) : null
      return {
        value: fmtMonths(s.cashflow.emergencyMonths),
        rows: [{ label: t('cards.compare.typical'), short: t('cards.compare.typicalShort'), value: fmtMonths(typical) }],
      }
    }
  }
}

/** The warning changes the totals themselves (no rate, empty database), not just a reminder of a gap. */
export function isDistorting(w: Warning): boolean {
  return w.code === 'fx_unknown_currency' || w.code === 'fx_fallback' || w.code === 'empty_data'
}

/** Existing warnings for a section's inputs; unknown rates require an unavailable conversion and matching opaque ref/currency. */
export function calculationWarnings(s: FinanceSnapshot, sources: readonly ('capital' | 'cashflow' | 'goals')[]): Warning[] {
  const unavailableRefs = new Set<string>()
  const dates = new Set<string>()
  const currencyDates = new Set<string>()
  if (sources.includes('capital')) {
    for (const point of s.history) dates.add(point.date)
    if (s.capital) {
      dates.add(s.capital.date)
      for (const a of s.capital.accounts) if (a.valueBase === null) unavailableRefs.add(JSON.stringify([accountKey(a.name, a.member), a.currency]))
      for (const r of s.capital.realEstate) if (r.valueBase === null) unavailableRefs.add(JSON.stringify([`real_estate:${r.name}`, r.currency]))
      for (const l of s.capital.loans) if (l.balanceBase === null) unavailableRefs.add(JSON.stringify([`loan:${l.name}`, l.currency]))
    }
  }
  if (sources.includes('cashflow')) {
    for (const r of s.cashflow.rows) {
      if (r.currency !== s.baseCurrency) {
        currencyDates.add(`${r.currency} ${r.month}-01`)
        currencyDates.add(`${s.baseCurrency} ${r.month}-01`)
      }
      if (r.expenseBase === null || r.activeBase === null || r.passiveBase === null) {
        unavailableRefs.add(JSON.stringify([r.loan ? `loan:${r.bank}` : accountKey(r.bank, r.member), r.currency]))
      }
    }
  }
  if (sources.includes('goals')) {
    for (const g of s.goals.items) {
      if (g.targetBase === null || g.currentBase === null) unavailableRefs.add(JSON.stringify([`goal:${g.id}`, g.currency]))
      if (g.currency !== s.baseCurrency) {
        currencyDates.add(`${g.currency} ${s.generatedAt.slice(0, 10)}`)
        currencyDates.add(`${s.baseCurrency} ${s.generatedAt.slice(0, 10)}`)
      }
    }
  }
  return s.warnings.filter(w => {
    if (w.code === 'missing_balance') return sources.includes('capital')
    if (w.code === 'missing_cashflow') return sources.includes('cashflow')
    if (w.code === 'fx_unknown_currency') return w.ref !== undefined && unavailableRefs.has(JSON.stringify([w.ref, w.params?.currency]))
    // A fallback names a rate date, not an affected row: keep it at section level.
    return w.code === 'fx_fallback' && typeof w.params?.date === 'string'
      && (dates.has(w.params.date) || currencyDates.has(`${w.params.currency} ${w.params.date}`))
  })
}

/** A warning's text in the UI language; the open-month one lists its months with their accounts. */
export function warningText(w: Warning): string {
  const params = w.params ?? {}
  if (w.code !== 'open_month_rows') return t(`warnings.${w.code}`, params)
  const months = (params.months ?? []) as readonly string[]
  const list = months
    .map(month => t('warnings.open_month_entry', { month, names: ((params[month] ?? []) as readonly string[]).join(', ') }))
    .join('; ')
  return t('warnings.open_month_rows', { list, context: Number(params.more) > 0 ? 'more' : undefined })
}
