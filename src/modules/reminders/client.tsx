import { lazy } from 'react'
import { IconBell } from '@tabler/icons-react'
import type { ClientModule } from '../client'

// The page sits right in the route: this file exports no component, and a named lazy here breaks fast refresh
export const remindersClient: ClientModule = {
  key: 'reminders',
  icon: IconBell,
  routes: [
    {
      section: 'settings', path: '/settings/reminders', area: '/settings/general', menu: false, title: 'modules.reminders.title', icon: IconBell, order: 20,
      page: lazy(() => import('./NotificationsPage').then(m => ({ default: m.NotificationsPage }))),
    },
  ],
}
