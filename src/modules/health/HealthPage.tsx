import { HEALTH_KEYS, isIndependenceMetric } from '../../domain/health'
import { liquidKnown } from '../../domain/overviewBlocks'
import { FinancialAnswers } from '../../components/finance/FinancialAnswers'
import { useTranslation } from 'react-i18next'
import { ZoneChip } from '../../components/cards/StatusCard'
import { PageError } from '../../components/PageError'
import { PageSkeleton } from '../../components/ui/Skeleton'
import type { HealthKey, HealthReport, Zone } from '../../domain/types'
import { useDashboard } from '../../lib/dashboardState'
import { fmtMonth } from '../../lib/formatters'
import { useHashFocus } from '../../lib/pageFocus'
import { compareView } from '../../lib/snapshotSelectors'
import { useSnapshot } from '../../lib/useFinanceData'
import { useAuth } from '../../lib/authState'
import { matchRoute, routesFor } from '../../routes'
import { HealthNoData } from './HealthInsights'
import { HealthCards, type CardExtras } from './HealthCards'
import { METRIC_OWNER } from './metricOwners'

const ZONES: readonly (Zone | null)[] = ['red', 'amber', 'green', 'excellent', null]

/** How many metrics are in each zone, worst first; empty zones are left out. */
function ZoneSummary({ health }: { health: HealthReport }) {
  const { t } = useTranslation()
  const zones = HEALTH_KEYS.filter(key => !isIndependenceMetric(key)).map(key => health.metrics[key]!.zone)
  return (
    <div role="group" aria-label={t('modules.health.byZone')} className="health-summary">
      {ZONES.map(zone => {
        const count = zones.filter(z => z === zone).length
        if (count === 0) return null
        const name = zone ? t(`zones.${zone}`) : t('common.noData')
        return <ZoneChip key={zone ?? 'none'} zone={zone}>{t('modules.health.zoneCount', { zone: name, count })}</ZoneChip>
      })}
    </div>
  )
}

/** Financial health: the zones at a glance and a card per metric linking to its owner page. */
export function HealthPage() {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const snapshot = useSnapshot()
  const demo = useAuth().mode === 'demo'
  // the card the address names takes the focus
  const target = useHashFocus(snapshot.data !== undefined)

  if (snapshot.isLoading) return <PageSkeleton />
  if (snapshot.error || !snapshot.data) return <PageError onRetry={() => void snapshot.refetch()} retrying={snapshot.isFetching} />

  const s = snapshot.data
  const routes = routesFor({ demo })
  const ownerLink = (key: HealthKey) => {
    const owner = METRIC_OWNER[key]
    if (!owner) return undefined
    // the page must be in the menu; the #section it names goes along
    const at = owner.indexOf('#')
    const route = matchRoute(at < 0 ? owner : owner.slice(0, at), routes)
    return route ? { to: owner, label: t('modules.health.moreOn', { page: t(route.title) }) } : undefined
  }
  // the emergency fund has no other owner: its card carries the comparison the compare card had
  const emergency = compareView(s, 'emergency_months', fmt)
  // which month: the closed one, even when its totals are unknown (a row without a rate) and its figure reads "—"
  const closedMonth = s.asOf.closedMonth
  const emergencyRows = [
    { label: t('availability.allLiquid'), value: s.capital && liquidKnown(s) ? fmt(s.capital.liquid) : t('common.noData') },
    // the big number's own base, named beside the average so that the two figures explain each other
    ...(closedMonth ? [{ label: t('cards.compare.closedMonth', { month: fmtMonth(closedMonth) }), value: emergency.value }] : []),
    ...emergency.rows.map(r => ({ label: r.label, value: r.value })),
  ]
  const extras: CardExtras = key => ({
    id: key,
    target: key === target,
    link: key === 'emergency_months' ? { to: '/available-money', label: t('availability.reserveLink') } : ownerLink(key),
    // the report grades one month: the windows beside it show whether that month is typical
    rows: key === 'emergency_months' ? emergencyRows : key === 'savings_rate' ? compareView(s, 'savings_rate', fmt).rows : undefined,
  })

  return (
    <div className="health-page">
      <FinancialAnswers snapshot={s} page="health" />
      {!s.health && <HealthNoData />}
      <HealthCards extras={extras} stabilitySummary={s.health && <ZoneSummary health={s.health} />} />
    </div>
  )
}
