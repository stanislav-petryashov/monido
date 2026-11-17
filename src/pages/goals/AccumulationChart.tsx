import { niceStep } from '../../lib/niceTicks'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useChartFrame } from '../../components/charts/useChartFrame'
import { monthsBetween, shiftMonth } from '../../domain/dates'
import { ANNUAL_RETURN, fireReturnRange, fireValues } from '../../domain/goals'
import type { FireSummary } from '../../domain/types'
import { fmtCompact, fmtDate, fmtDayNumeric, fmtMonthNumeric, fmtNum } from '../../lib/formatters'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import { deadlineOf } from './text'
import type { GoalLine } from './view'

interface AccumulationChartProps {
  line: GoalLine
  /** Independence's forecast (its series and strategies); null — another goal */
  fire: FireSummary | null
  /** The plan's month 0, 'YYYY-MM' */
  month: string
  /** Today, 'YYYY-MM-DD' (the key's «today») */
  today: string
  currency: string
  /** Whether the saving is known; false — only the pace line */
  known: boolean
  fmt: (v: number) => string
  /** A phone: 340 wide, every 6th month labelled, no target label at the right */
  compact: boolean
}

const TOP = 24
/** Room the «… by the deadline» label takes to the right of its point */
const LABEL_W = 140


/**
 * «How it accumulates»: the plan in ink from today's saved amount (the goal's monthly shares), a dashed pace line to the
 * target at the deadline, the target as a dotted rule and the deadline as a thin line; the hollow point is what it holds by
 * the deadline when it is late, the filled one the month it is reached; today is the violet line. Independence draws the
 * server's forecast at 8% in ink and its two strategies in grey (+ more a month thin, 10% dashed), their months in the key.
 * Without the saving only the pace line stays. Amounts are masked in privacy mode; the shapes and months stay.
 */
