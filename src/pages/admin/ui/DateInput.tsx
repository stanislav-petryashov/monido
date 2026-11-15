import { useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCalendar } from '@tabler/icons-react'
import { fmtDayLong } from '../../../lib/formatters'
import { showDate } from '../dateMask'
import { DateTextInput } from './DateTextInput'
import { datePatternHint, dateProblem, useDateText } from './useDateText'
import { useFieldError } from './useFieldError'

interface DateInputProps {
  label: string
  /** ISO 'YYYY-MM-DD', or '' — `onChange` gets the same, or UNREAD_DATE while the typed date is incomplete or does not exist */
  value: string
  onChange: (iso: string) => void
  /** Under the field, after the date in words */
  hint?: ReactNode
  autoFocus?: boolean
  requiredMessage?: string
  submitted?: boolean
  /** What Field clones in: the caption and the description of the control */
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/**
 * A calendar date typed as digits, masked in the UI language's order (15.03.2014, 03/15/2014); a two-digit year is read
 * at once and written out on leaving. Under it: the date in words with its weekday, the pattern while it is incomplete,
 * or — once the field is left, or Enter is pressed on it — what is wrong. Enter on such a date saves nothing. Where the
 * browser can open its date picker, a calendar button does.
 */
export function DateInput({ label, value, onChange, hint, autoFocus, requiredMessage, submitted = false, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy }: DateInputProps) {
  const { t } = useTranslation()
  const { locale, ref, text, read, unread, problem, onChange: onInput, complete, set } = useDateText(value, onChange, 'dmy', iso => iso)
  const { field, error } = useFieldError(problem !== null || (submitted && !!requiredMessage && (!value || unread)), problem ? dateProblem(problem, 'dmy', locale) : unread ? dateProblem('incomplete', 'dmy', locale) : requiredMessage ?? '', undefined, submitted)
  const leave = () => { field.onBlur(); complete() }
  const picker = useRef<HTMLInputElement>(null)
  const [pickerFailed, setPickerFailed] = useState(false)
  const canPick = !pickerFailed && 'showPicker' in HTMLInputElement.prototype
  const noteId = useId()
  const hintId = useId()
  const note = error ? null : read && read !== 'invalid' ? fmtDayLong(read) : datePatternHint('dmy', locale)
  const description = [note ? noteId : undefined, hint ? hintId : undefined, field['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined

  const openPicker = () => {
    try {
      picker.current?.showPicker()
    } catch {
      setPickerFailed(true)
    }
  }
  const input = (
    <DateTextInput inputRef={ref} label={label} labelledBy={labelledBy} text={text} onChange={onInput} autoFocus={autoFocus}
      invalid={field['aria-invalid']} describedBy={description} leave={leave} unread={unread} />
  )
  return (
    <>
      {canPick ? (
        <span className="input-unit input-unit--picker">
          {input}
          <span className="input-unit__end">
            <button type="button" className="input-btn" aria-label={t('data.common.openCalendar')} onClick={openPicker}>
              <IconCalendar size={16} stroke={2} aria-hidden="true" />
            </button>
          </span>
          <input ref={picker} type="date" className="input-unit__picker" tabIndex={-1} aria-hidden="true" value={read && read !== 'invalid' ? read : ''}
            onChange={e => set(showDate(e.target.value, locale, 'dmy'))} />
        </span>
      ) : input}
      {note && <div id={noteId} className="field__hint">{note}</div>}
      {hint && <div id={hintId} className="field__hint">{hint}</div>}
      {error}
    </>
  )
}
