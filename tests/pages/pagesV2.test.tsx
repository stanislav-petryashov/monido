import { cleanup, fireEvent, screen } from '@testing-library/react'
import { compareView } from '../../src/lib/snapshotSelectors'
import { Overview } from '../../src/pages/Overview'
import { CashFlow } from '../../src/pages/CashFlow'
import { Goals } from '../../src/pages/Goals'
import { Assets } from '../../src/pages/Assets'
import { emptySnapshot, flowsSnapshot, makeGrowthBeyondSavings, makeSnapshot } from '../helpers/snapshot'
import { DEMO_GOALS, goalsSnapshot } from '../helpers/goals'
import type { FinanceSnapshot } from '../../src/domain/types'
import { pageText, renderExpandedSnapshot as renderPage, stubSnapshotFetch } from '../helpers/render'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

const BROKEN = /NaN|Infinity|undefined/

beforeEach(() => { stubSnapshotFetch() })

describe('CashFlow v2', () => {
  const kpi = (label: string) => screen.getByText(label, { selector: '.cf-kpi__label' }).closest('.cf-kpi') as HTMLElement

  it('leads with the closed month and shows the same savings rate as the overview card', () => {
    const snapshot = flowsSnapshot()
    const overview = pageText(renderPage(<Overview />, snapshot).container)
    cleanup()
    renderPage(<CashFlow />, snapshot)
    expect(screen.getByText('June 2031')).toBeInTheDocument()
    const rate = compareView(snapshot, 'savings_rate', String).value
    expect(rate).toBe('−55.7%')
    expect(overview).toContain(`savings rate ${rate}`)
    expect(kpi('Savings rate')).toHaveTextContent(rate)
    expect(kpi('Came in')).toHaveTextContent('$6,730')
    expect(kpi('Went out')).toHaveTextContent('$10,480')
  })

  it('splits income into active and passive in one bar', () => {
    renderPage(<CashFlow />, flowsSnapshot())
    expect(screen.getByRole('img', { name: 'Active and passive income' })).toBeInTheDocument()
    expect(document.querySelector('.cf-ap')).toHaveTextContent('Active $6,320passive $410 · 6.1%')
  })

  it('keeps sums neutral: no verdict colours on the page', () => {
    const { container } = renderPage(<CashFlow />, flowsSnapshot())
    // a status chip or avatar; a signed change is ink everywhere
    expect(container.querySelector('.chip, [data-color]')).toBeNull()
  })
})

