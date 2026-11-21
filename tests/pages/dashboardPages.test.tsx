import type { ReactElement } from 'react'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { Overview } from '../../src/pages/Overview'
import { Assets } from '../../src/pages/Assets'
import { CashFlow } from '../../src/pages/CashFlow'
import { Goals } from '../../src/pages/Goals'
import { goalsSnapshot } from '../helpers/goals'
import { HealthPage } from '../../src/modules/health/HealthPage'
import type { MandatorySpending, CategorisedMonth } from '../../src/domain/spending'
import { emptySnapshot, flowsSnapshot, makeSnapshot } from '../helpers/snapshot'
import { renderExpandedSnapshot as renderPage, stubPrivacyOn, stubSnapshotFetch } from '../helpers/render'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

const PAGES: [string, ReactElement, string[]][] = [
  ['Overview', <Overview />, ['Family goals and stability', 'Current stability']],
  ['Assets', <Assets />, ['Assets · June 2031', 'Accounts and property']],
  ['CashFlow', <CashFlow />, ['Came in', 'Overspent', 'Savings rate', 'Where the money went', 'Where it came from']],
  ['Goals', <Goals />, ['You save a month', 'Saved', 'Needed a month', 'Gets now']],
]

beforeEach(stubSnapshotFetch)

/** The fixture for a page: Income and expenses reads the closed month's rows behind its totals */
const filled = (name: string) => (name === 'CashFlow' ? flowsSnapshot() : name === 'Goals' ? goalsSnapshot() : makeSnapshot())

describe.each(PAGES)('%s page', (name, page, labels) => {
  it('shows its key cards on a filled snapshot', () => {
    renderPage(page, filled(name))
    for (const label of labels) expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders on an empty database without an error banner', () => {
    const { container } = renderPage(page, emptySnapshot())
    expect(container).not.toBeEmptyDOMElement()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a loading skeleton until the snapshot arrives', () => {
    renderPage(page)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})

describe('load failure', () => {
  it.each(PAGES)('%s says the data failed to load', async (_, page) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })))
    renderPage(page)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Failed to load/)
  })
})

describe('key figures from the snapshot', () => {
  const row = { month: '2031-06', member: 'Robin', currency: 'USD', active: 0, passive: 0, activeBase: 0, passiveBase: 0 }

  it('CashFlow breaks the flows down by member', () => {
    const snapshot = flowsSnapshot()
    const { container } = renderPage(<CashFlow />, snapshot)
    const who = container.querySelector('.cf-who')!
    expect(within(who as HTMLElement).getByText(snapshot.members[0])).toBeInTheDocument()
    expect(who).toHaveTextContent('$10,480')
    expect(screen.queryByText('No data')).toBeNull()
  })

  it('CashFlow counts loan payments to the loan owner, not as an account', () => {
    const base = makeSnapshot()
    const rows = [
      { ...row, bank: 'Lumiora Bank', active: 6320, activeBase: 6320, expense: 1480, expenseBase: 1480 },
      { ...row, bank: 'Car loan', expense: 538, expenseBase: 538, loan: true as const },
    ]
    const { container } = renderPage(<CashFlow />, makeSnapshot({ cashflow: { ...base.cashflow, rows } }))
    expect([...container.querySelectorAll('.cf-who tbody tr')].map(r => r.textContent)).toEqual(['RRobin$6,320$2,018'])
    expect(screen.getByText("Loan payments count to the loan's owner.")).toBeInTheDocument()
  })
})

