import { useEffect, useRef, useState } from 'react'

/**
 * Focus on the page title after a navigation, so a screen reader announces the new page.
 * Lazy pages mount after the navigation; the title row is always there, so the request only waits on the very first mount.
 */
let pending = false

/** The id the address names (/health#savings_rate); a malformed hash (#%) names none. */
function hashTarget(): string {
  try {
    return decodeURIComponent(window.location.hash.slice(1))
  } catch {
    return ''
  }
}

/** The address points at an element of the page (/settings/modules#loans): it takes focus itself, the title does not override it. */
function hashTargetPresent(): boolean {
  const id = hashTarget()
  return id !== '' && document.getElementById(id) !== null
}

export function requestPageFocus(): void {
  if (hashTargetPresent()) {
    pending = false
    return
  }
  const title = document.getElementById('page-title')
  if (title) {
    pending = false
    title.focus()
  } else {
    pending = true
  }
}

/** Called by TitleRow on mount: takes the deferred focus request. */
export function consumePageFocus(title: HTMLElement): void {
  if (!pending) return
  pending = false
  title.focus()
}

/**
 * Once the page has its data, focus the element the address names (/#history, /health#savings_rate):
 * after the shell's scroll to the top on navigation, the focus brings it into view. Returns that id ('' — none).
 */
export function useHashFocus(ready: boolean): string {
  const [target] = useState(hashTarget)
  const focused = useRef(false)
  useEffect(() => {
    if (!ready || !target || focused.current) return
    // marked inside the frame: StrictMode's cleanup cancels the first one, and the rerun must still focus
    const frame = requestAnimationFrame(() => {
      focused.current = true
      document.getElementById(target)?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [ready, target])
  return target
}
