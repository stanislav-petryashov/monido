import { useTranslation } from 'react-i18next'

interface SkeletonProps {
  width?: number | string
  height?: number | string
  radius?: number | string
  className?: string
}

export function Skeleton({ width = '100%', height = 16, radius, className }: SkeletonProps) {
  return (
    <div
      className={className ? `skeleton ${className}` : 'skeleton'}
      aria-hidden="true"
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        ...(radius !== undefined ? { borderRadius: typeof radius === 'number' ? `${radius}px` : radius } : {}),
      }}
    />
  )
}

function SkeletonCard() {
  return (
    <div className="card skeleton-card">
      <Skeleton width={110} height={13} />
      <Skeleton className="skeleton-card__value" width={160} height={34} radius={8} />
      <Skeleton width={90} height={12} />
    </div>
  )
}

export function PageSkeleton() {
  const { t } = useTranslation()
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{t('common.loading')}</span>
      <div className="skeleton-grid">
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
      <div className="skeleton-grid skeleton-grid--even">
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    </div>
  )
}
