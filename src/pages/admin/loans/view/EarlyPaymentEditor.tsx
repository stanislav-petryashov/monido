import { useId, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { earlyPaymentPreview, type EarlyPaymentOutcome, type LoanEarlyPayment, type LoanRow } from '../../../../domain/loans'
import { fmtDayNumeric, fmtNum } from '../../../../lib/formatters'
import { PRIVACY_MASK, useMoney, usePrivacy } from '../../../../lib/privacy'
import { UNREAD_DATE } from '../../dateMask'
import { AmountInput } from '../../ui/AmountInput'
import { DateInput } from '../../ui/DateInput'
import { Field } from '../../ui/Field'
import { epAmount, STRATEGY_OPTIONS, type Fields } from '../loanForm'
import { useCents } from './money'

interface EarlyPaymentEditorProps {
  loan: LoanRow
  /** The loan's other early payments: the preview adds the typed one to them */
  others: LoanEarlyPayment[]
  data: Fields
  setData: Dispatch<SetStateAction<Fields>>
  /** The most the payment may be on its date: the balance by the schedule that day; null — no limit shown */
  max: number | null
  /** Today */
  today: Date
  saving: boolean
  onSave: () => void
  onCancel: () => void
}

/**
 * An early payment in place, as the top row of the early-payments table (or the row being edited): date, amount with
 * its limit, note; then «What to reduce, and what it gives» — the two strategies as a radio pair, each with what it does
 * (earlyPaymentPreview: the same schedule saving gives); then the bank's figures, «New payment» only to reduce the
 * payment. Enter in a field saves, Escape cancels.
 */
export function EarlyPaymentEditor({ loan, others, data, setData, max, today, saving, onSave, onCancel }: EarlyPaymentEditorProps) {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const masked = useMoney()
  const cents = useCents()
  const name = useId()
  const currency = loan.currency
  const strategy = data['strategy'] ?? 'reduce_term'
  const set = (f: string) => (value: string) => setData(d => ({ ...d, [f]: value }))
  // a date still being typed has no preview: as for an empty one
  const date = data['payment_date'] === UNREAD_DATE ? '' : data['payment_date'] ?? ''
  const preview = earlyPaymentPreview(loan, others, {
    payment_date: date, amount: epAmount(data['amount']), new_payment: epAmount(data['new_payment']), principal_credit: epAmount(data['principal_credit']),
  }, today)
  const result = (key: string, o: EarlyPaymentOutcome | null) => {
    if (!preview) return null
    if (!o) return <span className="ln-opt__s">{t('data.loans.ep.nothing')}</span>
    const now = preview.current
    return key === 'reduce_term' ? (
      <>
        <span className="ln-opt__r num">{t('data.loans.ep.lastPayment', { date: fmtDayNumeric(o.lastPayment) })}</span>
        <span className="ln-opt__s num">{t('data.loans.ep.insteadTerm', { date: fmtDayNumeric(now.lastPayment), count: now.paymentsLeft - o.paymentsLeft })}</span>
        <span className="ln-opt__s num">{t('data.loans.ep.interestSaved', { amount: masked(o.interestSaved, currency) })}</span>
      </>
    ) : (
      <>
        <span className="ln-opt__r num">{t('data.loans.ep.payment', { amount: cents(o.payment, currency) })}</span>
        <span className="ln-opt__s num">{t('data.loans.ep.insteadPayment', { amount: cents(now.payment, currency) })}</span>
        <span className="ln-opt__s num">{t('data.loans.ep.interestSaved', { amount: masked(o.interestSaved, currency) })}</span>
      </>
    )
  }
  return (
    <tr className="re-edrow">
      <td colSpan={7}>
        <div className="re-editor ln-editor" onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          else if (e.key === 'Enter' && !e.defaultPrevented && e.target instanceof HTMLInputElement && e.target.type !== 'radio') { e.preventDefault(); onSave() }
        }}>
          <fieldset className="ln-editor__fields" disabled={saving}>
            <Field label={t('data.field.date')}>
              <DateInput label={t('data.field.date')} value={data['payment_date'] ?? ''} onChange={set('payment_date')} />
            </Field>
            <Field label={t('data.field.amount')}>
              <AmountInput label={t('data.field.amount')} unit={currency} value={data['amount'] ?? ''} onChange={set('amount')} autoFocus
                hint={max !== null ? t('data.loans.ep.max', { max: hidden ? PRIVACY_MASK : fmtNum(max, 0) }) : undefined} />
            </Field>
            <div className="ln-editor__note">
              <Field label={t('data.loans.ep.note')}>
                <input className="admin-input" value={data['notes'] ?? ''} onChange={e => set('notes')(e.target.value)} />
              </Field>
            </div>
          </fieldset>
          <fieldset className="ln-choice" disabled={saving}>
            <legend className="ln-choice__l">{t('data.loans.ep.choose')}</legend>
            <div className="ln-choice__opts" aria-live="polite">
              {STRATEGY_OPTIONS.map(([key, label]) => (
                <label key={key} className="ln-opt">
                  <input type="radio" className="ln-opt__radio" name={name} value={key} checked={strategy === key} onChange={() => set('strategy')(key)} />
                  <span className="ln-opt__h">{t(label)}</span>
                  {result(key, preview ? preview[key as 'reduce_term' | 'reduce_payment'] : null)}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="ln-editor__bank" disabled={saving}>
            {strategy === 'reduce_payment' && (
              <Field label={t('data.loans.ep.newPayment')}>
                <AmountInput label={t('data.loans.ep.newPayment')} unit={currency} value={data['new_payment'] ?? ''} onChange={set('new_payment')}
                  placeholder={preview?.reduce_payment && !hidden ? fmtNum(preview.reduce_payment.payment, 2) : undefined} />
              </Field>
            )}
            <Field label={t('data.loans.ep.credited')}>
              <AmountInput label={t('data.loans.ep.credited')} unit={currency} value={data['principal_credit'] ?? ''} onChange={set('principal_credit')} />
            </Field>
          </fieldset>
          <div className="form-actions">
            <span className="ln-editor__hint">{t(strategy === 'reduce_payment' ? 'data.loans.ep.fromBank' : 'data.loans.ep.fromBankCredit')}</span>
            <button type="button" className="btn btn--ghost" disabled={saving} onClick={onCancel}>{t('common.cancel')}</button>
            <button type="button" className="btn btn--primary" disabled={saving} onClick={onSave}>{t('data.common.save')}</button>
          </div>
        </div>
      </td>
    </tr>
  )
}
