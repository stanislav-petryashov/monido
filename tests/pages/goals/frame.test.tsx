// The Goals page's frame: the finding, the list with its head, the chosen goal's KPIs and verdict, independence, tracking
// off, no goals, viewers, privacy and the phone's two screens. The demo family on 12.11.2026 (tests/helpers/goals.ts).
import { act, fireEvent, screen, within } from '@testing-library/react'
import { Goals } from '../../../src/pages/Goals'
import { GoalsFinding } from '../../../src/pages/goals/TitleParts'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { ru, withLanguage } from '../../helpers/i18n'
import { goalsSnapshot, GOALS_TODAY } from '../../helpers/goals'
import { pageText, renderWithSnapshot, stubPrivacyOn, stubSnapshotFetch } from '../../helpers/render'

vi.mock('../../../src/components/charts/echarts', () => import('../../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../../helpers/echartsStub'))

beforeEach(() => {
  stubSnapshotFetch()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(GOALS_TODAY)
  window.history.replaceState(null, '', '/goals')
})
afterEach(() => {
  vi.useRealTimers()
  act(() => resetAuth())
  window.history.replaceState(null, '', '/')
})

const head = () => document.querySelector<HTMLElement>('.gl-head')!
const list = () => document.querySelector<HTMLElement>('.gl-list')!
const kpis = () => [...head().querySelectorAll('.gl-kpi')].map(k => k.textContent)

describe('the finding and the list', () => {
  it('says what is saved against what the goals need, and how many make their deadlines', () => {
    renderWithSnapshot(<GoalsFinding />, goalsSnapshot())
    expect(document.body).toHaveTextContent('You save $2,141 a month (the average of July–September 2026); the goals need $13,939 to make their deadlines. 1 of 3 on time.')
  })

  it('in Russian, as the mock-up', async () => {
    const plain = (text: string) => text.replace(/\s/g, ' ')
    await withLanguage('ru-RU', () => {
      renderWithSnapshot(<GoalsFinding />, goalsSnapshot())
      expect(plain(document.body.textContent ?? '')).toContain(plain(ru('goalsPage.finding', {
        saving: '2 141 $', months: `${ru('dates.month.7')}–${ru('dates.month.9')} 2026`, need: '13 939 $', onTime: 1, count: 3,
      })))
    })
  })

  it('heads the list with the saving against the need, the shortfall as an assessment, and the rows in the plan\'s order', () => {
    const { container } = renderWithSnapshot(<Goals />, goalsSnapshot())
    const list = container.querySelector<HTMLElement>('.gl-list')!
    expect(list).toHaveTextContent('You save a month$2,141the average of July–September 2026')
    expect(within(list).getByText('$11,798 short')).toHaveClass('gl-late')
    expect([...list.querySelectorAll('.gl-row__name')].map(n => n.textContent)).toEqual(['Trip to Japan', 'Emergency fund (6 months)', 'Financial independence by 55'])
    expect([...list.querySelectorAll('.gl-row__st')].map(n => n.textContent)).toEqual([
      'on time for 05/2027', 'reached 05/2028, 5 mo late', 'forecast 05/2046, 5 years 5 mo late',
    ])
  })

  it('"what if we saved X a month" re-runs every goal on the page and goes back to the family\'s saving; nothing is sent', () => {
    const fetchMock = vi.mocked(fetch)
    const before = fetchMock.mock.calls.length
    renderWithSnapshot(<Goals />, goalsSnapshot())
    const field = within(list()).getByLabelText('What if we saved a month')
    fireEvent.change(field, { target: { value: '20000' } })
    expect(list()).toHaveTextContent('If we saved a month$20,000a what-if; you save the average of July–September 2026')
    // with 20,000 a month the emergency fund makes its deadline too
    expect([...list().querySelectorAll('.gl-row__st')].map(n => n.textContent)[1]).toBe('on time for 12/2027')
    fireEvent.click(within(list()).getByRole('button', { name: 'Back to $2,141, what you save' }))
    expect(list()).toHaveTextContent('You save a month$2,141')
    expect([...list().querySelectorAll('.gl-row__st')].map(n => n.textContent)[1]).toBe('reached 05/2028, 5 mo late')
    expect(fetchMock.mock.calls.slice(before).filter(([, init]) => init?.method && init.method !== 'GET')).toEqual([])
  })

  it('opens on the first goal off track: the emergency fund', () => {
    renderWithSnapshot(<Goals />, goalsSnapshot())
    expect(within(list()).getByRole('button', { name: /^Emergency fund/ })).toHaveAttribute('aria-current', 'true')
    expect(head()).toHaveTextContent('Emergency fund (6 months)')
  })
})

