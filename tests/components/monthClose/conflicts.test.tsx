import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { DraftRequest, MonthCloseState, SpendingRecords } from '../../../src/domain/api'
import { navigate } from '../../../src/lib/router'
import { useMonthClose } from '../../../src/pages/admin/useMonthClose'
import { monthCloseQuery } from '../../../src/pages/admin/adminQuery'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { MonthCloseView } from '../../../src/pages/admin/MonthCloseView'
import { accountKey } from '../../../src/domain/accounts'
import { deferred, jsonResponse } from '../../helpers/http'
import { base, noSpending, renderScreen, closable } from '../../helpers/monthClose'
import { typeText } from '../../helpers/adminScreens'
import { renderAdmin, testClient } from '../../helpers/render'

const ready: MonthCloseState = { ...base, problems: [], rows: base.rows.map(r => ({ ...r, balance: 1, active: 0, passive: 0, expense: 0 })) }

it('serializes different edit generations and closes only after the newest acknowledgment', async () => {
  let m!: ReturnType<typeof useMonthClose>
  function Harness() { m = useMonthClose(); return null }
  const gates = [deferred<Response>(), deferred<Response>()]
  const puts: DraftRequest[] = []
  const closes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') { puts.push(JSON.parse(String(init.body))); return gates[puts.length - 1].promise }
    if (String(input).endsWith('/close')) { closes.push(JSON.parse(String(init?.body))); return jsonResponse(ready) }
    return jsonResponse(ready)
  }))
  renderAdmin(<Harness />)
  await waitFor(() => expect(m.loaded).toBe(true))
  act(() => m.edit(accountKey('Quillmark Bank', 'Robin'), 'balance', 100))
  let save!: Promise<MonthCloseState | null>
  act(() => { save = m.save() })
  await waitFor(() => expect(puts).toHaveLength(1))
  act(() => m.edit(accountKey('Quillmark Bank', 'Robin'), 'balance', 200))
  let close!: Promise<unknown>
  act(() => { close = m.close() })
  await act(async () => { await Promise.resolve() })
  expect(puts).toHaveLength(1)
  await act(async () => gates[0].resolve(jsonResponse({ ...ready, rows: puts[0].rows, draftRevision: 'ack-A' })))
  await waitFor(() => expect(puts).toHaveLength(2))
  expect(puts[1]).toMatchObject({ expectedRevision: 'ack-A', rows: expect.arrayContaining([expect.objectContaining({ balance: 200 })]) })
  expect(m.rows[0].balance).toBe(200)
  expect(m.dirty).toBe(true)
  expect(closes).toEqual([])
  await act(async () => { gates[1].resolve(jsonResponse({ ...ready, rows: puts[1].rows, draftRevision: 'ack-B' })); await save; await close })
  expect(closes).toEqual([{ expectedRevision: 'ack-B' }])
  expect(m.dirty).toBe(false)
})

it('offers explicit recovery after conflict: cancel and failed reads retain input, success adopts the server', async () => {
  let current = ready
  let failRead = false
  let writes = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/spending') return jsonResponse(noSpending)
    if (init?.method === 'PUT') { writes++; return jsonResponse({ error: { code: 'draft_conflict' } }, 409) }
    return failRead ? jsonResponse({ error: 'offline' }, 500) : jsonResponse(current)
  }))
  renderScreen()
  const field = await screen.findByLabelText('Balance: Quillmark Bank')
  typeText(field, '12,')
  fireEvent.blur(field)
  await screen.findByText(/The saved draft changed/)
  expect(closable(screen.getByRole('button', { name: 'Close June 2031' }))).toBe(false)
  expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
  const recover = async () => {
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload saved draft' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved draft' }))
  }
  await recover()
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  expect(field).toHaveValue('12.')
  failRead = true
  await recover()
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard edits and reload' }))
  await screen.findByText(/offline/)
  expect(field).toHaveValue('12.')
  expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
  failRead = false
  current = { ...ready, rows: ready.rows.map(r => ({ ...r, balance: 999 })), draftRevision: 'server-B' }
  await recover()
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard edits and reload' }))
  await waitFor(() => expect(screen.getByLabelText('Balance: Quillmark Bank')).toHaveValue('999'))
  expect(closable(screen.getByRole('button', { name: 'Close June 2031' }))).toBe(true)
  fireEvent.change(screen.getByLabelText('Balance: Quillmark Bank'), { target: { value: '1000' } })
  fireEvent.blur(screen.getByLabelText('Balance: Quillmark Bank'))
  await waitFor(() => expect(writes).toBe(2))
})

