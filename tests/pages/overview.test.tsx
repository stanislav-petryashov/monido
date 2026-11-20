import { createElement } from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { Overview } from '../../src/pages/Overview'
import { CORE_ROUTES } from '../../src/routes'
import type { FinanceSnapshot, GoalItem } from '../../src/domain/types'
import { fmtCurrency } from '../../src/lib/formatters'
import { emptySnapshot, makeSnapshot } from '../helpers/snapshot'
import { HIST, LONG_HIST, withHistory } from '../helpers/history'
import { pageText as text, renderWithSnapshot as renderPage, stubPrivacyOn, stubSnapshotFetch } from '../helpers/render'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

/** The comb's current year is today's: pinned, so the cells do not depend on the day the tests run */
const TODAY = new Date('2026-11-07T12:00:00Z')
const usd = (v: number) => fmtCurrency(v, 'USD')
/** The demo-shaped history with October 2026 open */
const demo = (over: Partial<FinanceSnapshot> = {}) => ({ ...withHistory(HIST, ['2026-10']), ...over })
/** The KPI row of the modules' cells; null when no module supplies one */
const kpiList = () => screen.queryByRole('list', { name: 'Key figures' })
/** The cards of the grid under the KPI row, in order */
const gridCards = () => [...document.querySelectorAll<HTMLElement>('.overview-grid > .card')]
const cardTitles = () => gridCards().map(c => c.querySelector('.card-hd')?.textContent)
const comb = () => screen.getByRole('group', { name: 'Years of net worth' })
const combCells = () => [...document.querySelectorAll<HTMLElement>('.comb__year')]
const block = () => document.querySelector<HTMLElement>('.nw')!
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

  it('keeps percentages visible and masks the amounts of the cells and cards', () => {
    hide()
    renderPage(<Overview />, withGoals())
    expect(screen.getByText('savings rate −55.7%')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'New roof: 25%' })).toBeInTheDocument()
    const cells = within(kpiList()!).getAllByRole('listitem')
    expect(cells[0].querySelector('.kpi__value')).toHaveTextContent('•••')
    expect(cells[2].querySelector('.kpi__value')).toHaveTextContent('•••')
  })

  it('masks the comb heads, the value, the tag and the KPI values, and the drawings say what they show, not how much', () => {
    hide()
    const { container } = renderPage(<Overview />, demo())
    expect(combCells().map(c => c.querySelector('.comb__head-value')?.textContent)).toEqual(['•••', '•••', '•••', '•••'])
    expect(combCells().every(c => c.querySelector('.comb__change')?.textContent === '•••')).toBe(true)
    expect(block().querySelector('.nw__value')).toHaveTextContent('•••')
    expect(block().querySelector('.wchart__tagText')).toHaveTextContent('•••')
    expect(screen.getByRole('img', { name: '13 months to September 2026' })).toBeInTheDocument()
    // the money cells are masked; the cushion is months, which stay
    expect(within(kpiList()!).getAllByRole('listitem').map(c => c.querySelector('.kpi__value')?.textContent)).toEqual(['•••', '•••', '•••', '1.8 mo'])
    expect(text(container).replace(/[^0-9]/g, '')).not.toContain('758673')
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
  it('scopes historical selection separately from the current summary', () => {
    renderPage(<Overview />, demo())
    const history = screen.getByRole('region', { name: 'Net worth history' })
    const summary = screen.getByRole('region', { name: 'Current summary' })
    expect(within(summary).getByText(/Income/)).toBeInTheDocument()
    fireEvent.click(within(history).getByRole('button', { name: 'May 2024' }))
    expect(within(history).getByText(/Net worth · May 2024/)).toBeInTheDocument()
    expect(within(summary).getByText(/Income/).parentElement).toHaveTextContent('$6,730')
  })

  it('lays out the comb, then the net-worth block, then the key figures, then the cards', () => {
    renderPage(<Overview />, demo())
    const list = kpiList()!
    expect(follows(comb(), block())).toBe(true)
    expect(follows(block(), list)).toBe(true)
    expect(follows(list, gridCards()[0])).toBe(true)
  })

  it('opens on the last closed month: its label, its value and the window up to it', () => {
    renderPage(<Overview />, demo())
    expect(block().querySelector('.nw__label')).toHaveTextContent('Net worth · September 2026')
    expect(block().querySelector('.nw__value')).toHaveTextContent(usd(758673))
    expect(screen.getByRole('img', { name: '13 months to September 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sep 2026' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens on the balances\' month when the newest month was closed with balances only', () => {
    const base = demo()
    // the flows stop at August; September has balances only
    renderPage(<Overview />, { ...base, asOf: { ...base.asOf, closedMonth: '2026-08' } })
    expect(block().querySelector('.nw__label')).toHaveTextContent('Net worth · September 2026')
    expect(screen.getByRole('button', { name: 'Sep 2026' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Aug 2026' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('says "first recorded month" only for the first point; after a gap there is no month change', () => {
    renderPage(<Overview />, withHistory(HIST.filter(p => !p.date.startsWith('2026-08')), ['2026-10']))
    const deltas = () => block().querySelector('.nw__deltas')!
    expect(deltas()).not.toHaveTextContent('first recorded month')
    expect(deltas()).not.toHaveTextContent('over the month')
    expect(deltas()).toHaveTextContent('over the year')
    fireEvent.click(screen.getByRole('button', { name: 'Oct 2023' }))
    expect(deltas()).toHaveTextContent('first recorded month')
  })

  it('draws the bridge without a loans part when the month has no loans', () => {
    const history = HIST.map(p => ({ ...p, assets: p.netWorth, liabilities: 0 }))
    renderPage(<Overview />, withHistory(history, ['2026-10']))
    const bridge = block().querySelector('.bridge-block')!
    expect(bridge.querySelector('.bridge__net')).not.toBeNull()
    expect(bridge.querySelector('.bridge__loans')).toBeNull()
    expect(bridge.querySelector('.bridge__key--loans')).toBeNull()
    expect(bridge).not.toHaveTextContent('Loans')
    expect(bridge.querySelector('.note')).toHaveTextContent(`Assets of ${usd(758673)} that month: the violet part is owned outright`)
    expect(bridge.querySelector('.note')).not.toHaveTextContent('covered by loans')
  })

  it('a click on a month stroke moves the block to that month', () => {
    renderPage(<Overview />, demo())
    fireEvent.click(screen.getByRole('button', { name: 'May 2024' }))
    expect(block().querySelector('.nw__label')).toHaveTextContent('Net worth · May 2024')
    expect(block().querySelector('.nw__value')).toHaveTextContent(usd(582192))
    // eight points from October 2023: the window clamps to the start
    expect(screen.getByRole('img', { name: '8 months to May 2024' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'May 2024' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Sep 2026' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the to-do off the canvas: no notice for the open month, no history disclosure', () => {
    const { container } = renderPage(<Overview />, demo())
    expect(container.querySelector('.notice, .open-notice')).toBeNull()
    expect(screen.queryByText(/not closed/)).toBeNull()
    expect(screen.queryByText('History')).toBeNull()
    expect(screen.queryByText('What changed?')).toBeNull()
    expect(screen.queryByRole('link', { name: /^Close / })).toBeNull()
  })

  it('a short history: one comb cell, and the window clamps to what there is', () => {
    const { container } = renderPage(<Overview />, withHistory(HIST.slice(-3), ['2026-10']))
    expect(combCells()).toHaveLength(1)
    expect(combCells()[0].querySelector('.comb__head')).toHaveTextContent('2026 · in progress')
    expect(screen.getByRole('img', { name: '3 months to September 2026' })).toBeInTheDocument()
    expect(block().querySelector('.nw__deltas')).toHaveTextContent('over the month')
    expect(block().querySelector('.nw__deltas')).not.toHaveTextContent('over the year')
    expect(text(container)).not.toMatch(/NaN|Infinity|undefined/)
    expect(screen.queryByRole('button', { name: 'Earlier' })).toBeNull()
  })

  it('an open January after a closed December: a fifth cell with only the open stroke, and Earlier appears', () => {
    const toDecember = LONG_HIST.filter(p => p.date <= '2026-12-31')
    renderPage(<Overview />, withHistory(toDecember, ['2027-01']))
    expect(combCells()).toHaveLength(4)
    expect(combCells().map(c => c.querySelector('.comb__head-year')?.textContent)).toEqual(['2024', '2025', '2026 · in progress', '2027'])
    const next = combCells()[3]
    expect(next.querySelectorAll('.comb__stroke--open')).toHaveLength(1)
    expect(next.querySelectorAll('.comb__stroke--none')).toHaveLength(11)
    expect(next.querySelector('.comb__head-value')).toHaveTextContent('—')
    expect(screen.getByRole('button', { name: 'Earlier' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Earlier' }))
    expect(combCells().map(c => c.querySelector('.comb__head-year')?.textContent)).toEqual(['2023', '2024', '2025', '2026 · in progress'])
    expect(screen.getByRole('button', { name: 'Earlier' })).toBeDisabled()
  })

  it('the open month stroke leads to Close month', () => {
    renderPage(<Overview />, demo())
    const open = screen.getByRole('button', { name: 'Oct 2026 · open' })
    expect(open).not.toHaveAttribute('aria-pressed')
    fireEvent.click(open)
    expect(window.location.pathname).toBe('/close')
    window.history.replaceState(null, '', '/')
  })

  it('shows the closed month in the cells and the twelve months in the card, without a "Key metrics" heading', () => {
    renderPage(<Overview />, demo())
    const cells = within(kpiList()!).getAllByRole('listitem')
    expect(cells[0]).toHaveTextContent('Income$6,730')
    expect(cells[1]).toHaveTextContent('Expenses$10,480')
    expect(cells[2]).toHaveTextContent('Left after expenses−$3,750')
    expect(cells[2]).toHaveTextContent('savings rate −55.7%')
    expect(cells[3]).toHaveTextContent('Emergency fund1.8 mo')
    expect(cells[3]).toHaveTextContent('of 6 mo by the goal')
    expect(screen.getByText('Left after expenses · 12 months')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Key metrics' })).toBeNull()
  })

  it('keeps detailed account lists, status cards and duplicate charts off the overview', () => {
    const { container } = renderPage(<Overview />, demo())
    expect(container.querySelector('.overview-flow')).toBeNull()
    expect(container.querySelectorAll('.status')).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: 'Accounts' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Breakdown' })).toBeNull()
    expect(screen.queryAllByRole('button', { name: /Ask Claude/ })).toHaveLength(0)
    // the holdings are named only in the "Whose assets" meta line, never as a list with amounts
    expect(container.querySelectorAll('.lane-meta')).toHaveLength(1)
    expect(text(container).match(/City apartment/g)).toHaveLength(1)
    expect(text(container).match(/Lumiora Bank/g)).toHaveLength(1)
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

  it('has no filled hero or donut chart', () => {
    renderPage(<Overview />, demo())
    expect(screen.queryByTestId('chart')).toBeNull()
    expect(document.querySelector('.hl')).toBeNull()
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

describe('module blocks', () => {
  it('no balances: no block and no comb, as there is no month to show', () => {
    const { container } = renderPage(<Overview />, makeSnapshot({ capital: null, history: [], asOf: { capitalDate: null, closedMonth: '2031-06', openMonths: [], today: '2031-07-03' } }))
    expect(container.querySelector('.nw')).toBeNull()
    expect(container.querySelector('.comb')).toBeNull()
    expect(text(container)).not.toContain('$0')
  })

  it('all on: four KPI cells with the cushion marked current, and four cards in order', () => {
    renderPage(<Overview />, withGoals())
    const cells = within(kpiList()!).getAllByRole('listitem')
    expect(cells.map(c => c.textContent)).toEqual([
      expect.stringMatching(/^Income/), expect.stringMatching(/^Expenses/), expect.stringMatching(/^Left after expenses/), expect.stringMatching(/^Emergency fund/),
    ])
    expect(cells.map(c => c.classList.contains('kpi--current'))).toEqual([false, false, false, true])
    expect(cardTitles()).toEqual(['Whose assets', 'Left after expenses · 12 months', 'Goals', 'Current stability'])
  })
})

describe('Goals card', () => {
  it('draws a ring per goal with its progress, the amounts and the deadline, and the shortfall as a chip', () => {
    renderPage(<Overview />, withGoals({}, [goalItem('roof', 'New roof', 10000, 2500, '2033-05-31'), goalItem('trip', 'Sea trip', 4000, 3000, '2032-01-31')]))
    expect(screen.getByRole('img', { name: 'New roof: 25%' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Sea trip: 75%' })).toBeInTheDocument()
    expect(screen.getByText('$2,500 of $10,000 · by May 2033')).toBeInTheDocument()
    expect(screen.getByText('Goals are short by $7,240 a month')).toHaveClass('chip')
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
    expect(screen.getByText('Below the norm: Emergency fund')).toBeInTheDocument()
    expect(screen.queryByText('Critical')).toBeNull()
    // a chip per stability metric, in the ring's order, toned by its zone
    const chips = [...document.querySelectorAll('.stability__chips .chip')]
    expect(chips).toHaveLength(7)
    expect(chips.filter(c => c.getAttribute('data-color') === 'warning').map(c => c.textContent)).toEqual(['All liquid assets / spending'])
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
    expect(screen.getByText('Below the norm: Savings rate, Emergency fund')).toBeInTheDocument()
  })

  it('says there is no data when nothing is computed', () => {
    renderPage(<Overview />, demo({ health: null }))
    expect(screen.getByText('Not enough data for an assessment')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Current stability/ })).toBeNull()
  })
})

describe('narrow screens', () => {
  const narrow = () => vi.stubGlobal('matchMedia', (query: string) =>
    ({ matches: /max-width:\s*6[04]0px/.test(query), media: query, addEventListener() {}, removeEventListener() {} }))

  it('shows one comb year with the pills, then the block, the KPI row and the cards (the columns are CSS)', () => {
    narrow()
    renderPage(<Overview />, demo())
    expect(combCells()).toHaveLength(1)
    expect(combCells()[0]).toHaveClass('comb__year--current')
    const pills = screen.getByRole('group', { name: 'Year' })
    expect(within(pills).getAllByRole('button')).toHaveLength(4)
    expect(follows(pills, block())).toBe(true)
    expect(follows(block(), kpiList()!)).toBe(true)
    expect(follows(kpiList()!, gridCards()[0])).toBe(true)
  })
})

describe('Wallet overview cashflow chart', () => {
  it('keeps closed cashflow history on its owning page', () => {
    const snapshot = demo()
    snapshot.cashflow.rows = [{ month: '2031-06', bank: 'Bank', member: 'Noa', currency: 'USD', activeBase: 6730, passiveBase: 0, expenseBase: 10480, active: 6730, passive: 0, expense: 10480 }]
    const { container } = renderPage(<Overview />, snapshot)
    expect(container.querySelector('.overview-flow')).toBeNull()
    expect(kpiList()).not.toBeNull()
  })
  it('does not reveal cashflow history in private mode', () => {
    stubPrivacyOn()
    const { container } = renderPage(<Overview />, demo())
    expect(container.querySelector('.overview-flow')).toBeNull()
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
    // the result card comes before the comb
    expect(follows(heading, comb())).toBe(true)
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
    return { month, snapshot: { ...s, milestones: [{ month, kind: 'loanPaidOff' as const, params: { name: 'Car loan' }, headline: true, celebrated: true, ...over }] } }
  }

  it('shows the shown month\'s headline milestone in the net-worth block', async () => {
    renderPage(<Overview />, withMilestone().snapshot)
    expect(await screen.findByText('Car loan paid off.')).toBeInTheDocument()
    expect(document.querySelector('.nw .nw__milestone')).not.toBeNull()
  })

  it('is hidden while the close card of that month is shown', async () => {
    const { month, snapshot } = withMilestone()
    window.history.replaceState({}, '', `/?month=${month}`)
    renderPage(<Overview />, snapshot)
    await screen.findByRole('heading', { name: /^Results for / })
    expect(document.querySelector('.nw__milestone')).toBeNull()
  })

  it('says nothing for a month closed by an import', async () => {
    renderPage(<Overview />, withMilestone({ celebrated: false }).snapshot)
    await screen.findByRole('group', { name: 'Years of net worth' })
    expect(document.querySelector('.nw__milestone')).toBeNull()
  })

  it('masks the amount in privacy mode', async () => {
    stubPrivacyOn()
    renderPage(<Overview />, withMilestone({ kind: 'netWorthMark', level: 600_000, params: { amount: 600_000 }, currency: 'USD' }).snapshot)
    expect(await screen.findByText('Net worth passed ••• for the first time.')).toBeInTheDocument()
  })
})

describe('the way into a finished year', () => {
  it('links a finished year in the comb to its Year period on Income and expenses, through the module', async () => {
    renderPage(<Overview />, demo())
    expect(await screen.findByRole('link', { name: '2025: the year on Income and expenses' })).toHaveAttribute('href', '/cashflow?p=year&m=2025-12')
  })
})
