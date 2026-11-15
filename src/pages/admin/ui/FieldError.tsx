import type { ReactNode } from 'react'

/** Shared inline validation message; the owner decides when it becomes visible. */
export function FieldError({ children, id }: { children: ReactNode; id?: string }) {
  return <span id={id} className="field__error" role="alert">{children}</span>
}
