import type { ReactNode } from 'react'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { Warning } from '../../domain/types'
import { warningText } from '../../lib/snapshotSelectors'
import { useDisclosure } from '../ui/usePopover'

/** Data warnings and other notices (the update) behind an icon with a counter; renders nothing without either. */
export function WarningsMenu({ warnings, notices = [] }: { warnings: Warning[]; notices?: { key: string; content: ReactNode }[] }) {
  const { t } = useTranslation()
  const { open, rootRef, triggerRef, panelId, triggerProps } = useDisclosure()

  const count = warnings.length + notices.length
  if (!count) return null
  return (
    <div className="warnings" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn warnings-btn"
        // with a notice (the update) not every item is about the data: a neutral name
        aria-label={t(notices.length ? 'common.notices' : 'common.dataWarnings', { value: count })}
        {...triggerProps}
      >
        <IconAlertTriangle size={20} stroke={1.75} aria-hidden="true" />
        <span className="warnings-btn__count" aria-hidden="true">{count}</span>
      </button>
      {open && (
        <ul id={panelId} className="warnings-list">
          {notices.map(n => <li key={n.key}>{n.content}</li>)}
          {warnings.map((w, i) => <li key={`${w.code}-${i}`}>{warningText(w)}</li>)}
        </ul>
      )}
    </div>
  )
}