describe('CashFlow spending by category', () => {
  const spending = (mandatory: MandatorySpending | null, months: CategorisedMonth[] = [{
    month: '2031-06',
    categories: [
      { categoryId: 2, name: 'Housing', kind: 'mandatory', flow: 'expense', oneOff: false, amountBase: 2400 },
      { categoryId: 4, name: 'loan_payments', kind: 'loan_payment', flow: 'expense', oneOff: false, amountBase: 538 },
      { categoryId: 1, name: 'Cafes', kind: 'optional', flow: 'expense', oneOff: false, amountBase: 300 },
    ],
    allocatedBase: 3238, totalBase: 3809, unallocatedBase: 571, coveragePct: 85,
  }]) => flowsSnapshot({ spending: { months, mandatory } })
  const card = () => within(screen.getByRole('region', { name: 'Where the money went' }))

  it('shows the categories by kind and what is not split; no mandatory line (its 3 months are the cushion\'s rule, not this page\'s usual)', () => {
    renderPage(<CashFlow />, spending({ perMonthBase: 2400, source: 'categories', months: 3, updatedAt: null }))
    expect(card().getByText('$3,809')).toBeInTheDocument()
    expect(card().getByRole('button', { name: /^Housing/ })).toHaveTextContent('$2,400')
    // the reserved category is titled by its translation key, not by the stored name
    expect(card().getByRole('button', { name: /^Loan payments/ })).toBeInTheDocument()
    expect(card().queryByText('loan_payments')).toBeNull()
    expect(document.querySelector('.cf-list > .cf-row--static')).toHaveTextContent('Not split$571')
    expect(screen.queryByText(/Mandatory spending:/)).toBeNull()
  })
  it('a line without a rate: the sums are unknown, not zero — dashes, no track, and the card says why', () => {
    const months: CategorisedMonth[] = [{
      month: '2031-06',
      categories: [
        { categoryId: 2, name: 'Housing', kind: 'mandatory', flow: 'expense', oneOff: false, amountBase: null },
        { categoryId: 1, name: 'Cafes', kind: 'optional', flow: 'expense', oneOff: false, amountBase: 300 },
      ],
      allocatedBase: 300, totalBase: null, unallocatedBase: null, coveragePct: null,
    }]
    renderPage(<CashFlow />, spending(null, months))
    expect(card().getByText('A line has no exchange rate: its amount and the shares are not counted.')).toBeInTheDocument()
    expect(card().queryByRole('img', { name: /Mandatory, loans/ })).toBeNull()
    expect(card().getByRole('button', { name: /^Housing/ })).toHaveTextContent('—')
    expect(document.querySelector('.cf-list > .cf-row--static')).toHaveTextContent('Not split—')
    expect(card().getByRole('button', { name: /^Cafes/ })).toHaveTextContent('$300')
  })
  it('has no Not split row when the categories cover the month', () => {
    const full = [{
      month: '2031-06',
      categories: [{ categoryId: 2, name: 'Housing', kind: 'mandatory' as const, flow: 'expense' as const, oneOff: false, amountBase: 2400 }],
      allocatedBase: 2400, totalBase: 2400, unallocatedBase: 0, coveragePct: 100,
    }]
    renderPage(<CashFlow />, spending(null, full))
    expect(card().getByRole('button', { name: /^Housing/ })).toBeInTheDocument()
    expect(card().queryByText('Not split')).toBeNull()
  })

  it('without category data the card says so and links to /cashflow/categories', () => {
    renderPage(<CashFlow />, spending(null, []))
    expect(card().getByText(/Expenses of June 2031 are not split by category/)).toBeInTheDocument()
    expect(card().getByRole('link', { name: 'Split' })).toHaveAttribute('href', '/cashflow/categories?month=2031-06')
    expect(screen.queryByText(/Mandatory spending:/)).toBeNull()
  })
})

describe('CashFlow income by source', () => {
  const cat = (categoryId: number, name: string, flow: 'active' | 'passive', amountBase: number, oneOff = false) =>
    ({ categoryId, name, kind: 'optional' as const, flow, oneOff, amountBase })
  const month = (over: Partial<CategorisedMonth> = {}): CategorisedMonth => ({
    month: '2031-06',
    categories: [cat(1, 'Salary', 'active', 5000), cat(2, 'Bonus', 'active', 800, true), cat(3, 'Rent', 'passive', 400)],
    allocatedBase: 6200, totalBase: 6730, unallocatedBase: 530, oneOffBase: 800, coveragePct: 92.1, ...over,
  })
  const withIncome = (months: CategorisedMonth[]) => flowsSnapshot({ income: { months } })
  const card = () => within(screen.getByRole('region', { name: 'Where it came from' }))

  it('shows the sources, the unsplit rest and the one-off line; the heading is the #income anchor', () => {
    renderPage(<CashFlow />, withIncome([month()]))
    expect(screen.getByRole('heading', { name: 'Where it came from' }).id).toBe('income')
    expect(card().getByText('Salary')).toBeInTheDocument()
    expect(card().getByText('Rent')).toBeInTheDocument()
    expect(card().getByText(/^Not split/).closest('li')).toHaveTextContent('$530')
    expect(card().getByText('One-off income $800 (Bonus) is not counted in forecasts.')).toBeInTheDocument()
  })
  it('has no Not split row when everything is split, and no one-off line without one-off sources', () => {
    renderPage(<CashFlow />, withIncome([month({ categories: [cat(1, 'Salary', 'active', 6730)], allocatedBase: 6730, unallocatedBase: 0, oneOffBase: 0, coveragePct: 100 })]))
    expect(card().queryByText(/^Not split/)).toBeNull()
    expect(card().queryByText(/One-off income/)).toBeNull()
  })
  it('without income lines in the month: active and passive, and the card says the income is not split', () => {
    renderPage(<CashFlow />, withIncome([month({ month: '2031-05' })]))
    expect(document.querySelector('.cf-ap')).toHaveTextContent('Active $6,320passive $410 · 6.1%')
    expect(card().getByText('Income of the period is not split by category.')).toBeInTheDocument()
  })
})

describe('empty states', () => {
  // the Overview's pointer to the Data section on an empty database is checked in overview.test.tsx
  it('CashFlow says where to enter income and expenses', () => {
    renderPage(<CashFlow />, emptySnapshot())
    expect(screen.getByText('Enter income and expenses in Close month')).toBeInTheDocument()
  })
})

