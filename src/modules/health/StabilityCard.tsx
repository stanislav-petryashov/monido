import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/Card'
import { Chip } from '../../components/ui/Chip'
import { Ring } from '../../components/ui/Ring'
import type { SemanticColor } from '../../components/ui/types'
import { HEALTH_KEYS, isIndependenceMetric } from '../../domain/health'
import type { Zone } from '../../domain/types'
import { useHealthScore } from '../../lib/useFinanceData'
import { zoneCount } from './zoneCount'

const WORST_FIRST: readonly Zone[] = ['red', 'amber', 'green', 'excellent']

const ZONE_TONE: Record<Zone, SemanticColor> = { excellent: 'success', green: 'success', amber: 'warning', red: 'error' }

/**
 * The health module's card on Overview, in the goals card's rhythm: a ring with an arc per stability metric (amber and red
 * where it is) and how many are in a good zone at its centre, the worst zone as the word under it, then a chip per metric
 * toned by its zone; the metrics below the norm are named in a note. Independence is not stability.
 */
export function StabilityCard() {
  const { t } = useTranslation()
  const health = useHealthScore().data
  const title = t('modules.health.stability')
  const keys = health ? HEALTH_KEYS.filter(key => !isIndependenceMetric(key)) : []
  const zones = health ? keys.map(key => health.metrics[key]?.zone ?? null) : []
  const worst = WORST_FIRST.find(zone => zones.includes(zone))
  if (!health || !worst) {
    return (
      <Card className="stability">
        <span className="card-hd">{title}</span>
        <p className="note">{t('modules.health.noData')}</p>
      </Card>
    )
  }
  const count = zoneCount(health)
  // the metrics with a zone, in the ring's (zoneCount's) order
  const zoned = keys.flatMap((key, i) => (zones[i] ? [{ key, zone: zones[i] }] : []))
  const below = zoned.filter(m => m.zone === 'amber' || m.zone === 'red').map(m => t(`metrics.${m.key}.title`))
  return (
    <Card className="stability">
      <span className="card-hd">{title}</span>
      <div className="stability__body">
        <Ring size={104} segments={count.total} pct={100} amberAt={count.amber} redAt={count.red} label={title} center={`${count.good} / ${count.total}`} />
        <strong className="stability__word">{t(`zones.${worst}`)}</strong>
        <div className="stability__chips">
          {zoned.map(m => <Chip key={m.key} color={ZONE_TONE[m.zone]}>{t(`modules.health.label.${m.key}`)}</Chip>)}
        </div>
        {below.length > 0 && <p className="stability__note">{t('pages.overview.stabilityNote', { names: below.join(', ') })}</p>}
      </div>
    </Card>
  )
}