describe('Goals v2', () => {
  // independence carries the forecasts: the page opens on it
  beforeEach(() => window.history.replaceState(null, '', '/goals?goal=fire'))
  afterEach(() => window.history.replaceState(null, '', '/'))
  const fireSnapshot = (over: Partial<FinanceSnapshot> = {}): FinanceSnapshot => ({ ...goalsSnapshot(), ...over })

  it('links the growth per year to its owner, the History section of Assets', () => {
    renderPage(<Goals />, fireSnapshot())
    const link = screen.getByRole('link', { name: 'See the history' })
    expect(link).toHaveAttribute('href', '/assets#history')
    expect(link.closest('.stat')).toHaveTextContent('Net worth growth per year')
  })

  it('an ordinary goal has no forecasts', () => {
    window.history.replaceState(null, '', '/goals?goal=vacation')
    renderPage(<Goals />, fireSnapshot())
    expect(screen.queryByText('Forecasts')).toBeNull()
  })

  it('a goal past its deadline: all that is left, never $0 a month, and the month the plan reaches it', () => {
    window.history.replaceState(null, '', '/goals?goal=late')
    const late = { id: 'late', name: 'Late', target: 5000, current: 1000, target_date: '2026-06-30', emoji: null, currency: 'USD' }
    const { container } = renderPage(<Goals />, goalsSnapshot({ goals: [late, ...DEMO_GOALS] }))
    const need = [...container.querySelectorAll('.gl-kpi')].find(k => k.textContent?.startsWith('Needed a month'))!
    expect(need).toHaveTextContent('Needed a month$4,000deadline passed: all that is left')
    expect(container.querySelector('.gl-verdict')).toHaveTextContent('The deadline 06/2026 has passed; on the plan the goal is reached 01/2027.')
    expect(pageText(container)).not.toContain('$0 a month')
  })

  it('explains the terms in visible text: coast capital, whole-history growth, real return', () => {
    const { container } = renderPage(<Goals />, fireSnapshot())
    expect(pageText(container)).toContain('Still to save up to the amount that will grow to the goal on its own, with no new contributions')
    expect(screen.getByText('Net worth growth per year · whole history')).toBeInTheDocument()
    expect(pageText(container)).toContain('8% return adjusted for inflation of 3.1% (USD)')
    expect(container.querySelector('.stat [title]')).toBeNull()
  })

  it('shows growth beyond savings next to capital growth, each with how it is calculated', () => {
    const { container } = renderPage(<Goals />, fireSnapshot())
    const card = screen.getByText('Growth beyond savings per year · whole history').closest('.stat')!
    expect(card).toHaveTextContent('+6.2%')
    expect(card).toHaveTextContent('Net worth growth with your own savings taken out · 12 of 14 months')
    const buttons = screen.getAllByRole('button', { name: /How it is calculated/ })
    expect(buttons).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'How it is calculated: Growth beyond savings' }))
    const panel = container.querySelector('.explain__panel')!
    expect(panel).toHaveTextContent('Months used, of 14 closed')
    expect(panel).not.toHaveTextContent('closed months used')
    expect(panel).toHaveTextContent('Left out, no income and expense data: May 2030, Jun 2030')
    expect(panel).toHaveTextContent('Latest month used, Jun 2031')
    expect(pageText(container)).not.toMatch(BROKEN)
  })

  it('says how many months growth beyond savings still needs', () => {
    const g = makeGrowthBeyondSavings()
    const { container } = renderPage(<Goals />, fireSnapshot({ growthBeyondSavings: { ...g, annualRate: null, months: g.months.slice(0, 3) } }))
    const card = screen.getByText('Growth beyond savings per year · whole history').closest('.stat')!
    expect(card.querySelector('.stat__value')).toHaveTextContent('—')
    expect(card).toHaveTextContent('Needs 6 months with balances, income and expenses; 3 so far')
    expect(pageText(container)).not.toMatch(BROKEN)
  })

  it('says the growth beyond savings chain is broken when enough months give no annual rate', () => {
    const g = makeGrowthBeyondSavings()
    const { container } = renderPage(<Goals />, fireSnapshot({ growthBeyondSavings: { ...g, annualRate: null } }))
    const card = screen.getByText('Growth beyond savings per year · whole history').closest('.stat')!
    expect(card.querySelector('.stat__value')).toHaveTextContent('—')
    expect(card).toHaveTextContent('Not defined: in one of the months used net worth lost all it had')
    expect(card).not.toHaveTextContent('so far')
    expect(pageText(container)).not.toMatch(BROKEN)
  })

  it('says growth beyond savings needs income and expenses tracked and has no explanation without it', () => {
    renderPage(<Goals />, fireSnapshot({ growthBeyondSavings: null }))
    const card = screen.getByText('Growth beyond savings per year · whole history').closest('.stat')!
    expect(card.querySelector('.stat__value')).toHaveTextContent('—')
    expect(card).toHaveTextContent('Appears when income and expenses are tracked')
    expect(screen.getAllByRole('button', { name: /How it is calculated/ })).toHaveLength(1)
  })

  it('names the inflation and its currency in the real-return note, or says it is not set', () => {
    const { container, unmount } = renderPage(<Goals />, fireSnapshot({ inflation: { ratePct: 8.7, currency: 'RUB', netWorthNow: null, netWorthYearAgo: null } }))
    expect(pageText(container)).toMatch(/8\.7%.*\(RUB\)/)
    unmount()
    const none = renderPage(<Goals />, fireSnapshot({ inflation: null }))
    expect(pageText(none.container)).toContain('The inflation and its currency are not set')
  })

  it('uses plain words and no jargon', () => {
    const { container } = renderPage(<Goals />, fireSnapshot())
    expect(screen.getByText('Capital that will grow on its own')).toBeInTheDocument()
    expect(pageText(container)).not.toMatch(/CAGR|Coast FIRE|FI Rate|\bpp\b|12M|FIRE/)
  })

  it('writes months as numbers and marks no goal with a chip', () => {
    const { container } = renderPage(<Goals />, fireSnapshot())
    expect(pageText(container)).toContain('reached 05/2028, 5 mo late')
    expect(container.querySelector('.chip, [data-color]')).toBeNull()
  })

  it('says in words whether savings cover the goals, as a warning only when they fall short', () => {
    const { container, unmount } = renderPage(<Goals />, fireSnapshot())
    expect(container.querySelector('.gl-total .gl-late')).toHaveTextContent('$11,798 short')
    unmount()
    const covered = renderPage(<Goals />, goalsSnapshot({ saving: 14000 }))
    expect(covered.container.querySelector('.gl-total .gl-late')).toBeNull()
    expect(covered.container.querySelector('.gl-total .gl-ok')).toHaveTextContent('enough, $61 to spare')
  })
})

