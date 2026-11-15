import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_TERM_MONTHS } from '../../../domain/loans'
import { fmtMoney, fmtNum } from '../../../lib/formatters'
import { PRIVACY_MASK, usePrivacy } from '../../../lib/privacy'
import { parseDecimal } from '../amount'
import { AmountInput } from '../ui/AmountInput'
import { DateInput } from '../ui/DateInput'
import { NumberInput } from '../ui/NumberInput'
import { followPayment, formulaPayment, HIGH_RATE, LOAN_FIELDS, LOAN_TYPE_OPTIONS, paymentFollows, rateCheck, type Fields } from './loanForm'
import { Field } from '../ui/Field'
import { OptionPicker } from '../ui/OptionPicker'
import { isOptionGroup } from '../ui/optionGroup'
import { Select } from '../ui/Select'
import { TermInput } from '../ui/TermInput'

interface LoanFieldInputProps {
  field: (typeof LOAN_FIELDS)[number][0]
  data: Fields
  setData: Dispatch<SetStateAction<Fields>>
  currencies: string[]
  members: string[]
  /** The new-loan form: `defaultCurrency` and the first member are the default */
  adding?: boolean
  /** The new loan's currency until one is chosen: the family currency when listed, else the first */
  defaultCurrency?: string
  submitted?: boolean
  /** The caption, for the fields that name themselves (AmountInput, NumberInput, DateInput, TermInput) */
  label: string
  /** The suffix inside the field: the loan's currency for an amount, % for the rate */
  unit?: string
  /** What Field clones in: the caption and the description of the control */
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/**
 * A loan field — the same in the add form and the edit form. The payment follows the formula while it is the formula
 * payment ("Calculated from the amount, rate and term" under it); a payment typed from the bank stays when the loan changes, and a "Use the
 * formula" link under it brings the formula back. A rate that looks like a fraction or a typo is said under the rate.
 */
export function LoanFieldInput({ field: f, data, setData, currencies, members, adding = false, defaultCurrency, submitted = false, label, unit, ...aria }: LoanFieldInputProps) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const set = (value: string) => setData(d => ({ ...d, [f]: value }))
  /** A change of the principal, the rate or the term: the payment follows it while it is the formula one */
  const setLoan = (field: string) => (value: string) => setData(d => followPayment(d, { ...d, [field]: value }))

  if (f === 'type') return (
    <OptionPicker {...aria} options={LOAN_TYPE_OPTIONS.map(([v, label]) => ({ value: v, label: t(label) }))} value={data[f] ?? 'consumer'} onChange={set} />
  )
  if (f === 'payment_day') return (
    <Select {...aria} value={data[f] ?? ''} onChange={e => set(e.target.value)}>
      <option value="">{adding ? t('data.loans.dayNotSetAdding') : t('data.loans.dayNotSet')}</option>
      {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
        <option key={d} value={d}>{t('data.loans.dayOfMonth', { day: d })}</option>
      ))}
    </Select>
  )
  if (f === 'currency') return (
    <OptionPicker {...aria} options={currencies.map(c => ({ value: c, label: c }))} value={data[f] ?? (adding ? defaultCurrency : undefined) ?? ''} onChange={set} />
  )
  if (f === 'member') return (
    <OptionPicker {...aria} options={members.map(m => ({ value: m, label: m }))} value={data[f] ?? (adding ? members[0] : undefined) ?? ''} onChange={set} />
  )
  if (f === 'issue_date') return (
    <DateInput label={label} {...aria} value={data[f] ?? ''} onChange={set} />
  )
  if (f === 'principal') return (
    <AmountInput label={label} unit={unit} value={data[f] ?? ''} onChange={setLoan(f)} describedBy={aria['aria-describedby']} />
  )
  if (f === 'term_months') return (
    <TermInput submitted={submitted} invalid={submitted && Number(data[f] ?? 0) > MAX_TERM_MONTHS} invalidMessage={t('data.loans.termTooLong', { years: fmtNum(MAX_TERM_MONTHS / 12), months: fmtNum(MAX_TERM_MONTHS) })} label={label} aria-labelledby={aria['aria-labelledby']} value={data[f] ?? ''} onChange={setLoan(f)} />
  )
  if (f === 'rate') {
    const rate = parseDecimal(data[f] ?? '')
    const check = rateCheck(rate)
    const hint = check?.kind === 'fraction' ? (
      <>
        <span className="field__check">{t('data.loans.rateFraction', { value: fmtNum(rate, 3), suggested: fmtNum(check.suggested, 3) })}</span>{' '}
        <button type="button" className="link-button" onClick={() => setLoan(f)(String(check.suggested))}>
          {t('data.loans.rateFix', { value: fmtNum(check.suggested, 3) })}
        </button>
      </>
    ) : check?.kind === 'high' ? <span className="field__check">{t('data.loans.rateHigh', { max: fmtNum(HIGH_RATE) })}</span> : undefined
    return (
      <NumberInput label={label} unit={unit} value={data[f] ?? ''} onChange={setLoan(f)} decimals={3} hint={hint} describedBy={aria['aria-describedby']} />
    )
  }
  if (f === 'monthly_payment') {
    const formula = formulaPayment(data)
    const hint = formula === undefined ? undefined : paymentFollows(data) ? t('data.loans.paymentCalculated') : (
      <button type="button" className="link-button" onClick={() => set(formula)}>
        {t('data.loans.useFormula', { value: hidden ? PRIVACY_MASK : fmtMoney(Number(formula)) })}
      </button>
    )
    return (
      <AmountInput label={label} unit={unit} value={data[f] ?? ''} onChange={set} hint={hint} describedBy={aria['aria-describedby']} />
    )
  }
  return <input className="admin-input" {...aria} value={data[f] ?? ''} onChange={e => set(e.target.value)} />
}

interface CollateralFieldProps {
  names: readonly string[]
  /** The stored or chosen property; '' — none */
  value: string
  onChange: (name: string) => void
}

/**
 * «Collateral — property»: None or one of the properties. A stored name no longer among them (a hand-edited database)
 * shows None and is not offered: the domain reads such a link as none.
 */
export function CollateralField({ names, value, onChange }: CollateralFieldProps) {
  const { t } = useTranslation()
  const options = [{ value: '', label: t('data.loans.collateralNone') }, ...names.map(n => ({ value: n, label: n }))]
  return (
    <div className="loan-collateral">
      <Field label={t('data.loans.field.secured_by')} hint={t('data.loans.collateralHint')} group={isOptionGroup(options.length)}>
        <OptionPicker options={options} value={names.includes(value) ? value : ''} onChange={onChange} />
      </Field>
    </div>
  )
}
