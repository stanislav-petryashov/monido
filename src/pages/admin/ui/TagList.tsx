import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconX } from '@tabler/icons-react'
import { useFieldError } from './useFieldError'
import { useSingleFlight } from '../useSingleFlight'

interface TagListBase {
  label: string
  /** `fixed`: this tag has no "×" while the others keep theirs (the wizard's members, the family currency) */
  tags: { key: string | number; text: string; note?: string; fixed?: boolean }[]
  /** A promise keeps every "×" off until it settles: a double click does not delete a row that is already gone */
  onRemove: (key: string | number) => void | Promise<unknown>
  /** Someone without the right to edit: the tags only, no "×", no field */
  readOnly?: boolean
}

/** The built-in field and "+ Add" button */
interface TagListField extends TagListBase {
  inputLabel?: string
  value: string
  onChange: (value: string) => void
  onAdd: () => void
  placeholder: string
  /** The field's text cannot be added: the field is marked, the button is off and `invalidMessage` says why */
  invalid?: boolean
  invalidMessage?: string
}

/** A control of the caller's own in place of the field and the button (the currency search) */
interface TagListAdder extends TagListBase {
  adder: ReactNode
}

type TagListProps = TagListField | TagListAdder

/** A reference list as tags: "×" removes, the field and the button add — or the `adder` given in their place. */
export function TagList(props: TagListProps) {
  const { label, tags, onRemove, readOnly = false } = props
  const { t } = useTranslation()
  const adder = 'adder' in props ? props.adder : null
  const own = 'adder' in props ? null : props
  const { field, error } = useFieldError(own?.invalid ?? false, own?.invalidMessage ?? '')
  const [runRemove, removing] = useSingleFlight()
  return (
    <>
    <div className="tag-list">
      {tags.map(tag => (
        <span key={tag.key} className={`tag${readOnly || tag.fixed ? ' tag--fixed' : ''}`}>
          {tag.text}
          {tag.note && <small className="tag__note">{tag.note}</small>}
          {!readOnly && !tag.fixed && <button type="button" className="tag__remove" aria-label={t('data.common.removeNamed', { name: tag.text })} disabled={removing}
            onClick={() => void runRemove(async () => { await onRemove(tag.key) })}>
            <IconX size={14} stroke={2} aria-hidden="true" />
          </button>}
        </span>
      ))}
      {!readOnly && (
        <div className="tag-list__add">
          {own ? <>
            <label className={own.inputLabel ? 'field field--inset' : 'tag-list__field'}>
              {own.inputLabel && <span className="field__label">{own.inputLabel}</span>}
            <input className="admin-input tag-list__input" aria-label={own.inputLabel ?? t('data.common.addTo', { label })} placeholder={own.inputLabel ? undefined : own.placeholder}
              {...field} value={own.value} onChange={e => own.onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') own.onAdd() }} />
            </label>
            <button type="button" className="btn btn--ghost" disabled={own.invalid} onClick={own.onAdd}>{t('data.common.addTag')}</button>
          </> : adder}
        </div>
      )}
    </div>
    {error}
    </>
  )
}
