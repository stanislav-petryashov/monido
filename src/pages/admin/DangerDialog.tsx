import { useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { TablerIcon } from '@tabler/icons-react'
import { Avatar } from '../../components/ui/Avatar'
import { Dialog } from '../../components/ui/Dialog'
import { useModalDialog } from '../../components/ui/useModalDialog'
import { Field } from './ui/Field'

export interface DangerDialogProps {
  icon: TablerIcon
  title: string
  text: ReactNode
  confirmLabel: string
  /** the typed `data.danger.word` gates the action; otherwise the action is enabled at once */
  requireWord?: boolean
  /** "Download database copy" first; the handler is the caller's (its own toast and busy state) */
  onBackup?: () => void
  /** A write or a download is running: Cancel, Escape and the backdrop wait for it */
  busy: boolean
  onAnswer: (ok: boolean) => void
  /** extra fields above the word */
  children?: ReactNode
  /** the submit is refused while false (a client-side rule of the children) */
  canSubmit?: boolean
}

/**
 * The shared question before a destructive action: an icon, the text, an optional database copy offer, the children's
 * fields and, with `requireWord`, the locale's confirmation word to type. The action enables only when the word (if
 * required) matches, `canSubmit` is not false and nothing is running; while something runs the dialog cannot be cancelled
 * either. The focus starts in the word field, else on the first input of the children, else on the action.
 */
export function DangerDialog({ icon, title, text, confirmLabel, requireWord, onBackup, busy, onAnswer, children, canSubmit }: DangerDialogProps) {
  const { t } = useTranslation()
  const wordRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLFormElement>(null)
  // the mount effect reads `current` once the form is in the DOM: the word, else the children's first input, else the action
  const [focusRef] = useState<RefObject<HTMLElement | null>>(() => ({
    get current() { return wordRef.current ?? panelRef.current?.querySelector<HTMLElement>('input, select, textarea') ?? submitRef.current },
  }))
  const { dialogRef, close } = useModalDialog(focusRef)
  const [typed, setTyped] = useState('')
  const titleId = useId()
  const textId = useId()
  const word = t('data.danger.word')
  const enabled = (!requireWord || typed === word) && canSubmit !== false && !busy

  return (
    <Dialog
      dialogRef={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={textId}
      onClose={e => onAnswer(e.currentTarget.returnValue === 'confirm')}
      onCancel={e => { if (busy) e.preventDefault() }}
      onDismiss={() => { if (!busy) close('cancel') }}
    >
      <form ref={panelRef} className="confirm-dialog__panel" onSubmit={e => { e.preventDefault(); if (enabled) close('confirm') }}>
        <Avatar icon={icon} color="error" size="lg" />
        <h2 id={titleId} className="confirm-dialog__title">{title}</h2>
        <p id={textId} className="confirm-dialog__text">{text}</p>
        {onBackup && <button type="button" className="btn btn--ghost" disabled={busy} onClick={onBackup}>{t('data.params.backupDownload')}</button>}
        {children}
        {requireWord && (
          <Field label={t('data.danger.wordLabel')}>
            <input ref={wordRef} className="admin-input" value={typed} onChange={e => setTyped(e.target.value)}
              autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          </Field>
        )}
        <div className="confirm-dialog__actions">
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => close('cancel')}>{t('common.cancel')}</button>
          <button ref={submitRef} type="submit" className="btn btn--danger-solid" disabled={!enabled}>{confirmLabel}</button>
        </div>
      </form>
    </Dialog>
  )
}
