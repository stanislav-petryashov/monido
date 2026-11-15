import type { SetStateAction } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Row } from '../../domain/api'
import { tableQuery } from './adminQuery'

/**
 * The rows and columns of /api/admin/:table (the query ['admin', table]); loaded — the first load has finished,
 * successfully or not. setRows edits the cached rows for an optimistic write; `query` exposes read status and recovery.
 */
export function useAdminRows<R = Row>(table: string, enabled = true) {
  const queryClient = useQueryClient()
  const options = tableQuery<R>(table)
  const query = useQuery({ ...options, enabled })
  function setRows(update: SetStateAction<R[]>): void {
    queryClient.setQueryData(options.queryKey, old => {
      const rows = old?.rows ?? []
      return { columns: old?.columns ?? [], rows: typeof update === 'function' ? update(rows) : update }
    })
  }
  return { rows: query.data?.rows ?? [], columns: query.data?.columns ?? [], loaded: !query.isPending, setRows, query }
}
