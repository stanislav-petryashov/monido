import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { ANNUAL_RETURN, MAX_EXPECTED_RETURN_PCT } from '../../domain/goals'
import { apiSend } from '../../lib/api'
import { fmtNum } from '../../lib/formatters'
import { tableQuery, useSnapshotWrite } from './adminQuery'
import type { Parameter } from './shared'
import { parseDecimal } from './amount'
import { Field } from './ui/Field'
import { NumberInput } from './ui/NumberInput'
import { SettingsSection } from './ui/SettingsSection'
import { useSingleFlight } from './useSingleFlight'

const WRITES = [tableQuery('parameters').queryKey]
const DEFAULT_PCT = ANNUAL_RETURN * 100

/**
 * The yearly return the family expects from what the independence goal holds: the `expected_return` parameter (created on
 * the first save; 8% until then, expectedReturn). The goal's forecast grows at it and its band is it ∓ 3 points. Every
 * write refreshes the snapshot.
 */
export function ExpectedReturnSettings({ parameters, readOnly }: { parameters: Parameter[]; readOnly: boolean }) {
  const { t } = useTranslation()
  const send = useSnapshotWrite(WRITES)
  const queryClient = useQueryClient()
  const [run, pending] = useSingleFlight()
  const stored = parameters.find(p => p.key === 'expected_return') ?? null
  const saved = stored ? String(stored.value) : ''
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? saved
  const value = parseDecimal(shown)
  const invalid = shown !== '' && (value === null || value < 0 || value > MAX_EXPECTED_RETURN_PCT)
  const changed = shown !== saved
  const valid = value !== null && !invalid && value !== stored?.value

  async function save() {
    if (readOnly || !valid || !changed) return
    await run(async () => {
      const current = queryClient.getQueryData(tableQuery<Parameter>('parameters').queryKey)?.rows.find(p => p.key === 'expected_return') ?? stored
      const done = await send(async () => {
        if (current) await apiSend(`/api/admin/parameters/${current.rowid}`, 'PUT', { value })
        else await apiSend('/api/admin/parameters', 'POST', { key: 'expected_return', value })
      }, t('data.params.returnSaved'), t('data.common.saveFailed'))
      if (done) setDraft(null)
    })
  }

  const inUse = fmtNum(stored ? stored.value : DEFAULT_PCT, 1)
  return (
    <SettingsSection title={t('data.params.return')} description={readOnly ? undefined : t('data.params.returnHint')}>
      {readOnly ? (
        <p className="note note--help">{t('data.params.returnShown', { rate: inUse })}</p>
      ) : (
        <form onSubmit={e => { e.preventDefault(); void save() }} aria-label={t('data.params.return')}>
          <fieldset className="general-fieldset" disabled={pending}>
            <div className="general-fields">
              <Field variant="inset" label={t('data.params.returnInput')}>
                <NumberInput label={t('data.params.returnInput')} unit={t('common.unit.percent')} value={shown} placeholder={fmtNum(DEFAULT_PCT, 0)}
                  onChange={setDraft} decimals={1} invalid={invalid} invalidMessage={t('data.params.returnInvalid', { max: MAX_EXPECTED_RETURN_PCT })} />
              </Field>
            </div>
            <p className="note note--help">{t(stored ? 'data.params.returnInUse' : 'data.params.returnDefault', { rate: inUse })}</p>
            <div className="general-actions">
              {changed && <button type="button" className="btn btn--ghost" onClick={() => setDraft(null)}>{t('common.cancel')}</button>}
              <button type="submit" className="btn btn--primary" disabled={!valid || !changed}>{t('data.common.save')}</button>
            </div>
          </fieldset>
        </form>
      )}
    </SettingsSection>
  )
}
