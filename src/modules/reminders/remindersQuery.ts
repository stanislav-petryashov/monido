import { queryOptions } from '@tanstack/react-query'
import type { RemindersView } from '../../domain/api'
import { apiFetch } from '../../lib/api'
import { ADMIN_QUERY } from '../../pages/admin/adminQuery'

export const remindersQuery = queryOptions({
  queryKey: ['admin', 'reminders'],
  queryFn: async () => {
    const view = await apiFetch<RemindersView>('/api/reminders')
    if (!view.settings) throw new Error('/api/reminders answered without settings')
    return view
  },
  ...ADMIN_QUERY,
})
