import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { FinanceSnapshot } from '../domain/types'
import { CurrencyContext, readStoredView, storeView, useDisplayCurrency } from './currencyState'
import { SNAPSHOT_KEY_ROOT, snapshotQueryKey, useSnapshot } from './useFinanceData'

/**
 * When the server answered in another currency than the quick view asked for (the currency was removed from the
 * project), the view is dropped and the dashboard returns to the family currency. An answer in the family currency
 * goes under the family key, so the switch does not fetch it again. Only a settled answer counts: a cached one being
 * refetched may be from before the currency was added back to the project.
 */
function AdoptSnapshotCurrency() {
  const client = useQueryClient()
  const { view, setView } = useDisplayCurrency()
  const { data: snapshot, isFetching } = useSnapshot()
  useEffect(() => {
    if (!snapshot || isFetching || view === null) return
    if (snapshot.baseCurrency !== view) {
      if (snapshot.baseCurrency === snapshot.familyCurrency && client.getQueryData(snapshotQueryKey(null)) === undefined) {
        client.setQueryData(snapshotQueryKey(null), snapshot)
      }
      setView(null)
    } else if (view === snapshot.familyCurrency) {
      setView(null)
    }
  }, [client, snapshot, isFetching, view, setView])
  return null
}

/** The dashboard's quick-view currency; must be inside QueryClientProvider and wrap DashboardProvider. */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const [view, setState] = useState(readStoredView)
  const setView = useCallback((next: string | null) => {
    // the family currency is not a view: it is what the dashboard shows when there is none
    const family = client.getQueriesData<FinanceSnapshot>({ queryKey: SNAPSHOT_KEY_ROOT }).find(([, s]) => s)?.[1]?.familyCurrency
    const value = next === family ? null : next
    storeView(value)
    setState(value)
  }, [client])
  return (
    <CurrencyContext.Provider value={{ view, setView }}>
      <AdoptSnapshotCurrency />
      {children}
    </CurrencyContext.Provider>
  )
}
