import { useTranslation } from 'react-i18next'

/**
 * A step's read that failed, inside the step instead of a toast that fades: what failed and a button that reads it again.
 * `text` replaces the default sentence where the step can say what the person may do (the modules step lets Next through).
 */
export function SetupLoadError({ onRetry, text }: { onRetry: () => void; text?: string }) {
  const { t } = useTranslation()
  return (
    <div className="setup-error" role="alert">
      <span className="setup-error__text">{text ?? t('data.setup.loadFailed')}</span>
      <button type="button" className="btn btn--ghost" onClick={onRetry}>{t('data.setup.retry')}</button>
    </div>
  )
}
