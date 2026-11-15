import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { typeText } from '../../helpers/adminScreens'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { MonthCloseView } from '../../../src/pages/admin/MonthCloseView'
import { fmtMonth } from '../../../src/lib/formatters'
import { useMonthClose } from '../../../src/pages/admin/useMonthClose'
import { deferred, jsonResponse } from '../../helpers/http'
import { ru, withLanguage } from '../../helpers/i18n'
import { resetAuth } from '../../../src/lib/authState'
import { renderAdmin, stubPrivacyOn, testClient } from '../../helpers/render'
import { base, renderScreen, stubState, closable } from '../../helpers/monthClose'

afterEach(() => { act(() => { resetAuth() }) })

describe('Month-close wizard', () => {
  it('lets “Close” be pressed while a save started by leaving a field is still running', async () => {
    const ready = { ...base, problems: [], rows: base.rows.map(r => ({ ...r, balance: 1, active: 0, passive: 0, expense: 0 })) }
    stubState(ready, () => new Promise(() => {}) as never)
    renderScreen()
    const field = await screen.findByLabelText('Expense: Quillmark Bank')
    fireEvent.change(field, { target: { value: '7' } })
    fireEvent.blur(field)
    expect(closable(screen.getByRole('button', { name: 'Close June 2031' }))).toBe(true)
  })

  it('offers to bring back accounts that earlier months had and this one lacks', async () => {
    stubState({ ...base, suggested: [{ name: 'Broker', member: 'Shared', currency: 'RUB', class: 'broker' }] }, () => base)
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Add account: Broker · Shared' }))
    expect(screen.getByLabelText('Balance: Broker')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add account: Broker · Shared' })).toBeNull()
  })

  it('warns that rows already stored for this month will be replaced on closing', async () => {
    stubState({ ...base, strayRows: 2 })
    renderScreen()
    expect(await screen.findByText(/This month already has 2 entries that were not made through the wizard/)).toBeInTheDocument()
  })

  it('puts “Reopen” right under the queue and marks the waiting months', async () => {
    stubState({ ...base, lastClosed: { month: '2031-05', reopenable: true } })
    renderScreen()
    const queue = await screen.findByRole('list', { name: 'Month queue' })
    expect(within(queue).getAllByRole('listitem')[1]).toHaveTextContent('July 2031 · waits in the queue')
    const undo = screen.getByRole('button', { name: 'Reopen May 2031' })
    expect(queue.compareDocumentPosition(undo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(undo.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('marks an account as closing from its menu and can undo it', async () => {
    stubState(base, () => base)
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Deposit' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Account closed this month' }))
    expect(screen.getByText('closes this month')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Actions: Deposit' }))
    expect(screen.getByRole('menuitem', { name: 'Keep the account' })).toBeInTheDocument()
  })

  it('adds an account in the form and refuses a duplicate', async () => {
    stubState({ ...base, members: ['Robin'], currencies: ['RUB'] }, () => base)
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: '+ Account' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Name' }), { target: { value: 'Quillmark Bank' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('This account is already in the month')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Name' }), { target: { value: 'Savings' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByLabelText('Balance: Savings')).toBeInTheDocument()
  })

  it('closes a complete month, says so and moves to the next one', async () => {
    const ready = { ...base, problems: [], rows: base.rows.map(r => ({ ...r, balance: 1, active: 0, passive: 0, expense: 0 })) }
    const next = { ...base, queue: ['2031-07'], month: '2031-07', lastClosed: { month: '2031-06', reopenable: true } }
    const calls: string[] = []
    stubState(ready, url => { calls.push(url); return url.endsWith('/close') ? next : ready })
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Close June 2031' }))
    await waitFor(() => expect(screen.getAllByRole('status').some(node => node.textContent?.includes('June 2031 closed'))).toBe(true))
    expect(calls).toEqual(['/api/month-close/2031-06/draft', '/api/month-close/2031-06/close'])
    expect(await screen.findByRole('button', { name: 'Close July 2031' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reopen June 2031' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View results' })).toHaveAttribute('href', '/?month=2031-06')
    expect(screen.getByText(/^Account balances:/)).toBeInTheDocument()
  })

  it('a double click on “Close” closes the month once: one save, one close, no failure notice', async () => {
    const ready = { ...base, problems: [], rows: base.rows.map(r => ({ ...r, balance: 1, active: 0, passive: 0, expense: 0 })) }
    const next = { ...base, queue: ['2031-07'], month: '2031-07', lastClosed: { month: '2031-06', reopenable: true } }
    const calls: string[] = []
    stubState(ready, url => { calls.push(url); return url.endsWith('/close') ? next : ready })
    renderScreen()
    const close = await screen.findByRole('button', { name: 'Close June 2031' })
    fireEvent.click(close)
    fireEvent.click(close)
    await waitFor(() => expect(screen.getAllByRole('status').some(node => node.textContent?.includes('June 2031 closed'))).toBe(true))
    expect(calls).toEqual(['/api/month-close/2031-06/draft', '/api/month-close/2031-06/close'])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('“Close” is off while the close is under way', async () => {
    const ready = { ...base, problems: [], rows: base.rows.map(r => ({ ...r, balance: 1, active: 0, passive: 0, expense: 0 })) }
    // the draft save never answers: the close stays under way
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      !init?.method || init.method === 'GET' ? Promise.resolve(jsonResponse(ready)) : new Promise<Response>(() => {})))
    renderScreen()
    const close = await screen.findByRole('button', { name: 'Close June 2031' })
    fireEvent.click(close)
    await waitFor(() => expect(close).toBeDisabled())
  })

  it('closing a month marks the snapshot stale at once: the menu badge counts the months left', async () => {
    const ready = { ...base, problems: [], rows: base.rows.map(r => ({ ...r, balance: 1, active: 0, passive: 0, expense: 0 })) }
    const next = { ...base, queue: ['2031-07'], month: '2031-07', lastClosed: { month: '2031-06', reopenable: true } }
    stubState(ready, url => (url.endsWith('/close') ? next : ready))
    const client = testClient()
    client.setQueryData(['snapshot'], { cached: true })
    renderAdmin(<DataPage screen={MonthCloseView} />, { client })
    fireEvent.click(await screen.findByRole('button', { name: 'Close June 2031' }))
    await screen.findByRole('button', { name: 'Close July 2031' })
    expect(client.getQueryState(['snapshot'])?.isInvalidated).toBe(true)
  })

  it('does not close when the server no longer has an account that is on the screen', async () => {
    const ready = { ...base, problems: [], rows: base.rows.map(r => ({ ...r, balance: 1, active: 0, passive: 0, expense: 0 })) }
    const calls: string[] = []
    // the second account was deleted in another tab: the server returned the draft without it
    stubState(ready, url => { calls.push(url); return { ...ready, rows: [ready.rows[0]] } })
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Close June 2031' }))
    expect(await screen.findByText(/The list of accounts has changed/)).toBeInTheDocument()
    expect(calls).toEqual(['/api/month-close/2031-06/draft'])
    expect(screen.queryByLabelText('Balance: Deposit')).toBeNull()
  })

  it('keeps what was typed and says why when the draft cannot be saved', async () => {
    stubState(base, () => { throw new Error('boom') })
    renderScreen()
    const field = await screen.findByLabelText('Expense: Quillmark Bank')
    fireEvent.change(field, { target: { value: '700' } })
    fireEvent.blur(field)
    expect(await screen.findByText('Not saved: boom')).toBeInTheDocument()
    expect(field).toHaveValue('700')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('does not hammer the server after a failed save', async () => {
    let calls = 0
    stubState(base, () => { calls += 1; throw new Error('boom') })
    renderScreen()
    const noActivity = await screen.findByRole('button', { name: 'No income or expenses: Quillmark Bank' })
    vi.useFakeTimers()
    try {
      fireEvent.click(noActivity)
      // the autosave after the pause fails…
      await act(() => vi.advanceTimersByTimeAsync(800))
      expect(screen.getByText('Not saved: boom')).toBeInTheDocument()
      // …and is not tried again by itself, however long the screen stays open
      await act(() => vi.advanceTimersByTimeAsync(60_000))
      expect(calls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reloads the queue when the server says the month is already closed', async () => {
    const ready = { ...base, problems: [], rows: base.rows.map(r => ({ ...r, balance: 1, active: 0, passive: 0, expense: 0 })) }
    let closed = false
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/close')) { closed = true; return jsonResponse({ error: { code: 'month_conflict' } }, 409) }
      if (init?.method === 'PUT') return jsonResponse(ready)
      return jsonResponse(closed ? { ...base, queue: ['2031-07'], month: '2031-07' } : ready)
    }))
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Close June 2031' }))
    expect(await screen.findByText('The month is already closed or already has entries. Refresh the page')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Close July 2031' })).toBeInTheDocument()
  })

  it('asks before undoing a close', async () => {
    const calls: string[] = []
    stubState({ ...base, lastClosed: { month: '2031-05', reopenable: true } }, url => { calls.push(url); return base })
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen May 2031' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(calls).toEqual([])
  })

  it('says when everything is closed and when the next month opens', async () => {
    stubState({ ...base, queue: [], month: null, rows: [], problems: [], nextOpensOn: '2031-11-01' })
    renderScreen()
    expect(await screen.findByText(/All months are closed/)).toBeInTheDocument()
    expect(screen.getByText(/from November 1/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Close / })).toBeNull()
  })

  it('offers old incomplete months as an optional list', async () => {
    stubState({ ...base, incomplete: [{ month: '2031-03', missing: 2 }] })
    renderScreen()
    expect(await screen.findByText('Older months you can complete')).toBeInTheDocument()
    expect(screen.getByText(/March 2031: data missing for 2 accounts/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '“Accounts”' })).toHaveAttribute('href', '/accounts')
  })

  it('on an empty database asks for the first account', async () => {
    stubState({ ...base, queue: ['2031-09'], month: '2031-09', rows: [], hints: {}, problems: [{ key: '', name: '', member: '', problem: { code: 'no_accounts' as const } }] })
    renderScreen()
    expect(await screen.findByText(/Add an account to close/)).toBeInTheDocument()
  })
})

describe('Month-close action bar', () => {
  it('keeps the violet fill: closing a month is a commit action', async () => {
    stubState(base)
    renderScreen()
    expect(await screen.findByRole('button', { name: 'Close ' + fmtMonth('2031-06') })).toHaveClass('btn--primary')
  })

  it('one floating bar holds the figure, the totals, the save state, “Save draft” and a blocked but focusable Close', async () => {
    stubState({ ...base, totals: [{ currency: 'RUB', income: 1200, expense: 50.5, balanceChange: 300 }, { currency: 'USD', income: 0, expense: 0, balanceChange: 10 }] })
    renderScreen()
    const close = await screen.findByRole('button', { name: 'Close June 2031' })
    const bar = screen.getByRole('region', { name: 'Month totals' })
    expect(bar).toHaveClass('close-bar')
    expect(bar).toContainElement(close)
    expect(bar.querySelector('.close-bar__fig')).toHaveTextContent('0 of 2accounts filled')
    expect(bar.querySelectorAll('.close-bar__total')).toHaveLength(2)
    expect(within(bar).getByText('Changes save on their own')).toHaveClass('close-bar__status')
    const save = within(bar).getByRole('button', { name: 'Save draft' })
    expect(save).toHaveClass('btn--ghost')
    expect(close).toHaveClass('btn--primary')
    expect(save.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Save draft' })).toHaveLength(1)
    // blocked: focusable, aria-disabled, its reason read out; a press does nothing
    expect(close).not.toBeDisabled()
    expect(close).toHaveAttribute('aria-disabled', 'true')
    expect(close).toHaveAccessibleDescription(/^Fill in every account to close June 2031/)
    expect(closable(close)).toBe(false)
    fireEvent.click(close)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('.close-foot')).toBeNull()
    expect(screen.getByRole('table').compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('draws no bar with no rows and no totals', async () => {
    stubState({ ...base, rows: [], totals: [] })
    renderScreen()
    await screen.findByRole('button', { name: '+ Account' })
    expect(screen.queryByRole('region', { name: 'Month totals' })).toBeNull()
  })

  it('on a phone “Save draft” is a text button', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)', addEventListener: () => {}, removeEventListener: () => {} }))
    stubState(base)
    renderScreen()
    expect(await screen.findByRole('button', { name: 'Save draft' })).toHaveClass('btn--quiet')
  })

  it('formats the month totals as money under a label', async () => {
    stubState({ ...base, totals: [{ currency: 'RUB', income: 1200, expense: 50.5, balanceChange: 300 }] })
    renderScreen()
    const totals = await screen.findByRole('region', { name: 'Month totals' })
    expect(totals).toHaveTextContent('RUB')
    expect(totals).toHaveTextContent('income 1,200.00 · expenses 50.50 · balance change +300.00')
  })

  it('masks the month totals in privacy mode', async () => {
    stubPrivacyOn()
    stubState({ ...base, totals: [{ currency: 'RUB', income: 1200, expense: 50.5, balanceChange: 300 }] })
    renderAdmin(<DataPage screen={MonthCloseView} />, { dashboard: true })
    const totals = await screen.findByRole('region', { name: 'Month totals' })
    expect(totals).toHaveTextContent('income ••• · expenses ••• · balance change •••')
    expect(totals).not.toHaveTextContent('1,200')
  })

  it.each(['12', '12.'])('warns before discarding numeric input %s when reopening before autosave', async value => {
    stubState({ ...base, lastClosed: { month: '2031-05', reopenable: true } }, () => base)
    renderScreen()
    const input = await screen.findByLabelText('Balance: Quillmark Bank')
    typeText(input, value)
    fireEvent.click(screen.getByRole('button', { name: 'Reopen May 2031' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Unsaved changes may be lost')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(input).toHaveValue(value)
  })

  it('reopens with a neutral confirmation, not a deletion one', async () => {
    stubState({ ...base, lastClosed: { month: '2031-05', reopenable: true } }, () => base)
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen May 2031' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Reopen month' })).toHaveClass('btn--primary')
    expect(dialog.querySelector('.tabler-icon-trash')).toBeNull()
  })
})


it('close sends the saved revision and keeps the visible draft when close conflicts', async () => {
  const ready = { ...base, problems: [], rows: base.rows.map(r => ({ ...r, balance: 777, active: 0, passive: 0, expense: 0 })) }
  let reads = 0
  const requests: { url: string; body: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/spending') return jsonResponse({ categories: [], accounts: [], sources: [], manual: null })
    if (url === '/api/month-close' && !init?.method) { reads++; return jsonResponse(ready) }
    requests.push({ url, body: JSON.parse(String(init?.body)) })
    if (url.endsWith('/draft')) return jsonResponse({ ...ready, draftRevision: 'saved-revision' })
    return jsonResponse({ error: { code: 'draft_conflict' } }, 409)
  }))
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Close June 2031' }))
  await screen.findAllByText(/The saved draft changed/)
  expect(requests).toEqual([
    { url: '/api/month-close/2031-06/draft', body: { rows: ready.rows, loans: [], expectedRevision: ready.draftRevision } },
    { url: '/api/month-close/2031-06/close', body: { expectedRevision: 'saved-revision' } },
  ])
  expect(reads).toBe(1)
  expect(screen.getByLabelText('Balance: Quillmark Bank')).toHaveValue('777')
})

it('reopen ignores duplicate submissions and clears its pending state after failure', async () => {
  const gate = deferred<Response>()
  let m!: ReturnType<typeof useMonthClose>
  function Harness() { m = useMonthClose(); return null }
  let writes = 0
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') { writes++; return writes === 1 ? gate.promise : jsonResponse(base) }
    return jsonResponse(base)
  }))
  renderAdmin(<Harness />)
  await waitFor(() => expect(m.loaded).toBe(true))
  let first!: Promise<unknown>
  act(() => { first = m.reopen('2031-05'); void m.reopen('2031-05') })
  await waitFor(() => expect(writes).toBe(1))
  expect(m.reopening).toBe(true)
  await act(async () => { gate.resolve(jsonResponse({ error: 'offline' }, 500)); await first })
  expect(m.reopening).toBe(false)
  await act(async () => { await m.reopen('2031-05') })
  expect(writes).toBe(2)
  expect(m.reopening).toBe(false)
})


