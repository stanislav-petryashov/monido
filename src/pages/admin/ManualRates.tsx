import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconPencil, IconTrash } from '@tabler/icons-react'
import { apiSend } from '../../lib/api'
import { fmtDayNumeric, fmtNum } from '../../lib/formatters'
import { tableQuery, useSnapshotWrite } from './adminQuery'
import { amountText, parseDecimal } from './amount'
import { hasUnreadDate } from './dateMask'
import { useAdminRows } from './useAdminRows'
import { useSingleFlight } from './useSingleFlight'
import { useToast } from '../../lib/notifyState'
import { DateInput } from './ui/DateInput'
import { Field } from './ui/Field'
import { NumberInput } from './ui/NumberInput'
import { Select } from './ui/Select'
import { Disclosure } from '../../components/ui/Disclosure'
import { SettingsSection } from './ui/SettingsSection'

type ManualRate = { currency: string; date: string; per_usd: number; rowid: number }

const RATES = tableQuery('fx_manual_rates').queryKey
const URL = '/api/admin/fx_manual_rates'
/** Currencies worth more than a dollar: a rate below one is right for them, for any other it is likely typed upside down */
const STRONGER_THAN_USD = ['GBP', 'EUR', 'CHF', 'KWD', 'BHD', 'OMR', 'JOD', 'KYD', 'GIP', 'FKP', 'SHP']

/**
 * Rates entered by hand, "1 USD = X CODE", for a currency the download does not cover or to replace it by the market
 * rate. A rate applies from its date until the next one of that currency. Every write refreshes the snapshot.
 */
