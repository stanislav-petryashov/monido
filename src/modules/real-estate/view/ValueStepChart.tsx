import { niceStep } from '../../../lib/niceTicks'
import { useTranslation } from 'react-i18next'
import { fmtCompact, fmtCompactCurrency, fmtDayNumeric } from '../../../lib/formatters'
import { PRIVACY_MASK, useMoney, usePrivacy } from '../../../lib/privacy'
import { useChartFrame } from '../../../components/charts/useChartFrame'
import { wrapChartText } from '../../../components/charts/chartText'
import { labelLane } from '../../../pages/overview/chartFrame'

interface ValueStepChartProps {
  name: string
  purchase: { price: number; date: string; currency: string }
  /** The valuations in `currency`, any order */
  valuations: { year: number; value: number }[]
  currency: string
  /** The year of the last closed month: the chart runs to it; without a valuation it is the «no valuation» band */
  currentYear: number
  /** A phone: 340 wide, two-digit years, every other label */
  compact: boolean
}

const H = 300
const TOP = 28
const BASE = 196
const STRIP_TOP = 222
const STRIP_H = 46

/**
 * The value by year since purchase, as steps: a valuation holds for its whole year in the calculation (capital.ts takes
 * the latest valuation up to the year), the price before the first one. A dot per valuation, the purchase price as a
 * dashed line, the first (when it differs from the price) and the latest values labelled; the current year without a
 * valuation is a primary band with a dashed continuation. Under it a grey bar per valuation year — its change against
 * the previous valuation — and «—» for the current year. Amounts are masked in privacy mode; the shapes stay.
 */
