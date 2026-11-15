import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { navigate } from '../../lib/router'

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string
}

/**
 * An internal link: a plain click does not reload the page. Cmd/Ctrl/Shift/Alt, a non-left button,
 * target and download behave as in the browser. A click on the current page adds no history entry.
 */
export function Link({ to, onClick, ...rest }: LinkProps) {
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if ((rest.target && rest.target !== '_self') || rest.download !== undefined) return
    if (new URL(to, window.location.href).origin !== window.location.origin) return
    e.preventDefault()
    if (to !== window.location.pathname) navigate(to)
  }
  return <a href={to} {...rest} onClick={handleClick} />
}
