// The mandatory spending typed by hand, a settings block of its own: Settings → General shows it, over the query and
// writes it shares with the Breakdown screen (spendingWrites.ts).
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { SpendingRecords } from '../../domain/api'
import { fmtDayNumeric } from '../../lib/formatters'
import { useCan } from '../../lib/rights'
import { amountText, parseAmount } from '../../pages/admin/amount'
import { withCurrent } from '../../pages/admin/shared'
import { AmountInput } from '../../pages/admin/ui/AmountInput'
import { Field } from '../../pages/admin/ui/Field'
import { Select } from '../../pages/admin/ui/Select'
import { Notice } from '../../components/ui/Notice'
import { Disclosure } from '../../components/ui/Disclosure'
import { SettingsSection } from '../../pages/admin/ui/SettingsSection'
import { useSingleFlight } from '../../pages/admin/useSingleFlight'
import { spendingQuery, useManualAmountWrites, useSpendingLists } from './spendingWrites'

const P = 'modules.cashflow.spending'

/**
 * The "Mandatory spending, entered by hand" section: the stored amount from the spending query, the project's currencies
 * and the family currency (the form waits for them; a view-only person needs no lists), Save and Clear.
 */
export function ManualAmountBlock({ stacked, embedded }: { stacked?: boolean; embedded?: boolean } = {}) {
  const { t } = useTranslation()
  const spending = useQuery(spendingQuery)
  const { currencies, familyCurrency, ready, money } = useSpendingLists()
  const writes = useManualAmountWrites()
  const canEdit = useCan('edit')
  const data = spending.data
  const id = useId()
  const content = data && (ready || !canEdit) && (
    <ManualAmount key={`${data.manual?.updated_at ?? ''}|${familyCurrency}`} manual={data.manual} currencies={currencies} familyCurrency={familyCurrency}
      editable={canEdit} embedded={embedded} money={money} {...writes} />
  )
  return embedded ? (
    <section className="general-subgroup" aria-labelledby={id}>
      <h3 id={id}>{t(`${P}.manual.title`)}</h3>
      <p className="note note--help">{t('data.general.baselineHelp')}</p>
      {content}
      <Disclosure variant="inline" className="general-disclosure" title={t('data.general.fallback')}><p className="note note--help">{t('data.general.fallbackText')}</p></Disclosure>
    </section>
  ) : (
    <SettingsSection title={t(`${P}.manual.title`)} description={t(`${P}.manual.text`)} stacked={stacked}>
      {content}
    </SettingsSection>
  )
}

/** The hand-typed amount: the amount, its currency, when it was set; "Save" and "Clear". Read-only text without the right to edit. */
function ManualAmount({ manual, currencies, familyCurrency, editable, embedded, money, onSave, onClear }: {
  manual: SpendingRecords['manual']
  currencies: string[]
  familyCurrency: string
  editable: boolean
  embedded?: boolean
  money: (amount: number, currency: string) => string
  onSave: (amount: number, currency: string) => Promise<boolean>
  onClear: () => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [run, pending] = useSingleFlight()
  const [amount, setAmount] = useState(manual ? amountText(manual.amount) : '')
  const [currency, setCurrency] = useState(manual?.currency ?? familyCurrency)
  const parsed = parseAmount(amount)
  const changed = amount !== (manual ? amountText(manual.amount) : '') || currency !== (manual?.currency ?? familyCurrency)
  const unchanged = parsed.value === manual?.amount && currency === manual?.currency
  const valid = !parsed.invalid && parsed.value !== null && Number.isFinite(parsed.value) && parsed.value >= 0 && !!currency
  const updated = manual ? <p className="note note--help">{t(`${P}.manual.updated`, { date: fmtDayNumeric(manual.updated_at) })}</p> : embedded ? <Notice tone="neutral" title={t('data.general.baselineMissingTitle')}>{t('data.general.baselineMissing')}</Notice> : <p className="note note--help">{t(`${P}.manual.none`)}</p>
  // a currency that left the project stays selectable while it is the saved one
  const options = withCurrent(currency, currencies)

  if (!editable) return <>{manual && <p>{money(manual.amount, manual.currency)}</p>}{updated}</>

  function cancel() {
    setAmount(manual ? amountText(manual.amount) : '')
    setCurrency(manual?.currency ?? familyCurrency)
  }

  function save() {
    if (!valid || !changed || unchanged || parsed.value === null) return
    const value = parsed.value
    void run(() => onSave(value, currency))
  }

  return (
    <form onSubmit={e => { e.preventDefault(); save() }} aria-label={t(`${P}.manual.title`)}>
      <fieldset className="general-fieldset" disabled={pending}>
        <div className="general-fields form-actions form-actions--fields">
          <Field variant={embedded ? "inset" : "standard"} label={t(`${P}.manual.amount`)}>
            <AmountInput label={t(`${P}.manual.amount`)} value={amount} onChange={setAmount} unit={currency || undefined} />
          </Field>
          <Field variant={embedded ? "inset" : "standard"} label={t('common.currency')}>
            <Select value={currency} onChange={e => setCurrency(e.target.value)}>
              {options.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        {embedded && updated}
        <div className="general-actions form-actions">
          {changed && <button type="button" className="btn btn--ghost" onClick={cancel}>{t('common.cancel')}</button>}
          {manual && <button type="button" className="btn btn--ghost" onClick={() => void run(onClear)}>{t(`${P}.manual.clear`)}</button>}
          <button type="submit" className="btn btn--primary" disabled={!valid || !changed || unchanged}>{t('data.common.save')}</button>
        </div>
      </fieldset>
      {!embedded && updated}
    </form>
  )
}
