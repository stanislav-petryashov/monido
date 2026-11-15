import { useTranslation } from 'react-i18next'
import { Link } from '../../components/ui/Link'

/** The empty state of the rating: no metric could be computed yet. */
export function HealthNoData() {
  const { t } = useTranslation()
  return (
    <div className="card card--p insight">
      <h2 className="insight__title">{t('modules.health.noData')}</h2>
      <p className="insight__text">
        {t('modules.health.noDataText')}{' '}
        <Link to="/close" className="link-accent">{t('modules.health.noDataLink')}</Link>.
      </p>
    </div>
  )
}
