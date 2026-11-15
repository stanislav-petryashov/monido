import { act, render, screen, waitFor, within } from '@testing-library/react'
import App from '../../../src/App'
import { HEALTH_KEYS } from '../../../src/domain/health'
import type { FinanceSnapshot, HealthKey } from '../../../src/domain/types'
import { currentLanguage, applyFamilyLanguage, i18n } from '../../../src/i18n/client'
import { fmtMonth, fmtMonths } from '../../../src/lib/formatters'
import { resetAuth } from '../../../src/lib/authState'
import { queryClient } from '../../../src/lib/queryClient'
import { snapshotQueryKey } from '../../../src/lib/useFinanceData'
import { healthClient } from '../../../src/modules/health/client'
import { HealthPage } from '../../../src/modules/health/HealthPage'
import { METRIC_OWNER } from '../../../src/modules/health/metricOwners'
import { jsonResponse } from '../../helpers/http'
import { ru } from '../../helpers/i18n'
import { pageText, renderWithSnapshot } from '../../helpers/render'
import { makeSnapshot } from '../../helpers/snapshot'

vi.mock('../../../src/components/charts/echarts', () => import('../../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../../helpers/echartsStub'))

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) })
afterEach(() => {
  window.history.replaceState(null, '', '/')
})

const card = (key: string) => document.getElementById(key)
const cardIds = () => [...document.querySelectorAll('.status')].map(el => el.id)

