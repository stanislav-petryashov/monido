import { useId, useRef } from 'react'
import { IconArrowBackUp, IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { ConfirmOptions } from '../../lib/notifyState'
import { Avatar } from './Avatar'
import { Dialog } from './Dialog'
import { useModalDialog } from './useModalDialog'

const TONE = {
  danger: { icon: IconTrash, color: 'error', button: 'btn btn--danger-solid' },
  warning: { icon: IconArrowBackUp, color: 'warning', button: 'btn btn--primary' },
} as const

/** A centred confirmation window. The answer comes with the close event: returnValue 'confirm' is yes, anything else is no. */
export function ConfirmDialog({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (yes: boolean) => void }) {
  const { t } = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)
  // the focus starts on Cancel: an accidental Enter deletes nothing
  const { dialogRef, close } = useModalDialog(cancelRef)
  const titleId = useId()
  const textId = useId()
  const tone = TONE[options.tone]

  return (
    <Dialog
      dialogRef={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={options.text ? textId : undefined}
      onClose={e => onAnswer(e.currentTarget.returnValue === 'confirm')}
      onDismiss={() => close('cancel')}
    >
      <div className="confirm-dialog__panel">
        <Avatar icon={tone.icon} color={tone.color} size="lg" />
        <h2 id={titleId} className="confirm-dialog__title">{options.title}</h2>
        {options.text && <p id={textId} className="confirm-dialog__text">{options.text}</p>}
        <div className="confirm-dialog__actions">
          <button ref={cancelRef} type="button" className="btn btn--ghost" onClick={() => close('cancel')}>{t('common.cancel')}</button>
          <button type="button" className={tone.button} onClick={e => { if (e.detail < 2) close('confirm') }}>{options.confirmLabel}</button>
        </div>
      </div>
    </Dialog>
  )
}
