import { IconCalendarCheck } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Link } from '../../components/ui/Link'
import { fmtMonth } from '../../lib/formatters'
import { useAsOf } from '../../lib/useFinanceData'

/**
 * The Overview's primary action in the title row (`RouteDef.primary`): "Close <month>" to the wizard while a month is
 * open, nothing while every month is closed. The first open month is the one the wizard fills in.
 */
export function CloseMonthAction() {
  const { t } = useTranslation()
  const open = useAsOf().data?.openMonths ?? []
  if (open.length === 0) return null
  return (
    <Link to="/close" className="btn btn--primary">
      <span className="btn__well"><IconCalendarCheck size={16} stroke={2} aria-hidden="true" /></span>
      {t('pages.overview.closeCta', { month: fmtMonth(open[0]) })}
    </Link>
  )
}
