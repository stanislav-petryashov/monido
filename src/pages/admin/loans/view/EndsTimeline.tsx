import { textWidth } from '../../../../components/charts/chartText'
import { useTranslation } from 'react-i18next'
import { fmtMonthYear } from '../../../../lib/formatters'
import { yearOf } from './money'
import { useChartFrame } from '../../../../components/charts/useChartFrame'

interface EndsTimelineProps {
  /** Each open loan from its issue to its last payment, 'YYYY-MM-DD', with its `.ln-tone-*` */
  loans: { name: string; from: string; to: string; tone: string }[]
  /** 'YYYY-MM-DD' */
  today: string
}

const ROW = 26
/** the room right of the latest end for its month label: at least 64, more for a longer one (Spanish "ene de 2051") */
const TIP_MIN = 64

/**
 * «When they end»: a bar per loan from issue to the last payment in its tone, the end month at its tip, today as a
 * violet line, the years under it (the first, then each decade). Viewbox units, as the other SVG charts of the records.
 */
export function EndsTimeline({ loans, today }: EndsTimelineProps) {
  const { ref: svgRef, width } = useChartFrame(300)
  const W = width
  const { t } = useTranslation()
  if (loans.length === 0) return null
  const y0 = Math.floor(Math.min(...loans.map(l => yearOf(l.from))))
  const y1 = Math.ceil(Math.max(...loans.map(l => yearOf(l.to))))
  const tip = Math.max(TIP_MIN, ...loans.map(l => 6 + textWidth(fmtMonthYear(l.to.slice(0, 7))) + 4))
  const X = (y: number) => ((y - y0) / (y1 - y0 || 1)) * (W - tip)
  const H = ROW * loans.length + 22
  const ticks = [y0, ...Array.from({ length: y1 - y0 }, (_, i) => y0 + i + 1).filter(y => y % 10 === 0 && y - y0 >= 5)]
  return (
    <svg ref={svgRef} className="ln-ends__chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('data.loans.listing.endsLabel')}>
      {loans.map((l, i) => {
        const x0 = X(yearOf(l.from)), x1 = X(yearOf(l.to)), y = i * ROW + 6
        return (
          <g key={l.name}>
            <rect className={`ln-ends__bar ${l.tone}`} x={x0} y={y} width={Math.max(3, x1 - x0)} height={10} rx={3}><title>{l.name}</title></rect>
            <text className="ln-chart__vl" x={x1 + 6} y={y + 9}>{fmtMonthYear(l.to.slice(0, 7))}</text>
          </g>
        )
      })}
      {ticks.map(y => <text key={y} className="ln-chart__t" x={X(y)} y={H - 2} textAnchor={y === y0 ? 'start' : 'middle'}>{y}</text>)}
      <line className="ln-chart__today" x1={X(yearOf(today))} x2={X(yearOf(today))} y1={0} y2={ROW * loans.length} />
    </svg>
  )
}
