import { IconPlus } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Link } from '../../components/ui/Link'
import { setParam } from './address'

/** No goals yet: what a goal is and what the page will show, «+ Goal» for someone who may edit, and «Ask the Advisor» where it is */
export function EmptyGoals({ canEdit, ask }: { canEdit: boolean; ask: boolean }) {
  const { t } = useTranslation()
  return (
    <section className="card gl-empty">
      <h2 className="gl-empty__title">{t('goalsPage.empty.title')}</h2>
      <p>{t('goalsPage.empty.text')}</p>
      <p>{t('goalsPage.empty.fire')}</p>
      {(canEdit || ask) && (
        <div className="gl-empty__acts">
          {canEdit && (
            <button type="button" className="btn btn--primary" onClick={() => setParam('new', '1')}>
              <span className="btn__well"><IconPlus size={16} stroke={2} aria-hidden="true" /></span>{t('goalsPage.add')}
            </button>
          )}
          {ask && <Link to="/advisor/ask" className="btn btn--quiet">{t('goalsPage.askAdvisor')}</Link>}
        </div>
      )}
    </section>
  )
}
