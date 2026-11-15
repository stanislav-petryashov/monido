import { Fragment, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { CategoryPeriod, CategoryRow, PeriodFlows } from '../../domain/cashflowPeriod'
import type { CategoryKind } from '../../domain/types'
import { Link } from '../../components/ui/Link'
import { fmtPct } from '../../lib/formatters'
import { signed } from '../../lib/pageHelpers'

const GROUPS: { kind: CategoryKind; key: 'mandatory' | 'loan' | 'optional' }[] = [
  { kind: 'mandatory', key: 'mandatory' }, { kind: 'loan_payment', key: 'loan' }, { kind: 'optional', key: 'optional' },
]

interface ExpensesCardProps {
  expenses: CategoryPeriod
  flows: PeriodFlows | null
  /** The period's months and its kind's length: a longer period compares its average month */
  months: string[]
  /** "April 2026" in the genitive the coverage line needs; null — no category ever */
  since: string | null
  /** How many accounts of the period's last month leave expenses unsplit (a month only); null — unknown */
  accounts: number | null
  /** The categories screen on the period's last month; null — a viewer, no link */
  splitTo: string | null
  /** The category opened under its row; null — none */
  open: number | null
  onToggle: (id: number | null) => void
  /** The opened category's detail, drawn under its row */
  detail: (row: CategoryRow) => ReactNode
  /** The period's name for the empty line */
  periodName: string
  fmt: (v: number) => string
}

/**
 * "Where the money went": the kinds as one track (three ink greys and a hatch) with their legend, then the categories
 * grouped by kind, largest first, each against its usual with the change in ink; the unsplit remainder ends the list
 * with the way to split it. A category opens under its row; Escape or a second click closes it. A sum without a rate is
 * unknown: "—", no track and no shares, and the card says why.
 */
export function ExpensesCard({ expenses, flows, months, since, accounts, splitTo, open, onToggle, detail, periodName, fmt }: ExpensesCardProps) {
  const { t } = useTranslation()
  const rowRefs = useRef(new Map<number, HTMLButtonElement>())
  const longer = months.length > 1
  // unknown is not zero: a total, the remainder or a category with a line without a rate leaves the shares undrawn
  const known = expenses.total !== null && expenses.unallocated !== null && expenses.rows.every(r => r.value !== null) && expenses.total > 0
  const total = expenses.total ?? 0
  const unallocated = expenses.unallocated
  const sum = (kind: CategoryKind): number | null => {
    const rows = expenses.rows.filter(r => r.kind === kind)
    return rows.some(r => r.value === null) ? null : rows.reduce((n, r) => n + r.value!, 0)
  }
  const money = (v: number | null) => (v === null ? '—' : fmt(v))
  const share = (v: number | null) => (known && v !== null ? (v / total) * 100 : 0)
  const split = splitTo && <Link to={splitTo} className="link-accent">{t('cashflowPage.expenses.split')}</Link>

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || open === null) return
    e.stopPropagation()
    rowRefs.current.get(open)?.focus()
    onToggle(null)
  }

  const usualText = (r: CategoryRow) => {
    if (!longer) return r.usual === null ? '—' : t('cashflowPage.expenses.usual', { usual: fmt(r.usual) })
    return r.usual === null ? t('cashflowPage.expenses.perMonth', { perMonth: money(r.perMonth) }) : t('cashflowPage.expenses.perMonthUsual', { perMonth: money(r.perMonth), usual: fmt(r.usual) })
  }
  const deltaText = (r: CategoryRow) => (r.delta === null ? '' : Math.round(r.delta) === 0 ? t('cashflowPage.expenses.asUsual') : signed(r.delta, fmt))

  return (
    <section className="card card--p cf-card" aria-labelledby="cf-expenses" onKeyDown={onKeyDown}>
      <div className="card-hd--row cf-card__head">
        <h2 className="card-hd" id="cf-expenses">{t('cashflowPage.expenses.title')}</h2>
        {expenses.months.length > 0 && <span className="cf-meta">{expenses.usualMonths > 0
          ? t('cashflowPage.expenses.meta', { total: money(expenses.total), count: expenses.usualMonths })
          : money(expenses.total)}</span>}
      </div>
      {expenses.months.length === 0 ? (
        <p className="note">{t('cashflowPage.expenses.empty', { period: periodName })}{split && <>{' '}{split}</>}</p>
      ) : <>
        {expenses.months.length < months.length && since && (
          <p className="note">
            {t('cashflowPage.expenses.coverage', { start: since, count: expenses.months.length, of: months.length, amount: money(expenses.total), total: money(flows?.expense ?? null) })}
            {expenses.rows.every(r => r.usual === null) && <>{' '}{t('cashflowPage.expenses.noCompare')}</>}
          </p>
        )}
        {!known && <p className="note">{t('cashflowPage.expenses.noRate')}</p>}
        {known && <div className="cf-track cf-track--tall" role="img" aria-label={t('cashflowPage.expenses.track')}>
          {GROUPS.map(g => <i key={g.key} className={`cf-kind--${g.key}`} style={{ width: `${share(sum(g.kind))}%` }} />)}
          <i className="cf-kind--unallocated" style={{ width: `${share(unallocated)}%` }} />
        </div>}
        <ul className="cf-legend">
          {GROUPS.filter(g => sum(g.kind) !== 0).map(g => (
            <li key={g.key}><span className="cf-legend__name"><i className={`cf-swatch cf-kind--${g.key}`} />{t(`cashflowPage.expenses.${g.key}`)}</span>{' '}<b className="num">{money(sum(g.kind))}</b>{' '}<span className="cf-legend__share">{known && fmtPct(share(sum(g.kind)))}</span></li>
          ))}
          {(unallocated === null || unallocated > 0.005) && <li><span className="cf-legend__name"><i className="cf-swatch cf-kind--unallocated" />{t('cashflowPage.expenses.unallocated')}</span>{' '}<b className="num">{money(unallocated)}</b>{' '}<span className="cf-legend__share">{known && fmtPct(share(unallocated))}</span></li>}
        </ul>
        <div className="cf-list">
          {GROUPS.map(g => {
            const rows = expenses.rows.filter(r => r.kind === g.kind)
            if (!rows.length) return null
            return (
              <Fragment key={g.key}>
                <div className="cf-group"><span><i className={`cf-swatch cf-kind--${g.key}`} />{t(`cashflowPage.expenses.${g.key}`)}</span><span className="num">{money(sum(g.kind))}</span></div>
                {rows.map(r => (
                  <Fragment key={r.id}>
                    <button type="button" className={open === r.id ? 'cf-row cf-row--open' : 'cf-row'} aria-expanded={open === r.id}
                      ref={el => { if (el) rowRefs.current.set(r.id, el); else rowRefs.current.delete(r.id) }} onClick={() => onToggle(open === r.id ? null : r.id)}>
                      <span className="cf-row__name">{r.kind === 'loan_payment' ? t('modules.cashflow.spending.loanPayments') : r.name}</span>
                      <span className="cf-row__bar" aria-hidden="true"><i style={{ width: `${share(r.value)}%` }} /></span>
                      <span className="cf-row__value num">{money(r.value)}</span>
                      <span className="cf-row__usual">{usualText(r)}</span>
                      <span className="cf-row__delta delta">{deltaText(r)}</span>
                    </button>
                    {open === r.id && detail(r)}
                  </Fragment>
                ))}
              </Fragment>
            )
          })}
          {(unallocated === null || unallocated > 0.005) && (
            <div className="cf-row cf-row--static">
              <span className="cf-row__name">{t('cashflowPage.expenses.unallocated')}</span>
              <span className="cf-row__bar cf-row__bar--unallocated" aria-hidden="true"><i style={{ width: `${share(unallocated)}%` }} /></span>
              <span className="cf-row__value num">{money(unallocated)}</span>
              <span className="cf-row__usual">{accounts ? t('cashflowPage.expenses.accounts', { count: accounts }) : ''}</span>
              <span className="cf-row__delta">{split}</span>
            </div>
          )}
        </div>
      </>}
    </section>
  )
}
