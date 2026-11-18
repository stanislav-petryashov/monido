import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { AccountsView } from '../../../src/pages/admin/AccountsView'
import { GoalsScreen } from '../../../src/modules/goals/GoalsScreen'
import type { Mock } from 'vitest'
import { type Answer, deferred, jsonResponse, sent, stubApi, WRITES, NO_SPENDING } from '../../helpers/http'
import { appClient, renderAdmin as renderPage, settled, testClient } from '../../helpers/render'
import { accountMenu, correctButton, header, headerAction } from '../../helpers/adminScreens'
import { makeSnapshot } from '../../helpers/snapshot'

afterEach(() => { window.history.replaceState(null, '', '/') })

describe('DataPage', () => {
  it('shows a persistent load failure with retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'boom' }, 500)))
    renderPage(<DataPage screen={GoalsScreen} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Failed to load')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('marks the dashboard snapshot stale when leaving the data section', async () => {
    stubApi({ goals: [{ rowid: 1, id: 'fire', name: 'FIRE', target: 640000 }] })
    const client = testClient()
    client.setQueryData(['snapshot'], { cached: true })
    const { unmount } = renderPage(<DataPage screen={GoalsScreen} />, { client })
    await screen.findByText('FIRE')
    expect(client.getQueryState(['snapshot'])?.isInvalidated).toBe(false)
    unmount()
    expect(client.getQueryState(['snapshot'])?.isInvalidated).toBe(true)
  })
})

