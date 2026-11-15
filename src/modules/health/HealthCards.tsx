import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { StatusCard, type StatusCardProps } from '../../components/cards/StatusCard'
import { Link } from '../../components/ui/Link'
import { WarningsBanner } from '../../components/WarningsBanner'
import { SectionLabel } from '../../components/ui/SectionLabel'
import { HEALTH_KEYS, isIndependenceMetric, isInverse, zoneThresholds } from '../../domain/health'
import type { HealthKey, HealthReport, Zone } from '../../domain/types'
import { healthCardView } from '../../lib/healthCard'
import { unitSuffix } from '../../lib/metricText'
import { calculationWarnings } from '../../lib/snapshotSelectors'
import { useHealthScore, useSnapshot } from '../../lib/useFinanceData'

/** What a page adds to a metric's card: the anchor, comparison rows, the owner link. */
export type CardExtras = (key: HealthKey) => Pick<StatusCardProps, 'id' | 'target' | 'rows' | 'link'>

/** Worst zone first; a metric without a zone goes last. */
const ZONE_RANK: Record<Zone, number> = { red: 0, amber: 1, green: 2, excellent: 3 }

/** The shown metrics, worst zone first; the catalog order within a zone. */
const sortedKeys = (health: HealthReport): HealthKey[] => {
  const rank = (key: HealthKey) => { const zone = health.metrics[key]!.zone; return zone ? ZONE_RANK[zone] : 4 }
  return [...HEALTH_KEYS].sort((a, b) => rank(a) - rank(b))
}

/** A card for each computed metric, the worst zone first (stable within a zone). Short labels (`modules.health.label.*`); the full title and meaning are in the Claude question. */
export function HealthCards({ extras, stabilitySummary }: { extras?: CardExtras; stabilitySummary?: ReactNode }) {
  const { t } = useTranslation()
  const health = useHealthScore().data
  // real growth needs the inflation and its currency (no default): without them its card says where to set them
  const snapshot = useSnapshot().data
  const noInflation = snapshot?.inflation === null
  if (!health) return null

  return (
    <>
      {snapshot && <WarningsBanner warnings={calculationWarnings(snapshot, ['capital', 'cashflow'])} />}
      {[false, true].map(independence => <section key={String(independence)}>
      {sortedKeys(health).some(key => isIndependenceMetric(key) === independence) && <SectionLabel>{t(independence ? 'modules.health.independence' : 'modules.health.stability')}</SectionLabel>}
      {!independence && stabilitySummary}
      <div className="status-grid">
        {sortedKeys(health).filter(key => isIndependenceMetric(key) === independence).map(key => {
          const metric = health.metrics[key]!
          const view = healthCardView(key, metric)
          return (
            <StatusCard
              key={key}
              label={t(`modules.health.label.${key}`)}
              value={view.formattedValue}
              zone={metric.zone}
              thresholds={zoneThresholds(key)}
              inverse={isInverse(key)}
              unit={unitSuffix(key)}
              advice={view.rec}
              promptKey={key}
              note={key === 'real_growth_yoy' && noInflation
                ? <Trans i18nKey="modules.health.noInflation" components={{ params: <Link to="/settings/general" className="link-accent" /> }} />
                : undefined}
              {...extras?.(key)}
            />
          )
        })}
      </div></section>)}
    </>
  )
}
