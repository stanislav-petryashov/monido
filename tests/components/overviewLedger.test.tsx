import { screen, within } from '@testing-library/react'
import { OverviewAccounts } from '../../src/pages/overview/OverviewAccounts'
import { makeSnapshot } from '../helpers/snapshot'
import { renderWithSnapshot, stubPrivacyOn } from '../helpers/render'

const snapshot = makeSnapshot()
const capital = snapshot.capital!
const members = snapshot.members
const [bank, other] = capital.accounts
const sharedName = 'Cash'
const withHistory = {
  ...snapshot,
  capital: { ...capital, accounts: [{ ...bank!, name: sharedName }, { ...other!, name: sharedName, valueBase: null }] },
  balanceHistory: ['2031-03', '2031-05', '2031-06'].map(month => ({
    month, accounts: [{ ...bank!, name: sharedName, valueBase: 100 }], loans: capital.loans, realEstate: [],
  })),
}

it('filters same-name accounts by owner and leaves gaps between unobserved balances', () => {
  renderWithSnapshot(<OverviewAccounts snapshot={withHistory} owner={members[0]!} preset="3m" />, withHistory)
  const table = screen.getByRole('table', { name: 'Accounts' })
  const row = within(table).getByRole('row', { name: /Cash/ })
  expect(within(table).getAllByRole('rowheader')).toHaveLength(1)
  expect(row).toHaveTextContent('$15,748')
  expect(row.querySelector('path')?.getAttribute('d')?.match(/M/g)).toHaveLength(2)
  expect(row.querySelectorAll('circle')).toHaveLength(1)
})

it('distinguishes an account without a conversion rate from a zero balance', () => {
  renderWithSnapshot(<OverviewAccounts snapshot={withHistory} owner={members[1]!} preset="3m" />, withHistory)
  const row = screen.getByRole('row', { name: /Cash/ })
  expect(row).toHaveTextContent('No data')
  expect(row).not.toHaveTextContent('$0')
})

it('masks amounts and graph descriptions in privacy mode', () => {
  stubPrivacyOn()
  const { container } = renderWithSnapshot(<OverviewAccounts snapshot={withHistory} owner={null} preset="all" />, withHistory)
  expect(container).toHaveTextContent('•••')
  expect(container).not.toHaveTextContent('$')
  expect(screen.queryByRole('img')).toBeNull()
})
