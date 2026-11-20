import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/** A message that the page's data failed to load. */
export function PageError({ children, onRetry, retrying = false, retryLabel, className = 'page-error' }: { className?: string; children?: ReactNode; onRetry?: () => void; retrying?: boolean; retryLabel?: string }) {
  const { t } = useTranslation()
  return <div className={className}><div role="alert">{children ?? t('common.loadError')}</div>{onRetry && <button type="button" className="btn btn--ghost" disabled={retrying} onClick={onRetry}>{retryLabel ?? t('common.pageRetry')}</button>}</div>
}
