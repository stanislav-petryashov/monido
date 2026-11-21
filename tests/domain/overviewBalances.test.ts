import { expect, it } from 'vitest'
import { overviewComposition, overviewHistory } from '../../src/pages/overview/capitalBalances'
import { makeSnapshot } from '../helpers/snapshot'

it('subtracts only the owner’s debt and leaves a month with an unconverted balance as a gap for that owner', () => {
  const s = makeSnapshot({
    balanceHistory: [{
      month: '2026-02',
      accounts: [{ name: 'Cash', member: 'Ana', valueBase: 70 }, { name: 'Cash', member: 'Ben', valueBase: null }],
      realEstate: [{ member: 'Ana', valueBase: 80 }],
      loans: [{ name: 'Loan', member: 'Ana', balanceBase: 40 }],
    }],
  })
  expect(overviewHistory(s, 'Ana')).toEqual({ history: [{ date: '2026-02-28', assets: 150, liabilities: 40, netWorth: 110 }], partial: new Set() })
  expect(overviewHistory(s, 'Ben').partial.has('2026-02')).toBe(true)
  expect(overviewHistory(s, null).history).toBe(s.history)
})

it('keeps missing account types unknown without hiding known holdings', () => {
  const s = makeSnapshot()
  const c = s.capital!
  const missing = { name: 'Wallet', member: 'Ana', class: 'bank' as const, currency: 'USD', lastObservedMonth: '2025-01' }
  s.capitalCoverage = [{ month: c.date.slice(0, 7), assetsKnown: false, capitalKnown: false, liquidKnown: false, missingAccounts: [missing] }]
  expect(overviewComposition(s, 'Ana')).toMatchObject({ assets: null, parts: { cash: null, property: 0 } })
  expect(overviewComposition(s, 'Other')).toMatchObject({ assets: 0, debts: 0 })
})
