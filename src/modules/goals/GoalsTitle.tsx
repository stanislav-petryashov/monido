import { Suspense } from 'react'
import { Freshness } from '../../components/layout/Freshness'
import { lazyWithChunks } from '../../i18n/lazyWithChunks'

// the finding and «+ Goal» need the page's texts: loaded with the planning chunk, not with the first screen
const Finding = lazyWithChunks(() => import('../../pages/goals/TitleParts').then(m => ({ default: m.GoalsFinding })), 'planning')
const Add = lazyWithChunks(() => import('../../pages/goals/TitleParts').then(m => ({ default: m.AddGoal })), 'planning')

/** The Goals title row's subtitle (`RouteDef.subtitle`): the plan's finding; the data month and rate while it loads */
export function GoalsSubtitle() {
  return <Suspense fallback={<Freshness />}><Finding /></Suspense>
}

/** The title row's action (`RouteDef.primary`): «+ Goal» */
export function GoalsPrimary() {
  return <Suspense fallback={null}><Add /></Suspense>
}
