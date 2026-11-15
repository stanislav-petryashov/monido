import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconSparkles } from '@tabler/icons-react'
import type { MetricKey } from '../../domain/metricCatalog'
import { usePrivacy } from '../../lib/privacy'
import { metricTitle } from '../../lib/metricText'
import type { PromptBlock } from './prompts'
import { useMetricPrompt } from './useMetricPrompt'
import { PromptPreviewDialog } from './PromptPreviewDialog'

interface CopyPromptButtonProps {
  metric: MetricKey
  /** With a label — a primary button (the Advisor's Ask page); without — the ✨ icon */
  label?: string
}

/** Opens the Claude question about a metric — to look at and copy. */
export function CopyPromptButton({ metric, label }: CopyPromptButtonProps) {
  const { t } = useTranslation()
  const build = useMetricPrompt(metric)
  const { hidden } = usePrivacy()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [preview, setPreview] = useState<{ blocks: PromptBlock[] | null; revealed: boolean; sessionId: number; hidden: boolean } | null>(null)
  const generation = useRef(0)

  function buildBlocks(): PromptBlock[] | null {
    try { return build?.() ?? null } catch { return null }
  }

  // Adjust during render so a privacy change cannot commit the previous session's content.
  if (preview && preview.hidden !== hidden) {
    setPreview({ blocks: hidden ? null : buildBlocks(), revealed: !hidden, sessionId: preview.sessionId + 1, hidden })
  }

  function open() {
    if (!build) return
    setPreview({ blocks: hidden ? null : buildBlocks(), revealed: !hidden, sessionId: ++generation.current, hidden })
  }

  function reveal() {
    setPreview(current => current ? { ...current, blocks: buildBlocks(), revealed: true, sessionId: current.sessionId + 1 } : null)
  }

  function close() {
    setPreview(null)
    triggerRef.current?.focus()
  }

  const title = metricTitle(metric)
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={label ? 'btn btn--primary insight__ask' : 'copy-prompt'}
        aria-label={label ? `${label}: ${title}` : t('modules.claude_prompts.show', { title })}
        aria-haspopup="dialog"
        title={t('modules.claude_prompts.hint')}
        disabled={!build}
        onClick={open}
      >
        <IconSparkles size={label ? 16 : 18} stroke={1.75} aria-hidden />
        {label}
      </button>
      {preview && <PromptPreviewDialog title={title} blocks={preview.blocks} gated={hidden && !preview.revealed} sessionId={preview.sessionId} onReveal={reveal} onClose={close} />}
    </>
  )
}
