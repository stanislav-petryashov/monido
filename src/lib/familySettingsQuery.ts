import { queryOptions } from '@tanstack/react-query'
import type { FamilySettings } from '../domain/api'
import { ADMIN_QUERY } from '../pages/admin/adminQuery'
import { apiFetch } from './api'
import { applyDateFormat } from './dateFormat'

export const settingsQuery = queryOptions({
  queryKey: ['admin', 'settings'] as const,
  queryFn: async () => {
    const settings = await apiFetch<FamilySettings>('/api/settings')
    applyDateFormat(settings.dateFormat)
    return settings
  },
  ...ADMIN_QUERY,
})