describe('the chosen goal', () => {
  it('the KPIs, the verdict with the way out, and the source line', () => {
    renderWithSnapshot(<Goals />, goalsSnapshot())
    expect(kpis()).toEqual([
      'Saved$32,000of $63,000 · entered by hand',
      'Needed a month$2,385$31,000 left over 1 year 1 mo',
      'Gets now$1,207from 06/2027: $2,141',
      'Reached05/20285 mo after the deadline',
    ])
    expect(head().querySelector('.gl-verdict')).toHaveTextContent('On the plan it holds $54,230 by 12/2027, $8,770 short. To make it, save $2,816 a month, $675 more, or move the deadline to 05/2028.')
    expect(head()).toHaveTextContent('Savings are the average of the closed months: July–September 2026.')
  })

  it('a year of history: the source line names the year and the last three months’ average', () => {
    const s = goalsSnapshot()
    const earlier = ['2025-10', '2025-11', '2025-12'].map(month => ({ ...s.cashflow.rows[0], month }))
    renderWithSnapshot(<Goals />, { ...s, cashflow: { ...s.cashflow, rows: [...earlier, ...s.cashflow.rows], avg3m: { ...s.cashflow.avg3m, netPerMonth: 2140.76 } } })
    expect(head()).toHaveTextContent('Savings are the average of the closed months: October 2025 – September 2026; over the last three of them, $2,141 a month.')
  })

  it('a goal on time first in the queue says it gets all it needs', () => {
    window.history.replaceState(null, '', '/goals?goal=vacation')
    renderWithSnapshot(<Goals />, goalsSnapshot())
    expect(head().querySelector('.gl-verdict')).toHaveTextContent('It gets all it needs: $933 a month until 05/2027. It is first in the queue: its deadline is the nearest.')
  })

  it('independence: the forecast at 8% with the plan\'s month, and the growth it needs', () => {
    window.history.replaceState(null, '', '/goals?goal=fire')
    renderWithSnapshot(<Goals />, goalsSnapshot())
    expect(kpis()).toEqual([
      'Saved$205,000of $2,000,000 · 10.3%',
      'Gets now$0from 05/2028: $1,934, then $2,141',
      'Forecast at 8%05/20465 years 5 mo after the deadline',
      'Growth needed+17.6%a year to make 12/2040 · +12.8% over the whole history',
    ])
    expect(head().querySelector('.gl-verdict')).toHaveTextContent('Until 05/2028 the goals with nearer deadlines take the savings. Then the savings and 8% a year give $1,190,083 by the deadline, 59.5% of the goal.')
    expect(head().textContent).not.toMatch(/2045|2098/)
  })

  it('runs the plan on the snapshot\'s day, not the browser\'s: a new month on the clock moves nothing', () => {
    vi.setSystemTime(new Date('2026-12-02T09:00:00Z'))
    renderWithSnapshot(<Goals />, goalsSnapshot())
    expect(head().querySelector('.gl-verdict')).toHaveTextContent('save $2,816 a month, $675 more')
    expect(kpis()[2]).toBe('Gets now$1,207from 06/2027: $2,141')
  })

  it('a row selects its goal', () => {
    renderWithSnapshot(<Goals />, goalsSnapshot())
    fireEvent.click(within(list()).getByRole('button', { name: /^Trip to Japan/ }))
    expect(window.location.search).toBe('?goal=vacation')
    expect(head()).toHaveTextContent('Trip to Japan')
  })
})

