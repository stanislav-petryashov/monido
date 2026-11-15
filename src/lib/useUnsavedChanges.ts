import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfirm } from './notifyState'
import { registerNavigationGuard } from './router'

/** Protect in-memory input during intentional departure and native reload/tab close. */
export function useUnsavedChanges(atRisk: boolean): { confirmDiscard: () => Promise<boolean> } {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const pending = useRef<Promise<boolean> | null>(null)
  const confirmDiscard = useCallback((): Promise<boolean> => {
    if (!atRisk) return Promise.resolve(true)
    if (pending.current) return pending.current
    const answer = confirm({
      title: t('common.unsaved.title'), text: t('common.unsaved.text'),
      confirmLabel: t('common.unsaved.discard'), tone: 'warning',
    }).finally(() => { pending.current = null })
    pending.current = answer
    return answer
  }, [atRisk, confirm, t])

  const latest = useRef(confirmDiscard)
  useLayoutEffect(() => { latest.current = confirmDiscard }, [confirmDiscard])
  // Keep the owner registered when a save clears risk: an answer already on screen remains valid.
  // Only unmount invalidates that answer (including auth loss and sign-out).
  useEffect(() => registerNavigationGuard(() => latest.current()), [])

  useEffect(() => {
    if (!atRisk) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [atRisk])
  return { confirmDiscard }
}

/**
 * `discard(action)` for a records screen: nothing while a save runs (any of `running`), else the action — after the
 * unsaved-input question when `atRisk` — unless a save started while the question was open.
 */
export function useDiscardGuard(atRisk: boolean, ...running: (() => boolean)[]) {
  const { confirmDiscard } = useUnsavedChanges(atRisk)
  const busy = () => running.some(pending => pending())
  async function discard(action: () => void) {
    if (busy()) return
    if (!atRisk || await confirmDiscard()) {
      if (!busy()) action()
    }
  }
  return { discard, confirmDiscard }
}

/** Whether two forms differ in any field; a missing field reads as empty */
export const changed = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].some(key => (a[key] ?? '') !== (b[key] ?? ''))
