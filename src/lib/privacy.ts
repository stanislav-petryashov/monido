import { createContext, useContext } from 'react'
import { fmtCurrency, fmtMoney } from './formatters'
import { readItem, writeItem } from './storage'

/** What a hidden amount is drawn as. */
export const PRIVACY_MASK = '•••'

/** The localStorage key of privacy mode: per browser, not a family setting. @public */
export const PRIVACY_STORAGE_KEY = 'fc.privacy'

export function readStoredPrivacy(): boolean {
  return readItem('local', PRIVACY_STORAGE_KEY) === '1'
}

export function storePrivacy(hidden: boolean): void {
  writeItem('local', PRIVACY_STORAGE_KEY, hidden ? '1' : null)
}

interface PrivacyState {
  hidden: boolean
  toggle: () => void
}

export const PrivacyContext = createContext<PrivacyState>({ hidden: false, toggle: () => {} })

/** Privacy mode: while `hidden`, the dashboard draws money as PRIVACY_MASK (the shared `fmt` does it). */
export function usePrivacy(): PrivacyState { return useContext(PrivacyContext) }

/** An amount as a screen draws it: whole units in `currency` (`fmtCurrency`), two decimals without one (`fmtMoney`); PRIVACY_MASK in privacy mode */
export function useMoney(): (value: number, currency?: string) => string {
  const { hidden } = usePrivacy()
  return (value, currency) => hidden ? PRIVACY_MASK : currency === undefined ? fmtMoney(value) : fmtCurrency(value, currency)
}
