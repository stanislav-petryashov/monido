import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { aggregateAvailability, cardOrder, type AvailabilityAssessment } from '../domain/availability'
import type { FinanceSnapshot } from '../domain/types'
import { apiFetch, apiSend } from './api'

/** Planning facts use native currencies; the aggregate always follows this snapshot's valuation. */
export function useAvailability(snapshot: FinanceSnapshot) {
  const client = useQueryClient()
  // under 'admin': a Records write (an account rename, a journal revert) refreshes it with the rest
  const query = useQuery({ queryKey: ['admin', 'availability'], queryFn: async ({ signal }) => {
    const data = await apiFetch<{ assessments: AvailabilityAssessment[] }>('/api/availability', { signal })
    if (!Array.isArray(data.assessments)) throw new Error('Invalid availability response')
    return data
  } })
  const invalidate = () => client.invalidateQueries({ queryKey: ['admin'] })
  const save = useMutation({ mutationFn: (assessment: AvailabilityAssessment) => apiSend('/api/availability', 'PUT', assessment), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (assessment: AvailabilityAssessment) => apiSend('/api/availability', 'DELETE', assessment), onSuccess: invalidate })
  const month = snapshot.asOf.capitalDate?.slice(0, 7) ?? null
  const complete = snapshot.capitalCoverage?.find(entry => entry.month === month)?.capitalKnown === true
  const aggregate = cardOrder(aggregateAvailability(month, snapshot.capital?.accounts ?? [], query.data?.assessments ?? [], complete))
  return { query, aggregate, save, remove }
}
