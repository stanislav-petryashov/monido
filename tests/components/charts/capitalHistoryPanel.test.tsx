import { fireEvent, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { CapitalHistoryPanel } from '../../../src/components/charts/CapitalHistoryPanel'
import { initialCapitalHistoryState, type CapitalHistoryState, type RealLine } from '../../../src/lib/capitalHistory'
import { PrivacyContext } from '../../../src/lib/privacy'
import type { HistoryPoint } from '../../../src/domain/types'
import { renderWithSnapshot, stubSnapshotFetch } from '../../helpers/render'

vi.mock('../../../src/components/charts/echarts', () => import('../../helpers/echartsStub'))
interface Captured { option: { series: { id: string; lineStyle: { color: string }; data: { value: number | null; symbolSize: number }[] }[] } }
let captured: Captured
vi.mock('echarts-for-react/esm/core', () => ({ default: (props: Captured) => { captured = props; return null } }))
const history: HistoryPoint[] = [
  { date: '2031-01-31', assets: 100, liabilities: 20, netWorth: 80 },
  { date: '2031-03-31', assets: 150, liabilities: 10, netWorth: 140 },
  { date: '2031-04-30', assets: 160, liabilities: 0, netWorth: 160 },
]
function Example({ data = history, initialState = initialCapitalHistoryState(), real }: { data?: HistoryPoint[]; initialState?: CapitalHistoryState; real?: RealLine }) {
  const [state, onChange] = useState(initialState)
  const [hidden, setHidden] = useState(false)
  return <PrivacyContext.Provider value={{ hidden, toggle: () => setHidden(v => !v) }}><button onClick={() => setHidden(v => !v)}>Privacy</button><CapitalHistoryPanel history={data} state={state} onChange={onChange} real={real} /></PrivacyContext.Provider>
}
beforeEach(stubSnapshotFetch)

it('keeps top presets and percentage bases without duplicate month controls', () => {
  // three months before May is February, a month with no balances
  renderWithSnapshot(<Example data={[...history, { date: '2031-05-31', assets: 160, liabilities: 0, netWorth: 160 }]} />)
  expect(screen.queryByLabelText('From month')).toBeNull()
  expect(screen.queryByRole('slider')).toBeNull()
  expect(screen.getByRole('group', { name: 'Selected month' })).toHaveClass('sr-only')
  fireEvent.click(screen.getByRole('button', { name: '3 months' }))
  expect(screen.getByRole('button', { name: '3 months' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Change, %' }))
  expect(screen.getAllByText(/No value in the base month/).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: 'All' }))
  expect(screen.getByRole('button', { name: '3 months' })).toHaveAttribute('aria-pressed', 'false')
  const details = screen.getByRole('group', { name: 'Selected month' })
  expect(within(details).getByText('+100%')).toBeInTheDocument()
})

it('selects missing months with the keyboard without duplicate range controls', () => {
  renderWithSnapshot(<Example />)
  const graph = screen.getByRole('group', { name: 'Net worth history' })
  fireEvent.keyDown(graph, { key: 'ArrowLeft' })
  expect(screen.getByRole('group', { name: 'Selected month' })).toHaveTextContent('March 2031')
  fireEvent.keyDown(graph, { key: 'ArrowLeft' })
  expect(screen.getByRole('group', { name: 'Selected month' })).toHaveTextContent('No data for this month')
  expect(screen.queryByLabelText('Range start')).toBeNull()
  expect(screen.queryByLabelText('Range end')).toBeNull()
})

it('retains at least one selected series and offers recovery when its percent is unavailable', () => {
  renderWithSnapshot(<Example data={[history[2]]} />)
  const legend = screen.getByRole('group', { name: 'Chart series' })
  fireEvent.click(within(legend).getByRole('button', { name: 'Net worth' }))
  fireEvent.click(within(legend).getByRole('button', { name: 'Assets' }))
  expect(within(legend).getByRole('button', { name: 'Loans' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Change, %' }))
  expect(screen.getByRole('button', { name: 'Show amounts' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show amounts' }))
  expect(screen.getByRole('group', { name: 'Selected month' })).toHaveTextContent('$0')
})

it('masks already selected money immediately while preserving relative percentages', () => {
  const { container } = renderWithSnapshot(<Example />)
  fireEvent.click(screen.getByRole('button', { name: 'Change, %' }))
  expect(screen.getByRole('group', { name: 'Selected month' })).toHaveTextContent('$160')
  fireEvent.click(screen.getByRole('button', { name: 'Privacy' }))
  expect(container.textContent).not.toContain('$160')
  expect(screen.getByRole('group', { name: 'Selected month' })).toHaveTextContent('•••')
  expect(screen.getByRole('group', { name: 'Selected month' })).toHaveTextContent('+100%')
})

it.each([{ data: [] }, { data: [history[0]] }])('does not invent a large navigator for $data', ({ data }) => {
  renderWithSnapshot(<Example data={data} />)
  expect(screen.queryByLabelText('Range start')).toBeNull()
  expect(screen.queryByLabelText('Range end')).toBeNull()
  if (!data.length) expect(screen.getByText('No closed monthly balances yet.')).toBeInTheDocument()
})

it('explains invalid observations rather than silently printing a dash', () => {
  renderWithSnapshot(<Example data={[history[0], { ...history[2], netWorth: NaN }]} />)
  expect(screen.getByRole('group', { name: 'Selected month' })).toHaveTextContent('Value unavailable')
})

it('clears keyboard announcements across control changes, even when returning to the old mode', () => {
  const { container } = renderWithSnapshot(<Example />)
  fireEvent.keyDown(screen.getByRole('group', { name: 'Net worth history' }), { key: 'ArrowLeft' })
  expect(container.querySelector('[aria-live]')).toHaveTextContent('March 2031')
  fireEvent.click(screen.getByRole('button', { name: 'Change, %' }))
  fireEvent.click(screen.getByRole('button', { name: 'Amounts' }))
  expect(container.querySelector('[aria-live]')).toBeEmptyDOMElement()
  expect(container.querySelector('.capital-chart__tooltip')).toBeNull()
})

it.each([{ end: 1000.4, expected: '<0.1%' }, { end: 999.6, expected: '>−0.1%' }, { end: 1000, expected: '0%' }])('preserves small changes and CAGR without inventing zero: $end', ({ end, expected }) => {
  const { container } = renderWithSnapshot(<Example data={[
    { date: '2031-01-31', assets: 1000, liabilities: 0, netWorth: 1000 },
    { date: '2032-01-31', assets: end, liabilities: 0, netWorth: end },
  ]} />)
  fireEvent.click(screen.getByRole('button', { name: 'All' }))
  expect(container.querySelector('.capital-history__growth')).toHaveTextContent(expected)
  fireEvent.click(screen.getByRole('button', { name: 'Change, %' }))
  expect(screen.getByRole('group', { name: 'Selected month' })).toHaveTextContent(expected)
})

it('draws the past of net worth in --bar, its last segment and end dot in --chart-1, and markers only at the end', () => {
  document.documentElement.style.setProperty('--chart-1', '#5B4BE0')
  document.documentElement.style.setProperty('--bar', 'rgb(27 26 36 / .22)')
  try {
    renderWithSnapshot(<Example />)
    const series = captured.option.series
    const past = series.find(s => s.id === 'capital')!, now = series.find(s => s.id === 'capital-now')!
    expect(past.lineStyle.color).toBe('rgba(27, 26, 36, 0.22)')
    expect(now.lineStyle.color).toBe('#5B4BE0')
    expect(past.data.map(p => p.value)).toContain(80)
    expect(now.data.filter(p => p.value !== null).map(p => p.value)).toEqual([140, 160])
    expect(now.data.at(-1)!.symbolSize).toBeGreaterThan(0)
    expect(now.data.slice(0, -1).every(p => p.symbolSize === 0)).toBe(true)
    expect(past.data.every(p => p.symbolSize === 0)).toBe(true)
  } finally {
    document.documentElement.style.removeProperty('--chart-1')
    document.documentElement.style.removeProperty('--bar')
  }
})

it('offers net worth in today\'s money as a fourth series, off at first, dashed and muted, with its one rate said', () => {
  renderWithSnapshot(<Example real={{ ratePct: 4 }} />)
  const button = screen.getByRole('button', { name: 'In today’s money' })
  expect(button).toHaveAttribute('aria-pressed', 'false')
  expect(screen.queryByText(/one inflation rate of 4% a year/)).toBeNull()
  fireEvent.click(button)
  expect(button).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText(/one inflation rate of 4% a year/)).toBeInTheDocument()
  const line = captured.option.series.find(s => s.id === 'capitalReal') as unknown as { lineStyle: { type: string } }
  expect(line.lineStyle.type).toBe('dashed')
})

it('says why there is no line in today\'s money: no inflation, or the dashboard in another currency', () => {
  const { unmount } = renderWithSnapshot(<Example real={{ unavailable: 'no-inflation' }} />)
  expect(screen.getByRole('button', { name: 'In today’s money' })).toBeDisabled()
  expect(screen.getByText(/Set the yearly inflation in Settings → Parameters/)).toBeInTheDocument()
  unmount()
  renderWithSnapshot(<Example real={{ unavailable: 'other-currency', currency: 'RUB' }} />)
  expect(screen.getByText('Shown when the dashboard is in RUB, the inflation’s currency.')).toBeInTheDocument()
})
