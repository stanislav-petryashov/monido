import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useMedia } from '../../../lib/media'
import { useFieldError } from './useFieldError'
import { SignButton } from './SignButton'
import { useMaskedInput } from './useMaskedInput'

export interface NumberInputProps {
  /** The input's id: a link or a button elsewhere on the screen focuses it */
  id?: string
  label: string
  /** Canonical text: digits, an optional leading "-" and at most one "." */
  value: string
  onChange: (canonical: string) => void
  /** The decimals kept as typed */
  decimals: number
  /** The value may be negative: a minus is kept, and a touchscreen gets the ± button */
  signed?: boolean
  /** A pasted "12,345" with two decimals is a thousand, not twelve (amounts); typed, a third decimal is dropped */
  guessThousands?: boolean
  /** A suffix inside the field (a currency code, %): shown, and read after the label */
  unit?: string
  /** Drawn on the left inside the field, before the number ("1 USD =") */
  prefix?: string
  /** Under the field: a limit, where the value comes from */
  hint?: ReactNode
  /** Shown in the empty field: what was there last time (Close month: last month's balance) */
  placeholder?: string
  /** A description drawn elsewhere (one note for several fields) */
  describedBy?: string
  autoFocus?: boolean
  submitted?: boolean
  invalid?: boolean
  /** What `invalid` says under the field; by default "not a number" */
  invalidMessage?: string
  /** False: `invalid` marks the field but says nothing under it — the caller says it elsewhere (Close month's list) */
  errorLine?: boolean
  onBlur?: () => void
  /**
   * What Field clones in. Its description (a hint) is read after the field's own; its caption is not used — the field
   * names itself by `label` with its unit ("Loan amount (RUB)"), which the caption alone would lose.
   */
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/**
 * A number typed as text and masked as it is typed: grouped in the UI language, one decimal separator ("," or "."),
 * the decimals cut to `decimals`. No spinner and no wheel, unlike type="number". The decimal keypad has no minus, so a
 * signed field gets it on a touchscreen only together with the ± button; with a mouse the keyboard has a minus.
 */
export function NumberInput({ id, label, value, onChange, decimals, signed = false, guessThousands = false, unit, prefix, hint, placeholder, describedBy, autoFocus, submitted = false, invalid = false, invalidMessage, errorLine = true, onBlur, 'aria-describedby': fieldHint }: NumberInputProps) {
  const { t } = useTranslation()
  const coarse = useMedia('(pointer: coarse)')
  const { ref, display, onChange: onInput, setValue } = useMaskedInput(value, onChange, { decimals, signed, guessThousands })
  const hintId = useId()
  // the hint, a description drawn elsewhere and the Field's hint are all read: an automatic hint must not hide a shared note
  const description = [hint ? hintId : undefined, describedBy, fieldHint].filter(Boolean).join(' ') || undefined
  const { field, error } = useFieldError(invalid && errorLine, invalidMessage ?? t('data.common.notNumber'), description, submitted)
  const signButton = signed && coarse
  // the number starts after the prefix, however wide it is drawn: measured again when its size changes (the web font)
  const prefixRef = useRef<HTMLSpanElement>(null)
  const [prefixWidth, setPrefixWidth] = useState(0)
  useLayoutEffect(() => {
    const span = prefixRef.current
    if (!span) return
    const measure = () => setPrefixWidth(span.offsetWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(span)
    return () => observer.disconnect()
  }, [prefix])
  const input = (
    <input ref={ref} id={id} className="admin-input admin-input--num" inputMode={signed && !coarse ? undefined : 'decimal'}
      aria-label={unit ? `${label} (${unit})` : label} placeholder={placeholder} value={display} onChange={onInput} autoFocus={autoFocus} {...field}
      aria-invalid={invalid || undefined} onBlur={() => { field.onBlur(); onBlur?.() }} />
  )
  const wrapped = unit || prefix || signButton
  const classes = ['input-unit', prefix && 'input-unit--prefixed', signButton && 'input-unit--signed'].filter(Boolean).join(' ')
  return (
    <>
      {wrapped ? (
        <span className={classes} style={prefix ? { '--input-prefix-w': `${prefixWidth}px` } as CSSProperties : undefined}>
          {prefix && <span ref={prefixRef} className="input-unit__prefix" aria-hidden="true">{prefix}</span>}
          {input}
          {(unit || signButton) && (
            <span className="input-unit__end">
              {signButton && <SignButton value={value} onToggle={setValue} />}
              {unit && <span className="input-unit__suffix" aria-hidden="true">{unit}</span>}
            </span>
          )}
        </span>
      ) : input}
      {hint && <div id={hintId} className="field__hint">{hint}</div>}
      {error}
    </>
  )
}