describe('Accounts screen', () => {
  it('pins an open month to its original account after refetch removes it', async () => {
    const a = { rowid: 1, date: '2031-05-31', class: 'bank', name: 'A', value: 100, currency: 'EUR', member: 'Robin' }
    const tables = { assets: [a, { ...a, rowid: 2, name: 'B' }], monthly_cashflow: [] }
    const fetchMock = stubApi(tables, { answer: { 'POST *': () => jsonResponse({ error: 'missing account' }, 404) } })
    const client = testClient()
    renderPage(<DataPage screen={AccountsView} />, { client })
    fireEvent.click(await correctButton('May 2031'))
    fireEvent.change(screen.getByLabelText('Balance'), { target: { value: '123' } })
    tables.assets = tables.assets.filter(row => row.name !== 'A')
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'assets'] }) })
    await waitFor(() => expect(screen.queryByRole('button', { name: /^A / })).toBeNull())
    expect(screen.getByLabelText('Balance')).toHaveValue('123')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1))
    expect(sent(fetchMock, 'POST')[0].body).toMatchObject({ account: { name: 'A', member: 'Robin' }, balance: 123 })
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
    expect(screen.getByLabelText('Balance')).toHaveValue('123')
  })

  it('keeps a dirty account editor when a record switch is canceled', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    await accountMenu('Account settings')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft' } })
    fireEvent.click(screen.getByRole('button', { name: /Quillmark Bank/ }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Draft')
  })
  const stubAccounts = (answer: Record<string, Answer> = {}) => stubApi({
    assets: [
      { rowid: 1, date: '2031-05-31', class: 'bank', name: 'Brisaluna Bank', value: 5800, currency: 'EUR', member: 'Robin' },
      { rowid: 2, date: '2031-05-31', class: 'bank', name: 'Quillmark Bank', value: 100, currency: 'RUB', member: 'Robin' },
    ],
    monthly_cashflow: [{ rowid: 1, date: '2031-05-01', bank: 'Brisaluna Bank', member: 'Robin', active_income: 0, passive_income: 500, expense: 1350, currency: 'EUR' }],
    currencies: [{ rowid: 1, code: 'EUR' }],
    members: [{ rowid: 1, name: 'Robin' }],
  }, { answer })

  it('shows the income and expenses chart for an account that has flows', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    expect(await screen.findByRole('heading', { name: 'Income and expenses by month' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Brisaluna Bank: income and expenses by month, May 2031 – May 2031' })).toBeInTheDocument()
  })

  it('defaults a new account to the family currency and keeps an existing account currency', async () => {
    stubApi({
      assets: [{ rowid: 1, date: '2031-05-31', class: 'bank', name: 'Existing', value: 100, currency: 'EUR', member: 'Robin' }],
      currencies: [{ rowid: 1, code: 'EUR' }, { rowid: 2, code: 'USD' }],
      members: [{ rowid: 1, name: 'Robin' }], monthly_cashflow: [],
    }, { answer: { '/api/settings': () => jsonResponse({ currency: 'USD', language: 'en-US' }) } })
    renderPage(<DataPage screen={AccountsView} />)
    await accountMenu('Account settings')
    expect(await screen.findByRole('radio', { name: 'EUR' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Account' }))
    expect(await screen.findByRole('radio', { name: 'USD' })).toBeChecked()
  })

  it('offers a direct correction of the latest balance month separately from account settings', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    expect(await screen.findByRole('button', { name: 'Account actions' })).toBeInTheDocument()
    fireEvent.click(await correctButton('May 2031'))
    expect(screen.getByLabelText('Balance')).toHaveValue('5,800')
    expect(screen.getByDisplayValue('2031-05')).toBeDisabled()
  })

  it('puts “+ Account” in the page header, next to the title', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    expect(await within(header()).findByRole('button', { name: '+ Account' })).toBeInTheDocument()
  })

  it('the header\'s “+ Account” is the primary page action', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    const add = await within(header()).findByRole('button', { name: '+ Account' })
    expect(add).toHaveClass('btn--primary')
    expect(add).not.toHaveClass('btn--ghost')
  })

  it('leaves task navigation to the shell instead of duplicating a header link', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    expect(within(header()).queryByRole('link', { name: 'View on Net worth' })).toBeNull()
  })

  it('captions each account with member and currency, and marks the chosen one', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    const second = await screen.findByRole('button', { name: /Quillmark Bank/ })
    expect(within(second).getByText('Robin · RUB')).toBeInTheDocument()
    expect(second).not.toHaveAttribute('aria-current')
    fireEvent.click(second)
    expect(second).toHaveAttribute('aria-current', 'true')
  })

  it('opens with the account the address names (a link from Net worth)', async () => {
    stubAccounts()
    window.history.replaceState(null, '', `/accounts#${encodeURIComponent('Quillmark Bank|Robin')}`)
    renderPage(<DataPage screen={AccountsView} />)
    expect(await screen.findByRole('button', { name: /Quillmark Bank/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /Brisaluna Bank/ })).not.toHaveAttribute('aria-current')
    fireEvent.click(screen.getByRole('button', { name: /Brisaluna Bank/ }))
    expect(screen.getByRole('button', { name: /Brisaluna Bank/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /Quillmark Bank/ })).not.toHaveAttribute('aria-current')
  })

  it('keeps a missing explicit account unselected and uses the first for a malformed hash', async () => {
    for (const hash of [encodeURIComponent('Renamed Bank|Robin'), '%']) {
      stubAccounts()
      window.history.replaceState(null, '', `/accounts#${hash}`)
      const { unmount } = renderPage(<DataPage screen={AccountsView} />)
      const first = await screen.findByRole('button', { name: /Brisaluna Bank/ })
      if (hash === '%') expect(first).toHaveAttribute('aria-current', 'true')
      else expect(first).not.toHaveAttribute('aria-current')
      expect(screen.queryByRole('alert')).toBeNull()
      unmount()
    }
  })

  it('lists non-bank accounts under their type', async () => {
    stubApi({
      assets: [{ rowid: 1, date: '2031-05-31', class: 'broker', name: 'Broker', value: 28000, currency: 'RUB', member: 'Shared' }],
    })
    renderPage(<DataPage screen={AccountsView} />)
    expect(await screen.findByText('Shared · RUB')).toBeInTheDocument()
    expect(screen.getByText('Brokerage accounts')).toBeInTheDocument()
  })

  it('heads the account with its tags and keeps settings, close and delete in the «···» menu', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    await screen.findByRole('button', { name: /Brisaluna Bank/ })
    expect(screen.getByRole('heading', { level: 2, name: 'Brisaluna Bank' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'About the account' })).getAllByRole('listitem').map(li => li.textContent)).toEqual(['RRobin', 'Bank', 'EUR'])
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Account actions' }))
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Account settings', 'Close account', 'Delete'])
  })

  it('“Close account” explains that the wizard closes it and opens the wizard on confirm', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    await accountMenu('Close account')
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('mark “Brisaluna Bank” as closed')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open the wizard' }))
    await waitFor(() => expect(window.location.pathname).toBe('/close'))
  })

  it('shows the last 12 months and expands to all', async () => {
    const assets = Array.from({ length: 36 }, (_, i) => {
      const d = new Date(Date.UTC(2029, i + 1, 0))
      return { rowid: i + 1, date: d.toISOString().slice(0, 10), class: 'bank', name: 'Brisaluna Bank', value: 100 + i, currency: 'EUR', member: 'Robin' }
    })
    stubApi({ assets, monthly_cashflow: [], currencies: [{ rowid: 1, code: 'EUR' }], members: [{ rowid: 1, name: 'Robin' }] })
    renderPage(<DataPage screen={AccountsView} />)
    const button = await screen.findByRole('button', { name: 'Show all 36 months' })
    const monthRows = () => within(screen.getByRole('table')).getAllByRole('button', { name: /^Correct / })
    expect(monthRows()).toHaveLength(12)
    button.focus()
    fireEvent.click(button)
    expect(monthRows()).toHaveLength(36)
    // the same button stays, keeps focus and folds the list back
    const fewer = screen.getByRole('button', { name: 'Show the last 12 months' })
    expect(fewer).toBe(button)
    expect(document.activeElement).toBe(fewer)
    fireEvent.click(fewer)
    expect(monthRows()).toHaveLength(12)
  })

  it('keeps every sum neutral', async () => {
    stubAccounts()
    const { container } = renderPage(<DataPage screen={AccountsView} />)
    await correctButton('May 2031')
    expect(container.querySelector('.td-pos, .td-neg')).toBeNull()
  })

  it('“Correct” on a row opens the month form with that month', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await correctButton('May 2031'))
    expect(screen.getByLabelText('Balance')).toHaveValue('5,800')
    expect(screen.getByLabelText('Month')).toBeDisabled()
  })

  it('the month form of a broker account says what its flows are; a bank account\'s does not', async () => {
    stubApi({
      assets: [{ rowid: 1, date: '2031-05-31', class: 'broker', name: 'Broker', value: 28000, currency: 'RUB', member: 'Shared' }],
      monthly_cashflow: [{ rowid: 1, date: '2031-05-01', bank: 'Broker', member: 'Shared', active_income: 0, passive_income: 120, expense: 5, currency: 'RUB' }],
    })
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await correctButton('May 2031'))
    expect(screen.getByText(/Deposits, trades and price changes are balance only/)).toBeInTheDocument()
  })

  it('the month form of a broker account edits its deposits: shown as stored, sent signed, cleared to not known', async () => {
    const fetchMock = stubApi({
      assets: [{ rowid: 1, date: '2031-05-31', class: 'broker', name: 'Broker', value: 28000, currency: 'RUB', member: 'Shared' }],
      monthly_cashflow: [{ rowid: 1, date: '2031-05-01', bank: 'Broker', member: 'Shared', active_income: 0, passive_income: 120, expense: 5, currency: 'RUB' }],
      account_transfers: [{ rowid: 1, date: '2031-05-01', name: 'Broker', member: 'Shared', amount: 500, currency: 'RUB' }],
    })
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await correctButton('May 2031'))
    const field = await screen.findByLabelText('Put in (+) or taken out (−) this month')
    await waitFor(() => expect(field).toHaveValue('500'))
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'POST').find(r => r.url === '/api/accounts/month')?.body).toMatchObject({ deposited: null, expected: { deposited: 500 } }))
  })

  it('a broker account shows its yearly return over the months its deposits were entered; a bank account does not', async () => {
    const months = ['2030-11', '2030-12', '2031-01', '2031-02', '2031-03', '2031-04', '2031-05']
    stubApi({
      assets: months.map((m, i) => ({ rowid: i + 1, date: `${m}-28`, class: 'broker', name: 'Broker', value: 1000 + (i ? 500 : 0) + i * 10, currency: 'RUB', member: 'Shared' })),
      monthly_cashflow: [],
      account_transfers: months.slice(1).map((m, i) => ({ rowid: i + 1, date: `${m}-01`, name: 'Broker', member: 'Shared', amount: i === 0 ? 500 : 0, currency: 'RUB' })),
    })
    renderPage(<DataPage screen={AccountsView} />)
    const cell = (await screen.findByText('Return per year')).closest('div') as HTMLElement
    expect(within(cell.parentElement as HTMLElement).getByText(/earned \+₽60 since December 2030/)).toBeInTheDocument()
  })

  it('the month form of a bank account has no broker note', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await correctButton('May 2031'))
    expect(screen.queryByText(/balance only/)).toBeNull()
    expect(screen.queryByLabelText(/Put in/)).toBeNull()
    expect(screen.queryByText('Return per year')).toBeNull()
  })

  it('a stored three-decimal balance saves unchanged from the month form', async () => {
    const fetchMock = stubApi({
      assets: [{ rowid: 1, date: '2031-05-31', class: 'bank', name: 'Brisaluna Bank', value: 1234.125, currency: 'EUR', member: 'Robin' }],
      monthly_cashflow: [{ rowid: 1, date: '2031-05-01', bank: 'Brisaluna Bank', member: 'Robin', active_income: 0, passive_income: 500, expense: 1350, currency: 'EUR' }],
      currencies: [{ rowid: 1, code: 'EUR' }], members: [{ rowid: 1, name: 'Robin' }],
    })
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await correctButton('May 2031'))
    expect(screen.getByLabelText('Balance')).not.toHaveAttribute('aria-invalid')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const put = () => sent(fetchMock, 'POST').find(r => r.url === '/api/accounts/month')
    await waitFor(() => expect(put()).toBeDefined())
    expect(put()?.body).toMatchObject({ balance: 1234.125 })
  })

  it('adds months only through the wizard: no “+ Add month”, and a month cannot be deleted here', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    expect(await correctButton('May 2031')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Actions: May/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Add month' })).toBeNull()
    // the sidebar has Close month; the history header does not repeat it
    expect(screen.queryByRole('link', { name: 'Close month' })).toBeNull()
  })

  it('the new-account form names its fields and closes on a text “Cancel”', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await within(header()).findByRole('button', { name: '+ Account' }))
    const dialog = screen.getByRole('dialog', { name: 'New account' })
    expect(within(dialog).getByRole('combobox', { name: 'Name' })).toHaveFocus()
    expect(within(dialog).getByRole('radiogroup', { name: 'Member' })).toBeInTheDocument()
    expect(within(within(dialog).getByRole('radiogroup', { name: 'Type' })).getAllByRole('radio')).toHaveLength(4)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('native close asks before discarding a new account and writes nothing after discard', async () => {
    const fetchMock = stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await within(header()).findByRole('button', { name: '+ Account' }))
    const dialog = screen.getByRole('dialog', { name: 'New account' }) as HTMLDialogElement
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Name' }), { target: { value: 'Pine Bank' } })
    act(() => dialog.close())
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(sent(fetchMock, 'POST')).toHaveLength(0)
  })

  it('an account without a name says what is missing and keeps the dialog', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await within(header()).findByRole('button', { name: '+ Account' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New account' })).getByRole('button', { name: 'Create' }))
    const name = within(screen.getByRole('dialog', { name: 'New account' })).getByRole('combobox', { name: 'Name' })
    expect(name).toHaveAccessibleDescription('Enter an account name')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'New account' })).toBeInTheDocument()
  })

  it('requires an owner when the members catalog is empty', async () => {
    const api = stubApi({ assets: [], monthly_cashflow: [], members: [], currencies: [{ rowid: 1, code: 'USD' }] })
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await within(header()).findByRole('button', { name: '+ Account' }))
    const dialog = screen.getByRole('dialog', { name: 'New account' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Name' }), { target: { value: 'Cash' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    const owner = within(dialog).getByRole('radiogroup', { name: 'Member' })
    expect(owner).toHaveAttribute('aria-invalid', 'true')
    expect(owner).toHaveAccessibleDescription('Select an owner')
    expect(owner).toHaveFocus()
    expect(sent(api, 'POST')).toHaveLength(0)
  })

  it('a failed create keeps the dialog open with what was typed and says what failed', async () => {
    stubAccounts({
      '/api/month-close': () => jsonResponse({ lastClosed: { month: '2031-05', reopenable: false } }),
      'POST *': () => jsonResponse({ error: 'boom' }, 500),
    })
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await within(header()).findByRole('button', { name: '+ Account' }))
    const dialog = screen.getByRole('dialog', { name: 'New account' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Name' }), { target: { value: 'Pine Bank' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByRole('dialog', { name: 'New account' })).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: 'Name' })).toHaveValue('Pine Bank')
  })

  it('with no accounts says so and still offers to add one', async () => {
    stubApi()
    renderPage(<DataPage screen={AccountsView} />)
    expect(await screen.findByText('No accounts yet')).toBeInTheDocument()
    expect(screen.getByText('Add your first account: “+ Account”.')).toBeInTheDocument()
    expect(screen.queryByText(/from the list on the left/)).toBeNull()
    fireEvent.click(within(header()).getByRole('button', { name: '+ Account' }))
    expect(screen.getByRole('combobox', { name: 'Name' })).toBeInTheDocument()
  })
})

