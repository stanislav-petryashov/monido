interface SectionLabelProps {
  children: string
  /** An anchor other pages link to (/cashflow#income): the heading can then take the focus */
  id?: string
}

/** A page section heading. */
export function SectionLabel({ children, id }: SectionLabelProps) {
  return <h2 className="section-label" id={id} tabIndex={id ? -1 : undefined}>{children}</h2>
}
