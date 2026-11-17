import { ManualAmountBlock } from '../../modules/cashflow/ManualAmount'
import '../settings/settings-navigation.css'
import { useTranslation } from 'react-i18next'
import { AdminReadNotice } from './ui/AdminReadNotice'
import { useAdminRows } from './useAdminRows'
import type { Currency, Parameter } from './shared'
import { CurrenciesBlock } from './CurrenciesBlock'
import { SettingsSection } from './ui/SettingsSection'
import { ManualRates } from './ManualRates'
import { InflationSettings } from './InflationSettings'
import { ExpectedReturnSettings } from './ExpectedReturnSettings'
import { FamilySettings } from './FamilySettings'
import { useFamilyCurrency, useFamilySettings, useSaveFamilySetting } from '../../lib/familySettings'
import { Switch } from '../../components/ui/Switch'
import { useCan } from '../../lib/rights'
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote'

/** "Track income and expenses": one family parameter (manage right). Off, months close with balances only and the dashboard leaves the flows out. */
function TrackFlowsSetting({ on }: { on: boolean }) {
  const { t } = useTranslation()
  const save = useSaveFamilySetting()
  const canManage = useCan('manage')
  return (
    <SettingsSection title={t('data.params.trackFlowsTitle')}>
      <label className="switch-field">
        <Switch checked={on} label={t('data.general.trackFlows')} disabled={!canManage || save.isPending} onChange={next => save.mutate({ trackFlows: next })} />
        <span>{t('data.general.trackFlows')}</span>
      </label>
      {(save.isPending || save.isError) && <p className="note general-status" aria-live="polite">{t(save.isPending ? 'data.common.saving' : 'data.common.saveFailed')}</p>}
      {on ? <ManualAmountBlock embedded /> : <p className="note">{t('data.general.trackOff')}</p>}
    </SettingsSection>
  )
}

function GeneralParameters() {
  const { t } = useTranslation()
  const parameters = useAdminRows<Parameter>('parameters')
  const currencyRows = useAdminRows<Currency>('currencies')
  const settings = useFamilySettings()
  const familyCurrency = useFamilyCurrency()
  const canEdit = useCan('edit')
  const rates = useAdminRows('fx_manual_rates')
  const params = parameters.rows
  const currencies = [...currencyRows.rows].sort((a, b) => a.code.localeCompare(b.code))

  return (
    <div className="general-settings">
      <AdminReadNotice queries={[settings, parameters.query, currencyRows.query, rates.query]} />
      <ViewOnlyNote right="edit" />
      {currencyRows.query.data !== undefined && settings.data !== undefined && <FamilySettings currencies={currencies.map(c => c.code)}>
        <p className="note general-subtitle">{t('data.general.accountCurrencies')}</p>
        <CurrenciesBlock currencies={currencies} lockedLabel={t('data.general.forTotals')} inputLabel={t('data.general.addCurrency')} readOnly={!canEdit} lockedCode={familyCurrency || undefined} />
        {rates.query.data !== undefined && <ManualRates embedded currencies={currencies.map(c => c.code)} readOnly={!canEdit} />}
      </FamilySettings>}
      {settings.data && <TrackFlowsSetting on={settings.data.trackFlows} />}
      {parameters.query.data !== undefined && currencyRows.query.data !== undefined && <InflationSettings parameters={params} currencies={currencies} readOnly={!canEdit} />}
      {parameters.query.data !== undefined && <ExpectedReturnSettings parameters={params} readOnly={!canEdit} />}
    </div>
  )
}

/** Settings → General: language and currency, the figures for calculations, currencies and rates. */
export function ParametersView() {
  return <div className="parameters-content"><GeneralParameters /></div>
}
