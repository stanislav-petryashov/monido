import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFamilyCurrency } from '../../lib/familySettings'
import { ACCOUNT_CLASSES, type AccountClass } from '../../domain/accounts'
import { classLabel } from '../../lib/formatters'
import { Field } from './ui/Field'
import { useFieldError } from './ui/useFieldError'
import { onEscape } from './ui/onEscape'
import { OptionPicker } from './ui/OptionPicker'
import { isOptionGroup } from './ui/optionGroup'
import { EMPTY_ACCOUNT, requiredAccountFields, withListDefaults, type AccountFieldName, type AccountFormValues } from './accountValues'

export type { AccountFormValues }

/** A field that picks one of a list: the options are the items themselves, or `labelOf(item)` */
function ListField({ label, items, labelOf = x => x, value, onChange, invalid = false, message = '', submitted = false }: { invalid?: boolean; message?: string; submitted?: boolean; label: string; items: readonly string[]; labelOf?: (item: string) => string; value: string; onChange: (value: string) => void }) {
  const { field, error } = useFieldError(invalid, message, undefined, submitted)
  return (
    <Field label={label} hint={<>{error}</>} group={isOptionGroup(items.length)}>
      <OptionPicker aria-invalid={field['aria-invalid']} onBlur={field.onBlur} options={items.map(x => ({ value: x, label: labelOf(x) }))} value={value} onChange={onChange} />
    </Field>
  )
}

export interface AccountFieldsProps {
  values: AccountFormValues
  onChange(patch: Partial<AccountFormValues>): void
  members: string[]
  currencies: string[]
  /** Under the name field */
  nameHint?: string
  /** The id of a <datalist> with the names to suggest */
  namesId?: string
  autoFocusName?: boolean
  invalidFields?: readonly AccountFieldName[]
  validationAttempt?: number
}

/** The four fields of an account (name, member, currency, type), the same in the wizard's form, the new-account dialog and the edit panel */
export function AccountFields({ values, onChange, members, currencies, nameHint, namesId, autoFocusName, invalidFields = [], validationAttempt = 0 }: AccountFieldsProps) {
  const { t } = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const { field, error } = useFieldError(invalidFields.includes('name'), t('data.close.nameRequired'), undefined, validationAttempt > 0)
  useLayoutEffect(() => {
    if (validationAttempt) root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [validationAttempt])
  return (
    <div ref={root} style={{ display: 'contents' }}>
      <Field label={t('data.field.name')} hint={<>{error || nameHint}</>}>
        <input aria-invalid={field['aria-invalid']} onBlur={field.onBlur} className="admin-input" list={namesId} value={values.name} autoFocus={autoFocusName} onChange={e => onChange({ name: e.target.value })} />
      </Field>
      <ListField invalid={invalidFields.includes('member')} message={t('data.accounts.memberRequired')} submitted={validationAttempt > 0} label={t('data.field.member')} items={members} value={values.member} onChange={member => onChange({ member })} />
      <ListField invalid={invalidFields.includes('currency')} message={t('data.close.currencyRequired')} submitted={validationAttempt > 0} label={t('common.currency')} items={currencies} value={values.currency} onChange={currency => onChange({ currency })} />
      <ListField label={t('data.field.type')} items={ACCOUNT_CLASSES} labelOf={c => classLabel(c as AccountClass)} value={values.class}
        onChange={c => onChange({ class: c as AccountClass })} />
    </div>
  )
}

export interface AccountFormProps {
  members: string[]
  currencies: string[]
  /** names for the <datalist> */
  suggestions: string[]
  /** returns the error text to show (nameRequired / currencyRequired / duplicate: draftAccountOrError of useMonthClose), or null when added */
  onAdd(values: AccountFormValues): string | null
  onCancel(): void
  onDirtyChange?: (dirty: boolean) => void
  beforeCancel?: () => Promise<boolean>
  /** A month transition is pending; private text must not start after its discard decision. */
  busy?: boolean
}

/** The inline "New account" form: name with suggestions, member, currency, type */
export function AccountForm({ members, currencies, suggestions, onAdd, onCancel, onDirtyChange, beforeCancel, busy }: AccountFormProps) {
  const { t } = useTranslation()
  const namesId = useId()
  const familyCurrency = useFamilyCurrency()
  const [typedForm, setForm] = useState<AccountFormValues>(EMPTY_ACCOUNT)
  const form = withListDefaults(typedForm, members, currencies, familyCurrency)
  const [validationAttempt, setValidationAttempt] = useState(0)
  const [formError, setFormError] = useState<string | null>(null)
  const baseline = withListDefaults(EMPTY_ACCOUNT, members, currencies, familyCurrency)
  const latestForm = useRef(typedForm)
  const reportDirty = useRef(onDirtyChange)
  useLayoutEffect(() => { reportDirty.current = onDirtyChange }, [onDirtyChange])
  useLayoutEffect(() => () => { reportDirty.current?.(false) }, [])
  function change(patch: Partial<AccountFormValues>) {
    const next = { ...latestForm.current, ...patch }
    latestForm.current = next
    // Hold the parent month in this edit event, before a queued background read can render another one.
    onDirtyChange?.(Object.entries(withListDefaults(next, members, currencies, familyCurrency)).some(([key, value]) => value !== baseline[key as keyof AccountFormValues]))
    setForm(next)
  }
  function cancel() {
    if (busy) return
    if (beforeCancel) void beforeCancel().then(allowed => { if (allowed) onCancel() })
    else onCancel()
  }

  return (
    <form className="form-card close-form" onSubmit={e => { e.preventDefault(); if (!busy) { setValidationAttempt(n => n + 1); if (requiredAccountFields(form).length) { setFormError(null); return } setFormError(onAdd(form)) } }} onKeyDown={onEscape(cancel)} noValidate>
      <datalist id={namesId}>{suggestions.map(n => <option key={n} value={n} />)}</datalist>
      <div className="form-card__title">{t('data.accounts.newTitle')}</div>
      <fieldset className="form-grid" disabled={busy}>
        <AccountFields values={form} onChange={change} members={members} currencies={currencies} namesId={namesId} autoFocusName validationAttempt={validationAttempt} invalidFields={validationAttempt ? requiredAccountFields(form) : []} />
      </fieldset>
      {formError && <p className="close-foot__error" role="alert">{formError}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={cancel}>{t('common.cancel')}</button>
        <button type="submit" className="btn btn--primary" disabled={busy}>{t('data.close.add')}</button>
      </div>
    </form>
  )
}