describe('module-dependent blocks', () => {
  // no health report: savings rate and the cushion are cash-flow numbers, not health ones
  const noHealth = () => makeSnapshot({ health: null })

  it('Overview explains when stability metrics are unavailable', () => {
    renderPage(<Overview />, noHealth())
    expect(screen.getByText('Not enough data for an assessment')).toBeInTheDocument()
  })

  it('CashFlow with income and expenses not tracked: one notice linking to Settings, no figures', () => {
    renderPage(<CashFlow />, makeSnapshot({ trackFlows: false }))
    expect(screen.getByRole('heading', { name: 'Income and expenses tracking is off' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings → General' })).toHaveAttribute('href', '/settings/general')
    expect(screen.queryByText(/Savings rate/)).toBeNull()
  })

  it('Goals without tracked income and expenses keep the progress and say the plan has no data', () => {
    renderPage(<Goals />, goalsSnapshot({ track: false }))
    expect(screen.getAllByText('Saved').length).toBeGreaterThan(0)
    expect(screen.queryByText('You save a month')).toBeNull()
    expect(screen.getByRole('link', { name: 'Settings → General' })).toHaveAttribute('href', '/settings/general')
  })

  it('CashFlow without health still shows the savings rate', () => {
    renderPage(<CashFlow />, flowsSnapshot({ health: null }))
    expect(screen.getByText('Savings rate').closest('.kpi')).toHaveTextContent('−55.7%')
  })

  it('CashFlow without health still shows passive income and no emergency fund', () => {
    renderPage(<CashFlow />, flowsSnapshot({ health: null }))
    expect(document.querySelector('.cf-ap')).toHaveTextContent('passive $410')
    expect(screen.queryByText(/Emergency fund/)).toBeNull()
  })

})

describe('one owner page per metric', () => {
  const DASHBOARD: [string, ReactElement][] = [
    ['Overview', <Overview />], ['Assets', <Assets />], ['CashFlow', <CashFlow />], ['Goals', <Goals />], ['Health', <HealthPage />],
  ]

  /** The titles of the page's comparison cards. */
  const compareCards = (page: ReactElement) => {
    const { container } = renderPage(page, makeSnapshot())
    const labels = [...container.querySelectorAll('.cmp__label span')].map(el => el.textContent)
    cleanup()
    return labels
  }

  it('shows no comparison card on two dashboard pages', () => {
    const owners = new Map<string, string[]>()
    for (const [name, page] of DASHBOARD) {
      for (const label of compareCards(page)) owners.set(label!, [...(owners.get(label!) ?? []), name])
    }
    expect([...owners.values()].filter(pages => pages.length > 1)).toEqual([])
    expect(Object.fromEntries(owners)).toEqual({})
  })

  it('gives the Cash flow headline no trend chart, and the Overview no headline card at all (its number is the net-worth block)', () => {
    const found = (page: ReactElement) => {
      const { container } = renderPage(page, makeSnapshot())
      const els = [container.querySelector('.hl'), container.querySelector('.hl .trend'), container.querySelector('.family-overview')]
      cleanup()
      return els.map(el => el !== null)
    }
    expect(found(<Overview />)).toEqual([false, false, true])
    expect(found(<CashFlow />)).toEqual([false, false, false])
  })

  it('leaves the emergency fund to the health page', () => {
    renderPage(<CashFlow />, makeSnapshot())
    expect(screen.queryByText(/Emergency fund/)).toBeNull()
  })

  it('gives Goals no comparison group', () => {
    expect(compareCards(<Goals />)).toEqual([])
    renderPage(<Goals />, goalsSnapshot())
    expect(screen.queryByText(/Savings rate|Passive income/)).toBeNull()
  })
})

describe('period pills placement', () => {
  const pills = () => screen.queryAllByRole('group', { name: 'Period' })

  it('are the Income and expenses page\'s own period, once', () => {
    renderPage(<CashFlow />, flowsSnapshot())
    expect(pills()).toHaveLength(1)
  })
  it('the History card at the end of Assets has its own period group, not the dashboard pills', async () => {
    renderPage(<Assets />, makeSnapshot())
    expect(pills()).toHaveLength(0)
    fireEvent.click(screen.getByText('History'))
    expect((await screen.findByRole('group', { name: 'History period' })).closest('.card')).toHaveTextContent(/growth|Doubling|two.*bal/i)
    expect(pills()).toHaveLength(0)
  })
  it.each([['Goals', <Goals />], ['Health', <HealthPage />], ['Overview', <Overview />], ['Assets', <Assets />]] as [string, ReactElement][])('are not on %s', (_, page) => {
    renderPage(page, makeSnapshot())
    expect(pills()).toHaveLength(0)
  })
})

// the Health page shows no money amount at all (its metrics are ratios and months): no mask to find there
const PRIVATE: [string, ReactElement, boolean][] = [...PAGES.map(([name, page]) => [name, page, true] as [string, ReactElement, boolean]), ['Health', <HealthPage />, true]]

describe.each(PRIVATE)('%s page in privacy mode', (name, page, masks) => {
  it('draws no amounts, only the mask', () => {
    stubPrivacyOn()
    const { container } = renderPage(page, filled(name))
    expect(container.textContent!.includes('•••')).toBe(masks)
    expect(container.textContent).not.toMatch(/\d[\d,.\s]*\s?[$€₽]|[$€₽]\s?\d/)
  })
})
