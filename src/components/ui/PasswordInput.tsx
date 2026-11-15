import { createElement, useState } from 'react'
import { IconEye, IconEyeOff } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

export interface PasswordInputProps {
  value: string
  onChange: (value: string) => void
  invalid: boolean
  autoComplete?: 'current-password' | 'new-password'
  autoFocus?: boolean
  /** Set by Field (the hint) and by the screen (the error) */
  'aria-describedby'?: string
  /** Set by Field: the caption alone names the input, not the eye inside the same <label> */
  'aria-labelledby'?: string
}

/**
 * The password with an eye that shows it (NIST SP 800-63B-4: offer to show it; paste and password managers stay allowed).
 * The button sits inside the field's <label>; Field's aria-labelledby keeps its "Show password" out of the input's name.
 */
export function PasswordInput({
  value, onChange, invalid, autoComplete = 'current-password', autoFocus = false,
  'aria-describedby': describedBy, 'aria-labelledby': labelledBy,
}: PasswordInputProps) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)
  return (
    <span className="password-field">
      <input
        type={shown ? 'text' : 'password'} className="admin-input" autoComplete={autoComplete} autoFocus={autoFocus} spellCheck={false}
        aria-labelledby={labelledBy} aria-describedby={describedBy} aria-invalid={invalid || undefined} value={value} onChange={e => onChange(e.target.value)}
      />
      <button type="button" className="password-field__toggle" aria-label={t('auth.showPassword')} aria-pressed={shown} onClick={() => setShown(s => !s)}>
        {createElement(shown ? IconEyeOff : IconEye, { size: 18, stroke: 1.75, 'aria-hidden': true })}
      </button>
    </span>
  )
}
