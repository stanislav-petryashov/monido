import { useQuery, type QueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'
import { useDisplayCurrency } from './currencyState'
import type { FinanceSnapshot } from '../domain/types'
import { goalMetrics, overviewMetrics } from './snapshotSelectors'

// the signal lets refreshSnapshot abort a dropped load: Chrome queues a second GET for the same URL until the first answers
// no view: no `currency` in the request, the server answers in the family currency
function fetchSnapshot(view: string | null) {
  return ({ signal }: { signal: AbortSignal }): Promise<FinanceSnapshot> =>
    apiFetch<FinanceSnapshot>(view === null ? '/api/snapshot' : `/api/snapshot?currency=${encodeURIComponent(view)}`, { signal })
}

/** Every snapshot, in any currency, is cached under this prefix. */
export const SNAPSHOT_KEY_ROOT = ['snapshot'] as const

/** The cache key of the snapshot of a quick view (null — the family currency); tests put a ready snapshot under it. */
export const snapshotQueryKey = (view: string | null) => [...SNAPSHOT_KEY_ROOT, view] as const

/**
 * After a change the snapshot depends on: marks the snapshots in every currency stale and refetches the one shown.
 * A load still in flight is dropped first: the server read the data before the change, and while there is no snapshot
 * yet (the first load) invalidateQueries would join that load instead of starting a new one, and its answer would
 * count as fresh.
 */
export function refreshSnapshot(client: QueryClient): Promise<void> {
  // the cancel takes effect at once (only its promise settles later), so the refetch below starts anew
  void client.cancelQueries({ queryKey: SNAPSHOT_KEY_ROOT })
  return client.invalidateQueries({ queryKey: SNAPSHOT_KEY_ROOT })
}

/** One request per page load and view; every hook below is a view over the same cached snapshot. */
export function useSnapshot<T = FinanceSnapshot>(select?: (s: FinanceSnapshot) => T) {
  const { view } = useDisplayCurrency()
  return useQuery<FinanceSnapshot, Error, T>({ queryKey: snapshotQueryKey(view), queryFn: fetchSnapshot(view), select })
}

export const useOverviewMetrics = () => useSnapshot(overviewMetrics)
export const useHealthScore = () => useSnapshot(s => s.health)
export const useGoalMetrics = () => useSnapshot(goalMetrics)
export const useWarnings = () => useSnapshot(s => s.warnings)
export const useAsOf = () => useSnapshot(s => s.asOf)
