import { createContext, useContext } from 'react'
import { readItem, writeItem } from './storage'

/** The sessionStorage key of the quick-view currency: one browser tab, gone with it. */
export const VIEW_STORAGE_KEY = 'fc.viewCurrency'

export function readStoredView(): string | null {
  return readItem('session', VIEW_STORAGE_KEY) || null
}

/** `null` — the family currency: the view is cleared. */
export function storeView(view: string | null): void {
  writeItem('session', VIEW_STORAGE_KEY, view)
}

interface CurrencyState {
  /** The currency of this tab's quick view; null — the dashboard shows the family currency. The server may answer in another (see CurrencyProvider) */
  view: string | null
  /** null, or the family currency itself, returns to the family currency */
  setView: (view: string | null) => void
}

export const CurrencyContext = createContext<CurrencyState>({ view: null, setView: () => {} })

/** The dashboard's quick-view currency, kept for this tab only; the family currency is the default. */
export function useDisplayCurrency() { return useContext(CurrencyContext) }
