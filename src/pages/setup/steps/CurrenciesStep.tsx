import { type FormEvent } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Loading } from '../../../components/ui/Loading'
import { Disclosure } from '../../../components/ui/Disclosure'
import { useFamilyCurrency, useFamilySettings, useSaveFamilySetting } from '../../../lib/familySettings'
import { currencyName } from '../../../lib/currencyNames'
import { CurrenciesBlock } from '../../admin/CurrenciesBlock'
import { AdminReadNotice } from '../../admin/ui/AdminReadNotice'
import { withCurrent, type Currency } from '../../admin/shared'
import { useAdminRows } from '../../admin/useAdminRows'
import { useSingleFlight } from '../../admin/useSingleFlight'
import { Field } from '../../admin/ui/Field'
import { Select } from '../../admin/ui/Select'
import { SetupBar, type StepProps } from '../SetupBar'
import { keepAddFieldEnter } from '../addFieldEnter'
import { Notice } from '../../../components/ui/Notice'

/** Every currency edit saves immediately; the last action only finishes setup. */
export function CurrenciesStep({ wizard }: StepProps) {
  const { t, i18n } = useTranslation()
  const Heading = wizard.again ? 'h2' : 'h1'
  const settings = useFamilySettings()
  const rows = useAdminRows<Currency>('currencies')
  const save = useSaveFamilySetting()
  const stored = useFamilyCurrency()
  const writes = useIsMutating()
  const [runFinish, finishing] = useSingleFlight()
  const ready = settings.data !== undefined && rows.loaded
  const failed = (settings.isError && !settings.data) || (rows.query.isError && !rows.query.data)
  const options = withCurrent(stored, rows.rows.map(c => c.code))

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready || failed || writes || finishing) return
    void runFinish(() => wizard.finish('/'))
  }

  return (
    <form className="form-stack" onSubmit={submit} onKeyDown={keepAddFieldEnter}>
      <Heading className="setup-card__title" tabIndex={-1}>{t('data.setup.currencies.title')}</Heading>
      <p className="setup-card__intro">{t('data.setup.currencies.text')}</p>
      <AdminReadNotice queries={[settings, rows.query]} />
      {ready && !failed ? (
        <fieldset className="setup-fields form-stack" disabled={save.isPending || finishing} aria-label={t('data.setup.currencies.title')}>
          <div className="setup-base-currency">
            <Field variant="inset" label={t('data.setup.currencies.base')} hint={t('data.setup.currencies.baseHint')}>
              <Select value={stored} disabled={writes > 0} onChange={e => {
                if (e.target.value !== stored) save.mutate({ currency: e.target.value })
              }}>
                {options.map(code => <option key={code} value={code}>{code} · {currencyName(code, i18n.language)}</option>)}
              </Select>
            </Field>
          </div>
          <fieldset className="setup-currencies">
            <legend>{t('data.setup.currencies.accounts')}</legend>
            <CurrenciesBlock currencies={rows.rows} lockedCode={stored} inputLabel={t('data.setup.currencies.add')} />
          </fieldset>
          <Disclosure variant="inline" className="setup-rates" title={t('data.setup.currencies.ratesTitle')}>
            <Notice as="p" tone="info">{t('data.setup.currencies.ratesHint')}</Notice>
          </Disclosure>
        </fieldset>
      ) : !failed ? <Loading className="reminder-state" /> : null}
      <SetupBar onBack={wizard.back} primary={t('data.setup.complete')} disabled={!ready || failed || writes > 0} busy={finishing} />
    </form>
  )
}
