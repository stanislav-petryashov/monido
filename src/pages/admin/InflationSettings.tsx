import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { apiSend } from '../../lib/api'
import { refreshSnapshot } from '../../lib/useFinanceData'
import { fmtNum } from '../../lib/formatters'
import { tableQuery, useSnapshotWrite } from './adminQuery'
import type { Currency, Parameter } from './shared'
import { parseDecimal } from './amount'
import { Field } from './ui/Field'
import { NumberInput } from './ui/NumberInput'
import { Select } from './ui/Select'
import { Notice } from '../../components/ui/Notice'
import { SettingsSection } from './ui/SettingsSection'
import { useSingleFlight } from './useSingleFlight'

/** inflation = 1 — the currency inflation is measured in */

/** Inflation by country, % a year */
const IMF_URL = 'https://www.imf.org/external/datamapper/PCPIPCH'
const WRITES = ['parameters', 'currencies'].map(table => tableQuery(table).queryKey)

/**
 * The inflation real growth is measured against, and its currency: inflation belongs to the country the family spends
 * in, so it is entered once, in that country's currency. No default: until both are set, there is no real growth.
 * The value is the `inflation_rate` parameter (created on the first save); the currency is the `inflation` flag of the
 * currencies table. Every write refreshes the snapshot.
 */
export function InflationSettings({ parameters, currencies, readOnly }: { parameters: Parameter[]; currencies: Currency[]; readOnly: boolean }) {
  const { t } = useTranslation()
  const send = useSnapshotWrite(WRITES)
  const queryClient = useQueryClient()
  const [run, pending] = useSingleFlight()
  const stored = parameters.find(p => p.key === 'inflation_rate') ?? null
  const flagged = currencies.find(c => Number(c.inflation) === 1) ?? null
  const saved = { text: stored ? String(stored.value) : '', currency: flagged?.code ?? '' }
  const [draft, setDraft] = useState<typeof saved | null>(null)
  const shown = draft ?? saved
  const value = parseDecimal(shown.text)
  const invalid = shown.text !== '' && value === null
  const changed = shown.text !== saved.text || shown.currency !== saved.currency
  const unchanged = value === stored?.value && shown.currency === saved.currency
  const valid = value !== null && currencies.some(c => c.code === shown.currency)

  async function save() {
    if (readOnly || !valid || !changed || unchanged) return
    await run(async () => {
      const current = queryClient.getQueryData(tableQuery<Parameter>('parameters').queryKey)?.rows.find(p => p.key === 'inflation_rate') ?? stored
      const rows = queryClient.getQueryData(tableQuery<Currency>('currencies').queryKey)?.rows ?? currencies
      const previous = rows.find(c => Number(c.inflation) === 1)
      const next = rows.find(c => c.code === shown.currency)
      if (!next) return
      const done = await send(async () => {
        try {
          if (value !== current?.value) {
            if (current) await apiSend(`/api/admin/parameters/${current.rowid}`, 'PUT', { value })
            else await apiSend('/api/admin/parameters', 'POST', { key: 'inflation_rate', value })
          }
          if (previous?.rowid !== next.rowid) {
            // Clear the old flag first: a failed move leaves none, never two inflation currencies.
            if (previous) await apiSend(`/api/admin/currencies/${previous.rowid}`, 'PUT', { inflation: 0 })
            await apiSend(`/api/admin/currencies/${next.rowid}`, 'PUT', { inflation: 1 })
          }
        } catch (error) {
          // These writes are separate: expose any partial save before a retry or Cancel.
          await Promise.all(WRITES.map(queryKey => queryClient.invalidateQueries({ queryKey })))
          void refreshSnapshot(queryClient)
          throw error
        }
      }, t('data.params.inflationSaved'), t('data.common.saveFailed'))
      if (done) setDraft(null)
    })
  }

  return (
    <SettingsSection title={t('data.params.inflation')} description={readOnly ? undefined : t('data.general.inflationHint')}>
      {readOnly ? (
        <p className="note note--help">{stored && flagged ? t('data.params.inflationShown', { rate: fmtNum(stored.value, 3), currency: flagged.code }) : '—'}</p>
      ) : (
        <form onSubmit={e => { e.preventDefault(); void save() }} aria-label={t('data.params.inflation')}>
          <fieldset className="general-fieldset" disabled={pending}>
            <div className="general-fields">
              <Field variant="inset" label={t('data.params.inflationInput')}>
                <NumberInput label={t('data.params.inflationInput')} unit={t('common.unit.percent')} value={shown.text}
                  onChange={text => setDraft({ ...shown, text })} decimals={3} signed invalid={invalid} />
              </Field>
              <Field variant="inset" label={t('common.currency')}>
                <Select value={shown.currency} onChange={e => setDraft({ ...shown, currency: e.target.value })}>
                  <option value="">—</option>
                  {currencies.map(c => <option key={c.rowid} value={c.code}>{c.code}</option>)}
                </Select>
              </Field>
            </div>
            <p className="note note--help">{t('data.general.inflationHelp')} <a className="link-accent" href={IMF_URL} target="_blank" rel="noopener noreferrer">{t('data.general.imf')}</a></p>
            {!stored || !flagged ? <Notice tone="warning" title={t('data.general.inflationMissingTitle')}>{t('data.general.inflationMissing')}</Notice> : null}
            <div className="general-actions">
              {changed && <button type="button" className="btn btn--ghost" onClick={() => setDraft(null)}>{t('common.cancel')}</button>}
              <button type="submit" className="btn btn--primary" disabled={!valid || !changed || unchanged}>{t('data.common.save')}</button>
            </div>
          </fieldset>
        </form>
      )}
    </SettingsSection>
  )
}
