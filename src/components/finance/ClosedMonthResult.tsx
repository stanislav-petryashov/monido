import { useTranslation } from 'react-i18next'
import { isMonthChange } from '../../domain/capitalChange'
import { monthFlow } from '../../domain/financialAnalysis'
import { monthRecap } from '../../domain/monthRecap'
import { partialCapitalMonths } from '../../domain/overviewBlocks'
import type { FinanceSnapshot } from '../../domain/types'
import { useDashboard } from '../../lib/dashboardState'
import { fmtMonth } from '../../lib/formatters'
import { changeText, milestoneText } from '../../lib/milestoneText'
import { signed } from '../../lib/pageHelpers'
import { useMoney } from '../../lib/privacy'
import { Link } from '../ui/Link'
import { MonthRecapTable } from './MonthRecapTable'

/** A requested month's evidence, separate from the latest dashboard below it. */
export default function ClosedMonthResult({ month, snapshot, yearHref }: { month: string; snapshot: FinanceSnapshot; yearHref?: (year: number) => string | null }) {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const fmtIn = useMoney()
  const capital = snapshot.history.find(p => p.date.slice(0, 7) === month)
  const flow = monthFlow(snapshot, month)
  const change = snapshot.capitalChange?.find(c => c.month === month)
  const shown = (snapshot.milestones ?? []).filter(m => m.month === month && m.announced)
  const headline = shown.find(m => m.headline)
  const others = shown.filter(m => m !== headline)
  // a closed December opens its calendar year, when a module has a page for it
  const year = capital && month.endsWith('-12') ? yearHref?.(Number(month.slice(0, 4))) ?? null : null
  return <section className="card" aria-labelledby="closed-month-result">
    <h2 id="closed-month-result" className="card-hd">{t('data.close.resultTitle', { month: fmtMonth(month) })}</h2>
    {capital && <p>{partialCapitalMonths(snapshot).has(month) ? t('pages.overview.netWorthIncomplete') : (change && isMonthChange(change) ? t('data.close.resultCapitalChange', { amount: fmt(capital.netWorth), change: signed(change.end - change.start, fmt) }) : t('data.close.resultCapital', { amount: fmt(capital.netWorth) }))}</p>}
    {change && isMonthChange(change) && <p>{changeText(t, change, fmt)}</p>}
    {headline && <p className="result__milestone">{milestoneText(t, headline, fmtIn)}</p>}
    {others.length > 0 && <p>{t('data.close.milestone.also', { list: others.map(m => milestoneText(t, m, fmtIn)).join(' ') })}</p>}
    {snapshot.trackFlows && flow && <p>{t(Math.round(flow.income - flow.expense) < 0 ? 'data.close.resultOverspent' : 'data.close.resultFlow', { income: fmt(flow.income), expense: fmt(flow.expense), net: fmt(Math.abs(flow.income - flow.expense)) })}</p>}
    {!capital && !flow && <p>{t('data.close.resultUnavailable')}</p>}
    {capital && <MonthRecapTable recap={monthRecap(snapshot, month)} fmt={fmt} fmtIn={fmtIn} />}
    <p className="result__links">
      {year && <Link to={year} className="link-accent">{t('data.close.yearResults')}</Link>}
      <Link to={`/cashflow?m=${month}`} className="link-accent">{t('data.close.changeLink')}</Link>
      {snapshot.trackFlows && <Link to={`/cashflow/categories?month=${month}`} className="link-accent">{t('pages.cashflow.spending.enter')}</Link>}
    </p>
  </section>
}
