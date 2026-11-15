import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { usePopover } from '../../../components/ui/usePopover'
import { currencyMatches } from '../../../lib/currencyNames'
import { useFieldError } from './useFieldError'
import { useSingleFlight } from '../useSingleFlight'

/** A currency code: three Latin letters, as ISO 4217 and Frankfurter name it */
const CURRENCY_CODE = /^[A-Z]{3}$/

interface CurrencyComboboxProps {
  /** The list's name: the field is "<label>: add" */
  label: string
  inputLabel?: string
  /** The family's currencies: not offered again */
  exclude: readonly string[]
  /** Adds the code; a promise that resolves to false (the write failed) keeps the typed text in the field */
  onPick: (code: string) => void | Promise<boolean>
}

/**
 * The currency field of Parameters: a code or a name in the UI language or in English finds the currency (a combobox with
 * a listbox under it, the active option through aria-activedescendant). ↑/↓ move, Enter picks the active option or adds a
 * typed three-letter code the list does not have; three letters that are a name ("yen", "won") are not a code to add —
 * Enter marks the first match instead, a second Enter picks it. Escape and a click outside close the list. A text that
 * finds nothing and is not a code says so in the hint and, once the field is left, in the error. One add at a time: while
 * one is being written, Enter, "+ Add" and the list do nothing.
 */
export function CurrencyCombobox({ label, inputLabel, exclude, onPick }: CurrencyComboboxProps) {
  const { t, i18n } = useTranslation()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  /** An add is being written (`onPick`'s promise); the ref answers within the same tick, the state redraws the button */
  const [runAdd, adding, isAdding] = useSingleFlight()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const hintId = useId()

  const matches = currencyMatches(text, i18n.language, exclude)
  const code = text.trim().toUpperCase()
  const isCode = CURRENCY_CODE.test(code)
  // a code the list does not know, or knows first; not a family currency, not three letters of a name ("yen" is JPY)
  const canAdd = isCode && !exclude.includes(code) && (matches.length === 0 || matches[0].code === code)
  const nothing = text.trim() !== '' && matches.length === 0 && !isCode
  const expanded = open && matches.length > 0
  const { field, error } = useFieldError(nothing, t('data.params.currencyCode'), hintId)

  const close = () => { setOpen(false); setActive(-1) }
  usePopover({ open: expanded, onClose: close, trigger: inputRef, inside: [rootRef] })

  const optionId = (i: number) => `${listId}-${matches[i].code}`

  function pick(next: string) {
    if (isAdding()) return
    close()
    const typed = text
    // cleared only after a success, and only if nothing new was typed while the write ran
    const clear = () => setText(current => current === typed ? '' : current)
    const result = onPick(next)
    if (result === undefined) { clear(); return }
    void runAdd(async () => { if (await result) clear() })
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (matches.length === 0) return
      e.preventDefault()
      setOpen(true)
      const last = matches.length - 1
      setActive(i => e.key === 'ArrowDown' ? (i >= last ? 0 : i + 1) : (i <= 0 ? last : i - 1))
    } else if (e.key === 'Enter') {
      if (expanded && active >= 0) pick(matches[active].code)
      else if (canAdd) pick(code)
      else if (isCode && matches.length > 0) { setOpen(true); setActive(0) }
    }
  }

  return (
    <div className="currency-combo" ref={rootRef}>
      <div className="currency-combo__row">
        <div className="currency-combo__field">
          <label className={inputLabel ? 'field field--inset' : undefined}>
            {inputLabel && <span className="field__label">{inputLabel}</span>}
          <input ref={inputRef} className="admin-input tag-list__input" role="combobox" aria-label={inputLabel ?? t('data.common.addTo', { label })}
            aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId}
            aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
            placeholder={inputLabel ? t('data.params.currencySearchShort') : undefined} autoComplete="off" spellCheck={false} {...field}
            onBlur={() => { field.onBlur(); close() }}
            value={text} onChange={e => { setText(e.target.value); setOpen(true); setActive(-1) }} onKeyDown={onKeyDown} />
          </label>
          <ul id={listId} className="currency-combo__list" role="listbox" aria-label={label} hidden={!expanded}>
            {expanded && matches.map((m, i) => (
              <li key={m.code} id={optionId(i)} role="option" aria-selected={i === active} className="currency-combo__option"
                // the focus stays in the field, so the list does not close on the field's blur before the click
                onMouseDown={e => e.preventDefault()} onClick={() => pick(m.code)}>
                <span className="currency-combo__code">{m.code}</span> {m.name}
              </li>
            ))}
          </ul>
        </div>
        <button type="button" className="btn btn--ghost" disabled={!canAdd || adding} onClick={() => pick(code)}>{t('data.common.addTag')}</button>
      </div>
      <span id={hintId} className="field__hint" aria-live="polite" hidden={!!inputLabel && !nothing}>{nothing ? t('data.params.currencyNone') : inputLabel ? null : t('data.params.currencySearch')}</span>
      {error}
    </div>
  )
}
