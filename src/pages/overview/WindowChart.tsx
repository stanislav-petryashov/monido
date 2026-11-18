import { niceTicks } from '../../lib/niceTicks'
import { signed } from '../../lib/pageHelpers'
import { monthOf, monthsBetween } from '../../domain/dates'
import type { HistoryPoint } from '../../domain/types'
import { fmtDate, fmtMonthShort, fmtMonthYear } from '../../lib/formatters'
import { COMPACT_LEFT, labelLane, MONTHLY_AXIS, RIGHT } from './chartFrame'
import '../../styles/wchart.css'
import { useChartFrame } from '../../components/charts/useChartFrame'
import { wrapChartText } from '../../components/charts/chartText'

/**
 * The container is measured in text-sized viewBox units: metadata stays readable as root text grows.
 * Compact frames omit the gridline labels; long captions wrap below the plot when they cannot fit.
 * Frame heights retain the line plot, monthly changes and month labels at their existing proportions.
 */
const FRAMES = {
  wide: { W: 700, H: 248 },
  compact: { W: 320, H: 224 },
  /** The Assets history across its whole card: about a pixel a unit at a ~1000px card */
  broad: { W: 1100, H: 260 },
}
const MIN_LEFT = 36
const TOP = 30
const BOTTOM = 26
/** The strip of monthly changes and the gap between it and the line plot (room for the largest change's label) */
const STRIP = 40
const STRIP_GAP = 18
const BAND_W = 28
/** The widest change column; the first one sticks out of the plot by half of it, into the label lane */
const COL_MAX = 18
const TAG_H = 22
/** The tag's width grows with its text (12 units high, wchart.css): about 7 units a character plus the padding */
const TAG_CHAR = 7
const TAG_PAD = 16
/** The gap between the dot and the tag */
const TAG_GAP = 10
/** The span caption's baseline and the box its 12-unit text takes around it */
const CAPTION_Y = TOP - 20
const CAPTION_TOP = CAPTION_Y - 11
const CAPTION_BOTTOM = CAPTION_Y + 3
/** `labelOnlyStandout`: the largest change is named at this many times the median absolute change */
const STANDOUT = 2

