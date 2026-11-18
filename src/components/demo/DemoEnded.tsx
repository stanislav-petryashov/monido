import { useEffect, useId, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { IconHourglassEmpty } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { syncDemo, useAuth, useRestartDemo } from '../../lib/authState'
import { useCountdown } from '../../lib/demoCountdown'
import { Avatar } from '../ui/Avatar'
import { Dialog } from '../ui/Dialog'
import { useModalDialog } from '../ui/useModalDialog'

/**
 * The end of a demo session, over the page: the server said the sandbox is gone (demo_expired), or the countdown reached
 * zero. Outside the demo, and while the session runs — nothing. When the window gets the focus back, the session is
 * checked with the server.
 */
export function DemoEnded() {
  const { demo } = useAuth()
  const left = useCountdown(demo?.expiresAt ?? null)
  const inDemo = demo !== null
  const client = useQueryClient()
  useEffect(() => {
    if (!inDemo) return
    const sync = () => { void syncDemo(client) }
    window.addEventListener('focus', sync)
    return () => window.removeEventListener('focus', sync)
  }, [inDemo, client])
  if (!demo || !(demo.expired || left?.done)) return null
  return <EndedDialog installUrl={demo.installUrl} />
}

function EndedDialog({ installUrl }: { installUrl: string | null }) {
  const { t } = useTranslation()
  const startRef = useRef<HTMLButtonElement>(null)
  const { dialogRef } = useModalDialog(startRef)
  const { restart, busy, error } = useRestartDemo()
  const titleId = useId()
  const textId = useId()

  return (
    <Dialog
      dialogRef={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={textId}
      // there is no page to go back to: Escape closes the <dialog> by itself, so it opens again (a fresh session unmounts it)
      onClose={e => e.currentTarget.showModal()}
      onDismiss={() => {}}
    >
      <div className="confirm-dialog__panel">
        <Avatar icon={IconHourglassEmpty} color="warning" size="lg" />
        <h2 id={titleId} className="confirm-dialog__title">{t('demo.ended.title')}</h2>
        <p id={textId} className="confirm-dialog__text">{t('demo.ended.text')}</p>
        {error && <p role="alert" className="demo-error">{error()}</p>}
        <div className="confirm-dialog__actions">
          <button ref={startRef} type="button" className="btn btn--primary" disabled={busy} onClick={() => { void restart() }}>{t('demo.startOver')}</button>
          {installUrl && <a className="btn btn--ghost" href={installUrl} target="_blank" rel="noopener noreferrer">{t('demo.install')}</a>}
        </div>
      </div>
    </Dialog>
  )
}
