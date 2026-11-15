import { useTranslation } from 'react-i18next'
import type { CategoryPeriod, PeriodFlows } from '../../domain/cashflowPeriod'
import { Link } from '../../components/ui/Link'
import { OwnerAvatar } from '../../components/ui/OwnerAvatar'
import { fmtPct } from '../../lib/formatters'

interface IncomeCardProps {
  income: CategoryPeriod
  flows: PeriodFlows
  months: string[]
  /** "October 2025" in the genitive the coverage line needs; null — no income category ever */
  since: string | null
  /** Who brought and who spent; null — a row of theirs has no rate */
  people: { member: string; income: number | null; expense: number | null }[]
  members: string[]
  /** The categories screen on the period's last month; null — a viewer */
  splitTo: string | null
  fmt: (v: number) => string
}

/**
 * "Where it came from": active and passive as one track with their figures, the sources by category (bars in ink), what
 * is left unsplit with the way to split it, the one-off line when there is one, and who brought and who spent.
 */
export function IncomeCard({ income, flows, months, since, people, members, splitTo, fmt }: IncomeCardProps) {
  const { t } = useTranslation()
  // unknown is not zero: a total, the remainder or a source with a line without a rate leaves the shares undrawn
  const known = income.total !== null && income.unallocated !== null && income.rows.every(r => r.value !== null) && income.total > 0
  const total = income.total ?? 0
  const unallocated = income.unallocated
  const money = (v: number | null) => (v === null ? '—' : fmt(v))
  const share = (v: number | null) => (known && v !== null ? (v / total) * 100 : 0)
  const oneOff = income.rows.filter(r => r.oneOff && r.value !== 0)
  const oneOffSum = oneOff.some(r => r.value === null) ? null : oneOff.reduce((n, r) => n + r.value!, 0)
  return (
    <section className="card card--p cf-card" aria-labelledby="income">
      <div className="card-hd--row cf-card__head">
        <h2 className="card-hd" id="income" tabIndex={-1}>{t('cashflowPage.income.title')}</h2>
        <span className="cf-meta num">{fmt(flows.income)}</span>
      </div>
      <div className="cf-ap">
        <span>{t('cashflowPage.income.active')} <b className="num">{fmt(flows.active)}</b></span>
        <span>{t('cashflowPage.income.passive')} <b className="num">{flows.income > 0 ? `${fmt(flows.passive)} · ${fmtPct((flows.passive / flows.income) * 100)}` : fmt(flows.passive)}</b></span>
      </div>
      {flows.income > 0 && <div className="cf-track" role="img" aria-label={t('cashflowPage.income.track')}>
        <i className="cf-kind--mandatory" style={{ width: `${(flows.active / flows.income) * 100}%` }} />
        <i className="cf-kind--optional" style={{ width: `${(flows.passive / flows.income) * 100}%` }} />
      </div>}
      {income.months.length === 0 ? <p className="note">{t('cashflowPage.income.empty')}</p> : <>
        {income.months.length < months.length && since && <p className="note">{t('cashflowPage.income.coverage', { start: since, count: income.months.length, of: months.length })}</p>}
        {!known && <p className="note">{t('cashflowPage.expenses.noRate')}</p>}
        <ul className="cf-list cf-list--plain">
          {income.rows.map(r => (
            <li key={r.id} className="cf-row cf-row--static cf-row--short">
              <span className="cf-row__name">{r.name}</span>
              <span className="cf-row__bar" aria-hidden="true"><i style={{ width: `${share(r.value)}%` }} /></span>
              <span className="cf-row__value num">{money(r.value)}</span>
            </li>
          ))}
          {(unallocated === null || unallocated > 0.005) && (
            <li className="cf-row cf-row--static cf-row--short">
              <span className="cf-row__name">{t('cashflowPage.expenses.unallocated')}{splitTo && <>{' · '}<Link to={splitTo} className="link-accent">{t('cashflowPage.expenses.split')}</Link></>}</span>
              <span className="cf-row__bar cf-row__bar--unallocated" aria-hidden="true"><i style={{ width: `${share(unallocated)}%` }} /></span>
              <span className="cf-row__value num">{money(unallocated)}</span>
            </li>
          )}
        </ul>
        {oneOff.length > 0 && <p className="note">{t('cashflowPage.income.oneOff', { amount: money(oneOffSum), names: oneOff.map(r => r.name).join(', ') })}</p>}
      </>}
      {people.length > 0 && <>
        <table className="page-table cf-who">
          <thead><tr><th>{t('cashflowPage.income.who')}</th><th className="num">{t('cashflowPage.kpi.income')}</th><th className="num">{t('cashflowPage.kpi.expense')}</th></tr></thead>
          <tbody>
            {[...people].sort((a, b) => (b.income ?? -1) - (a.income ?? -1)).map(p => (
              <tr key={p.member}>
                <td className="name"><span className="cf-who__name"><OwnerAvatar member={p.member} members={members} />{p.member}</span></td>
                <td className="num">{money(p.income)}</td>
                <td className="num">{money(p.expense)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">{t('cashflowPage.income.loans')}</p>
      </>}
    </section>
  )
}
