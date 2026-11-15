import type { ReactElement } from 'react'
import { render, waitFor, fireEvent, type RenderOptions, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CurrencyProvider } from '../../src/lib/CurrencyProvider'
import { PrivacyProvider } from '../../src/lib/PrivacyProvider'
import { DashboardProvider } from '../../src/lib/DashboardContext'
import { NotifyProvider } from '../../src/components/NotifyProvider'
import { snapshotQueryKey } from '../../src/lib/useFinanceData'
import type { FinanceSnapshot } from '../../src/domain/types'
import { queryClient } from '../../src/lib/queryClient'

/** A query client for tests: no retries, so an error arrives at once. */
export function testClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

/** A fresh client with the app's defaults (five-minute staleTime, one retry): to check that the Data screens override them. */
export function appClient() {
  return new QueryClient({ defaultOptions: queryClient.getDefaultOptions() })
}

/**
 * A client with a ready snapshot in the cache, under the family-currency key the dashboard starts with when no quick view is set: pages
 * and cards read it without waiting for /api/snapshot. Without a snapshot it is the loading state.
 */
export function snapshotClient(snapshot?: FinanceSnapshot) {
  const client = testClient()
  if (snapshot) client.setQueryData(snapshotQueryKey(null), snapshot)
  return client
}

/**
 * Waits until `client` has no read and no write in flight: what a "writes nothing" check waits for instead of a fixed
 * pause (a write the screen started would still be counted as running).
 */
export const settled = (client: QueryClient) => waitFor(() => expect(client.isFetching() + client.isMutating()).toBe(0))

interface WrapOptions extends Omit<RenderOptions, 'queries'> {
  client?: QueryClient
  /** Wrap in CurrencyProvider + DashboardProvider (currency, period, fmt) */
  dashboard?: boolean
  /** Wrap in NotifyProvider (notifications and confirmations) */
  notify?: boolean
}

function wrap(ui: ReactElement, { client = testClient(), dashboard = false, notify = false, ...options }: WrapOptions): RenderResult {
  let tree = ui
  if (notify) tree = <NotifyProvider>{tree}</NotifyProvider>
  if (dashboard) tree = <PrivacyProvider><CurrencyProvider><DashboardProvider>{tree}</DashboardProvider></CurrencyProvider></PrivacyProvider>
  return render(<QueryClientProvider client={client}>{tree}</QueryClientProvider>, options)
}

/** QueryClientProvider only: for components that need the query cache but not the dashboard providers. */
export function renderWithClient(ui: ReactElement, options: WrapOptions = {}) {
  return wrap(ui, options)
}

/** A dashboard page or card: QueryClientProvider with a snapshot in the cache + the dashboard providers. */
export function renderWithSnapshot(ui: ReactElement, snapshot?: FinanceSnapshot, options: WrapOptions = {}) {
  return wrap(ui, { client: snapshotClient(snapshot), dashboard: true, ...options })
}

/**
 * For a page rendered with renderWithSnapshot: every request stays pending, so the page draws the snapshot in the cache
 * and a refetch never replaces it. Undone before the next test (unstubGlobals).
 */
export function stubSnapshotFetch() {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
}

/** A Data section screen: QueryClientProvider + NotifyProvider. */
export function renderAdmin(ui: ReactElement, options: WrapOptions = {}) {
  return wrap(ui, { notify: true, ...options })
}

/** The page text with ordinary spaces instead of non-breaking ones, to compare sums. */
export const pageText = (container: HTMLElement) => (container.textContent ?? '').replace(/\s/g, ' ')

/** Privacy mode on for the test: a localStorage that holds `fc.privacy`. Undo with vi.unstubAllGlobals(). */
export function stubPrivacyOn() {
  vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'fc.privacy' ? '1' : null), setItem: () => {}, removeItem: () => {}, clear: () => {} })
}

/** Open secondary sections explicitly when asserting their financial content. */
export function expandDisclosures(container: ParentNode = document) {
  for (const details of container.querySelectorAll<HTMLDetailsElement>('details.disclosure')) {
    details.open = true
    fireEvent(details, new Event('toggle'))
  }
}

export function renderExpandedSnapshot(...args: Parameters<typeof renderWithSnapshot>) {
  const result = renderWithSnapshot(...args)
  expandDisclosures(result.container)
  return result
}
