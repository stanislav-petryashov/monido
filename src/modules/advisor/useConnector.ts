// The Advisor page's and the consent screen's reads and writes: the connector's state, the guide, the consent request.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ConnectorView, ConsentRequest } from '../../domain/api'
import { t } from '../../i18n/client'
import { apiFetch, apiSend } from '../../lib/api'
import { useToast } from '../../lib/notifyState'
import { useAuth } from '../../lib/authState'
import { ADMIN_QUERY } from '../../pages/admin/adminQuery'

const connectorQuery = (mode: string | null, member: string | null) => queryOptions({
  queryKey: ['advisor', 'connector', mode, member],
  queryFn: ({ signal }) => apiFetch<ConnectorView>('/api/advisor/connector', { signal }),
  ...ADMIN_QUERY,
})

/**
 * Whether Claude's connector works here, the address to paste into Claude and who is connected: read on mount, on
 * returning to the tab or the network, and every `interval` ms while the caller waits for a connection.
 */
export function useConnector(interval: number | false) {
  const { mode, me } = useAuth()
  return useQuery({
    ...connectorQuery(mode, me?.name ?? null),
    refetchInterval: interval,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

/** "Disconnect me": revokes the caller's tokens; the answer is the new state. */
export function useDisconnect() {
  const { mode, me } = useAuth()
  const query = connectorQuery(mode, me?.name ?? null)
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => apiSend<ConnectorView>('/api/advisor/connector/mine', 'DELETE'),
    onMutate: () => queryClient.cancelQueries({ queryKey: query.queryKey }),
    onSuccess: async view => {
      // A poll started during revocation must not restore the old grant.
      await queryClient.cancelQueries({ queryKey: query.queryKey })
      queryClient.setQueryData(query.queryKey, view)
    },
    onError: e => toast.error(t('modules.advisor.connect.disconnectFailed'), e),
  })
}

/** The full English guide, fetched once it is asked for (the same text Claude gets from the connector). */
export function useGuide(enabled: boolean) {
  return useQuery({
    queryKey: ['advisor', 'guide'],
    queryFn: async () => (await apiSend<{ result: { guide: string } }>('/api/advisor/tools/get_advisor_guide', 'POST', {})).result.guide,
    enabled,
    ...ADMIN_QUERY,
    staleTime: Infinity,
  })
}

const requestUrl = (id: string) => `/api/advisor/oauth/requests/${encodeURIComponent(id)}`

/** What the consent screen shows about the pending request (404 `advisor.request_expired` once it is gone). */
export function useConsentRequest(id: string) {
  return useQuery({
    queryKey: ['advisor', 'consent', id],
    queryFn: () => apiFetch<ConsentRequest>(requestUrl(id)),
    ...ADMIN_QUERY,
  })
}

/** Answers the pending request; the server returns where to send the browser. */
export const answerConsent = (id: string, approve: boolean) => apiSend<{ redirect: string }>(requestUrl(id), 'POST', { approve })

/** The one place the page leaves for Claude (a seam: tests replace `go`). */
export const browser = {
  go(url: string): void { window.location.assign(url) },
}
