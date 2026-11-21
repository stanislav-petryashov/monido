import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/Card'
import { Ring } from '../../components/ui/Ring'
import { monthOf } from '../../domain/dates'
import { useDashboard } from '../../lib/dashboardState'
import { fmtMonth } from '../../lib/formatters'
import { useSnapshot } from '../../lib/useFinanceData'

/** Rings across the card: more goals are on the Goals page */
const MAX_GOALS = 3

/** The goals module's card on Overview: a ring per goal (the first three, in the snapshot's order), what is saved of the target and the expected date for a delayed goal. */
export function GoalsRingsCard() {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const goals = useSnapshot(s => s.goals).data
  if (!goals) return null
  const money = (v: number | null) => (v === null ? '—' : fmt(v))
  return (
    <Card className="rings-card">
      <h3 className="overview__title">{t('pages.overview.family.goals')}</h3>
      <ul className="rings">
        {goals.items.slice(0, MAX_GOALS).map(g => (
          <li key={g.id} className="rings__item">
            <Ring size={104} pct={g.targetBase && g.currentBase !== null ? (g.currentBase / g.targetBase) * 100 : 0} label={g.name} />
            <span className="rings__name" title={g.name}>{g.name}</span>
            <span className="rings__meta">{t('pages.overview.family.amount', { current: money(g.currentBase), target: money(g.targetBase) })}</span>
          </li>
        ))}
      </ul>
      {goals.plan.allocations.filter(a => a.status === 'at_risk' && a.projectedDate).map(a => (
        <p className="overview-deadline" key={a.goal.id}>
          <strong>{a.goal.name}</strong>
          {t('pages.overview.family.deadline', { target: fmtMonth(monthOf(a.goal.target_date)), projected: fmtMonth(a.projectedDate!) })}
        </p>
      ))}
    </Card>
  )
}