describe('Financial health page', () => {
  it('the zone counts sit under the heading of the section they count', () => {
    const { container } = renderWithSnapshot(<HealthPage />, makeSnapshot())
    const summary = container.querySelector('.health-summary')!
    expect(summary.closest('section')).toHaveTextContent('Current stability')
    expect(summary.closest('section')).not.toHaveTextContent('Passive-income independence')
  })

  it('the emergency fund card names the month its big number is based on, beside the 3-month average', () => {
    const s = makeSnapshot()
    renderWithSnapshot(<HealthPage />, s)
    const row = within(card('emergency_months')!).getByText(`Based on expenses for ${fmtMonth(s.cashflow.closedMonth!.month)}`).closest('.cmp__row')
    expect(row).toHaveTextContent(fmtMonths(s.cashflow.emergencyMonths))
  })

  it('without a closed month the emergency fund card names no month', () => {
    const s = makeSnapshot()
    renderWithSnapshot(<HealthPage />, { ...s, asOf: { ...s.asOf, closedMonth: null }, cashflow: { ...s.cashflow, closedMonth: null } })
    expect(screen.queryByText(/^Based on expenses for/)).toBeNull()
  })

  it('a closed month whose totals are unknown (a row without a rate) is still named, with a dash', () => {
    const s = makeSnapshot()
    renderWithSnapshot(<HealthPage />, { ...s, cashflow: { ...s.cashflow, closedMonth: null, emergencyMonths: null } })
    const row = within(card('emergency_months')!).getByText(`Based on expenses for ${fmtMonth(s.asOf.closedMonth!)}`).closest('.cmp__row')
    expect(row).toHaveTextContent('—')
  })

  it('the savings rate card shows the 3- and 12-month averages beside its one month', () => {
    renderWithSnapshot(<HealthPage />, makeSnapshot())
    expect(within(card('savings_rate')!).getByText('3-month average')).toBeInTheDocument()
    expect(within(card('savings_rate')!).getByText('12-month average')).toBeInTheDocument()
  })

  it('is the health module page in the Dashboard group', () => {
    const route = healthClient.routes?.find(r => r.path === '/health')
    expect(route).toMatchObject({ section: 'dashboard', title: 'modules.health.route', order: 50 })
  })

  it('lists all 8 metrics with every module on, each card anchored by its key', () => {
    renderWithSnapshot(<HealthPage />, makeSnapshot())
    expect([...cardIds()].sort()).toEqual([
      'avg_debt_rate', 'consumer_debt_months', 'debt_payment_ratio', 'debt_to_asset', 'emergency_months',
      'fi_rate', 'income_diversification', 'real_growth_yoy', 'savings_rate',
    ])
    expect(screen.queryByText(/Turn on/)).toBeNull()
  })

  it('without inflation the real-growth card says where to set it', () => {
    const { unmount } = renderWithSnapshot(<HealthPage />, makeSnapshot({ inflation: null }))
    const link = within(card('real_growth_yoy')!).getByRole('link', { name: 'Settings → General' })
    expect(link).toHaveAttribute('href', '/settings/general')
    expect(card('real_growth_yoy')).toHaveTextContent('Real growth needs the inflation and its currency')
    unmount()
    renderWithSnapshot(<HealthPage />, makeSnapshot())
    expect(card('real_growth_yoy')).not.toHaveTextContent('needs the inflation')
  })

  it('counts the metrics in each zone', () => {
    renderWithSnapshot(<HealthPage />, makeSnapshot())
    const summary = screen.getByRole('group', { name: 'Metrics by zone' })
    expect(within(summary).getAllByText(/: \d/).map(c => c.textContent)).toEqual(['Critical: 1', 'Needs work: 1', 'Good: 4', 'Excellent: 1'])
  })

  it('has no separate insight list: the cards carry the advice and the question', () => {
    const { container } = renderWithSnapshot(<HealthPage />, makeSnapshot())
    expect(container.querySelectorAll('.insight')).toHaveLength(0)
    expect(container.querySelectorAll('.status__advice').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /^Show the question for Claude/ })).toHaveLength(9)
  })

  it('orders the cards worst zone first, the catalog order within a zone', () => {
    renderWithSnapshot(<HealthPage />, makeSnapshot())
    const rank = { red: 0, amber: 1, green: 2, excellent: 3 }
    const catalog = ['savings_rate', 'emergency_months', 'fi_rate', 'debt_to_asset', 'real_growth_yoy', 'avg_debt_rate', 'consumer_debt_months', 'debt_payment_ratio', 'income_diversification']
    const metrics = makeSnapshot().health!.metrics
    const expected = [...catalog].sort((x, y) => Number(['fi_rate', 'income_diversification'].includes(x)) - Number(['fi_rate', 'income_diversification'].includes(y)) || rank[metrics[x as HealthKey]!.zone!] - rank[metrics[y as HealthKey]!.zone!])
    expect(cardIds()).toEqual(expected)
    expect(cardIds()).not.toEqual(catalog)
  })

  it('puts a metric without a zone (not computed) after every zoned one', () => {
    const base = makeSnapshot()
    const metrics = { ...base.health!.metrics, savings_rate: { ...base.health!.metrics.savings_rate!, value: null, zone: null } }
    renderWithSnapshot(<HealthPage />, makeSnapshot({ health: { ...base.health!, metrics } }))
    expect(cardIds().filter(key => !['fi_rate', 'income_diversification'].includes(key)).at(-1)).toBe('savings_rate')
    expect(cardIds()).toHaveLength(9)
  })

  it('consumer debt is months of income: the value carries «of income» as unit text, and the zone scale names it', () => {
    renderWithSnapshot(<HealthPage />, makeSnapshot())
    const debt = card('consumer_debt_months')!
    const unit = debt.querySelector('.status__value .status__unit')
    expect(unit).toHaveTextContent('of income')
    expect(debt.querySelector('.status__value')).toHaveTextContent(/^\d+(\.\d)? mo of income$/)
    expect(within(debt).getByRole('img')).toHaveAccessibleName(/mo of income/)
  })

  it('shows the no-data card instead of the cards when nothing is computed', () => {
    renderWithSnapshot(<HealthPage />, makeSnapshot({ health: null }))
    expect(screen.getByRole('heading', { name: 'Not enough data for an assessment' })).toBeInTheDocument()
    // the first balances can only go in through the wizard: Accounts refuses them
    expect(screen.getByRole('link', { name: 'Close month' })).toHaveAttribute('href', '/close')
  })

  it('shows all nine metric cards and no "turn on" note', () => {
    const { container } = renderWithSnapshot(<HealthPage />, makeSnapshot())
    expect(cardIds().sort()).toEqual([...HEALTH_KEYS].sort())
    expect(pageText(container)).not.toContain('Turn on')
  })

  it('links a card to the page that owns its metric; the emergency fund has no other owner', () => {
    renderWithSnapshot(<HealthPage />, makeSnapshot())
    expect(within(card('savings_rate')!).getByRole('link', { name: 'More on the Income and expenses page' })).toHaveAttribute('href', '/cashflow')
    expect(within(card('fi_rate')!).getByRole('link')).toHaveAttribute('href', '/cashflow#income')
    expect(within(card('income_diversification')!).getByRole('link')).toHaveAttribute('href', '/cashflow#income')
    // the debts to the Loans page, plain: a hash there selects a record; the growth to History
    expect(within(card('debt_to_asset')!).getByRole('link', { name: 'More on the Loans page' })).toHaveAttribute('href', '/loans')
    expect(within(card('avg_debt_rate')!).getByRole('link')).toHaveAttribute('href', '/loans')
    expect(within(card('consumer_debt_months')!).getByRole('link')).toHaveAttribute('href', '/loans')
    expect(within(card('debt_payment_ratio')!).getByRole('link')).toHaveAttribute('href', '/loans')
    expect(within(card('real_growth_yoy')!).getByRole('link')).toHaveAttribute('href', '/assets#history')
    expect(within(card('emergency_months')!).getByRole('link')).toHaveAttribute('href', '/available-money')
    expect(METRIC_OWNER.emergency_months).toBeNull()
  })

  it('gives the emergency fund card the comparison its compare card had', () => {
    renderWithSnapshot(<HealthPage />, makeSnapshot())
    const row = within(card('emergency_months')!).getByText('Based on average expenses over 3 mo').closest('.cmp__row')
    expect(row).toHaveTextContent('1.9 mo')
    expect(card('debt_to_asset')!.querySelector('.cmp__row')).toBeNull()
  })

  it('the loan payment card says it is a share of income', () => {
    renderWithSnapshot(<HealthPage />, makeSnapshot())
    expect(within(card('debt_payment_ratio')!).getByText('Loan payments to income')).toBeInTheDocument()
  })

  it('keeps the short income label and names its detail as a passive-income share', () => {
    renderWithSnapshot(<HealthPage />, makeSnapshot())
    const income = within(card('income_diversification')!)
    expect(income.getByText('Income beyond salary')).toBeInTheDocument()
    expect(income.getByRole('button', { name: /question for Claude: Passive income share/ })).toBeInTheDocument()
  })

  it('puts incomplete balance and cash-flow warnings beside the metrics without unrelated goal warnings', () => {
    renderWithSnapshot(<HealthPage />, makeSnapshot({ warnings: [
      { code: 'missing_balance', params: { name: 'Missing bank', member: 'Robin', month: '2031-06' } },
      { code: 'missing_cashflow', params: { name: 'Missing flows', member: 'Robin', month: '2031-06' } },
      { code: 'fx_unknown_currency', ref: 'goal:trip', params: { currency: 'XYZ', name: 'Unrelated goal' } },
    ] }))
    const warnings = screen.getByRole('status')
    expect(warnings).toHaveTextContent('Missing bank')
    expect(warnings).toHaveTextContent('Missing flows')
    expect(warnings).not.toHaveTextContent('Unrelated goal')
  })

  it('focuses the card named in the address', async () => {
    window.history.replaceState(null, '', '/health#debt_to_asset')
    renderWithSnapshot(<HealthPage />, makeSnapshot())
    await waitFor(() => expect(document.activeElement).toBe(card('debt_to_asset')))
  })
})

