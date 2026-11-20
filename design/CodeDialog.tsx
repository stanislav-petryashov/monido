import copy from './locales/ru-RU.json'
import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../src/components/ui/Dialog'
import { useModalDialog } from '../src/components/ui/useModalDialog'
import type { DesignEntry } from './registry'

export function CodeDialog({ entry, onClose }: { entry: DesignEntry; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const { dialogRef, close } = useModalDialog(closeButton)
  const [source, setSource] = useState<string>()
  const [copyState, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle')
  const path = entry.from ?? entry.owner
  const { variants, ...metadata } = entry
  const context = JSON.stringify({ ...metadata, variants: variants.map(v => v.label) }, null, 2)

  useEffect(() => {
    let active = true
    // Only registry paths reach this dev-only Vite raw import.
    void import(/* @vite-ignore */ '/' + path + '?raw').then(
      module => { if (active) setSource(module.default) },
      () => { if (active) setSource(copy.sourceFailed) },
    )
    return () => { active = false }
  }, [path])

  async function copyContext() {
    try {
      await navigator.clipboard.writeText(context)
      setCopy('copied')
    } catch {
      setCopy('manual')
    }
  }

  return <Dialog dialogRef={dialogRef} className="dc__dialog" aria-labelledby="dc-source-title" onClose={onClose} onDismiss={() => close()}>
    <div className="dc__dialog-body">
      <div className="dc__heading"><h2 id="dc-source-title">{entry.name}</h2>
        <button ref={closeButton} className="btn btn--quiet" onClick={() => close()}>{copy.close}</button></div>
      <code>{path}</code>
      <pre tabIndex={0} aria-label={copy.source}>{source ?? copy.loadingSource}</pre>
      <button className="btn btn--ghost" onClick={copyContext}>{copy.copyContext}</button>
      <span role="status">{copyState === 'copied' && copy.copied}{copyState === 'manual' && copy.manualCopy}</span>
      {copyState === 'manual' && <pre tabIndex={0}>{context}</pre>}
    </div>
  </Dialog>
}
