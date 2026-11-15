import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCheck, IconCopy, IconX } from '@tabler/icons-react'
import { Dialog } from '../../components/ui/Dialog'
import { useModalDialog } from '../../components/ui/useModalDialog'
import { promptText, type PromptBlock } from './prompts'
import { copyText } from '../../lib/clipboard'

type CopyState = 'idle' | 'copied' | 'failed'

/** The status line after copying, as locale keys; idle shows nothing. */
const STATUS: Record<CopyState, string | null> = {
  idle: null,
  copied: 'modules.claude_prompts.dialog.copied',
  failed: 'modules.claude_prompts.dialog.copyFailed',
}
/** What matters most to check by eye before sending */
const ACCENT = new Set<PromptBlock['kind']>(['metric', 'question'])

/**
 * The Claude question window: shows exactly the text that goes to the clipboard, and copies it.
 * blocks = null: the question could not be built.
 */
export function PromptPreviewDialog({ title, blocks, onClose, gated = false, sessionId = 0, onReveal }: {
  title: string
  blocks: PromptBlock[] | null
  onClose: () => void
  gated?: boolean
  sessionId?: number
  onReveal?: () => void
}) {
  const { t } = useTranslation()
  const copyRef = useRef<HTMLButtonElement>(null)
  const revealRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const { dialogRef, close } = useModalDialog(gated ? revealRef : blocks ? copyRef : closeRef)
  const titleId = useId()
  const [feedback, setFeedback] = useState<{ sessionId: number; state: CopyState }>({ sessionId, state: 'idle' })
  const state = feedback.sessionId === sessionId && !gated ? feedback.state : 'idle'
  const current = useRef({ sessionId, gated, mounted: false })
  useLayoutEffect(() => {
    current.current = { sessionId, gated, mounted: true }
    return () => { current.current.mounted = false }
  }, [sessionId, gated])
  useLayoutEffect(() => {
    if (dialogRef.current?.open) (gated ? revealRef : blocks ? copyRef : closeRef).current?.focus()
  }, [gated, sessionId, dialogRef, blocks])

  async function handleCopy() {
    if (!blocks || gated) return
    const mayContinue = () => !!dialogRef.current?.open && current.current.mounted && !current.current.gated && current.current.sessionId === sessionId
    try {
      const copied = await copyText(promptText(blocks), mayContinue)
      if (mayContinue()) setFeedback({ sessionId, state: copied ? 'copied' : 'failed' })
    } catch {
      if (mayContinue()) setFeedback({ sessionId, state: 'failed' })
    }
  }

  const icon = { size: 18, stroke: 1.75, 'aria-hidden': true as const }
  return (
    <Dialog dialogRef={dialogRef} className="prompt-dialog" aria-labelledby={titleId} onClose={onClose} onDismiss={() => close()}>
      <div className="prompt-dialog__panel">
        <header className="prompt-dialog__head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId} className="prompt-dialog__title">{t('modules.claude_prompts.dialog.title', { title })}</h2>
            <p className="prompt-dialog__hint">{t('modules.claude_prompts.dialog.hint')}</p>
          </div>
          <button ref={closeRef} type="button" className="prompt-dialog__x" aria-label={t('modules.claude_prompts.dialog.closeWindow')} onClick={() => close()}>
            <IconX {...icon} />
          </button>
        </header>
        <div className="prompt-dialog__body">
          {gated ? <p className="prompt-block__body">{t('modules.claude_prompts.dialog.revealWarning')}</p> : blocks
            ? blocks.map(b => (
                <section key={b.kind} className={`prompt-block prompt-block--${b.kind}${ACCENT.has(b.kind) ? ' prompt-block--accent' : ''}`}>
                  {b.heading && <h3 className="prompt-block__heading">{b.heading}</h3>}
                  <p className="prompt-block__body">{b.body}</p>
                </section>
              ))
            : <p className="prompt-block__body">{t('modules.claude_prompts.dialog.failed')}</p>}
        </div>
        <footer className="prompt-dialog__foot">
          <p role="status" className="prompt-dialog__status" data-state={state}>
            {state === 'copied' && <IconCheck {...icon} />}
            {state === 'failed' && <IconAlertTriangle {...icon} />}
            {STATUS[state] && t(STATUS[state])}
          </p>
          {gated ? <button ref={revealRef} type="button" className="btn btn--primary" onClick={onReveal}>{t('modules.claude_prompts.dialog.reveal')}</button> : <button ref={copyRef} type="button" className="btn btn--primary" disabled={!blocks} onClick={handleCopy}>
            <IconCopy {...icon} />{t('modules.claude_prompts.dialog.copy')}
          </button>}
          <button type="button" className="btn btn--ghost" onClick={() => close()}>{t('modules.claude_prompts.dialog.close')}</button>
        </footer>
      </div>
    </Dialog>
  )
}