describe('To do on the second floor', () => {
  const money = (v: number) => `$${v}`
  const todo = (s: FinanceSnapshot) => healthClient.overview!.todo!(s, i18n.t, money)

  it('is the module to-do slot, pure over the snapshot; the attention block is gone', () => {
    expect(healthClient.overview?.todo).toBeTypeOf('function')
    expect((healthClient.overview as { attention?: unknown } | undefined)?.attention).toBeUndefined()
  })

  it('names only the metrics that are really wrong, each a row to Financial health', () => {
    expect(todo(makeSnapshot())).toEqual([expect.objectContaining({ to: '/health', label: 'Savings rate needs work', icon: healthClient.icon })])
  })

  it('nothing without a report', () => {
    expect(todo(makeSnapshot({ health: null }))).toEqual([])
  })
})

describe('language switch on Financial health', () => {
  // the environment's own localStorage is not usable in Node 25+ (see tests/i18n/client.test.ts)
  beforeEach(() => {
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => { stored.set(k, String(v)) },
    })
    resetAuth()
    queryClient.clear()
    window.history.replaceState(null, '', '/health')
  })
  afterEach(async () => {
    await applyFamilyLanguage('en-US')
    queryClient.clear()
  })

  it('keeps the route and the cached snapshot', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/auth') return jsonResponse({ mode: 'password', authenticated: true })
      if (url === '/api/snapshot') return jsonResponse(makeSnapshot())
      return jsonResponse({ error: 'unavailable' }, 503)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('scrollTo', vi.fn())
    queryClient.setQueryData(snapshotQueryKey(null), makeSnapshot())
    const snapshotCalls = () => fetchMock.mock.calls.filter(([u]) => String(u) === '/api/snapshot').length

    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Financial health' })).toBeInTheDocument()
    expect(await screen.findByRole('group', { name: 'Metrics by zone' })).toBeInTheDocument()

    await act(() => applyFamilyLanguage('ru-RU')) // the family language arrives from the server
    await waitFor(() => expect(currentLanguage()).toBe('ru-RU'))

    expect(await screen.findByRole('heading', { level: 1, name: ru('modules.health.route') })).toBeInTheDocument()
    expect(await screen.findByRole('group', { name: ru('modules.health.byZone') })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/health')
    expect(snapshotCalls()).toBe(0)
    expect(queryClient.getQueryData(snapshotQueryKey(null))).toBeDefined()
  })
})
it('labels emergency coverage as all liquid assets and links to the separately designated reserve', () => {
  renderWithSnapshot(<HealthPage />, makeSnapshot())
  const emergency = within(card('emergency_months')!)
  expect(emergency.getByText('All liquid assets / spending')).toBeInTheDocument()
  expect(emergency.getByText('All liquid assets')).toBeInTheDocument()
  expect(emergency.getByRole('link', { name: 'Compare designated reserve' })).toHaveAttribute('href', '/available-money')
})
