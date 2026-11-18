import { useRef, type ReactNode, type RefObject, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'

interface DialogProps {
  dialogRef: RefObject<HTMLDialogElement | null>
  className: string
  'aria-labelledby': string
  'aria-describedby'?: string
  /** The close event of the <dialog> itself: buttons, the browser's Escape and a click on the backdrop */
  onClose: (e: SyntheticEvent<HTMLDialogElement>) => void
  /** The browser's Escape, before it closes the window: preventDefault keeps it open */
  onCancel?: (e: SyntheticEvent<HTMLDialogElement>) => void
  /** A click on the backdrop; usually close('cancel') */
  onDismiss: () => void
  children: ReactNode
}

/**
 * <dialog> through a portal into body. A click on the backdrop: the panel fills the window, so the <dialog>
 * itself is under the cursor only outside it, and only a press that began there dismisses (a selection dragged out of a field
 * does not). The second click of a double click on the button that opened the window lands here — it is skipped.
 */
export function Dialog({ dialogRef, className, onClose, onCancel, onDismiss, children, ...aria }: DialogProps) {
  // where the press began: a text selection dragged out of a field ends on the backdrop, and that click is not a dismiss
  const pressedBackdrop = useRef(false)
  return createPortal(
    <dialog
      ref={dialogRef}
      className={`dialog ${className}`}
      aria-labelledby={aria['aria-labelledby']}
      aria-describedby={aria['aria-describedby']}
      onClose={onClose}
      onCancel={onCancel}
      onMouseDown={e => { pressedBackdrop.current = e.target === e.currentTarget }}
      onClick={e => { if (e.target === e.currentTarget && pressedBackdrop.current && e.detail < 2) onDismiss() }}
    >
      {children}
    </dialog>,
    document.body,
  )
}
