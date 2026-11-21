import { HEALTH_KEYS, isIndependenceMetric } from '../../domain/health'
import type { HealthReport } from '../../domain/types'

/**
 * The computable stability metrics of the report (every metric but independence, a metric without a zone left out, so
 * the ring has no arc for it): how many, how many are green or excellent, and the indices among them in the shown order
 * of the amber and the red ones (for `Ring.amberAt` / `redAt`).
 */
export function zoneCount(health: HealthReport) {
  const zoned = HEALTH_KEYS.filter(key => !isIndependenceMetric(key)).flatMap(key => {
    const zone = health.metrics[key]?.zone
    return zone ? [{ key, zone }] : []
  })
  const indices = (zone: 'amber' | 'red') => zoned.flatMap((m, i) => (m.zone === zone ? [i] : []))
  return {
    zoned,
    total: zoned.length,
    good: zoned.filter(({ zone }) => zone === 'green' || zone === 'excellent').length,
    amber: indices('amber'),
    red: indices('red'),
  }
}
