import { screen, within } from '@testing-library/react'
import { Assets } from '../../src/pages/Assets'
import { renderWithSnapshot as renderPage, stubPrivacyOn, stubSnapshotFetch } from '../helpers/render'
import { mockupMonth, noa, robin } from '../helpers/assets'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

beforeEach(() => { stubSnapshotFetch() })

const list = () => screen.getByRole('region', { name: 'Accounts and property' })
const groups = () => [...list().querySelectorAll<HTMLElement>('.holdings__group')]
const row = (name: string) => within(list()).getByText(name).closest('li')!
const dollars = (text: string) => Number(text.replace(/[^\d−-]/g, '').replace('−', '-'))

describe('Holdings list', () => {
  it('groups the holdings by type: real estate, brokerage, bank', () => {
    renderPage(<Assets />, mockupMonth())
    expect(groups().map(g => g.querySelector('h3')!.textContent)).toEqual(['Real estate · 2', 'Brokerage accounts · 3', 'Bank accounts · 3'])
    expect(groups()[0].querySelector('.holdings__head')).toHaveTextContent('$913,094 79.8%−$2,024')
  })

  it('gives each group the sum of its rows, value and change', () => {
    renderPage(<Assets />, mockupMonth())
    for (const g of groups()) {
      const [value, change] = [...g.querySelectorAll('.holdings__head .holdings__n')].map(n => n.firstChild!.textContent!)
      const rows = [...g.querySelectorAll('li')]
      expect(rows.reduce((a, r) => a + dollars(r.querySelector('.holdings__val')!.firstChild!.textContent!), 0)).toBe(dollars(value))
      expect(rows.reduce((a, r) => a + dollars(r.querySelector('.holdings__chg > span')!.textContent!), 0)).toBe(dollars(change))
    }
  })

  it('shows a foreign holding in its own currency, a rate-only move, no change and the % of the start', () => {
    renderPage(<Assets />, mockupMonth())
    expect(row('Apartment in Leipzig').querySelector('.holdings__meta')).toHaveTextContent(`${noa} · 299,500.00 EUR`)
    expect(row('Apartment in Leipzig').querySelector('.holdings__chg')).toHaveTextContent('−$2,024the EUR rate only')
    expect(row('House on Maple Street').querySelector('.holdings__meta')).toHaveTextContent(new RegExp(`^${robin}$`))
    expect(row('House on Maple Street').querySelector('.holdings__chg')).toHaveTextContent('$0no change')
    expect(row('Harborline Checking').querySelector('.holdings__chg')).toHaveTextContent('+$1,720+5.7%')
    expect(row('House on Maple Street').querySelector('.holdings__val')).toHaveTextContent('$568,00049.6% of assets')
  })

  it('names a holding opened or closed during the period', () => {
    const base = mockupMonth()
    const gone = { name: 'Old savings', member: robin, class: 'bank' as const, currency: 'USD', value: 500, valueBase: 500 }
    renderPage(<Assets />, { ...base, accountLifecycle: [{ name: gone.name, member: gone.member, firstObservedMonth: '2031-05', lastObservedMonth: '2031-05', closedMonth: '2031-06' }], previousCapital: { ...base.previousCapital!, accounts: [...base.previousCapital!.accounts, gone] } })
    expect(row('Old savings').querySelector('.holdings__chg')).toHaveTextContent('−$500closed in the period')
    expect(groups()[2].querySelector('h3')).toHaveTextContent('Bank accounts · 3')
  })

  it('keeps a holding without a rate, its value and change unknown, out of the waterfall', () => {
    const base = mockupMonth()
    const lost = (h: NonNullable<typeof base.capital>['accounts'][number]) => (h.name === 'Rheinau Bank' ? { ...h, valueBase: null } : h)
    renderPage(<Assets />, { ...base, capital: { ...base.capital!, accounts: base.capital!.accounts.map(lost) } })
    expect(row('Rheinau Bank').querySelector('.holdings__val')).toHaveTextContent(/^—$/)
    expect(row('Rheinau Bank').querySelector('.holdings__chg')).toHaveTextContent('—no exchange rate')
    expect(screen.queryByRole('img', { name: /The change of the assets/ })).toBeNull()
  })

  it('leaves a holding without an owner with no initial and no empty meta line', () => {
    const base = mockupMonth()
    const nobody = <T extends { name: string; member: string }>(h: T) => (h.name === 'House on Maple Street' ? { ...h, member: '' } : h)
    renderPage(<Assets />, { ...base, capital: { ...base.capital!, realEstate: base.capital!.realEstate.map(nobody) }, previousCapital: { ...base.previousCapital!, realEstate: base.previousCapital!.realEstate.map(nobody) } })
    const house = row('House on Maple Street')
    expect(house.querySelector('.holdings__noOwner')).toBeEmptyDOMElement()
    expect(house.querySelector('.holdings__meta')).toBeNull()
  })

  it('links each name to its record', () => {
    renderPage(<Assets />, mockupMonth())
    expect(within(list()).getByRole('link', { name: 'Rheinau Bank' })).toHaveAttribute('href', `/accounts#${encodeURIComponent(JSON.stringify(['Rheinau Bank', noa]))}`)
    expect(within(list()).getByRole('link', { name: 'House on Maple Street' })).toHaveAttribute('href', '/real-estate#House%20on%20Maple%20Street')
  })

  it('masks the amounts in privacy mode, own currency too', () => {
    stubPrivacyOn()
    renderPage(<Assets />, mockupMonth())
    expect(list().textContent).not.toMatch(/\d{3}[,.]\d{2,3}/)
    expect(row('Apartment in Leipzig').querySelector('.holdings__meta')).toHaveTextContent('••• EUR')
  })

  it('without a period lists the values with no change column', () => {
    renderPage(<Assets />, mockupMonth({ previousCapital: null }))
    expect(list().querySelector('.holdings__chg')).toBeNull()
    expect(row('Harborline Checking').querySelector('.holdings__val')).toHaveTextContent('$32,000')
  })
})

