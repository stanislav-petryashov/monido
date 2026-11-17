import { useId, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { MonthFlow, MonthTotals } from '../../domain/types'
import { fitAxisLabels } from '../../components/charts/chartText'
import { useChartFrame } from '../../components/charts/useChartFrame'
import { fmtDate, fmtMonth, fmtMonthShort } from '../../lib/formatters'
import { niceTicks } from '../../lib/niceTicks'
import { signed } from '../../lib/pageHelpers'
import { COMPACT_LEFT, labelLane } from '../overview/chartFrame'

interface BandChartProps {
  /** The window's months, oldest first, ending at the period's end; a month with null totals (no rate) is a gap */
  months: MonthFlow[]
  /** The period's months: shaded, their saved bars in the primary colour */
  period: string[]
  /** The month whose two points are marked and whose figures are written */
  selected: string
  onPick: (month: string) => void
  /** The amounts: the dashboard's money, masked in privacy mode */
  fmt: (v: number) => string
  /** The gridline labels: the compact amount, masked too */
  fmtCompact: (v: number) => string
  /** A phone: 342 wide, no gridline or end labels, every second month */
  compact?: boolean
}

const T = 26
const STRIP = { wide: 44, compact: 32 }
const round1 = (n: number) => Math.round(n * 10) / 10
const known = (m: MonthFlow | undefined): m is MonthTotals => !!m && m.net !== null

/**
 * Income and expenses month by month as one band (plain SVG, the classes in cashflow.css): two ink lines labelled at
 * their right end, the gap hatched where the month saved and hatched red where it overspent (an assessment), the axis
 * not from zero. The period is a primary-tinted band, the selected month's two points primary with their figures in
 * ink. Under it the strip of what each month left, from a zero line: the period's bars primary, an overspent month red
 * and named. Each month's column is a button with its three figures as its name and title. A month whose totals are
 * unknown (a row without a rate) breaks the lines and has no bar; its figures read "—".
 */
export function BandChart({ months, period, selected, onPick, fmt, fmtCompact, compact = false }: BandChartProps) {
  const { t } = useTranslation()
  const uid = useId().replace(/:/g, '')
  const { ref, width } = useChartFrame(compact ? 342 : 1000)
  const W = width, n = months.length, lastMonth = months[n - 1]
  const values = months.filter(known).flatMap(m => [m.income, m.expense])
  const ticks = niceTicks(Math.min(...values), Math.max(...values))
  const tickLabels = ticks.map(v => fmtCompact(v))
  const L = compact ? COMPACT_LEFT : labelLane(tickLabels)
  const R = compact ? 8 : 72
  const B = compact ? 150 : 200
  const SH = compact ? STRIP.compact : STRIP.wide
  const S0 = B + 30
  const H = S0 + SH + 30
  const step = (W - L - R) / Math.max(1, n)
  const X = (i: number) => L + step * (i + 0.5)
  const lo = ticks[0], hi = ticks[ticks.length - 1]
  const Y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (B - T)

  // the gap between the lines, split where they cross so each part is saved or overspent
  const areas: { d: string; over: boolean }[] = []
  const quad = (x1: number, i1: number, e1: number, x2: number, i2: number, e2: number, over: boolean) =>
    areas.push({ d: `M${round1(x1)} ${round1(Y(i1))}L${round1(x2)} ${round1(Y(i2))}L${round1(x2)} ${round1(Y(e2))}L${round1(x1)} ${round1(Y(e1))}Z`, over })
  for (let i = 0; i < n - 1; i++) {
    const a = months[i], b = months[i + 1]
    if (!known(a) || !known(b)) continue
    const da = a.income - a.expense, db = b.income - b.expense
    if ((da >= 0) === (db >= 0)) quad(X(i), a.income, a.expense, X(i + 1), b.income, b.expense, da < 0)
    else {
      const k = da / (da - db), xm = X(i) + step * k, vm = a.income + (b.income - a.income) * k
      quad(X(i), a.income, a.expense, xm, vm, vm, da < 0)
      quad(xm, vm, vm, X(i + 1), b.income, b.expense, db < 0)
    }
  }
  const line = (pick: (m: MonthTotals) => number) => months.map((m, i) => (known(m) ? `${known(months[i - 1]) ? 'L' : 'M'}${round1(X(i))} ${round1(Y(pick(m)))}` : '')).join(' ')

  const inPeriod = months.map(m => period.includes(m.month))
  const i0 = inPeriod.indexOf(true), i1 = inPeriod.lastIndexOf(true)
  const k = months.findIndex(m => m.month === selected)
  const sel = known(months[k]) ? months[k] : undefined

  // the strip: the zero line splits it by the largest saving and the largest overspending
  const nets = months.filter(known).map(m => m.net)
  const up = Math.max(0, ...nets), down = Math.max(0, ...nets.map(v => -v))
  const Z = S0 + (up + down > 0 ? (SH * up) / (up + down) : SH)
  const bw = Math.max(3, Math.min(18, step * 0.5))
  const barH = (v: number) => (up + down > 0 ? (SH * Math.abs(v)) / (up + down) : 0)
  const worst = months.reduce<number>((w, m, i) => (known(m) && Math.round(m.net) < 0 && (w < 0 || m.net < months[w].net!) ? i : w), -1)

  const every = n <= 13 ? (compact ? 2 : 1) : n <= 24 ? (compact ? 4 : 2) : (compact ? 9 : 3)
  // the edge labels grow inwards: a centred first label was cut off at the left edge (German on a phone)
  const end = (i: number) => (n > 1 && i === n - 1 ? 'end' : n > 1 && i === 0 ? 'start' : 'middle')
  const money = (v: number | null) => (v === null ? '—' : fmt(v))
  const columnName = (m: MonthFlow) => t('cashflowPage.chart.column', { month: fmtMonth(m.month), income: money(m.income), expense: money(m.expense), net: money(m.net) })
  const onKey = (month: string) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(month) } }
  const label = n ? t('cashflowPage.chart.label', { from: fmtMonth(months[0].month), to: fmtMonth(months[n - 1].month) }) : ''

  return (
    <div className="cfband-wrap">
      <svg ref={ref} className={compact ? 'cfband cfband--compact' : 'cfband'} viewBox={`0 0 ${round1(W)} ${H}`} role="group" aria-label={label}>
        <defs>
          <pattern id={`${uid}-saved`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line className="cfband__hatch" x1="0" y1="0" x2="0" y2="6" /></pattern>
          <pattern id={`${uid}-over`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line className="cfband__hatch cfband__hatch--over" x1="0" y1="0" x2="0" y2="6" /></pattern>
        </defs>
        {i0 >= 0 && <rect className="cfband__period" x={round1(L + step * i0)} y={T - 16} width={round1(step * (i1 - i0 + 1))} height={H - T - 4} rx={6} />}
        {ticks.map((v, j) => (
          <g key={v}>
            <line className="cfband__grid" x1={L} x2={round1(W - R)} y1={round1(Y(v))} y2={round1(Y(v))} />
            {!compact && <text className="cfband__tick" x={L - 8} y={round1(Y(v))} textAnchor="end" dominantBaseline="middle">{tickLabels[j]}</text>}
          </g>
        ))}
        {areas.map((a, j) => <path key={j} className={a.over ? 'cfband__gap cfband__gap--over' : 'cfband__gap'} d={a.d} fill={`url(#${uid}-${a.over ? 'over' : 'saved'})`} />)}
        <path className="cfband__line cfband__line--income" d={line(m => m.income)} />
        <path className="cfband__line cfband__line--expense" d={line(m => m.expense)} />
        {!compact && known(lastMonth) && <>
          <text className="cfband__end" x={round1(X(n - 1) + 10)} y={round1(Y(lastMonth.income))} dominantBaseline="middle">{t('cashflowPage.chart.income')}</text>
          <text className="cfband__end" x={round1(X(n - 1) + 10)} y={round1(Y(lastMonth.expense))} dominantBaseline="middle">{t('cashflowPage.chart.expenses')}</text>
        </>}
        {sel && <>
          <circle className="cfband__dot" cx={round1(X(k))} cy={round1(Y(sel.income))} r={4.5} />
          <circle className="cfband__dot" cx={round1(X(k))} cy={round1(Y(sel.expense))} r={4.5} />
          {!compact && <>
            <text className="cfband__value" x={round1(X(k))} y={round1(Y(Math.max(sel.income, sel.expense)) - 10)} textAnchor={k >= n - 2 && n > 2 ? 'end' : 'middle'}>{fmt(Math.max(sel.income, sel.expense))}</text>
            <text className="cfband__value" x={round1(X(k))} y={round1(Y(Math.min(sel.income, sel.expense)) + 20)} textAnchor={k >= n - 2 && n > 2 ? 'end' : 'middle'}>{fmt(Math.min(sel.income, sel.expense))}</text>
          </>}
        </>}
        <text className="cfband__tick" x={L} y={S0 - 10}>{t('cashflowPage.chart.strip')}</text>
        <line className="cfband__zero" x1={L} x2={round1(W - R)} y1={round1(Z)} y2={round1(Z)} />
        {months.map((m, i) => {
          if (!known(m)) return null
          const neg = Math.round(m.net) < 0
          return <rect key={m.month} className={neg ? 'cfband__net cfband__net--over' : inPeriod[i] ? 'cfband__net cfband__net--now' : 'cfband__net'} data-month={m.month}
            x={round1(X(i) - bw / 2)} y={round1(m.net >= 0 ? Z - barH(m.net) : Z)} width={round1(bw)} height={round1(Math.max(1, barH(m.net)))} rx={2} />
        })}
        {worst >= 0 && !compact && (
          <text className="cfband__end" x={round1(X(worst) + bw / 2 + 4)} y={round1(Z + barH(months[worst].net!) / 2)} dominantBaseline="middle">{`${fmtMonthShort(months[worst].month)} ${signed(months[worst].net!, fmt)}`}</text>
        )}
        {fitAxisLabels(months.flatMap((m, i) => ((n - 1 - i) % every === 0
          ? [{ month: m.month, x: round1(X(i)), anchor: end(i), text: i < every || m.month.endsWith('-01') ? fmtDate(m.month) : fmtMonthShort(m.month) }]
          : []))).map(l => <text key={l.month} className="cfband__x" x={l.x} y={H - 6} textAnchor={l.anchor}>{l.text}</text>)}
        {months.map((m, i) => (
          <rect key={`hit-${m.month}`} className="cfband__hit" role="button" tabIndex={0} aria-label={columnName(m)} aria-pressed={m.month === selected}
            x={round1(L + step * i)} y={0} width={round1(step)} height={H} onClick={() => onPick(m.month)} onKeyDown={onKey(m.month)}>
            <title>{columnName(m)}</title>
          </rect>
        ))}
      </svg>
      <ul className="cfband__key">
        <li><i className="cfband__swatch cfband__swatch--income" />{t('cashflowPage.chart.income')}</li>
        <li><i className="cfband__swatch cfband__swatch--expense" />{t('cashflowPage.chart.expenses')}</li>
        <li><i className="cfband__swatch cfband__swatch--saved" />{t('cashflowPage.chart.saved')}</li>
        <li><i className="cfband__swatch cfband__swatch--over" />{t('cashflowPage.chart.overspent')}</li>
        <li><i className="cfband__swatch cfband__swatch--now" />{t(period.length > 1 ? 'cashflowPage.chart.selectedPeriod' : 'cashflowPage.chart.selectedMonth')}</li>
      </ul>
    </div>
  )
}
