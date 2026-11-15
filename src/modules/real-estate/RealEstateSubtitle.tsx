import { useTranslation } from 'react-i18next'
import { Freshness } from '../../components/layout/Freshness'
import { monthOf } from '../../domain/dates'
import { propertyTotals } from '../../domain/realEstate'
import { fmtCurrency, fmtMonth, fmtPct } from '../../lib/formatters'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import { useSnapshot } from '../../lib/useFinanceData'

/**
 * The Real estate title row's subtitle (`RouteDef.subtitle`): «N properties · total on <month> · share of assets» from the
 * snapshot's capital (the properties of the last closed month); the data month and rate (`Freshness`) until it has one.
 */
export function RealEstateSubtitle() {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const { data } = useSnapshot()
  const capital = data?.capital
  if (!data || !capital || capital.realEstate.length === 0) return <Freshness />
  const assetsKnown = data.capitalCoverage?.find(c => c.month === monthOf(capital.date))?.assetsKnown === true
  const { total, sharePct } = propertyTotals(capital.realEstate.map(r => r.valueBase), assetsKnown ? capital.assets : null)
  const reason = total === null ? t('modules.real_estate.noConversion') : sharePct === null ? t('modules.real_estate.assetsIncomplete') : null
  return <>{t('modules.real_estate.subtitle', {
    count: capital.realEstate.length,
    total: total === null ? '—' : hidden ? PRIVACY_MASK : fmtCurrency(total, data.baseCurrency),
    month: fmtMonth(monthOf(capital.date)),
    share: sharePct === null ? '—' : fmtPct(sharePct),
  })}{reason && <> · {reason}</>}</>
}
