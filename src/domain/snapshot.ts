import { accountKey, latestPerAccount, normalizeClass } from './accounts'
import { capitalAt, capitalHistory, toHistoryPoint } from './capital'
import { AVERAGE_MONTHS, PLAN_MONTHS, byMonthMemberName, closedMonth, convertCashflow, convertLoanPayments, emergencyMonths, groupBy, monthTotals, savingsRate, summarize } from './cashflow'
import { isoDate, latestMonth, monthEnd, monthOf, shiftMonth } from './dates'
import { openMonths, type AccountClosure } from './monthClose'
import { convert, convertRounded, round2 } from './fx'
import { categorisedMonths, mandatoryMonths, mandatorySpending } from './spending'
import {
  ANNUAL_RETURN, allocateGoals, expectedReturn, fireReturnRange, unknownSavingsPlan, computeCagr, computeCoastFire, fireValues, isFireGoal,
  monthsUntil, realReturn, requiredCagr,
} from './goals'
import { computeHealth } from './health'
import { computeGrowthBeyondSavings } from './returns'
import type {
  AccountLifecycleEvidence, CapitalSnapshot, CashflowRowBase, FinanceRows, FinanceSnapshot, FireSummary, GoalItem, GoalRow, Inflation, MsgParams, Rates, RateLookup, Warning,
} from './types'

/** Warnings that name a member — shared by the snapshot and the prompt tests. */
export function missingBalanceWarning(name: string, member: string, month: string): Warning {
  return { code: 'missing_balance', ref: accountKey(name, member), params: { name, member, month } }
}
export function missingCashflowWarning(bank: string, member: string, month: string): Warning {
  return { code: 'missing_cashflow', ref: accountKey(bank, member), params: { name: bank, member, month } }
}

/** Months named in the open-month warning; the rest are counted. */
const OPEN_MONTHS_NAMED = 3

const sameParams = (a: MsgParams | undefined, b: MsgParams | undefined) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})

/** Every day a rate is needed for: balance month ends, cash-flow and loan-payment months, today. */
export function requiredRateDates(rows: Pick<FinanceRows, 'assets' | 'cashflow' | 'loanPayments' | 'categorySpending'>, today: Date): string[] {
  const dates = new Set<string>([isoDate(today)])
  for (const a of rows.assets) dates.add(monthEnd(monthOf(a.date)))
  for (const c of rows.cashflow) dates.add(`${monthOf(c.date)}-01`)
  for (const p of rows.loanPayments) dates.add(`${monthOf(p.date)}-01`)
  for (const s of rows.categorySpending) dates.add(`${monthOf(s.date)}-01`)
  return [...dates].sort()
}

/**
 * Every currency a rate is needed for, sorted, without USD: the project's currencies, the inflation currency and each
 * currency the rows actually use (a row may keep a currency that has since left the project list).
 */
export function requiredRateCurrencies(rows: FinanceRows): string[] {
  const codes = new Set<string>(rows.currencies)
  if (rows.inflationCurrency) codes.add(rows.inflationCurrency)
  for (const a of rows.assets) codes.add(a.currency)
  for (const c of rows.cashflow) codes.add(c.currency)
  for (const p of rows.loanPayments) codes.add(p.currency)
  for (const s of rows.categorySpending) codes.add(s.currency)
  if (rows.manualMandatory) codes.add(rows.manualMandatory.currency)
  for (const r of rows.realEstate) { codes.add(r.currency); codes.add(r.purchase_currency) }
  for (const l of rows.loans) codes.add(l.currency)
  for (const g of rows.goals) codes.add(g.currency)
  codes.delete('USD')
  return [...codes].sort()
}

const rounded = (v: number | null) => (v === null ? null : round2(v))

/**
 * The inflation real growth is measured against — no default: both the rate and its currency must be set. Inflation
 * belongs to the currency the family spends in, so the two net worths real growth compares are taken in that currency
 * (each at its own month-end rate), whatever the snapshot's base; they are null without a latest or a year-ago point,
 * without a rate of the inflation currency on that date, or when that month's capital is partial (`known`).
 */
