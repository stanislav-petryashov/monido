import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * The caret of a masked text field after React puts the shown text back: set `caretRef.current` to where the caret belongs
 * (a position in the new text) before the render; once it has rendered the focused input gets it, once.
 */
export function useRestoredCaret(): { ref: RefObject<HTMLInputElement | null>; caretRef: { current: number | null } } {
  const ref = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const at = caret.current
    caret.current = null
    const input = ref.current
    if (at !== null && input && input.ownerDocument.activeElement === input) input.setSelectionRange(at, at)
  })
  return { ref, caretRef: caret }
}
