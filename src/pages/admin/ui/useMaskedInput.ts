import { useReducer, useRef, type ChangeEvent, type ChangeEventHandler, type RefObject } from 'react'
import { currentLanguage } from '../../../i18n/client'
import { useRestoredCaret } from './useRestoredCaret'
import { caretAt, maskNumber, numberSymbols, showNumber, significantBefore, type MaskOptions } from '../numberMask'

/**
 * A number field masked as it is typed: `value` is canonical text ("-1250.5"), the field shows it grouped in the UI
 * language ("−1 250,5"), and every edit is masked back to canonical text for `onChange`. A prefilled value is only shown,
 * never re-masked until the user types ("1234.1250" from amountText stays). The caret keeps its place among the digits.
 * `guessThousands` applies to pasted text only (isPaste). Typed, the language's decimal symbol keeps at most two decimals
 * ("1.000" in en-US is "1.00"), while its group symbol, when it is "," or ".", is a decimal only until a third digit
 * follows it: that digit makes it the grouping, as the field shows it ("12,500" in en-US, "12.500" in de-DE, is twelve
 * thousand five hundred; "12,50" stays 12.50). Typed before three digits already there, the group symbol changes nothing.
 * Backspace right after a group separator (Delete right before one) removes the digit beyond it, not only moves the caret.
 */
export function useMaskedInput(value: string, onChange: (canonical: string) => void, opts: MaskOptions): {
  ref: RefObject<HTMLInputElement | null>
  display: string
  onChange: ChangeEventHandler<HTMLInputElement>
  setValue: (canonical: string) => void
} {
  const { ref, caretRef } = useRestoredCaret()
  // a masked edit that gives the same canonical text still re-renders: React puts the shown text back, the caret follows
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const locale = currentLanguage()
  const display = showNumber(value, locale)
  const { group } = numberSymbols(locale)
  const groupIsMark = group === ',' || group === '.'
  // the canonical value whose decimal was opened by the typed group symbol: valid only while `value` is still that text
  const groupDecimal = useRef<string | null>(null)

  const commit = (next: string, significant: number | null, byGroup = false) => {
    groupDecimal.current = byGroup && next.includes('.') ? next : null
    if (significant !== null) caretRef.current = caretAt(showNumber(next, locale), significant, locale)
    rerender()
    if (next !== value) onChange(next)
  }

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    const inputType = (e.nativeEvent as InputEvent).inputType ?? ''
    // the kept text is the old display, whose group symbol may be "," (en-US): only the inserted part is read as typed
    let start = 0
    while (start < display.length && start < raw.length && display[start] === raw[start]) start++
    let end = 0
    while (end < display.length - start && end < raw.length - start && display[display.length - 1 - end] === raw[raw.length - 1 - end]) end++
    const before = toCanonical(display.slice(0, start), locale)
    const inserted = raw.slice(start, raw.length - end)
    const after = toCanonical(display.slice(display.length - end), locale)
    const pasted = isPaste(inputType, inserted)
    // the thousands guess is for a paste only ("1.250" from a statement): while typing, a third decimal is dropped
    const mask = (text: string) => maskNumber(text, pasted ? opts : { ...opts, guessThousands: false }, pasted)
    const typedGroup = !pasted && groupIsMark && inserted === group && opts.decimals === 2
    if (typedGroup && /^\d{3}/.test(after)) {
      // the group symbol before three digits is where the field already groups: as a decimal it would cut them
      commit(value, significantBefore(before, before.length))
      return
    }
    const next = mask(before + inserted + after)
    if (inserted === '' && raw.length < display.length && next === value) {
      // a deleted group separator would come straight back: the digit beyond it goes instead
      const forward = inputType === 'deleteContentForward'
      const kept = forward ? before : dropDigit(before, 'last')
      commit(mask(kept + (forward ? dropDigit(after, 'first') : after)), significantBefore(kept, kept.length))
      return
    }
    const at = e.target.selectionStart ?? raw.length
    const typedBefore = caretText(raw, at, start, before, inserted, end, locale)
    const byGroup = !pasted && (groupDecimal.current === value || (typedGroup && !value.includes('.')))
    const joined = byGroup ? thirdDigitJoin(before + inserted + after) : null
    if (joined !== null) {
      const caretDigits = typedBefore.replace('.', '')
      commit(mask(joined), significantBefore(caretDigits, caretDigits.length))
      return
    }
    commit(next, significantBefore(typedBefore, typedBefore.length), byGroup)
  }

  const setValue = (canonical: string) => {
    const input = ref.current
    const focused = input !== null && input.ownerDocument.activeElement === input
    commit(canonical, focused ? significantBefore(display, input.selectionStart ?? display.length, locale) : null)
  }

  return { ref, display, onChange: handleChange, setValue }
}

/**
 * Whether an edit brought text from elsewhere, read like a paste (a repeated separator is grouping, "12,345" may be a
 * thousand): a paste, a drop or any other insertFrom*, a replacement (autocorrect, a suggestion), and more than one
 * character at once — a keyboard types one at a time, while a phone's clipboard chip commits its text as insertText.
 */
function isPaste(inputType: string, inserted: string): boolean {
  return inputType.startsWith('insertFrom') || inputType === 'insertReplacementText' || [...inserted].length > 1
}

/**
 * Canonical-ish `text` ("12.500") with its decimal point removed when exactly three digits follow it and the whole part
 * is not zero: a decimal opened by the group symbol that just got its third digit is the grouping. Otherwise null.
 */
function thirdDigitJoin(text: string): string | null {
  const dot = text.indexOf('.')
  if (dot < 0) return null
  const whole = text.slice(0, dot)
  const fraction = text.slice(dot + 1)
  return /^\d{3}$/.test(fraction) && /[1-9]/.test(whole) ? whole + fraction : null
}

/** `text` without its first or last digit (none to drop: as it is). */
function dropDigit(text: string, which: 'first' | 'last'): string {
  const at = which === 'first' ? text.search(/\d/) : text.length - 1 - [...text].reverse().findIndex(ch => /\d/.test(ch))
  return at < 0 || at >= text.length ? text : text.slice(0, at) + text.slice(at + 1)
}

/** Shown text as canonical: the locale's group symbol dropped, its decimal a ".", the minus a "-". */
function toCanonical(shown: string, locale: string): string {
  const { group, decimal } = numberSymbols(locale)
  let out = ''
  for (const ch of shown) {
    if (ch === group) continue
    out += ch === decimal ? '.' : ch === '−' ? '-' : ch
  }
  return out
}

/** The new text up to the caret, its kept parts as canonical: so that only a typed "." or "," counts as a decimal. */
function caretText(raw: string, at: number, start: number, before: string, inserted: string, end: number, locale: string): string {
  if (at <= start) return toCanonical(raw.slice(0, at), locale)
  const insertedEnd = raw.length - end
  if (at <= insertedEnd) return before + inserted.slice(0, at - start)
  return before + inserted + toCanonical(raw.slice(insertedEnd, at), locale)
}
