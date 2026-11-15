import { niceStep } from '../../../../lib/niceTicks'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { computeSchedule, type EarlyPaymentsEffect, type LoanEarlyPayment, type LoanRow, type ScheduleRow } from '../../../../domain/loans'
import { fmtCompact, fmtDayNumeric, fmtMonths } from '../../../../lib/formatters'
import { PRIVACY_MASK, usePrivacy } from '../../../../lib/privacy'
import { yearOf } from './money'
import { useChartFrame } from '../../../../components/charts/useChartFrame'

interface BalanceChartProps {
  loan: LoanRow
  schedule: ScheduleRow[]
  payments: LoanEarlyPayment[]
  /** What the early payments did; null — none: no counterfactual line */
  effect: EarlyPaymentsEffect | null
  /** Today, 'YYYY-MM-DD' */
  today: string
  /** A phone: 340 wide, a year label every 8th, no bracket label */
  compact: boolean
}

const TOP = 22


/**
 * «Balance»: the schedule's balance in ink from issue to the last payment, solid up to today and faded after it; a dot
 * per early payment; today as a violet line with «today». With early payments, the same loan without them is a dashed
 * grey line, with a bracket between the two last payments «−N mo». The key names the marks. Amounts are masked in
 * privacy mode; the shapes stay.
 */
export function BalanceChart({ loan, schedule, payments, effect, today, compact: phone }: BalanceChartProps) {
  const { ref: svgRef, width } = useChartFrame(phone ? 340 : 780)
  const compact = phone || width < 480
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const titleId = useId()
  if (schedule.length === 0) return null
  const principal = Number(loan.principal)
  const issue = String(loan.issue_date).slice(0, 10)
  const points = [{ date: issue, balance: principal }, ...schedule.flatMap(r => r.events ?? [{ date: r.date, balance: r.closingBalance }])]
  const without = effect ? [{ date: issue, balance: principal }, ...computeSchedule(loan, []).map(r => ({ date: r.date, balance: r.closingBalance }))] : null
  const end = schedule[schedule.length - 1].date
  const W = width, H = compact ? 230 : 260, L = compact ? 44 : 60, R = compact ? 12 : 24, B = H - 26
  const plotW = Math.max(1, W - L - R)
  const t0 = yearOf(issue), t1 = Math.max(yearOf(end), effect ? yearOf(effect.lastWithout) : 0) + 0.4
  const step = niceStep(principal * 1.04 || 1)
  const hi = Math.ceil((principal * 1.04) / step) * step || 1
  const X = (date: string) => L + ((yearOf(date) - t0) / (t1 - t0 || 1)) * plotW
  const Y = (v: number) => B - (v / hi) * (B - TOP)
  const path = (pts: { date: string; balance: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.date).toFixed(1)} ${Y(p.balance).toFixed(1)}`).join(' ')
  const past = points.filter(p => p.date <= today)
  const future = past.length > 0 ? points.slice(past.length - 1) : points
  const showToday = today >= issue && today <= end
  const todayBalance = past[past.length - 1]?.balance ?? principal
  const grid: number[] = []
  for (let g = 0; g <= hi + step / 2; g += step) grid.push(g)
  const firstYear = Math.ceil(t0), every = Math.max(t1 - t0 > 12 ? (compact ? 8 : 4) : 1, Math.ceil((t1 - t0) * 32 / plotW))
  const years: number[] = []
  for (let y = firstYear; y <= t1; y += every) years.push(y)
  const dot = (ep: LoanEarlyPayment) => {
    const date = String(ep.payment_date).slice(0, 10)
    const at = points.find(p => p.date >= date)
    return at ? { x: X(date < issue ? issue : date), y: Y(at.balance) } : null
  }
  const xe = X(end), xn = effect ? X(effect.lastWithout) : 0
  return (
    <section className="admin-panel admin-chart" aria-labelledby={titleId}>
      <div className="card-hd--row acc-card__hd">
        <h2 className="card-hd" id={titleId}>{t('data.loans.chart.title')}</h2>
        <span className="acc-card__meta">{t('data.loans.chart.meta', { currency: loan.currency })}</span>
      </div>
      <svg ref={svgRef} className="ln-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('data.loans.chart.label', { name: loan.name })}>
        {grid.map(g => (
          <g key={g}>
            <line className="ln-chart__grid" x1={L} x2={W - R} y1={Y(g)} y2={Y(g)} />
            <text className="ln-chart__t" x={L - 8} y={Y(g) + 4} textAnchor="end">{g === 0 ? '0' : hidden ? PRIVACY_MASK : fmtCompact(g)}</text>
          </g>
        ))}
        {years.map(y => <text key={y} className="ln-chart__t" x={X(`${y}-01-01`)} y={H - 6} textAnchor="middle">{y}</text>)}
        {without && <path className="ln-chart__without" d={path(without)} />}
        <path className="ln-chart__bal" d={path(past.length > 1 ? past : points.slice(0, 1))} />
        {future.length > 1 && <path className="ln-chart__ahead" d={path(future)} />}
        {payments.map(ep => { const d = dot(ep); return d && <circle key={ep.rowid} className="ln-chart__dot" cx={d.x} cy={d.y} r={4} /> })}
        {showToday && (
          <>
            <line className="ln-chart__today" x1={X(today)} x2={X(today)} y1={TOP} y2={B} />
            <circle className="ln-chart__now" cx={X(today)} cy={Y(todayBalance)} r={4.5} />
            <text className="ln-chart__todayt" x={X(today)} y={TOP - 8} textAnchor="middle">{t('data.loans.chart.today')}</text>
          </>
        )}
        {effect && effect.monthsSaved > 0 && (
          <g className="ln-chart__gap">
            <line x1={xe} x2={xn} y1={B - 4} y2={B - 4} />
            <line x1={xe} x2={xe} y1={B - 8} y2={B} />
            <line x1={xn} x2={xn} y1={B - 8} y2={B} />
            {!compact && <text className="ln-chart__a" x={(xe + xn) / 2} y={Y(hi * 0.13)} textAnchor="middle">−{fmtMonths(effect.monthsSaved)}</text>}
          </g>
        )}
      </svg>
      <div className="chart-key ln-key">
        <span><i />{t('data.loans.chart.keyBalance')}</span>
        {future.length > 1 && <span><i className="ln-key__ahead" />{t('data.loans.chart.keyAhead')}</span>}
        {payments.length > 0 && <span><i className="chart-key__dot ln-key__dot" />{t('data.loans.chart.keyEarly')}</span>}
        {effect && <span><i className="ln-key__without" />{t('data.loans.chart.keyWithout', { date: fmtDayNumeric(effect.lastWithout) })}</span>}
        {showToday && <span><i className="chart-key__marker ln-key__today" />{t('data.loans.chart.keyToday', { date: fmtDayNumeric(today) })}</span>}
      </div>
    </section>
  )
}
