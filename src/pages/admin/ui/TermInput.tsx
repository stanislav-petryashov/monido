import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fmtMonths, fmtYears } from '../../../lib/formatters'
import { NumberInput } from './NumberInput'
import { OptionPicker } from './OptionPicker'

type Unit = 'years' | 'months'

interface TermInputProps {
  label: string
  submitted?: boolean
  invalid?: boolean
  invalidMessage?: string
  /** Canonical month count ("246"), '' when not set; `onChange` gets the same */
  value: string
  onChange: (months: string) => void
  /** Field's caption: it names the whole control (the number and its years / months switch) */
  'aria-labelledby'?: string
}

/** Years as the field shows them: two decimals at most ("1.08"), which always give the same months back; '' for no term */
const yearsOf = (months: string): string => (months === '' ? '' : String(Number((Number(months) / 12).toFixed(2))))

/** Typed years as a month count: 20.5 → "246"; '' for nothing typed */
const monthsOf = (years: string): string => (years === '' ? '' : String(Math.round(Number(years) * 12)))

/** A term opens in years when it is a whole number of them (or not set yet), else in months */
const startUnit = (months: string): Unit => (months === '' || (Number(months) >= 12 && Number(months) % 12 === 0) ? 'years' : 'months')

/**
 * A term in months, typed in years or in months: a NumberInput (years with two decimals, months whole) and a "Years /
 * Months" OptionPicker under it. The value in and out is always a month count; under the field the term in the other
 * unit ("246 mo", "20 years 6 mo"). The Field around it is a `group`: its caption must not be a label around the radios;
 * it names the control's own `role="group"` instead, so the switch is announced within the term.
 */
export function TermInput({ label, value, onChange, submitted, invalid, invalidMessage, 'aria-labelledby': labelledBy }: TermInputProps) {
  const { t } = useTranslation()
  const hintId = useId()
  const [unit, setUnit] = useState<Unit>(() => startUnit(value))
  // the years as typed ("20." while typing): kept while they still give the value, else the value's own years
  const [typedYears, setTypedYears] = useState(() => yearsOf(value))
  const years = monthsOf(typedYears) === value ? typedYears : yearsOf(value)
  const months = value === '' ? null : Number(value)

  let hint: string | undefined
  if (months !== null && unit === 'years') hint = fmtMonths(months)
  if (months !== null && unit === 'months' && months >= 12) {
    const rest = months % 12
    hint = [fmtYears(Math.floor(months / 12)), rest ? fmtMonths(rest) : ''].filter(Boolean).join(' ')
  }

  const switchUnit = (next: Unit) => {
    if (next === 'years') setTypedYears(yearsOf(value))
    setUnit(next)
  }
  const typeYears = (text: string) => {
    setTypedYears(text)
    onChange(monthsOf(text))
  }

  return (
    <div className="term-input" role="group" aria-labelledby={labelledBy}>
      <NumberInput label={label} value={unit === 'years' ? years : value} onChange={unit === 'years' ? typeYears : onChange}
        decimals={unit === 'years' ? 2 : 0} submitted={submitted} invalid={invalid} invalidMessage={invalidMessage} describedBy={hint ? hintId : undefined} />
      <OptionPicker aria-label={t('data.common.termUnit')} value={unit} onChange={switchUnit}
        options={[{ value: 'years', label: t('data.common.termYears') }, { value: 'months', label: t('data.common.termMonths') }]} />
      {hint && <div id={hintId} className="field__hint">{hint}</div>}
    </div>
  )
}
