import { useTranslation } from 'react-i18next'
import type { Translate } from '../../i18n/core'
import { addedOf, isMonthChange, marketsOf, MATERIAL_SHARE } from '../../domain/capitalChange'
import { monthFlow } from '../../domain/financialAnalysis'
import { monthRecap } from '../../domain/monthRecap'
import { partialCapitalMonths } from '../../domain/overviewBlocks'
import type { FinanceSnapshot, MonthChange } from '../../domain/types'
import { useDashboard } from '../../lib/dashboardState'
import { fmtMonth } from '../../lib/formatters'
import { milestoneText } from '../../lib/milestoneText'
import { useMoney } from '../../lib/privacy'
import { Link } from '../ui/Link'
import { MonthRecapTable } from './MonthRecapTable'

/** What the family did this month, markets and rates apart, and the rest the records do not explain when it matters */
function whatWeDid(t: Translate, c: MonthChange, fmt: (v: number) => string): string {
  if (c.form === 'balances') return t('data.close.whatWeDid.accounts', { amount: fmt(c.rows.accounts ?? 0) })
  const added = addedOf(c), markets = marketsOf(c), rest = c.rows.unexplained ?? 0
  const moves = Object.values(c.rows).reduce<number>((a, v) => a + Math.abs(v ?? 0), 0) - Math.abs(rest)
  return [
    t(added < 0 ? 'data.close.whatWeDid.tookOut' : 'data.close.whatWeDid.added', { amount: fmt(Math.abs(added)) }),
    t(markets < 0 ? 'data.close.whatWeDid.marketsDown' : 'data.close.whatWeDid.marketsUp', { amount: fmt(Math.abs(markets)) }),
    ...(Math.abs(rest) >= Math.max(1, MATERIAL_SHARE * moves) ? [t('data.close.whatWeDid.unexplained', { amount: fmt(Math.abs(rest)) })] : []),
  ].join(' ')
}

/** A requested month's evidence, separate from the latest dashboard below it. */
export default function ClosedMonthResult({ month, snapshot }: { month: string; snapshot: FinanceSnapshot }) {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const fmtIn = useMoney()
  const capital = snapshot.history.find(p => p.date.slice(0, 7) === month)
  const flow = monthFlow(snapshot, month)
  const change = snapshot.capitalChange?.find(c => c.month === month)
  const shown = (snapshot.milestones ?? []).filter(m => m.month === month && m.celebrated)
  const headline = shown.find(m => m.headline)
  const others = shown.filter(m => m !== headline)
  return <section className="card" aria-labelledby="closed-month-result">
    <h2 id="closed-month-result" className="card-hd">{t('data.close.resultTitle', { month: fmtMonth(month) })}</h2>
    {capital && <p>{partialCapitalMonths(snapshot).has(month) ? t('pages.overview.netWorthIncomplete') : t('data.close.resultCapital', { amount: fmt(capital.netWorth) })}</p>}
    {change && isMonthChange(change) && <p>{whatWeDid(t, change, fmt)}</p>}
    {headline && <p className="result__milestone">{milestoneText(t, headline, fmtIn)}</p>}
    {others.length > 0 && <p>{t('data.close.milestone.also', { list: others.map(m => milestoneText(t, m, fmtIn)).join(' ') })}</p>}
    {snapshot.trackFlows && flow && <p>{t(Math.round(flow.income - flow.expense) < 0 ? 'data.close.resultOverspent' : 'data.close.resultFlow', { income: fmt(flow.income), expense: fmt(flow.expense), net: fmt(Math.abs(flow.income - flow.expense)) })}</p>}
    {!capital && !flow && <p>{t('data.close.resultUnavailable')}</p>}
    {capital && <MonthRecapTable recap={monthRecap(snapshot, month)} fmt={fmt} fmtIn={fmtIn} />}
    <p className="result__links">
      <Link to={`/cashflow?m=${month}`} className="link-accent">{t('data.close.changeLink')}</Link>
      {snapshot.trackFlows && <Link to={`/cashflow/categories?month=${month}`} className="link-accent">{t('pages.cashflow.spending.enter')}</Link>}
    </p>
  </section>
}
