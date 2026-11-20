import { IconAlertTriangle } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { Warning } from '../domain/types'
import { warningText } from '../lib/snapshotSelectors'
import { DisclosureChevron } from './ui/DisclosureChevron'

/** A collapsible list of the snapshot's data warnings; renders nothing when empty. */
export function WarningsBanner({ warnings }: { warnings: Warning[] }) {
  const { t } = useTranslation()
  if (!warnings.length) return null
  return (
    // a live region on <details> itself is an invalid role for it (axe aria-allowed-role), so a wrapper carries it
    <div role="status">
      <details className="alert alert--warning">
        <summary className="alert__summary">
          <span className="alert__icon" aria-hidden="true"><IconAlertTriangle size={16} stroke={2} /></span>
          {t('common.dataWarnings', { value: warnings.length })}
          <DisclosureChevron size={16} />
        </summary>
        <ul className="alert__list">
          {warnings.map((w, i) => <li key={`${w.code}-${i}`}>{warningText(w)}</li>)}
        </ul>
      </details>
    </div>
  )
}
