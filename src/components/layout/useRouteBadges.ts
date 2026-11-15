import { useAsOf } from '../../lib/useFinanceData'
import type { RouteBadge } from '../../routes'

/** The counts beside the items that ask for one (RouteDef.badge); until the snapshot loads, none. */
export function useRouteBadges(): Record<RouteBadge, number> {
  return { openMonths: useAsOf().data?.openMonths.length ?? 0 }
}