it('keeps the saved backlog month and native currency groups after the queue advances', async () => {
  const ready = { ...base, problems: [], rows: [
    { ...base.rows[0], balance: 120, active: 100, passive: 0, expense: 60 },
    { ...base.rows[1], currency: 'USD', balance: 30, active: 20, passive: 0, expense: 25 },
  ] }
  const next = { ...base, month: '2031-07', lastClosed: { month: '2031-10', reopenable: false } }
  stubState(ready, url => url.endsWith('/close') ? next : ready)
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Close June 2031' }))
  const result = await screen.findByRole('link', { name: 'View results' })
  expect(result).toHaveAttribute('href', '/?month=2031-06')
  const summary = result.parentElement!
  expect(summary).toHaveTextContent('Account balances: ₽120.00')
  expect(summary).toHaveTextContent('Account balances: $30.00')
  expect(summary).toHaveTextContent('Left after expenses: ₽40.00')
  expect(summary).toHaveTextContent('Overspent: $5.00')
  expect(summary).not.toHaveTextContent('Net worth')
})


it('formats successful results in their own currencies even when the quick view differs', async () => {
  sessionStorage.setItem('fc.viewCurrency', 'EUR')
  const ready = { ...base, problems: [], rows: [
    { ...base.rows[0], currency: 'USD', balance: 12345, active: 1.25, passive: 0, expense: 0 },
    { ...base.rows[1], currency: 'GBP', balance: -12.34, active: 0, passive: 0, expense: 0 },
  ] }
  const next = { ...base, month: '2031-07', queue: ['2031-07'] }
  stubState(ready, url => url.endsWith('/close') ? next : ready)
  renderAdmin(<DataPage screen={MonthCloseView} />, { dashboard: true })
  fireEvent.click(await screen.findByRole('button', { name: 'Close June 2031' }))
  const summary = (await screen.findByRole('link', { name: 'View results' })).parentElement!
  expect(summary).toHaveTextContent('Account balances: $12,345.00')
  expect(summary).toHaveTextContent('Account balances: −£12.34')
  expect(summary).toHaveTextContent('Income: $1.25 · Expenses: $0.00 · Left after expenses: $1.25')
  expect(summary).not.toHaveTextContent('USD')
  expect(summary).not.toHaveTextContent('EUR')
  sessionStorage.removeItem('fc.viewCurrency')
})

