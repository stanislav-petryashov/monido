import { monthOf, monthsBetween } from './dates'
import { computeCagr } from './goals'
import { consumerDebtBase, loanPaymentsBase } from './health'
import { partialCapitalMonths } from './overviewBlocks'
import type { FinanceSnapshot, HealthKey, MsgParams, SavingsSummary } from './types'

/**
 * The metric catalog: what a metric is made of, as data. Shared by the dashboard and the prompts.
 * No prose here: texts live in the locale files under `metrics.<key>.*` (src/lib/metricText.ts).
 */
export type MetricKey =
  | 'net_worth' | 'assets' | 'liabilities' | 'cashflow_net' | 'passive_income' | 'fire_progress'
  | 'growth_beyond_savings' | 'capital_growth'
  | HealthKey

type FactKind = 'money' | 'pct' | 'months' | 'years' | 'count' | 'text' | 'month'
/**
 * One number of a metric. `label` is a translation key; money is in the base currency, as in the snapshot, unless
 * `currency` names its own; a `text` fact's value is a translation key; null — no data.
 */
export interface Fact { label: string; labelParams?: MsgParams; value: number | string | null; kind: FactKind; currency?: string }

type HealthUnit = 'pct' | 'months'
export interface HealthDef {
  unit: HealthUnit
  /** The months are months of income, not of expenses: the card says «mo of income» (`units.monthsOfIncome`) */
  ofIncome?: boolean
  /** Show «+» on positive values */
  signed?: boolean
}

interface MetricDef {
  value(s: FinanceSnapshot): Fact
  facts(s: FinanceSnapshot): Fact[]
  /** The prompt has an extra question (`metrics.<key>.ask`); a function when it fits only sometimes */
  ask?: boolean | ((s: FinanceSnapshot) => boolean)
  health?: HealthDef
}

/** Health metrics must have card settings — the type guarantees it. */
type Catalog = { [K in MetricKey]: K extends HealthKey ? MetricDef & { health: HealthDef } : MetricDef }

const fact = (kind: FactKind) => (name: string, value: number | string | null | undefined): Fact =>
  ({ label: `metrics.fact.${name}`, value: value ?? null, kind })
const money = fact('money')
const pct = fact('pct')
const count = fact('count')

/** The net worth of a point; null when its month is partial (a balance missing or without a rate), as Overview shows it */
const netWorthOf = (s: FinanceSnapshot, p: { date: string; netWorth: number } | null | undefined) =>
  (p && !partialCapitalMonths(s).has(monthOf(p.date)) ? p.netWorth : null)

/** The window average, or null when the window has no months with data. */
const avg = (window: SavingsSummary, field: 'netPerMonth' | 'passivePerMonth' | 'expensePerMonth') =>
  window.months > 0 ? window[field] : null

const healthValue = (key: HealthKey, kind: FactKind) => (s: FinanceSnapshot): Fact =>
  fact(kind)('value', s.health?.metrics[key]?.value)

/** Loans by balance, largest first; paid-off ones are skipped, those without a rate are marked. */
function loanFacts(s: FinanceSnapshot, limit: number): Fact[] {
  const loans = (s.capital?.loans ?? [])
    .filter(l => l.balanceBase === null || l.balanceBase > 0.01)
    .sort((a, b) => (b.balanceBase ?? -1) - (a.balanceBase ?? -1))
  const shown = loans.slice(0, limit).map((l): Fact => ({
    label: 'metrics.fact.loanRate',
    labelParams: { name: l.name, rate: l.rate },
    ...(l.balanceBase === null ? { value: 'metrics.factValue.noRate', kind: 'text' } : { value: l.balanceBase, kind: 'money' }),
  }))
  return loans.length > limit ? [...shown, fact('count')('moreLoans', loans.length - limit)] : shown
}

