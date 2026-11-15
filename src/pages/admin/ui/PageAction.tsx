import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PageActionSlot } from './pageActionSlot'

/** The screen's main action ("+ Account") — drawn in the page header while its state stays in the screen. */
export function PageAction({ children }: { children: ReactNode }) {
  const slot = useContext(PageActionSlot)
  return slot ? createPortal(children, slot) : null
}
