import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, languageName } from '../../i18n/languages'
import { DateFormatField } from './ui/DateFormatField'
import { useFamilySettings } from '../../lib/familySettings'
import { currencyName } from '../../lib/currencyNames'
import { useFamilyCurrency, useFamilyLanguage, useSaveFamilySetting } from '../../lib/familySettings'
import { Field } from './ui/Field'
import { Select } from './ui/Select'
import { useCan } from '../../lib/rights'
import { ViewOnlyNote } from '../../components/ui/ViewOnlyNote'
import { OptionPicker } from './ui/OptionPicker'
import { SettingsSection } from './ui/SettingsSection'

/** Language and currency choices save immediately; financial drafts have their own Save actions. */
export function FamilySettings({ currencies, children }: { currencies: string[]; children?: ReactNode }) {
  const { t, i18n } = useTranslation()
  const save = useSaveFamilySetting()
  const canManage = useCan('manage')
  const language = useFamilyLanguage()
  const currency = useFamilyCurrency()
  const settings = useFamilySettings()
  const options = currencies.includes(currency) || !currency ? currencies : [currency, ...currencies]
  const status = (save.isPending || save.isError) && <span className="note general-status" aria-live="polite">{t(save.isPending ? 'data.common.saving' : 'data.common.saveFailed')}</span>

  return <>
    <SettingsSection title={t('data.params.language')} description={t('data.general.languageHint')}>
      <ViewOnlyNote right="manage" />
      <div className="general-meta">
        {!canManage || !language ? <span>{language ? languageName(language) : ''}</span> : <OptionPicker aria-label={t('data.params.language')} options={LANGUAGES.map(l => ({ value: l, label: languageName(l) }))} value={language}
          disabled={save.isPending} onChange={l => save.mutate({ language: l })} />}
        {canManage && save.variables?.language !== undefined && status}
      </div>
      <DateFormatField value={settings.data?.dateFormat ?? 'dmy'} disabled={!canManage || !settings.data || save.isPending} onChange={dateFormat => save.mutate({ dateFormat })} />
      {canManage && save.variables?.dateFormat !== undefined && status}
    </SettingsSection>
    <SettingsSection title={t('data.params.currencies')}>
      {!canManage || !currency ? <p>{currency}</p> : <Field variant="inset" label={t('data.general.base')}>
        <Select value={currency} disabled={save.isPending} onChange={e => save.mutate({ currency: e.target.value })}>
          {options.map(c => <option key={c} value={c}>{c} · {currencyName(c, i18n.language)}</option>)}
        </Select>
      </Field>}
      <div className="general-meta general-meta--stacked"><span className="note">{t('data.general.baseHint')}</span>{canManage && save.variables?.currency !== undefined && status}</div>
      {children}
    </SettingsSection>
  </>
}
