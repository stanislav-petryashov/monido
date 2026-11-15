import { queryOptions } from '@tanstack/react-query'
import type { FamilyTelegramView } from '../../domain/familyTelegram'
import { apiFetch } from '../../lib/api'
import { ADMIN_QUERY } from '../admin/adminQuery'

export const familyTelegramQuery = queryOptions({
  queryKey: ['admin', 'family-telegram'],
  queryFn: () => apiFetch<FamilyTelegramView>('/api/family-telegram'),
  ...ADMIN_QUERY,
})
