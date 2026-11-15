import { useId } from 'react'
import { Select } from './Select'
import { isOptionGroup } from './optionGroup'

type Option<T extends string> = { value: T; label: string }

type Props<T extends string> = {
  options: readonly Option<T>[]
  value: T
  onChange: (value: T) => void
  'aria-labelledby'?: string
  /** The group's own name, where no Field caption names it (TermInput's years / months) */
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  onBlur?: () => void
  disabled?: boolean
}

/**
 * A short choice: up to four options are a segmented control of real radios (arrow keys move the choice natively; the
 * group is named and described by Field), more options are a Select. A long label wraps onto a second line.
 */
export function OptionPicker<T extends string>({ options, value, onChange, disabled, ...aria }: Props<T>) {
  const groupName = useId()
  if (!isOptionGroup(options.length)) {
    return (
      <Select {...aria} disabled={disabled} value={value} onChange={e => onChange(e.target.value as T)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    )
  }
  return (
    <div className="option-picker" role="radiogroup" tabIndex={aria['aria-invalid'] ? -1 : undefined} {...aria}>
      {options.map(o => (
        <label key={o.value} className="option-picker__option">
          <input type="radio" className="option-picker__input" name={groupName} value={o.value}
            checked={o.value === value} disabled={disabled} onChange={() => onChange(o.value)} />
          <span className="option-picker__text">{o.label}</span>
        </label>
      ))}
    </div>
  )
}