it('formats Russian successful results in rubles with cents', async () => {
  await withLanguage('ru-RU', async () => {
    const ready = { ...base, problems: [], rows: base.rows.map((r, i) => ({ ...r, balance: i ? 0 : 12345.67, active: 0, passive: 0, expense: 0 })) }
    const next = { ...base, month: '2031-07', queue: ['2031-07'] }
    stubState(ready, url => url.endsWith('/close') ? next : ready)
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: ru('data.close.closeMonth', { month: fmtMonth('2031-06') }) }))
    const summary = (await screen.findByRole('link', { name: ru('data.close.viewResults') })).parentElement!
    expect(summary.textContent?.replace(/\u00a0/g, ' ')).toContain(`${ru('data.close.resultBalances')}: 12 345,67 ₽`)
  })
})

it('masks every successful result amount including accessible attributes', async () => {
  stubPrivacyOn()
  const ready = { ...base, problems: [], rows: base.rows.map(r => ({ ...r, balance: 12345, active: 25, passive: 0, expense: 0 })) }
  const next = { ...base, month: '2031-07', queue: ['2031-07'] }
  stubState(ready, url => url.endsWith('/close') ? next : ready)
  renderAdmin(<DataPage screen={MonthCloseView} />, { dashboard: true })
  fireEvent.click(await screen.findByRole('button', { name: 'Close June 2031' }))
  const summary = (await screen.findByRole('link', { name: 'View results' })).parentElement!
  expect(summary).toHaveTextContent('Account balances: •••')
  expect(summary).toHaveTextContent('Income: ••• · Expenses: ••• · Left after expenses: •••')
  expect(summary.outerHTML).not.toMatch(/12,?345|25\.00/)
  expect(summary.querySelector('[title], [aria-label]')).toBeNull()
})
