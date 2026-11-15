export type SegmentedBarTone = 'primary' | 'member-1' | 'member-2' | 'member-3' | 'member-4' | 'ink'

interface SegmentedBarProps {
  /** Progress, 0–100; out-of-range values are clamped, a non-finite one is 0 */
  pct: number
  /** Name for the screen reader: the goal or the caption of the main number */
  label: string
  /** How many segments the track is cut into */
  segments?: number
  /** The fill: `--primary`, a member's hue or `--text-1` */
  tone?: SegmentedBarTone
  className?: string
}

/** A `--track` bar cut into segments with an accessible value: whole segments fill first, the remainder fills the next one partly. */
export function SegmentedBar({ pct, label, segments = 10, tone = 'primary', className }: SegmentedBarProps) {
  const clamped = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0
  const filled = (clamped / 100) * segments
  const classes = ['segbar', tone !== 'primary' && `segbar--${tone}`, className].filter(Boolean).join(' ')
  return (
    <div className={classes} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)}>
      {Array.from({ length: segments }, (_, k) => (
        <i key={k} className="segbar__seg"><b style={{ width: `${Math.round(Math.min(1, Math.max(0, filled - k)) * 100)}%` }} /></i>
      ))}
    </div>
  )
}
