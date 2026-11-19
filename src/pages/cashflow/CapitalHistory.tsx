import { useId, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangePoint, Story, changeHistory } from '../../domain/capitalStory'
import { monthEnd } from '../../domain/dates'
import { round2 } from '../../domain/fx'
import { fitAxisLabels } from '../../components/charts/chartText'
import { useChartFrame } from '../../components/charts/useChartFrame'
import { fmtDate, fmtDayNumeric, fmtMonth, fmtMonthShort } from '../../lib/formatters'
import { niceTicks } from '../../lib/niceTicks'
import { signed } from '../../lib/pageHelpers'
import { COMPACT_LEFT, labelLane } from '../overview/chartFrame'

interface CapitalHistoryProps {
  history: ReturnType<typeof changeHistory>
  /** The page's period: its months are banded, its last one is the selected point */
  period: string[]
  /** Sets the page's period to a month: the bridge above shows it */
  onPick: (month: string) => void
  /** The dashboard's money and compact money, both masked in privacy mode */
  fmt: (v: number) => string
  fmtCompact: (v: number) => string
  /** A phone: 342 wide, a key above the chart and the month's figures under it in place of a tooltip */
  compact?: boolean
}

const T = 34
const round1 = (n: number) => Math.round(n * 10) / 10
const drawn = (p: ChangePoint | undefined): p is ChangePoint & { netWorth: number } => !!p && p.netWorth !== null
const both = (p: ChangePoint | undefined): p is ChangePoint & { netWorth: number; added: number } => drawn(p) && p.added !== null

/**
 * What the family added against what net worth did, since the window's start (plain SVG, classes in cashflow.css): net
 * worth a solid ink line, "you added" a dashed one, the difference between them shaded light (markets, rates and the
 * unexplained), both from a zero axis. Direct labels at the line ends on a wide screen, a key with the figures above the
 * chart on a phone. The period is a primary band, its last month the primary point. Each month is a button named by its
 * figures that sets the page's period; focus or hover shows its figures split as in the bridge (on a phone, under the chart).
 */
