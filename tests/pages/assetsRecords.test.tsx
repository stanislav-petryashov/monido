import { screen } from '@testing-library/react'
import { Assets } from '../../src/pages/Assets'
import type { ClientModule } from '../../src/modules/client'
import { makeSnapshot } from '../helpers/snapshot'
import { renderWithSnapshot as renderPage, stubSnapshotFetch } from '../helpers/render'

const FAKE_PATH = vi.hoisted(() => '/records/fake-properties')

// The real-estate slot is taken by a fake module that only declares its asset records: the page must link
// properties to the declared path, so the link comes from the extension point, not from a path the page knows
vi.mock('../../src/modules/client', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/modules/client')>()
  const modules: ClientModule[] = real.CLIENT_MODULES.map(m => (m.key === 'real_estate'
    ? { key: m.key, icon: m.icon, assetRecords: { kind: 'realEstate', path: FAKE_PATH } }
    : m))
  return { ...real, CLIENT_MODULES: modules }
})
vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

beforeEach(() => { stubSnapshotFetch() })

describe('Assets record links through ClientModule.assetRecords', () => {
  it('links the rows of a module to the path it declares; accounts keep the core link', () => {
    renderPage(<Assets />, makeSnapshot())
    expect(screen.getByRole('link', { name: 'City apartment' })).toHaveAttribute('href', `${FAKE_PATH}#City%20apartment`)
    expect(screen.getByRole('link', { name: 'Lumiora Bank' })).toHaveAttribute('href', '/accounts#%5B%22Lumiora%20Bank%22%2C%22Ryan%22%5D')
  })
})

it('keeps a missing balance discoverable without showing it as a loss or closure', () => {
  const base = makeSnapshot()
  const account = { ...base.capital!.accounts[0], name: 'account97', value: 1000000096, valueBase: 1000000096 }
  const start = { ...base.capital!, date: '2031-08-31', accounts: [account], realEstate: [] }
  const capital = { ...base.capital!, date: '2031-09-30', accounts: [], realEstate: [] }
  renderPage(<Assets />, makeSnapshot({ capital, previousCapital: start,
    accountLifecycle: [{ name: account.name, member: account.member, firstObservedMonth: '2031-08', lastObservedMonth: '2031-08', closedMonth: null }],
    capitalCoverage: [{ month: '2031-08', assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] }, { month: '2031-09', assetsKnown: false, liquidKnown: false, capitalKnown: false, missingAccounts: [{ name: account.name, member: account.member, class: account.class, currency: account.currency, lastObservedMonth: '2031-08' }] }],
  }))
  const row = screen.getByRole('link', { name: 'account97' }).closest('li')!
  expect(row).not.toHaveTextContent(/1,000,000,096|closed|−|0%/i)
  expect(row).toHaveTextContent('—')
})

it('keeps an account observed only inside the window in every available period', async () => {
  const { buildSnapshot } = await import('../../src/domain/snapshot')
  const { fireEvent, within } = await import('@testing-library/react')
  const bank = (month: string, name: string, value: number) => ({ date: `2031-${month}-28`, class: 'bank' as const, name, value, currency: 'USD', member: 'Robin' })
  const snapshot = buildSnapshot({ rows: {
    assets: [...['06', '07', '08', '09', '10'].map(m => bank(m, 'B', 100)), bank('08', 'A', 1000000096)],
    cashflow: [], loanPayments: [], spendingCategories: [], categorySpending: [], flowLines: [], manualMandatory: null,
    members: [], realEstate: [], loans: [], earlyPayments: [], goals: [], parameters: {},
    closedMonths: ['06', '07', '08', '09', '10'].map(m => ({ month: `2031-${m}`, source: 'migration' as const })),
    trackFlows: false, currencies: ['USD'], inflationCurrency: null,
  }, rateAt: () => ({}), baseCurrency: 'USD', familyCurrency: 'USD', today: new Date('2031-11-01T00:00:00Z') })
  const { container } = renderPage(<Assets />, snapshot)
  const periods = screen.getByRole('group', { name: 'Period of the changes' })
  for (const name of ['Month', 'Quarter', 'All time']) {
    fireEvent.click(within(periods).getByRole('button', { name }))
    const row = screen.getByRole('link', { name: 'A' }).closest('li')!
    expect(row).toHaveTextContent('—')
    expect(row).not.toHaveTextContent(/1,000,000,096|closed|0%/i)
    expect(container.querySelector('.assets-top')!).not.toHaveTextContent('1,000,000,096')
  }
})

it('keeps the group change unavailable while showing a known holding after a missing start closes', async () => {
  const { buildSnapshot } = await import('../../src/domain/snapshot')
  const { fireEvent, within } = await import('@testing-library/react')
  const bank = (month: string, name: string, value: number) => ({ date: `2031-${month}-28`, class: 'bank' as const, name, value, currency: 'USD', member: 'Robin' })
  const snapshot = buildSnapshot({ rows: {
    assets: [bank('05', 'A', 500), bank('06', 'B', 100), bank('07', 'A', 0), bank('07', 'B', 100), bank('08', 'B', 100), bank('09', 'B', 120)],
    closures: [{ name: 'A', member: 'Robin', closedMonth: '2031-07' }],
    cashflow: [], loanPayments: [], spendingCategories: [], categorySpending: [], flowLines: [], manualMandatory: null,
    members: [], realEstate: [], loans: [], earlyPayments: [], goals: [], parameters: {},
    closedMonths: ['05', '06', '07', '08', '09'].map(m => ({ month: `2031-${m}`, source: 'migration' as const })),
    trackFlows: false, currencies: ['USD'], inflationCurrency: null,
  }, rateAt: () => ({}), baseCurrency: 'USD', familyCurrency: 'USD', today: new Date('2031-10-01T00:00:00Z') })
  renderPage(<Assets />, snapshot)
  fireEvent.click(within(screen.getByRole('group', { name: 'Period of the changes' })).getByRole('button', { name: 'Quarter' }))
  const row = screen.getByRole('link', { name: 'B' }).closest('li')!
  const head = row.closest('.holdings__group')!.querySelector('.holdings__head')!
  expect(head.querySelectorAll('.holdings__n')[0]).toHaveTextContent('$120')
  expect(head.querySelectorAll('.holdings__n')[1]).toHaveTextContent(/^—$/)
  expect(row.querySelector('.holdings__val')).toHaveTextContent('$120')
  expect(row.querySelector('.holdings__chg')).toHaveTextContent('+$20')
})