describe('Accounts screen and the closed months', () => {
  const assets = [
    { rowid: 1, date: '2031-05-31', class: 'bank', name: 'Quillmark Bank', value: 100, currency: 'RUB', member: 'Robin' },
    { rowid: 2, date: '2031-06-30', class: 'bank', name: 'Quillmark Bank', value: 120, currency: 'RUB', member: 'Robin' },
  ]
  /** lastClosed: the last closed month in the wizard's answer; calls: the write requests */
  function stub(lastClosed: string | null) {
    const calls: { url: string; method: string; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method && init.method !== 'GET') { calls.push({ url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : null }); return jsonResponse({ ok: true }) }
      if (url === '/api/month-close') return jsonResponse({ lastClosed: lastClosed ? { month: lastClosed, reopenable: false } : null })
      if (url === '/api/spending') return jsonResponse(NO_SPENDING)
      if (url === '/api/admin/assets') return jsonResponse({ rows: assets, columns: [] })
      if (url === '/api/admin/currencies') return jsonResponse({ rows: [{ rowid: 1, code: 'RUB' }] })
      if (url === '/api/admin/members') return jsonResponse({ rows: [{ rowid: 1, name: 'Robin' }] })
      return jsonResponse({ rows: [], columns: [] })
    }))
    return calls
  }

  it('gives a new account a zero balance in the last closed month, so the wizard asks for it next', async () => {
    const calls = stub('2031-05')
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await headerAction('+ Account'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Name' }), { target: { value: 'Savings' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ url: '/api/admin/assets', method: 'POST', body: { date: '2031-05-31', name: 'Savings', value: 0 } })
  })

  it('sends the very first account to the wizard instead of writing into a month that is not closed', async () => {
    const calls = stub(null)
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await headerAction('+ Account'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Name' }), { target: { value: 'First' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText(/The first account is added in the “Close month” wizard/)).toBeInTheDocument()
    expect(calls).toEqual([])
  })

  it('marks a month the dashboard does not count yet', async () => {
    stub('2031-05')
    renderPage(<DataPage screen={AccountsView} />)
    const row = (await screen.findByText('Jun 2031')).closest('tr') as HTMLElement
    expect(within(row).getByText('not closed: the dashboard does not count it')).toBeInTheDocument()
    expect(within(screen.getByText('May 2031').closest('tr') as HTMLElement).queryByText(/not closed/)).toBeNull()
  })

  it('Enter in the month form saves it and Escape closes it', async () => {
    const calls = stub('2031-05')
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await correctButton('May 2031'))
    const balance = screen.getByLabelText('Balance')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button')
    fireEvent.keyDown(balance, { key: 'Escape' })
    expect(screen.queryByLabelText('Balance')).toBeNull()
    fireEvent.click(await correctButton('May 2031'))
    // jsdom has no implicit submission: the form's submit event is what Enter fires in a browser
    const form = screen.getByLabelText('Balance').closest('form') as HTMLFormElement
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit')
    fireEvent.submit(form)
    await waitFor(() => expect(calls.some(c => c.url === '/api/accounts/month' && c.method === 'POST')).toBe(true))
  })

  it('Escape cancels the account edit form, Enter in it saves', async () => {
    const calls = stub('2031-05')
    renderPage(<DataPage screen={AccountsView} />)
    await accountMenu('Account settings')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    await accountMenu('Account settings')
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Quillmark Bank 2' } })
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form') as HTMLFormElement)
    await waitFor(() => expect(calls.some(c => c.url === '/api/accounts/update')).toBe(true))
  })

  it('an account saved with an empty name says so under the field and sends nothing', async () => {
    const calls = stub('2031-05')
    renderPage(<DataPage screen={AccountsView} />)
    await accountMenu('Account settings')
    const name = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(name, { target: { value: '  ' } })
    fireEvent.submit(name.closest('form') as HTMLFormElement)
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'))
    expect(name).toHaveFocus()
    expect(calls.some(c => c.url === '/api/accounts/update')).toBe(false)
  })

  it('suggests the account names already known in the new account name field', async () => {
    stub('2031-05')
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await headerAction('+ Account'))
    const list = screen.getByRole('combobox', { name: 'Name' }).getAttribute('list')
    expect(list).toBeTruthy()
    const options = [...document.querySelectorAll(`datalist#${CSS.escape(list as string)} option`)].map(o => o.getAttribute('value'))
    expect(options).toContain('Quillmark Bank')
  })

  it('sends metadata and identity together so dependencies follow the rename', async () => {
    const calls = stub('2031-05')
    renderPage(<DataPage screen={AccountsView} />)
    await accountMenu('Account settings')
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Quillmark Bank salary ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some(c => c.url === '/api/accounts/update')).toBe(true))
    expect(calls.find(c => c.url === '/api/accounts/update')?.body).toEqual({
      from: { name: 'Quillmark Bank', member: 'Robin' }, values: { name: 'Quillmark Bank salary', member: 'Robin', currency: 'RUB', class: 'bank' },
    })
  })
})

