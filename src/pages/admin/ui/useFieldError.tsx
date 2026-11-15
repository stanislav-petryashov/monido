import { FieldError } from './FieldError'
import { useId, useState, type ReactNode } from 'react'

/**
 * A field's error said in words, not by the red border alone (WCAG 3.3.1). The text appears once the user has left the
 * field — not mid-typing, where "3," is on its way to "3,5" — and stays until the value reads. `field` goes on the
 * control: aria-invalid, aria-describedby pointing at the text (and at a hint, if the field has one), onBlur.
 */
export function useFieldError(invalid: boolean, message: string, hintId?: string, submitted = false): {
  field: { 'aria-invalid'?: true, 'aria-describedby'?: string, onBlur: () => void }
  error: ReactNode
} {
  const id = useId()
  const [left, setLeft] = useState(false)
  const shown = invalid && (left || submitted)
  const describedBy = [hintId, shown ? id : undefined].filter(Boolean).join(' ')
  return {
    field: { 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy || undefined, onBlur: () => setLeft(true) },
    error: shown ? <FieldError id={id}>{message}</FieldError> : null,
  }
}
