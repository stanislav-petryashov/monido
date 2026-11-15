import { useState, type ReactNode } from 'react'
import { DisclosureChevron } from './DisclosureChevron'
import '../../styles/disclosure.css'

/** One card around neighbouring rows: the screen reads as one list, not a stack of empty boxes. */
export function DisclosureGroup({ children }: { children: ReactNode }) {
  return <div className="disclosure-group">{children}</div>
}

interface DisclosureProps {
  title: ReactNode
  /** A row's short line on the right: only what no other place on the screen says, and nothing that depends on the fields inside */
  hint?: ReactNode
  children: ReactNode
  /** `row` is a section in a DisclosureGroup, its content mounted on demand; `inline` is a quiet label for a short note, its content always there */
  variant?: 'row' | 'inline'
  /** A row's title element: a heading, or a span when the title is the columns of a list row */
  titleAs?: 'h2' | 'h3' | 'h4' | 'span'
  /** The native attribute, for an owner that decides: while it is unset the row keeps its own state */
  open?: boolean
  anchor?: string
  initiallyOpen?: boolean
  /** The anchor is on this element, for useHashFocus: its content has no such id of its own */
  focusable?: boolean
  /** A row's content that must stay mounted while folded, as an inline one's does */
  eager?: boolean
  className?: string
  onToggle?: (open: boolean) => void
}

/**
 * Secondary content behind a chevron. A row mounts expensive details on demand, then keeps their drafts intact when
 * folded; deep links open it immediately. The first opening is instant, because the content only arrives with it.
 */
export function Disclosure({ title, hint, children, variant = 'row', titleAs: Title = 'h2', open: openProp, anchor, initiallyOpen = false, focusable = false, eager = false, className, onToggle }: DisclosureProps) {
  const inline = variant === 'inline'
  const [openState, setOpenState] = useState(() => initiallyOpen || (!!anchor && window.location.hash === `#${anchor}`))
  const open = openProp ?? openState
  const [visited, setVisited] = useState(open || inline || eager)
  const classes = ['disclosure', `disclosure--${variant}`, className].filter(Boolean).join(' ')
  return <details id={focusable ? anchor : undefined} tabIndex={focusable ? -1 : undefined} className={classes} data-visited={visited || undefined} open={open} onToggle={event => {
    const next = event.currentTarget.open
    setOpenState(next)
    if (next) setVisited(true)
    onToggle?.(next)
  }}>
    {inline
      ? <summary>{title}<DisclosureChevron size={16} /></summary>
      : <summary><Title className="disclosure__title">{title}</Title>{hint != null && <span className="disclosure__hint">{hint}</span>}<DisclosureChevron /></summary>}
    {visited && <div className="disclosure__body">{children}</div>}
  </details>
}
