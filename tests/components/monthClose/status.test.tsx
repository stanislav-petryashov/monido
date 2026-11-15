import { screen } from '@testing-library/react'
import { base, renderScreen, stubState } from '../../helpers/monthClose'

describe('month close persistence announcement', () => {
  it('starts with an empty polite atomic status', async () => {
    stubState(base)
    renderScreen()
    await screen.findByLabelText('Balance: Quillmark Bank')
    const status = document.querySelector('[role=status][aria-live=polite]')!
    expect(status).toBeInTheDocument()
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('aria-atomic', 'true')
    expect(status).toBeEmptyDOMElement()
  })
})

import { act, renderHook } from '@testing-library/react'
import { useMonthCloseAnnouncement } from '../../../src/pages/admin/useMonthCloseAnnouncement'

const initial = { scope: 'month', dirty: false, busy: false, blocked: false, completed: '0:0', edited: '0:0' }
describe('announcement timing', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('announces only the newest settled completion and repeats it after clearing', () => {
    const { result, rerender } = renderHook(useMonthCloseAnnouncement, { initialProps: initial })
    rerender({ ...initial, dirty: true, busy: true })
    act(() => vi.advanceTimersByTime(599))
    expect(result.current).toBe('')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe('Saving…')
    rerender({ ...initial, completed: '1:0' })
    expect(result.current).toBe('')
    act(() => vi.advanceTimersByTime(149))
    expect(result.current).toBe('')
    rerender({ ...initial, dirty: true, completed: '1:0' })
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe('')
    rerender({ ...initial, completed: '2:0' })
    act(() => vi.advanceTimersByTime(150))
    expect(result.current).toBe('Saved')
    rerender({ ...initial, dirty: true, completed: '2:0' })
    expect(result.current).toBe('')
    rerender({ ...initial, completed: '2:1' })
    act(() => vi.advanceTimersByTime(150))
    expect(result.current).toBe('Saved')
  })
  it('clears and restarts saving delay for another edit while already busy', () => {
    const { result, rerender } = renderHook(useMonthCloseAnnouncement, { initialProps: initial })
    rerender({ ...initial, dirty: true, busy: true, edited: '1:0' })
    act(() => vi.advanceTimersByTime(600))
    expect(result.current).toBe('Saving…')
    rerender({ ...initial, dirty: true, busy: true, edited: '2:0' })
    expect(result.current).toBe('')
    act(() => vi.advanceTimersByTime(599))
    expect(result.current).toBe('')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe('Saving…')
  })
  it('drops pending success on block or scope change', () => {
    const { result, rerender } = renderHook(useMonthCloseAnnouncement, { initialProps: initial })
    rerender({ ...initial, completed: '1:0' })
    rerender({ ...initial, completed: '1:0', blocked: true })
    rerender({ ...initial, completed: '1:0' })
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe('')
    rerender({ ...initial, completed: '2:0' })
    rerender({ ...initial, scope: 'next', completed: '2:0' })
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe('')
  })
})

import { fireEvent, waitFor, within } from '@testing-library/react'
import { deferred, jsonResponse } from '../../helpers/http'
import { account, noSpending } from '../../helpers/monthClose'

it('announces allocation-only saves without draft timestamps or financial details, preserving focus', async () => {
  const state = { ...base, rows: [{ ...account('Sentinel Bank'), balance: 123456, active: 0, passive: 0, expense: 500 }], draftSavedAt: null }
  const records = { ...noSpending, categories: [{ id: 2, name: 'Housing', kind: 'mandatory', flow: 'expense', oneOff: false }], accounts: [{ month: '2031-06', bank: 'Sentinel Bank', member: 'Robin', currency: 'RUB', totals: { active: 0, passive: 0, expense: 500 }, items: [{ categoryId: 2, amount: 20 }], allocated: { active: 0, passive: 0, expense: 20 }, orphaned: false }] }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => jsonResponse(String(input).startsWith('/api/spending') ? records : state)))
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Break down: Sentinel Bank' }))
  const input = within(screen.getByRole('group', { name: 'Breakdown by category: Sentinel Bank' })).getByLabelText('Amount: Expense line 1')
  input.focus()
  fireEvent.change(input, { target: { value: '30' } })
  const status = document.querySelector('[role=status][aria-live=polite]')!
  await waitFor(() => expect(status).toHaveTextContent('Saved'), { timeout: 2500 })
  expect(status.textContent).toBe('Saved')
  expect(document.activeElement).toBe(input)
  fireEvent.change(input, { target: { value: '40' } })
  expect(status).toBeEmptyDOMElement()
  await waitFor(() => expect(status).toHaveTextContent('Saved'), { timeout: 2500 })
  expect(document.activeElement).toBe(input)
})

