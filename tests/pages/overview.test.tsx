import { createElement } from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { Overview } from '../../src/pages/Overview'
import { CORE_ROUTES } from '../../src/routes'
import type { FinanceSnapshot, GoalItem } from '../../src/domain/types'
import { emptySnapshot, makeSnapshot } from '../helpers/snapshot'
import { HIST, LONG_HIST, withHistory } from '../helpers/history'
import { pageText as text, renderWithSnapshot as renderPage, stubPrivacyOn, stubSnapshotFetch } from '../helpers/render'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

const TODAY = new Date('2026-11-07T12:00:00Z')
/** The demo-shaped history with October 2026 open */
const demo = (over: Partial<FinanceSnapshot> = {}) => ({ ...withHistory(HIST, ['2026-10']), ...over })
const goalItem = (id: string, name: string, target: number, current: number, target_date: string): GoalItem =>
  ({ id, name, target, current, target_date, emoji: null, currency: 'USD', targetBase: target, currentBase: current })
/** The demo snapshot with a goal, so that the goals card has something to draw */
function withGoals(over: Partial<FinanceSnapshot> = {}, items = [goalItem('roof', 'New roof', 10000, 2500, '2033-05-31')]): FinanceSnapshot {
  const base = demo()
  return { ...base, goals: { ...base.goals, items }, ...over }
}
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

beforeEach(() => {
  stubSnapshotFetch()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
})
afterEach(() => { vi.useRealTimers(); localStorage.clear(); resetAuth() })

describe('Overview in privacy mode', () => {
  const hide = stubPrivacyOn

  // no amounts and the mask on every dashboard page: dashboardPages.test.tsx
  it('does not expose warning amounts in privacy mode', () => {
    hide()
    const { container } = renderPage(<Overview />, demo({ warnings: [{ code: 'lines_exceed_total', params: { flow: 'expense', lines: 987654, total: 123456 } }] }))
    expect(container.textContent?.replace(/[^0-9]/g, '')).not.toContain('987654')
    expect(container.textContent?.replace(/[^0-9]/g, '')).not.toContain('123456')
  })

  it('keeps goal percentages legible while masking the amount saved', () => {
    hide()
    renderPage(<Overview />, withGoals())
    expect(screen.getByRole('img', { name: 'New roof: 25%' })).toBeInTheDocument()
    expect(screen.getByText('••• of •••')).toBeInTheDocument()
  })
})

describe('Overview setup notices', () => {
  const rights = (canRun: boolean) => ({ name: 'Noa', rights: { edit: true, vote: true, manage: canRun } })
  const TEXT = {
    setupPending: /The family's setup has not been finished yet/,
    setupSkipped: 'Finish setting up the app',
  }

  it.each([
    ['pending', false, 'setupPending'],
    ['skipped', false, 'setupPending'],
    ['skipped', true, 'setupSkipped'],
    ['done', true, null],
    ['pending', true, null],
  ] as const)('setup %s, may run it %s: notice %s', (setup, canRun, notice) => {
    setAuth({ mode: 'password', authenticated: true, me: rights(canRun), setup })
    renderPage(<Overview />, demo())
    for (const [key, matcher] of Object.entries(TEXT)) {
      if (key === notice) expect(screen.getByText(matcher)).toBeInTheDocument()
      else expect(screen.queryByText(matcher)).toBeNull()
    }
    if (notice === 'setupSkipped') expect(screen.getByRole('link', { name: 'Open the setup' })).toHaveAttribute('href', '/setup')
    else expect(screen.queryByRole('link', { name: 'Open the setup' })).toBeNull()
  })
})