function inflationOf(
  rows: FinanceRows, rateAt: RateLookup, latest: CapitalSnapshot | null, yearAgo: CapitalSnapshot | null, known: (month: string) => boolean,
): Inflation | null {
  const ratePct = rows.parameters.inflation_rate
  const currency = rows.inflationCurrency
  if (ratePct === undefined || !currency) return null
  if (!latest || !yearAgo) return { ratePct, currency, netWorthNow: null, netWorthYearAgo: null }
  const netWorthIn = (c: CapitalSnapshot) =>
    !known(monthOf(c.date)) || convert(1, 'USD', currency, rateAt(c.date)) === null ? null : capitalAt(rows, monthOf(c.date), rateAt, currency).netWorth
  return { ratePct, currency, netWorthNow: netWorthIn(latest), netWorthYearAgo: netWorthIn(yearAgo) }
}

/**
 * Net worth growth over the year beyond inflation, %, in the inflation currency: (1 + growth) / (1 + inflation) − 1, what a
 * year-ago amount buys now (realReturn); null — not computable or a year ago ≤ 0.
 */
function realGrowthYoy(inflation: Inflation | null): number | null {
  if (!inflation) return null
  const { netWorthNow: now, netWorthYearAgo: then, ratePct } = inflation
  if (now === null || then === null || then <= 0) return null
  return realReturn(now / then - 1, ratePct / 100) * 100
}

export interface SnapshotInputs {
  rows: FinanceRows
  rateAt: RateLookup
  /** The currency every amount of the snapshot is converted to, each at the rate of its own date */
  baseCurrency: string
  /** The family's default currency, echoed into the snapshot so the client can mark it; the domain does not use it */
  familyCurrency: string
  today: Date
}

/**
 * While the family does not track income and expenses, the snapshot reads no flows: the stored ones stay in their tables
 * and count again once tracking is back on. Every flow figure then shows its "no data" state, not a zero.
 */
function withoutFlows(rows: FinanceRows): FinanceRows {
  return { ...rows, cashflow: [], loanPayments: [], spendingCategories: [], categorySpending: [], flowLines: [], manualMandatory: null }
}

/** context: the name is not a title (the reserved category, the manual amount) — the client words it by the context, not by `name` */
function unknownCurrency(currency: string, name: string, ref: string, context?: string): Warning {
  return { code: 'fx_unknown_currency', ref, params: context ? { currency, name, context } : { currency, name } }
}

/** Rows of months that are not closed yet: the months named (as many as OPEN_MONTHS_NAMED), and per month its account names. */
function openMonthWarning(outside: { month: string; name: string }[]): Warning {
  const months = [...new Set(outside.map(o => o.month))].sort()
  // params: `months` — the named months; per month, its account names under the month itself
  const named = months.slice(0, OPEN_MONTHS_NAMED)
  const params: MsgParams = { months: named, more: months.length - named.length }
  for (const m of named) params[m] = [...new Set(outside.filter(o => o.month === m).map(o => o.name))]
  return { code: 'open_month_rows', params }
}

/** Cashflow gaps stay distinct from canonical capital coverage. */
function missingCashflowWarnings(
  closed: string | null, accountRowsByMonth: Map<string, CashflowRowBase[]>, closures: AccountClosure[],
): Warning[] {
  const out: Warning[] = []
  const closedIn = new Map(closures.map(c => [accountKey(c.name, c.member), c.closedMonth]))
  const closedBy = (name: string, member: string, month: string) => closedIn.get(accountKey(name, member)) === month
  if (closed) {
    // a loan payment is not an account: a finished loan has no row this month, and that is no gap
    const prevMonth = latestMonth([...accountRowsByMonth.keys()].filter(m => m < closed))
    const now = accountRowsByMonth.get(closed) ?? []
    for (const r of (prevMonth && accountRowsByMonth.get(prevMonth)) || []) {
      if (closedBy(r.bank, r.member, r.month)) continue
      if (!now.some(x => x.bank === r.bank && x.member === r.member)) {
        out.push(missingCashflowWarning(r.bank, r.member, closed))
      }
    }
  }
  return out
}