describe('tracking off, no goals, viewers, privacy', () => {
  it('tracking off: the need, "no data", dashes and the notice; never a 0', () => {
    const { container } = renderWithSnapshot(<Goals />, goalsSnapshot({ track: false }))
    expect(container.querySelector('.gl-list')).toHaveTextContent('Needed a month$13,939to make the deadlines · how much you save: no data')
    expect([...container.querySelectorAll('.gl-row__st')].every(n => n.textContent === 'on time or not: no data')).toBe(true)
    // no goal is off track while it is unknown: the first one opens
    expect(kpis()).toEqual([
      'Saved$3,400of $9,000 · entered by hand',
      'Needed a month$933$5,600 left over 6 mo',
      'Gets now—savings unknown',
      'Reached—needs income and expenses',
    ])
    expect(head()).toHaveTextContent('Income and expenses are not tracked')
    expect(screen.getByRole('link', { name: 'Settings → General' })).toHaveAttribute('href', '/settings/general')
    expect(head().querySelector('.gl-verdict')).toBeNull()
    expect(pageText(container)).not.toMatch(/\$0(?!\d)/)
  })

  it('tracked but no month with income and expenses closed yet: says so, not that tracking is off', () => {
    const snapshot = { ...goalsSnapshot({ track: false }), trackFlows: true }
    renderWithSnapshot(<Goals />, snapshot)
    expect(head()).toHaveTextContent('No month with income and expenses is closed yet')
    expect(head()).not.toHaveTextContent('not tracked')
    expect(screen.queryByRole('link', { name: 'Settings → General' })).toBeNull()
  })

  it('no goals: what a goal is, and «+ Goal»', () => {
    renderWithSnapshot(<Goals />, goalsSnapshot({ goals: [] }))
    expect(screen.getByRole('heading', { name: 'Set your first goal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Goal' })).toBeInTheDocument()
  })

  it('viewers see no primary, no menu and no way to move the deadline', () => {
    setAuth({ mode: 'telegram', authenticated: true, me: { name: 'Reader', rights: { edit: false, vote: false, manage: false } } })
    renderWithSnapshot(<Goals />, goalsSnapshot(), { notify: true })
    expect(screen.queryByRole('button', { name: 'Update saved' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Goal actions' })).toBeNull()
    expect(head().querySelector('.gl-verdict button')).toBeNull()
    expect(head().querySelector('.gl-verdict')).toHaveTextContent('move the deadline to 05/2028')
  })

  it('an editor gets «Update saved» and the menu', () => {
    setAuth({ mode: 'password', authenticated: true, me: null })
    renderWithSnapshot(<Goals />, goalsSnapshot(), { notify: true })
    expect(screen.getByRole('button', { name: 'Update saved' })).toHaveClass('btn--primary')
    expect(screen.getByRole('button', { name: 'Goal actions' })).toBeInTheDocument()
  })

  it('privacy masks every amount; percentages and months stay', () => {
    stubPrivacyOn()
    const { container } = renderWithSnapshot(<Goals />, goalsSnapshot())
    expect(pageText(container)).not.toMatch(/\$\d/)
    expect(pageText(container)).toContain('•••')
    expect(pageText(container)).toContain('05/2028')
    expect(pageText(container)).toContain('50.8%')
  })
})

describe('the phone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: /max-width: (900|640)px/.test(query), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  })

  it('shows the list first, then the goal on its own screen with «← Goals»', () => {
    const { container } = renderWithSnapshot(<Goals />, goalsSnapshot())
    expect(container.querySelector('.gl-list')).not.toBeNull()
    expect(container.querySelector('.gl-head')).toBeNull()
    fireEvent.click(within(list()).getByRole('button', { name: /^Emergency fund/ }))
    expect(container.querySelector('.gl-list')).toBeNull()
    expect(head()).toHaveTextContent('Emergency fund (6 months)')
    fireEvent.click(screen.getByRole('button', { name: 'Goals' }))
    expect(container.querySelector('.gl-list')).not.toBeNull()
  })
})
