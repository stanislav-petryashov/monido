import { PageError } from '../../components/PageError'
import { useTranslation } from 'react-i18next'

/**
 * A step's read that failed, inside the step instead of a toast that fades: what failed and a button that reads it again.
 * `text` replaces the default sentence where the step can say what the person may do (the modules step lets Next through).
 */
export function SetupLoadError({ onRetry, text }: { onRetry: () => void; text?: string }) {
  const { t } = useTranslation()
  return <PageError className="setup-error" onRetry={onRetry} retryLabel={t('data.setup.retry')}>
    {text ?? t('data.setup.loadFailed')}
  </PageError>
}
