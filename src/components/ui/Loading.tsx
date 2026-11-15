import { useTranslation } from 'react-i18next'

/** A "Loading…" placeholder in place of a page or screen; role="status" announces it to a screen reader. */
export function Loading({ className = 'page-loading' }: { className?: string }) {
  const { t } = useTranslation()
  return <div className={className} role="status">{t('common.loading')}</div>
}
