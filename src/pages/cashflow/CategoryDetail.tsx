import { IconArrowRight } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { CategoryRow, categorySeries, categorySources } from '../../domain/cashflowPeriod'
import { OwnerAvatar } from '../../components/ui/OwnerAvatar'
import { Link } from '../../components/ui/Link'
import { useChartFrame } from '../../components/charts/useChartFrame'
import { fmtInMonth, fmtMonth, fmtMonthShort } from '../../lib/formatters'

interface CategoryDetailProps {
  row: CategoryRow
  /** The category's name as shown (the loan-payments one has no name of its own) */
  name: string
  series: ReturnType<typeof categorySeries>
  /** The accounts of the period's last month that hold it; null — still loading */
  sources: ReturnType<typeof categorySources> | null
  /** The period's months (their bars primary) and its name */
  months: string[]
  periodName: string
  members: string[]
  /** The categories screen on the period's last month; null — a viewer */
  editTo: string | null
  fmt: (v: number) => string
  /** An amount in an account's own currency, masked in privacy mode */
  moneyIn: (v: number, currency?: string) => string
}

const H = 150, TOP = 22, BOTTOM = 22
const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * One category opened: its months since categories began as bars (the period's primary, the values in ink on top), its
 * usual as a dashed line, one sentence (the period's sum, the usual and the months it reads, the largest month when it
 * stands out), the accounts of the period's last month that hold it, and the way to change that month's split.
 */
export function CategoryDetail({ row, name, series, sources, months, periodName, members, editTo, fmt, moneyIn }: CategoryDetailProps) {
  const { t } = useTranslation()
  const { ref, width } = useChartFrame(400)
  const end = months[months.length - 1]
  const n = series.months.length
  const max = Math.max(1, ...series.months.map(m => m.value ?? 0), row.usual ?? 0) * 1.08
  const step = width / Math.max(1, n), bw = Math.min(56, step * 0.56)
  const money = (v: number | null) => (v === null ? '—' : fmt(v))
  const Y = (v: number) => H - BOTTOM - (v / max) * (H - BOTTOM - TOP)
  const top = series.top
  const sentence = [
    t(months.length > 1 ? 'cashflowPage.category.summaryPerMonth' : 'cashflowPage.category.summary', { name, amount: money(row.value), period: periodName, perMonth: money(row.perMonth) }),
    row.usual !== null ? t('cashflowPage.category.usual', { usual: fmt(row.usual), count: row.usualCount }) : null,
    top && top.value > 2 * (row.usual || top.value) ? t('cashflowPage.category.top', { month: fmtMonth(top.month), amount: fmt(top.value) }) : null,
  ].filter(Boolean).join(' ')

  return (
    <div className="cf-detail">
      <svg ref={ref} className="cf-detail__chart" viewBox={`0 0 ${round1(width)} ${H}`} role="img" aria-label={t('cashflowPage.category.chart', { name })}>
        <line className="cfband__zero" x1={0} x2={round1(width)} y1={H - BOTTOM} y2={H - BOTTOM} />
        {series.months.map((m, i) => {
          const cx = step * (i + 0.5)
          // a month whose amount has no rate: no bar, a dash
          if (m.value === null) return <text key={m.month} className="cfband__x" x={round1(cx)} y={H - 4} textAnchor="middle">{`${fmtMonthShort(m.month)} —`}</text>
          const value = m.value
          return (
            <g key={m.month}>
              <rect className={months.includes(m.month) ? 'cfband__net cfband__net--now' : 'cfband__net'} x={round1(cx - bw / 2)} y={round1(Y(value))} width={round1(bw)} height={round1(Math.max(1, H - BOTTOM - Y(value)))} rx={3} />
              <text className="cfband__value" x={round1(cx)} y={round1(Y(value) - 6)} textAnchor="middle">{fmt(value)}</text>
              <text className="cfband__x" x={round1(cx)} y={H - 4} textAnchor="middle">{fmtMonthShort(m.month)}</text>
            </g>
          )
        })}
        {row.usual !== null && <>
          <line className="cf-detail__usual" x1={0} x2={round1(width)} y1={round1(Y(row.usual))} y2={round1(Y(row.usual))} />
        </>}
      </svg>
      <div className="cf-detail__text">
        <p>{sentence}</p>
        {sources && sources.length > 0 && <>
          <h3 className="cf-detail__label">{t('cashflowPage.category.from', { month: fmtInMonth(end) })}</h3>
          <ul className="cf-sources">
            {sources.map(s => (
              <li key={`${s.other ? 's' : 'a'}|${s.bank}|${s.member}|${s.currency}`}>
                {s.member ? <OwnerAvatar member={s.member} members={members} /> : <span className="lane__avatar" aria-hidden="true" />}
                <span className="cf-sources__name">{s.bank}{s.member ? <span className="cf-meta">{` · ${s.member}`}</span> : s.other && <span className="cf-meta">{` · ${t('cashflowPage.category.otherSource')}`}</span>}</span>
                <b className="num">{s.currency ? moneyIn(s.amount, s.currency) : moneyIn(s.amount)}</b>
              </li>
            ))}
          </ul>
        </>}
        {editTo && (
          <Link to={editTo} className="link-accent cf-detail__edit">
            {t('cashflowPage.category.edit', { month: t(`dates.monthOf.${Number(end.slice(5, 7))}`) })}
            <IconArrowRight size={16} stroke={2} aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  )
}
