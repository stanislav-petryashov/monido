// The Goals title row (RouteDef.subtitle and .primary): the plan's finding and «+ Goal». Loaded with the planning chunk
// (GoalsTitle.tsx), not with the first screen.
import { IconPlus } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Freshness } from '../../components/layout/Freshness'
import { useDashboard } from '../../lib/dashboardState'
import { useCan } from '../../lib/rights'
import { useSnapshot } from '../../lib/useFinanceData'
import { setParam } from './address'
import { monthRange } from './text'
import { averageMonths } from './view'

/** The subtitle: what is saved a month against what the goals need, and how many make their deadlines */
export function GoalsFinding() {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const snapshot = useSnapshot().data
  if (!snapshot) return <Freshness />
  const plan = snapshot.goals.plan
  const count = snapshot.goals.items.length
  if (count === 0) return <>{t('goalsPage.findingNone')}</>
  if (plan.monthlySavingsBase === null) return <>{t(snapshot.trackFlows ? 'goalsPage.findingNoMonths' : 'goalsPage.findingOff', { count, need: fmt(plan.totalRequiredBase) })}</>
  const onTime = plan.allocations.filter(a => a.status === 'on_track' || a.status === 'done').length
  return <>{t('goalsPage.finding', {
    saving: fmt(plan.monthlySavingsBase), months: monthRange(t, averageMonths(snapshot).map(r => r.month)),
    need: fmt(plan.totalRequiredBase), onTime, count,
  })}</>
}

/** The title row's «+ Goal», white (the page's one primary is the chosen goal's «Update saved»): opens the new-goal dialog through `?new=1`. None for a viewer */
export function AddGoal() {
  const { t } = useTranslation()
  const canEdit = useCan('edit')
  if (!canEdit) return null
  return (
    <button type="button" className="btn btn--ghost" onClick={() => setParam('new', '1')}>
      <IconPlus size={16} stroke={2} aria-hidden="true" />{t('goalsPage.add')}
    </button>
  )
}