describe('the month result', () => {
  const withNet = (net: number) => {
    const base = makeSnapshot()
    const rows = [{ month: '2031-06', bank: 'Lumiora Bank', member: 'Robin', currency: 'USD', active: 1000, passive: 0, expense: 1000 - net, activeBase: 1000, passiveBase: 0, expenseBase: 1000 - net }]
    return makeSnapshot({ cashflow: { ...base.cashflow, rows, closedMonth: { ...base.cashflow.closedMonth!, income: 1000, active: 1000, passive: 0, expense: 1000 - net, net } } })
  }
  const saved = () => document.querySelectorAll('.cf-kpi')[2] as HTMLElement

  it('does not call it overspending when the difference rounds to nothing', () => {
    renderPage(<CashFlow />, withNet(-0.3))
    expect(saved()).toHaveTextContent(/^Saved/)
  })

  it('names what is saved when income covers the expenses', () => {
    renderPage(<CashFlow />, withNet(300))
    expect(saved()).toHaveTextContent(/^Saved\$300/)
  })

  it('calls it overspending, with a plain amount in the error ink, when expenses exceed income', () => {
    renderPage(<CashFlow />, withNet(-300))
    expect(saved().querySelector('.cf-kpi__value')).toHaveTextContent(/^\$300$/)
    expect(saved().querySelector('.cf-kpi__value')).toHaveClass('cf-kpi__value--bad')
    expect(saved()).toHaveTextContent(/^Overspent/)
  })

  it('the Overview cell carries the same amount, signed, under "Left after expenses"', () => {
    const cell = () => screen.getByText('Left after expenses').closest('.kpi') as HTMLElement
    const { unmount } = renderPage(<Overview />, withNet(-300))
    expect(cell().querySelector('.kpi__value')).toHaveTextContent(/^−\$300$/)
    unmount()
    renderPage(<Overview />, withNet(300))
    expect(cell().querySelector('.kpi__value')).toHaveTextContent(/^\$300$/)
  })
})

describe('an empty database', () => {
  it('sends the first balances to Close month, the only place that accepts them', () => {
    const { container } = renderPage(<Assets />, emptySnapshot())
    expect(pageText(container)).toContain('Enter account balances in Close month')
  })

  it.each([
    ['CashFlow', <CashFlow />, 'Enter income and expenses in Close month'],
    ['Goals', <Goals />, 'Set your first goal'],
  ])('%s renders without broken numbers', (_, page, text) => {
    const { container } = renderPage(page, emptySnapshot())
    expect(pageText(container)).not.toMatch(BROKEN)
    expect(screen.getByText(text)).toBeInTheDocument()
  })
})
