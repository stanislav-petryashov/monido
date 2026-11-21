import { lazyWithChunks } from '../../i18n/lazyWithChunks'
import { IconHeartbeat } from '@tabler/icons-react'
import { HEALTH_KEYS, isIndependenceMetric } from '../../domain/health'
import type { ClientModule } from '../client'
import { StabilityCard } from './StabilityCard'

// The page sits right in the route: this file exports no component, and a named lazy here breaks fast refresh
export const healthClient: ClientModule = {
  key: 'health',
  icon: IconHeartbeat,
  overview: {
    // only what is really wrong: a stability metric in the red (the amber ones stay on the Health page; independence is not a to-do),
    // each named by its title
    todo: (s, t) => (s.health
      ? HEALTH_KEYS
        .filter(key => s.health!.metrics[key]?.zone === 'red' && !isIndependenceMetric(key))
        .map(key => ({ key: `health-${key}`, to: '/health', icon: IconHeartbeat, label: t('modules.health.todoMetric', { name: t(`metrics.${key}.title`) }) }))
      : []),
    cards: [{ placement: 'family', order: 40, Card: StabilityCard }],
  },
  routes: [{
    section: 'dashboard', path: '/health', group: 'planning', bottomBar: 70, bottomBarTitle: 'modules.health.short', title: 'modules.health.route', icon: IconHeartbeat, order: 50,
    page: lazyWithChunks(() => import('./HealthPage').then(m => ({ default: m.HealthPage })), 'planning'),
  }],
}
