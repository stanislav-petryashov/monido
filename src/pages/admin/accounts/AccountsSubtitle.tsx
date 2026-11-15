import { useTranslation } from 'react-i18next'
import { Freshness } from '../../../components/layout/Freshness'
import { monthOf } from '../../../domain/dates'
import { fmtCurrency, fmtMonth, fmtPct } from '../../../lib/formatters'
import { PRIVACY_MASK, usePrivacy } from '../../../lib/privacy'
import { useSnapshot } from '../../../lib/useFinanceData'

/**
 * The Accounts title row's subtitle (`RouteDef.subtitle`): «N accounts · total on <month> · share of assets» from the
 * snapshot's capital (the accounts of the last closed month); the data month and rate (`Freshness`) until it has one.
 */
export function AccountsSubtitle() {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const { data } = useSnapshot()
  const capital = data?.capital
  if (!data || !capital || capital.accounts.length === 0) return <Freshness />
  const total = capital.accounts.reduce((s, a) => s + (a.valueBase ?? 0), 0)
  // an account without a rate is named, not counted as 0 silently
  const noRate = capital.accounts.filter(a => a.valueBase === null).length
  return <>{t('pages.accounts.subtitle', {
    count: capital.accounts.length,
    total: hidden ? PRIVACY_MASK : fmtCurrency(total, data.baseCurrency),
    month: fmtMonth(monthOf(capital.date)),
    share: fmtPct(capital.assets ? (total / capital.assets) * 100 : 0),
  })}{noRate > 0 && ` · ${t('pages.accounts.noRate', { count: noRate })}`}</>
}
