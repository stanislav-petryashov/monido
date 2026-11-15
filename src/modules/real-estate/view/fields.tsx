import { useTranslation } from 'react-i18next'
import { withCurrent } from '../../../pages/admin/shared'
import { Field } from '../../../pages/admin/ui/Field'
import { OptionPicker } from '../../../pages/admin/ui/OptionPicker'
import { isOptionGroup } from '../../../pages/admin/ui/optionGroup'

/** A currency of the family as a short choice; one no longer in the list is still shown. Takes Field's aria-*. */
export function CurrencyPicker({ value, currencies, onChange, ...aria }: { value: string; currencies: string[]; onChange: (code: string) => void; 'aria-labelledby'?: string; 'aria-describedby'?: string }) {
  return <OptionPicker {...aria} options={withCurrent(value, currencies).map(c => ({ value: c, label: c }))} value={value} onChange={onChange} />
}

/** The currency field: a segmented choice, a dropdown when long */
export function CurrencyField({ label, value, currencies, onChange }: { label: string; value: string; currencies: string[]; onChange: (code: string) => void }) {
  return (
    <Field label={label} group={isOptionGroup(withCurrent(value, currencies).length)}>
      <CurrencyPicker value={value} currencies={currencies} onChange={onChange} />
    </Field>
  )
}

/** The property owner: a member from the list or none (''); an owner no longer in the list is still shown. */
export function OwnerField({ value, members, onChange }: { value: string; members: string[]; onChange: (member: string) => void }) {
  const { t } = useTranslation()
  const options = withCurrent(value, members)
  return (
    <Field label={t('data.field.owner')} group={isOptionGroup(options.length + 1)}>
      <OptionPicker options={[...options.map(m => ({ value: m, label: m })), { value: '', label: t('modules.real_estate.noOwner') }]} value={value} onChange={onChange} />
    </Field>
  )
}
