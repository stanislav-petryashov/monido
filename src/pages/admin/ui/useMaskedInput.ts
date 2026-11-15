import { useReducer, type ChangeEvent, type ChangeEventHandler, type RefObject } from 'react'
import { currentLanguage } from '../../../i18n/client'
import { useRestoredCaret } from './useRestoredCaret'
import { caretAt, maskNumber, numberSymbols, showNumber, significantBefore, type MaskOptions } from '../numberMask'

/**
 * A number field masked as it is typed: `value` is canonical text ("-1250.5"), the field shows it grouped in the UI
 * language ("−1 250,5"), and every edit is masked back to canonical text for `onChange`. A prefilled value is only shown,
 * never re-masked until the user types ("1234.1250" from amountText stays). The caret keeps its place among the digits.
 * `guessThousands` applies to pasted text only (isPaste): typed, "1.000" is "1.00", never a thousand. Backspace right after
 * a group separator (Delete right before one) removes the digit beyond it, not only moves the caret.
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

  const commit = (next: string, significant: number | null) => {
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
    commit(next, significantBefore(typedBefore, typedBefore.length))
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
