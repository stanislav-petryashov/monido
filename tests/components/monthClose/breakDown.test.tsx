import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { DraftRequest, MonthCloseState, SpendingRecords } from '../../../src/domain/api'
import type { SpendingCategory } from '../../../src/domain/types'
import { resetAuth } from '../../../src/lib/authState'
import { useAllocations } from '../../../src/modules/cashflow/useAllocations'
import { deferred, jsonResponse } from '../../helpers/http'
import { renderAdmin, stubPrivacyOn, testClient } from '../../helpers/render'
import { typeText } from '../../helpers/adminScreens'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { MonthCloseView } from '../../../src/pages/admin/MonthCloseView'
import { account, base, noSpending, renderScreen, closable } from '../../helpers/monthClose'
import { ru } from '../../helpers/i18n'
import { applyFamilyLanguage } from '../../../src/i18n/client'

// The inline "Break down" panel of Close month: an account's lines by category, capped by its totals.

const reserved: SpendingCategory = { id: 1, name: 'loan_payments', kind: 'loan_payment', flow: 'expense', oneOff: false }
const housing: SpendingCategory = { id: 2, name: 'Housing', kind: 'mandatory', flow: 'expense', oneOff: false }
const salary: SpendingCategory = { id: 10, name: 'Salary', kind: 'optional', flow: 'active', oneOff: false }

const filled = { balance: 1, active: 6890, passive: 0, expense: 5280 }
/** Quillmark Bank filled in with flows, Deposit filled in without any */
const ready: MonthCloseState = {
  ...base, problems: [],
  rows: [{ ...account('Quillmark Bank'), ...filled }, { ...account('Deposit'), balance: 1, active: 0, passive: 0, expense: 0 }],
}
const withLines = (items: { categoryId: number; amount: number }[]): SpendingRecords => ({
  ...noSpending,
  categories: [reserved, housing, salary],
  accounts: [{
    month: '2031-06', bank: 'Quillmark Bank', member: 'Robin', currency: 'RUB',
    totals: { active: 6890, passive: 0, expense: 5280 }, items,
    allocated: {
      active: items.filter(i => i.categoryId === 10).reduce((s, i) => s + i.amount, 0), passive: 0,
      expense: items.filter(i => i.categoryId === 2).reduce((s, i) => s + i.amount, 0),
    },
    orphaned: false,
  }],
})

interface Call { url: string; method: string; body?: unknown }

/** The wizard's server: the month's state, the spending records; every write recorded in order. */
function stub(state: MonthCloseState, spending: SpendingRecords, answer?: (call: Call) => Response | undefined) {
  const calls: Call[] = []
  let current = state
  let records = spending
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method === 'GET') return jsonResponse(url === '/api/spending' ? records : current)
    const call: Call = { url, method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) }
    calls.push(call)
    const custom = answer?.(call)
    if (custom) return custom
    if (url.startsWith('/api/spending/months/')) {
      const body = call.body as { bank: string; member: string; items: { categoryId: number; amount: number }[] }
      records = { ...records, accounts: records.accounts.map(a => (a.bank === body.bank && a.member === body.member ? { ...a, items: body.items } : a)) }
      return jsonResponse(records)
    }
    if (url.startsWith('/api/spending/categories')) return jsonResponse(records)
    if (url.endsWith('/draft')) current = { ...current, rows: (call.body as DraftRequest).rows, draftSavedAt: '2031-07-02T10:00:00Z' }
    return jsonResponse(current)
  }))
  return calls
}

const breakDown = (name: string) => screen.findByRole('button', { name: `Break down: ${name}` })
const panel = (name: string) => screen.getByRole('group', { name: `Breakdown by category: ${name}` })

afterEach(() => { act(() => resetAuth()) })

