import { Loading } from '../../components/ui/Loading'
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { PageError } from '../../components/PageError'
import { Card } from '../../components/ui/Card'
import { lazyWithChunks } from '../../i18n/lazyWithChunks'
import { useDashboard } from '../../lib/dashboardState'
import { fmtPct } from '../../lib/formatters'
import { overviewFlow } from '../../lib/snapshotSelectors'
import { useSnapshot } from '../../lib/useFinanceData'

/** Overview is the first page of every visit: the bars (ECharts) load only with this card, never with the page. */
const OverviewNetChart = lazyWithChunks(() => import('./OverviewNetChart').then(m => ({ default: m.OverviewNetChart })), 'planning')

/** The card of the cash-flow module on Overview: what the last twelve months left, the savings rate over them, a bar per month. */
export function OverviewNetCard() {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const s = useSnapshot().data
  if (!s) return null
  const flow = overviewFlow(s)
  const { avg12m } = s.cashflow
  return (
    <Card className="net-card">
      <div className="card-hd--row">
        <span className="card-hd">{t('pages.overview.netTwelve')}</span>
        {/* the rate of the same twelve months as the total: unknown with it when a month has no rate */}
        {avg12m.months > 0 && <span className="overview-card-meta">{t('pages.overview.savingsRate', { rate: fmtPct(flow.netTotal === null ? null : avg12m.ratePct) })}</span>}
      </div>
      <strong className="net-card__value num" tabIndex={0}>{flow.netTotal === null ? '—' : fmt(flow.netTotal)}</strong>
      {flow.trend.length > 0 ? (
        <ErrorBoundary fallback={<PageError />}>
          <Suspense fallback={<Loading className="reminder-state" />}>
            <OverviewNetChart rows={flow.trend} />
          </Suspense>
        </ErrorBoundary>
      ) : <p className="empty-note">{t('common.noData')}</p>}
    </Card>
  )
}