/** Every amount the snapshot shows or sums that has no rate: every month's balances (history counts them as 0), the cashflow rows, the category spending. */
function unknownRateWarnings(history: CapitalSnapshot[], cfRows: CashflowRowBase[], rows: FinanceRows, rateAt: RateLookup, base: string): Warning[] {
  const out: Warning[] = []
  for (const point of history) {
    for (const a of point.accounts) if (a.valueBase === null) out.push(unknownCurrency(a.currency, a.name, accountKey(a.name, a.member)))
    for (const r of point.realEstate) if (r.valueBase === null) out.push(unknownCurrency(r.currency, r.name, `real_estate:${r.name}`))
    for (const l of point.loans) if (l.balanceBase === null) out.push(unknownCurrency(l.currency, l.name, `loan:${l.name}`))
  }
  for (const r of cfRows) if (r.expenseBase === null || r.activeBase === null || r.passiveBase === null) out.push(unknownCurrency(r.currency, r.bank, r.loan ? `loan:${r.bank}` : accountKey(r.bank, r.member)))
  for (const r of rows.categorySpending) {
    const category = rows.spendingCategories.find(c => c.id === r.category_id)
    const name = category?.name
    const kind = category?.kind
    if (name !== undefined && convert(r.amount, r.currency, base, rateAt(`${monthOf(r.date)}-01`)) === null) out.push(unknownCurrency(r.currency, name, `category:${r.category_id}`, kind === 'loan_payment' ? 'loan_payments' : undefined))
  }
  return out
}

/**
 * The FIRE goal's summary at today's rates; null without such a goal or without a rate for its currency (the goal already has an
 * fx_unknown_currency warning). Its forecast is the plan's own month (allocateGoals grows it at `annualReturn`, the family's
 * expected return); the strategies
 * re-run that plan at the low and high returns of fireReturnRange (the band around the base; a different saving is the Goals
 * page's own "what if"). `monthlySavings` null — unknown: no forecast.
 * @public (exported for the page tests' fixtures)
 */
export function fireSummary(
  goals: GoalRow[], todayRates: Rates, base: string, monthlySavings: number | null, today: Date, history: CapitalSnapshot[],
  partial: ReadonlySet<string> = new Set(), annualReturn = ANNUAL_RETURN,
): FireSummary | null {
  const fireGoal = goals.find(isFireGoal)
  if (!fireGoal) return null
  const targetBase = convert(fireGoal.target, fireGoal.currency, base, todayRates)
  const currentBase = convert(fireGoal.current, fireGoal.currency, base, todayRates)
  if (targetBase === null || currentBase === null) return null
  // The projection starts from what the goal has saved — the same amount as its progress. Net worth
  // includes housing, which earns no return and will not be sold for the goal.
  const months = monthsUntil(fireGoal.target_date, today)
  const reached = currentBase >= targetBase
  const run = (saving: number, rate: number) => {
    const a = allocateGoals(goals, saving, today, todayRates, base, undefined, rate).allocations.find(x => x.goal.id === fireGoal.id)!
    return { month: a.projectedDate, values: fireValues(currentBase, a.shares, rate, a.shares.length).map(round2), shares: a.shares }
  }
  const pace = monthlySavings === null ? null : run(monthlySavings, annualReturn)
  const range = fireReturnRange(annualReturn)
  const low = monthlySavings === null ? null : run(monthlySavings, range.low)
  const high = monthlySavings === null ? null : run(monthlySavings, range.high)
  return {
    goalId: fireGoal.id,
    targetBase: round2(targetBase),
    currentBase: round2(currentBase),
    progressPct: targetBase > 0 ? round2((currentBase / targetBase) * 100) : 0,
    reached,
    // a reached goal is not in the plan's months: it is reached now, whatever is saved
    forecastMonth: reached ? monthOf(isoDate(today)) : pace?.month ?? null,
    atDeadlineBase: pace ? round2(fireValues(currentBase, pace.shares, annualReturn, months)[months]) : null,
    strategies: { low: low?.month ?? null, high: high?.month ?? null },
    series: pace && low && high ? { pace: pace.values, low: low.values, high: high.values } : null,
    coastFire: computeCoastFire(currentBase, targetBase, annualReturn, months),
    actualCagr: computeCagr(history.map(toHistoryPoint), partial),
    requiredCagr: requiredCagr(currentBase, targetBase, months),
  }
}

