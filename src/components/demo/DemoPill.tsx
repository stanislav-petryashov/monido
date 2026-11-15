import { useTranslation } from 'react-i18next'
import { useAuth, useRestartDemo } from '../../lib/authState'
import { useCountdown } from '../../lib/demoCountdown'
import { useMedia } from '../../lib/media'
import { useDisclosure } from '../ui/usePopover'

/**
 * Up to this width the title row has no room for the whole line beside the title and the other controls (shell.css): below
 * 1200 px it spans the screen, from 1200 px the sidebar takes about 300 px and leaves it at least 892 px. The pill is
 * short there and opens the explanation.
 */
const COMPACT = '(max-width: 1000px)'

/**
 * The demo's countdown in the title row: on a wide screen the whole line; on a narrow one a short button whose panel explains the
 * demo and offers "Start over" and "Install it yourself". The last two minutes are a warning. Outside the demo — nothing.
 */
export function DemoPill() {
  const { demo } = useAuth()
  const left = useCountdown(demo?.expiresAt ?? null)
  const compact = useMedia(COMPACT)
  if (!demo || !left) return null
  const tone = left.warning ? 'demo-pill demo-pill--warning' : 'demo-pill'
  return compact ? <DemoMenu tone={tone} time={left.text} installUrl={demo.installUrl} /> : <FullPill tone={tone} time={left.text} />
}

function FullPill({ tone, time }: { tone: string; time: string }) {
  const { t } = useTranslation()
  return <span className={tone}>{t('demo.pill.full', { time })}</span>
}

function DemoMenu({ tone, time, installUrl }: { tone: string; time: string; installUrl: string | null }) {
  const { t } = useTranslation()
  const { open, setOpen, rootRef, triggerRef, panelId, triggerProps } = useDisclosure()
  const { restart, busy, error } = useRestartDemo()

  async function startOver() {
    if (await restart()) setOpen(false)
  }

  return (
    <div className="demo-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${tone} demo-pill--button`}
        {...triggerProps}
      >
        {t('demo.pill.short', { time })}
      </button>
      {open && (
        <div id={panelId} className="demo-panel">
          <p className="demo-panel__text">{t('demo.pill.details', { time })}</p>
          {error && <p role="alert" className="demo-error">{error()}</p>}
          <div className="demo-panel__actions">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => { void startOver() }}>{t('demo.startOver')}</button>
            {installUrl && <a className="btn btn--ghost" href={installUrl} target="_blank" rel="noopener noreferrer">{t('demo.install')}</a>}
          </div>
        </div>
      )}
    </div>
  )
}
