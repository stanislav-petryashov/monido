import { FieldError } from './FieldError'
import { cloneElement, useId, type ReactElement, type ReactNode } from 'react'
import '../../../styles/controls.css'

type Control = ReactElement<{ 'aria-describedby'?: string, 'aria-labelledby'?: string }>

/**
 * A form field: the caption above the control, tied to it through <label> and aria-labelledby — the latter keeps the name
 * to the caption when the label also holds a button (the password's eye). A unit (%, mo, a currency code) sits in the
 * field as a visible suffix and is read after the caption ("Rate (%)"). A hint (an example, where a value comes from)
 * goes under the control and is read with it through aria-describedby — not in a placeholder, which vanishes as one types.
 * `group` — the control is an OptionPicker (a group of radios): it is not inside a <label>, which would pass a click on the
 * caption to the first option; the caption names the group through aria-labelledby.
 */
interface FieldProps {
  label: string
  hint?: ReactNode
  unit?: string
  group?: boolean
  variant?: 'standard' | 'inset' | 'comfortable'
  /** Keep the feedback slot mounted, including while the message is absent. */
  error?: string
  children: Control
}

export function Field(props: FieldProps) {
  const { label, hint, unit, group = false, variant = 'standard', error, children } = props
  const labelId = useId()
  const hintId = useId()
  // the control's own description (an error) stays: the hint is added to it
  const describedBy = [hint || error ? hintId : undefined, children.props['aria-describedby']].filter(Boolean).join(' ') || undefined
  const Wrapper = group ? 'div' : 'label'
  const control = (
    <Wrapper className={variant === 'standard' || (group && variant === 'inset') ? 'field' : `field field--${variant}`}>
      <span id={labelId} className="field__label">{label}{unit && <>{' '}<span className="sr-only">({unit})</span></>}</span>
      {unit ? (
        <span className="input-unit">
          {cloneElement(children, { 'aria-labelledby': labelId, 'aria-describedby': describedBy })}
          <span className="input-unit__suffix" aria-hidden="true">{unit}</span>
        </span>
      ) : cloneElement(children, { 'aria-labelledby': labelId, 'aria-describedby': describedBy })}
    </Wrapper>
  )
  if (!hint && !('error' in props)) return control
  return (
    <div className="field">
      {control}
      <span id={hintId} className="field__hint">{error ? <FieldError>{error}</FieldError> : hint}</span>
    </div>
  )
}
