import { FieldError } from './FieldError'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isoDate, monthEnd, monthOf, monthsBetween, shiftMonth } from '../../../domain/dates'
import { fmtMonths, fmtYears } from '../../../lib/formatters'
import { showDate } from '../dateMask'
import { DateTextInput } from './DateTextInput'
import { datePatternHint, dateProblem, useDateText } from './useDateText'
import { useFieldError } from './useFieldError'

interface MonthInputProps {
  label: string
  invalid?: boolean
  /** A stored ISO date (any day of its month), or '' */
  value: string
  /** The stored day while the month is the one stored, else the last day of the chosen month; '' for an empty field, UNREAD_DATE while the month is incomplete or does not exist */
  onChange: (iso: string) => void
  /** Buttons under the field: that many years from today */
  chips?: number[]
  /** The field takes finished months only (totals of a month that is over): a passed month needs no note, this month or a later one is the error */
  finished?: boolean
  autoFocus?: boolean
  disabled?: boolean
  /** What Field clones in: the caption and the description of the control */
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/** Months from now as words: "5 years 2 mo" */
function span(months: number): string {
  const years = Math.floor(months / 12)
  return [years > 0 && fmtYears(years), months % 12 > 0 && fmtMonths(months % 12)].filter(Boolean).join(' ')
}

/**
 * A month typed as digits (12.2030, 12/2030), masked like DateInput. Under it: how far the month is from today (UTC),
 * that it is this month, or — in the error tone — that it has passed (with `finished`: only that a month is not over yet);
 * the pattern while it is incomplete. Enter on an
 * unfinished month saves nothing and says how to finish it. `chips` set the month that many years ahead in one tap.
 */
export function MonthInput({ label, invalid: externalInvalid = false, value, onChange, chips = [], finished = false, autoFocus, disabled, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy }: MonthInputProps) {
  const { t } = useTranslation()
  // the day stored before the edit: retyping the same month keeps it
  const [stored] = useState(value)
  const { locale, ref, text, read, unread, problem, onChange: onInput, complete, set } = useDateText(value, onChange, 'my', ym => (monthOf(stored) === ym ? stored : monthEnd(ym)))
  const { field, error } = useFieldError(problem !== null, problem ? dateProblem(problem, 'my', locale) : '')
  const leave = () => { field.onBlur(); complete() }
  const noteId = useId()
  const today = monthOf(isoDate(new Date()))
  const ahead = read && read !== 'invalid' ? monthsBetween(today, read) : null
  // the error tone: a passed deadline, or a month that is not over in a field of finished months
  const wrong = ahead !== null && (finished ? ahead >= 0 : ahead < 0)
  const note = error ? null
    : ahead === null ? datePatternHint('my', locale)
    : finished ? (wrong ? t('data.common.monthNotFinished') : null)
    : ahead < 0 ? t('data.common.monthPassed')
    : ahead === 0 ? t('data.common.thisMonth')
    : t('data.common.untilMonth', { value: span(ahead) })
  const description = [note ? noteId : undefined, field['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined
  return (
    <>
      <DateTextInput inputRef={ref} label={label} labelledBy={labelledBy} text={text} onChange={onInput} autoFocus={autoFocus}
        invalid={field['aria-invalid'] || externalInvalid || undefined} describedBy={description} leave={leave} unread={unread} disabled={disabled} />
      {note && (wrong ? <FieldError id={noteId}>{note}</FieldError> : <div id={noteId} className="field__hint">{note}</div>)}
      {error}
      {chips.length > 0 && (
        <div className="month-chips">
          {chips.map(years => (
            <button key={years} type="button" className="btn btn--ghost"
              onClick={() => set(showDate(shiftMonth(today, 12 * years), locale, 'my'))}>
              {t('data.common.inYears', { count: years })}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
