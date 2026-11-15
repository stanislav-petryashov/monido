import { useEffect, useRef, useState } from 'react'
import { useMedia } from '../../lib/media'
import { recordFromHash } from '../../lib/recordLink'

/** On small screens the list and the selected record are separate views. Editors decide when navigation is safe. */
export function useRecordPane(watchContainer = false) {
  const viewportNarrow = useMedia('(max-width: 900px)')
  const [containerNarrow, setContainerNarrow] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = containerRef.current
    if (!watchContainer || !element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => setContainerNarrow(entries[0].contentRect.width < 768))
    observer.observe(element)
    return () => observer.disconnect()
  }, [watchContainer])
  const narrow = viewportNarrow || containerNarrow
  const [opened, setOpened] = useState(() => recordFromHash() !== null)
  const position = useRef(0)
  const trigger = useRef<HTMLElement | null>(null)
  const open = () => {
    if (!narrow && window.innerWidth > 900) { setOpened(true); return }
    if (!opened) {
      position.current = window.scrollY
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    setOpened(true)
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.record-detail__back')?.focus({ preventScroll: true })
      window.scrollTo({ top: 0 })
    })
  }
  const back = () => {
    setOpened(false)
    if (!narrow && window.innerWidth > 900) return
    requestAnimationFrame(() => {
      const target = trigger.current?.isConnected ? trigger.current : (document.querySelector<HTMLElement>('.side-list__item[aria-current="true"]')
        ?? document.querySelector<HTMLElement>('.side-list__item')
        ?? document.getElementById('page-title'))
      target?.focus({ preventScroll: true })
      window.scrollTo({ top: position.current })
    })
  }
  return { opened, visible: !narrow || opened, open, back, containerRef }
}