export function AccumulationChart({ line, fire, month, today, currency, known, fmt, compact: phone }: AccumulationChartProps) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const titleId = useId()
  const { ref, width } = useChartFrame(phone ? 340 : 780)
  const compact = phone || width < 480
  const a = line.alloc
  const target = line.item.targetBase
  const current = line.item.currentBase
  if (!a || target === null || current === null || target <= 0) return null
  const deadline = deadlineOf(line)
  const months = a.monthsToDeadline
  const at = (ym: string | null) => (ym === null ? null : Math.max(0, monthsBetween(month, ym)))
  const reachN = known ? at(a.projectedDate) : null
  const series = line.isFire && known && fire?.series ? fire.series : null
  const strategies = series ? { low: at(fire!.strategies.low), high: at(fire!.strategies.high) } : null
  // the months drawn: to the deadline and the month it is reached, a little past; a goal never reached is drawn a year past its deadline
  const N = Math.max(1, months, reachN ?? (known && a.status !== 'done' ? months + 12 : 0), strategies?.low ?? 0, strategies?.high ?? 0) + (line.isFire ? 10 : 2)
  // the plan without the snapshot's series (a "what if" saving): the independence goal still grows at its return
  const plan = known && !series ? fireValues(current, a.shares, line.isFire ? ANNUAL_RETURN : 0, Math.min(N, reachN ?? N)) : null
  const W = width, H = compact ? 220 : line.isFire ? 270 : 250, L = compact ? 48 : 64, R = compact ? 16 : 70, B = H - 26
  const step = niceStep(target * (line.isFire ? 1.2 : 1.05))
  const hi = Math.ceil((target * (line.isFire ? 1.2 : 1.05)) / step) * step
  const X = (n: number) => L + (n / N) * (W - L - R)
  const Y = (v: number) => B - (Math.min(v, hi) / hi) * (B - TOP)
  const path = (values: number[], until = values.length - 1) => values.slice(0, until + 1).map((v, n) => `${n ? 'L' : 'M'}${X(n).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ')
  // the area between two lines: out along the upper one, back along the lower one, each to the month it stops (or the chart's end)
  const band = (upper: number[], lower: number[]) => {
    const points = (values: number[]) => values.slice(0, Math.min(N, values.length - 1) + 1).map((v, n) => `${X(n).toFixed(1)} ${Y(v).toFixed(1)}`)
    return `M${[...points(upper), ...points(lower).reverse()].join(' L')} Z`
  }
  const money = (v: number) => (hidden ? PRIVACY_MASK : fmt(v))
  const axis = (v: number) => (v === 0 ? '0' : hidden ? PRIVACY_MASK : fmtCompact(v))
  const grid: number[] = []
  for (let g = 0; g <= hi + step / 2; g += step) grid.push(g)
  // months by their short name, or years on a long run
  const ticks: { n: number; text: string }[] = []
  if (N > 60) {
    const every = compact ? 6 : 3
    for (let y = Number(month.slice(0, 4)) + 1; ; y += 1) {
      const n = monthsBetween(month, `${y}-01`)
      if (n > N) break
      if ((y - Number(month.slice(0, 4)) - 1) % every === 0) ticks.push({ n, text: String(y) })
    }
  } else {
    const every = compact ? 6 : N > 14 ? 3 : 2
    for (let n = 0; n <= N; n += every) ticks.push({ n, text: fmtDate(shiftMonth(month, n)) })
  }
  const xd = X(months)
  const held = line.atDeadline
  const late = known && a.status !== 'on_track' && a.status !== 'done' && held !== null && months > 0
  const rate = fmtNum(ANNUAL_RETURN * 100, 0)
  // a reached goal is reached in every strategy
  const monthOrNever = (n: number | null) => (fire?.reached ? t('goalsPage.status.done') : n === null ? t('goalsPage.chart.never') : fmtMonthNumeric(shiftMonth(month, n)))

  return (
    <section className="card gl-card" aria-labelledby={titleId}>
      <div className="card-hd--row gl-card__hd">
        <h2 className="card-hd" id={titleId}>{t(line.isFire ? 'goalsPage.chart.fireTitle' : 'goalsPage.chart.title')}</h2>
        <span className="gl-card__meta">{t(line.isFire ? 'goalsPage.chart.fireMeta' : 'goalsPage.chart.meta', { currency })}</span>
      </div>
      <svg ref={ref} className="gl-chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={t(line.isFire ? 'goalsPage.chart.fireLabel' : 'goalsPage.chart.label', { name: line.name })}>
        {grid.map(g => (
          <g key={g}>
            <line className="gl-chart__grid" x1={L} x2={W - R} y1={Y(g)} y2={Y(g)} />
            <text className="gl-chart__t" x={L - 8} y={Y(g) + 4} textAnchor="end">{axis(g)}</text>
          </g>
        ))}
        {ticks.map(k => <text key={k.n} className="gl-chart__t" x={X(k.n)} y={H - 6} textAnchor="middle">{k.text}</text>)}
        <line className="gl-chart__target" x1={L} x2={W - R} y1={Y(target)} y2={Y(target)} />
        {!compact && <text className="gl-chart__a" x={W - R + 6} y={Y(target) + 4}>{t('goalsPage.chart.target')}</text>}
        {months > 0 && (
          <>
            <line className="gl-chart__deadline" x1={xd} x2={xd} y1={TOP} y2={B} />
            <text className="gl-chart__a" x={xd} y={TOP - 8} textAnchor="middle">{t('goalsPage.chart.deadline', { month: fmtMonthNumeric(deadline) })}</text>
            {(!series) && <path className="gl-chart__pace" d={`M${X(0)} ${Y(current)} L${xd} ${Y(target)}`} />}
          </>
        )}
        {series && strategies && (
          <>
            {/* the return range: an area from the high line out and the low line back, each to where it stops */}
            <path className="gl-chart__band" d={band(series.high, series.low)} />
            <path className="gl-chart__plan" d={path(series.pace, Math.min(N, series.pace.length - 1))} />
            {[strategies.low, strategies.high].map((n, i) => n !== null && <circle key={i} className="gl-chart__dot" cx={X(n)} cy={Y(target)} r={3} />)}
          </>
        )}
        {plan && <path className="gl-chart__plan" d={path(plan)} />}
        {late && <>
          <circle className="gl-chart__held" cx={xd} cy={Y(held)} r={4} />
          {/* near the right edge the label reads leftwards, so it stays inside the plot */}
          <text className="gl-chart__vl" x={xd + LABEL_W > W - R ? xd - 8 : xd + 8} y={Y(held) + 20} textAnchor={xd + LABEL_W > W - R ? 'end' : 'start'}>{t('goalsPage.chart.atDeadline', { amount: money(held) })}</text>
        </>}
        {reachN !== null && a.status !== 'done' && (
          <>
            <circle className="gl-chart__dot" cx={X(reachN)} cy={Y(target)} r={4.5} />
            <text className="gl-chart__vl" x={Math.min(X(reachN), W - R - 24)} y={Y(target) - 10} textAnchor="middle">{fmtMonthNumeric(shiftMonth(month, reachN))}</text>
          </>
        )}
        <line className="gl-chart__today" x1={X(0)} x2={X(0)} y1={TOP} y2={B} />
        <circle className="gl-chart__now" cx={X(0)} cy={Y(current)} r={4.5} />
      </svg>
      <div className="chart-key gl-key">
        {series && strategies ? (
          <>
            <span><i className="gl-key__plan" />{t('goalsPage.chart.keyForecast', { rate, month: monthOrNever(reachN) })}</span>
            <span><i className="gl-key__band" />{t('goalsPage.chart.keyRange', { low: fmtNum(fireReturnRange().low * 100, 0), high: fmtNum(fireReturnRange().high * 100, 0), early: monthOrNever(strategies.high), late: monthOrNever(strategies.low) })}</span>
          </>
        ) : (
          <>
            {plan && <span><i className="gl-key__plan" />{t('goalsPage.chart.keyPlan')}</span>}
            {months > 0 && <span><i className="gl-key__pace" />{line.isFire
              ? t('goalsPage.chart.keyOnTime')
              : t('goalsPage.chart.keyPace', { month: fmtMonthNumeric(deadline), amount: money(a.requiredMonthlyBase) })}</span>}
          </>
        )}
        <span><i className="gl-key__target" />{t('goalsPage.chart.keyTarget', { amount: money(target) })}</span>
        <span><i className="chart-key__marker gl-key__today" />{t('goalsPage.chart.keyToday', { date: fmtDayNumeric(today) })}</span>
      </div>
    </section>
  )
}
