import { AvailabilityPanel } from '../components/finance/AvailabilityPanel'
import { PageError } from '../components/PageError'
import { PageSkeleton } from '../components/ui/Skeleton'
import { useSnapshot } from '../lib/useFinanceData'

/** What the family can actually spend: each account's confirmed balance split into free money, reserve, goals and commitments. */
export function AvailableMoney() {
  const snapshot = useSnapshot()
  if (snapshot.isLoading) return <PageSkeleton />
  if (snapshot.error || !snapshot.data) return <PageError onRetry={() => void snapshot.refetch()} retrying={snapshot.isFetching} />
  return <AvailabilityPanel snapshot={snapshot.data} />
}