it('keeps the visible base through background refreshes and gives safe recovery wording after a lost response', async () => {
  const client = testClient()
  const bodies: DraftRequest[] = []
  let current = ready
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/spending') return jsonResponse(noSpending)
    if (init?.method === 'PUT') {
      bodies.push(JSON.parse(String(init.body)))
      if (bodies.length > 1) return jsonResponse({ error: { code: 'draft_conflict' } }, 409)
      current = { ...ready, rows: bodies[0].rows, draftRevision: 'committed' }
      throw new Error('lost response')
    }
    return jsonResponse(current)
  }))
  renderAdmin(<DataPage screen={MonthCloseView} />, { client })
  const field = await screen.findByLabelText('Balance: Quillmark Bank')
  typeText(field, '12,')
  await act(async () => { client.setQueryData(monthCloseQuery.queryKey, { ...ready, rows: ready.rows.map(r => ({ ...r, balance: 999 })), draftRevision: 'other' }) })
  expect(field).toHaveValue('12.')
  fireEvent.blur(field)
  await screen.findByText('Not saved: The server is unreachable')
  expect(screen.getByText(/may already have been saved/)).toBeInTheDocument()
  expect(field).toHaveValue('12.')
  expect(bodies[0].expectedRevision).toBe(ready.draftRevision)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText(/The saved draft changed/)
  expect(bodies[1].expectedRevision).toBe(ready.draftRevision)
  expect(field).toHaveValue('12.')
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved draft' }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard edits and reload' }))
  await waitFor(() => expect(screen.getByLabelText('Balance: Quillmark Bank')).toHaveValue(''))
})

it('does not adopt refreshed totals when coordinated category recovery fails with no draft edits', async () => {
  let m!: ReturnType<typeof useMonthClose>
  let current = ready
  function Harness() { m = useMonthClose(); return null }
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(current)))
  renderAdmin(<Harness />)
  await waitFor(() => expect(m.loaded).toBe(true))
  current = { ...ready, month: '2031-07', draftRevision: 'new-month' }
  let recovery!: Promise<boolean>
  act(() => { recovery = m.reloadDiscardingEdits(async () => null) })
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard edits and reload' }))
  await act(async () => expect(await recovery).toBe(false))
  expect(m.state?.month).toBe('2031-06')
  expect(m.state?.draftRevision).toBe(ready.draftRevision)
})


it('retains incomplete numeric text through an older acknowledgment and a subsequent save error', async () => {
  const gate = deferred<Response>()
  const puts: DraftRequest[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/spending') return jsonResponse(noSpending)
    if (init?.method === 'PUT') {
      puts.push(JSON.parse(String(init.body)))
      return puts.length === 1 ? gate.promise : jsonResponse({ error: 'offline' }, 500)
    }
    return jsonResponse(ready)
  }))
  renderScreen()
  const field = await screen.findByLabelText('Balance: Quillmark Bank')
  fireEvent.change(field, { target: { value: '100' } })
  fireEvent.blur(field)
  await waitFor(() => expect(puts).toHaveLength(1))
  typeText(field, '12,')
  await act(async () => gate.resolve(jsonResponse({ ...ready, rows: puts[0].rows, draftRevision: 'ack-A' })))
  await screen.findByText('Not saved: offline')
  expect(puts[1].expectedRevision).toBe('ack-A')
  expect(puts[1].rows[0].balance).toBeNull()
  expect(field).toHaveValue('12.')
  expect(field).toHaveAttribute('aria-invalid', 'true')
})


it('protects incomplete amount text from navigation and browser unload after its numeric draft saves', async () => {
  let saves = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/spending') return jsonResponse(noSpending)
    if (init?.method === 'PUT') saves++
    return jsonResponse(init?.method === 'PUT' ? { ...ready, rows: JSON.parse(String(init.body)).rows } : ready)
  }))
  history.replaceState(null, '', '/close')
  renderScreen()
  const field = await screen.findByLabelText('Balance: Quillmark Bank')
  typeText(field, '12,')
  fireEvent.blur(field)
  await waitFor(() => expect(saves).toBe(1))
  await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull())
  act(() => navigate('/goals'))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  expect(location.pathname).toBe('/close')
  expect(field).toHaveValue('12.')
  field.focus()
  expect(field).toHaveFocus()
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
})


it.each(['invalid', 'saving'])('protects %s category lines with clean month totals', async state => {
  const gate = deferred<Response>()
  const totals = { ...ready, rows: ready.rows.map(r => ({ ...r, active: 100 })) }
  const records: SpendingRecords = { ...noSpending,
    categories: [{ id: 10, name: 'Salary', kind: 'optional', flow: 'active', oneOff: false }],
    accounts: [{ month: '2031-06', bank: 'Quillmark Bank', member: 'Robin', currency: 'RUB',
      totals: { active: 100, passive: 0, expense: 0 }, items: [],
      allocated: { active: 0, passive: 0, expense: 0 }, orphaned: false }],
  }
  let writes = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') { writes++; return gate.promise }
    return jsonResponse(String(input) === '/api/spending' ? records : totals)
  }))
  history.replaceState(null, '', '/close')
  renderScreen()
  fireEvent.click(await screen.findByRole('button', { name: 'Break down: Quillmark Bank' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add income line' }))
  const field = screen.getByLabelText('Amount: Income line 1')
  typeText(field, state === 'invalid' ? '12,' : '50')
  if (state === 'saving') {
    fireEvent.blur(field, { relatedTarget: document.body })
    await waitFor(() => expect(writes).toBe(1))
  }
  act(() => navigate('/goals'))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  expect(location.pathname).toBe('/close')
  expect(field).toHaveValue(state === 'invalid' ? '12.' : '50')
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  if (state === 'saving') await act(async () => gate.resolve(jsonResponse(records)))
})
