import type { SelectHTMLAttributes } from 'react'
import '../../../styles/controls.css'

/**
 * The one dropdown: a native dropdown (the phone's own picker) in a wrapper that draws the chevron, so every dropdown
 * looks the same in both themes. Every prop goes to the dropdown itself, including the aria-* that Field adds.
 */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select">
      <select {...rest} className={['admin-select', className].filter(Boolean).join(' ')}>{children}</select>
    </span>
  )
}
