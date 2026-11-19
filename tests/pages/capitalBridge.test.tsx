import { fireEvent, screen, within } from '@testing-library/react'
import { CapitalBridge } from '../../src/pages/cashflow/CapitalBridge'
import { changeStory, type PeriodChange } from '../../src/domain/capitalStory'
import type { MonthChangeGap } from '../../src/domain/types'
import { renderWithSnapshot, stubPrivacyOn } from '../helpers/render'

const march: PeriodChange = {
  months: ['2026-03'], form: 'tracked', start: 12_480_000, end: 12_225_000,
  rows: { saved: 85_000, debtPaid: 22_000, investments: -40_000, fx: -310_000, property: 0, unexplained: -12_000 },
  items: {
    debtPaid: [{ kind: 'loan', name: 'Mortgage', member: 'Oleg', currency: 'USD', amount: 22_000 }],
    fx: [
      { kind: 'account', name: 'USD deposit', member: 'Ira', currency: 'USD', amount: -276_000, native: 34_500 },
      { kind: 'account', name: 'Cash dollars', member: 'Oleg', currency: 'USD', amount: -34_000, native: 4_250 },
    ],
    property: [], investments: [{ kind: 'account', name: 'Broker', member: 'Oleg', currency: 'USD', amount: -40_000 }],
  },
  pairs: [], rates: [{ currency: 'USD', start: 92, end: 84 }],
  candidates: [{ name: 'Brokerage IIS', member: 'Ira', reason: 'no_transfer', change: -9_000 }, { name: 'Cash', member: 'Oleg', reason: 'no_record', change: -3_000 }],
}
const show = (change: PeriodChange | MonthChangeGap, yard: { negative: number; total: number; largest: boolean } | null = { negative: 5, total: 12, largest: true }) =>
  renderWithSnapshot(<CapitalBridge change={change} story={'rows' in change ? changeStory(change) : null} yard={yard} periodName="March 2026"
    recordPaths={{ account: '/accounts', loan: '/loans' }} fmt={v => `$${Math.abs(v).toLocaleString('en-US')}`.replace('$', v < 0 ? '−$' : '$')} />)
const region = () => within(screen.getByRole('region', { name: 'What changed our net worth' }))

describe('CapitalBridge', () => {
  it('reads the sentence, the yardstick and the rows of a down month', () => {
    show(march)
    expect(region().getByText(/fell by \$255,000\. The main cause is exchange rates: USD went from 92 to 84, that is −\$310,000\./)).toBeInTheDocument()
    expect(region().getByText('You added $107,000 yourselves.')).toBeInTheDocument()
    expect(region().getByText('Markets and rates went negative in 5 of 12 months; this one is the largest.')).toBeInTheDocument()
    const values = [...document.querySelectorAll('.cc-row .cc-row__value')].map(v => v.textContent)
    expect(values).toEqual(['$12,480,000', '+$107,000', '+$85,000', '+$22,000', '−$350,000', '−$40,000', '−$310,000', '$0', '−$12,000', '$12,225,000'])
  })

  it('opens the largest cause by default, with its accounts', () => {
    show(march)
    expect(region().getByRole('button', { name: /Exchange rates/ })).toHaveAttribute('aria-expanded', 'true')
    expect(region().getByRole('link', { name: 'USD deposit' })).toHaveAttribute('href', expect.stringMatching(/^\/accounts#/))
    expect(region().getByText('34,500 USD')).toBeInTheDocument()
  })

  it('lists unexplained candidates and says they are not shares', () => {
    show(march)
    fireEvent.click(region().getByRole('button', { name: /Unexplained/ }))
    expect(region().getByText(/do not add up to the row/)).toBeInTheDocument()
    expect(region().getByText('Brokerage IIS')).toBeInTheDocument()
    expect(region().getByText('deposits and withdrawals not entered')).toBeInTheDocument()
  })

  it('renames the group when the family spent beyond income', () => {
    show({ ...march, end: 12_100_000, rows: { saved: -60_000, debtPaid: 22_000, investments: 0, fx: -342_000, property: 0, unexplained: 0 } })
    expect(region().getByText('You took out')).toBeInTheDocument()
    expect(region().getByText('Spent beyond income')).toBeInTheDocument()
  })

  it('shows the neutral moves with their pairs and the early repayment hint', () => {
    show({ ...march, rows: { ...march.rows, moves: 0 }, pairs: [{ kind: 'early', name: 'Mortgage', amount: 300_000 }, { kind: 'accounts', name: '', amount: -300_000 }] })
    expect(region().getByText('plus $300,000 early, from accounts: see below')).toBeInTheDocument()
    fireEvent.click(region().getByRole('button', { name: /Moves inside net worth/ }))
    expect(region().getByText('Early repayment: Mortgage')).toBeInTheDocument()
  })

  it('names the month that cannot be broken down instead of a bridge', () => {
    show({ month: '2026-02', reason: 'no_rate' })
    expect(region().getByText(/February 2026 cannot be explained yet: an exchange rate is missing/)).toBeInTheDocument()
    expect(document.querySelector('.cc-row')).toBeNull()
  })

  it('shows the balances form with one hint to track flows', () => {
    show({ ...march, form: 'balances', rows: { accounts: 45_000, debtPaid: 22_000, fx: -310_000, property: 0 }, candidates: [] })
    expect(region().getByText('Change in accounts')).toBeInTheDocument()
    expect(region().getByText(/track income and expenses/)).toBeInTheDocument()
    expect(region().queryByText(/Unexplained/)).toBeNull()
  })

  it('every number of the sentence equals a row', () => {
    show(march)
    const sentence = document.querySelector('.cc-lead')!.textContent!
    for (const v of ['$255,000', '−$310,000', '$107,000']) expect(sentence).toContain(v)
    const values = [...document.querySelectorAll('.cc-row__value')].map(v => v.textContent!.replace('+', ''))
    expect(values).toEqual(expect.arrayContaining(['−$310,000', '$107,000']))
  })

  it('masks every amount in privacy mode', () => {
    stubPrivacyOn()
    renderWithSnapshot(<CapitalBridge change={march} story={changeStory(march)} yard={null} periodName="March 2026" recordPaths={{}} fmt={() => '•••'} />)
    expect([...document.querySelectorAll('.cc-row__value')].every(v => v.textContent!.endsWith('•••'))).toBe(true)
  })
})
