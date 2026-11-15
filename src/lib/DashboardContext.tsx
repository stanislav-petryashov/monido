import { DashboardContext } from './dashboardState'
import { readStoredPeriod, storePeriod, type PeriodKey } from './period'
import { useState, type ReactNode } from 'react'
import { useDisplayCurrency } from './currencyState'
import { fmtCompactCurrency, fmtCurrency } from './formatters'
import { PRIVACY_MASK, usePrivacy } from './privacy'
import { useSnapshot } from './useFinanceData'

/** Must be inside QueryClientProvider (useSnapshot uses useQuery) and CurrencyProvider */
export function DashboardProvider({ children }: { children: ReactNode }) {
  const { view } = useDisplayCurrency()
  const { hidden } = usePrivacy()
  const [period, setPeriodState] = useState<PeriodKey>(readStoredPeriod)
  const setPeriod = (p: PeriodKey) => { setPeriodState(p); storePeriod(p) }
  const snapshotView = useSnapshot(s => ({ rates: s.rates, baseCurrency: s.baseCurrency }))
  const rates = snapshotView.data?.rates ?? undefined
  const ratesLoading = snapshotView.isLoading

  // Snapshot amounts are already in the snapshot's currency: the client only formats them (or masks them in privacy mode).
  const base = snapshotView.data?.baseCurrency ?? view ?? 'USD'
  const fmtPlain = (v: number) => fmtCurrency(v, base)
  const fmt = (v: number) => (hidden ? PRIVACY_MASK : fmtPlain(v))
  const fmtCompact = (v: number, digits?: number) => (hidden ? PRIVACY_MASK : fmtCompactCurrency(v, base, digits))

  return (
    <DashboardContext.Provider value={{
      period, rates, ratesLoading, fmt, fmtCompact, fmtPlain, setPeriod,
    }}>
      {children}
    </DashboardContext.Provider>
  )
}
