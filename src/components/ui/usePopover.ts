import { useEffect, useEffectEvent, useId, useRef, useState, type RefObject } from 'react'

interface PopoverOptions {
  open: boolean
  /** Close the list; the hook returns the focus itself */
  onClose: () => void
  /** The button that opened the list: it gets the focus on Escape and when the page moves */
  trigger: RefObject<HTMLElement | null>
  /** What counts as "inside": a click on these elements does not close the list */
  inside: RefObject<HTMLElement | null>[]
  /** Close on scroll and window resize: for a list tied to the button's place on the screen */
  closeOnMove?: boolean
}

/**
 * The mechanics of a dropdown list: a click outside closes it, Escape closes it and returns the focus to the button;
 * with closeOnMove, scrolling or resizing the window closes it too (the focus leaves the vanishing list for the button).
 */
export function usePopover({ open, onClose, trigger, inside, closeOnMove = false }: PopoverOptions): void {
  const onPointer = useEffectEvent((e: MouseEvent) => {
    if (!inside.some(ref => ref.current?.contains(e.target as Node))) onClose()
  })
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    // this Escape is the popover's: a dialog around it must not take it as its own cancel too
    e.preventDefault()
    onClose()
    trigger.current?.focus()
  })
  const onMove = useEffectEvent(() => {
    // the focus of the vanishing list goes back to the button, or it would fall onto the body
    if (inside.some(ref => ref.current?.contains(document.activeElement))) trigger.current?.focus({ preventScroll: true })
    onClose()
  })

  useEffect(() => {
    if (!open) return
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    if (closeOnMove) {
      window.addEventListener('scroll', onMove, true)
      window.addEventListener('resize', onMove)
    }
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
      if (closeOnMove) {
        window.removeEventListener('scroll', onMove, true)
        window.removeEventListener('resize', onMove)
      }
    }
  }, [open, closeOnMove])
}

/**
 * The state every dropdown shares, with `usePopover` wired in: `open`, the refs for the wrapper (`rootRef`, what counts as
 * inside) and the button (`triggerRef`), and `triggerProps` — aria-expanded, aria-controls to the panel (give `panelId` to the
 * panel) and the click that toggles. A menu with its own toggle (RadioMenu) uses `open`, `setOpen` and the refs only.
 */
export function useDisclosure() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  usePopover({ open, onClose: () => setOpen(false), trigger: triggerRef, inside: [rootRef] })
  return {
    open, setOpen, rootRef, triggerRef, panelId,
    triggerProps: {
      'aria-expanded': open,
      'aria-controls': open ? panelId : undefined,
      onClick: () => setOpen(o => !o),
    },
  }
}
