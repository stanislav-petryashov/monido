import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { FlowsScreen } from '../../../src/modules/cashflow/FlowsScreen'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { snapshotQueryKey } from '../../../src/lib/useFinanceData'
import { demoFamilyData, DEMO_TODAY } from '../../helpers/demoFamily'
import { jsonResponse } from '../../helpers/http'
import { spendingQuery } from '../../../src/modules/cashflow/spendingWrites'
import { renderAdmin, testClient } from '../../helpers/render'

// the demo family on 12.11.2026: September is the last closed month, October is open; September's accounts leave
// 1 144,15 $ of expenses and 280 $ of income without a category
const { snapshot, spending } = await demoFamilyData()
const HARBORLINE = 'Break down: Harborline Checking · Ryan, September 2026'

interface Call { url: string; method: string; body?: unknown }

/** The screen's reads answered from the demo; a write records its call and answers `onWrite` (the same state by default) */
function stub(onWrite: (call: Call) => Response | null = () => null, read: () => typeof spending = () => spending, data = snapshot) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === '/api/admin/currencies') return jsonResponse({ rows: [{ rowid: 1, code: 'EUR' }, { rowid: 2, code: 'USD' }], columns: ['code'] })
    if (url === '/api/settings') return jsonResponse({ language: 'en-US', currency: 'USD' })
    if (url === '/api/month-close') return jsonResponse({ month: '2026-10', queue: ['2026-10'], incomplete: [], lastClosed: { month: '2026-09', reopenable: true } })
    if (url === '/api/spending' && method === 'GET') return jsonResponse(read())
    if (url === '/api/snapshot') return jsonResponse(data)
    if (url.startsWith('/api/spending')) {
      const call = { url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined }
      calls.push(call)
      return onWrite(call) ?? jsonResponse(spending)
    }
    return jsonResponse({})
  }))
  return calls
}

function render(data = snapshot) {
  const client = testClient()
  client.setQueryData(snapshotQueryKey(null), data)
  return { ...renderAdmin(<FlowsScreen />, { client }), client }
}
const table = () => screen.findByRole('table', { name: 'Breakdown by month' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(DEMO_TODAY)
  window.history.replaceState({}, '', '/cashflow/categories')
})
afterEach(() => { vi.useRealTimers(); resetAuth(); window.history.replaceState({}, '', '/') })

