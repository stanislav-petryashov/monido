import { fireEvent, screen, within } from '@testing-library/react'
import { Assets } from '../../src/pages/Assets'
import { renderWithSnapshot as renderPage, stubSnapshotFetch } from '../helpers/render'
import { mockupMonth, noa, robin } from '../helpers/assets'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

beforeEach(() => { stubSnapshotFetch() })

const card = () => screen.getByRole('region', { name: 'Composition' })
const rows = () => [...card().querySelectorAll('.comp__row')]
const amount = (row: Element) => Number(row.querySelector('.comp__val')!.firstChild!.textContent!.replace(/[^\d]/g, ''))

describe('Composition', () => {
  it('lists the types with their amount, share, change and count; the rows sum to the total', () => {
    renderPage(<Assets />, mockupMonth())
    expect(rows().map(r => r.querySelector('.comp__name')!.textContent)).toEqual(['Real estate', 'Brokerage accounts', 'Bank accounts'])
    expect(rows()[0]).toHaveTextContent('$913,094' + '79.8%')
    expect(rows()[0].querySelector('.comp__meta')).toHaveTextContent('−$2,024 over the month · 2 holdings')
    expect(rows()[1].querySelector('.comp__meta')).toHaveTextContent('+$2,030 over the month · 3 holdings')
    expect(rows()[1].querySelector<HTMLElement>('.comp__fill')!.style.width).toMatch(/^15\.06/)
    expect(rows().reduce((a, r) => a + amount(r), 0)).toBe(1144127)
  })

  it('switches to the owners, each with their avatar', () => {
    renderPage(<Assets />, mockupMonth())
    fireEvent.click(within(card()).getByRole('button', { name: 'By owner' }))
    expect(rows().map(r => r.querySelector('.comp__name')!.textContent)).toEqual([`${robin[0]}${robin}`, `${noa[0]}${noa}`])
    expect(rows()[0].querySelector('.lane__avatar--tinted')).not.toBeNull()
    expect(rows().reduce((a, r) => a + amount(r), 0)).toBe(1144127)
  })

  it('offers no currency with one currency', () => {
    const base = mockupMonth()
    const usd = <T extends { currency: string }>(h: T) => ({ ...h, currency: 'USD' })
    renderPage(<Assets />, { ...base, capital: { ...base.capital!, accounts: base.capital!.accounts.map(usd), realEstate: base.capital!.realEstate.map(usd) } })
    expect(within(card()).getAllByRole('button').map(b => b.textContent)).toEqual(['By type', 'By owner'])
  })

  it('leaves out a holding closed in the period: no empty row, no switch only it makes', () => {
    const base = mockupMonth()
    const usd = <T extends { currency: string }>(h: T) => ({ ...h, currency: 'USD' })
    const gone = { name: 'Old pounds', member: 'Zed', class: 'bank' as const, currency: 'GBP', value: 500, valueBase: 640 }
    renderPage(<Assets />, {
      ...base,
      accountLifecycle: [{ name: gone.name, member: gone.member, firstObservedMonth: '2031-05', lastObservedMonth: '2031-05', closedMonth: '2031-06' }],
      capital: { ...base.capital!, accounts: base.capital!.accounts.map(usd), realEstate: base.capital!.realEstate.map(usd) },
      previousCapital: { ...base.previousCapital!, accounts: [...base.previousCapital!.accounts.map(usd), gone], realEstate: base.previousCapital!.realEstate.map(usd) },
    })
    expect(within(card()).getAllByRole('button').map(b => b.textContent)).toEqual(['By type', 'By owner'])
    fireEvent.click(within(card()).getByRole('button', { name: 'By owner' }))
    expect(rows()).toHaveLength(2)
    expect(card()).not.toHaveTextContent('0 holdings')
  })

  it('counts a holding closed in the period in its type\'s change: the rows add up to the headline change', () => {
    const base = mockupMonth()
    const gone = { name: 'Old pounds', member: 'Zed', class: 'bank' as const, currency: 'GBP', value: 500, valueBase: 640 }
    renderPage(<Assets />, {
      ...base,
      accountLifecycle: [{ name: gone.name, member: gone.member, firstObservedMonth: '2031-05', lastObservedMonth: '2031-05', closedMonth: '2031-06' }],
      previousCapital: { ...base.previousCapital!, accounts: [...base.previousCapital!.accounts, gone] },
    })
    const signedAmount = (text: string) => (text.startsWith('−') ? -1 : 1) * Number(text.replace(/[^\d]/g, ''))
    const rowChanges = rows().map(r => signedAmount(r.querySelector('.comp__meta .num')!.textContent!))
    const headline = signedAmount(document.querySelector('.assets-top .delta')!.textContent!)
    expect(rowChanges.reduce((a, b) => a + b, 0)).toBe(headline)
  })

  it('says how much is available at once', () => {
    renderPage(<Assets />, mockupMonth())
    expect(card().querySelector('.comp__liquid')).toHaveTextContent('Available at once $58,723, 5.1%: the bank accounts.')
  })

  it('names no account type when what is available at once is not the bank accounts', () => {
    const base = mockupMonth()
    renderPage(<Assets />, { ...base, capital: { ...base.capital!, liquid: 40000 } })
    expect(card().querySelector('.comp__liquid')).toHaveTextContent(/^Available at once \$40,000, 3\.5%\.$/)
  })

  it('without a period shows the amounts and counts, no change', () => {
    renderPage(<Assets />, mockupMonth({ previousCapital: null }))
    expect(rows()[0].querySelector('.comp__meta')).toHaveTextContent(/^2 holdings$/)
  })
})

it.each([
  ['Bluefinch Savings', 'Bank accounts'],
  ['Granite Peak 401(k)', 'Bank accounts'],
])('does not draw a definite share for %s missing from the endpoint', (missingName, groupName) => {
  const base = mockupMonth()
  const missing = base.capital!.accounts.find(a => a.name === missingName)!
  const snapshot = { ...base,
    capital: { ...base.capital!, accounts: base.capital!.accounts.filter(a => a.name !== missingName) },
    capitalCoverage: [
      { month: '2031-05', assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] },
      { month: '2031-06', assetsKnown: false, liquidKnown: false, capitalKnown: false, missingAccounts: [{ name: missing.name, member: missing.member, class: missing.class, currency: missing.currency, lastObservedMonth: '2031-05' }] },
    ],
    accountLifecycle: [{ name: missing.name, member: missing.member, firstObservedMonth: '2031-05', lastObservedMonth: '2031-05', closedMonth: null }],
  }
  renderPage(<Assets />, snapshot)
  const group = rows().find(r => r.querySelector('.comp__name')!.textContent === groupName)!
  expect(group.querySelector('.comp__val')!.firstChild!.textContent).toBe(missingName === 'Bluefinch Savings' ? '—' : '$58,723')
  expect(group.querySelector('.comp__share')).toHaveTextContent('—')
  expect(group.querySelector('.comp__fill')).toBeNull()
})

it('draws the proportional share when numerator and denominator are known', () => {
  renderPage(<Assets />, mockupMonth())
  expect(rows()[1].querySelector<HTMLElement>('.comp__fill')!.style.width).toMatch(/^15\.06/)
})
