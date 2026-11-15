import type { ChangeEventHandler, RefObject } from 'react'
import { holdEnter } from './useDateText'

interface DateTextInputProps {
  inputRef: RefObject<HTMLInputElement | null>
  label: string
  labelledBy?: string
  text: string
  onChange: ChangeEventHandler<HTMLInputElement>
  autoFocus?: boolean
  invalid?: boolean | 'true' | 'false'
  describedBy?: string
  /** Leaving the field (blur, or Enter on a text that cannot be read) */
  leave: () => void
  /** The text is there but gives no date: Enter is not a save */
  unread: boolean
  disabled?: boolean
}

/** The text input of DateInput and MonthInput: the same attributes, the same leaving rule (see useDateText) */
export function DateTextInput({ inputRef, label, labelledBy, text, onChange, autoFocus, invalid, describedBy, leave, unread, disabled }: DateTextInputProps) {
  return (
    <input ref={inputRef} className="admin-input" inputMode="numeric" aria-label={label} aria-labelledby={labelledBy}
      value={text} onChange={onChange} autoFocus={autoFocus} aria-invalid={invalid} aria-describedby={describedBy} disabled={disabled}
      onBlur={leave} onKeyDown={holdEnter(unread, leave)} />
  )
}
