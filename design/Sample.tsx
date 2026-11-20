import copy from './locales/ru-RU.json'
import { useLayoutEffect, useRef } from 'react'
import type { DesignEntry } from './registry'

export function Sample({ entry }: { entry?: DesignEntry }) {
  const root = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const frame = window.frameElement
    const content = root.current
    if (!(frame && content)) return
    // The application shell is viewport-height; measuring it back into the iframe would grow it on every resize.
    if (entry?.name === 'AppNavigation') {
      frame.setAttribute('height', '640')
      return
    }
    const observer = new ResizeObserver(() => {
      frame.setAttribute('height', String(Math.ceil(content.getBoundingClientRect().height)))
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [entry])
  const labels: Record<string, string> = { on: copy.on, disabled: copy.disabled, default: copy.normal }
  return <main ref={root} className={entry?.name === 'AppNavigation' ? 'dc-navigation-sample' : 'dc-sample shell__content'}>
    {entry ? entry.variants.map(v => <figure key={v.label}>
      <figcaption className={entry?.name === 'AppNavigation' ? 'sr-only' : undefined}>{labels[v.label] ?? v.label}</figcaption>{v.render()}
    </figure>) : <p>{copy.sampleMissing}</p>}
  </main>
}
