import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { useAvailability } from '../../src/lib/useAvailability'
import { makeSnapshot } from '../helpers/snapshot'
import { buildSnapshot } from '../../src/domain/snapshot'
import type { FinanceSnapshot } from '../../src/domain/types'
const account = { name: 'Cash', member: '', currency: 'USD', class: 'bank' as const, value: 100, valueBase: 100 }
const assessment = { month: '2024-03', name: 'Cash', member: '', currency: 'USD', balance: 100, available: true, reserve: 20, goals: 0, commitments: 0 }
function aggregate(capitalCoverage?: FinanceSnapshot['capitalCoverage']) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(['admin', 'availability'], { assessments: [assessment] })
  const base = makeSnapshot()
  const snapshot = makeSnapshot({ capital: { ...base.capital!, accounts: [account] }, asOf: { ...base.asOf, capitalDate: '2024-03-31' }, warnings: [], capitalCoverage })
  return renderHook(() => useAvailability(snapshot), { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children) }).result.current.aggregate
}
it('keeps its answers under the Records key: a Records-wide refresh reaches them', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(['admin', 'availability'], { assessments: [assessment] })
  const snapshot = { capital: { accounts: [account] }, asOf: { capitalDate: '2024-03-31' }, warnings: [] } as unknown as FinanceSnapshot
  const hook = renderHook(() => useAvailability(snapshot), { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children) })
  expect(hook.result.current.query.data?.assessments).toEqual([assessment])
  await client.invalidateQueries({ queryKey: ['admin'], refetchType: 'none' })
  expect(client.getQueryState(['admin', 'availability'])?.isInvalidated).toBe(true)
})
describe('useAvailability completeness', () => {
  it.each([false, true])('uses canonical coverage (known=%s)', capitalKnown => {
    const result = aggregate([{ month: '2024-03', assetsKnown: capitalKnown, liquidKnown: capitalKnown, capitalKnown, missingAccounts: [] }])
    expect(result.free).toBe(capitalKnown ? 80 : null)
    expect(result.incomplete).toBe(!capitalKnown)
  })
  it.each([undefined, []])('does not interpret absent capital coverage as complete', coverage => {
    expect(aggregate(coverage)).toMatchObject({ incomplete: true, free: null, available: null, reserve: null, goals: null, commitments: null })
  })
  it('rejects a built snapshot after an unclosed account disappears for two months', () => {
    const months = ['2024-01', '2024-02', '2024-03']
    const snapshot = buildSnapshot({ baseCurrency: 'USD', familyCurrency: 'USD', today: new Date('2024-04-15'), rateAt: () => ({}), rows: {
      assets: [{ date: '2024-01-31', name: 'Missing', member: '', currency: 'USD', class: 'bank' as const, value: 100 }, ...months.map(month => ({ ...account, date: `${month}-28` }))],
      cashflow: [], loanPayments: [], spendingCategories: [], categorySpending: [], flowLines: [], manualMandatory: null, members: [], realEstate: [], loans: [], earlyPayments: [], goals: [], parameters: {},
      closedMonths: months.map(month => ({ month, source: 'migration' as const })), closures: [], trackFlows: false, currencies: ['USD'], inflationCurrency: null,
    } })
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    client.setQueryData(['admin', 'availability'], { assessments: [assessment] })
    const result = renderHook(() => useAvailability(snapshot), { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children) }).result.current.aggregate
    expect(result).toMatchObject({ incomplete: true, free: null, available: null, reserve: null, goals: null, commitments: null })
    expect(result.accounts).toHaveLength(1)
  })
})
