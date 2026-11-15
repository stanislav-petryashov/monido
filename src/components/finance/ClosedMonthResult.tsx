import { useTranslation } from 'react-i18next'
import { monthFlow } from '../../domain/financialAnalysis'
import { partialCapitalMonths } from '../../domain/overviewBlocks'
import type { FinanceSnapshot } from '../../domain/types'
import { useDashboard } from '../../lib/dashboardState'
import { fmtMonth } from '../../lib/formatters'
import { Link } from '../ui/Link'

/** A requested month's evidence, separate from the latest dashboard below it. */
export default function ClosedMonthResult({ month, snapshot }: { month: string; snapshot: FinanceSnapshot }) {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const capital = snapshot.history.find(p => p.date.slice(0, 7) === month)
  const flow = monthFlow(snapshot, month)
  return <section className="card" aria-labelledby="closed-month-result">
    <h2 id="closed-month-result" className="card-hd">{t('data.close.resultTitle', { month: fmtMonth(month) })}</h2>
    {capital && <p>{partialCapitalMonths(snapshot).has(month) ? t('pages.overview.netWorthIncomplete') : t('data.close.resultCapital', { amount: fmt(capital.netWorth) })}</p>}
    {snapshot.trackFlows && flow && <p>{t(Math.round(flow.income - flow.expense) < 0 ? 'data.close.resultOverspent' : 'data.close.resultFlow', { income: fmt(flow.income), expense: fmt(flow.expense), net: fmt(Math.abs(flow.income - flow.expense)) })}</p>}
    {!capital && !flow && <p>{t('data.close.resultUnavailable')}</p>}
    {snapshot.trackFlows && <Link to={`/cashflow/categories?month=${month}`} className="link-accent">{t('pages.cashflow.spending.enter')}</Link>}
  </section>
}
