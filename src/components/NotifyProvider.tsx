import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ConfirmContext, ToastContext, errorText, type Confirm, type ConfirmOptions, type ToastApi } from '../lib/notifyState'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Toaster, type ToastItem } from './ui/Toaster'
import { useTopModalDialog } from './ui/useModalDialog'

const MAX_TOASTS = 3

interface ConfirmRequest {
  id: number
  options: ConfirmOptions
  resolve: (yes: boolean) => void
  /** Where the focus was before the question */
  returnFocus: HTMLElement | null
}

/** Notifications and confirmations for the whole app; it sits above the routes, so it outlives a page change. */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const pending = useRef<ConfirmRequest | null>(null)
  const nextId = useRef(1)
  // while a modal window is open the rest of the page is inert: the notifications move into the topmost window
  const toastHost = useTopModalDialog()

  const dismiss = useCallback((id: number) => setToasts(ts => ts.filter(t => t.id !== id)), [])

  const toast = useMemo<ToastApi>(() => {
    const push = (item: Omit<ToastItem, 'id'>) => {
      const id = nextId.current++
      setToasts(ts => [...ts, { ...item, id }].slice(-MAX_TOASTS))
    }
    return {
      success: (title, text, links) => push({ tone: 'success', title, text, links }),
      error: (title, error) => push({ tone: 'error', title, text: error === undefined ? undefined : errorText(error) }),
    }
  }, [])

  const confirm = useCallback<Confirm>(options => new Promise<boolean>(resolve => {
    const previous = pending.current
    previous?.resolve(false)
    const active = document.activeElement
    const next: ConfirmRequest = {
      id: nextId.current++,
      options,
      resolve,
      // a question over a question: the focus goes back to where the first one was asked
      returnFocus: previous ? previous.returnFocus : active instanceof HTMLElement ? active : null,
    }
    pending.current = next
    setRequest(next)
  }), [])

  const answer = useCallback((id: number, yes: boolean) => {
    const current = pending.current
    if (!current || current.id !== id) return
    pending.current = null
    setRequest(null)
    current.resolve(yes)
    // after "yes" the button that asked usually disappears (the row was deleted, the revert disabled the button) —
    // the focus goes to the page title; after "no", back to the button if it is still there. The page is not scrolled.
    const back = yes ? null : current.returnFocus
    ;(back?.isConnected ? back : document.getElementById('page-title'))?.focus({ preventScroll: true })
  }, [])

  // the app went away with a question open: the answer is "no"
  useEffect(() => {
    const ref = pending
    return () => ref.current?.resolve(false)
  }, [])

  return (
    <ConfirmContext value={confirm}>
      <ToastContext value={toast}>
        {children}
        <Toaster toasts={toasts} onDismiss={dismiss} host={toastHost} />
        {request && <ConfirmDialog key={request.id} options={request.options} onAnswer={yes => answer(request.id, yes)} />}
      </ToastContext>
    </ConfirmContext>
  )
}
