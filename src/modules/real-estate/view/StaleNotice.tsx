import { useTranslation } from 'react-i18next'

/** The latest valuation is older than the closed month's year: the month's assets count the property at that older one. */
export function StaleNotice({ year, month, valued }: { year: number; month: string; valued: number }) {
  const { t } = useTranslation()
  return <p className="re-stale">{t('modules.real_estate.stale', { year, month: t(`dates.monthOf.${Number(month.slice(5, 7))}`), valued })}</p>
}
