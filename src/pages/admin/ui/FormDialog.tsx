import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../../components/ui/Dialog'
import { useModalDialog } from '../../../components/ui/useModalDialog'
import { useSingleFlight } from '../useSingleFlight'

interface FormDialogProps {
  title: string
  /** A line under the title: where a value comes from, what the form is for */
  description?: ReactNode
  submitLabel: string
  /** Saves; true closes the window, false keeps it open with what was typed (the failure is already told to the person) */
  onSubmit: () => Promise<boolean> | boolean
  /** Cancel, Escape and a click on the backdrop */
  onCancel: () => void
  /** Resolve true only after the owning form may be discarded. */
  beforeCancel?: () => Promise<boolean>
  /** The owning save is pending: disable fields and actions together. */
  busy?: boolean
  submitDisabled?: boolean
  children: ReactNode
}

/**
 * A modal form: the title, the fields (the caller's `.form-stack` content) and "Cancel" before the submit button.
 * A <form>, so Enter submits. The first field gets the focus. It closes only when onSubmit says it saved.
 */
export function FormDialog({ title, description, submitLabel, onSubmit, onCancel, beforeCancel, busy, submitDisabled, children }: FormDialogProps) {
  const { t } = useTranslation()
  const bodyRef = useRef<HTMLFieldSetElement>(null)
  const { dialogRef, close } = useModalDialog(bodyRef)
  /** `isSaving()` is the synchronous twin of `saving`: a second Enter in the same tick must not start a second save */
  const [runSave, saving, isSaving] = useSingleFlight()
  const titleId = useId()
  const textId = useId()
  const cancelPending = useRef(false)
  const cancelApproved = useRef(false)

  function cancel() {
    if (isSaving() || busy || cancelPending.current) return
    if (!beforeCancel) { close('cancel'); return }
    cancelPending.current = true
    void beforeCancel().then(allowed => {
      if (allowed && !isSaving() && !busy && dialogRef.current?.isConnected) {
        cancelApproved.current = true
        close('cancel')
      }
    }).finally(() => { cancelPending.current = false })
  }

  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea')?.focus()
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || submitDisabled) return
    await runSave(async () => { if (await onSubmit()) close('saved') })
  }

  return (
    <Dialog
      dialogRef={dialogRef}
      className="form-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? textId : undefined}
      // while a save is pending the window stays: closing it would let the write land after "Cancel"
      onCancel={e => {
        if (isSaving() || busy || beforeCancel) e.preventDefault()
        if (beforeCancel) cancel()
      }}
      // a second Escape is not cancelable (the browser refuses to be stopped twice without a click between) and closes
      // the window anyway: while saving it is opened again, the form still in it, instead of being taken for a cancel
      onClose={e => {
        const dialog = e.currentTarget
        if (dialog.returnValue === 'saved') return
        if (isSaving() || busy) { dialog.showModal(); return }
        if (beforeCancel && !cancelApproved.current) { dialog.showModal(); cancel(); return }
        onCancel()
      }}
      onDismiss={cancel}
    >
      <form className="form-dialog__panel" onSubmit={submit} noValidate>
        <header className="form-dialog__head">
          <h2 id={titleId} className="form-dialog__title">{title}</h2>
          {description && <p id={textId} className="form-dialog__text">{description}</p>}
        </header>
        <fieldset ref={bodyRef} className="form-dialog__body" disabled={busy}>{children}</fieldset>
        <div className="form-actions">
          <button type="button" className="btn btn--ghost" disabled={saving || busy} onClick={cancel}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn--primary" disabled={saving || busy || submitDisabled}>{submitLabel}</button>
        </div>
      </form>
    </Dialog>
  )
}