describe('Close month: Break down', () => {
  it.each([
    { action: 'close', child: 'allocation', month: null },
    { action: 'close', child: 'allocation', month: '2031-07' },
    { action: 'close', child: 'new account', month: null },
    { action: 'close', child: 'new account', month: '2031-07' },
    { action: 'reopen', child: 'allocation', month: null },
    { action: 'reopen', child: 'allocation', month: '2031-07' },
    { action: 'reopen', child: 'new account', month: null },
    { action: 'reopen', child: 'new account', month: '2031-07' },
  ])('retains $child typed after failed $action unlocks while recovery advances to $month', async ({ action, child, month }) => {
    const state = { ...ready, lastClosed: { month: '2031-05', reopenable: true } }
    const recovery = deferred<Response>()
    const writes: { url: string; body: DraftRequest }[] = []
    let reads = 0
    let terminalFailed = false
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/spending') return jsonResponse(withLines([{ categoryId: 2, amount: 20 }]))
      if (init?.method === 'PUT') {
        writes.push({ url, body: JSON.parse(String(init.body)) })
        return terminalFailed
          ? jsonResponse({ error: 'changed', code: 'draft_conflict' }, 409)
          : jsonResponse({ ...state, draftRevision: 'revision-2' })
      }
      if (init?.method === 'POST') { terminalFailed = true; return jsonResponse({ error: 'offline' }, 500) }
      if (++reads === 1) return jsonResponse(state)
      return recovery.promise
    }))
    renderScreen()
    if (action === 'close') fireEvent.click(await screen.findByRole('button', { name: 'Close June 2031' }))
    else {
      fireEvent.click(await screen.findByRole('button', { name: 'Reopen May 2031' }))
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reopen month' }))
    }
    await waitFor(() => expect(reads).toBe(2))
    await waitFor(() => expect(screen.getByLabelText('Balance: Quillmark Bank')).toBeEnabled())
    if (child === 'allocation') fireEvent.click(screen.getByRole('button', { name: 'Break down: Quillmark Bank' }))
    else fireEvent.click(screen.getByRole('button', { name: '+ Account' }))
    const input = child === 'allocation'
      ? within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')
      : screen.getByLabelText('Name')
    if (child === 'allocation') typeText(input, '1,')
    else fireEvent.change(input, { target: { value: 'After failure' } })
    await act(async () => recovery.resolve(jsonResponse({ ...state, month, queue: month ? [month] : [], rows: [], draftRevision: 'revision-3' })))
    expect(screen.getByRole('button', { name: 'Close June 2031' })).toBeInTheDocument()
    if (child === 'allocation') {
      expect(within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')).toBe(input)
      expect(input).toHaveValue('1.')
    } else {
      expect(screen.getByLabelText('Name')).toBe(input)
      expect(input).toHaveValue('After failure')
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
      await waitFor(() => expect(writes).toHaveLength(action === 'close' ? 2 : 1))
      expect(writes.at(-1)).toMatchObject({ url: '/api/month-close/2031-06/draft', body: {
        expectedRevision: action === 'close' ? 'revision-2' : 'revision-1',
        rows: expect.arrayContaining([expect.objectContaining({ name: 'After failure' })]),
      } })
      expect(screen.getByText('After failure', { selector: '.close-table__account' })).toBeInTheDocument()
    }
  })
  it('ends failed terminal pending state while a recovery read waits and a renewed reopen cannot be overwritten by it', async () => {
    const state = { ...ready, lastClosed: { month: '2031-05', reopenable: true } }
    const recovery = deferred<Response>()
    let reads = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/spending') return jsonResponse(withLines([]))
      if (init?.method === 'PUT') return jsonResponse({ ...state, draftRevision: 'revision-2' })
      if (url.endsWith('/close')) return jsonResponse({ error: 'offline' }, 500)
      if (url.endsWith('/reopen')) return jsonResponse({ ...state, month: '2031-05', queue: ['2031-05', '2031-06'], lastClosed: null })
      if (++reads === 1) return jsonResponse(state)
      return recovery.promise
    }))
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Close June 2031' }))
    await waitFor(() => expect(reads).toBe(2))
    const reopen = screen.getByRole('button', { name: 'Reopen May 2031' })
    expect(reopen).toBeEnabled()
    fireEvent.click(reopen)
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reopen month' }))
    expect(await screen.findByRole('button', { name: 'Close May 2031' })).toBeInTheDocument()
    await act(async () => recovery.resolve(jsonResponse(state)))
    expect(screen.getByRole('button', { name: 'Close May 2031' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close June 2031' })).toBeNull()
  })
  it('ignores a portaled remove action left open before a terminal transition', async () => {
    const state = { ...ready, rows: ready.rows.map((row, index) => index === 0 ? { ...row, added: true } : row) }
    const gate = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return gate.promise
      return jsonResponse(String(input) === '/api/spending' ? withLines([]) : state)
    }))
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Quillmark Bank' }))
    const remove = screen.getByRole('menuitem', { name: 'Remove' })
    fireEvent.click(screen.getByRole('button', { name: 'Close June 2031' }))
    await waitFor(() => expect(screen.getByLabelText('Balance: Quillmark Bank')).toBeDisabled())
    // The menu is portaled outside the disabled editing fieldset; its retained callback must still refuse edits.
    fireEvent.click(remove)
    expect(screen.getByLabelText('Balance: Quillmark Bank')).toBeInTheDocument()
    await act(async () => gate.resolve(jsonResponse({ error: 'offline' }, 500)))
    expect(await screen.findByText(/offline/)).toBeInTheDocument()
    expect(screen.getByLabelText('Balance: Quillmark Bank')).toBeEnabled()
  })
  it.each(['close', 'reopen'])('locks current numeric, loan and row actions during a confirmed %s and restores them on failure', async action => {
    const state = { ...ready, lastClosed: { month: '2031-05', reopenable: true }, loanPayments: [{ name: 'Car loan', currency: 'RUB', scheduled: 1000, amount: 1000 }], suggested: [{ name: 'Extra', member: 'Robin', currency: 'RUB', class: 'bank' as const }] }
    const gate = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return gate.promise
      return jsonResponse(String(input) === '/api/spending' ? withLines([]) : state)
    }))
    renderScreen()
    const balance = await screen.findByLabelText('Balance: Quillmark Bank')
    const loan = screen.getByLabelText('Amount: Car loan')
    const edits = ['No income or expenses: Quillmark Bank', '+ Account', 'Add account: Extra · Robin', 'Actions: Quillmark Bank']
    expect(balance).toBeEnabled()
    expect(loan).toBeEnabled()
    if (action === 'close') fireEvent.click(screen.getByRole('button', { name: 'Close June 2031' }))
    else {
      fireEvent.click(screen.getByRole('button', { name: 'Reopen May 2031' }))
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reopen month' }))
    }
    await waitFor(() => expect(balance).toBeDisabled())
    expect(loan).toBeDisabled()
    for (const name of edits) expect(screen.getByRole('button', { name })).toBeDisabled()
    await act(async () => gate.resolve(jsonResponse({ error: 'offline' }, 500)))
    expect(await screen.findByText(/offline/)).toBeInTheDocument()
    expect(balance).toBeEnabled()
    expect(loan).toBeEnabled()
    for (const name of edits) expect(screen.getByRole('button', { name })).toBeEnabled()
  })

  it('waits for a numeric autosave already in flight before the confirmed reopen request', async () => {
    const state = { ...ready, lastClosed: { month: '2031-05', reopenable: true } }
    const gate = deferred<Response>()
    const writes: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') { writes.push(url); return gate.promise }
      if (init?.method === 'POST') { writes.push(url); return jsonResponse({ ...state, month: '2031-05', queue: ['2031-05', '2031-06'] }) }
      return jsonResponse(url === '/api/spending' ? withLines([]) : state)
    }))
    renderScreen()
    const balance = await screen.findByLabelText('Balance: Quillmark Bank')
    fireEvent.change(balance, { target: { value: '2' } })
    fireEvent.blur(balance, { relatedTarget: document.body })
    await waitFor(() => expect(writes).toEqual(['/api/month-close/2031-06/draft']))
    expect(balance).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reopen May 2031' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reopen month' }))
    await waitFor(() => expect(balance).toBeDisabled())
    expect(writes).toEqual(['/api/month-close/2031-06/draft'])
    await act(async () => gate.resolve(jsonResponse({ ...state, rows: state.rows.map((row, index) => index === 0 ? { ...row, balance: 2 } : row), draftRevision: 'revision-2' })))
    expect(await screen.findByRole('button', { name: 'Close May 2031' })).toBeInTheDocument()
    expect(writes).toEqual(['/api/month-close/2031-06/draft', '/api/month-close/2031-05/reopen'])
  })
  it.each([200, 500])('waits for an old-month allocation PUT (%s) before reopening and prevents a new transition write', async status => {
    let current: MonthCloseState = { ...ready, lastClosed: { month: '2031-05', reopenable: true } }
    const gate = deferred<Response>()
    const writes: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') { writes.push(url); return gate.promise }
      if (init?.method === 'POST') {
        writes.push(url)
        current = { ...ready, month: '2031-05', queue: ['2031-05', '2031-06'], lastClosed: null }
      }
      return jsonResponse(url === '/api/spending' ? withLines([{ categoryId: 2, amount: 20 }]) : current)
    }))
    renderScreen()
    fireEvent.click(await breakDown('Quillmark Bank'))
    const input = within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')
    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.blur(input, { relatedTarget: document.body })
    await waitFor(() => expect(writes).toEqual(['/api/spending/months/2031-06/account']))
    fireEvent.click(screen.getByRole('button', { name: 'Reopen May 2031' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reopen month' }))
    await waitFor(() => expect(input).toBeDisabled())
    expect(writes).toEqual(['/api/spending/months/2031-06/account'])
    await act(async () => gate.resolve(jsonResponse(status === 200 ? withLines([{ categoryId: 2, amount: 45 }]) : { error: 'offline' }, status)))
    expect(await screen.findByRole('button', { name: 'Close May 2031' })).toBeInTheDocument()
    expect(writes).toEqual(['/api/spending/months/2031-06/account', '/api/month-close/2031-05/reopen'])
  })

  it('keeps incomplete allocation input and its month hold when reopening fails', async () => {
    let current: MonthCloseState = { ...ready, lastClosed: { month: '2031-05', reopenable: true } }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ error: 'offline' }, 500)
      return jsonResponse(String(input) === '/api/spending' ? withLines([{ categoryId: 2, amount: 20 }]) : current)
    }))
    const client = testClient()
    renderAdmin(<DataPage screen={MonthCloseView} />, { client })
    fireEvent.click(await breakDown('Quillmark Bank'))
    const input = within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')
    typeText(input, '1,')
    fireEvent.click(screen.getByRole('button', { name: 'Reopen May 2031' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reopen month' }))
    expect(await screen.findByText(/offline/)).toBeInTheDocument()
    current = { ...ready, month: null, queue: [], rows: [] }
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'month-close'] }) })
    expect(within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')).toHaveValue('1.')
    expect(input).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Close June 2031' })).toBeInTheDocument()
  })
  it.each([null, '2031-07'])('releases discarded allocation input after confirmed reopen so a later read can show %s', async month => {
    let current: MonthCloseState = { ...ready, lastClosed: { month: '2031-05', reopenable: true } }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') current = { ...ready, month: '2031-05', queue: ['2031-05', '2031-06'], lastClosed: null }
      return jsonResponse(String(input) === '/api/spending' ? withLines([{ categoryId: 2, amount: 20 }]) : current)
    }))
    const client = testClient()
    renderAdmin(<DataPage screen={MonthCloseView} />, { client })
    fireEvent.click(await breakDown('Quillmark Bank'))
    typeText(within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1'), '1,')
    fireEvent.click(screen.getByRole('button', { name: 'Reopen May 2031' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reopen month' }))
    expect(await screen.findByRole('button', { name: 'Close May 2031' })).toBeInTheDocument()
    current = { ...ready, month, queue: month ? [month] : [], rows: [], draftRevision: 'revision-3' }
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'month-close'] }) })
    if (month) expect(await screen.findByText('July 2031', { selector: '.close-queue__month' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close May 2031' })).toBeNull())
  })
  it('releases an acknowledged allocation hold without releasing an unsaved new account', async () => {
    let current: MonthCloseState = ready
    const gate = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return gate.promise
      return jsonResponse(String(input) === '/api/spending' ? withLines([{ categoryId: 2, amount: 20 }]) : current)
    }))
    const client = testClient()
    renderAdmin(<DataPage screen={MonthCloseView} />, { client })
    fireEvent.click(await breakDown('Quillmark Bank'))
    const input = within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')
    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Account' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Still unsaved' } })
    current = { ...ready, month: '2031-07', queue: ['2031-07'], rows: [], draftRevision: 'revision-2' }
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'month-close'] }) })
    fireEvent.blur(input, { relatedTarget: document.body })
    await act(async () => gate.resolve(jsonResponse(withLines([{ categoryId: 2, amount: 45 }]))))
    expect(screen.getByLabelText('Name')).toHaveValue('Still unsaved')
    expect(screen.getByRole('button', { name: 'Close June 2031' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
    expect(await screen.findByText('July 2031', { selector: '.close-queue__month' })).toBeInTheDocument()
  })
  it.each([
    { month: null, text: '45', display: '45' },
    { month: '2031-07', text: '45', display: '45' },
    { month: null, text: '1,', display: '1.' },
    { month: '2031-07', text: '1,', display: '1.' },
  ])('retains allocation-only text $text when a background queue read advances to $month', async ({ month, text, display }) => {
    let current: MonthCloseState = ready
    const writes: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') { writes.push(String(input)); return jsonResponse({ error: 'offline' }, 500) }
      return jsonResponse(String(input) === '/api/spending' ? withLines([{ categoryId: 2, amount: 20 }]) : current)
    }))
    const client = testClient()
    renderAdmin(<DataPage screen={MonthCloseView} />, { client })
    fireEvent.click(await breakDown('Quillmark Bank'))
    const input = within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')
    typeText(input, text)
    current = { ...ready, month, queue: month ? [month] : [], rows: [], draftRevision: 'revision-2' }
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'month-close'] }) })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')).toHaveValue(display)
    expect(screen.getByRole('button', { name: 'Close June 2031' })).toBeInTheDocument()
    expect(writes.every(url => url === '/api/spending/months/2031-06/account')).toBe(true)
  })
  it('locks the private account form while closing the month and restores it if closing fails', async () => {
    const gate = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return gate.promise
      return jsonResponse(String(input) === '/api/spending' ? withLines([]) : ready)
    }))
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: '+ Account' }))
    const input = screen.getByLabelText('Name')
    fireEvent.click(screen.getByRole('button', { name: 'Close June 2031' }))
    await waitFor(() => expect(input).toBeDisabled())
    gate.resolve(jsonResponse({ error: 'offline' }, 500))
    expect(await screen.findByText(/offline/)).toBeInTheDocument()
    expect(input).toBeEnabled()
  })
  it.each([null, '2031-07'])('pins pre-Add input to the original month after the queue refreshes to %s', async month => {
    let current: MonthCloseState = ready
    const writes: { url: string; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') {
        writes.push({ url, body: JSON.parse(String(init.body)) })
        return jsonResponse({ error: 'changed', code: 'draft_conflict' }, 409)
      }
      return jsonResponse(url === '/api/spending' ? withLines([]) : current)
    }))
    const client = testClient()
    renderAdmin(<DataPage screen={MonthCloseView} />, { client })
    fireEvent.click(await screen.findByRole('button', { name: '+ Account' }))
    current = { ...ready, month, queue: month ? [month] : [], rows: [], draftRevision: 'revision-2' }
    act(() => {
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Original month' } })
      client.setQueryData(['admin', 'month-close'], current)
    })
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'month-close'] }) })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(screen.getByLabelText('Name')).toHaveValue('Original month')
    expect(writes).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ url: '/api/month-close/2031-06/draft', body: { expectedRevision: 'revision-1', rows: expect.arrayContaining([expect.objectContaining({ name: 'Original month' })]) } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved:')
    expect(screen.getByText('Original month', { selector: '.close-table__account' })).toBeInTheDocument()
  })
  it('protects a typed account before Add and retains it across locale changes', async () => {
    stub(ready, withLines([]))
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: '+ Account' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ Account' }))
    const input = screen.getByLabelText('Name')
    fireEvent.change(input, { target: { value: 'Unadded' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(input).toHaveValue('Unadded')
    await act(async () => { await applyFamilyLanguage('ru-RU') })
    try {
      expect(await screen.findByLabelText(ru('data.field.name'))).toBe(input)
      expect(input).toHaveValue('Unadded')
    } finally {
      await act(async () => { await applyFamilyLanguage('en-US') })
    }
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
  it('is offered only for an account with a flow above zero', async () => {
    stub(ready, withLines([]))
    renderScreen()
    expect(await breakDown('Quillmark Bank')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Break down: Deposit' })).toBeNull()
  })

  it('opens one panel at a time, under its account, with the totals it allocates', async () => {
    stub(ready, withLines([{ categoryId: 10, amount: 6500 }]))
    renderScreen()
    fireEvent.click(await breakDown('Quillmark Bank'))
    expect(await screen.findByText(/Of 6,890\.00: 6,500\.00 allocated · 390\.00 unallocated/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Break down: Quillmark Bank' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Break down: Quillmark Bank' }))
    expect(screen.queryByRole('group', { name: 'Breakdown by category: Quillmark Bank' })).toBeNull()
  })

  it('below 1200px the row menu says “Hide breakdown” while the panel is open, and closes it', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 1199px)', addEventListener: () => {}, removeEventListener: () => {} }))
    stub(ready, withLines([]))
    renderScreen()
    await breakDown('Quillmark Bank')
    fireEvent.click(screen.getByRole('button', { name: 'Actions: Quillmark Bank' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Break down' }))
    expect(panel('Quillmark Bank')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Actions: Quillmark Bank' }))
    expect(screen.queryByRole('menuitem', { name: 'Break down' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide breakdown' }))
    expect(screen.queryByRole('group', { name: 'Breakdown by category: Quillmark Bank' })).toBeNull()
  })

  it('a line typed is saved with the account in the body, after the draft holds the totals', async () => {
    const calls = stub(ready, withLines([]))
    renderScreen()
    fireEvent.click(await breakDown('Quillmark Bank'))
    // a total typed and not saved yet: the lines' cap is the saved draft, so the draft goes first
    fireEvent.change(screen.getByLabelText('Active income: Quillmark Bank'), { target: { value: '7000' } })
    fireEvent.click(within(panel('Quillmark Bank')).getByRole('button', { name: 'Add income line' }))
    const amount = within(panel('Quillmark Bank')).getByLabelText('Amount: Income line 1')
    fireEvent.change(amount, { target: { value: '6500' } })
    fireEvent.blur(amount, { relatedTarget: document.body })
    await waitFor(() => expect(calls.some(c => c.url === '/api/spending/months/2031-06/account')).toBe(true))
    const urls = calls.map(c => c.url)
    expect(urls.indexOf('/api/month-close/2031-06/draft')).toBeLessThan(urls.indexOf('/api/spending/months/2031-06/account'))
    expect(calls.find(c => c.url === '/api/spending/months/2031-06/account')).toEqual({
      url: '/api/spending/months/2031-06/account', method: 'PUT', body: { bank: 'Quillmark Bank', member: 'Robin', items: [{ categoryId: 10, amount: 6500 }], base: [] },
    })
  })

  it('a total lowered below its lines blocks the close, names it and opens the panel on that account', async () => {
    stub(ready, withLines([{ categoryId: 2, amount: 5000 }]))
    renderScreen()
    const expense = await screen.findByLabelText('Expense: Quillmark Bank')
    await screen.findByRole('button', { name: 'Break down: Quillmark Bank' })
    await waitFor(() => expect(closable(screen.getByRole('button', { name: 'Close June 2031' }))).toBe(true))
    fireEvent.change(expense, { target: { value: '4000' } })
    const list = await screen.findByRole('list', { name: 'What prevents closing the month' })
    expect(list).toHaveTextContent(/“Quillmark Bank”: the lines by category \(5,000\) exceed the expenses \(4,000\)/)
    expect(closable(screen.getByRole('button', { name: 'Close June 2031' }))).toBe(false)
    expect(within(panel('Quillmark Bank')).getByText(/more than the total/)).toBeInTheDocument()
  })

  it('in privacy mode the obstacle of lines over a total hides its amounts', async () => {
    stubPrivacyOn()
    stub(ready, withLines([{ categoryId: 2, amount: 5000 }]))
    renderAdmin(<DataPage screen={MonthCloseView} />, { dashboard: true })
    const expense = await screen.findByLabelText('Expense: Quillmark Bank')
    await screen.findByRole('button', { name: 'Break down: Quillmark Bank' })
    fireEvent.change(expense, { target: { value: '4000' } })
    const list = await screen.findByRole('list', { name: 'What prevents closing the month' })
    expect(list).toHaveTextContent(/“Quillmark Bank”: the lines by category \(•••\) exceed the expenses \(•••\)/)
    expect(list).not.toHaveTextContent(/5,000|4,000/)
  })

  it('an unfinished amount is still in its field when the panel is opened again', async () => {
    stub(ready, withLines([]))
    renderScreen()
    fireEvent.click(await breakDown('Quillmark Bank'))
    fireEvent.click(within(panel('Quillmark Bank')).getByRole('button', { name: 'Add expense line' }))
    const amount = within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')
    typeText(amount, '12,')
    fireEvent.blur(amount, { relatedTarget: document.body })
    fireEvent.click(screen.getByRole('button', { name: 'Break down: Quillmark Bank' }))
    fireEvent.click(screen.getByRole('button', { name: 'Break down: Quillmark Bank' }))
    // the field keeps the text as typed ("12," reads "12.")
    expect(within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')).toHaveValue('12.')
    expect(screen.getByRole('list', { name: 'What prevents closing the month' })).toHaveTextContent('“Quillmark Bank”, breakdown by category: not a number')
  })

  it('leaving a panel field with a total not saved yet saves the draft once', async () => {
    const calls = stub(ready, withLines([]))
    renderScreen()
    fireEvent.click(await breakDown('Quillmark Bank'))
    fireEvent.change(screen.getByLabelText('Active income: Quillmark Bank'), { target: { value: '7000' } })
    fireEvent.click(within(panel('Quillmark Bank')).getByRole('button', { name: 'Add income line' }))
    const amount = within(panel('Quillmark Bank')).getByLabelText('Amount: Income line 1')
    fireEvent.change(amount, { target: { value: '6500' } })
    fireEvent.blur(amount, { relatedTarget: document.body })
    await waitFor(() => expect(calls.some(c => c.url === '/api/spending/months/2031-06/account')).toBe(true))
    expect(calls.filter(c => c.url.endsWith('/draft'))).toHaveLength(1)
  })

  it('closing with a total and a line not saved yet saves the draft once', async () => {
    const calls = stub(ready, withLines([]))
    renderScreen()
    fireEvent.click(await breakDown('Quillmark Bank'))
    vi.useFakeTimers()
    try {
      fireEvent.change(screen.getByLabelText('Expense: Quillmark Bank'), { target: { value: '6000' } })
      fireEvent.click(within(panel('Quillmark Bank')).getByRole('button', { name: 'Add expense line' }))
      fireEvent.change(within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1'), { target: { value: '100' } })
      fireEvent.click(screen.getByRole('button', { name: 'Close June 2031' }))
      for (let i = 0; i < 4; i++) await act(() => vi.advanceTimersByTimeAsync(0))
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(calls.map(c => c.url)).toContain('/api/month-close/2031-06/close'))
    expect(calls.map(c => c.url)).toEqual(['/api/month-close/2031-06/draft', '/api/spending/months/2031-06/account', '/api/month-close/2031-06/close'])
  })

  it('closing saves the lines still waiting for the pause before the month is closed', async () => {
    const calls = stub(ready, withLines([]))
    renderScreen()
    fireEvent.click(await breakDown('Quillmark Bank'))
    vi.useFakeTimers()
    try {
      fireEvent.click(within(panel('Quillmark Bank')).getByRole('button', { name: 'Add expense line' }))
      fireEvent.change(within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1'), { target: { value: '100' } })
      fireEvent.click(screen.getByRole('button', { name: 'Close June 2031' }))
      await act(() => vi.advanceTimersByTimeAsync(0))
      await act(() => vi.advanceTimersByTimeAsync(0))
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(calls.map(c => c.url)).toContain('/api/month-close/2031-06/close'))
    expect(calls.map(c => c.url)).toEqual(['/api/month-close/2031-06/draft', '/api/spending/months/2031-06/account', '/api/month-close/2031-06/close'])
  })

  it('a refused line save is said in the panel, and the bar does not say “Saved”', async () => {
    stub(ready, withLines([]), call => (call.url.includes('/account') ? jsonResponse({ error: { code: 'lines_exceed_total', params: { flow: 'expense', lines: 9000, total: 5280 } } }, 409) : undefined))
    renderScreen()
    fireEvent.click(await breakDown('Quillmark Bank'))
    fireEvent.click(within(panel('Quillmark Bank')).getByRole('button', { name: 'Add expense line' }))
    const amount = within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')
    fireEvent.change(amount, { target: { value: '100' } })
    fireEvent.blur(amount, { relatedTarget: document.body })
    expect(await within(panel('Quillmark Bank')).findByRole('alert')).toHaveTextContent(/^Not saved: /)
    expect(screen.queryByText(/Saved at/)).toBeNull()
  })

  it('lines changed elsewhere meanwhile: the save is refused, the panel drops its edit and shows the stored lines', async () => {
    const calls = stub(ready, withLines([{ categoryId: 2, amount: 300 }]), call => (call.url.includes('/account') ? jsonResponse({ error: { code: 'row_changed' } }, 409) : undefined))
    renderScreen()
    fireEvent.click(await breakDown('Quillmark Bank'))
    const amount = within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')
    fireEvent.change(amount, { target: { value: '100' } })
    fireEvent.blur(amount, { relatedTarget: document.body })
    await waitFor(() => expect(within(panel('Quillmark Bank')).getByRole('alert')).toHaveTextContent(/^Not saved: /))
    expect(calls.find(c => c.url.includes('/account'))?.body).toMatchObject({ items: [{ categoryId: 2, amount: 100 }], base: [{ categoryId: 2, amount: 300 }] })
    await waitFor(() => expect(within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')).toHaveValue('300'))
  })

  it('without categories offers the standard ones without leaving the wizard', async () => {
    const calls = stub(ready, { ...noSpending, categories: [reserved] })
    renderScreen()
    fireEvent.click(await breakDown('Quillmark Bank'))
    expect(within(panel('Quillmark Bank')).getByText('No categories yet.')).toBeInTheDocument()
    fireEvent.click(within(panel('Quillmark Bank')).getByRole('button', { name: 'Add standard categories' }))
    await waitFor(() => expect(calls.filter(c => c.url === '/api/spending/categories')).toHaveLength(19))
  })

  it('a broker account says what its flows are', async () => {
    stub({ ...ready, rows: [{ ...ready.rows[0], class: 'broker' }, ready.rows[1]] }, withLines([]))
    renderScreen()
    const cell = (await screen.findByText('Quillmark Bank')).closest('td')!
    expect(within(cell).getByText(/Deposits, trades and price changes are balance only/)).toBeInTheDocument()
    expect(within(screen.getByText('Deposit', { selector: '.close-table__account' }).closest('td')!).queryByText(/balance only/)).toBeNull()
  })
})

it('keeps pipe-colliding identities distinct in edited allocations', async () => {
  stub({ ...ready, rows: [
    { ...account('A|B'), member: 'C', ...filled },
    { ...account('A'), member: 'B|C', ...filled },
  ] }, { ...withLines([]), accounts: [] })
  renderScreen()
  fireEvent.click(await breakDown('A|B'))
  fireEvent.click(within(panel('A|B')).getByRole('button', { name: 'Add expense line' }))
  typeText(within(panel('A|B')).getByLabelText('Amount: Expense line 1'), '12,')
  fireEvent.click(await breakDown('A'))
  expect(within(panel('A')).queryByLabelText('Amount: Expense line 1')).toBeNull()
  fireEvent.click(await breakDown('A|B'))
  expect(within(panel('A|B')).getByLabelText('Amount: Expense line 1')).toHaveValue('12.')
})

it('waits for the newest allocation generation without overlapping account writes', async () => {
  let alloc!: ReturnType<typeof useAllocations>
  const first = deferred<Response>()
  const second = deferred<Response>()
  const writes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      writes.push(JSON.parse(String(init.body)))
      return writes.length === 1 ? first.promise : second.promise
    }
    return jsonResponse(withLines([]))
  }))
  function Harness() { alloc = useAllocations({ month: ready.month, enabled: true, beforeSave: async () => true }); return null }
  renderAdmin(<Harness />)
  await waitFor(() => expect(alloc.loaded).toBe(true))
  act(() => alloc.edit('Quillmark Bank', 'Robin', [{ categoryId: 2, amount: 100 }], false, []))
  let commit!: Promise<boolean>
  act(() => { commit = alloc.commit('Quillmark Bank', 'Robin') })
  await waitFor(() => expect(writes).toHaveLength(1))
  act(() => alloc.edit('Quillmark Bank', 'Robin', [{ categoryId: 2, amount: 200 }], false, []))
  let flush!: Promise<boolean>
  act(() => { flush = alloc.flush() })
  await act(async () => { await Promise.resolve() })
  expect(writes).toHaveLength(1)
  await act(async () => first.resolve(jsonResponse(withLines([{ categoryId: 2, amount: 100 }]))))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes[1]).toMatchObject({ items: [{ categoryId: 2, amount: 200 }] })
  expect(alloc.pending).toBe(true)
  expect(alloc.linesOf('Quillmark Bank', 'Robin')).toEqual([{ categoryId: 2, amount: 200 }])
  await act(async () => { second.resolve(jsonResponse(withLines([{ categoryId: 2, amount: 200 }]))); expect(await flush).toBe(true); expect(await commit).toBe(true) })
  expect(alloc.pending).toBe(false)
})

it('recovers draft and categories together, retaining both when the category read fails', async () => {
  let current = ready
  let spending = withLines([{ categoryId: 2, amount: 20 }])
  let failSpending = false
  const writes: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'PUT') { writes.push(url); return jsonResponse({ error: { code: 'draft_conflict' } }, 409) }
    if (url === '/api/spending') return failSpending ? jsonResponse({ error: 'categories offline' }, 500) : jsonResponse(spending)
    return jsonResponse(current)
  }))
  renderScreen()
  fireEvent.click(await breakDown('Quillmark Bank'))
  const amount = within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')
  typeText(amount, '12,')
  const balance = screen.getByLabelText('Balance: Quillmark Bank')
  fireEvent.change(balance, { target: { value: '777' } })
  fireEvent.blur(balance)
  await screen.findByText(/The saved draft changed/)
  const reload = async () => {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload saved draft' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved draft' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/categor/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard edits and reload' }))
  }
  current = { ...ready, month: '2031-07', queue: ['2031-07'], draftRevision: 'July', rows: ready.rows.map(r => ({ ...r, balance: 999 })) }
  failSpending = true
  await reload()
  await screen.findAllByText(/categories offline/)
  expect(balance).toHaveValue('777')
  expect(amount).toHaveValue('12.')
  expect(closable(screen.getByRole('button', { name: 'Close June 2031' }))).toBe(false)
  expect(writes).toHaveLength(1)
  failSpending = false
  spending = { ...spending, accounts: spending.accounts.map(a => ({ ...a, month: '2031-07', items: [{ categoryId: 2, amount: 80 }] })) }
  await reload()
  await screen.findByText('July 2031', { selector: '.close-queue__month' })
  expect(screen.getByLabelText('Balance: Quillmark Bank')).toHaveValue('999')
  fireEvent.click(await breakDown('Quillmark Bank'))
  expect(within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')).toHaveValue('80')
  expect(screen.queryByText(/There are unsaved changes/)).toBeNull()
})

it('keeps category edits typed during the draft recovery read', async () => {
  const reading = deferred()
  const draftGate = deferred<Response>()
  let recovering = false
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') return jsonResponse({ error: { code: 'draft_conflict' } }, 409)
    if (String(input) === '/api/spending') return jsonResponse(withLines([{ categoryId: 2, amount: 20 }]))
    if (recovering) { reading.resolve(); return draftGate.promise }
    return jsonResponse(ready)
  }))
  renderScreen()
  fireEvent.click(await breakDown('Quillmark Bank'))
  const amount = within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')
  fireEvent.change(amount, { target: { value: '100' } })
  const balance = screen.getByLabelText('Balance: Quillmark Bank')
  fireEvent.change(balance, { target: { value: '777' } })
  fireEvent.blur(balance)
  await screen.findByText(/The saved draft changed/)
  recovering = true
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved draft' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard edits and reload' }))
  await act(async () => reading.promise)
  fireEvent.change(amount, { target: { value: '222' } })
  await act(async () => draftGate.resolve(jsonResponse({ ...ready, draftRevision: 'fresh', rows: ready.rows.map(r => ({ ...r, balance: 999 })) })))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reload saved draft' })).toBeEnabled())
  expect(screen.getByLabelText('Balance: Quillmark Bank')).toHaveValue('777')
  expect(within(panel('Quillmark Bank')).getByLabelText('Amount: Expense line 1')).toHaveValue('222')
  expect(closable(screen.getByRole('button', { name: 'Close June 2031' }))).toBe(false)
})

