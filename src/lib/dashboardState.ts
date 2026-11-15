import { createContext, useContext } from 'react'
import { fmtCompactCurrency, fmtCurrency } from './formatters'
import type { FinanceSnapshot } from '../domain/types'
import type { PeriodKey } from './period'

interface DashboardState {
  /** The period of the cards that show time; one choice for all of them */
  period: PeriodKey
  /** The snapshot currency's rate to USD; null when the snapshot is in USD */
  rates: FinanceSnapshot['rates'] | undefined
  ratesLoading: boolean
  /** Format a snapshot amount in the snapshot's currency */
  fmt: (v: number) => string
  /** A short amount for a chart axis ('$780K'), with at most `digits` decimals of its unit (2); masked in privacy mode like `fmt` */
  fmtCompact: (v: number, digits?: number) => string
  /** The same format, never masked: for text that leaves the screen (the Claude prompts) */
  fmtPlain: (v: number) => string
  setPeriod: (p: PeriodKey) => void
}

export const DashboardContext = createContext<DashboardState>({
  period: '1y',
  rates: undefined,
  ratesLoading: false,
  fmt: (v) => fmtCurrency(v, 'USD'),
  fmtCompact: (v, digits) => fmtCompactCurrency(v, 'USD', digits),
  fmtPlain: (v) => fmtCurrency(v, 'USD'),
  setPeriod: () => {},
})

export function useDashboard() { return useContext(DashboardContext) }