export function ManualRates({ currencies, readOnly, embedded = false }: { currencies: string[]; readOnly: boolean; embedded?: boolean }) {
  const { t } = useTranslation()
  const send = useSnapshotWrite([RATES])
  const toast = useToast()
  /** One rate is written at a time: a second Enter or click before the answer would post the same (currency, date) twice,
   *  a second click on a trash can would delete a row that is already gone */
  const [run, busy] = useSingleFlight()
  const { rows } = useAdminRows<ManualRate>('fx_manual_rates')
  const offered = currencies.filter(c => c !== 'USD')
  const [form, setForm] = useState({ currency: '', date: '', rate: '' })
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [editVal, setEditVal] = useState('')
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date) || a.currency.localeCompare(b.currency))
  /**
   * The rate of a field, or null; `invalid` — text that is not a positive number. The field's text is canonical and a
   * rate has no thousands, so "92.415" is a rate with three decimals (parseDecimal), not a thousand.
   */
  const rateOf = (v: string) => {
    const value = parseDecimal(v)
    return { value: value !== null && value > 0 ? value : null, invalid: v.trim() !== '' && (value === null || value <= 0) }
  }
  const formRate = rateOf(form.rate)
  const editRate = rateOf(editVal)

  /** Under the rate: what 1 unit of the currency is in dollars, and a warning for a rate that looks upside down */
  const inverseHint = (rate: number | null, code: string) => {
    if (rate === null || !code) return undefined
    const inverse = 1 / rate
    // about three significant digits below one, so 1 VND is not "0 USD"
    const digits = inverse < 1 ? Math.min(8, Math.max(4, Math.ceil(-Math.log10(inverse)) + 2)) : 2
    return (
      <>
        <span>{t('data.params.rateInverse', { code, value: fmtNum(inverse, digits) })}</span>
        {rate < 1 && !STRONGER_THAN_USD.includes(code) && <span className="field__check"> {t('data.params.rateMaybeInverted', { code })}</span>}
      </>
    )
  }

  async function add() {
    if (hasUnreadDate(form)) { toast.error(t('data.common.saveFailed'), t('data.common.dateUnread')); return }
    if (!form.currency || !form.date || formRate.value === null) return
    const body = { currency: form.currency, date: form.date, per_usd: formRate.value }
    const added = await run(() => send(() => apiSend(URL, 'POST', body), t('data.params.rateAdded'), t('data.common.saveFailed')))
    if (added) {
      if (embedded) { setForm({ currency: '', date: '', rate: '' }); setAdding(false) }
      else setForm(f => ({ ...f, rate: '' }))
    }
  }

  async function save(rowid: number) {
    const perUsd = editRate.value
    if (perUsd === null) return
    const saved = await run(() => send(() => apiSend(`${URL}/${rowid}`, 'PUT', { per_usd: perUsd }), t('data.params.rateSaved'), t('data.common.saveFailed')))
    if (saved) setEditId(null)
  }

  const label = (r: ManualRate) => `${r.currency} ${fmtDayNumeric(r.date)}`

  const addForm = !readOnly && (!embedded || adding) && (
      <fieldset disabled={busy} className={embedded ? 'general-fieldset general-rate-form' : 'general-fieldset form-actions form-actions--fields'} role="group" aria-label={t('data.params.rates')}>
        <div className={embedded ? 'general-fields' : 'form-actions form-actions--fields'}>
        <Field variant={embedded ? "inset" : "standard"} label={t('data.params.rateCurrency')}>
          <Select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
            <option value="">—</option>
            {offered.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field variant={embedded ? "inset" : "standard"} label={t('data.field.date')}>
          <DateInput label={t('data.field.date')} value={form.date} onChange={date => setForm(f => ({ ...f, date }))} />
        </Field>
        <Field variant={embedded ? "inset" : "standard"} label={t('data.params.ratePerUsd')}>
          <div onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void add() }}>
            <NumberInput label={t('data.params.ratePerUsd')} value={form.rate} onChange={rate => setForm(f => ({ ...f, rate }))} decimals={6}
              prefix={t('data.params.ratePrefix')} unit={form.currency || undefined} invalid={formRate.invalid} invalidMessage={t('data.params.ratePositive')}
              hint={inverseHint(formRate.value, form.currency)} />
          </div>
        </Field>
        </div>
        {embedded && <p className="general-help">{t('data.params.rateRule')}</p>}
        <div className={embedded ? 'general-actions' : 'form-actions'}>
          {embedded && <button type="button" className="btn btn--ghost" disabled={busy}
            onClick={() => { setForm({ currency: '', date: '', rate: '' }); setAdding(false) }}>{t('common.cancel')}</button>}
          <button type="button" className={embedded ? 'btn btn--primary' : 'btn btn--ghost'}
            disabled={!form.currency || !form.date || hasUnreadDate(form) || formRate.value === null || busy}
            onClick={add}>{t(embedded ? 'data.params.addRate' : 'data.common.addTag')}</button>
        </div>
      </fieldset>
  )
  const table = (
      <div className="admin-table-wrap">
        <div className="admin-table-scroll">
          <table className="admin-table admin-table--fit" aria-label={t('data.params.rates')}>
            <thead><tr><th>{t('data.field.date')}</th><th>{t('data.params.rateCurrency')}</th><th className="td-num">{t('data.params.ratePerUsd')}</th><th className="td-actions" /></tr></thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.rowid}>
                  <td>{fmtDayNumeric(r.date)}</td>
                  <td>{r.currency}</td>
                  <td className="td-num">
                    {!readOnly && editId === r.rowid ? (
                      <div className="form-actions form-actions--row form-actions--end">
                        <div className="param-input" onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(r.rowid) }}>
                          <NumberInput label={t('data.params.rateNamed', { name: label(r) })} value={editVal} onChange={setEditVal} decimals={6} autoFocus
                            prefix={t('data.params.ratePrefix')} unit={r.currency} invalid={editRate.invalid} invalidMessage={t('data.params.ratePositive')}
                            hint={inverseHint(editRate.value, r.currency)} />
                        </div>
                        <button className="btn btn--ghost" onClick={() => setEditId(null)}>{t('common.cancel')}</button>
                        <button className="btn btn--primary" disabled={editRate.invalid || busy} onClick={() => save(r.rowid)}>{t('data.common.save')}</button>
                      </div>
                    ) : t('data.params.rateValue', { rate: fmtNum(r.per_usd, 6), code: r.currency })}
                  </td>
                  <td className="td-actions">
                    {!readOnly && editId !== r.rowid && (
                      <>
                        <button className="row-menu__trigger" aria-label={t('data.common.editNamed', { name: label(r) })}
                          onClick={() => { setEditId(r.rowid); setEditVal(amountText(r.per_usd)) }}>
                          <IconPencil size={18} stroke={2} aria-hidden="true" />
                        </button>
                        <button className="row-menu__trigger" aria-label={t('data.common.deleteNamed', { name: label(r) })} disabled={busy}
                          onClick={() => run(() => send(() => apiSend(`${URL}/${r.rowid}`, 'DELETE'), t('data.params.rateDeleted'), t('data.common.deleteFailed')))}>
                          <IconTrash size={18} stroke={2} aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && <tr><td colSpan={4} className="empty">{t('data.params.ratesNone')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
  )

  if (embedded) return (
    <Disclosure variant="inline" className="general-disclosure" title={t('data.params.manualRatesTitle')}>
      <p className="general-help">{t('data.params.manualRatesHelp')}</p>
      {sorted.length > 0 ? table : <p className="note note--help">{t('data.params.ratesNone')}</p>}
      {!readOnly && !adding && <button type="button" className="btn btn--ghost" onClick={() => setAdding(true)}>{t('data.params.addRate')}</button>}
      {addForm}
    </Disclosure>
  )

  return (
    <SettingsSection title={t('data.params.rates')} description={t('data.params.ratesNote')} stacked>
      {addForm}
      {table}
    </SettingsSection>
  )
}
