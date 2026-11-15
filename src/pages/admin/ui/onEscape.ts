import type { KeyboardEvent } from 'react'

/** An onKeyDown for an inline form or table row: Escape (not already used by a menu or list inside) calls `cancel` */
export const onEscape = (cancel: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); cancel() }
}
