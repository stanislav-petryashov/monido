// Texts of the metric catalog (src/domain/metricCatalog.ts) in the UI language: the domain gives keys
// and raw numbers, the locale files hold the words (`metrics.<key>.*`, `zones.*`, `units.health.*`).
import { i18n, t } from '../i18n/client'
import { isInverse, zoneThresholds } from '../domain/health'
import { METRICS, type Fact, type MetricKey } from '../domain/metricCatalog'
import type { FinanceSnapshot, HealthKey, Zone } from '../domain/types'
import { fmtCurrency, fmtMonthNumeric, fmtMonths, fmtNum } from './formatters'

export const metricTitle = (key: MetricKey): string => t(`metrics.${key}.title`)
export const metricMeaning = (key: MetricKey): string => t(`metrics.${key}.meaning`)
export const metricFormula = (key: MetricKey): string => t(`metrics.${key}.formula`)
/** The metric's honest caveat (`metrics.<key>.caveat`), where it has one. */
export function metricCaveat(key: MetricKey): string | undefined {
  const caveat = `metrics.${key}.caveat`
  return i18n.exists(caveat) ? t(caveat) : undefined
}

/** «Critical», «Needs work», «Good», «Excellent» */
export const zoneTitle = (zone: Zone): string => t(`zones.${zone}`)

/** The unit suffix of a health metric: «15%», «3 mo», «6 mo of income» (months of income, not of expenses). */
export const unitSuffix = (key: HealthKey): string => {
  const h = METRICS[key].health
  return t(h.ofIncome ? 'units.health.monthsOfIncome' : `units.health.${h.unit}`)
}

/** Advice in the red zone, and in the amber one (its own text where the metric has one); otherwise none. */
export function metricAdvice(key: HealthKey, zone: Zone | null): string | undefined {
  if (zone === 'red') return t(`metrics.${key}.advice`)
  if (zone !== 'amber') return undefined
  const amber = `metrics.${key}.amberAdvice`
  return t(i18n.exists(amber) ? amber : `metrics.${key}.advice`)
}

/** The metric's extra question for the prompt, when the catalog asks it for this snapshot. */
export function metricAsk(key: MetricKey, s: FinanceSnapshot): string | undefined {
  const ask = METRICS[key].ask
  return (typeof ask === 'function' ? ask(s) : ask) ? t(`metrics.${key}.ask`) : undefined
}

export const factLabel = (fact: Fact): string => t(fact.label, fact.labelParams)

/** A fact's value as text: money through `money` (in its own currency when the fact names one), numbers with one decimal and their unit. */
export function factText(fact: Fact, money: (usd: number) => string): string {
  if (fact.value === null) return t('metrics.factValue.noData')
  if (fact.kind === 'month' && typeof fact.value === 'string') return fmtMonthNumeric(fact.value)
  if (typeof fact.value === 'string') return t(fact.value)
  switch (fact.kind) {
    case 'money': return fact.currency ? fmtCurrency(fact.value, fact.currency) : money(fact.value)
    case 'pct': return `${fmtNum(fact.value)}${t('units.health.pct')}`
    case 'months': return fmtMonths(fact.value)
    case 'years': return t('metrics.factValue.years', { count: fact.value, value: fact.value })
    default: return fmtNum(fact.value)
  }
}

/**
 * The norm from the zone thresholds, with the same borders as zoneOf:
 * «norm: above 3 and up to 6 mo; above 6 mo is excellent»; inverse ones «from 20 to below 40%».
 */
export function normText(key: HealthKey): string {
  const [a, b, c] = zoneThresholds(key)
  const unit = unitSuffix(key)
  return isInverse(key) ? t('metrics.norm.inverse', { a, b, unit }) : t('metrics.norm.normal', { b, c, unit })
}
