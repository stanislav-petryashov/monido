import { queryOptions, useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { SetupRequest, SetupView } from '../domain/api'
import { apiFetch, apiSend } from './api'
import { reloadAuth, setAuth } from './authState'
import { writeItem } from './storage'

/** The step the setup wizard is on, per tab: its key, never its number (a hidden step or a changed order cannot land elsewhere). */
export const STEP_STORAGE_KEY = 'fc.setupStep'

/**
 * Forgets the wizard's stored step: every way out of it (finish, skip, the test-data load) and the wipe, so the next run
 * starts at Welcome. Blocked storage is tolerated. Here and not in the wizard: the danger zone calls it without the wizard's code.
 */
export function clearStoredStep(): void {
  writeItem('session', STEP_STORAGE_KEY, null)
}

/**
 * GET /api/setup. The ADMIN_QUERY values are written out here: adminQuery.ts words a records-chunk toast and the shell
 * (the gate) must not reach it.
 */
export const setupQuery = queryOptions({
  queryKey: ['admin', 'setup'],
  queryFn: () => apiFetch<SetupView>('/api/setup'),
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
})

/** The wizard's read of the setup state. */
export function useSetup(): UseQueryResult<SetupView> {
  return useQuery(setupQuery)
}

/**
 * PUT /api/setup; `auth.setup` takes the answer's state at once (the gate follows it, also when the re-read fails), then the
 * auth answer is read again and the setup read is dropped. No toast.
 */
export function useSaveSetup(): UseMutationResult<SetupView, Error, SetupRequest['state']> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (state: SetupRequest['state']) => {
      const view = await apiSend<SetupView>('/api/setup', 'PUT', { state })
      // the answer first: a failed re-read of /api/auth must not leave the gate on the wizard
      setAuth({ setup: view.state })
      await reloadAuth()
      return view
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'setup'] }),
  })
}