describe('Data screens and the query cache', () => {
  const account = { rowid: 1, date: '2031-05-31', class: 'bank', name: 'Quillmark Bank', value: 100, currency: 'RUB', member: 'Robin' }
  const callsTo = (fetchMock: Mock, url: string) => sent(fetchMock).filter(r => r.url === url).length

  it('reads the accounts afresh when the screen is opened again, despite the five-minute cache', async () => {
    const fetchMock = stubApi({ assets: [account], currencies: [{ rowid: 1, code: 'RUB' }], members: [{ rowid: 1, name: 'Robin' }] })
    const client = appClient()
    const first = renderPage(<DataPage screen={AccountsView} />, { client })
    await correctButton('May 2031')
    await settled(client)
    first.unmount()
    renderPage(<DataPage screen={AccountsView} />, { client })
    await correctButton('May 2031')
    await settled(client)
    expect(callsTo(fetchMock, '/api/admin/assets')).toBe(2)
  })

  // only the screen's own read fails: the app-wide reads (modules) keep the app's retry, which is not what is checked here
  const failAssets = { '/api/admin/assets': () => jsonResponse({ error: 'boom' }, 500) }

  it('a failed load stays visible once and retry reads only the failed table', async () => {
    let fail = true
    const fetchMock = stubApi({}, { answer: { '/api/admin/assets': (_init, next) => fail ? jsonResponse({ error: 'boom' }, 500) : next() } })
    const client = appClient()
    renderPage(<DataPage screen={AccountsView} />, { client })
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load')
    await settled(client)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    const before = sent(fetchMock, 'GET').length
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(sent(fetchMock, 'GET').slice(before).map(r => r.url)).toEqual(['/api/admin/assets'])
    expect(sent(fetchMock, ['POST', 'PUT'])).toHaveLength(0)
  })

  it('a failed read remains visible on remount until recovery', async () => {
    stubApi({}, { answer: failAssets })
    const client = appClient()
    const first = renderPage(<DataPage screen={AccountsView} />, { client })
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
    await settled(client)
    first.unmount()
    stubApi({ assets: [account] })
    renderPage(<DataPage screen={AccountsView} />, { client })
    expect(await screen.findByRole('button', { name: /Quillmark Bank/ })).toBeInTheDocument()
    await settled(client)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a new account appears in the list as soon as it is saved', async () => {
    const assets: Record<string, unknown>[] = [account]
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') { assets.push({ rowid: 2, ...JSON.parse(String(init.body)) }); return jsonResponse({ ok: true }) }
      if (url === '/api/month-close') return jsonResponse({ lastClosed: { month: '2031-05', reopenable: false } })
      if (url === '/api/spending') return jsonResponse(NO_SPENDING)
      if (url === '/api/admin/assets') return jsonResponse({ rows: assets, columns: [] })
      if (url === '/api/admin/currencies') return jsonResponse({ rows: [{ rowid: 1, code: 'RUB' }] })
      if (url === '/api/admin/members') return jsonResponse({ rows: [{ rowid: 1, name: 'Robin' }] })
      return jsonResponse({ rows: [], columns: [] })
    }))
    renderPage(<DataPage screen={AccountsView} />, { client: appClient() })
    fireEvent.click(await headerAction('+ Account'))
    await screen.findByRole('radio', { name: 'Robin' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Name' }), { target: { value: 'Savings' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    const added = await screen.findByRole('button', { name: /^Savings/ })
    expect(added).toHaveAttribute('aria-current', 'true')
  })
})

