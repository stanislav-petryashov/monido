import { createElement, type ReactNode } from 'react'
import { Trans } from 'react-i18next'
import { METRICS, type HealthDef } from '../domain/metricCatalog'
import type { HealthKey, Zone } from '../domain/types'
import { fmtMonths, fmtNum, fmtPct } from './formatters'
import { metricAdvice } from './metricText'

export interface HealthCardView {
  /** The card's value; months of income carry «of income» as smaller unit text beside the number (`.status__unit`) */
  formattedValue: ReactNode
  rec: string | undefined
}

function formatValue(h: HealthDef, v: number): ReactNode {
  if (h.ofIncome) {
    return createElement(Trans, { i18nKey: 'units.monthsOfIncome', values: { value: fmtNum(v) }, components: { unit: createElement('span', { className: 'status__unit' }) } })
  }
  if (h.unit === 'months') return fmtMonths(v)
  return fmtPct(v, { sign: h.signed })
}

/** A health card's value and the advice for a bad zone — from the catalog. */
export function healthCardView(key: HealthKey, metric: { value: number | null; zone: Zone | null }): HealthCardView {
  const h = METRICS[key].health
  const { value, zone } = metric
  return {
    formattedValue: value === null ? '—' : formatValue(h, value),
    rec: metricAdvice(key, zone),
  }
}
