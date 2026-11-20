import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { CatchUpState } from '../../../src/domain/api'
import { resetAuth } from '../../../src/lib/authState'
import { renderAdmin, stubPrivacyOn } from '../../helpers/render'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { MonthCloseView } from '../../../src/pages/admin/MonthCloseView'
import { base, closable, renderScreen, stubState } from '../../helpers/monthClose'

afterEach(() => { act(() => { resetAuth() }) })

// Back after a pause: June and July are open; the grid takes June, July is closed in the wizard
const grid: CatchUpState = {
  months: ['2031-06'], leftOut: null, newest: '2031-07',
  rows: [
    { name: 'Quillmark Bank', member: 'Robin', currency: 'RUB', class: 'bank', cells: [null] },
    { name: 'Deposit', member: 'Robin', currency: 'RUB', class: 'bank', cells: [null] },
  ],
  lastKnown: { '["Quillmark Bank","Robin"]': 5800, '["Deposit","Robin"]': 500 },
  revision: 'grid-1',
}
const offered = { ...base, catchUp: true }
const open = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Catch up 2 months' }))
  await screen.findByRole('region', { name: /Catch up/ })
}

describe('the catch-up grid', () => {
  it('is offered at two open months, not at one', async () => {
    stubState(offered, undefined, undefined, grid)
    renderScreen()
    expect(await screen.findByText(/You missed 2 months/)).toBeInTheDocument()
  })

  it('is not offered when the server has no grid (one open month, or the first already has data)', async () => {
    stubState({ ...base, queue: ['2031-06'], catchUp: false }, undefined, undefined, null)
    renderScreen()
    await screen.findByRole('list', { name: 'Month queue' })
    expect(screen.queryByRole('button', { name: /Catch up/ })).toBeNull()
  })

  it('shows the last known balance as a grey hint', async () => {
    stubState(offered, undefined, undefined, grid)
    renderScreen()
    await open()
    expect(screen.getByText('May 2031: 5,800')).toBeInTheDocument()
  })

  it('masks the hint in privacy mode', async () => {
    stubPrivacyOn()
    stubState(offered, undefined, undefined, grid)
    renderAdmin(<DataPage screen={MonthCloseView} />, { dashboard: true })
    await open()
    expect(screen.getAllByText('May 2031: •••')).toHaveLength(2)
    expect(screen.queryByText('May 2031: 5,800')).toBeNull()
  })

  it('keeps Close off until every cell has a value and names what is missing', async () => {
    stubState(offered, undefined, undefined, grid)
    renderScreen()
    await open()
    const close = screen.getByRole('button', { name: 'Close June 2031' })
    expect(closable(close)).toBe(false)
    expect(screen.getByText('June 2031: 2 accounts without a balance')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Quillmark Bank, June 2031'), { target: { value: '6000' } })
    fireEvent.change(screen.getByLabelText('Deposit, June 2031'), { target: { value: '-20' } })
    expect(closable(close)).toBe(true)
  })

  it('warns, without blocking, on a balance five times the one before', async () => {
    stubState(offered, undefined, undefined, grid)
    renderScreen()
    await open()
    fireEvent.change(screen.getByLabelText('Quillmark Bank, June 2031'), { target: { value: '58000' } })
    fireEvent.change(screen.getByLabelText('Deposit, June 2031'), { target: { value: '500' } })
    expect(screen.getByText(/10× more than in May\. Check the zeros/)).toBeInTheDocument()
    expect(closable(screen.getByRole('button', { name: 'Close June 2031' }))).toBe(true)
  })

  it('sends the typed cells and returns to the wizard on the newest month', async () => {
    const sent: unknown[] = []
    stubState(offered, (url, init) => {
      if (url === '/api/month-close/catch-up') sent.push(JSON.parse(String(init.body)))
      return { ...base, queue: ['2031-07'], catchUp: false, month: '2031-07' }
    }, undefined, grid)
    renderScreen()
    await open()
    fireEvent.change(screen.getByLabelText('Quillmark Bank, June 2031'), { target: { value: '6000' } })
    fireEvent.change(screen.getByLabelText('Deposit, June 2031'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close June 2031' }))
    expect(await screen.findByRole('list', { name: 'Month queue' })).toBeInTheDocument()
    expect(sent).toEqual([{ expectedRevision: 'grid-1', rows: [
      { name: 'Quillmark Bank', member: 'Robin', cells: [6000] }, { name: 'Deposit', member: 'Robin', cells: [0] },
    ] }])
  })

  it('says why a month is left to the wizard', async () => {
    stubState({ ...base, catchUp: true, queue: ['2031-05', '2031-06', '2031-07'], month: '2031-05' }, undefined, undefined, { ...grid, months: ['2031-05'], leftOut: '2031-06' })
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Catch up 3 months' }))
    expect(within(await screen.findByRole('region', { name: /Catch up/ })).getByText('June 2031 already has entries the table does not take (income, expenses or transfers): close it in the wizard.')).toBeInTheDocument()
  })

  it('keeps what was typed when going back to the wizard and opening the table again', async () => {
    stubState(offered, undefined, undefined, grid)
    renderScreen()
    await open()
    fireEvent.change(screen.getByLabelText('Quillmark Bank, June 2031'), { target: { value: '6000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back to the wizard' }))
    await open()
    expect(screen.getByLabelText('Quillmark Bank, June 2031')).toHaveValue('6,000')
  })

  it('opens the table afresh when its months changed meanwhile', async () => {
    let current: CatchUpState = grid
    stubState(offered, undefined, undefined, grid)
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/month-close/catch-up') return new Response(JSON.stringify({ grid: current }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url === '/api/spending') return new Response(JSON.stringify({ categories: [], accounts: [], sources: [], manual: null }), { status: 200, headers: { 'content-type': 'application/json' } })
      void init
      return new Response(JSON.stringify(offered), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    renderScreen()
    await open()
    fireEvent.change(screen.getByLabelText('Quillmark Bank, June 2031'), { target: { value: '6000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back to the wizard' }))
    current = { ...grid, months: ['2031-06', '2031-07'], newest: '2031-08', rows: grid.rows.map(r => ({ ...r, cells: [null, null] })), revision: 'grid-2' }
    await open()
    expect(await screen.findByLabelText('Quillmark Bank, July 2031')).toHaveValue('')
    expect(screen.getByLabelText('Quillmark Bank, June 2031')).toHaveValue('6,000')
  })

  it('a table that fails to load says so and leads back to the wizard', async () => {
    stubState(offered, undefined, undefined, grid)
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/month-close/catch-up') return new Response(JSON.stringify({ error: 'boom' }), { status: 500, headers: { 'content-type': 'application/json' } })
      if (url === '/api/spending') return new Response(JSON.stringify({ categories: [], accounts: [], sources: [], manual: null }), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify(offered), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Catch up 2 months' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Back to the wizard' }))
    expect(await screen.findByRole('list', { name: 'Month queue' })).toBeInTheDocument()
  })

  it('a close refused because the months changed says so, reads the table again and keeps what was typed', async () => {
    stubState(offered, undefined, undefined, grid)
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
      if (url === '/api/month-close/catch-up') return init?.method === 'POST' ? json({ error: { code: 'draft_conflict' } }, 409) : json({ grid })
      if (url === '/api/spending') return json({ categories: [], accounts: [], sources: [], manual: null })
      return json(offered)
    })
    renderScreen()
    await open()
    fireEvent.change(screen.getByLabelText('Quillmark Bank, June 2031'), { target: { value: '6000' } })
    fireEvent.change(screen.getByLabelText('Deposit, June 2031'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close June 2031' }))
    expect(await screen.findByText(/The missed months changed since the table was opened/)).toBeInTheDocument()
    expect(await screen.findByLabelText('Quillmark Bank, June 2031')).toHaveValue('6,000')
  })

  it('marks a cell holding text that is not a number', async () => {
    stubState(offered, undefined, undefined, grid)
    renderScreen()
    await open()
    const cell = screen.getByLabelText('Quillmark Bank, June 2031')
    fireEvent.change(cell, { target: { value: '-' } })
    expect(cell).toHaveAttribute('aria-invalid', 'true')
  })

  it('a grid no longer offered takes the user back to the wizard, not to an error', async () => {
    stubState(offered, undefined, undefined, null)
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Catch up 2 months' }))
    expect(await screen.findByRole('list', { name: 'Month queue' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retry|Try again/ })).toBeNull()
  })

  it('is not offered while the wizard holds input it could not save', async () => {
    stubState(offered, url => { if (url.endsWith('/draft')) throw new Error('down'); return offered }, undefined, grid)
    renderScreen()
    await screen.findByRole('button', { name: 'Catch up 2 months' })
    const field = screen.getByLabelText('Balance: Quillmark Bank')
    fireEvent.change(field, { target: { value: '7' } })
    fireEvent.blur(field)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Catch up 2 months' })).toBeNull())
  })
})
