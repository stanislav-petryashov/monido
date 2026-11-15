// The council's proposals read, shared by the Advisor page (useProposals.ts) and the menu's second floor (useProposalsTodo.ts):
// on its own so the floor, in the initial bundle, reaches none of the lazy page's texts.
import { queryOptions } from '@tanstack/react-query'
import type { ProposalsView } from '../../domain/api'
import { apiFetch } from '../../lib/api'
import { ADMIN_QUERY } from '../../pages/admin/adminQuery'

export const PROPOSALS_URL = '/api/advisor/proposals'

/** GET /api/advisor/proposals, read afresh on every visit */
export const proposalsQuery = queryOptions({
  queryKey: ['advisor', 'proposals'],
  queryFn: () => apiFetch<ProposalsView>(PROPOSALS_URL),
  ...ADMIN_QUERY,
})
