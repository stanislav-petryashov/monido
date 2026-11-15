import { useTranslation } from 'react-i18next'
import { KpiCell } from '../../components/cards/KpiCell'
import { zoneThresholds } from '../../domain/health'
import { useDashboard } from '../../lib/dashboardState'
import { fmtMonth, fmtMonths, fmtPct } from '../../lib/formatters'
import { signed } from '../../lib/pageHelpers'
import { overviewFlow, type OverviewFlow } from '../../lib/snapshotSelectors'
import { useSnapshot } from '../../lib/useFinanceData'

/**
 * The cushion the cell measures against: no parameter holds a target of its own, so it is where the emergency-fund
 * zone stops being green and turns excellent (`zoneThresholds` in src/domain/health.ts: 6 months).
 */
const CUSHION_TARGET = zoneThresholds('emergency_months')[2]

/** The closed month's flows with the change of one figure against the month before, worded; null — no month before */
function useFlowKpi() {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const s = useSnapshot().data
  const flow = s ? overviewFlow(s) : null
  const change = (pick: (m: { income: number; expense: number; net: number }) => number): string | null => {
    if (!flow?.month || !flow.previous) return null
    return t('pages.overview.toMonth', { amount: signed(pick(flow.month) - pick(flow.previous), fmt), month: fmtMonth(flow.previous.month) })
  }
  return { t, fmt, s, flow, change }
}

/** The closed month's figure, or a dash while the module has no closed month with flows */
const figure = (flow: OverviewFlow | null, pick: (m: { income: number; expense: number; net: number }) => number, fmt: (v: number) => string) =>
  (flow?.month ? fmt(pick(flow.month)) : '—')

export function IncomeCell() {
  const { t, fmt, flow, change } = useFlowKpi()
  return <KpiCell label={t('charts.income')} value={figure(flow, m => m.income, fmt)} delta={change(m => m.income)} />
}

export function ExpensesCell() {
  const { t, fmt, flow, change } = useFlowKpi()
  return <KpiCell label={t('charts.expenses')} value={figure(flow, m => m.expense, fmt)} delta={change(m => m.expense)} />
}

/** What is left, with the change and the closed month's savings rate on one line */
export function LeftCell() {
  const { t, fmt, s, flow, change } = useFlowKpi()
  const rate = flow?.month ? t('pages.overview.savingsRate', { rate: fmtPct(s?.cashflow.savingsRatePct) }) : null
  const delta = [change(m => m.net), rate].filter(Boolean).join(' · ')
  return <KpiCell label={t('metrics.cashflow_net.title')} value={figure(flow, m => m.net, fmt)} delta={delta || undefined} />
}

/** The emergency fund in months against the cushion target: the figure of the moment, so the current cell */
export function CushionCell() {
  const { t, s } = useFlowKpi()
  return (
    <KpiCell label={t('metrics.emergency_months.title')} value={fmtMonths(s?.cashflow.emergencyMonths)} delta={t('pages.overview.cushionOf', { target: fmtMonths(CUSHION_TARGET) })} current />
  )
}
