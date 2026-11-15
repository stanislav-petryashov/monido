import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { UNREAD_DATE } from '../../dateMask'
import { Field } from '../../ui/Field'
import { onEscape } from '../../ui/onEscape'
import { revealUnreadDate } from '../../ui/revealUnreadDate'
import { CollateralField, LoanFieldInput } from '../LoanFields'
import { isGroupField, LOAN_FORM, loanUnit, type Fields } from '../loanForm'

interface LoanFormFieldsProps {
  data: Fields
  setData: Dispatch<SetStateAction<Fields>>
  currencies: string[]
  members: string[]
  /** The new-loan form: `defaultCurrency` and the first member are the default */
  adding?: boolean
  /** The new loan's currency until one is chosen */
  defaultCurrency?: string
  submitted?: boolean
  propertyNames: readonly string[]
}

/** The loan's fields in rows of three (LOAN_FORM), the type on a row of its own, «Collateral — property» last. */
export function LoanFormFields({ data, setData, currencies, members, adding = false, defaultCurrency, submitted = false, propertyNames }: LoanFormFieldsProps) {
  const { t } = useTranslation()
  return (
    <>
      <div className="ln-form__grid">
        {LOAN_FORM.map(([f, label]) => (
          <div key={f} className={f === 'type' ? 'ln-form__wide' : undefined}>
            <Field label={t(label)} group={isGroupField(f, currencies, members)}>
              <LoanFieldInput field={f} data={data} setData={setData} label={t(label)} unit={loanUnit(f, data.currency ?? (adding ? defaultCurrency : undefined), t)}
                currencies={currencies} members={members} adding={adding} defaultCurrency={defaultCurrency} submitted={submitted} />
            </Field>
          </div>
        ))}
      </div>
      <CollateralField names={propertyNames} value={data.secured_by ?? ''} onChange={v => setData(d => ({ ...d, secured_by: v }))} />
    </>
  )
}

interface LoanFormProps extends Omit<LoanFormFieldsProps, 'adding'> {
  /** How many early payments a rename carries */
  payments: number
  termInvalid: boolean
  saving: boolean
  submitDisabled?: boolean
  onSubmit: () => void
  /** Cancel and Escape (behind the discard guard) */
  onCancel: () => void
}

/**
 * The loan's fields in place of its head. A form: Enter in a field saves, Escape cancels (a date that cannot be read
 * holds Enter itself); a rename goes to the loan's early payments too, and the line beside the buttons says so.
 */
export function LoanForm({ payments, saving, submitDisabled, termInvalid, onSubmit, onCancel, ...fields }: LoanFormProps) {
  const { t } = useTranslation()
  const [submitted, setSubmitted] = useState(false)
  const ref = useRef<HTMLFormElement>(null)
  return (
    <form ref={ref} className="re-form ln-form" noValidate onSubmit={e => { e.preventDefault(); setSubmitted(true); if (fields.data.issue_date === UNREAD_DATE) { revealUnreadDate(ref.current, t('data.loans.field.issue_date')); return }; if (termInvalid) ref.current?.querySelector<HTMLInputElement>('.term-input input')?.focus(); onSubmit() }} onKeyDown={onEscape(onCancel)}>
      <h2 className="re-form__title">{t('data.loans.editTitle')}</h2>
      <fieldset className="form-stack ln-form__set" disabled={saving}>
        <LoanFormFields {...fields} submitted={submitted && termInvalid} />
      </fieldset>
      <div className="form-actions">
        {payments > 0 && <span className="re-form__note">{t('data.loans.form.renames', { count: payments })}</span>}
        <button type="button" className="btn btn--ghost" disabled={saving} onClick={onCancel}>{t('common.cancel')}</button>
        <button type="submit" className="btn btn--primary" disabled={saving || submitDisabled}>{t('data.common.save')}</button>
      </div>
    </form>
  )
}
