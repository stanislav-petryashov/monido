import { ManualAmountBlock } from '../../../src/modules/cashflow/ManualAmount'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { FlowsScreen } from '../../../src/modules/cashflow/FlowsScreen'
import { fmtMonth } from '../../../src/lib/formatters'
import { monthCoverage } from '../../../src/modules/cashflow/monthCoverage'
import type { MonthCloseState, SpendingRecords } from '../../../src/domain/api'
import { PrivacyContext } from '../../../src/lib/privacy'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { deferred, jsonResponse, sent, stubApi } from '../../helpers/http'
import { ru } from '../../helpers/i18n'
import { renderAdmin, expandDisclosures } from '../../helpers/render'

interface Call { url: string; method: string; body?: unknown }

const loanPayments = { id: 1, name: 'loan_payments', kind: 'loan_payment' as const, flow: 'expense' as const, oneOff: false }
const food = { id: 2, name: 'Groceries', kind: 'mandatory' as const, flow: 'expense' as const, oneOff: false }
const fun = { id: 3, name: 'Cinema', kind: 'optional' as const, flow: 'expense' as const, oneOff: false }

const salary = { id: 10, name: 'Salary', kind: 'optional' as const, flow: 'active' as const, oneOff: false }
const bonus = { id: 11, name: 'Bonus', kind: 'optional' as const, flow: 'active' as const, oneOff: true }
const dividends = { id: 12, name: 'Dividends', kind: 'optional' as const, flow: 'passive' as const, oneOff: false }

const base: SpendingRecords = {
  categories: [loanPayments, food, fun, salary, bonus, dividends],
  accounts: [
    // September is being closed (a draft row), August is closed; Old Bank was deleted from August
    {
      month: '2031-09', bank: 'Quillmark Bank', member: 'Robin', currency: 'USD', totals: { active: 6500, passive: 390, expense: 5280 },
      items: [{ categoryId: 10, amount: 6000 }, { categoryId: 2, amount: 2100 }], allocated: { active: 6000, passive: 0, expense: 2100 }, orphaned: false,
    },
    { month: '2031-09', bank: 'Wallet', member: '', currency: 'EUR', totals: { active: 0, passive: 0, expense: 300 }, items: [], allocated: { active: 0, passive: 0, expense: 0 }, orphaned: false },
    {
      month: '2031-08', bank: 'Quillmark Bank', member: 'Robin', currency: 'USD', totals: { active: 6500, passive: null, expense: 5000 },
      items: [{ categoryId: 10, amount: 6500 }], allocated: { active: 6500, passive: 0, expense: 0 }, orphaned: false,
    },
    { month: '2031-08', bank: 'Old Bank', member: '', currency: null, totals: null, items: [{ categoryId: 2, amount: 5 }], allocated: { active: 0, passive: 0, expense: 5 }, orphaned: true },
  ],
  sources: [
    {
      month: '2031-09', source: 'Brisaluna Card', totals: [{ currency: 'EUR', amount: 1200.5 }, { currency: 'USD', amount: 300 }],
      items: [{ categoryId: 2, amount: 1200.5, currency: 'EUR' }, { categoryId: 3, amount: 300, currency: 'USD' }],
    },
    { month: '2031-09', source: 'Cash', totals: [{ currency: 'EUR', amount: 80 }], items: [{ categoryId: 2, amount: 80, currency: 'EUR' }] },
    { month: '2031-08', source: 'Brisaluna Card', totals: [{ currency: 'EUR', amount: 900 }], items: [{ categoryId: 2, amount: 600, currency: 'EUR' }, { categoryId: 3, amount: 300, currency: 'EUR' }] },
  ],
  manual: { amount: 1500, currency: 'EUR', updated_at: '2031-09-12T08:30:00.000Z' },
}

/**
 * GET /api/spending answers the current state; every other /api/spending call is recorded and answers `onWrite`'s new state
 * (or a Response for a failure; none — the same state). `gate` holds back the currencies and settings answers.
 */
function stub(state: SpendingRecords = base, onWrite?: (call: Call, current: SpendingRecords) => SpendingRecords | Response, gate?: Promise<void>, closure: Partial<MonthCloseState> = { lastClosed: { month: '2031-08', reopenable: false } }) {
  const calls: Call[] = []
  let current = state
  let reads = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === '/api/admin/currencies') { await gate; return jsonResponse({ rows: [{ rowid: 1, code: 'EUR' }, { rowid: 2, code: 'USD' }], columns: ['code'] }) }
    if (url === '/api/settings') { await gate; return jsonResponse({ language: 'en-US', currency: 'EUR' }) }
    if (url === '/api/month-close') return jsonResponse(closure)
    if (url === '/api/spending' && method === 'GET') { reads++; return jsonResponse(current) }
    if (url.startsWith('/api/spending')) {
      const call: Call = { url, method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) }
      calls.push(call)
      const answer = onWrite ? onWrite(call, current) : current
      if (answer instanceof Response) return answer
      current = answer
      return jsonResponse(current)
    }
    return jsonResponse({})
  }))
  // not enumerable: a test compares `calls` as a plain list
  return Object.defineProperty(calls, 'reads', { value: () => reads }) as Call[] & { reads: () => number }
}

// the entries are of 2031: today is in October 2031, so September is the last finished month
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2031-10-15T12:00:00Z'))
  // the screen opens on the last closed month with something to split (August here); most tests work in September's draft
  window.history.replaceState({}, '', '/cashflow/categories?month=2031-09')
})
afterEach(() => { vi.useRealTimers(); resetAuth(); window.history.replaceState({}, '', '/') })

