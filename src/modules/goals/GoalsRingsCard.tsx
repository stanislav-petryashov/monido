import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/Card'
import { Chip } from '../../components/ui/Chip'
import { Ring } from '../../components/ui/Ring'
import { monthOf } from '../../domain/dates'
import { useDashboard } from '../../lib/dashboardState'
import { fmtMonth } from '../../lib/formatters'
import { useSnapshot } from '../../lib/useFinanceData'

/** Rings across the card: more goals are on the Goals page */
const MAX_GOALS = 3

/** The goals module's card on Overview: a ring per goal (the first three, in the snapshot's order), what is saved of the target and by when; the shortfall as a chip. */
export function GoalsRingsCard() {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const goals = useSnapshot(s => s.goals).data
  if (!goals) return null
  const money = (v: number | null) => (v === null ? '—' : fmt(v))
  return (
    <Card className="rings-card">
      <div className="card-hd--row">
        <span className="card-hd">{t('modules.goals.title')}</span>
        {goals.plan.surplusBase !== null && goals.plan.surplusBase < 0 && <Chip color="warning">{t('modules.goals.todoShort', { gap: fmt(-goals.plan.surplusBase) })}</Chip>}
      </div>
      <ul className="rings">
        {goals.items.slice(0, MAX_GOALS).map(g => (
          <li key={g.id} className="rings__item">
            <Ring size={104} pct={g.targetBase && g.currentBase !== null ? (g.currentBase / g.targetBase) * 100 : 0} label={g.name} />
            <span className="rings__name" title={g.name}>{g.name}</span>
            <span className="rings__meta">{t('pages.overview.goalMeta', { current: money(g.currentBase), target: money(g.targetBase), month: fmtMonth(monthOf(g.target_date)) })}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
