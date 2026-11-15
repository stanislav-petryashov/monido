import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useDisplayCurrency } from '../../src/lib/currencyState'
import { snapshotQueryKey } from '../../src/lib/useFinanceData'
import { testClient } from '../helpers/render'
import { jsonResponse } from '../helpers/http'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'
import { Assets } from '../../src/pages/Assets'
import { makeSnapshot as rawSnapshot } from '../helpers/snapshot'
import type { FinanceSnapshot } from '../../src/domain/types'

const makeSnapshot = (over: Partial<FinanceSnapshot> = {}) => {
  const snapshot = rawSnapshot(over)
  return { ...snapshot, capitalCoverage: snapshot.history.map(p => ({ month: p.date.slice(0, 7), assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] })) }
}
import { pageText, renderWithSnapshot as renderPage, stubSnapshotFetch } from '../helpers/render'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

beforeEach(() => { stubSnapshotFetch() })
afterEach(() => { sessionStorage.removeItem('fc.viewCurrency'); window.history.replaceState(null, '', '/') })

function CurrencyProbe() {
  const { setView } = useDisplayCurrency()
  return <button onClick={() => setView('EUR')}>Switch to euro</button>
}

/** The full history sits behind a disclosure at the end of Assets: open it and wait for the lazily loaded panel. */
async function openHistory() {
  fireEvent.click(screen.getByText('History'))
  await screen.findByRole('group', { name: 'History period' })
}
/** The history's own period button, scoped to its group */
const historyPeriod = (name: string) => within(screen.getByRole('group', { name: 'History period' })).getByRole('button', { name })

it('keeps chart intent through uncached currency loading, error and retry, with converted amounts', async () => {
  const saveLocal = vi.fn()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: saveLocal, removeItem: () => {} })
  const base = makeSnapshot()
  const client = testClient()
  client.setQueryData(snapshotQueryKey(null), base)
  let reply!: (r: Response) => void
  const pending = new Promise<Response>(resolve => { reply = resolve })
  vi.stubGlobal('fetch', vi.fn((url: string) => String(url).includes('currency=EUR') ? pending : new Promise<Response>(() => {})))
  renderPage(<><CurrencyProbe /><Assets /></>, undefined, { client })
  await openHistory()
  fireEvent.click(historyPeriod('All'))
  fireEvent.click(within(screen.getByRole('group', { name: 'Chart series' })).getByRole('button', { name: 'Assets' }))
  fireEvent.click(screen.getByRole('button', { name: 'Change, %' }))
  fireEvent.keyDown(screen.getByRole('group', { name: 'Net worth history' }), { key: 'ArrowLeft' })
  fireEvent.click(screen.getByRole('button', { name: 'Switch to euro' }))
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Net worth history' })).toBeNull())
  await act(async () => { reply(jsonResponse({ error: 'Unavailable' }, 500)) })
  await waitFor(() => expect(client.getQueryState(snapshotQueryKey('EUR'))?.status).toBe('error'))
  expect(screen.queryByRole('group', { name: 'Net worth history' })).toBeNull()
  const converted = makeSnapshot({ baseCurrency: 'EUR', history: base.history.map(p => ({ ...p, assets: p.assets * 2, liabilities: p.liabilities * 2, netWorth: p.netWorth * 2 })) })
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(converted)))
  await act(async () => { await client.refetchQueries({ queryKey: snapshotQueryKey('EUR'), exact: true }) })
  await screen.findByRole('group', { name: 'Net worth history' })
  expect(historyPeriod('All')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Change, %' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(screen.getByRole('group', { name: 'Chart series' })).getByRole('button', { name: 'Assets' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('group', { name: 'Selected month' })).toHaveTextContent('May 2031')
  fireEvent.keyDown(screen.getByRole('group', { name: 'Net worth history' }), { key: 'ArrowRight' })
  expect(screen.getByRole('group', { name: 'Selected month' })).toHaveTextContent('€273,346')
  expect(saveLocal).not.toHaveBeenCalledWith('fc.period', expect.anything())
})


it('prints a dash, not NaN, when history is too short for growth', async () => {
  const { container } = renderPage(<Assets />, makeSnapshot({ history: [] }))
  fireEvent.click(screen.getByText('History'))
  expect(await screen.findByText('No closed monthly balances yet.')).toBeInTheDocument()
  expect(pageText(container)).not.toMatch(/NaN|Infinity|undefined/)
  expect(screen.queryByText('Net worth doubling time')).toBeNull()
})

it('words the doubling time in years', async () => {
  const { container } = renderPage(<Assets />, makeSnapshot())
  await openHistory()
  fireEvent.click(historyPeriod('All'))
  expect(pageText(container)).toMatch(/Net worth doubling time[\d.]+ years?/)
})

it('keeps period navigation available when older history exists outside the selected window', async () => {
  const base = makeSnapshot()
  const last = base.history.at(-1)!
  renderPage(<Assets />, makeSnapshot({ history: [{ ...last, date: '2020-01-31' }, last] }))
  await openHistory()
  expect(screen.getByRole('group', { name: 'History period' })).toBeInTheDocument()
  fireEvent.click(historyPeriod('All'))
  expect(historyPeriod('All')).toHaveAttribute('aria-pressed', 'true')
})

it.each([100000, 200000])('explains why capital ending at %s with nonpositive growth has no finite doubling time', async netWorth => {
  const base = makeSnapshot()
  const last = base.history.at(-1)!
  renderPage(<Assets />, makeSnapshot({ history: [{ ...last, date: '2031-01-31', netWorth: 200000 }, { ...last, date: '2031-06-30', netWorth }] }))
  await openHistory()
  expect(screen.getByText('At zero or negative growth, net worth has no finite doubling time.')).toBeInTheDocument()
})

it('a link to /assets#history opens the history and lands on it', async () => {
  window.history.replaceState(null, '', '/assets#history')
  renderPage(<Assets />, makeSnapshot())
  const details = screen.getByText('History').closest('details')!
  expect(details).toHaveAttribute('open')
  await waitFor(() => expect(details).toHaveFocus())
  expect(await screen.findByRole('group', { name: 'History period' })).toBeInTheDocument()
})

it('keeps the full history closed, and its chart unloaded, until it is asked for', () => {
  renderPage(<Assets />, makeSnapshot())
  expect(screen.getByText('History').closest('details')).not.toHaveAttribute('open')
  expect(screen.queryByRole('group', { name: 'History period' })).toBeNull()
})

it('an error boundary can answer with a small note instead of the stack', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const Broken = () => { throw new Error('chunk gone') }
  renderPage(<ErrorBoundary fallback={<p>Could not load</p>}><Broken /></ErrorBoundary>, makeSnapshot())
  expect(screen.getByText('Could not load')).toBeInTheDocument()
  expect(document.querySelector('.error-boundary')).toBeNull()
  spy.mockRestore()
})