export function CapitalHistory({ history, period, onPick, fmt, fmtCompact, compact = false }: CapitalHistoryProps) {
  const { t } = useTranslation()
  const uid = useId().replace(/:/g, '')
  const { ref, width } = useChartFrame(compact ? 342 : 1000)
  const points = history.points
  const n = points.length
  const selected = period[period.length - 1]
  const [shown, setShown] = useState<string | null>(null)
  if (n < 2) return null

  const W = width
  const values = [0, ...points.flatMap(p => [p.netWorth, p.added]).filter((v): v is number => v !== null)]
  const ticks = niceTicks(Math.min(...values), Math.max(...values))
  const tickLabels = ticks.map(v => (v > 0 ? `+${fmtCompact(v)}` : fmtCompact(v)))
  const L = compact ? COMPACT_LEFT : labelLane(tickLabels)
  const R = compact ? 12 : 300
  const B = compact ? 210 : 300
  const H = B + 30
  const X = (i: number) => L + ((W - L - R) * i) / (n - 1)
  const lo = ticks[0], hi = ticks[ticks.length - 1]
  const Y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (B - T)

  const path = (pick: (p: ChangePoint) => number | null) => points.map((p, i) => {
    const v = pick(p), prev = i > 0 ? pick(points[i - 1]) : null
    return v === null ? '' : `${prev === null ? 'M' : 'L'}${round1(X(i))} ${round1(Y(v))}`
  }).join(' ')
  const areas = points.slice(0, -1).flatMap((a, i) => {
    const b = points[i + 1]
    return both(a) && both(b) ? [`M${round1(X(i))} ${round1(Y(a.netWorth))}L${round1(X(i + 1))} ${round1(Y(b.netWorth))}L${round1(X(i + 1))} ${round1(Y(b.added))}L${round1(X(i))} ${round1(Y(a.added))}Z`] : []
  })

  const inPeriod = points.map(p => period.includes(p.month))
  const i0 = inPeriod.indexOf(true), i1 = inPeriod.lastIndexOf(true)
  const k = points.findIndex(p => p.month === selected)
  const last = [...points].reverse().find(both) ?? [...points].reverse().find(drawn)
  const lastIndex = last ? points.indexOf(last) : -1
  const gapAt = history.largestGap ? points.findIndex(p => p.month === history.largestGap!.month) : -1
  const step = (W - L - R) / Math.max(1, n - 1)

  const money = (v: number | null) => (v === null ? '—' : signed(v, fmt))
  // the added line starts on the net-worth line: what the family added is measured from where it starts
  const anchor = points.find(both)?.added ?? 0
  const addedSince = (p: ChangePoint) => (p.added === null ? null : round2(p.added - anchor))
  const difference = (p: ChangePoint) => (p.netWorth !== null && p.added !== null ? round2(p.netWorth - p.added) : null)
  const columnName = (p: ChangePoint) => p.netWorth === null
    ? t('capitalChange.history.columnGap', { month: fmtMonth(p.month) })
    : t('capitalChange.history.column', { month: fmtMonth(p.month), netWorth: money(p.netWorth), added: money(addedSince(p)), difference: money(difference(p)) })
  const onKey = (month: string) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(month) } }
  const start = fmtDayNumeric(monthEnd(points[0].month))
  const story = (s: Story) => t(s.key, Object.fromEntries(Object.entries(s.params).map(([key, v]) => [key, key === 'until' ? fmtMonth(String(v)) : v])))

  // the end labels, each at its line's height, pushed apart so they never overlap
  const ends = last && both(last) ? [
    { key: 'added', y: Y(last.added), text: t('capitalChange.history.addedEnd', { amount: money(addedSince(last)) }), cls: 'ch__end' },
    { key: 'net', y: Y(last.netWorth), text: t('capitalChange.history.netEnd', { amount: signed(last.netWorth, fmt) }), cls: 'ch__end' },
    { key: 'diff', y: (Y(last.added) + Y(last.netWorth)) / 2, text: t('capitalChange.history.differenceEnd', { amount: signed(round2(last.netWorth - last.added), fmt) }), cls: 'ch__end ch__end--muted' },
  ].sort((a, b) => a.y - b.y) : []
  for (let j = 1; j < ends.length; j++) ends[j].y = Math.max(ends[j].y, ends[j - 1].y + 18)

  const details = (month: string) => {
    const i = points.findIndex(p => p.month === month)
    const p = points[i]
    if (!p || i === 0) return null
    const monthName = t(`dates.month.${Number(month.slice(5, 7))}`)
    return <>
      <div className="ch-tip__head"><b>{fmtMonth(month)}</b><span>{t('capitalChange.history.since', { date: start })}</span></div>
      {p.netWorth === null ? <p>{t('capitalChange.history.columnGap', { month: fmtMonth(month) })}</p> : <dl>
        {p.added !== null && <><dt>{t('capitalChange.history.added')}</dt><dd className="num">{money(addedSince(p))}</dd></>}
        {p.added !== null && <><dt>{t('capitalChange.groups.markets')}</dt><dd className="num">{money(p.markets)}</dd></>}
        {p.added !== null && <><dt>{t('capitalChange.rows.unexplained')}</dt><dd className="num">{money(p.unexplained)}</dd></>}
        <dt className="ch-tip__sum">{t('capitalChange.history.grew')}</dt><dd className="num ch-tip__sum">{money(p.netWorth)}</dd>
        <dt>{t('capitalChange.history.alone', { month: monthName })}</dt><dd className="num">{money(p.change)}</dd>
      </dl>}
    </>
  }
  const focusMonth = shown ?? (k > 0 ? selected : points[n - 1].month)
  const focusIndex = points.findIndex(p => p.month === focusMonth)
  const tipLeft = focusIndex >= 0 ? Math.min(Math.max(X(focusIndex) / W, 0.12), 0.7) : 0

  return (
    <div className="ch-wrap">
      <p className="ch-takeaway">{story(history.takeaway)}</p>
      {compact && last && both(last) && <ul className="ch-key">
        <li><i className="ch-key__line ch-key__line--net" />{t('capitalChange.history.netWorth')}<b className="num">{signed(last.netWorth, fmt)}</b></li>
        <li><i className="ch-key__line ch-key__line--added" />{t('capitalChange.history.added')}<b className="num">{money(addedSince(last))}</b></li>
        <li><i className="ch-key__area" />{t('capitalChange.history.difference')}<b className="num">{signed(round2(last.netWorth - last.added), fmt)}</b></li>
      </ul>}
      <div className="ch-frame">
        <svg ref={ref} className={compact ? 'ch ch--compact' : 'ch'} viewBox={`0 0 ${round1(W)} ${H}`} role="group"
          aria-label={t('capitalChange.history.label', { from: fmtMonth(points[1].month), to: fmtMonth(points[n - 1].month) })} aria-describedby={`${uid}-table`}>
          {i0 >= 0 && <rect className="ch__period" x={round1(X(i0) - step / 2)} y={T - 20} width={round1(step * (i1 - i0 + 1))} height={B - T + 40} rx={6} />}
          {ticks.map((v, j) => (
            <g key={v}>
              <line className={v === 0 ? 'ch__zero' : 'ch__grid'} x1={L} x2={round1(W - R)} y1={round1(Y(v))} y2={round1(Y(v))} />
              {!compact && <text className="ch__tick" x={L - 8} y={round1(Y(v))} textAnchor="end" dominantBaseline="middle">{tickLabels[j]}</text>}
            </g>
          ))}
          {areas.map((d, j) => <path key={j} className="ch__gap" d={d} />)}
          {gapAt > 0 && both(points[gapAt]) && <>
            <line className="ch__mark" x1={round1(X(gapAt))} x2={round1(X(gapAt))} y1={round1(Y(points[gapAt].netWorth))} y2={round1(Y(points[gapAt].added))} />
            {!compact && <text className="ch__note" x={round1(X(gapAt))} y={round1(Math.min(Y(points[gapAt].netWorth), Y(points[gapAt].added)) - 10)} textAnchor="middle">
              {t('capitalChange.history.largest', { amount: signed(history.largestGap!.amount, fmt), month: fmtMonth(history.largestGap!.month) })}</text>}
          </>}
          <path className="ch__line ch__line--added" d={path(p => p.added)} />
          <path className="ch__line ch__line--net" d={path(p => p.netWorth)} />
          {k > 0 && drawn(points[k]) && <circle className="ch__dot" cx={round1(X(k))} cy={round1(Y(points[k].netWorth))} r={5} />}
          {!compact && lastIndex > 0 && ends.map(e => <text key={e.key} className={e.cls} x={round1(X(lastIndex) + 14)} y={round1(e.y)} dominantBaseline="middle">{e.text}</text>)}
          {fitAxisLabels(points.flatMap((p, i) => (i % (compact ? 3 : 1) === 0 || i === n - 1
            ? [{ month: p.month, x: round1(X(i)), anchor: (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'), text: i === 0 || p.month.endsWith('-01') ? fmtDate(p.month) : fmtMonthShort(p.month) }]
            : []))).map(l => <text key={l.month} className={l.month === selected ? 'ch__x ch__x--now' : 'ch__x'} x={l.x} y={H - 6} textAnchor={l.anchor}>{l.text}</text>)}
          {points.slice(1).map((p, j) => (
            <rect key={`hit-${p.month}`} className="ch__hit" role="button" tabIndex={0} aria-label={columnName(p)} aria-pressed={p.month === selected}
              x={round1(X(j + 1) - step / 2)} y={0} width={round1(step)} height={H} onClick={() => onPick(p.month)} onKeyDown={onKey(p.month)}
              onMouseEnter={() => setShown(p.month)} onMouseLeave={() => setShown(null)} onFocus={() => setShown(p.month)} onBlur={() => setShown(null)} />
          ))}
        </svg>
        {!compact && shown && <div className="ch-tip" style={{ left: `${tipLeft * 100}%` }} aria-hidden="true">{details(shown)}</div>}
      </div>
      {compact && focusIndex > 0 && <div className="ch-month" aria-live="polite">
        <div className="ch-month__nav">
          <button type="button" className="btn btn--quiet" aria-label={t('capitalChange.history.previous')} disabled={focusIndex <= 1} onClick={() => setShown(points[focusIndex - 1].month)}>‹</button>
          <button type="button" className="btn btn--quiet" aria-label={t('capitalChange.history.next')} disabled={focusIndex >= n - 1} onClick={() => setShown(points[focusIndex + 1].month)}>›</button>
        </div>
        {details(focusMonth)}
        {focusMonth !== selected && <button type="button" className="btn btn--quiet link-accent" onClick={() => onPick(focusMonth)}>{t('capitalChange.history.show', { month: fmtMonth(focusMonth) })}</button>}
      </div>}
      <table className="sr-only" id={`${uid}-table`}>
        <caption>{t('capitalChange.history.since', { date: start })}</caption>
        <thead><tr><th>{t('capitalChange.history.month')}</th><th>{t('capitalChange.history.netWorth')}</th><th>{t('capitalChange.history.added')}</th><th>{t('capitalChange.history.difference')}</th></tr></thead>
        <tbody>{points.slice(1).map(p => <tr key={p.month}><td>{fmtMonth(p.month)}</td><td>{money(p.netWorth)}</td><td>{money(addedSince(p))}</td><td>{money(difference(p))}</td></tr>)}</tbody>
      </table>
    </div>
  )
}
