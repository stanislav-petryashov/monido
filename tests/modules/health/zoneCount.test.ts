import { describe, expect, it } from 'vitest'
import { HEALTH_KEYS } from '../../../src/domain/health'
import type { HealthReport, Zone } from '../../../src/domain/types'
import { zoneCount } from '../../../src/modules/health/zoneCount'

function report(zones: Partial<Record<(typeof HEALTH_KEYS)[number], Zone | null>>, fill: Zone | null = 'green'): HealthReport {
  return { composite: 70, metrics: Object.fromEntries(HEALTH_KEYS.map(key => [key, { value: 1, zone: key in zones ? zones[key] : fill }])) }
}

describe('zoneCount', () => {
  it('counts the stability metrics, good ones and the amber indices in the shown order', () => {
    // 8 green + 1 amber in the report; the two independence metrics are not stability
    expect(zoneCount(report({ debt_payment_ratio: 'amber' }))).toEqual({ total: 7, good: 6, amber: [6], red: [] })
  })

  it('counts excellent as good, lists red indices and leaves a metric without a zone out of the ring', () => {
    expect(zoneCount(report({ savings_rate: 'red', emergency_months: null, consumer_debt_months: 'excellent' })))
      .toEqual({ total: 6, good: 5, amber: [], red: [0] })
  })

  it('indexes the amber and red arcs among the computable metrics only', () => {
    // savings_rate (first) has no zone: the amber debt_payment_ratio moves one arc down
    expect(zoneCount(report({ savings_rate: null, debt_payment_ratio: 'amber' }))).toEqual({ total: 6, good: 5, amber: [5], red: [] })
  })

  it('ignores the independence metrics whatever their zone', () => {
    expect(zoneCount(report({ fi_rate: 'red', income_diversification: 'amber' }))).toEqual({ total: 7, good: 7, amber: [], red: [] })
  })

  it('indexes among the metrics the report shows', () => {
    const health: HealthReport = { composite: null, metrics: { debt_to_asset: { value: 1, zone: 'green' }, debt_payment_ratio: { value: 1, zone: 'amber' } } }
    expect(zoneCount(health)).toEqual({ total: 2, good: 1, amber: [1], red: [] })
    expect(zoneCount({ composite: null, metrics: {} })).toEqual({ total: 0, good: 0, amber: [], red: [] })
  })
})
