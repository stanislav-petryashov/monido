import { createContext } from 'react'

/** A place in the page header for the screen's main action; DataPage provides it. */
export const PageActionSlot = createContext<HTMLElement | null>(null)
