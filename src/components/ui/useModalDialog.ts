import { useEffect, useEffectEvent, useRef, useSyncExternalStore, type RefObject } from 'react'

/**
 * The modal windows on screen, in the order they opened. While one is open the rest of the page is inert (the browser's
 * top layer), so whatever must stay usable — the notifications — is rendered inside the topmost one (useTopModalDialog).
 */
const modals: HTMLDialogElement[] = []
const listeners = new Set<() => void>()
const changed = () => { for (const listener of listeners) listener() }
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
/** The last opened window that is still open: a window closed but not yet unmounted does not count */
const topModal = () => modals.findLast(d => d.open) ?? null

/** The topmost open modal window of useModalDialog, or null; re-renders when a window opens or closes. */
export function useTopModalDialog(): HTMLDialogElement | null {
  return useSyncExternalStore(subscribe, topModal, () => null)
}

/**
 * A modal window on <dialog>: it opens on mount, the focus goes to initialFocus.
 * close(value) closes the window; the answer is read in onClose from returnValue.
 */
export function useModalDialog(initialFocus: RefObject<HTMLElement | null>) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const focusInitial = useEffectEvent(() => initialFocus.current?.focus())
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    focusInitial()
    if (!dialog) return
    modals.push(dialog)
    // a window that closes (or is opened again from its own close handler, as FormDialog does while saving) is re-read
    dialog.addEventListener('close', changed)
    changed()
    return () => {
      dialog.removeEventListener('close', changed)
      modals.splice(modals.indexOf(dialog), 1)
      changed()
    }
  }, [])
  const close = (value?: string) => dialogRef.current?.close(value)
  return { dialogRef, close }
}
