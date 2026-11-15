import { lazyWithChunks } from '../../i18n/lazyWithChunks'
import { IconFlag, IconTarget } from '@tabler/icons-react'
import type { ClientModule } from '../client'
import { GoalsRingsCard } from './GoalsRingsCard'
import { GoalsPrimary, GoalsSubtitle } from './GoalsTitle'

// Pages sit right in the route: this file exports no component, and a named lazy here breaks fast refresh
export const goalsClient: ClientModule = {
  key: 'goals',
  icon: IconTarget,
  overview: {
    // one row when the savings fall short of what the goals need each month; nothing without goals to put money to
    todo: (s, t, fmt) => {
      // no row while the savings are unknown (income and expenses not tracked)
      const { surplusBase } = s.goals.plan
      if (s.goals.plan.allocations.length === 0 || surplusBase === null || surplusBase >= 0) return []
      return [{ key: 'goals-short', to: '/goals', icon: IconTarget, label: t('modules.goals.todoShort', { gap: fmt(-surplusBase) }) }]
    },
    // the rings card needs goals to draw
    cards: [{ order: 30, Card: GoalsRingsCard, visible: s => s.goals.items.length > 0 }],
  },
  routes: [
    {
      section: 'dashboard', path: '/goals', group: 'planning', bottomBar: 60, title: 'modules.goals.title', icon: IconTarget, order: 40,
      subtitle: GoalsSubtitle, primary: GoalsPrimary,
      page: lazyWithChunks(() => import('../../pages/Goals').then(m => ({ default: m.Goals })), 'planning', 'records'),
    },
    {
      section: 'data', path: '/goals/edit', area: '/goals', menu: false, navigationTitle: 'ux.editGoals', title: 'modules.goals.list', icon: IconFlag, order: 50,
      page: lazyWithChunks(() => import('./GoalsScreen').then(m => ({ default: m.GoalsScreen })), 'planning', 'records'),
    },
  ],
}
