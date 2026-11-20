import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { AmountInput } from '../../../pages/admin/ui/AmountInput'
import { DateInput } from '../../../pages/admin/ui/DateInput'
import { Field } from '../../../pages/admin/ui/Field'
import { onEscape } from '../../../pages/admin/ui/onEscape'
import { CurrencyField, OwnerField } from './fields'

type Fields = Record<string, string>

interface PropertyFormProps {
  data: Fields
  setData: Dispatch<SetStateAction<Fields>>
  /** The purchase currency shown: the chosen one, else the family's first */
  currency: string
  currencies: string[]
  members: string[]
  /** How many valuations the change rewrites */
  count: number
  saving: boolean
  submitDisabled?: boolean
  onSubmit: () => void
  /** Cancel and Escape (behind the discard guard) */
  onCancel: () => void
}

/**
 * The property's own fields in place of its head: name, purchase date, price with its currency, owner. A form: Enter in a
 * field saves, Escape cancels (a date that cannot be read holds Enter itself); the change is written to every valuation.
 */
export function PropertyForm({ data, setData, currency, currencies, members, count, saving, submitDisabled, onSubmit, onCancel }: PropertyFormProps) {
  const { t } = useTranslation()
  const set = (f: string) => (value: string) => setData(d => ({ ...d, [f]: value }))
  return (
    <form className="re-form" noValidate onSubmit={e => { e.preventDefault(); onSubmit() }} onKeyDown={onEscape(onCancel)}>
      <h2 className="re-form__title">{t('modules.real_estate.editTitle')}</h2>
      <fieldset className="re-form__grid" disabled={saving}>
        <Field label={t('data.field.name')}><input className="admin-input" value={data['name'] ?? ''} onChange={e => set('name')(e.target.value)} /></Field>
        <Field label={t('modules.real_estate.field.purchase_date')}><DateInput label={t('modules.real_estate.field.purchase_date')} value={data['purchase_date'] ?? ''} onChange={set('purchase_date')} /></Field>
        <Field label={t('modules.real_estate.field.purchase_price')}>
          <AmountInput label={t('modules.real_estate.field.purchase_price')} unit={currency || undefined} value={data['purchase_price'] ?? ''} onChange={set('purchase_price')} />
        </Field>
        <CurrencyField label={t('modules.real_estate.field.purchase_currency')} value={currency} currencies={currencies} onChange={set('purchase_currency')} />
        <div className="re-form__wide"><OwnerField value={data['member'] ?? ''} members={members} onChange={set('member')} /></div>
      </fieldset>
      <div className="form-actions">
        <span className="note note--help">{t('modules.real_estate.changesAll', { count })}</span>
        <button type="button" className="btn btn--ghost" disabled={saving} onClick={onCancel}>{t('common.cancel')}</button>
        <button type="submit" className="btn btn--primary" disabled={saving || submitDisabled}>{t('data.common.save')}</button>
      </div>
    </form>
  )
}