describe('the categories screen on the demo family', () => {
  it('opens on September 2026, the last closed month with something to split, not on the open October', async () => {
    stub()
    render()
    expect(within(await table()).getByText('September 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^September 2026:/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^October 2026:/ })).toHaveTextContent('Not closed')
    // the cells say how much of each closed month's expenses is split, as progress; no status fills
    expect(screen.getByRole('button', { name: /^September 2026:/ })).toHaveTextContent('89.1% of expenses')
    expect(screen.getByRole('button', { name: /^March 2026:/ })).toHaveTextContent('83.9% of expenses')
    expect(screen.getByText('89.1% of expenses split · 98% of income · not split $1,144 · $280')).toBeInTheDocument()
  })

  it('a month with income categories and no expense lines says income only', async () => {
    const noMarch = { ...snapshot, spending: { ...snapshot.spending, months: snapshot.spending.months.filter(m => m.month !== '2026-03') } }
    stub(undefined, undefined, noMarch)
    render(noMarch)
    await table()
    expect(screen.getByRole('button', { name: /^March 2026:/ })).toHaveTextContent('income only')
  })

  it('opens on ?month= when given', async () => {
    window.history.replaceState({}, '', '/cashflow/categories?month=2026-07')
    stub()
    render()
    expect(within(await table()).getByText('July 2026')).toBeInTheDocument()
  })

  it('accounts with their split progress; no idle account on the demo; loan payments split by themselves', async () => {
    stub()
    render()
    const rows = within(await table()).getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[0]!.textContent)
    expect(rows).toEqual([
      'ABluefinch High-Yield Savings Annika · USD', 'RHarborline Checking Ryan · USD', 'RKestrel Brokerage Ryan · USD', 'ARheinau Bank Annika · EUR',
      'Loan payments Car loan, Maple Street mortgage', 'Brisaluna card — AnnikaOther source', 'Harborline card — RyanOther source',
    ])
    const harborline = within(await table()).getByText('Harborline Checking').closest('tr')!
    expect(harborline).toHaveTextContent('$3,230.00 of $3,530.00$300.00 left')
    // every demo account moves every month (the line itself is covered by FlowsScreen.test.tsx)
    expect(screen.queryByText(/^No movement in September/)).toBeNull()
    expect(within(await table()).getByText('Loan payments').closest('tr')).toHaveTextContent('$3,065split by themselves')
  })

  it('the editor opens in place; the remainder follows the typing; Save sends the lines with their base', async () => {
    const calls = stub()
    render()
    fireEvent.click(await screen.findByRole('button', { name: HARBORLINE }))
    const editor = await screen.findByRole('form', { name: HARBORLINE })
    const expenses = within(editor).getByRole('group', { name: 'Expenses' })
    expect(expenses).toHaveTextContent('Of 3,530.00: 3,230.00 allocated · 300.00 unallocated')
    fireEvent.click(within(editor).getByRole('button', { name: 'Add expense line' }))
    const lines = within(expenses).getAllByRole('group', { name: /^Expense line/ })
    const last = lines[lines.length - 1]!
    fireEvent.change(within(last).getByRole('combobox'), { target: { value: String(spending.categories.find(c => c.name === 'Other')!.id) } })
    fireEvent.change(within(last).getByLabelText(/^Amount/), { target: { value: '300' } })
    expect(expenses).toHaveTextContent('fully allocated')
    fireEvent.submit(editor)
    await waitFor(() => expect(calls).toHaveLength(1))
    const sent = calls[0]!.body as { bank: string; items: { categoryId: number; amount: number }[]; base: unknown }
    expect(calls[0]!.url).toBe('/api/spending/months/2026-09/account')
    expect(sent.bank).toBe('Harborline Checking')
    expect(sent.items.reduce((n, i) => n + (spending.categories.find(c => c.id === i.categoryId)!.flow === 'expense' ? i.amount : 0), 0)).toBe(3530)
    expect(sent.base).toEqual(spending.accounts.find(a => a.month === '2026-09' && a.bank === 'Harborline Checking')!.items)
  })

  it('a 409 row_changed keeps the editor with what was typed and says so', async () => {
    stub(() => jsonResponse({ error: { code: 'row_changed' } }, 409))
    render()
    fireEvent.click(await screen.findByRole('button', { name: HARBORLINE }))
    const editor = await screen.findByRole('form', { name: HARBORLINE })
    fireEvent.change(within(editor).getByLabelText('Amount: Expense line 1'), { target: { value: '800' } })
    fireEvent.submit(editor)
    expect(await screen.findByText(/Row changed after this edit/)).toBeInTheDocument()
    expect(screen.getByRole('form', { name: HARBORLINE })).toBeInTheDocument()
    expect(within(editor).getByLabelText('Amount: Expense line 1')).toHaveValue('800')
  })

  it('the base is the lines as the editor opened: another device’s lines read meanwhile do not move it, the save is refused', async () => {
    const opened = spending.accounts.find(a => a.month === '2026-09' && a.bank === 'Harborline Checking')!.items
    // another device saved Harborline's lines after the editor opened; the screen reads them on its next refetch
    const theirs = { ...spending, accounts: spending.accounts.map(a => (a.month === '2026-09' && a.bank === 'Harborline Checking' ? { ...a, items: a.items.slice(1) } : a)) }
    let current = spending
    const calls = stub(call => (JSON.stringify((call.body as { base: unknown }).base) === JSON.stringify(current.accounts.find(a => a.month === '2026-09' && a.bank === 'Harborline Checking')!.items)
      ? null : jsonResponse({ error: { code: 'row_changed' } }, 409)), () => current)
    const { container, client } = render()
    fireEvent.click(await screen.findByRole('button', { name: HARBORLINE }))
    const editor = await screen.findByRole('form', { name: HARBORLINE })
    current = theirs
    await client.refetchQueries({ queryKey: spendingQuery.queryKey })
    expect(client.getQueryData<typeof spending>(spendingQuery.queryKey)!.accounts.find(a => a.month === '2026-09' && a.bank === 'Harborline Checking')!.items).toHaveLength(opened.length - 1)
    fireEvent.change(within(editor).getByLabelText('Amount: Expense line 1'), { target: { value: '800' } })
    fireEvent.submit(editor)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect((calls[0]!.body as { base: unknown }).base).toEqual(opened)
    expect(await screen.findByText(/Row changed after this edit/)).toBeInTheDocument()
    expect(within(container).getByRole('form', { name: HARBORLINE })).toBeInTheDocument()
  })

  it('Escape asks before discarding what was typed', async () => {
    const calls = stub()
    render()
    fireEvent.click(await screen.findByRole('button', { name: HARBORLINE }))
    const editor = await screen.findByRole('form', { name: HARBORLINE })
    fireEvent.change(within(editor).getByLabelText('Amount: Expense line 1'), { target: { value: '800' } })
    fireEvent.keyDown(within(editor).getByLabelText('Amount: Expense line 1'), { key: 'Escape' })
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.queryByRole('form', { name: HARBORLINE })).toBeNull())
    expect(calls).toEqual([])
  })

  it('a viewer sees the split, no "Break down" and no editor', async () => {
    stub()
    setAuth({ me: { name: 'Ryan', rights: { edit: false, vote: true, manage: false } } } as never)
    render()
    expect(within(await table()).getByText('Harborline Checking')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Break down:/ })).toBeNull()
    expect(screen.queryByRole('form')).toBeNull()
  })
})