export function ValueStepChart({ name, purchase, valuations, currency, currentYear, compact: phone }: ValueStepChartProps) {
  const { ref: svgRef, width } = useChartFrame(phone ? 340 : 780)
  const compact = phone || width < 480
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const money = useMoney()
  const sameCurrency = purchase.currency === currency
  const byYear = new Map(valuations.map(v => [v.year, v.value]))
  const bought = Number(purchase.date.slice(0, 4))
  const first = Math.min(...valuations.map(v => v.year))
  const y0 = Number.isFinite(bought) && bought > 0 && sameCurrency ? Math.min(bought, first) : first
  const y1 = Math.max(currentYear, ...valuations.map(v => v.year))
  // each year's value in the calculation: the latest valuation up to it, the price before the first
  const years: { year: number; value: number; valued: boolean }[] = []
  let carried = sameCurrency ? purchase.price : valuations.find(v => v.year === first)!.value
  for (let y = y0; y <= y1; y++) {
    if (byYear.has(y)) carried = byYear.get(y)!
    years.push({ year: y, value: carried, valued: byYear.has(y) })
  }
  const missingNow = !byYear.has(y1)
  const values = [...valuations.map(v => v.value), ...(sameCurrency ? [purchase.price] : [])]
  const lo = Math.min(...values), hi = Math.max(...values)
  const step = niceStep(hi - lo || hi * 0.1 || 1, 3)
  const gLo = Math.floor(lo / step) * step, gHi = Math.ceil((hi * 1.04) / step) * step
  const W = width, L = Math.max(compact ? 48 : 64, labelLane([hidden ? PRIVACY_MASK : fmtCompactCurrency(gLo, currency), hidden ? PRIVACY_MASK : fmtCompactCurrency(gHi, currency), t('modules.real_estate.chart.perYear')])), R = 16
  const n = years.length, cw = (W - L - R) / n
  const X = (i: number) => L + i * cw
  const Y = (v: number) => BASE - ((v - gLo) / (gHi - gLo || 1)) * (BASE - TOP)
  // the line starts on the purchase day, not on 1 January
  const buyDay = new Date(`${purchase.date.slice(0, 10)}T00:00:00Z`)
  const x0 = sameCurrency && years[0].year === bought && !Number.isNaN(buyDay.getTime())
    ? X(0) + ((buyDay.getUTCMonth() + buyDay.getUTCDate() / 31) / 12) * cw : X(0)
  const drawn = missingNow ? n - 1 : n
  const d = years.slice(0, drawn).map((p, i) => `${i ? 'L' : 'M'}${i ? X(i) : x0} ${Y(p.value)} L${X(i + 1)} ${Y(p.value)}`).join(' ')
  const area = `${d} L${X(drawn)} ${BASE} L${x0} ${BASE} Z`
  const grid: number[] = []
  for (let g = gLo; g <= gHi + step / 2; g += step) grid.push(g)
  const tick = (g: number) => (hidden ? PRIVACY_MASK : fmtCompactCurrency(g, currency))
  // the change strip: each valuation against the one before, the first against the price (in one currency)
  let prev: number | null = sameCurrency ? purchase.price : null
  const changes = years.map(p => {
    if (!p.valued) return null
    const c = prev === null ? null : p.value - prev
    prev = p.value
    return c
  })
  const maxChange = Math.max(1, ...changes.map(c => Math.abs(c ?? 0)))
  const short = (c: number) => (hidden ? PRIVACY_MASK : c === 0 ? '0' : `${c > 0 ? '+' : ''}${fmtCompact(c)}`)
  const every = Math.max(1, Math.ceil(32 / cw))
  const sparse = (i: number) => i !== 0 && i !== n - 1 && (i % every !== (n - 1) % every || i * cw < 32 || (n - 1 - i) * cw < 32)
  const firstValued = years.findIndex(p => p.valued)
  const lastValued = years.map(p => p.valued).lastIndexOf(true)
  const now = years[n - 1]
  // Reserve full text widths rather than assuming every year has room for a caption.
  const changeLabels = new Set<number>()
  let nextLeft = W - R
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i]
    if (c === null) continue
    const width = short(c).length * 6.5
    const cx = X(i) + cw / 2
    if (cx + width / 2 + 4 <= nextLeft && cx - width / 2 >= L) {
      changeLabels.add(i)
      nextLeft = cx - width / 2 - 4
    }
  }
  const valuePosition = (at: number, value: number) => {
    const width = money(value, currency).length * 7
    return at - 6 - width >= L
      ? { x: at - 6, textAnchor: 'end' as const }
      : { x: Math.max(L, Math.min(at + 8, W - R - width)), textAnchor: 'start' as const }
  }
  const narrow = W < 300
  const purchaseText = compact ? t('modules.real_estate.chart.purchaseShort', { price: money(purchase.price, currency) })
    : t('modules.real_estate.chart.purchase', { price: money(purchase.price, currency), date: fmtDayNumeric(purchase.date) })
  let captionY = H + 14
  const captions = (narrow ? [
    ...(sameCurrency ? [{ text: purchaseText, className: 're-chart__a' }] : []),
    ...(lastValued >= 0 ? [{ text: money(years[lastValued].value, currency), className: 're-chart__vl' }] : []),
    ...(firstValued >= 0 && firstValued !== lastValued && (!sameCurrency || years[firstValued].value !== purchase.price) && Y(years[firstValued].value) - 10 > TOP ? [{ text: money(years[firstValued].value, currency), className: 're-chart__vl' }] : []),
    ...(missingNow ? [{ text: t('modules.real_estate.chart.noValuation'), className: 're-chart__nowt' }] : []),
  ] : []).map(c => {
    const lines = wrapChartText(c.text, W - 16), row = { ...c, lines, y: captionY }
    captionY += lines.length * 16 + 8
    return row
  })

  return (
    <svg ref={svgRef} className="re-chart" viewBox={`0 0 ${W} ${captions.length ? captionY : H}`} role="img" aria-label={t('modules.real_estate.chart.label', { name })}>
      {grid.map(g => (
        <g key={g}>
          <line className="re-chart__grid" x1={L} x2={W - R} y1={Y(g)} y2={Y(g)} />
          <text className="re-chart__t" x={L - 8} y={Y(g) + 4} textAnchor="end">{tick(g)}</text>
        </g>
      ))}
      {missingNow && <rect className="re-chart__band" x={X(n - 1)} y={TOP} width={cw} height={BASE - TOP} rx={4} />}
      {sameCurrency && (
        <>
          <line className="re-chart__buy" x1={L} x2={W - R} y1={Y(purchase.price)} y2={Y(purchase.price)} />
          {!narrow && <text className="re-chart__a" x={L + 6} y={Y(purchase.price) + 15}>{purchaseText}</text>}
        </>
      )}
      <path className="re-chart__area" d={area} />
      <path className="re-chart__step" d={d} />
      {missingNow && (
        <>
          <path className="re-chart__now" d={`M${X(n - 1)} ${Y(now.value)} L${X(n)} ${Y(now.value)}`} />
          {!narrow && <text className="re-chart__nowt" x={X(n - 1) + cw / 2} y={Y(now.value) - 10} textAnchor="middle">{t('modules.real_estate.chart.noValuation')}</text>}
        </>
      )}
      {years.map((p, i) => (p.valued ? <circle key={p.year} className="re-chart__dot" cx={i ? X(i) : x0} cy={Y(p.value)} r={4.5} /> : null))}
      {!narrow && lastValued >= 0 && (
        <text className="re-chart__vl" {...valuePosition(lastValued ? X(lastValued) : x0, years[lastValued].value)} y={Y(years[lastValued].value) - 10}>{money(years[lastValued].value, currency)}</text>
      )}
      {!narrow && firstValued >= 0 && firstValued !== lastValued && (!sameCurrency || years[firstValued].value !== purchase.price) && Y(years[firstValued].value) - 10 > TOP && (
        <text className="re-chart__vl" {...valuePosition(X(firstValued), years[firstValued].value)} y={Y(years[firstValued].value) - 10}>{money(years[firstValued].value, currency)}</text>
      )}
      {changes.map((c, i) => {
        const cx = X(i) + cw / 2
        if (c === null) return i === n - 1 && missingNow ? <text key={i} className="re-chart__cl" x={cx} y={STRIP_TOP + STRIP_H - 2} textAnchor="middle">—</text> : null
        const h = Math.max(2, (Math.abs(c) / maxChange) * (STRIP_H - 16))
        return (
          <g key={i}>
            <title>{`${years[i].year}: ${short(c)}`}</title>
            <rect className="re-chart__cb" x={cx - Math.min(18, cw * 0.3)} y={STRIP_TOP + STRIP_H - h} width={Math.min(36, cw * 0.6)} height={h} rx={2} />
            {changeLabels.has(i) && <text className="re-chart__cl" x={cx} y={STRIP_TOP + STRIP_H - h - 4} textAnchor="middle">{short(c)}</text>}
          </g>
        )
      })}
      <text className="re-chart__t" x={L - 8} y={STRIP_TOP + STRIP_H - 2} textAnchor="end">{t('modules.real_estate.chart.perYear')}</text>
      {years.map((p, i) => (
        <text key={p.year} className={i === n - 1 ? 're-chart__t re-chart__t--now' : 're-chart__t'} x={X(i) + cw / 2} y={H - 4} textAnchor="middle">
          {sparse(i) ? '' : compact && i !== n - 1 ? `’${String(p.year).slice(2)}` : p.year}
        </text>
      ))}
      {captions.map((c, k) => <text key={k} className={c.className} x={8} y={c.y}>{c.lines.map((line, i) => <tspan key={i} x={8} dy={i ? 16 : 0}>{line}</tspan>)}</text>)}
    </svg>
  )
}