it('shows an allocation acknowledgment after a failed staged recovery retained its base', async () => {
  let alloc!: ReturnType<typeof useAllocations>
  let failRead = false
  let spending = withLines([{ categoryId: 2, amount: 20 }])
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      spending = withLines(JSON.parse(String(init.body)).items)
      return jsonResponse(spending)
    }
    return failRead ? jsonResponse({ error: 'offline' }, 500) : jsonResponse(spending)
  }))
  function Harness() { alloc = useAllocations({ month: ready.month, enabled: true, beforeSave: async () => true }); return null }
  renderAdmin(<Harness />)
  await waitFor(() => expect(alloc.loaded).toBe(true))
  failRead = true
  await act(async () => expect(await alloc.prepareReload()).toBeNull())
  failRead = false
  act(() => alloc.edit('Quillmark Bank', 'Robin', [{ categoryId: 2, amount: 100 }], false, []))
  await act(async () => expect(await alloc.commit('Quillmark Bank', 'Robin')).toBe(true))
  expect(alloc.pending).toBe(false)
  expect(alloc.linesOf('Quillmark Bank', 'Robin')).toEqual([{ categoryId: 2, amount: 100 }])
})

it('retains an allocation acknowledgment when recovery waits for its pending write and then fails', async () => {
  const putGate = deferred<Response>()
  let alloc!: ReturnType<typeof useAllocations>
  let failRead = false
  let writes = 0
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') { writes++; return putGate.promise }
    return failRead ? jsonResponse({ error: 'recovery offline' }, 500) : jsonResponse(withLines([{ categoryId: 2, amount: 20 }]))
  }))
  function Harness() { alloc = useAllocations({ month: ready.month, enabled: true, beforeSave: async () => true }); return null }
  renderAdmin(<Harness />)
  await waitFor(() => expect(alloc.loaded).toBe(true))
  act(() => alloc.edit('Quillmark Bank', 'Robin', [{ categoryId: 2, amount: 100 }], false, []))
  let commit!: Promise<boolean>
  act(() => { commit = alloc.commit('Quillmark Bank', 'Robin') })
  await waitFor(() => expect(writes).toBe(1))
  failRead = true
  let recovery!: ReturnType<typeof alloc.prepareReload>
  act(() => { recovery = alloc.prepareReload() })
  // Resolve the write and staged read within one React batch: the acknowledgment must be usable before effects run.
  await act(async () => {
    putGate.resolve(jsonResponse(withLines([{ categoryId: 2, amount: 100 }])))
    expect(await commit).toBe(true)
    expect(await recovery).toBeNull()
  })
  expect(alloc.pending).toBe(false)
  expect(alloc.linesOf('Quillmark Bank', 'Robin')).toEqual([{ categoryId: 2, amount: 100 }])
  expect(alloc.allocatedOf('Quillmark Bank', 'Robin').expense).toBe(100)
})
