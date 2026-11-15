import { HEALTH_KEYS, isIndependenceMetric } from '../../domain/health'
import type { HealthReport } from '../../domain/types'

/**
 * The computable stability metrics of the report (every metric but independence, a metric without a zone left out, so
 * the ring has no arc for it): how many, how many are green or excellent, and the indices among them in the shown order
 * of the amber and the red ones (for `Ring.amberAt` / `redAt`).
 */
export function zoneCount(health: HealthReport): { total: number; good: number; amber: number[]; red: number[] } {
  const zones = HEALTH_KEYS.filter(key => !isIndependenceMetric(key)).flatMap(key => {
    const zone = health.metrics[key]?.zone
    return zone ? [zone] : []
  })
  const indices = (zone: 'amber' | 'red') => zones.flatMap((z, i) => (z === zone ? [i] : []))
  return {
    total: zones.length,
    good: zones.filter(z => z === 'green' || z === 'excellent').length,
    amber: indices('amber'),
    red: indices('red'),
  }
}