describe('Accounts screen after a failed atomic write', () => {
  it('retains typed monthly values after failure and sends one compound request', async () => {
    const fetchMock = stubApi({ assets: [{ rowid: 1, date: '2031-05-31', class: 'bank', name: 'Bank', value: 100, currency: 'USD', member: 'Robin' }] }, { answer: { 'POST /api/accounts/month': () => jsonResponse({ error: 'boom' }, 500) } })
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await correctButton('May 2031'))
    fireEvent.change(screen.getByLabelText('Balance'), { target: { value: '222' } })
    fireEvent.change(screen.getByLabelText('Active income'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByLabelText('Balance')).toHaveValue('222')
    expect(screen.getByLabelText('Active income')).toHaveValue('50')
    expect(sent(fetchMock, WRITES)).toEqual([{ method: 'POST', url: '/api/accounts/month', body: { account: { name: 'Bank', member: 'Robin' }, month: '2031-05', balance: 222, active: 50, passive: 0, expense: 0,
      // the month as the form opened it: a balance, no flow row
      expected: { balance: 100, active: null, passive: null, expense: null } } }])
  })

  it('sends one delete request and keeps the account selected on failure', async () => {
    const fetchMock = stubApi({ assets: [{ rowid: 1, date: '2031-05-31', class: 'bank', name: 'Bank', value: 100, currency: 'USD', member: 'Robin' }] }, { answer: { 'POST /api/accounts/delete': () => jsonResponse({ error: 'boom' }, 500) } })
    renderPage(<DataPage screen={AccountsView} />)
    await accountMenu('Delete')
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByRole('button', { name: /^Bank/ })).toHaveAttribute('aria-current', 'true')
    expect(sent(fetchMock, WRITES)).toEqual([{ method: 'POST', url: '/api/accounts/delete', body: { name: 'Bank', member: 'Robin' } }])
  })

  it('retains the typed rename and cached account after failure', async () => {
    const response = deferred<Response>()
    const fetchMock = stubApi({
      assets: [{ rowid: 1, date: '2031-05-31', class: 'bank', name: 'Quillmark Bank', value: 100, currency: 'RUB', member: 'Robin' }],
      currencies: [{ rowid: 1, code: 'RUB' }], members: [{ rowid: 1, name: 'Robin' }],
    }, { answer: { 'POST /api/accounts/update': () => response.promise } })
    const client = testClient()
    renderPage(<DataPage screen={AccountsView} />, { client })
    await accountMenu('Account settings')
    await settled(client)
    const reads = sent(fetchMock).filter(r => r.url === '/api/admin/assets').length
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Pine Bank' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeDisabled()
    expect(screen.getByRole('status')).not.toHaveTextContent('Account saved')
    expect(sent(fetchMock).filter(r => r.url === '/api/admin/assets')).toHaveLength(reads)
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form') as HTMLFormElement)
    expect(sent(fetchMock, 'POST')).toHaveLength(1)
    await act(async () => { response.resolve(jsonResponse({ error: 'boom' }, 500)) })
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Pine Bank')
    expect(screen.getByRole('button', { name: /Quillmark Bank/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pine Bank/ })).toBeNull()
    expect(sent(fetchMock, WRITES)).toEqual([{ method: 'POST', url: '/api/accounts/update', body: { from: { name: 'Quillmark Bank', member: 'Robin' }, values: { name: 'Pine Bank', member: 'Robin', currency: 'RUB', class: 'bank' } } }])
    // a failed write reads the rows once more (they may have changed elsewhere); the account is still the stored one
    expect(sent(fetchMock).filter(r => r.url === '/api/admin/assets')).toHaveLength(reads + 1)
  })
})