interface WindowChartProps {
  window: { points: HistoryPoint[]; index: number; ticks: number[]; changes: (number | null)[] }
  /** The gridline and change labels: the dashboard's compact amount, masked in privacy mode; `digits` — the most decimals of its unit */
  fmtCompact: (v: number, digits?: number) => string
  /** The selected point's amount as written over it, already formatted (and masked) by the caller */
  value: string
  /** The accessible name of the drawing: how many months up to which */
  label: string
  /** The strip's caption in the label lane ("per month"); not drawn in the compact frame, which has no lane */
  changeLabel?: string
  /** A phone: the narrow frame without the gridline labels */
  compact?: boolean
  /** A chart across a whole card (the Assets history), not a column: the broad frame; a phone still takes the compact one */
  broad?: boolean
  /** Which value of a point the line and the tag read */
  field?: 'netWorth' | 'assets'
  /** A period shaded from this point to the last, with its caption above the plot */
  highlight?: { from: number; label: string }
  /** Label the months at the foot (each January with its year), or the years in a long window, not the window's ends */
  calendar?: boolean
  /** The window's largest change named in the gap above the strip (instead of the label over its column): 'YYYY-MM' and the change */
  event?: (month: string, change: number) => string
  /**
   * A dashed line under the window's (the Accounts screen: the balance a year before each point), null where there is
   * none, captioned at its first point; the caller's `ticks` cover it too
   */
  ghost?: { values: (number | null)[]; label: string }
  /** Name the largest change (its column label or `event`) only when it stands out: at least twice the median absolute change */
  labelOnlyStandout?: boolean
  unavailableMonths?: readonly string[]
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * The decimals the gridline labels need to stay apart: a compact amount is in thousands, millions…, so a step of
 * 5 000 on a scale of millions needs three ('$1.135M', '$1.14M'); never fewer than the default two.
 */
function tickDigits(ticks: number[]): number {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 0
  const top = Math.max(...ticks.map(Math.abs))
  if (!step || !top) return 2
  const unit = 1000 ** Math.floor(Math.log10(top) / 3)
  return Math.max(2, Math.ceil(Math.log10(unit / step)))
}

/**
 * The net-worth window as a plain SVG: gridlines at the domain's ticks with compact labels, the past as a quiet
 * polyline, the last segment and the selected point in the primary colour on a tinted band, the value in a tag that
 * stays inside the drawing (below the point when there is no room above); under the line each month's change as a
 * column up or down from a zero line, the selected month's in the primary colour and the largest one labelled; the
 * window's first, middle and last month at the foot. The Assets page's history reads the assets instead (`field`),
 * shades its period (`highlight`, in place of the band), labels the calendar and names the largest change (`event`);
 * the Accounts screen adds the balance a year earlier as a dashed line (`ghost`).
 * Colours and text sizes come from the classes in wchart.css.
 */
export function WindowChart({ window: { points, index, ticks: sourceTicks, changes: sourceChanges }, fmtCompact, value, label, changeLabel = '', compact: phone = false, broad = false, field = 'netWorth', highlight, calendar = false, event, ghost, labelOnlyStandout = false, unavailableMonths }: WindowChartProps) {
  const { ref: svgRef, width } = useChartFrame(FRAMES[phone ? 'compact' : broad ? 'broad' : 'wide'].W)
  const compact = phone || width < 480
  // Keep presentation density independent of the currency's nominal unit.
  const unavailable = new Set(unavailableMonths)
  const isKnown = (i: number) => !!points[i] && !unavailable.has(monthOf(points[i].date))
  const values = points.filter((_, i) => isKnown(i)).map(p => p[field])
  const ticks = unavailableMonths && points.some((_, i) => !isKnown(i)) ? niceTicks(Math.min(...values), Math.max(...values)) : sourceTicks.length > 5 ? niceTicks(sourceTicks[0], sourceTicks[sourceTicks.length - 1]) : sourceTicks
  const changes = unavailableMonths ? sourceChanges.map((c, i) => isKnown(i) && isKnown(i - 1) && monthsBetween(monthOf(points[i - 1].date), monthOf(points[i].date)) === 1 ? c : null) : sourceChanges
  const W = width, { H } = FRAMES[compact ? 'compact' : broad ? 'broad' : 'wide']
  // the digits the units need, raised while two gridlines still read alike (zh-CN counts in 万 and 亿, not thousands)
  let digits = tickDigits(ticks)
  let tickLabels = ticks.map(tick => fmtCompact(tick, digits))
  while (new Set(tickLabels).size < tickLabels.length && digits < 6) {
    digits += 1
    tickLabels = ticks.map(tick => fmtCompact(tick, digits))
  }
  const LEFT = compact ? COMPACT_LEFT : Math.max(MIN_LEFT, labelLane([changeLabel, ...tickLabels]) + COL_MAX / 2)
  const low = ticks[0]
  const high = ticks[ticks.length - 1]
  const plotW = W - LEFT - RIGHT
  const stripBottom = H - BOTTOM
  const stripTop = stripBottom - STRIP
  const plotH = stripTop - STRIP_GAP - TOP
  const spanMonths = points.length > 1 ? monthsBetween(monthOf(points[0].date), monthOf(points[points.length - 1].date)) : 0
  const step = points.length < 2 ? plotW : plotW / (unavailableMonths ? spanMonths || 1 : points.length - 1)
  const x = (i: number) => (points.length < 2 ? LEFT + plotW / 2 : LEFT + (unavailableMonths ? monthsBetween(monthOf(points[0].date), monthOf(points[i].date)) : i) * step)
  const y = (v: number) => TOP + (1 - (v - low) / (high - low)) * plotH
  const at = (i: number) => `${round1(x(i))},${round1(y(points[i][field]))}`

  const past = points.slice(0, index + 1).map((_, i) => at(i)).join(' ')
  const runs = points.slice(0, index + 1).reduce<number[][]>((all, p, i) => {
    if (!isKnown(i)) { all.push([]); return all }
    if (i > 0 && monthsBetween(monthOf(points[i - 1].date), monthOf(p.date)) !== 1) all.push([])
    all[all.length - 1].push(i)
    return all
  }, [[]]).filter(run => run.length > 1)
  const now = index > 0 && (!unavailableMonths || (isKnown(index) && isKnown(index - 1) && monthsBetween(monthOf(points[index - 1].date), monthOf(points[index].date)) === 1)) ? `${at(index - 1)} ${at(index)}` : null
  const selected = !unavailableMonths || isKnown(index) ? points[index] : undefined
  const sx = selected ? x(index) : null
  const sy = selected ? y(selected[field]) : null

  const tagW = value.length * TAG_CHAR + TAG_PAD
  const tagX = sx === null ? 0 : Math.min(Math.max(0, sx - tagW / 2), W - tagW)
  const above = sy !== null && sy - TAG_GAP - TAG_H >= 0
  const tagAbove = sy === null ? 0 : above ? sy - TAG_GAP - TAG_H : sy + TAG_GAP

  // the strip: the zero line splits it by the largest rise and the largest fall, so a window of rises uses all of it
  const known = changes.filter((c): c is number => c !== null)
  const up = Math.max(0, ...known)
  const down = Math.max(0, ...known.map(c => -c))
  const zeroY = up + down > 0 ? stripTop + (STRIP * up) / (up + down) : stripBottom
  const colW = Math.min(COL_MAX, Math.max(4, step * 0.5))
  const col = (c: number) => ({ y: c >= 0 ? zeroY - (STRIP * c) / (up + down) : zeroY, h: (STRIP * Math.abs(c)) / (up + down) })
  const largest = known.length ? changes.reduce<number>((best, c, i) => (c !== null && Math.abs(c) > Math.abs(changes[best] ?? 0) ? i : best), changes.findIndex(c => c !== null)) : -1
  const sortedAbs = known.map(Math.abs).sort((a, b) => a - b)
  const standsOut = !labelOnlyStandout || (sortedAbs.length > 0 && sortedAbs[sortedAbs.length - 1] >= STANDOUT * sortedAbs[Math.floor(sortedAbs.length / 2)])
  const largestValue = largest >= 0 && standsOut ? changes[largest]! : 0
  const anchorAt = (i: number) => (points.length > 1 && i === 0 ? 'start' : points.length > 1 && i === points.length - 1 ? 'end' : 'middle')

  const eventText = event && largestValue !== 0 && points.length > 3 ? event(monthOf(points[largest].date), largestValue) : null
  const eventRight = largest >= 0 && x(largest) < W * 0.6

  // the span reaches half a column past the end points, never out of the frame
  const spanFrom = highlight && points[highlight.from] ? Math.max(LEFT - colW / 2, x(highlight.from) - colW) : null
  const span = spanFrom === null ? null : { x: spanFrom, w: Math.min(W - RIGHT + colW / 2, x(points.length - 1) + colW) - spanFrom }
  const spanWide = span !== null && span.w > 110
  // the caption sits above the plot, inside the span's left edge when the span is wide, else outside it; when that
  // box would meet the tag, the other side of the edge, and if neither is free the tag goes under the dot
  const caption = (inside: boolean) => {
    const w = (highlight?.label.length ?? 0) * TAG_CHAR
    const x0 = span === null ? 0 : inside ? span.x + 6 : span.x - 6 - w
    return { inside, x0, x1: x0 + w }
  }
  const meets = (c: { x0: number; x1: number }, y: number) =>
    sy !== null && c.x0 < tagX + tagW && c.x1 > tagX && y < CAPTION_BOTTOM && y + TAG_H > CAPTION_TOP
  const preferred = caption(spanWide)
  const other = caption(!spanWide)
  const captionAt = span === null || !meets(preferred, tagAbove) ? preferred
    : other.x0 >= 0 && other.x1 <= W && !meets(other, tagAbove) ? other : preferred
  const tagY = span !== null && sy !== null && meets(captionAt, tagAbove) ? sy + TAG_GAP : tagAbove

  // the ghost: one polyline per run of known values (a lone point draws nothing), the caption over the first drawn one
  const ghostRuns = (ghost?.values ?? []).reduce<number[][]>((runs, v, i) => {
    if (v === null || !points[i] || (unavailableMonths && !isKnown(i))) runs.push([])
    else {
      if (unavailableMonths && i > 0 && monthsBetween(monthOf(points[i - 1].date), monthOf(points[i].date)) !== 1) runs.push([])
      runs[runs.length - 1].push(i)
    }
    return runs
  }, [[]]).filter(run => run.length > 1)
  const ghostAt = (i: number) => `${round1(x(i))},${round1(y(ghost!.values[i]!))}`
  const ghostFirst = ghostRuns.length ? ghostRuns[0][0] : -1

  const monthly = points.length <= MONTHLY_AXIS
  // a phone fits every second month of a long window, the first (with its year) always
  const every = Math.max(compact && points.length > 7 ? 2 : 1, Math.ceil(56 / step))
  const yearEvery = Math.max(1, Math.ceil(32 / (step * 12)))
  const xLabels: { i: number; text: string }[] = calendar
    ? points.flatMap((p, i) => {
      const ym = monthOf(p.date)
      const january = ym.endsWith('-01')
      // the last month is always named, so a regular label closer to it than `every` gives way (they met: Aug. × Sept.)
      const last = points.length - 1
      if (monthly) return i === last || (i % every === 0 && last - i >= every) ? [{ i, text: i === 0 || january ? fmtDate(ym) : fmtMonthShort(ym) }] : []
      return january && (Number(ym.slice(0, 4)) - Number(points.at(-1)!.date.slice(0, 4))) % yearEvery === 0 ? [{ i, text: ym.slice(0, 4) }] : []
    })
    : [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])].filter(i => points[i]).map(i => ({ i, text: fmtMonthYear(monthOf(points[i].date)) }))

  const spanBelow = !!highlight && (captionAt.x0 < 8 || captionAt.x1 > W - 8)
  const eventBelow = !!eventText && (eventRight ? x(largest) + 6 + eventText.length * 7 > W - 8 : x(largest) - 6 - eventText.length * 7 < 8)
  const ghostBelow = ghostFirst >= 0 && x(ghostFirst) + 4 + ghost!.label.length * 7 > W - 8
  const valueBelow = sx !== null && tagW > W - 16
  let captionY = H + 14
  const captions = [
    ...(spanBelow ? [{ text: highlight.label, className: 'wchart__spanLabel' }] : []),
    ...(eventBelow ? [{ text: eventText, className: 'wchart__event' }] : []),
    ...(ghostBelow ? [{ text: ghost!.label, className: 'wchart__ghostLabel' }] : []),
    ...(valueBelow ? [{ text: value, className: 'wchart__tagText wchart__value-caption' }] : []),
  ].map(c => {
    const lines = wrapChartText(c.text, W - 16), row = { ...c, lines, y: captionY }
    captionY += lines.length * 16 + 8
    return row
  })
  return (
    <svg ref={svgRef} className={compact ? 'wchart wchart--compact' : 'wchart'} viewBox={`0 0 ${W} ${captions.length ? captionY : H}`} role="img" aria-label={label}>
      {ticks.map((tick, k) => (
        <g key={tick}>
          <line className="wchart__tick" x1={LEFT} x2={W - RIGHT} y1={round1(y(tick))} y2={round1(y(tick))} />
          <text className="wchart__tickLabel" x={round1(LEFT - 8 - colW / 2)} y={round1(y(tick))} textAnchor="end" dominantBaseline="middle">{tickLabels[k]}</text>
        </g>
      ))}
      {span && (
        <>
          <rect className="wchart__span" x={round1(span.x)} y={TOP - 14} width={round1(span.w)} height={stripBottom - TOP + 18} rx={6} />
          {!spanBelow && <text className="wchart__spanLabel" x={round1(captionAt.inside ? span.x + 6 : span.x - 6)} y={CAPTION_Y} textAnchor={captionAt.inside ? 'start' : 'end'}>{highlight!.label}</text>}
        </>
      )}
      {sx !== null && !span && <rect className="wchart__band" x={round1(sx - BAND_W / 2)} y={TOP - 8} width={BAND_W} height={stripBottom - TOP + 12} rx={8} />}
      {ghostRuns.map(run => <polyline key={run[0]} className="wchart__ghost" points={run.map(ghostAt).join(' ')} />)}
      {ghostFirst >= 0 && (
        !ghostBelow && <text className="wchart__ghostLabel" x={round1(x(ghostFirst) + 4)} y={round1(y(ghost!.values[ghostFirst]!) - 8)}>{ghost!.label}</text>
      )}
      {unavailableMonths ? runs.map(run => <polyline key={run[0]} className="wchart__past" points={run.map(at).join(' ')} />) : points.length > 1 && <polyline className="wchart__past" points={past} />}
      {now && <polyline className="wchart__now" points={now} />}
      {known.length > 0 && (
        <g className="wchart__changes">
          <line className="wchart__zero" x1={LEFT} x2={W - RIGHT} y1={round1(zeroY)} y2={round1(zeroY)} />
          {!compact && changeLabel && <text className="wchart__lane" x={round1(LEFT - 8 - colW / 2)} y={round1(zeroY)} textAnchor="end" dominantBaseline="middle">{changeLabel}</text>}
          {changes.map((c, i) => {
            if (c === null || c === 0) return null
            const { y: cy, h } = col(c)
            return <rect key={i} className={i === index ? 'wchart__chg wchart__chg--now' : 'wchart__chg'} x={round1(x(i) - colW / 2)} y={round1(cy)} width={round1(colW)} height={round1(Math.max(1, h))} rx={2} />
          })}
          {eventText && !eventBelow && (
            <text className="wchart__event" x={round1(eventRight ? x(largest) + 6 : x(largest) - 6)} y={round1(stripTop - 5)} textAnchor={eventRight ? 'start' : 'end'}>{eventText}</text>
          )}
          {largestValue !== 0 && !eventText && (
            <text className="wchart__chgLabel" x={round1(x(largest))} y={round1(largestValue > 0 ? col(largestValue).y - 5 : zeroY - 5)} textAnchor={anchorAt(largest)}>
              {signed(largestValue, v => fmtCompact(v))}
            </text>
          )}
        </g>
      )}
      {sx !== null && sy !== null && (
        <>
          <circle className="wchart__dot" cx={round1(sx)} cy={round1(sy)} r={5} />
          {!valueBelow && <><rect className="wchart__tag" x={round1(tagX)} y={round1(tagY)} width={tagW} height={TAG_H} rx={6} />
          <text className="wchart__tagText" x={round1(tagX + tagW / 2)} y={round1(tagY + TAG_H / 2)} textAnchor="middle" dominantBaseline="middle">{value}</text></>}
        </>
      )}
      {xLabels.map(({ i, text }) => (
        <text key={i} className="wchart__x" x={round1(x(i))} y={H - 6} textAnchor={anchorAt(i)}>{text}</text>
      ))}
      {captions.map(c => <text key={c.className} className={c.className} x={8} y={c.y}>{c.lines.map((line, i) => <tspan key={i} x={8} dy={i ? 16 : 0}>{line}</tspan>)}</text>)}
    </svg>
  )
}
