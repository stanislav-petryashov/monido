import { cashflowClient } from '../../../src/modules/cashflow/client'
import type { FinanceSnapshot } from '../../../src/domain/types'

const row = (month: string) => ({ month, bank: 'Bank', member: '', currency: 'USD', active: 1, passive: 0, expense: 1, activeBase: 1, passiveBase: 0, expenseBase: 1 })
const snapshot = (months: string[]) => ({ cashflow: { rows: months.map(row) } }) as unknown as FinanceSnapshot
const yearHref = cashflowClient.overview!.yearHref!

// The Year period is the twelve months ending at m: a December with flows is its calendar year
describe('the cash-flow module\'s year address', () => {
  it('opens the calendar year on Income and expenses', () => {
    expect(yearHref(snapshot(['2025-11', '2025-12']), 2025)).toBe('/cashflow?p=year&m=2025-12')
  })
  it('gives none for a December without flows while flows exist (a year imported as balances)', () => {
    expect(yearHref(snapshot(['2026-01']), 2025)).toBeNull()
  })
  it('opens the year by balances when no month has flows (tracking off)', () => {
    expect(yearHref(snapshot([]), 2025)).toBe('/cashflow?p=year&m=2025-12')
  })
})
