import { useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { t } from '../../../i18n/client'
import { currentDatePattern } from '../../../lib/dateFormat'
import { useRestoredCaret } from './useRestoredCaret'
import { completeYear, datePattern, maskDate, readDate, readMonth, showDate, UNREAD_DATE } from '../dateMask'

type Parts = 'dmy' | 'my'

/** The caret position in `display` with `after` digits to its right: the digits after the caret keep their place. */
function caretBefore(display: string, after: number): number {
  let i = display.length
  for (let seen = 0; i > 0 && seen < after; i--) if (/\d/.test(display[i - 1])) seen++
  return i
}

/** "DD.MM.YYYY" — the parts in the UI language's order and with its separator; `parts` 'my' leaves the day out. */
function patternOf(parts: Parts, locale: string): string {
  const { order, sep } = datePattern(locale)
  return order.filter(p => parts === 'dmy' || p !== 'd').map(p => t(`data.common.datePart.${p}`)).join(sep)
}

/** "Digits only: DD.MM.YYYY", the hint under an empty or unfinished field */
export function datePatternHint(parts: Parts, locale = currentDatePattern()): string {
  return t('data.common.datePattern', { pattern: patternOf(parts, locale) })
}

/** What is wrong with the text, said under the field once it is left: a day or month that does not exist, or a text cut short */
export function dateProblem(problem: 'invalid' | 'incomplete', parts: Parts, locale = currentDatePattern()): string {
  if (problem === 'incomplete') return t('data.common.dateIncomplete', { pattern: patternOf(parts, locale) })
  return t(parts === 'dmy' ? 'data.common.noSuchDate' : 'data.common.noSuchMonth')
}

/**
 * An onKeyDown for a date or month field: Enter while its text cannot be read is not a save (the form's, the table
 * row's) — the field is taken as left instead, so that it says what is wrong.
 */
export const holdEnter = (unread: boolean, leave: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter' && unread && !e.nativeEvent.isComposing) { e.preventDefault(); leave() }
}

/**
 * The text of a date or month field, masked as it is typed (dateMask): `value` is ISO, the field shows it in the UI
 * language's order. Each edit is read back, a two-digit year as its four ("05.03.14" is 5 March 2014 at once):
 * `onChange` gets `toValue(read)` for a complete, real date or month, '' for an empty text and UNREAD_DATE for any other
 * (so a half edit never erases a stored date). A value from outside replaces the text unless it is the one the text
 * gave. `complete` (on leaving the field) writes the year out; `set` puts a display in, as typed. The digits after the
 * caret keep their place; Backspace or Delete on a separator the mask would put back removes the digit beyond it.
 * `unread` — the text is there but gives no date. `problem`: 'invalid' — no such day or month; 'incomplete' — a text
 * cut short ("15.03"), counted once the field is left and until it is typed in again.
 */
export function useDateText(value: string, onChange: (iso: string) => void, parts: Parts, toValue: (read: string) => string) {
  const preferred = currentDatePattern()
  const [shownLocale, setShownLocale] = useState(preferred)
  // Do not reinterpret an unfinished draft when the shared preference changes.
  const locale = value === UNREAD_DATE ? shownLocale : preferred
  const { ref, caretRef } = useRestoredCaret()
  const [text, setText] = useState(() => showDate(value, locale, parts))
  const [gave, setGave] = useState(value)
  const [left, setLeft] = useState(false)
  if (value !== gave || (locale !== shownLocale && value !== UNREAD_DATE)) {
    setShownLocale(locale)
    setGave(value)
    setText(showDate(value, locale, parts))
  }
  const readText = (shown: string) => {
    const full = completeYear(shown, locale, new Date(), parts)
    return parts === 'dmy' ? readDate(full, locale) : readMonth(full, locale)
  }
  const read = readText(text)
  const unread = text !== '' && (read === null || read === 'invalid')

  const set = (next: string) => {
    setText(next)
    const r = readText(next)
    const out = next === '' ? '' : r === null || r === 'invalid' ? UNREAD_DATE : toValue(r)
    setGave(out)
    if (out !== value) onChange(out)
  }
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value
    let at = e.target.selectionStart ?? raw.length
    // an ISO text ("2014-03-15") becomes a date only whole, as a paste brings it: typed, the "-" is a separator
    let next = maskDate(raw, locale, raw.length > text.length, parts)
    if (next === text && raw.length < text.length) {
      // a deleted separator the mask would put straight back: the digit beyond it goes instead
      if ((e.nativeEvent as InputEvent).inputType === 'deleteContentForward') raw = raw.slice(0, at) + raw.slice(at).replace(/\d/, '')
      else {
        const digit = raw.slice(0, at).search(/\d\D*$/)
        if (digit >= 0) { raw = raw.slice(0, digit) + raw.slice(digit + 1); at = digit }
      }
      next = maskDate(raw, locale, false, parts)
    }
    caretRef.current = caretBefore(next, raw.slice(at).replace(/\D/g, '').length)
    // typing again: "finish the date" waits for the next leaving
    setLeft(false)
    set(next)
  }
  const complete = () => {
    setLeft(true)
    const next = completeYear(text, locale, new Date(), parts)
    if (next !== text) set(next)
  }
  const problem: 'invalid' | 'incomplete' | null = read === 'invalid' ? 'invalid' : read === null && text !== '' && left ? 'incomplete' : null
  return { locale, ref, text, read, unread, problem, onChange: handleChange, complete, set }
}