it('waits for the newest draft edit after an earlier acknowledgement', async () => {
  const first = deferred<Response>()
  const second = deferred<Response>()
  let writes = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') return ++writes === 1 ? first.promise : second.promise
    return jsonResponse(String(input) === '/api/spending' ? noSpending : base)
  }))
  renderScreen()
  const input = await screen.findByLabelText('Balance: Quillmark Bank')
  input.focus()
  fireEvent.change(input, { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
  await waitFor(() => expect(writes).toBe(1))
  fireEvent.change(input, { target: { value: '123457' } })
  await act(async () => first.resolve(jsonResponse({ ...base, draftRevision: 'revision-2' })))
  await waitFor(() => expect(writes).toBe(2))
  const status = document.querySelector('[role=status][aria-live=polite]')!
  expect(status).not.toHaveTextContent('Saved')
  await act(async () => second.resolve(jsonResponse({ ...base, draftRevision: 'revision-3' })))
  await waitFor(() => expect(status).toHaveTextContent('Saved'))
  expect(status.textContent).toBe('Saved')
  expect(document.activeElement).toBe(input)
})

const region = () => document.querySelector('[role=status][aria-live=polite]')!
const settleAnnouncement = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 200)) })

it('does not announce a failed draft until an explicit retry succeeds', async () => {
  const failure = deferred<Response>()
  const retry = deferred<Response>()
  let writes = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') return ++writes === 1 ? failure.promise : retry.promise
    return jsonResponse(String(input) === '/api/spending' ? noSpending : base)
  }))
  renderScreen()
  const input = await screen.findByLabelText('Balance: Quillmark Bank')
  input.focus()
  fireEvent.change(input, { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
  await waitFor(() => expect(writes).toBe(1))
  const status = region()
  await act(async () => failure.resolve(jsonResponse({ error: 'offline' }, 500)))
  await screen.findByText('Not saved: offline')
  await settleAnnouncement()
  expect(status).toBeEmptyDOMElement()
  expect(input).toHaveValue('123,456')
  expect(document.activeElement).toBe(input)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(writes).toBe(2))
  expect(region()).toBe(status)
  expect(status).toBeEmptyDOMElement()
  await act(async () => retry.resolve(jsonResponse({ ...base, draftRevision: 'retry-ok' })))
  await waitFor(() => expect(status).toHaveTextContent('Saved'))
  expect(document.activeElement).toBe(input)
})

