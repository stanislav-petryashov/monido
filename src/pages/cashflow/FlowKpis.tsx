import { useTranslation } from 'react-i18next'
import type { PeriodFlows, UsualMonth } from '../../domain/cashflowPeriod'
import { fmtPct } from '../../lib/formatters'
import { signed } from '../../lib/pageHelpers'

interface FlowKpisProps {
  flows: PeriodFlows
  usual: UsualMonth | null
  /** The period's first month: the usual is the median of the months before it */
  first: string
  fmt: (v: number) => string
}

/**
 * The strip of four: came in, went out, saved (overspent, in --error-text, when negative), the savings rate. Each meta
 * line names its baseline: the usual month for a month; the average month against the usual for a longer period.
 */
export function FlowKpis({ flows, usual, first, fmt }: FlowKpisProps) {
  const { t } = useTranslation()
  const overspent = Math.round(flows.net) < 0
  const meta = (perMonth: number, pick: 'income' | 'expense' | 'net') => {
    const params = { avg: fmt(perMonth), usual: usual ? fmt(usual[pick]) : '', delta: usual ? signed(perMonth - usual[pick], fmt) : '' }
    if (flows.months > 1) return t(usual ? 'cashflowPage.kpi.averageUsual' : 'cashflowPage.kpi.average', params)
    return usual ? t('cashflowPage.kpi.usual', params) : null
  }
  const cells = [
    { key: 'income', label: t('cashflowPage.kpi.income'), value: fmt(flows.income), meta: meta(flows.perMonth.income, 'income') },
    { key: 'expense', label: t('cashflowPage.kpi.expense'), value: fmt(flows.expense), meta: meta(flows.perMonth.expense, 'expense') },
    { key: 'net', label: t(overspent ? 'cashflowPage.kpi.overspent' : 'cashflowPage.kpi.saved'), value: fmt(Math.abs(flows.net)), meta: meta(flows.perMonth.net, 'net'), bad: overspent },
    {
      key: 'rate', label: t('cashflowPage.kpi.rate'), value: fmtPct(flows.rate),
      meta: usual ? t('cashflowPage.kpi.rateUsual', { rate: fmtPct(usual.rate), count: usual.months.length, month: t(`dates.monthOf.${Number(first.slice(5, 7))}`) }) : t('cashflowPage.kpi.rateNone'),
    },
  ]
  return (
    <ul className="cf-kpis">
      {cells.map(c => (
        <li key={c.key} className="cf-kpi">
          <span className="figure-label">{c.label}</span>
          <strong className={c.bad ? 'cf-kpi__value cf-kpi__value--bad num' : 'cf-kpi__value num'}>{c.value}</strong>
          {c.meta && <span className="cf-kpi__meta">{c.meta}</span>}
        </li>
      ))}
    </ul>
  )
}