it('explains an unavailable comparison for an observed zero with a missing baseline', () => {
  const base = mockupMonth()
  const zero = { name: 'Zero account', member: robin, class: 'bank' as const, currency: 'USD', value: 0, valueBase: 0 }
  renderPage(<Assets />, { ...base,
    capital: { ...base.capital!, accounts: [...base.capital!.accounts, zero] },
    accountLifecycle: [{ name: zero.name, member: zero.member, firstObservedMonth: '2031-03', lastObservedMonth: '2031-06', closedMonth: null }],
    capitalCoverage: [
      { month: '2031-05', assetsKnown: false, liquidKnown: false, capitalKnown: false, missingAccounts: [{ name: zero.name, member: zero.member, class: zero.class, currency: zero.currency, lastObservedMonth: '2031-03' }] },
      { month: '2031-06', assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] },
    ],
  })
  expect(row('Zero account').querySelector('.holdings__val')).toHaveTextContent('$0')
  expect(row('Zero account').querySelector('.holdings__chg')).toHaveTextContent('—comparison unavailable')
  expect(row('Zero account').querySelector('.holdings__chg')).not.toHaveTextContent('no change')
})

it('retains no change for a known zero at both endpoints', () => {
  const base = mockupMonth()
  const zero = { name: 'Known zero', member: robin, class: 'bank' as const, currency: 'USD', value: 0, valueBase: 0 }
  renderPage(<Assets />, { ...base,
    capital: { ...base.capital!, accounts: [...base.capital!.accounts, zero] },
    previousCapital: { ...base.previousCapital!, accounts: [...base.previousCapital!.accounts, zero] },
  })
  expect(row('Known zero').querySelector('.holdings__chg')).toHaveTextContent('$0no change')
})
