import { useTranslation } from 'react-i18next'
import { PageSkeleton, Skeleton } from './Skeleton'

/**
 * The loading state: grey placeholders where the content will come, the words only for a screen reader (role="status").
 * No className: a whole page, the page skeleton. A className: a section's own box, three lines in it.
 * quiet: the app's first moments before the shell (sign-in check, settings), where any shape would only flash.
 */
export function Loading({ className, quiet = false }: { className?: string; quiet?: boolean }) {
  const { t } = useTranslation()
  if (quiet) return <div className="sr-only" role="status">{t('common.loading')}</div>
  if (!className) return <PageSkeleton />
  return (
    <div className={className} role="status">
      <span className="sr-only">{t('common.loading')}</span>
      <div className="skeleton-lines" aria-hidden="true">
        <Skeleton width="64%" height={14} /><Skeleton width="48%" height={14} /><Skeleton width="32%" height={14} />
      </div>
    </div>
  )
}
