import '../../styles/progress-track.css'

interface ProgressTrackProps {
  pct: number
  label: string
  valueText?: string
  size?: 'compact' | 'tall'
  className?: string
}

/** A continuous progress bar; non-finite values render an empty, unknown track. */
export function ProgressTrack({ pct, label, valueText, size = 'compact', className = '' }: ProgressTrackProps) {
  const value = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : undefined
  return (
    <span className={`progress-track progress-track--${size} ${className}`} role="progressbar" aria-label={label}
      aria-valuetext={valueText} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <i style={{ width: `${value ?? 0}%` }} />
    </span>
  )
}