it('keeps the status empty through conflict and confirmed reload, then announces a fresh save', async () => {
  const conflict = deferred<Response>()
  const recovery = deferred<Response>()
  const saved = deferred<Response>()
  let writes = 0
  let reads = 0
  const recovered = { ...base, rows: base.rows.map(r => ({ ...r, balance: 999 })), draftRevision: 'recovered' }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/spending') return jsonResponse(noSpending)
    if (init?.method === 'PUT') return ++writes === 1 ? conflict.promise : saved.promise
    if (String(input) === '/api/month-close') return ++reads === 1 ? jsonResponse(base) : recovery.promise
    return jsonResponse(base)
  }))
  renderScreen()
  const input = await screen.findByLabelText('Balance: Quillmark Bank')
  input.focus()
  fireEvent.change(input, { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
  await waitFor(() => expect(writes).toBe(1))
  const status = region()
  await act(async () => conflict.resolve(jsonResponse({ error: { code: 'draft_conflict' } }, 409)))
  await screen.findByText(/The saved draft changed/)
  await settleAnnouncement()
  expect(status).toBeEmptyDOMElement()
  expect(input).toHaveValue('123,456')
  expect(document.activeElement).toBe(input)
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved draft' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard edits and reload' }))
  await waitFor(() => expect(reads).toBe(2))
  expect(region()).toBe(status)
  expect(status).toBeEmptyDOMElement()
  await act(async () => recovery.resolve(jsonResponse(recovered)))
  await waitFor(() => expect(screen.getByLabelText('Balance: Quillmark Bank')).toHaveValue('999'))
  expect(region()).toBe(status)
  await settleAnnouncement()
  expect(status).toBeEmptyDOMElement()
  const fresh = screen.getByLabelText('Balance: Quillmark Bank')
  fresh.focus()
  fireEvent.change(fresh, { target: { value: '1000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
  await waitFor(() => expect(writes).toBe(2))
  await act(async () => saved.resolve(jsonResponse({ ...recovered, draftRevision: 'fresh' })))
  await waitFor(() => expect(status).toHaveTextContent('Saved'))
  expect(document.activeElement).toBe(fresh)
})

it('does not announce an old draft when reopening changes the month during its pending write', async () => {
  const oldWrite = deferred<Response>()
  const newWrite = deferred<Response>()
  const june = { ...base, lastClosed: { month: '2031-05', reopenable: true } }
  const may = { ...base, month: '2031-05', queue: ['2031-05', '2031-06'], draftRevision: 'may', rows: base.rows.map(r => ({ ...r, balance: 42 })), lastClosed: null }
  let writes = 0
  let reopens = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/spending') return jsonResponse(noSpending)
    if (init?.method === 'PUT') return ++writes === 1 ? oldWrite.promise : newWrite.promise
    if (String(input).endsWith('/reopen')) { reopens++; return jsonResponse(may) }
    return jsonResponse(june)
  }))
  renderScreen()
  const input = await screen.findByLabelText('Balance: Quillmark Bank')
  input.focus()
  fireEvent.change(input, { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
  await waitFor(() => expect(writes).toBe(1))
  const status = region()
  fireEvent.click(screen.getByRole('button', { name: 'Reopen May 2031' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reopen month' }))
  expect(reopens).toBe(0)
  expect(status).toBeEmptyDOMElement()
  await act(async () => oldWrite.resolve(jsonResponse({ ...june, draftRevision: 'june-ack' })))
  await screen.findByRole('button', { name: 'Close May 2031' })
  expect(reopens).toBe(1)
  expect(region()).toBe(status)
  await settleAnnouncement()
  expect(status).toBeEmptyDOMElement()
  const fresh = screen.getByLabelText('Balance: Quillmark Bank')
  expect(fresh).toHaveValue('42')
  fresh.focus()
  fireEvent.change(fresh, { target: { value: '43' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
  await waitFor(() => expect(writes).toBe(2))
  await act(async () => newWrite.resolve(jsonResponse({ ...may, draftRevision: 'may-ack' })))
  await waitFor(() => expect(status).toHaveTextContent('Saved'))
  expect(document.activeElement).toBe(fresh)
})

it('keeps Saving while draft settles and allocation work remains in flight', async () => {
  const draft = deferred<Response>()
  const allocation = deferred<Response>()
  const state = { ...base, rows: [{ ...account('Sentinel Bank'), balance: 10, active: 0, passive: 0, expense: 500 }] }
  const records = { ...noSpending, categories: [{ id: 2, name: 'Housing', kind: 'mandatory', flow: 'expense', oneOff: false }], accounts: [{ month: '2031-06', bank: 'Sentinel Bank', member: 'Robin', currency: 'RUB', totals: { active: 0, passive: 0, expense: 500 }, items: [{ categoryId: 2, amount: 20 }], allocated: { active: 0, passive: 0, expense: 20 }, orphaned: false }] }
  let draftWrites = 0
  let allocationWrites = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'PUT') {
      if (url.includes('/spending/')) { allocationWrites++; return allocation.promise }
      draftWrites++
      return draft.promise
    }
    return jsonResponse(url === '/api/spending' ? records : state)
  }))
  renderScreen()
  const balance = await screen.findByLabelText('Balance: Sentinel Bank')
  fireEvent.change(balance, { target: { value: '11' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
  await waitFor(() => expect(draftWrites).toBe(1))
  fireEvent.click(screen.getByRole('button', { name: 'Break down: Sentinel Bank' }))
  const input = within(screen.getByRole('group', { name: 'Breakdown by category: Sentinel Bank' })).getByLabelText('Amount: Expense line 1')
  input.focus()
  fireEvent.change(input, { target: { value: '30' } })
  fireEvent.blur(input)
  input.focus()
  const status = region()
  await waitFor(() => expect(status).toHaveTextContent('Saving…'), { timeout: 2000 })
  expect(allocationWrites).toBe(0)
  await act(async () => draft.resolve(jsonResponse({ ...state, rows: [{ ...state.rows[0], balance: 11 }], draftRevision: 'draft-ack' })))
  await waitFor(() => expect(allocationWrites).toBe(1))
  expect(region()).toBe(status)
  expect(status).toHaveTextContent('Saving…')
  expect(document.activeElement).toBe(input)
  await act(async () => allocation.resolve(jsonResponse(records)))
  await waitFor(() => expect(status).toHaveTextContent('Saved'))
  expect(status.textContent).toBe('Saved')
  expect(document.activeElement).toBe(input)
})
