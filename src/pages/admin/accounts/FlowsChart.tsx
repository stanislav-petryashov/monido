import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { round2 } from '../../../domain/fx'
import { shiftMonth } from '../../../domain/dates'
import { fmtCompactCurrency, fmtMonth, fmtMonthShort } from '../../../lib/formatters'
import { niceTicks } from '../../../lib/niceTicks'
import { signed } from '../../../lib/pageHelpers'
import { PRIVACY_MASK, useMoney, usePrivacy } from '../../../lib/privacy'
import { COMPACT_LEFT, labelLane, MONTHLY_AXIS, RIGHT } from '../../overview/chartFrame'
import type { AccountWindow } from './BalanceCard'
import { useChartFrame } from '../../../components/charts/useChartFrame'

/** The frame in viewBox units, as WindowChart's: the wide one about a pixel a unit in the detail column, the phone's narrower */
const FRAMES = { wide: { W: 700, H: 200 }, compact: { W: 320, H: 180 } }
const TOP = 14
const BOTTOM = 24
const COL_MAX = 16

const round1 = (n: number) => Math.round(n * 10) / 10

interface FlowsChartProps {
  name: string
  currency: string
  /** The account's monthly income and expense up to the last closed month */
  flows: { month: string; income: number; expense: number }[]
  lastMonth: string
  /** The balance card's window: the same months */
  window: AccountWindow
  /** The account's first balance month, where the balance card starts; null — no balance (the first flow month then) */
  firstMonth: string | null
  compact: boolean
}

/**
 * «Income and expenses by month», for an account that has any: income columns up and expense columns down from one zero
 * line, the month's «left» (income less expense) as a violet line; a month without a flow row is a gap; the meta sums the
 * window, which starts where the balance card's does. A plain SVG with classes.
 */
export function FlowsChart({ name, currency, flows, lastMonth, window, firstMonth, compact: phone }: FlowsChartProps) {
  const { ref: svgRef, width } = useChartFrame(FRAMES[phone ? 'compact' : 'wide'].W)
  const compact = phone || width < 480
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const masked = useMoney()
  const titleId = useId()
  const byMonth = new Map(flows.map(f => [f.month, f]))
  const first = firstMonth ?? flows.reduce((m, f) => (f.month < m ? f.month : m), lastMonth)
  const year = shiftMonth(lastMonth, -11)
  const start = window === '12' && year > first ? year : first
  const months: string[] = []
  for (let m = start; m <= lastMonth; m = shiftMonth(m, 1)) months.push(m)
  /** A month without a flow row is a gap: no column, the «left» line broken there */
  const rows = months.map(m => byMonth.get(m) ?? null)
  const known = rows.filter(r => r !== null)
  const income = round2(known.reduce((s, r) => s + r.income, 0))
  const expense = round2(known.reduce((s, r) => s + r.expense, 0))
  const money = (v: number) => masked(v, currency)

  const top = niceTicks(0, Math.max(1, ...known.map(r => Math.max(r.income, r.expense)))).at(-1)!
  const label = (v: number) => (hidden ? PRIVACY_MASK : fmtCompactCurrency(v, currency))
  const gridLabels = [`+${label(top)}`, label(0), `−${label(top)}`]
  const W = width, { H } = FRAMES[compact ? 'compact' : 'wide']
  const LEFT = compact ? COMPACT_LEFT : labelLane(gridLabels)
  const plotW = Math.max(1, W - LEFT - RIGHT)
  const n = rows.length
  const mid = TOP + (H - TOP - BOTTOM) / 2
  const k = (mid - TOP) / top
  const x = (i: number) => LEFT + ((i + 0.5) * plotW) / n
  const colW = Math.min(COL_MAX, (plotW / n) * 0.6)
  const every = Math.max(compact ? 3 : 2, Math.ceil(32 / (plotW / n)))
  const yearEvery = Math.max(1, Math.ceil(32 / (plotW / n * 12)))
  const xLabels = months.flatMap((m, i) => (n <= MONTHLY_AXIS
    ? (i % every === (n - 1) % every ? [{ i, text: fmtMonthShort(m) }] : [])
    : (m.endsWith('-01') && (Number(m.slice(0, 4)) - Number(lastMonth.slice(0, 4))) % yearEvery === 0 ? [{ i, text: m.slice(0, 4) }] : [])))
  const leftRuns = rows.reduce<string[][]>((runs, r, i) => {
    if (r === null) runs.push([])
    else runs[runs.length - 1].push(`${round1(x(i))},${round1(mid - (r.income - r.expense) * k)}`)
    return runs
  }, [[]]).filter(run => run.length > 0)

  return (
    <section className="admin-panel admin-chart" aria-labelledby={titleId}>
      <div className="card-hd--row acc-card__hd">
        <h2 className="card-hd" id={titleId}>{t('pages.accounts.flows.title')}</h2>
        <span className="acc-card__meta">{t('pages.accounts.flows.meta', {
          over: t(window === '12' ? 'pages.accounts.flows.over12' : 'pages.accounts.flows.overAll'),
          income: money(income), expense: money(expense), left: hidden ? PRIVACY_MASK : signed(round2(income - expense), money),
        })}</span>
      </div>
      <svg ref={svgRef} className="acc-flows" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={t('pages.accounts.flows.label', { name, from: fmtMonth(months[0]), to: fmtMonth(lastMonth) })}>
        {[TOP, mid, H - BOTTOM].map((gy, j) => (
          <g key={j}>
            <line className="acc-flows__grid" x1={LEFT} x2={W - RIGHT} y1={round1(gy)} y2={round1(gy)} />
            {!compact && <text className="acc-flows__label" x={LEFT - 8} y={round1(gy)} textAnchor="end" dominantBaseline="middle">{gridLabels[j]}</text>}
          </g>
        ))}
        {rows.map((r, i) => r && (
          <g key={r.month}>
            {r.income > 0 && <rect className="acc-flows__inc" x={round1(x(i) - colW / 2)} y={round1(mid - r.income * k)} width={round1(colW)} height={round1(r.income * k)} rx={1.5} />}
            {r.expense > 0 && <rect className="acc-flows__exp" x={round1(x(i) - colW / 2)} y={round1(mid)} width={round1(colW)} height={round1(r.expense * k)} rx={1.5} />}
          </g>
        ))}
        {leftRuns.map(run => <polyline key={run[0]} className="acc-flows__left" points={run.join(' ')} />)}
        {xLabels.map(({ i, text }) => <text key={i} className="acc-flows__x" x={round1(x(i))} y={H - 4} textAnchor="middle">{text}</text>)}
      </svg>
      <div className="acc-flows__key">
        <span><i className="acc-flows__inc" />{t('pages.accounts.flows.income')}</span>
        <span><i className="acc-flows__exp" />{t('pages.accounts.flows.expense')}</span>
        <span><i className="acc-flows__left" />{t('pages.accounts.flows.left')}</span>
      </div>
    </section>
  )
}