describe('Overview', () => {
  it('shares owner and period with the ledger while goals keep their family scope', () => {
    const snapshot = withGoals()
    renderPage(<Overview />, snapshot)
    const owner = snapshot.members[0]
    const filter = screen.getByRole('group', { name: 'Whose accounts' })
    fireEvent.click(within(filter).getByRole('button', { name: new RegExp(owner) }))
    expect(screen.getByRole('heading', { name: 'Personal net worth' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Family goals' })).toBeInTheDocument()
    const ledger = screen.getByRole('region', { name: 'Accounts and debts' })
    expect(within(ledger).getByText(owner)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '3 months' }))
    expect(within(ledger).getByText('3 months')).toBeInTheDocument()
  })

  it('offers the history import while the history is short, to someone who may edit, never in the demo', async () => {
    setAuth({ mode: 'password', authenticated: true, me: { name: 'Noa', rights: { edit: true, vote: true, manage: false } } })
    renderPage(<Overview />, emptySnapshot())
    expect(await screen.findByRole('link', { name: 'Import your history' })).toHaveAttribute('href', '/settings/data')
  })

  it('no history import hint on a long history or in the demo', () => {
    setAuth({ mode: 'password', authenticated: true, me: { name: 'Noa', rights: { edit: true, vote: true, manage: false } } })
    const { unmount } = renderPage(<Overview />, makeSnapshot({ history: LONG_HIST }))
    expect(screen.queryByRole('link', { name: 'Import your history' })).toBeNull()
    unmount()
    setAuth({ mode: 'demo', authenticated: true, me: { name: 'demo', rights: { edit: true, vote: true, manage: true } } })
    renderPage(<Overview />, emptySnapshot())
    expect(screen.queryByRole('link', { name: 'Import your history' })).toBeNull()
  })

  it('explains what to do on an empty database', () => {
    const { container } = renderPage(<Overview />, emptySnapshot())
    expect(screen.getByText('Enter account balances in Close month')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.querySelector('.comb')).toBeNull()
    expect(container.querySelector('.nw')).toBeNull()
    expect(text(container)).not.toMatch(/NaN|Infinity|undefined/)
  })

})

describe('the primary action of the title row', () => {
  const Primary = CORE_ROUTES.find(r => r.path === '/')!.primary!

  it('is "Close October 2026" while a month is open', () => {
    renderPage(createElement(Primary), demo())
    const link = screen.getByRole('link', { name: 'Close October 2026' })
    expect(link).toHaveAttribute('href', '/close')
    expect(link).toHaveClass('btn--primary')
  })

  it('is nothing while every month is closed', () => {
    const { container } = renderPage(createElement(Primary), withHistory(HIST))
    expect(container).toBeEmptyDOMElement()
  })
})

describe('Goals card', () => {
  it('draws a ring per goal with its progress, the saved and target amounts', () => {
    renderPage(<Overview />, withGoals({}, [goalItem('roof', 'New roof', 10000, 2500, '2033-05-31'), goalItem('trip', 'Sea trip', 4000, 3000, '2032-01-31')]))
    expect(screen.getByRole('img', { name: 'New roof: 25%' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Sea trip: 75%' })).toBeInTheDocument()
    expect(screen.getByText('$2,500 of $10,000')).toBeInTheDocument()
    expect(screen.queryByText(/Goals are short/)).toBeNull()
  })

  it('shows at most three goals and no chip while the savings cover the goals', () => {
    const base = demo()
    const items = ['a', 'b', 'c', 'd'].map(id => goalItem(id, `Goal ${id}`, 1000, 500, '2033-05-31'))
    renderPage(<Overview />, withGoals({ goals: { ...base.goals, items, plan: { ...base.goals.plan, surplusBase: 10 } } }, items))
    expect(screen.getAllByRole('img', { name: /^Goal [a-d]: 50%$/ })).toHaveLength(3)
    expect(screen.queryByText(/Goals are short/)).toBeNull()
  })
})

describe('Stability card', () => {
  it('the stability ring counts the metrics in the good zones and names the amber one', () => {
    const base = demo()
    // one amber stability metric; the independence metrics are red, and not stability
    const metrics = Object.fromEntries(Object.entries(base.health!.metrics).map(([k, m]) =>
      [k, { ...m, zone: k === 'emergency_months' ? 'amber' : k === 'fi_rate' || k === 'income_diversification' ? 'red' : 'green' }])) as NonNullable<typeof base.health>['metrics']
    renderPage(<Overview />, demo({ health: { ...base.health!, metrics } }))
    expect(screen.getByRole('img', { name: 'Current stability: 6 / 7' })).toBeInTheDocument()
    expect(document.querySelectorAll('.ring__fill--amber')).toHaveLength(1)
    expect(document.querySelectorAll('.ring__fill--red')).toHaveLength(0)
    expect(screen.getByText('Needs work')).toBeInTheDocument()
    expect(screen.queryByText(/Below the norm/)).toBeNull()
    expect(screen.queryByText('Critical')).toBeNull()
    // a chip per stability metric, in the ring's order, toned by its zone
    const chips = [...document.querySelectorAll('.stability__chips .chip')]
    expect(chips).toHaveLength(7)
    expect(chips.filter(c => c.getAttribute('data-color') === 'warning').map(c => c.textContent)).toEqual([expect.stringContaining('months of expenses in reserve')])
    expect(chips.filter(c => c.getAttribute('data-color') === 'success')).toHaveLength(6)
    expect(chips.filter(c => c.getAttribute('data-color') === 'error')).toHaveLength(0)
    expect(chips[0]).toHaveTextContent('Savings rate')
  })

  it('a red stability metric colours its arc and gives the critical word', () => {
    renderPage(<Overview />, demo())
    expect(screen.getByRole('img', { name: 'Current stability: 5 / 7' })).toBeInTheDocument()
    expect(document.querySelectorAll('.ring__fill--red')).toHaveLength(1)
    expect(document.querySelectorAll('.ring__fill--amber')).toHaveLength(1)
    expect(screen.getByText('Critical')).toBeInTheDocument()
    expect(screen.queryByText(/Below the norm/)).toBeNull()
  })

  it('says there is no data when nothing is computed', () => {
    renderPage(<Overview />, demo({ health: null }))
    expect(screen.getByText('Not enough data for an assessment')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Current stability/ })).toBeNull()
  })
})

describe('the requested month', () => {
  afterEach(() => window.history.replaceState({}, '', '/'))

  it('labels the requested month separately instead of passing off latest totals as its results', async () => {
    window.history.replaceState({}, '', '/?month=2020-01')
    renderPage(<Overview />, demo())
    expect(await screen.findByRole('heading', { name: 'Results for January 2020' })).toBeInTheDocument()
    expect(screen.getByText('No saved totals for this month are available in this view.')).toBeInTheDocument()
  })

  it('shows only requested-month historical evidence above the latest dashboard', async () => {
    window.history.replaceState({}, '', '/?month=2030-06')
    const base = makeSnapshot()
    const snapshot = makeSnapshot({ cashflow: { ...base.cashflow, rows: [
      { month: '2030-06', bank: 'Bank', member: '', currency: 'USD', active: 100, passive: 20, expense: 50, activeBase: 100, passiveBase: 20, expenseBase: 50 },
      { month: '2031-06', bank: 'Bank', member: '', currency: 'USD', active: 900, passive: 0, expense: 300, activeBase: 900, passiveBase: 0, expenseBase: 300 },
    ] } })
    renderPage(<Overview />, snapshot)
    const heading = await screen.findByRole('heading', { name: 'Results for June 2030' })
    expect(heading.parentElement).toHaveTextContent('Net worth: $127,500')
    expect(heading.parentElement).toHaveTextContent('Income: $120 · Expenses: $50 · Left after expenses: $70')
    expect(heading.parentElement).not.toHaveTextContent('$900')
    expect(follows(heading, screen.getByRole('heading', { name: 'Family goals and stability' }))).toBe(true)
  })

  it('names an overspent month as such in its results', async () => {
    window.history.replaceState({}, '', '/?month=2030-06')
    const base = makeSnapshot()
    renderPage(<Overview />, makeSnapshot({ cashflow: { ...base.cashflow, rows: [
      { month: '2030-06', bank: 'Bank', member: '', currency: 'USD', active: 50, passive: 0, expense: 120, activeBase: 50, passiveBase: 0, expenseBase: 120 },
    ] } }))
    const heading = await screen.findByRole('heading', { name: 'Results for June 2030' })
    expect(heading.parentElement).toHaveTextContent('Income: $50 · Expenses: $120 · Overspent: $70')
  })
})

describe('the latest milestone for the partner', () => {
  afterEach(() => window.history.replaceState({}, '', '/'))
  const withMilestone = (over: Partial<FinanceSnapshot['milestones'] extends (infer M)[] | undefined ? M : never> = {}) => {
    const s = demo()
    const month = s.asOf.capitalDate!.slice(0, 7)
    return { month, snapshot: { ...s, milestones: [{ month, kind: 'loanPaidOff' as const, params: { name: 'Car loan' }, headline: true, celebrated: true, announced: true, ...over }] } }
  }

  it('shows the shown month\'s headline milestone in the net-worth block', async () => {
    renderPage(<Overview />, withMilestone().snapshot)
    expect(await screen.findByText('Car loan paid off.')).toBeInTheDocument()
    expect(screen.getAllByText('Car loan paid off.')).toHaveLength(1)
  })

  it('is hidden while the close card of that month is shown', async () => {
    const { month, snapshot } = withMilestone()
    window.history.replaceState({}, '', `/?month=${month}`)
    renderPage(<Overview />, snapshot)
    await screen.findByRole('heading', { name: /^Results for / })
    expect(screen.queryAllByText('Car loan paid off.').length).toBeLessThanOrEqual(1)
  })

  it('says nothing for a month closed by an import', async () => {
    renderPage(<Overview />, withMilestone({ celebrated: false, announced: false }).snapshot)
    await screen.findByRole('heading', { name: 'Family goals and stability' })
    expect(screen.queryByText('Car loan paid off.')).toBeNull()
  })

  it('masks the amount in privacy mode', async () => {
    stubPrivacyOn()
    renderPage(<Overview />, withMilestone({ kind: 'netWorthMark', level: 600_000, params: { amount: 600_000 }, currency: 'USD' }).snapshot)
    expect(await screen.findByText('Net worth passed ••• for the first time.')).toBeInTheDocument()
  })
})
