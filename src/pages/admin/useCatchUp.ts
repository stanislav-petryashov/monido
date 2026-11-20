import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MonthCloseState } from '../../domain/api'
import { apiSend } from '../../lib/api'
import { refreshSnapshot } from '../../lib/useFinanceData'
import { catchUpQuery, monthCloseQuery } from './adminQuery'

/** The typed balances of one grid row, as the server takes them back */
export interface CatchUpCells { name: string; member: string; cells: (number | null)[] }

/**
 * The catch-up grid on "Close month": read only while two or more months are open (`enabled`); closing it writes every grid
 * month at once, then the wizard takes the newest one.
 */
export function useCatchUp(enabled: boolean) {
  const queryClient = useQueryClient()
  const query = useQuery({ ...catchUpQuery, enabled })
  const close = useMutation({
    mutationFn: (rows: CatchUpCells[]) => apiSend<MonthCloseState>('/api/month-close/catch-up', 'POST', { expectedRevision: query.data?.revision, rows }),
    onSuccess: next => {
      queryClient.setQueryData(monthCloseQuery.queryKey, next)
      void queryClient.invalidateQueries({ queryKey: catchUpQuery.queryKey })
      void refreshSnapshot(queryClient)
    },
  })
  return {
    // undefined while it loads, null when the grid is no longer offered (the wizard takes over)
    state: query.data, fetching: query.isFetching, failed: query.isError, refetch: query.refetch,
    // opening the table reads it afresh: a cached grid may hold months closed since
    reset: () => queryClient.removeQueries({ queryKey: catchUpQuery.queryKey }),
    close: close.mutateAsync, closing: close.isPending,
  }
}