describe('Accounts screen: edits that would lose data', () => {
  const writes = (fetchMock: ReturnType<typeof stubApi>) => sent(fetchMock, WRITES)

  it('a cleared balance of a month that has one is refused, not written as 0', async () => {
    const fetchMock = stubApi({
      assets: [{ rowid: 1, date: '2031-05-31', class: 'bank', name: 'Brisaluna Bank', value: 5800, currency: 'EUR', member: 'Robin' }],
      monthly_cashflow: [{ rowid: 1, date: '2031-05-01', bank: 'Brisaluna Bank', member: 'Robin', active_income: 0, passive_income: 500, expense: 1350, currency: 'EUR' }],
      currencies: [{ rowid: 1, code: 'EUR' }], members: [{ rowid: 1, name: 'Robin' }],
    })
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await correctButton('May 2031'))
    fireEvent.change(screen.getByLabelText('Balance'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the balance: an empty field is not saved as zero')
    expect(writes(fetchMock)).toEqual([])
    expect(screen.getByLabelText('Balance')).toBeInTheDocument()
  })
})

describe('Accounts screen account links', () => {
  const assets = [
    { rowid: 1, date: '2031-05-31', class: 'bank', name: 'A|B', member: 'C', value: 10, currency: 'USD' },
    { rowid: 2, date: '2031-05-31', class: 'bank', name: 'A', member: 'B|C', value: 20, currency: 'USD' },
  ]

  it('refuses ambiguous legacy links', async () => {
    window.history.replaceState(null, '', '/accounts#A%7CB%7CC')
    stubApi({ assets })
    renderPage(<DataPage screen={AccountsView} />)
    const list = await screen.findByRole('group', { name: 'Accounts' })
    await waitFor(() => expect(within(list).getAllByRole('button', { name: /USD/ })).toHaveLength(2))
    expect(list.querySelector('[aria-current="true"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Account actions' })).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: /A\|B/ }))
    expect(await screen.findByRole('button', { name: 'Account actions' })).toBeInTheDocument()
  })

  it.each(['A|B|C', '["A|B","C"]'])('opens a unique account from %s', async key => {
    window.history.replaceState(null, '', `/accounts#${encodeURIComponent(key)}`)
    stubApi({ assets: [assets[0]] })
    renderPage(<DataPage screen={AccountsView} />)
    expect(await screen.findByRole('button', { name: /A\|B/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Account actions' })).toBeInTheDocument()
  })

  it('keeps pipe-colliding identities distinct', async () => {
    const fetchMock = stubApi({ assets })
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await screen.findByRole('button', { name: /A\|B/ }))
    fireEvent.click(await correctButton('May 2031'))
    expect(screen.getByLabelText('Balance')).toHaveValue('10')
    fireEvent.change(screen.getByLabelText('Balance'), { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, WRITES)).toHaveLength(1))
    expect(sent(fetchMock, WRITES)[0]).toMatchObject({ url: '/api/accounts/month', body: { account: { name: 'A|B', member: 'C' }, balance: 15 } })
  })
})