export const METRICS: Catalog = {
  net_worth: {
    value: s => money('value', netWorthOf(s, s.capital)),
    facts: s => [
      money('assets', s.capital?.assets),
      money('liabilities', s.capital?.liabilities),
      money('monthChange', s.capital?.monthDelta),
      money('yearChange', s.capital?.yoyDelta),
    ],
    // ask about the year only when there is a year of history
    ask: s => s.capital?.yoyDelta != null,
  },
  assets: {
    value: s => money('value', s.capital?.assets),
    facts: s => [
      ...(s.capital?.byClass ?? []).map((c): Fact => ({ label: `accounts.class.${c.class}`, value: c.valueBase, kind: 'money' })),
      money('liquidShare', s.capital?.liquid),
    ],
  },
  liabilities: {
    value: s => money('value', s.capital?.liabilities),
    facts: s => loanFacts(s, 5),
    ask: true,
  },
  cashflow_net: {
    value: s => money('value', s.cashflow.closedMonth?.net),
    facts: s => [
      money('activeIncome', s.cashflow.closedMonth?.active),
      money('passiveIncome', s.cashflow.closedMonth?.passive),
      money('expenses', s.cashflow.closedMonth?.expense),
      money('avgFlow3m', avg(s.cashflow.avg3m, 'netPerMonth')),
      money('avgFlow12m', avg(s.cashflow.avg12m, 'netPerMonth')),
    ],
  },
  passive_income: {
    value: s => money('value', s.cashflow.closedMonth?.passive),
    facts: s => {
      const m = s.cashflow.closedMonth
      return [
        money('avg3m', avg(s.cashflow.avg3m, 'passivePerMonth')),
        money('avg12m', avg(s.cashflow.avg12m, 'passivePerMonth')),
        pct('coversExpenses', m && m.expense > 0 ? (m.passive / m.expense) * 100 : null),
      ]
    },
  },
  fire_progress: {
    value: s => pct('value', s.goals.fire?.progressPct),
    facts: s => {
      const f = s.goals.fire
      if (!f) return []
      return [
        money('saved', f.currentBase),
        money('target', f.targetBase),
        // the plan's month with the 8% return; unknown savings — no data, never reached — unreachable
        f.reached ? fact('text')('forecastMonth', 'metrics.factValue.reached')
          : f.series !== null && f.forecastMonth === null
          ? fact('text')('forecastMonth', 'metrics.factValue.unreachable')
          : fact('month')('forecastMonth', f.forecastMonth),
        pct('actualGrowth', f.actualCagr === null ? null : f.actualCagr * 100),
        pct('requiredGrowth', f.requiredCagr === null ? null : f.requiredCagr * 100),
        money('coastFireGap', f.coastFire.reached ? 0 : f.coastFire.gapBase),
      ]
    },
  },
  growth_beyond_savings: {
    value: s => {
      const rate = s.growthBeyondSavings?.annualRate
      return pct('value', rate == null ? null : rate * 100)
    },
    facts: s => {
      const g = s.growthBeyondSavings
      if (!g) return []
      return [
        money('startNetWorth', g.startNetWorth),
        money('savingsOverPeriod', g.savingsTotal),
        money('endNetWorth', g.endNetWorth),
        // the money the rate is made of: start/end/saved do not reproduce it when a month inside the span is left out
        money('growthBeyondSavingsAmount', g.growthAmount),
        { label: 'metrics.fact.monthsUsedOf', labelParams: { count: g.monthsConsidered }, value: g.months.length, kind: 'count' },
      ]
    },
    ask: true,
  },
  capital_growth: {
    value: s => {
      const cagr = computeCagr(s.history, partialCapitalMonths(s))
      return pct('value', cagr === null ? null : cagr * 100)
    },
    facts: s => {
      const first = s.history[0]
      const last = s.history.at(-1)
      return [
        money('capitalStart', netWorthOf(s, first)),
        money('capitalNow', netWorthOf(s, last)),
        count('historyMonths', first && last ? monthsBetween(monthOf(first.date), monthOf(last.date)) : null),
      ]
    },
  },
  savings_rate: {
    value: s => pct('value', s.cashflow.savingsRatePct),
    facts: s => [
      money('monthIncome', s.cashflow.closedMonth?.income),
      money('monthExpenses', s.cashflow.closedMonth?.expense),
      pct('avgRate3m', s.cashflow.avg3m.ratePct),
      pct('avgRate12m', s.cashflow.avg12m.ratePct),
    ],
    health: { unit: 'pct' },
  },
  emergency_months: {
    value: s => fact('months')('value', s.cashflow.emergencyMonths),
    facts: s => [
      money('liquidAccounts', s.capital?.liquid),
      money('monthExpenses', s.cashflow.closedMonth?.expense),
      money('avgExpenses3m', avg(s.cashflow.avg3m, 'expensePerMonth')),
    ],
    health: { unit: 'months' },
  },
  fi_rate: {
    value: healthValue('fi_rate', 'pct'),
    facts: s => [
      money('monthPassive', s.cashflow.closedMonth?.passive),
      money('monthExpenses', s.cashflow.closedMonth?.expense),
    ],
    health: { unit: 'pct' },
  },
  debt_to_asset: {
    value: healthValue('debt_to_asset', 'pct'),
    facts: s => [money('liabilities', s.capital?.liabilities), money('assets', s.capital?.assets)],
    health: { unit: 'pct' },
  },
  real_growth_yoy: {
    value: healthValue('real_growth_yoy', 'pct'),
    facts: s => {
      const c = s.capital
      const inf = s.inflation
      // the growth is measured in the inflation's currency, so are its net worths: they reproduce the value
      if (inf) {
        const inCurrency = (name: string, value: number | null): Fact => ({ ...money(name, value), currency: inf.currency })
        return [
          inCurrency('capitalNow', inf.netWorthNow),
          inCurrency('capitalYearAgo', inf.netWorthYearAgo),
          { label: 'metrics.fact.inflationUsedIn', labelParams: { currency: inf.currency }, value: inf.ratePct, kind: 'pct' },
        ]
      }
      // no inflation — no value
      return [
        money('capitalNow', c?.netWorth),
        money('capitalYearAgo', c && c.yoyDelta !== null ? c.netWorth - c.yoyDelta : null),
        pct('inflationUsed', null),
      ]
    },
    health: { unit: 'pct', signed: true },
  },
  avg_debt_rate: {
    value: healthValue('avg_debt_rate', 'pct'),
    facts: s => loanFacts(s, 5),
    ask: true,
    health: { unit: 'pct' },
  },
  consumer_debt_months: {
    value: healthValue('consumer_debt_months', 'months'),
    facts: s => [
      money('consumerLoans', s.capital ? consumerDebtBase(s.capital.loans) : null),
      money('incomeOfMonth', s.cashflow.closedMonth?.income),
    ],
    health: { unit: 'months', ofIncome: true },
  },
  debt_payment_ratio: {
    value: healthValue('debt_payment_ratio', 'pct'),
    facts: s => [
      money('loanPayments', s.capital ? loanPaymentsBase(s.capital.loans) : null),
      money('incomeOfMonth', s.cashflow.closedMonth?.income),
    ],
    health: { unit: 'pct' },
  },
  income_diversification: {
    value: healthValue('income_diversification', 'pct'),
    facts: s => [
      money('monthPassive', s.cashflow.closedMonth?.passive),
      money('monthActive', s.cashflow.closedMonth?.active),
    ],
    health: { unit: 'pct' },
  },
}