export function buildSnapshot({ rows, rateAt, baseCurrency: base, familyCurrency, today }: SnapshotInputs): FinanceSnapshot {
  const warnings: Warning[] = []
  // one warning per distinct text: the text follows from the code and the params
  const warn = (w: Warning) => {
    if (!warnings.some(x => x.code === w.code && sameParams(x.params, w.params))) warnings.push(w)
  }

  const trackFlows = rows.trackFlows
  if (!trackFlows) rows = withoutFlows(rows)
  // The dashboard sees closed months only: a half-entered month must not drag net worth down.
  const closedSet = new Set(rows.closedMonths.map(m => m.month))
  const all = rows
  rows = {
    ...all,
    assets: all.assets.filter(a => closedSet.has(monthOf(a.date))),
    cashflow: all.cashflow.filter(c => closedSet.has(monthOf(c.date))),
    loanPayments: all.loanPayments.filter(p => closedSet.has(monthOf(p.date))),
    categorySpending: all.categorySpending.filter(s => closedSet.has(monthOf(s.date))),
    flowLines: all.flowLines.filter(l => closedSet.has(monthOf(l.date))),
  }
  // the rows of open months, named: «there are some rows» does not help to find them
  const outside = [
    ...all.assets.filter(a => !closedSet.has(monthOf(a.date))).map(a => ({ month: monthOf(a.date), name: a.name })),
    ...all.cashflow.filter(c => !closedSet.has(monthOf(c.date))).map(c => ({ month: monthOf(c.date), name: c.bank })),
  ]

  const history = capitalHistory(rows, rateAt, base)
  const latest = history.at(-1) ?? null
  const historyByMonth = new Map(history.map(c => [monthOf(c.date), c]))
  // the capital at the end of the month n months before the latest one; null — that month has no observation
  const back = (n: number) => (latest && historyByMonth.get(shiftMonth(monthOf(latest.date), -n))) ?? null
  const prev = back(1)
  const yearAgo = back(12)

  const cfRows = [...convertCashflow(rows.cashflow, rateAt, base), ...convertLoanPayments(rows.loanPayments, rows.loans, rateAt, base)]
    .sort(byMonthMemberName)
  const closed = closedMonth(cfRows)
  // a closed month with a rateless row has unknown totals: counting that row as 0 would fake the savings rate and health
  const closedTotals = closed ? monthTotals(cfRows, closed) : null
  const avg3m = summarize(cfRows, closed, AVERAGE_MONTHS)
  const avg12m = summarize(cfRows, closed, PLAN_MONTHS)
  // the emergency fund is months of the year's average expenses (loan payments included), not of one month's
  const fundExpense = avg12m.months > 0 ? avg12m.expensePerMonth : null
  const spendingByMonth = categorisedMonths(rows, rows.spendingCategories, cfRows, 'expense', rateAt, base, warn)
  const incomeByMonth = categorisedMonths(rows, rows.spendingCategories, cfRows, 'income', rateAt, base, warn)
  const growthBeyondSavings = trackFlows ? computeGrowthBeyondSavings(history, cfRows) : null

  const endpoint = latest ? monthOf(latest.date) : null
  const closures = new Map((rows.closures ?? [])
    .filter(c => endpoint && c.closedMonth <= endpoint && closedSet.has(c.closedMonth))
    .map(c => [accountKey(c.name, c.member), c.closedMonth]))
  const observations = groupBy(rows.assets.filter(a => a.class !== 'real_estate' && a.class !== 'loan'), a => monthOf(a.date))
  const seen = new Map<string, { evidence: AccountLifecycleEvidence; class: ReturnType<typeof normalizeClass>; currency: string }>()
  const capitalCoverage: NonNullable<FinanceSnapshot['capitalCoverage']> = []
  for (const month of [...closedSet].sort()) {
    for (const a of latestPerAccount(observations.get(month) ?? [])) {
      const key = accountKey(a.name, a.member)
      const member = a.member ?? ''
      const previous = seen.get(key)
      seen.set(key, {
        evidence: { name: a.name, member, firstObservedMonth: previous?.evidence.firstObservedMonth ?? month, lastObservedMonth: month, closedMonth: closures.get(key) ?? null },
        class: normalizeClass(a.class), currency: a.currency,
      })
    }
    const missingAccounts = [...seen.values()].filter(({ evidence: a }) =>
      a.lastObservedMonth < month && !(a.closedMonth && a.closedMonth >= a.lastObservedMonth && a.closedMonth < month),
    ).map(({ evidence: a, class: accountClass, currency }) => ({ name: a.name, member: a.member, class: accountClass, currency, lastObservedMonth: a.lastObservedMonth }))
      .sort((a, b) => accountKey(a.name, a.member).localeCompare(accountKey(b.name, b.member)))
    const capital = historyByMonth.get(month)
    const known = (values: (number | null)[]) => values.every(v => v !== null && Number.isFinite(v))
    const assetsKnown = !!capital && missingAccounts.length === 0 && known([...capital.accounts.map(a => a.valueBase), ...capital.realEstate.map(a => a.valueBase)])
    const capitalKnown = assetsKnown && !!capital && known(capital.loans.map(l => l.balanceBase))
    // the liquid money is the bank accounts': known when each is observed this month and converts
    const liquidKnown = !!capital && !missingAccounts.some(a => a.class === 'bank') && known(capital.accounts.filter(a => a.class === 'bank').map(a => a.valueBase))
    capitalCoverage.push({ month, assetsKnown, liquidKnown, capitalKnown, missingAccounts })
  }
  const accountLifecycle = [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value.evidence)

  // indexed by month once: each closed month below looks up its rows
  const cfByMonth = groupBy(cfRows, r => r.month)
  const accountRowsByMonth = groupBy(cfRows.filter(r => !r.loan), r => r.month)
  const coverageByMonth = new Map(capitalCoverage.map(c => [c.month, c]))
  const latestCoverage = (endpoint && coverageByMonth.get(endpoint)) || { liquidKnown: false, capitalKnown: false }
  // a month whose net worth is partial (a balance missing or without a rate) gives no change, growth or real growth
  const capitalKnownIn = (month: string) => coverageByMonth.get(month)?.capitalKnown === true
  const partial = new Set(capitalCoverage.filter(c => !c.capitalKnown).map(c => c.month))
  const knownChange = (from: CapitalSnapshot | null) =>
    latest && from && capitalKnownIn(monthOf(latest.date)) && capitalKnownIn(monthOf(from.date)) ? round2(latest.netWorth - from.netWorth) : null
  const inflation = inflationOf(rows, rateAt, latest, yearAgo, capitalKnownIn)
  const analysisMonths = [...closedSet].sort().map(month => {
    const capital = historyByMonth.get(month) ?? null
    const missing = missingCashflowWarnings(month, accountRowsByMonth, rows.closures ?? [])
    const flows = cfByMonth.get(month) ?? []
    const capitalKnown = coverageByMonth.get(month)?.capitalKnown === true
    const cashflowKnown = flows.length > 0 && !missing.some(w => w.code === 'missing_cashflow')
      && flows.every(r => [r.activeBase, r.passiveBase, r.expenseBase].every(v => v !== null && Number.isFinite(v)))
      && (capital?.accounts ?? []).every(a => flows.some(r => !r.loan && r.bank === a.name && r.member === a.member))
    return { month, capital: capitalKnown, cashflow: cashflowKnown }
  })

  if (!rows.assets.length) warn({ code: 'empty_data', params: { context: 'balances' } })
  if (trackFlows && !rows.cashflow.length) warn({ code: 'empty_data', params: { context: 'cashflow' } })
  if (outside.length) warn(openMonthWarning(outside))
  for (const a of (endpoint && coverageByMonth.get(endpoint)?.missingAccounts) || []) warn(missingBalanceWarning(a.name, a.member, endpoint!))
  for (const w of missingCashflowWarnings(closed, accountRowsByMonth, rows.closures ?? [])) warn(w)
  if (latest && !yearAgo) warn({ code: 'short_history' })
  for (const w of unknownRateWarnings(history, cfRows, rows, rateAt, base)) warn(w)

  // Goals, FIRE and `rates` use today's rate; it is looked up only when needed, so a USD snapshot
  // whose goals are all in USD does not warn about a fallback rate for today.
  const todayDate = isoDate(today)
  const manualNeedsRate = !!rows.manualMandatory && rows.manualMandatory.currency !== base
  const todayRates = rows.goals.some(g => g.currency !== base) || base !== 'USD' || manualNeedsRate ? rateAt(todayDate) : {}
  const items: GoalItem[] = rows.goals.map(g => {
    const targetBase = convertRounded(g.target, g.currency, base, todayRates)
    if (targetBase === null) warn(unknownCurrency(g.currency, g.name, `goal:${g.id}`))
    return { ...g, targetBase, currentBase: convertRounded(g.current, g.currency, base, todayRates) }
  })
  // the year's average, not the last months': a repair or a bonus does not move every goal; not tracked: the savings are
  // unknown, not zero — no shortfall, no pace, no forecast
  const monthlySavings = trackFlows ? Math.max(0, avg12m.netPerMonth) : null
  const annualReturn = expectedReturn(rows.parameters)
  const planned = allocateGoals(rows.goals, monthlySavings ?? 0, today, todayRates, base, undefined, annualReturn)
  const plan = monthlySavings === null ? unknownSavingsPlan(planned) : planned
  const fire = fireSummary(rows.goals, todayRates, base, monthlySavings, today, history, partial, annualReturn)

  const mandatory = mandatorySpending(spendingByMonth, closed, rows.manualMandatory, todayRates, base)
  // the manual amount is the one in use (no mandatory category data) but has no rate
  if (!mandatory && rows.manualMandatory && !mandatoryMonths(spendingByMonth, closed).length) {
    warn(unknownCurrency(rows.manualMandatory.currency, 'mandatory_spending', 'mandatory_spending', 'mandatory_spending'))
  }

  return {
    generatedAt: today.toISOString(),
    baseCurrency: base,
    expectedReturn: annualReturn,
    familyCurrency,
    currencies: rows.currencies,
    members: rows.members,
    asOf: { capitalDate: latest?.date ?? null, closedMonth: closed, openMonths: openMonths([...closedSet], today), today: isoDate(today) },
    rates: base !== 'USD' && todayRates[base] ? { date: todayDate, perUsd: todayRates[base] } : null,
    capital: latest ? {
      ...latest,
      monthDelta: knownChange(prev),
      yoyDelta: knownChange(yearAgo),
    } : null,
    history: history.map(toHistoryPoint),
    analysisMonths,
    accountLifecycle,
    capitalCoverage,
    previousCapital: prev,
    capitalBack: latest ? { quarter: back(3), year: yearAgo, all: history[0] !== latest ? history[0] : null } : undefined,
    growthBeyondSavings,
    cashflow: {
      closedMonth: closedTotals, rows: cfRows, avg3m, avg12m,
      savingsRatePct: rounded(closedTotals && savingsRate(closedTotals.income, closedTotals.expense)),
      emergencyMonths: rounded(latest && fundExpense !== null && latestCoverage.liquidKnown ? emergencyMonths(latest.liquid, fundExpense) : null),
    },
    spending: { months: spendingByMonth, mandatory },
    income: { months: incomeByMonth },
    health: latest ? computeHealth({ capital: latest, month: closedTotals, fundExpense, coverage: latestCoverage, realGrowthYoy: realGrowthYoy(inflation) }) : null,
    goals: { items, plan, fire },
    parameters: rows.parameters,
    inflation,
    trackFlows,
    warnings,
  }
}
