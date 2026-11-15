import { fmtPct } from '../../lib/formatters'

interface RingProps {
  /** Share, 0–100; out-of-range values are clamped, a non-finite one is 0 */
  pct: number
  /** How many arcs the ring is cut into */
  segments?: number
  /** 104 — a card's figure, 44 — a row's */
  size?: 44 | 104
  /** Name for the screen reader */
  label: string
  /** The figure in the centre; `fmtPct(pct)` when not given */
  center?: string
  /** Indices of the filled arcs drawn in `--warning` */
  amberAt?: number[]
  /** Indices of the filled arcs drawn in `--error` */
  redAt?: number[]
}

/** The space between two arcs, in user units (px at 1:1). */
const GAP = 4

/**
 * A ring of `segments` arcs: the first `ceil(pct / 100 * segments)` are filled, the rest are the track;
 * the figure sits in the centre. One `role="img"` named `label: figure` (its children are not read aloud); a non-finite share draws empty.
 */
export function Ring({ pct, segments = 12, size = 104, label, center, amberAt = [], redAt = [] }: RingProps) {
  const clamped = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0
  const centreText = center ?? fmtPct(clamped)
  // a count-derived share (7/9 · 100) lands a hair above the whole number: the tolerance keeps the ceil at 7, not 8
  const filled = Math.min(segments, Math.max(0, Math.ceil((clamped / 100) * segments - 1e-9)))
  const stroke = size === 104 ? 9 : 6
  const half = size / 2
  const radius = half - stroke / 2
  const circumference = 2 * Math.PI * radius
  const slice = circumference / segments
  const arc = Math.max(0, slice - GAP)
  const fillClass = (k: number) => (redAt.includes(k) ? 'ring__fill ring__fill--red' : amberAt.includes(k) ? 'ring__fill ring__fill--amber' : 'ring__fill')
  const circle = (k: number, className: string) => (
    <circle
      key={`${className}-${k}`}
      className={className}
      cx={half}
      cy={half}
      r={radius}
      fill="none"
      strokeWidth={stroke}
      strokeDasharray={`${arc} ${circumference - arc}`}
      strokeDashoffset={-k * slice}
      transform={`rotate(-90 ${half} ${half})`}
    />
  )
  const tracks = Array.from({ length: segments }, (_, k) => circle(k, 'ring__track'))
  const fills = Array.from({ length: filled }, (_, k) => circle(k, fillClass(k)))
  return (
    <svg className={`ring ring--${size}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${centreText}`}>
      {tracks}
      {fills}
      <text className="ring__center" x={half} y={half} textAnchor="middle" dominantBaseline="central">{centreText}</text>
    </svg>
  )
}
