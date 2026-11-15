import { useEffect, useEffectEvent, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconX } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { ToastLink } from '../../lib/notifyState'
import { Link } from './Link'

export interface ToastItem {
  id: number
  tone: 'success' | 'error'
  title: string
  text?: string
  links?: readonly ToastLink[]
}

/** A plain success disappears after 4 s; an error, and any toast with links, only on ✕ or when a link is followed. */
export const SUCCESS_MS = 4000

/**
 * A stack of notifications at the top right. `host`: the open modal window to render into — outside it the page is inert,
 * the stack would sit under the backdrop, unclickable and unannounced; null is the page (body). The stack is portalled
 * into one wrapper element that is moved between them: moving a DOM node keeps React's subtree, so the live region and the
 * toasts stay the same nodes and a success's timer does not start again.
 */
export function Toaster({ toasts, onDismiss, host = null }: { toasts: ToastItem[]; onDismiss: (id: number) => void; host?: HTMLDialogElement | null }) {
  const { t } = useTranslation()
  // A success is announced through a live region that is in the DOM beforehand: a role="status"
  // inserted together with its text is often missed by screen readers. Errors use role="alert" on the card.
  // Only a toast that has just been pushed is announced: once the newest success is gone (a plain one expired), the region
  // goes quiet instead of reading an older toast that stays (one with links) again.
  const newest = [...toasts].reverse().find(t => t.tone === 'success')
  const [announcedId, setAnnouncedId] = useState(0)
  if (newest && newest.id > announcedId) setAnnouncedId(newest.id)
  const latest = newest?.id === announcedId ? newest : undefined
  const [mount] = useState(() => document.createElement('div'))
  useLayoutEffect(() => { (host ?? document.body).appendChild(mount) }, [host, mount])
  useLayoutEffect(() => () => mount.remove(), [mount])
  return createPortal(
    <div className="toaster" role="region" aria-label={t('common.notifications')}>
      <div role="status" className="sr-only">{latest ? [latest.title, latest.text, latest.links?.map(l => l.label).join(', ')].filter(Boolean).join('. ') : ''}</div>
      {toasts.map(t => <Toast key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />)}
    </div>,
    mount,
  )
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  // onDismiss is new on every render of the stack: an effect event does not restart the timer
  const dismiss = useEffectEvent(onDismiss)
  const paused = hovered || focused
  // a link has to be reachable at the user's pace: such a toast waits for ✕ or for the link
  const sticky = toast.tone !== 'success' || (toast.links?.length ?? 0) > 0

  useEffect(() => {
    if (sticky || paused) return
    const timer = setTimeout(() => dismiss(), SUCCESS_MS)
    return () => clearTimeout(timer)
  }, [sticky, paused])

  return (
    <div
      className="toast"
      role={toast.tone === 'error' ? 'alert' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {/* the tone is read from role="alert" and the title; the dot only marks it for the eye */}
      <span className={toast.tone === 'error' ? 'toast__dot toast__dot--error' : 'toast__dot'} aria-hidden />
      <div className="toast__body">
        <div className="toast__title">{toast.title}</div>
        {toast.text && <div className="toast__text">{toast.text}</div>}
        {toast.links && toast.links.length > 0 && (
          <div className="toast__links">
            {toast.links.map(l => <Link key={l.to} to={l.to} className="link-accent" onClick={onDismiss}>{l.label}</Link>)}
          </div>
        )}
      </div>
      <button type="button" className="toast__close" aria-label={t('common.dismissNotification')} onClick={onDismiss}>
        <IconX size={16} stroke={2} aria-hidden />
      </button>
    </div>
  )
}