describe('Accounts month editor', () => {
  const account = { rowid: 1, date: '2031-05-31', class: 'bank', name: 'Bank', value: 100, currency: 'USD', member: 'Robin' }
  const flow = { rowid: 1, date: '2031-05-01', bank: 'Bank', member: 'Robin', active_income: 20, passive_income: 10, expense: 5, currency: 'USD' }

  it('while income and expenses are not tracked the month editor is balance-only, as in Close month', async () => {
    stubApi({ assets: [account], monthly_cashflow: [flow] }, { answer: { '/api/snapshot': () => jsonResponse(makeSnapshot({ trackFlows: false })) } })
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await correctButton('May 2031'))
    expect(screen.getByLabelText('Balance')).toHaveValue('100')
    await waitFor(() => expect(screen.queryByLabelText('Expense')).toBeNull())
    expect(screen.queryByLabelText('Active income')).toBeNull()
  })

  it('a flow-only month opens with an empty balance: correcting its expense sends no balance, not a typed-for-you zero', async () => {
    const fetchMock = stubApi({ assets: [account], monthly_cashflow: [{ ...flow, date: '2031-04-01' }] }, { answer: { 'POST /api/accounts/month': () => jsonResponse({ saved: true }) } })
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await correctButton('Apr 2031'))
    expect(screen.getByLabelText('Balance')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Expense'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, WRITES)).toHaveLength(1))
    expect(sent(fetchMock, WRITES)[0]).toMatchObject({ url: '/api/accounts/month', body: { month: '2031-04', balance: null, expense: 7 } })
  })
})

