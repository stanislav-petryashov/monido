// The Income and expenses title row (RouteDef.subtitle and .primary): the finding of the page's period and "Split <amount>
// <month>" while the last closed month has amounts without a category. Loaded with the analysis chunk (CashflowTitle.tsx).
import { useTranslation } from 'react-i18next'
import { cashflowPeriodView, unsplitTotals } from '../../domain/cashflowPeriod'
import { Freshness } from '../../components/layout/Freshness'
import { Link } from '../../components/ui/Link'
import { useDashboard } from '../../lib/dashboardState'
import { fmtMonth } from '../../lib/formatters'
import { useCan } from '../../lib/rights'
import { useSnapshot } from '../../lib/useFinanceData'
import { usePageState } from './period'
import { useFindingText } from './text'

/** The subtitle: the finding of the period the page shows; the data month and rate while there is none */
export function CashflowFinding() {
  const [state] = usePageState()
  const snapshot = useSnapshot().data
  const view = snapshot?.trackFlows ? cashflowPeriodView(snapshot, state.kind, state.month) : null
  const text = useFindingText(view?.finding ?? [], view?.months ?? [])
  return view?.flows ? <>{text}</> : <Freshness />
}

/** The primary: "Split <amount> <month>" to the categories screen on that month; none when all is split, for a viewer, with tracking off */
export function SplitAction() {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const canEdit = useCan('edit')
  const snapshot = useSnapshot().data
  const left = snapshot && canEdit ? unsplitTotals(snapshot) : null
  // an amount without a rate cannot be named: no button (the categories screen and the page say why)
  if (!left || left.expense === null || left.income === null) return null
  return (
    <Link to={`/cashflow/categories?month=${left.month}`} className="btn btn--primary">
      {t('cashflowPage.split', { amount: fmt(left.expense > 0.005 ? left.expense : left.income), month: t(`dates.monthOf.${Number(left.month.slice(5, 7))}`) })}
    </Link>
  )
}

/** The categories screen's subtitle: what the screen is for, and what the last closed month still leaves without a category */
export function CategoriesLead() {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const snapshot = useSnapshot().data
  const left = snapshot ? unsplitTotals(snapshot) : null
  const lead = t('cashflowPage.categories.lead')
  const month = left ? fmtMonth(left.month) : ''
  // the month starts the second sentence
  const named = month.charAt(0).toLocaleUpperCase() + month.slice(1)
  if (!left) return <>{lead}</>
  if (left.expense === null || left.income === null) return <>{`${lead} ${t('cashflowPage.categories.unknown', { month: named })}`}</>
  return <>{`${lead} ${t('cashflowPage.categories.partial', { month: named, expense: fmt(left.expense), income: fmt(left.income) })}`}</>
}
