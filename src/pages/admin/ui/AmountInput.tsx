import type { ReactNode } from 'react'
import { usePrivacy } from '../../../lib/privacy'
import { compactHint, parseAmount } from '../amount'
import { NumberInput, type NumberInputProps } from './NumberInput'

interface AmountInputProps extends Pick<NumberInputProps, 'aria-labelledby' | 'aria-describedby'> {
  label: string
  invalid?: boolean
  errorLine?: boolean
  submitted?: boolean
  invalidMessage?: string
  /** Canonical text ("-1250.5"); `onChange` gets the same, read by parseAmount and readAmounts as before */
  value: string
  onChange: (text: string) => void
  /** Under the field: a limit, where the value comes from. Without it a large amount is repeated in short ("12.5M ₽") */
  hint?: ReactNode
  /** A description drawn elsewhere (one note for several fields) */
  describedBy?: string
  autoFocus?: boolean
  /** A suffix inside the field (a currency code): shown, and read after the label */
  unit?: string
  /** The value may be negative (a balance) */
  signed?: boolean
  /** Shown while empty: a value to compare with (the last valuation), not an example */
  placeholder?: string
}

/**
 * An amount: a NumberInput with two decimals, grouped while typed, where "12,345" is a thousand. A large amount is
 * repeated under the field in short, in its currency when the unit is one; not in privacy mode.
 */
export function AmountInput({ label, invalid: externalInvalid = false, value, onChange, hint, describedBy, autoFocus, unit, signed, placeholder, submitted, invalidMessage, errorLine, 'aria-describedby': fieldHint }: AmountInputProps) {
  const { hidden } = usePrivacy()
  const { value: amount, invalid } = parseAmount(value)
  const compact = compactHint(amount, unit, hidden)
  return (
    <NumberInput label={label} value={value} onChange={onChange} decimals={2} guessThousands signed={signed} unit={unit}
      hint={hint ?? compact} placeholder={placeholder} describedBy={describedBy} aria-describedby={fieldHint} autoFocus={autoFocus} invalid={invalid || externalInvalid} submitted={submitted} invalidMessage={invalidMessage} errorLine={errorLine ?? !externalInvalid} />
  )
}