describe('Accounts screen: the grouped list and the head', () => {
  const row = (rowid: number, date: string, name: string, member: string, value: number, cls = 'bank', currency = 'USD') => ({ rowid, date, class: cls, name, value, currency, member })
  const lastClosed = (month: string) => ({ '/api/month-close': () => jsonResponse({ lastClosed: { month, reopenable: false } }) })
  const tables = {
    assets: [
      row(1, '2031-04-30', 'Harborline Checking', 'Ryan', 8800), row(2, '2031-05-31', 'Harborline Checking', 'Ryan', 10520),
      // an open month's row: the list and the head keep the last closed month's balance, the one the change is of
      row(7, '2031-06-30', 'Harborline Checking', 'Ryan', 11000),
      row(3, '2031-04-30', 'Rheinau Bank', 'Annika', 13670, 'bank', 'EUR'), row(4, '2031-05-31', 'Rheinau Bank', 'Annika', 13880, 'bank', 'EUR'),
      row(5, '2031-05-31', 'Kestrel Brokerage', 'Ryan', 35900, 'broker'),
      row(6, '2031-03-31', 'Old Savings', 'Annika', 500),
    ],
    members: [{ rowid: 1, name: 'Annika' }, { rowid: 2, name: 'Ryan' }],
  }
  const items = () => [...document.querySelectorAll('.record-row')].map(b => b.querySelector('.record-row__name')!.textContent)

  it('owner chips sit beside search and filter the list; a skipped account is not taken for closed', async () => {
    stubApi(tables, { answer: lastClosed('2031-05') })
    renderPage(<DataPage screen={AccountsView} />)
    const chips = await screen.findByRole('group', { name: 'Whose accounts' })
    expect(within(header()).getByRole('button', { name: '+ Account' })).toBeInTheDocument()
    expect(chips.closest('.acc-list')).not.toBeNull()
    expect(within(chips).getAllByRole('button').map(b => b.textContent)).toEqual(['All · 4', 'AAnnika · 2', 'RRyan · 2'])
    expect(within(chips).getByRole('button', { name: 'All · 4' })).toHaveAttribute('aria-pressed', 'true')
    // without the snapshot's base values the order within a type is the owners' and the names'
    await waitFor(() => expect(items()).toEqual(['Old Savings', 'Rheinau Bank', 'Harborline Checking', 'Kestrel Brokerage']))
    expect(screen.queryByText(/^Closed/)).toBeNull()
    fireEvent.click(within(chips).getByRole('button', { name: /Ryan/ }))
    expect(items()).toEqual(['Harborline Checking', 'Kestrel Brokerage'])
  })

  it('the owner filter goes back to everyone when that owner has no account left', async () => {
    const own = { ...tables, assets: [...tables.assets] }
    stubApi(own, { answer: lastClosed('2031-05') })
    const client = testClient()
    renderPage(<DataPage screen={AccountsView} />, { client })
    const chips = await screen.findByRole('group', { name: 'Whose accounts' })
    fireEvent.click(within(chips).getByRole('button', { name: /Ryan/ }))
    expect(items()).toEqual(['Harborline Checking', 'Kestrel Brokerage'])
    own.assets = own.assets.filter(r => r.member !== 'Ryan')
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'assets'] }) })
    await waitFor(() => expect(items()).toEqual(['Old Savings', 'Rheinau Bank']))
  })

  it('«Correct <month>» in the head brings the month editor into view with the cursor in the balance', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      stubApi(tables, { answer: lastClosed('2031-05') })
      renderPage(<DataPage screen={AccountsView} />)
      fireEvent.click(await screen.findByRole('button', { name: /Harborline Checking/ }))
      fireEvent.click(await correctButton('May 2031'))
      const balance = await screen.findByLabelText('Balance')
      expect(balance).toHaveFocus()
      expect(balance.closest('form')).not.toBeNull()
      expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }))
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  it('groups by type with the type\'s tone; a row shows the month\'s signed change in its currency', async () => {
    stubApi(tables, { answer: lastClosed('2031-05') })
    const { container } = renderPage(<DataPage screen={AccountsView} />)
    await waitFor(() => expect(items()).toHaveLength(4))
    const groups = [...container.querySelectorAll('.acc-group__title')]
    expect(groups.map(g => g.textContent)).toEqual(['Bank accounts', 'Brokerage accounts'])
    expect(groups[0].querySelector('.asset-tone--bk')).not.toBeNull()
    expect(groups[1].querySelector('.asset-tone--br')).not.toBeNull()
    const harbor = screen.getByRole('button', { name: /Harborline Checking/ })
    expect(within(harbor).getByText('+$1,720 this month')).not.toHaveClass('asset-up')
    expect(within(harbor).getByText('$10,520')).toBeInTheDocument()
    fireEvent.click(harbor)
    // the KPI strip's balance is the same month's
    expect(await screen.findByText('Balance · May 2031')).toBeInTheDocument()
    expect(screen.getByText('Balance · May 2031').nextElementSibling).toHaveTextContent('$10,520')
    expect(within(screen.getByRole('button', { name: /Rheinau Bank/ })).getByText('+€210 this month')).toBeInTheDocument()
  })

  const snapshotAccounts = [
    { name: 'Harborline Checking', member: 'Ryan', class: 'bank' as const, currency: 'USD', value: 10520, valueBase: 10520 },
    { name: 'Rheinau Bank', member: 'Annika', class: 'bank' as const, currency: 'EUR', value: 13880, valueBase: 15993 },
    { name: 'Old Savings', member: 'Annika', class: 'bank' as const, currency: 'RUB', value: 500, valueBase: null },
    { name: 'Kestrel Brokerage', member: 'Ryan', class: 'broker' as const, currency: 'USD', value: 35900, valueBase: 35900 },
  ]
  const withSnapshot = (date: string) => stubApi(tables, { answer: { ...lastClosed('2031-05'), '/api/snapshot': () =>
    jsonResponse(makeSnapshot({ capital: { ...makeSnapshot().capital!, date, accounts: snapshotAccounts } })) } })

  it('a snapshot of another month gives no base equivalent and no share: they would mix two months', async () => {
    withSnapshot('2031-06-30')
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await screen.findByRole('button', { name: /Rheinau Bank/ }))
    expect(await screen.findByText('Balance · May 2031')).toBeInTheDocument()
    expect(screen.getByText('Balance · May 2031').parentElement).toHaveTextContent('at the month end')
    expect(screen.queryByText(/at the rate of/)).toBeNull()
    expect(screen.getByText('Share of assets').nextElementSibling).toHaveTextContent('—')
  })

  it('subtotals each group in the snapshot currency', async () => {
    withSnapshot('2031-05-31')
    const { container } = renderPage(<DataPage screen={AccountsView} />)
    // an account without a rate is named beside the subtotal, not counted as 0 silently
    await waitFor(() => expect([...container.querySelectorAll('.acc-group__hd .num')].map(n => n.textContent)).toEqual(['$26,513 · without a rate: 1 · not counted: 1 with an older balance', '$35,900']))
    // an account whose newest balance is older than the last closed month names that month
    expect(within(screen.getByRole('button', { name: /Old Savings/ })).getByText('Annika · USD · on Mar 2031')).toBeInTheDocument()
    // the larger bank account takes the base tone, the smaller the next one
    fireEvent.click(screen.getByRole('button', { name: /Harborline Checking/ }))
    expect(container.querySelector('.acc-head .asset-tone--bk-2')).not.toBeNull()
    // the KPI strip: a foreign account in the snapshot currency at the snapshot's rate of the same month, the share of its assets
    fireEvent.click(screen.getByRole('button', { name: /Rheinau Bank/ }))
    expect(await screen.findByText('≈ $15,993 at the rate of May 31, 2031')).toBeInTheDocument()
    expect(screen.getByText('Share of assets').nextElementSibling).toHaveTextContent('8.7%')
  })

  it('«Correct <month>» corrects the last closed month, and only when the account has a balance there', async () => {
    stubApi(tables, { answer: lastClosed('2031-05') })
    renderPage(<DataPage screen={AccountsView} />)
    // the first account has no May balance: no correction, the menu still offers closing it in the wizard
    expect(await screen.findByRole('heading', { level: 2, name: 'Old Savings' })).toBeInTheDocument()
    await screen.findByRole('button', { name: 'Account actions' })
    expect(screen.queryByRole('button', { name: 'Correct May 2031' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Account actions' }))
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Account settings', 'Close account', 'Delete'])
    fireEvent.click(screen.getByRole('button', { name: 'Account actions' }))
    fireEvent.click(screen.getByRole('button', { name: /Rheinau Bank/ }))
    expect(screen.getByRole('button', { name: /Rheinau Bank/ })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(await correctButton('May 2031'))
    expect(screen.getByLabelText('Balance')).toHaveValue('13,880')
  })
})

it('accounts failed first read offers retry instead of an empty list', async () => {
  let fail = true
  stubApi({}, { answer: { 'GET /api/admin/assets': (_init, next) => fail ? jsonResponse({}, 503) : next() } })
  renderPage(<DataPage screen={AccountsView} />)
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  expect(screen.queryByText(/add your first account/i)).not.toBeInTheDocument()
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument())
})

it('generic table failed first read offers retry without an empty state', async () => {
  let fail = true
  stubApi({}, { answer: { 'GET /api/admin/goals': (_init, next) => fail ? jsonResponse({}, 503) : next() } })
  renderPage(<DataPage screen={GoalsScreen} />)
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument())
})

it('observes the account pane while its initial read is pending', async () => {
  const gate = deferred()
  const observe = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    observe = observe
    disconnect = vi.fn()
  })
  stubApi({}, { answer: { 'GET /api/admin/assets': async (_init, next) => { await gate.promise; return next() } } })
  renderPage(<DataPage screen={AccountsView} />)
  await waitFor(() => expect(observe).toHaveBeenCalledTimes(1))
  expect(observe.mock.calls[0][0]).toHaveClass('acc-split')
  gate.resolve()
})
