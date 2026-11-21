import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SegmentedPills } from '../../components/ui/SegmentedPills'
import { isMonthChange } from '../../domain/capitalChange'
import { shiftMonth } from '../../domain/dates'
import { monthFlow } from '../../domain/financialAnalysis'
import type { FinanceSnapshot } from '../../domain/types'
import { monthTitle } from '../../i18n/dates'
import { useDashboard } from '../../lib/dashboardState'
import { signed } from '../../lib/pageHelpers'
import { usePrivacy } from '../../lib/privacy'
import { useClientModules } from '../../modules/client'
import '../../styles/household-review.css'

const views = ['capital', 'spending'] as const
const key = (name: string) => `pages.overview.household.${name}`

export function HouseholdReview({ snapshot }: { snapshot: FinanceSnapshot }) {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const { hidden } = usePrivacy()
  const cashflowModule = useClientModules().some(m => m.key === 'cashflow')
  const [selected, setSelected] = useState<typeof views[number]>('capital')
  const [expanded, setExpanded] = useState(false)
  const changes = snapshot.capitalChange ?? []
  const change = changes.at(-1)
  const month = change?.month ?? snapshot.asOf.closedMonth
  if (!month) return null

  const prevMonth = shiftMonth(month, -1)
  const prevChange = changes.find(c => c.month === prevMonth)
  const hasSpending = cashflowModule && snapshot.trackFlows && snapshot.cashflow.rows.some(r => r.month === month)
  if (!change && !hasSpending) return null
  const capital = change && (!hasSpending || selected === 'capital')
  const flow = hasSpending ? monthFlow(snapshot, month) : null
  const categories = snapshot.spending.months.find(s => s.month === month)
  const rows: { id: string; name: string; amount: number }[] = []
  let total: number | null = null
  let previous: number | null = null
  let note: string | undefined
  if (capital && change) {
    if (isMonthChange(change)) {
      total = change.end - change.start
      previous = prevChange && isMonthChange(prevChange) ? prevChange.end - prevChange.start : null
      for (const [id, amount] of Object.entries(change.rows)) {
        if (amount) rows.push({ id, name: t(`capitalChange.rows.${id === 'saved' && amount < 0 ? 'overspent' : id}`), amount })
      }
    } else {
      note = t(`capitalChange.gap.${change.reason}`, { month: monthTitle(t, change.at ?? month) })
    }
  } else {
    total = flow?.expense ?? null
    previous = monthFlow(snapshot, prevMonth)?.expense ?? null
    if (!flow) note = t(key('incomplete'))
    else if (categories && (categories.unallocatedBase === null || categories.categories.some(c => c.amountBase === null))) {
      note = t('cashflowPage.expenses.noRate')
    } else {
      for (const c of categories?.categories ?? []) {
        if (c.amountBase) rows.push({ id: String(c.categoryId), name: c.kind === 'loan_payment' ? t('modules.cashflow.spending.loanPayments') : c.name, amount: c.amountBase })
      }
      const rest = categories?.unallocatedBase ?? flow.expense
      if (rest) rows.push({ id: 'unallocated', name: t('cashflowPage.expenses.unallocated'), amount: rest })
    }
  }
  rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  const max = Math.abs(rows[0]?.amount ?? 0)
  const visible = capital || expanded ? rows : rows.slice(0, 4)
  const amountText = (v: number) => capital ? signed(v, fmt) : fmt(v)
  const period = month.slice(0, 4) === snapshot.asOf.today.slice(0, 4) ? t(`dates.month.${Number(month.slice(5))}`) : monthTitle(t, month)
  const title = t(key('title'), { month: period })

  return <section className="card card--p household-review" aria-labelledby="household-review-title">
    <header className="household-review__header">
      <h2 className="overview__title" id="household-review-title">{title}</h2>
      {change && hasSpending && <SegmentedPills items={views} active={selected} onSelect={setSelected} ariaLabel={title}
        label={v => v === 'capital' ? t(key('capital')) : t('charts.expenses')} />}
    </header>
    <div className="household-review__body">
      <div>
        <p className="note">{t(key(capital ? 'change' : 'spent'))}</p>
        <strong className="household-review__total num">{total === null ? '—' : amountText(total)}</strong>
        {previous !== null && <p className="household-review__previous note"><span>{monthTitle(t, prevMonth)}</span>{amountText(previous)}</p>}
      </div>
      {note ? <p className="note">{note}</p> : rows.length > 0 && <div>
        <h3>{t(key(capital ? 'drivers' : 'categories'))}</h3>
        <ul className="household-review__rows">{visible.map(row => <li key={row.id}>
          <div className="household-review__row"><span>{row.name}</span><b className="num">{amountText(row.amount)}</b></div>
          {!hidden && <div aria-hidden="true" className={`household-review__track${capital ? ' household-review__track--signed' : ''}`}>
            <i className={row.amount < 0 ? 'is-negative' : undefined} style={{ width: `${Math.abs(row.amount) / max * (capital ? 50 : 100)}%` }} />
          </div>}
        </li>)}</ul>
        {!capital && rows.length > 4 && <button type="button" className="btn btn--quiet" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {t(key(expanded ? 'less' : 'all'), { total: rows.length })}
        </button>}
      </div>}
    </div>
  </section>
}
