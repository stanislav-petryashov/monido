import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { parseAmount } from '../../../pages/admin/amount'
import { UNREAD_DATE } from '../../../pages/admin/dateMask'
import { AmountInput } from '../../../pages/admin/ui/AmountInput'
import { DateInput } from '../../../pages/admin/ui/DateInput'
import { Field } from '../../../pages/admin/ui/Field'
import { FormDialog } from '../../../pages/admin/ui/FormDialog'
import { CurrencyField, OwnerField } from './fields'

type Fields = Record<string, string>

/** The dialog's typed fields: the name, the first valuation's year and note */
const TEXT_FIELDS = ['name', 'valuation_year', 'notes'] as const

interface NewPropertyDialogProps {
  data: Fields
  setData: Dispatch<SetStateAction<Fields>>
  /** The purchase currency shown: the chosen one, else the family's first; the first valuation is in it */
  currency: string
  currencies: string[]
  members: string[]
  busy: boolean
  onSubmit: () => Promise<boolean>
  beforeCancel?: () => Promise<boolean>
  onCancel: () => void
}

/**
 * A new property: name, owner, purchase date and price with its currency, then the first valuation — year, value, note —
 * from which the property enters the assets. The valuation is in the purchase currency.
 */
export function NewPropertyDialog({ data, setData, currency, currencies, members, busy, onSubmit, beforeCancel, onCancel }: NewPropertyDialogProps) {
  const { t } = useTranslation()
  const [submitted, setSubmitted] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const nameMissing = submitted && !(data['name'] ?? '').trim()
  const submit = () => {
    setSubmitted(true)
    if (!(data['name'] ?? '').trim()) { nameRef.current?.focus(); return false }
    const price = parseAmount(data['purchase_price'] ?? '')
    if (!data['purchase_date'] || data['purchase_date'] === UNREAD_DATE) {
      const date = [...(root.current?.querySelectorAll<HTMLInputElement>('input') ?? [])].find(input => input.getAttribute('aria-label') === t('modules.real_estate.field.purchase_date'))
      date?.focus()
      return false
    }
    if (price.value === null || price.invalid) {
      root.current?.querySelector<HTMLInputElement>(`input[aria-label^="${t('modules.real_estate.field.purchase_price')}"]`)?.focus()
      return false
    }
    return onSubmit()
  }
  const set = (f: string) => (value: string) => setData(d => ({ ...d, [f]: value }))
  const input = (f: (typeof TEXT_FIELDS)[number]) => (
    <input className={f === 'valuation_year' ? 'admin-input admin-input--num' : 'admin-input'} inputMode={f === 'valuation_year' ? 'numeric' : undefined} value={data[f] ?? ''} onChange={e => set(f)(e.target.value)} />
  )
  const [name, year, notes] = TEXT_FIELDS
  return (
    <FormDialog title={t('modules.real_estate.newTitle')} submitLabel={t('data.common.save')} onSubmit={submit} busy={busy} beforeCancel={beforeCancel} onCancel={onCancel}>
      <div ref={root} className="form-stack">
      <Field label={t('data.field.name')} error={nameMissing ? t('modules.real_estate.nameRequired') : undefined}><input ref={nameRef} className="admin-input" value={data[name] ?? ''} onChange={e => set(name)(e.target.value)} aria-invalid={nameMissing || undefined} /></Field>
      <OwnerField value={data['member'] ?? ''} members={members} onChange={set('member')} />
      <div className="re-form__pair">
        <Field label={t('modules.real_estate.field.purchase_date')}><DateInput submitted={submitted} requiredMessage={t('modules.real_estate.dateRequired')} label={t('modules.real_estate.field.purchase_date')} value={data['purchase_date'] ?? ''} onChange={set('purchase_date')} /></Field>
        <Field label={t('modules.real_estate.field.purchase_price')}>
          <AmountInput errorLine submitted={submitted} invalid={submitted && parseAmount(data['purchase_price'] ?? '').value === null} invalidMessage={data['purchase_price'] ? t('data.common.notNumber') : t('modules.real_estate.priceRequired')} label={t('modules.real_estate.field.purchase_price')} unit={currency || undefined} value={data['purchase_price'] ?? ''} onChange={set('purchase_price')} />
        </Field>
      </div>
      <CurrencyField label={t('modules.real_estate.field.purchase_currency')} value={currency} currencies={currencies} onChange={set('purchase_currency')} />
      <p className="re-form__section">{t('modules.real_estate.firstValuation')}</p>
      <div className="re-form__pair">
        <Field label={t('modules.real_estate.field.valuation_year')}>{input(year)}</Field>
        <Field label={t('modules.real_estate.field.value')}>
          <AmountInput label={t('modules.real_estate.field.value')} unit={currency || undefined} value={data['value'] ?? ''} onChange={set('value')} />
        </Field>
      </div>
      <Field label={t('modules.real_estate.field.notes')}>{input(notes)}</Field>
      </div>
    </FormDialog>
  )
}