/** "+ Other source" under the month's table → the other source's window, its month set to `month` */
async function openOther(month = '07.2031') {
  fireEvent.click(await screen.findByRole('button', { name: '+ Other source' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add other source' })
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Month' }), { target: { value: month } })
  return dialog
}

async function openMonth(month: string) {
  const year = screen.queryByRole('button', { name: month.slice(0, 4) })
  if (year) fireEvent.click(year)
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${fmtMonth(month)}:`) }))
}

describe('Breakdown screen', () => {
  it('opens a linked closed zero-flow month inline', async () => {
    window.history.replaceState({}, '', '/cashflow/categories?month=2031-07')
    const zero = { month: '2031-07', bank: 'Quiet Bank', member: '', currency: 'USD', totals: { active: 0, passive: 0, expense: 0 }, items: [], allocated: { active: 0, passive: 0, expense: 0 }, orphaned: false }
    stub({ ...base, accounts: [...base.accounts, zero] })
    renderAdmin(<FlowsScreen />)
    expect(await screen.findByRole('table', { name: 'Breakdown by month' })).toHaveTextContent('July 2031')
  })

  it('keeps a linked closed month without category lines and prefills its one unallocated account', async () => {
    window.history.replaceState({}, '', '/cashflow/categories?month=2031-07')
    const quiet = { month: '2031-07', bank: 'Quiet Bank', member: '', currency: 'USD', totals: { active: 100, passive: 0, expense: 50 }, items: [], allocated: { active: 0, passive: 0, expense: 0 }, orphaned: false }
    const zero = { ...quiet, bank: 'Zero Broker', totals: { active: 0, passive: 0, expense: 0 } }
    stub({ ...base, accounts: [...base.accounts, zero, quiet] })
    renderAdmin(<FlowsScreen />)
    expect(await screen.findByRole('table', { name: 'Breakdown by month' })).toHaveTextContent('July 2031')
    expect(within(screen.getByRole('table', { name: 'Breakdown by month' })).getByText('Quiet Bank')).toBeInTheDocument()
    // the account without movement is one line under the table, not a row
    expect(within(screen.getByRole('table', { name: 'Breakdown by month' })).queryByText('Zero Broker')).toBeNull()
    expect(screen.getByText('No movement in July: Zero Broker.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Break down: Quiet Bank, July 2031' }))
    expect(await screen.findByRole('form', { name: 'Break down: Quiet Bank, July 2031' })).toBeInTheDocument()
  })

  it('lists the categories with direction, kind and “· one-off”; the reserved one shows its translated title and no menu', async () => {
    stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const catalog = await screen.findByRole('region', { name: 'Categories' })
    const expenses = within(catalog).getByRole('list', { name: 'Categories: Expenses' })
    const income = within(catalog).getByRole('list', { name: 'Categories: Income' })
    const rows = [...within(expenses).getAllByRole('listitem'), ...within(income).getAllByRole('listitem')]
    expect(rows.map(row => [...row.querySelectorAll('.category-catalog__name, .category-catalog__kind')].map(c => c.textContent))).toEqual([
      ['Loan payments', 'System · from loans'], ['Groceries', 'Mandatory'], ['Cinema', 'Optional'],
      ['Salary', 'Active'], ['Bonus', 'Active · one-off'], ['Dividends', 'Passive'],
    ])
    expect(within(rows[0]!).queryByRole('button')).toBeNull()
    expect(await screen.findByRole('table', { name: 'Breakdown by month' })).toHaveClass('spending-table')
    // mandatory categories feed the mandatory spending, not the health score
    expect(screen.getByText(/^Categories explain income and expenses/)).toHaveTextContent('Average mandatory expenses are used in financial calculations')
    expect(within(rows[1]!).getByRole('button', { name: 'Actions: Groceries' })).toBeInTheDocument()
    expect(screen.queryByText('loan_payments')).toBeNull()
  })

  it('ties an empty category name to its field and preserves the form', async () => {
    const calls = stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: 'Add category' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add category' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription(/name/i)
    expect(name).toHaveFocus()
    expect(calls).toHaveLength(0)
  })

  it('ties a duplicate category response to the name field', async () => {
    const calls = stub(base, () => jsonResponse({ error: { code: 'category_exists' } }, 409))
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: 'Add category' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add category' })
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    fireEvent.change(name, { target: { value: 'Groceries' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'))
    expect(name).toHaveAccessibleDescription(/already exists/i)
    expect(name).toHaveValue('Groceries')
    expect(name).toHaveFocus()
    expect(calls).toHaveLength(1)
  })

  it('adds an expense category: the kind select, no one-off flag', async () => {
    const calls = stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: 'Add category' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add category' })
    expect(within(dialog).getByRole('radio', { name: 'Expenses' })).toBeChecked()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: ' Pets ' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Kind' }), { target: { value: 'optional' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/spending/categories', method: 'POST', body: { name: 'Pets', kind: 'optional' } }]))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Collapse categories' })).toHaveAttribute('aria-expanded', 'true'))
  })

  it('adds an income category: the kind follows the direction (active or passive), the one-off flag is offered', async () => {
    const calls = stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: 'Add category' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add category' })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Income' }))
    expect(within(dialog).queryByRole('combobox', { name: 'Kind' })).toBeNull()
    expect(within(dialog).getByText(/A bonus, a tax refund, a prize/)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Prize' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Income kind' }), { target: { value: 'passive' } })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'One-off income' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/spending/categories', method: 'POST', body: { name: 'Prize', flow: 'passive', oneOff: true } }]))
  })

  it('editing an income category shows its direction and kind fixed; the name and the one-off flag are saved', async () => {
    const calls = stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Salary' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit category' })
    expect(within(dialog).getByRole('radio', { name: 'Income' })).toBeChecked()
    expect(within(dialog).getByRole('radio', { name: 'Income' })).toBeDisabled()
    expect(within(dialog).getByRole('radio', { name: 'Expenses' })).toBeDisabled()
    expect(within(dialog).getByRole('combobox', { name: 'Income kind' })).toBeDisabled()
    expect(within(dialog).getByText(/cannot change/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'One-off income' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Pay' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/spending/categories/10', method: 'PATCH', body: { name: 'Pay', oneOff: true } }]))
  })

  it('renames a category and changes its kind through the window', async () => {
    const calls = stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Cinema' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit category' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: ' Theatre ' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Kind' }), { target: { value: 'mandatory' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/spending/categories/3', method: 'PATCH', body: { name: 'Theatre', kind: 'mandatory' } }]))
  })

  it('deletes a category after the confirmation: DELETE /api/spending/categories/<id>', async () => {
    const calls = stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Cinema' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/spending/categories/3', method: 'DELETE' }]))
  })

  it('a category with lines is not deleted: the 409 category_in_use answer is shown as a toast', async () => {
    const calls = stub(base, () => jsonResponse({ error: { code: 'category_in_use' } }, 409))
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Salary' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('This category has lines entered. Remove those lines first')).toBeInTheDocument()
    expect(calls).toEqual([{ url: '/api/spending/categories/10', method: 'DELETE' }])
  })

  it('marks an open selected month once even when it has only other sources', async () => {
    stub({ ...base, accounts: base.accounts.filter(a => a.month !== '2031-09') })
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const table = await screen.findByRole('table', { name: 'Breakdown by month' })
    expect(within(table).getByText('September 2031')).toBeInTheDocument()
    expect(screen.getAllByText('not closed: the dashboard does not count it')).toHaveLength(1)
    expect(within(table).queryByText(/not closed/)).toBeNull()
  })

  it('keeps category actions in grouped lists and the monthly table responsive', async () => {
    stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    expect(await screen.findByRole('list', { name: 'Categories: Expenses' })).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Breakdown by month' })).toHaveClass('spending-table--3')
  })

  it('“Add standard categories” adds only the missing ones from the default list', async () => {
    const calls = stub({ ...base, categories: [loanPayments, { id: 2, name: 'groceries', kind: 'mandatory', flow: 'expense', oneOff: false }, { id: 3, name: 'Travel', kind: 'optional', flow: 'expense', oneOff: false }, salary] })
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: /^Show all categories/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add standard categories' }))
    await waitFor(() => expect(calls).toHaveLength(16))
    const sent = calls.map(c => (c.body as { name: string; kind?: string; flow?: string; oneOff?: boolean }))
    expect(calls.every(c => c.url === '/api/spending/categories' && c.method === 'POST')).toBe(true)
    expect(sent.map(b => b.name)).toEqual([
      'Housing', 'Utilities', 'Transport', 'Health', 'Children', 'Insurance', 'Cafes', 'Entertainment', 'Shopping', 'Other',
      'Business', 'Bonus', 'Dividends', 'Interest', 'Rent', 'Benefits',
    ])
    expect(sent.filter(b => b.kind === 'mandatory')).toHaveLength(6)
    expect(sent.filter(b => b.kind === 'optional')).toHaveLength(4)
    // income: a flow, no kind; only the bonus is one-off
    expect(sent.slice(10)).toEqual([
      { name: 'Business', flow: 'active' }, { name: 'Bonus', flow: 'active', oneOff: true },
      { name: 'Dividends', flow: 'passive' }, { name: 'Interest', flow: 'passive' }, { name: 'Rent', flow: 'passive' }, { name: 'Benefits', flow: 'passive' },
    ])
  })

  it('“Add standard categories” skips a standard category already entered in another language', async () => {
    const housing = ru('modules.cashflow.spending.defaults.housing').toLocaleUpperCase()
    const calls = stub({ ...base, categories: [loanPayments, { id: 2, name: housing, kind: 'mandatory', flow: 'expense', oneOff: false }, { id: 3, name: 'Groceries', kind: 'mandatory', flow: 'expense', oneOff: false }] })
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: /^Show all categories/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add standard categories' }))
    await waitFor(() => expect(calls).toHaveLength(17))
    expect(calls.map(c => (c.body as { name: string }).name)).not.toContain('Housing')
  })

  it('the month field takes a finished month without a warning and refuses this month or a later one', async () => {
    const calls = stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const dialog = await openOther()
    const month = within(dialog).getByRole('textbox', { name: 'Month' })
    fireEvent.change(month, { target: { value: '03.2031' } })
    expect(within(dialog).queryByText('That month has already passed')).toBeNull()
    expect(dialog.querySelector('.field__error')).toBeNull()
    fireEvent.change(month, { target: { value: '10.2031' } })
    expect(within(dialog).getByText('The month has not finished yet')).toHaveClass('field__error')
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Source' }), { target: { value: 'Cash' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Amount/ }), { target: { value: '5' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getAllByText('The month has not finished yet')).toHaveLength(2))
    expect(calls).toEqual([])
  })

  it('a line whose currency has left the project keeps it chosen and among the options', async () => {
    const calls = stub({ ...base, sources: [{ month: '2031-09', source: 'Cash', totals: [{ currency: 'GBP', amount: 80 }], items: [{ categoryId: 2, amount: 80, currency: 'GBP' }] }] })
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Cash, September 2031' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit other source' })
    // the entry being edited is its month and source: they are fixed, a change would write another entry and keep this one
    expect(within(dialog).getByRole('textbox', { name: 'Month' })).toBeDisabled()
    expect(within(dialog).getByRole('combobox', { name: 'Source' })).toBeDisabled()
    const currency = within(within(dialog).getByRole('group', { name: 'Line 1' })).getByRole('combobox', { name: 'Currency' })
    expect(currency).toHaveValue('GBP')
    expect(within(currency).getAllByRole('option').map(o => o.textContent)).toEqual(['GBP', 'EUR', 'USD'])
    fireEvent.change(currency, { target: { value: 'EUR' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/spending/months/2031-09/Cash', method: 'PUT', body: { items: [{ categoryId: 2, amount: 80, currency: 'EUR' }], base: [{ categoryId: 2, amount: 80, currency: 'GBP' }] } }]))
  })

  it('adding month totals sends PUT /api/spending/months/<month>/<source> with the typed items', async () => {
    const calls = stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const dialog = await openOther()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Month' }), { target: { value: '08.2031' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Source' }), { target: { value: ' Brisaluna / Card ' } })
    const first = within(dialog).getByRole('group', { name: 'Line 1' })
    fireEvent.change(within(first).getByRole('combobox', { name: 'Category' }), { target: { value: '2' } })
    fireEvent.change(within(first).getByRole('textbox', { name: 'Amount' }), { target: { value: '1200.5' } })
    fireEvent.change(within(first).getByRole('combobox', { name: 'Currency' }), { target: { value: 'USD' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add line' }))
    const second = within(dialog).getByRole('group', { name: 'Line 2' })
    fireEvent.change(within(second).getByRole('combobox', { name: 'Category' }), { target: { value: '3' } })
    fireEvent.change(within(second).getByRole('textbox', { name: 'Amount' }), { target: { value: '45' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({
      url: `/api/spending/months/2031-08/${encodeURIComponent('Brisaluna / Card')}`, method: 'PUT',
      body: { items: [{ categoryId: 2, amount: 1200.5, currency: 'USD' }, { categoryId: 3, amount: 45, currency: 'EUR' }], base: [] },
    })
  })

  it('the breakdown lists each account’s allocated of total per month, marks months not closed, and the other sources with their totals per currency', async () => {
    stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const table = await screen.findByRole('table', { name: 'Breakdown by month' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map(r => within(r).getAllByRole('cell').slice(0, 3).map(c => c.textContent))).toEqual([
      ['RQuillmark Bank Robin · USD', '$6,000.00 of $6,890.00$890.00 left', '$2,100.00 of $5,280.00$3,180.00 left'],
      ['Wallet EUR', '€0.00 of €0.00No activity', '€0.00 of €300.00€300.00 left'],
      ['Brisaluna CardOther source', '—', '1,200.50 EUR · 300.00 USD'],
      ['CashOther source', '—', '80.00 EUR'],
    ])
    await openMonth('2031-08')
    const augustRows = within(screen.getByRole('table', { name: 'Breakdown by month' })).getAllByRole('row').slice(1)
    expect(augustRows.map(r => within(r).getAllByRole('cell').slice(0, 3).map(c => c.textContent))).toEqual([
      ['RQuillmark Bank Robin · USD', '$6,500.00 of —Total not entered', '$0.00 of $5,000.00$5,000.00 left'],
      ['Old Bank the account is not in this month', '—', '—'],
      ['Brisaluna CardOther source', '—', '900.00 EUR'],
    ])
    expect(within(augustRows[1]!).getByText('the account is not in this month')).toBeInTheDocument()
    // a closed month carries no mark
    expect(within(augustRows[0]!).queryByText(/not closed/)).toBeNull()
  })

  it('shows all accounts in a month without month or account dropdowns', async () => {
    stub()
    renderAdmin(<FlowsScreen />)
    const table = await screen.findByRole('table', { name: 'Breakdown by month' })
    expect(table).toHaveTextContent('Wallet')
    expect(table).toHaveTextContent('Quillmark')
    expect(screen.queryByRole('combobox', { name: 'Month' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Account' })).toBeNull()
    await openMonth('2031-08')
    expect(screen.getAllByRole('table', { name: 'Breakdown by month' })).toHaveLength(1)
    expect(screen.getByRole('table', { name: 'Breakdown by month' })).toHaveTextContent('Old Bank')
  })

  it('“Break down” opens the editor in place on the account’s lines with its header; Save sends the account’s lines', async () => {
    const calls = stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: 'Break down: Quillmark Bank · Robin, September 2031' }))
    const dialog = await screen.findByRole('form', { name: 'Break down: Quillmark Bank · Robin, September 2031' })
    // in place: inside the month's table, under its account's row
    expect(screen.getByRole('table', { name: 'Breakdown by month' })).toContainElement(dialog)
    expect(within(dialog).getByRole('group', { name: 'Income' })).toHaveTextContent('Of 6,890.00: 6,000.00 allocated · 890.00 unallocated')
    expect(within(dialog).getByLabelText('Amount: Income line 1')).toHaveValue('6,000')
    // the editor has the one Save, the screen's one primary while it is open
    expect(within(dialog).getAllByRole('button', { name: 'Save' })).toHaveLength(1)
    expect(document.querySelectorAll('.btn--primary')).toHaveLength(1)
    fireEvent.change(within(dialog).getByLabelText('Amount: Income line 1'), { target: { value: '6200' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toEqual([{
      url: '/api/spending/months/2031-09/account', method: 'PUT',
      body: { bank: 'Quillmark Bank', member: 'Robin', items: [{ categoryId: 10, amount: 6200 }, { categoryId: 2, amount: 2100 }], base: [{ categoryId: 10, amount: 6000 }, { categoryId: 2, amount: 2100 }] },
    }]))
    await waitFor(() => expect(calls.reads()).toBe(2))
    await waitFor(() => expect(screen.queryByRole('form', { name: /^Break down:/ })).toBeNull())
  })

  it('an account without lines has no “Clear lines”; with lines it asks, then sends an empty list', async () => {
    const calls = stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    await screen.findByRole('button', { name: 'Break down: Wallet, September 2031' })
    expect(screen.queryByRole('button', { name: 'Actions: Wallet, September 2031' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Actions: Quillmark Bank · Robin, September 2031' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear lines' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Clear lines' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/spending/months/2031-09/account', method: 'PUT', body: { bank: 'Quillmark Bank', member: 'Robin', items: [], base: [{ categoryId: 10, amount: 6000 }, { categoryId: 2, amount: 2100 }] } }]))
  })

  it('lines of an account that is gone are listed as such and can be deleted', async () => {
    const calls = stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    await screen.findByRole('table', { name: 'Breakdown by month' }); await openMonth('2031-08')
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Old Bank, August 2031' }))
    expect(screen.queryByRole('menuitem', { name: 'Break down' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete lines' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete lines' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/spending/months/2031-08/account', method: 'PUT', body: { bank: 'Old Bank', member: '', items: [], base: [{ categoryId: 2, amount: 5 }] } }]))
  })

  it('a closed month without category lines remains available in the timeline', async () => {
    const quiet = { month: '2031-07', bank: 'Quiet Bank', member: '', currency: 'USD', totals: { active: 100, passive: 0, expense: 50 }, items: [], allocated: { active: 0, passive: 0, expense: 0 }, orphaned: false }
    stub({ ...base, accounts: [...base.accounts, quiet] })
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const table = await screen.findByRole('table', { name: 'Breakdown by month' })
    expect(within(table).queryByText(/Quiet Bank/)).toBeNull()
    expect(within(table).queryByText('July 2031')).toBeNull()
    expect(screen.getByRole('button', { name: /^July 2031:/ })).toBeInTheDocument()
    await openMonth('2031-07')
    expect(within(screen.getByRole('table', { name: 'Breakdown by month' })).getByText('Quiet Bank')).toBeInTheDocument()
  })



  it('the embedded manual amount cancels edits and refuses unchanged or empty drafts', async () => {
    const calls = stub()
    renderAdmin(<ManualAmountBlock embedded />)
    const field = await screen.findByRole('textbox', { name: /^Amount/ })
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    fireEvent.change(field, { target: { value: '1650' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Currency' }), { target: { value: 'USD' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(field).toHaveValue('1,500')
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveValue('EUR')
    expect(save).toBeDisabled()
    fireEvent.change(field, { target: { value: '1500.00' } })
    expect(save).toBeDisabled()
    fireEvent.change(field, { target: { value: '' } })
    expect(save).toBeDisabled()
    expect(calls).toHaveLength(0)
  })

  it('a failed manual save preserves the draft and prevents duplicate submissions', async () => {
    const gate = deferred<Response>()
    const fetchMock = stubApi({ currencies: [{ rowid: 1, code: 'EUR' }] }, { answer: {
      'GET /api/settings': () => jsonResponse({ currency: 'EUR' }),
      'GET /api/spending': () => jsonResponse(base),
      'PUT /api/spending/manual': () => gate.promise,
    } })
    renderAdmin(<ManualAmountBlock />)
    const field = await screen.findByRole('textbox', { name: /^Amount/ })
    fireEvent.change(field, { target: { value: '1650' } })
    const form = screen.getByRole('form', { name: 'Base monthly expenses' })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(field).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
    await waitFor(() => expect(sent(fetchMock, 'PUT')).toHaveLength(1))
    gate.resolve(jsonResponse({ error: 'failed save' }, 500))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    expect(field).toHaveValue('1,650')
    expect(sent(fetchMock, 'PUT')).toHaveLength(1)
  })

  it('the manual amount shows its update date and saves through PUT /api/spending/manual', async () => {
    const calls = stub()
    renderAdmin(<ManualAmountBlock />); expandDisclosures()
    expect(await screen.findByText('Updated 09/12/2031')).toBeInTheDocument()
    const manual = screen.getByRole('region', { name: 'Base monthly expenses' })
    expect(within(manual).getByRole('textbox', { name: /^Amount/ })).toHaveValue('1,500')
    fireEvent.change(within(manual).getByRole('textbox', { name: /^Amount/ }), { target: { value: '1650' } })
    fireEvent.change(within(manual).getByRole('combobox', { name: 'Currency' }), { target: { value: 'USD' } })
    fireEvent.click(within(manual).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/spending/manual', method: 'PUT', body: { amount: 1650, currency: 'USD' } }]))
    await waitFor(() => expect(within(manual).getByRole('button', { name: 'Clear' })).toBeEnabled())
    fireEvent.click(within(manual).getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(calls[1]).toEqual({ url: '/api/spending/manual', method: 'DELETE' }))
  })

  it('the manual amount waits for the currency lists: with nothing saved yet it never sends an empty currency', async () => {
    let open!: () => void
    const calls = stub({ ...base, manual: null }, undefined, new Promise<void>(resolve => { open = resolve }))
    renderAdmin(<ManualAmountBlock />); expandDisclosures()
    await screen.findByRole('region', { name: 'Base monthly expenses' })
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    open()
    const manual = screen.getByRole('region', { name: 'Base monthly expenses' })
    const amount = await within(manual).findByRole('textbox', { name: /^Amount/ })
    expect(within(manual).getByRole('combobox', { name: 'Currency' })).toHaveValue('EUR')
    fireEvent.change(amount, { target: { value: '700' } })
    fireEvent.click(within(manual).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/spending/manual', method: 'PUT', body: { amount: 700, currency: 'EUR' } }]))
    await waitFor(() => expect(calls.reads()).toBe(2))
    await waitFor(() => expect(screen.queryByRole('form', { name: /^Break down:/ })).toBeNull())
  })

  it('choosing an existing month and source loads its lines; Save sends them back with the edited one', async () => {
    const calls = stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const dialog = await openOther()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Month' }), { target: { value: '08.2031' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Source' }), { target: { value: 'Brisaluna Card' } })
    const first = await within(dialog).findByRole('group', { name: 'Line 1' })
    const second = within(dialog).getByRole('group', { name: 'Line 2' })
    expect(within(first).getByRole('combobox', { name: 'Category' })).toHaveValue('2')
    expect(within(first).getByRole('textbox', { name: 'Amount' })).toHaveValue('600')
    expect(within(second).getByRole('combobox', { name: 'Category' })).toHaveValue('3')
    expect(within(dialog).getByText(/Saving replaces them/)).toBeInTheDocument()
    fireEvent.change(within(second).getByRole('textbox', { name: 'Amount' }), { target: { value: '350' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({
      url: '/api/spending/months/2031-08/Brisaluna%20Card', method: 'PUT',
      body: {
        items: [{ categoryId: 2, amount: 600, currency: 'EUR' }, { categoryId: 3, amount: 350, currency: 'EUR' }],
        // the lines the window loaded: the server refuses the save if they changed meanwhile
        base: [{ categoryId: 2, amount: 600, currency: 'EUR' }, { categoryId: 3, amount: 300, currency: 'EUR' }],
      },
    })
    await waitFor(() => expect(calls.reads()).toBe(2))
    await waitFor(() => expect(screen.queryByRole('form', { name: /^Break down:/ })).toBeNull())
  })

  it('a source that matches part-way and then stops matching gives back the lines typed before', async () => {
    stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const dialog = await openOther()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Month' }), { target: { value: '09.2031' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Amount/ }), { target: { value: '5' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Source' }), { target: { value: 'Cash' } })
    expect(within(dialog).getByRole('textbox', { name: /^Amount/ })).toHaveValue('80')
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Source' }), { target: { value: 'Cash 2' } })
    expect(within(dialog).queryByText(/Saving replaces them/)).toBeNull()
    expect(within(dialog).getAllByRole('textbox', { name: /^Amount/ }).map(e => (e as HTMLInputElement).value)).toEqual(['5'])
  })

  it('switching the month away from a matched entry gives back the lines typed before', async () => {
    stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const dialog = await openOther()
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Source' }), { target: { value: 'Brisaluna Card' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Amount/ }), { target: { value: '7' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Month' }), { target: { value: '08.2031' } })
    expect(within(dialog).getAllByRole('textbox', { name: /^Amount/ }).map(e => (e as HTMLInputElement).value)).toEqual(['600', '300'])
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Month' }), { target: { value: '07.2031' } })
    expect(within(dialog).getAllByRole('textbox', { name: /^Amount/ }).map(e => (e as HTMLInputElement).value)).toEqual(['7'])
  })

  it('lines edited after a prefill stay when the match is lost', async () => {
    stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const dialog = await openOther()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Month' }), { target: { value: '09.2031' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Source' }), { target: { value: 'Cash' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Amount/ }), { target: { value: '99' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Source' }), { target: { value: 'Cash 2' } })
    expect(within(dialog).getAllByRole('textbox', { name: /^Amount/ }).map(e => (e as HTMLInputElement).value)).toEqual(['99'])
  })

  it('a legacy statement source offers Delete only: its name cannot be saved again', async () => {
    stub({ ...base, sources: [{ month: '2031-09', source: 'Statement: Quillmark Bank', totals: [{ currency: 'EUR', amount: 80 }], items: [{ categoryId: 2, amount: 80, currency: 'EUR' }] }] })
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Statement: Quillmark Bank, September 2031' }))
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Delete'])
  })

  it('Edit in a source’s menu opens the window with its month, source and lines', async () => {
    const calls = stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Cash, September 2031' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit other source' })
    expect(within(dialog).getByRole('textbox', { name: 'Month' })).toHaveValue('09/2031')
    expect(within(dialog).getByRole('combobox', { name: 'Source' })).toHaveValue('Cash')
    const line = within(dialog).getByRole('group', { name: 'Line 1' })
    expect(within(line).getByRole('textbox', { name: 'Amount' })).toHaveValue('80')
    fireEvent.change(within(line).getByRole('textbox', { name: 'Amount' }), { target: { value: '95' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/spending/months/2031-09/Cash', method: 'PUT', body: { items: [{ categoryId: 2, amount: 95, currency: 'EUR' }], base: [{ categoryId: 2, amount: 80, currency: 'EUR' }] } }]))
    await waitFor(() => expect(calls.reads()).toBe(2))
    await waitFor(() => expect(screen.queryByRole('form', { name: /^Break down:/ })).toBeNull())
  })

  it('removing a middle line keeps the amounts of the others', async () => {
    stub()
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const dialog = await openOther()
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Amount/ }), { target: { value: '10' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add line' }))
    fireEvent.change(within(within(dialog).getByRole('group', { name: 'Line 2' })).getByRole('textbox', { name: /^Amount/ }), { target: { value: '20' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add line' }))
    fireEvent.change(within(within(dialog).getByRole('group', { name: 'Line 3' })).getByRole('textbox', { name: /^Amount/ }), { target: { value: '30' } })
    // one row per line: the category, the amount, the currency and an icon button to remove it
    expect(within(dialog).getByRole('group', { name: 'Line 2' })).toHaveClass('spending-line')
    expect(within(dialog).getByRole('button', { name: 'Remove: Line 2' })).toHaveClass('icon-btn')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove: Line 2' }))
    const amounts = within(dialog).getAllByRole('textbox', { name: /^Amount/ }).map(e => (e as HTMLInputElement).value)
    expect(amounts).toEqual(['10', '30'])
  })

  it('with no categories, a breakdown cannot be added and the screen says why', async () => {
    stub({ categories: [], accounts: [], sources: [], manual: null })
    renderAdmin(<FlowsScreen />); expandDisclosures()
    expect(await screen.findByText('Add a category first: a breakdown is entered by category')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Other source' })).toBeNull()
  })

  it('without a closed month or a draft the breakdown says to close one first, with a link', async () => {
    stub({ ...base, accounts: [], sources: [] })
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const link = await screen.findByRole('link', { name: 'Close a month' })
    expect(link).toHaveAttribute('href', '/close')
  })

  it('without any month yet "+ Other source" is still offered, its window asking for the month', async () => {
    stub({ ...base, accounts: [], sources: [] }, undefined, undefined, {})
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const dialog = await openOther('07.2031')
    expect(within(dialog).getByRole('textbox', { name: 'Month' })).toHaveValue('07/2031')
  })

  it('accounts without any line say there is no breakdown yet', async () => {
    stub({ ...base, accounts: base.accounts.filter(a => a.items.length === 0 && !a.orphaned), sources: [] })
    renderAdmin(<FlowsScreen />); expandDisclosures()
    expect(await screen.findByText(/Allocate totals to categories/)).toBeInTheDocument()
  })

  it('after “Add standard categories” fails midway, the list is read again and a retry adds only the rest', async () => {
    const calls = stub({ ...base, categories: [loanPayments] }, (call, current) => {
      const { name, kind } = call.body as { name: string; kind: 'mandatory' | 'optional' }
      if (name === 'Transport') return jsonResponse({ error: { code: 'invalid_name' } }, 400)
      return { ...current, categories: [...current.categories, { id: current.categories.length + 1, name, kind, flow: 'expense' as const, oneOff: false }] }
    })
    renderAdmin(<FlowsScreen />); expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: /^Show all categories/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add standard categories' }))
    await screen.findByRole('list', { name: 'Categories: Expenses' })
    await waitFor(() => expect(calls.map(c => (c.body as { name: string }).name)).toEqual(['Housing', 'Utilities', 'Groceries', 'Transport']))
    expect(await screen.findByText('Groceries')).toBeInTheDocument()
    await waitFor(() => expect(calls.reads()).toBeGreaterThanOrEqual(2))
    calls.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Add standard categories' }))
    await waitFor(() => expect(calls.map(c => (c.body as { name: string }).name)).toEqual(['Transport']))
  })

  it('shows one month and lets the user select older months', async () => {
    const months = ['2031-09', '2031-08', '2031-07', '2031-06', '2031-05', '2031-04', '2031-03']
    const accounts = months.map(month => ({
      month, bank: 'Quillmark Bank', member: 'Robin', currency: 'USD', totals: { active: 100, passive: 0, expense: 50 },
      items: [{ categoryId: 10, amount: 100 }], allocated: { active: 100, passive: 0, expense: 0 }, orphaned: false,
    }))
    stub({ ...base, accounts, sources: [] })
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const table = await screen.findByRole('table', { name: 'Breakdown by month' })
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).queryByText('March 2031')).toBeNull()
    await openMonth('2031-03')
    expect(screen.getByRole('table', { name: 'Breakdown by month' })).toHaveTextContent('March 2031')
    await openMonth('2031-09')
    expect(screen.getByRole('table', { name: 'Breakdown by month' })).not.toHaveTextContent('March 2031')
  })

  it('a save into an older month selects that month', async () => {
    const accounts = ['2031-09', '2031-08', '2031-07', '2031-06', '2031-05', '2031-04', '2031-03'].map(month => ({
      month, bank: 'Quillmark Bank', member: 'Robin', currency: 'USD', totals: { active: 100, passive: 0, expense: 50 },
      items: [{ categoryId: 10, amount: 100 }], allocated: { active: 100, passive: 0, expense: 0 }, orphaned: false,
    }))
    const source = { month: '2031-03', source: 'Cash', totals: [{ currency: 'EUR', amount: 80 }], items: [{ categoryId: 2, amount: 80, currency: 'EUR' }] }
    const calls = stub({ ...base, accounts, sources: [] }, (call, current) => (call.method === 'PUT' ? { ...current, sources: [source] } : current))
    renderAdmin(<FlowsScreen />); expandDisclosures()
    const table = await screen.findByRole('table', { name: 'Breakdown by month' })
    expect(within(table).queryByText('March 2031')).toBeNull()
    const dialog = await openOther('03.2031')
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Source' }), { target: { value: 'Cash' } })
    const line = within(dialog).getByRole('group', { name: 'Line 1' })
    fireEvent.change(within(line).getByRole('combobox', { name: 'Category' }), { target: { value: '2' } })
    fireEvent.change(within(line).getByRole('textbox', { name: 'Amount' }), { target: { value: '80' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    // Saving makes the affected month visible.
    expect(await within(await screen.findByRole('table', { name: 'Breakdown by month' })).findByText('Cash')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Breakdown by month' })).toHaveTextContent('March 2031')
  })

  it('a view-only user sees the data and the view-only note, without actions', async () => {
    stub()
    setAuth({ me: { name: 'Robin', rights: { edit: false, vote: true, manage: false } } })
    renderAdmin(<FlowsScreen />); expandDisclosures()
    expect(await screen.findByText('View only: editing is unavailable')).toBeInTheDocument()
    expect(await screen.findByText('Groceries')).toBeInTheDocument()
    expect(screen.getByText('1,200.50 EUR · 300.00 USD')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Base monthly expenses' })).toBeNull()
    expect(screen.getByRole('table', { name: 'Breakdown by month' })).toHaveTextContent('Quillmark Bank Robin · USD')
    expect(screen.queryByRole('button', { name: /^Actions:/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add category' })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Other source' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Break down:/ })).toBeNull()
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('a view-only user can open months in a long history', async () => {
    const accounts = ['2031-09', '2031-08', '2031-07', '2031-06', '2031-05', '2031-04', '2031-03'].map(month => ({
      month, bank: 'Quillmark Bank', member: 'Robin', currency: 'USD', totals: { active: 100, passive: 0, expense: 50 },
      items: [{ categoryId: 10, amount: 100 }], allocated: { active: 100, passive: 0, expense: 0 }, orphaned: false,
    }))
    stub({ ...base, accounts, sources: [] })
    setAuth({ me: { name: 'Robin', rights: { edit: false, vote: true, manage: false } } })
    renderAdmin(<FlowsScreen />); expandDisclosures()
    await screen.findByRole('table', { name: 'Breakdown by month' })
    expect(document.querySelectorAll('.month-ledger__entry:not(:disabled)')).toHaveLength(7)
    await openMonth('2031-03')
    expect(screen.getByRole('table', { name: 'Breakdown by month' })).toHaveTextContent('March 2031')
    expect(screen.queryByRole('button', { name: /^Break down:/ })).toBeNull()
  })
})

it('shows allocation progress and remaining money without inventing completion for zero or unknown totals', async () => {
  stub()
  renderAdmin(<FlowsScreen />)
  const income = await screen.findByRole('progressbar', { name: 'Income: Quillmark Bank · Robin' })
  expect(Number(income.getAttribute('aria-valuenow'))).toBeCloseTo(6000 / 6890 * 100)
  expect(income).toHaveAttribute('aria-valuetext', '$6,000.00 of $6,890.00')
  expect(screen.getByText('$890.00 left')).toBeInTheDocument()
  expect(screen.queryByRole('progressbar', { name: 'Income: Wallet' })).toBeNull()
  expect(screen.getByText('No activity')).toBeInTheDocument()
  await openMonth('2031-08')
  expect(screen.queryByRole('progressbar', { name: 'Income: Quillmark Bank · Robin' })).toBeNull()
  expect(screen.getByText('Total not entered')).toBeInTheDocument()
})

it('flags per-flow over-allocation even if combined income remains below its total', async () => {
  stub({ ...base, sources: [], accounts: [{ ...base.accounts[0]!, allocated: { active: 6600, passive: 0, expense: 2100 } }] })
  renderAdmin(<FlowsScreen />)
  const meter = await screen.findByRole('progressbar', { name: 'Income: Quillmark Bank · Robin' })
  expect(Number(meter.getAttribute('aria-valuenow'))).toBeLessThan(100)
  expect(screen.getByText('A total is exceeded. Review the breakdown.')).toBeInTheDocument()
})

it('masks allocation details and accessible amount text without hiding relative progress', async () => {
  stub()
  renderAdmin(<PrivacyContext.Provider value={{ hidden: true, toggle: vi.fn() }}><FlowsScreen /></PrivacyContext.Provider>)
  const meter = await screen.findByRole('progressbar', { name: 'Income: Quillmark Bank · Robin' })
  expect(meter).toHaveAttribute('aria-valuetext', '••• of •••')
  expect(meter.parentElement).not.toHaveTextContent('6,000.00')
  expect(meter.parentElement).toHaveTextContent('••• left')
  expect(meter.outerHTML).not.toContain('6890')
})

it('places the months first, the category catalog under them, and groups directions', async () => {
  stub()
  renderAdmin(<FlowsScreen />)
  const catalog = await screen.findByRole('region', { name: 'Categories' })
  const breakdown = screen.getByRole('region', { name: 'Breakdown by month' })
  expect(breakdown.compareDocumentPosition(catalog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const expense = within(catalog).getByRole('list', { name: 'Categories: Expenses' })
  const income = within(catalog).getByRole('list', { name: 'Categories: Income' })
  expect(within(expense).getByText('Groceries')).toBeInTheDocument()
  expect(within(income).getByText('Bonus')).toBeInTheDocument()
  expect(within(income).getByText('Active · one-off')).toBeInTheDocument()
  expect(within(catalog).getByRole('button', { name: 'Add category' })).toBeInTheDocument()
})


it('expands the counted catalog without writing data and can collapse it again', async () => {
  const calls = stub()
  renderAdmin(<FlowsScreen />)
  const toggle = await screen.findByRole('button', { name: 'Show all categories (6)' })
  const controlled = document.getElementById(toggle.getAttribute('aria-controls')!)!
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(controlled).not.toHaveClass('category-catalog--expanded')
  expect(screen.queryByRole('button', { name: 'Add standard categories' })).toBeNull()
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(toggle).toHaveTextContent('Collapse categories')
  expect(controlled).toHaveClass('category-catalog--expanded')
  expect(within(controlled).getByRole('button', { name: 'Actions: Cinema' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add standard categories' })).toBeInTheDocument()
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(calls).toHaveLength(0)
})


it('previews editable categories while retaining the protected category in the full catalog', async () => {
  stub()
  renderAdmin(<FlowsScreen />)
  const catalog = await screen.findByRole('region', { name: 'Categories' })
  const list = within(catalog).getByRole('list', { name: 'Categories: Expenses' })
  const rows = within(list).getAllByRole('listitem')
  expect(rows[0]).not.toHaveClass('category-catalog__item--preview')
  expect(rows[1]).toHaveClass('category-catalog__item--preview', 'category-catalog__item--first')
  expect(within(rows[1]!).getByRole('button', { name: 'Actions: Groceries' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /^Show all categories/ }))
  expect(within(rows[0]!).queryByRole('button')).toBeNull()
})


it('shows the protected category when it is the only category instead of an empty preview', async () => {
  stub({ ...base, categories: [loanPayments] })
  renderAdmin(<FlowsScreen />)
  const list = await screen.findByRole('list', { name: 'Categories: Expenses' })
  const row = within(list).getByRole('listitem')
  expect(row).toHaveClass('category-catalog__item--preview', 'category-catalog__item--first')
  expect(row).toHaveTextContent('System · from loans')
  expect(within(row).queryByRole('button')).toBeNull()
})


const closedCoverage = { queue: [], incomplete: [], lastClosed: { month: '2031-09', reopenable: false } }
const coverageData = (row: Partial<SpendingRecords['accounts'][number]> = {}): SpendingRecords => ({
  ...base, accounts: [{ ...base.accounts[0]!, month: '2031-08', orphaned: false, totals: { active: 100, passive: 0, expense: 50 }, allocated: { active: 100, passive: 0, expense: 50 }, ...row }], sources: [],
})

it.each([
  ['allocated', {}, closedCoverage],
  ['noActivity', { totals: { active: 0, passive: 0, expense: 0 }, allocated: { active: 0, passive: 0, expense: 0 } }, closedCoverage],
  ['unallocated', { allocated: { active: 80, passive: 0, expense: 50 } }, closedCoverage],
  ['over', { allocated: { active: 110, passive: 0, expense: 40 } }, closedCoverage],
  ['missingTotals', { totals: { active: null, passive: 0, expense: 50 } }, closedCoverage],
  ['orphaned', { totals: null, orphaned: true }, closedCoverage],
  ['unknown', {}, undefined],
] as const)('reports month coverage %s without aggregating currencies', (status, row, closure) => {
  expect(monthCoverage(coverageData(row), closure).find(item => item.month === '2031-08')?.status).toBe(status)
})

it('includes months with no spending rows from the authoritative queue and incomplete history', () => {
  const coverage = monthCoverage({ ...base, accounts: [], sources: [] }, {
    queue: ['2031-09', '2031-10'], incomplete: [{ month: '2031-07', missing: 2 }], lastClosed: { month: '2031-08', reopenable: false },
  })
  expect(coverage.map(({ month, status, selectable }) => ({ month, status, selectable }))).toEqual([
    { month: '2031-10', status: 'notClosed', selectable: false },
    { month: '2031-09', status: 'notClosed', selectable: false },
    { month: '2031-08', status: 'noRecords', selectable: false },
    { month: '2031-07', status: 'missingTotals', selectable: false },
  ])
})

it('does not call source-only months fully allocated', () => {
  expect(monthCoverage({ ...base, accounts: [] }, closedCoverage).filter(item => item.selectable).every(item => item.status === 'sourcesOnly')).toBe(true)
})

it('keeps missing months visible in the timeline and opens zero-activity accounts inline', async () => {
  const zero = { ...base.accounts[0]!, month: '2031-06', items: [], totals: { active: 0, passive: 0, expense: 0 }, allocated: { active: 0, passive: 0, expense: 0 } }
  stub({ ...base, accounts: [...base.accounts, zero] }, undefined, undefined, {
    queue: ['2031-09', '2031-10'], incomplete: [{ month: '2031-07', missing: 2 }], lastClosed: { month: '2031-08', reopenable: false },
  })
  renderAdmin(<FlowsScreen />)
  await screen.findByRole('table', { name: 'Breakdown by month' })
  const october = screen.getByRole('button', { name: /^October 2031:/ })
  expect(october).toHaveTextContent('Not closed')
  await openMonth('2031-10')
  expect(screen.getByRole('link', { name: 'Close months' })).toHaveAttribute('href', '/close')
  expect(screen.queryByRole('table', { name: 'Breakdown by month' })).toBeNull()
  await openMonth('2031-07')
  expect(screen.getByRole('link', { name: 'Check accounts' })).toHaveAttribute('href', '/accounts')
  await openMonth('2031-06')
  // an account without movement is named in one line, not drawn as an empty row
  expect(screen.getByRole('table', { name: 'Breakdown by month' })).not.toHaveTextContent('Quillmark Bank')
  expect(screen.getByText('No movement in June: Quillmark Bank.')).toBeInTheDocument()
})


it('exposes consecutive historical gaps, including ones absent from the migration warning', () => {
  const data = coverageData()
  data.accounts = [{ ...data.accounts[0]!, month: '2031-01' }, { ...data.accounts[0]!, month: '2031-04' }]
  expect(monthCoverage(data, { queue: [], incomplete: [{ month: '2031-02', missing: 1 }], lastClosed: { month: '2031-04', reopenable: false } }).map(item => [item.month, item.status])).toEqual([
    ['2031-04', 'allocated'], ['2031-03', 'noRecords'], ['2031-02', 'missingTotals'], ['2031-01', 'allocated'],
  ])
})

it('does not label zero account totals as no activity when a free source has a positive amount', () => {
  const data = coverageData({ totals: { active: 0, passive: 0, expense: 0 }, allocated: { active: 0, passive: 0, expense: 0 } })
  data.sources = [{ ...base.sources[0]!, month: '2031-08' }]
  expect(monthCoverage(data, closedCoverage).find(item => item.month === '2031-08')?.status).toBe('sourcesOnly')
})


it('keeps older problem months visible without a separate status panel or preview limit', async () => {
  const recent = ['2031-09', '2031-08', '2031-07', '2031-06', '2031-05', '2031-04'].map(month => ({ ...coverageData().accounts[0]!, month }))
  stub({ ...base, accounts: recent, sources: [] }, undefined, undefined, { queue: [], incomplete: [{ month: '2031-03', missing: 1 }], lastClosed: { month: '2031-09', reopenable: false } })
  renderAdmin(<FlowsScreen />)
  const march = await screen.findByRole('button', { name: /^March 2031:/ })
  expect(march.closest('button')).toHaveTextContent('Totals missing')
  expect(screen.queryByRole('region', { name: 'Month status' })).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
})


it('switches years without disclosure, remembers the selected month and keeps one table', async () => {
  const data = coverageData()
  data.accounts = [{ ...data.accounts[0]!, month: '2031-09' }, { ...data.accounts[0]!, month: '2030-12' }, { ...data.accounts[0]!, month: '2030-05' }]
  stub(data, undefined, undefined, closedCoverage)
  renderAdmin(<FlowsScreen />)
  await screen.findByRole('table', { name: 'Breakdown by month' })
  expect(screen.queryByRole('button', { name: /^December 2030:/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '2030' }))
  const older = screen.getByRole('button', { name: /^December 2030:/ })
  expect(older).toBeVisible()
  fireEvent.click(older)
  expect(older).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('table', { name: 'Breakdown by month' })).toHaveTextContent('December 2030')
  fireEvent.click(older)
  expect(screen.getAllByRole('table')).toHaveLength(1)
  await openMonth('2030-05')
  await openMonth('2031-09')
  expect(screen.queryByRole('button', { name: /^December 2030:/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '2030' }))
  expect(screen.getByRole('button', { name: /^May 2030:/ })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.keyDown(screen.getByRole('button', { name: '2030' }), { key: 'ArrowRight' })
  expect(screen.getByRole('button', { name: '2031' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /^September 2031:/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /^December 2031:/ })).toBeDisabled()
  expect(screen.queryByText('How category allocation works')).toBeNull()
  expect(screen.queryByRole('region', { name: 'Base monthly expenses' })).toBeNull()
})


it('protects edited account allocation on cancel and retains input when discard is rejected', async () => {
  const calls = stub()
  renderAdmin(<FlowsScreen />)
  fireEvent.click(await screen.findByRole('button', { name: 'Break down: Quillmark Bank · Robin, September 2031' }))
  const editor = await screen.findByRole('form', { name: 'Break down: Quillmark Bank · Robin, September 2031' })
  fireEvent.change(within(editor).getByLabelText('Amount: Income line 1'), { target: { value: '6200' } })
  fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
  const warning = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })
  fireEvent.click(within(warning).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).toBeNull())
  expect(within(editor).getByLabelText('Amount: Income line 1')).toHaveValue('6,200')
  expect(calls).toEqual([])
  fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Break down: Quillmark Bank · Robin, September 2031' })).toBeNull())
  expect(calls).toEqual([])
})

it('asks before discarding typed input in the category and other-source windows', async () => {
  const calls = stub()
  renderAdmin(<FlowsScreen />); expandDisclosures()
  const cancelAsks = async (dialog: HTMLElement) => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  }
  fireEvent.click(await screen.findByRole('button', { name: 'Add category' }))
  const category = await screen.findByRole('dialog', { name: 'Add category' })
  fireEvent.change(within(category).getByRole('textbox', { name: 'Name' }), { target: { value: 'Pets' } })
  await cancelAsks(category)

  const other = await openOther()
  fireEvent.change(within(other).getByRole('combobox', { name: 'Source' }), { target: { value: 'Cash' } })
  await cancelAsks(other)
  expect(calls).toEqual([])
})

it('does not apply a delayed duplicate response to a corrected category name', async () => {
  const gate = deferred<Response>()
  const api = stubApi({}, { answer: { 'POST /api/spending/categories': () => gate.promise } })
  renderAdmin(<FlowsScreen />)
  fireEvent.click(await screen.findByRole('button', { name: 'Add category' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add category' })
  const name = within(dialog).getByRole('textbox', { name: 'Name' })
  fireEvent.change(name, { target: { value: 'Groceries' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(sent(api, 'POST')).toHaveLength(1))
  fireEvent.change(name, { target: { value: 'New unique name' } })
  gate.resolve(jsonResponse({ error: { code: 'category_exists' } }, 409))
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Add' })).toBeEnabled())
  expect(name).not.toHaveAttribute('aria-invalid')
  expect(name).toHaveValue('New unique name')
})

it('failed currency read offers retry and blocks reference-dependent allocation', async () => {
  const calls = stub()
  const real = globalThis.fetch
  let fail = true
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/admin/currencies' && fail ? jsonResponse({}, 503) : real(input, init))
  renderAdmin(<FlowsScreen />)
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  expect(calls).toEqual([])
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument())
  expect(calls).toEqual([])
})

it.each(['/api/admin/currencies', '/api/settings'])('keeps an existing source draft and blocks its write until %s recovers', async failedUrl => {
  const existing = { month: '2031-09', source: 'Cash', totals: [{ currency: 'GBP', amount: 80 }], items: [{ categoryId: 2, amount: 80, currency: 'GBP' }] }
  const calls = stub({ ...base, sources: [existing] })
  const real = globalThis.fetch
  let fail = true
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => String(input) === failedUrl && fail ? jsonResponse({}, 503) : real(input, init))
  renderAdmin(<FlowsScreen />); expandDisclosures()
  const retry = await screen.findByRole('button', { name: 'Retry' })
  fireEvent.click(await screen.findByRole('button', { name: 'Actions: Cash, September 2031' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit other source' })
  const first = within(dialog).getByRole('group', { name: 'Line 1' })
  const oldCurrency = within(first).getByRole('combobox', { name: 'Currency' })
  expect(oldCurrency).toHaveValue('GBP')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add line' }))
  const second = within(dialog).getByRole('group', { name: 'Line 2' })
  const amount = within(second).getByRole('textbox', { name: 'Amount' })
  fireEvent.change(amount, { target: { value: '45' } })
  expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
  fireEvent.submit(dialog.querySelector('form')!)
  expect(calls).toEqual([])
  fail = false
  fireEvent.click(retry)
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled())
  expect(within(second).getByRole('textbox', { name: 'Amount' })).toBe(amount)
  expect(amount).toHaveValue('45')
  expect(oldCurrency).toHaveValue('GBP')
  expect(within(second).getByRole('combobox', { name: 'Currency' })).toHaveValue('EUR')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(calls).toEqual([{ url: '/api/spending/months/2031-09/Cash', method: 'PUT', body: { items: [{ categoryId: 2, amount: 80, currency: 'GBP' }, { categoryId: 2, amount: 45, currency: 'EUR' }], base: existing.items } }]))
})

it('a genuinely empty currency list cannot submit a new line with an empty currency', async () => {
  const calls = stub()
  const real = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/admin/currencies' ? jsonResponse({ rows: [], columns: ['code'] }) : real(input, init))
  renderAdmin(<FlowsScreen />); expandDisclosures()
  const dialog = await openOther()
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'Source' }), { target: { value: 'New cash' } })
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Amount' }), { target: { value: '45' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Add a currency in “Settings”')).toBeInTheDocument()
  expect(calls).toEqual([])
})
