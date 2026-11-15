import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { MonthCloseView } from '../../../src/pages/admin/MonthCloseView'
import type { DraftRequest, MonthCloseState } from '../../../src/domain/api'
import { jsonResponse } from '../../helpers/http'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { renderAdmin, stubPrivacyOn, testClient } from '../../helpers/render'
import { account, barFigure, base, closable, obstacleLines, renderScreen, stubState } from '../../helpers/monthClose'
import { typeText } from '../../helpers/adminScreens'
import { fmtCompactCurrency, fmtNum } from '../../../src/lib/formatters'
import { ru, withLanguage } from '../../helpers/i18n'

afterEach(() => { resetAuth() })

describe('Month-close wizard', () => {
  it('keeps detailed entry guidance in a disclosure and names the zero-flow action clearly', async () => {
    stubState(base)
    renderScreen()
    const help = await screen.findByText('What counts as income or expenses?')
    expect(help.closest('details')).not.toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'No income or expenses: Quillmark Bank' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument()
  })

  it('a viewer sees the queue and the note, but no inputs, close, reopen or draft save', async () => {
    stubState({ ...base, lastClosed: { month: '2031-05', reopenable: true } })
    setAuth({ me: { name: 'Robin', rights: { edit: false, vote: true, manage: false } } })
    renderScreen()
    expect(await screen.findByRole('list', { name: 'Month queue' })).toBeInTheDocument()
    expect(screen.getByText('View only: editing is unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Close / })).toBeNull()
    expect(screen.queryByRole('button', { name: /Reopen/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /draft/i })).toBeNull()
    // the bar still gives the figure; the progress card's segments are marks with nothing to jump to
    expect(barFigure()).toBe('0 of 2accounts filled')
    expect(document.querySelectorAll('button.close-seg')).toHaveLength(0)
    expect(document.querySelectorAll('i.close-seg')).toHaveLength(2)
  })

  it('a filled row with no money moving shows a grey “no activity” chip in place of the button', async () => {
    const rows = [{ ...base.rows[0], balance: 1, active: 0, passive: 0, expense: 0 }, { ...base.rows[1], balance: 1, active: 0, passive: 0 }]
    stubState({ ...base, rows, problems: [] })
    renderScreen()
    const bank = (await screen.findByText('Quillmark Bank', { selector: '.close-table__account' })).closest('tr')!
    expect(within(bank).getByText('no activity')).toHaveClass('chip')
    expect(within(bank).queryByRole('button', { name: /No income or expenses/ })).toBeNull()
    // a row still missing a flow keeps the button
    expect(screen.getByRole('button', { name: 'No income or expenses: Deposit' })).toBeInTheDocument()
    // an amount moving again brings the button back
    fireEvent.change(screen.getByLabelText('Expense: Quillmark Bank'), { target: { value: '7' } })
    expect(within(bank).queryByText('no activity')).toBeNull()
    expect(screen.getByRole('button', { name: 'No income or expenses: Quillmark Bank' })).toBeInTheDocument()
  })

  it('privacy mode masks last month in the meta line and the placeholder; the input stays unmasked', async () => {
    stubPrivacyOn()
    stubState(base)
    renderAdmin(<DataPage screen={MonthCloseView} />, { dashboard: true })
    expect(closable(await screen.findByRole('button', { name: 'Close June 2031' }))).toBe(false)
    expect(screen.getAllByText('RUB · Bank · in May: •••')).toHaveLength(2)
    expect(screen.getByLabelText('Balance: Quillmark Bank')).toHaveAttribute('placeholder', '•••')
    expect(screen.queryByText(/5,800/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Balance: Quillmark Bank'), { target: { value: '1200' } })
    expect(screen.getByLabelText('Balance: Quillmark Bank')).toHaveValue('1,200')
  })

  it('privacy mode masks the read-only cells a viewer sees', async () => {
    stubPrivacyOn()
    const row = { ...account('Deposit'), balance: 12345.67 }
    stubState({ ...base, rows: [row], problems: [] })
    setAuth({ me: { name: 'Robin', rights: { edit: false, vote: true, manage: false } } })
    renderAdmin(<DataPage screen={MonthCloseView} />, { dashboard: true })
    const cell = (await screen.findByText('Deposit', { selector: '.close-table__account' })).closest('tr')!
    expect(cell).toHaveTextContent('•••')
    expect(cell).not.toHaveTextContent(/12,345/)
  })

  it('shows the queue with the first month current and the rest waiting', async () => {
    stubState(base)
    renderScreen()
    const steps = within(await screen.findByRole('list', { name: 'Month queue' })).getAllByRole('listitem')
    expect(steps.map(s => s.textContent)).toEqual(['June 2031 · closing', 'July 2031 · waits in the queue'])
    expect(steps[0]).toHaveAttribute('aria-current', 'step')
  })

  it('keeps “Close June 2031” disabled while fields are empty and shows last month as a placeholder, not a value', async () => {
    stubState(base)
    renderScreen()
    expect(closable(await screen.findByRole('button', { name: 'Close June 2031' }))).toBe(false)
    expect(screen.getByLabelText('Balance: Quillmark Bank')).toHaveValue('')
    expect(screen.getByLabelText('Balance: Quillmark Bank')).toHaveAttribute('placeholder', fmtNum(5800, 2))
    expect(screen.getByText('RUB · Bank · in May: 5,800')).toBeInTheDocument()
    expect(barFigure()).toBe('0 of 2accounts filled')
  })

  it('the count line names one account in the singular: the noun follows the total', async () => {
    stubState({ ...base, rows: [account('Deposit')], problems: [base.problems[1]] })
    renderScreen()
    await screen.findByLabelText('Balance: Deposit')
    expect(barFigure()).toBe('0 of 1account filled')
  })

  it('saves the draft when a field is left and shows the totals the server returned', async () => {
    const requests: { url: string; body: unknown }[] = []
    stubState(base, (url, init) => { requests.push({ url, body: JSON.parse(String(init.body)) }); return { ...base, draftSavedAt: '2031-10-05T11:32:00Z', totals: [{ currency: 'RUB', income: 0, expense: 0, balanceChange: 300 }] } })
    renderScreen()
    const field = await screen.findByLabelText('Balance: Quillmark Bank')
    fireEvent.change(field, { target: { value: '9500,5' } })
    fireEvent.blur(field)
    await screen.findByText(/Saved at/)
    expect(requests[0].url).toBe('/api/month-close/2031-06/draft')
    expect(requests[0].body).toMatchObject({ expectedRevision: base.draftRevision })
    expect((requests[0].body as { rows: { name: string; balance: number }[] }).rows.find(r => r.name === 'Quillmark Bank')?.balance).toBe(9500.5)
    expect(screen.getByText(/balance change \+300\.00/)).toBeInTheDocument()
  })

  it('“No income or expenses” fills the three flows with zeros and leaves the balance for the person', async () => {
    stubState(base, () => base)
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'No income or expenses: Quillmark Bank' }))
    for (const col of ['Active income', 'Passive income', 'Expense']) expect(screen.getByLabelText(`${col}: Quillmark Bank`)).toHaveValue('0')
    expect(screen.getByLabelText('Balance: Quillmark Bank')).toHaveValue('')
  })

  it('without cash flow the wizard asks only for the balance', async () => {
    stubState({ ...base, flows: false, totals: [{ currency: 'RUB', income: 0, expense: 0, balanceChange: 300 }] })
    renderScreen()
    expect(await screen.findByRole('columnheader', { name: 'Balance' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Expense' })).toBeNull()
    expect(screen.queryByRole('button', { name: /No income or expenses/ })).toBeNull()
    expect(screen.queryByLabelText('Expense: Quillmark Bank')).toBeNull()
    expect(screen.getByText(/balance change \+300\.00/)).toBeInTheDocument()
    expect(screen.queryByText(/income 0 ·/)).toBeNull()
  })

  it('saves by itself shortly after a change made with a button, without waiting for a field to lose focus', async () => {
    const urls: string[] = []
    stubState(base, url => { urls.push(url); return base })
    renderScreen()
    const noActivity = await screen.findByRole('button', { name: 'No income or expenses: Quillmark Bank' })
    vi.useFakeTimers()
    try {
      fireEvent.click(noActivity)
      expect(urls).toEqual([])
      await act(() => vi.advanceTimersByTimeAsync(800))
      expect(urls).toEqual(['/api/month-close/2031-06/draft'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('autosaves 800 ms after the last edit, not before', async () => {
    const urls: string[] = []
    stubState(base, url => { urls.push(url); return base })
    renderScreen()
    const field = await screen.findByLabelText('Balance: Quillmark Bank')
    vi.useFakeTimers()
    try {
      fireEvent.change(field, { target: { value: '1' } })
      await act(() => vi.advanceTimersByTimeAsync(500))
      fireEvent.change(field, { target: { value: '12' } })
      await act(() => vi.advanceTimersByTimeAsync(799))
      expect(urls).toEqual([])
      await act(() => vi.advanceTimersByTimeAsync(1))
      expect(urls).toEqual(['/api/month-close/2031-06/draft'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps what was typed while an autosave was in flight, and saves it next', async () => {
    const bodies: DraftRequest[] = []
    const answers: ((state: MonthCloseState) => void)[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') return jsonResponse(base)
      bodies.push(JSON.parse(String(init.body)))
      return new Promise<Response>(resolve => answers.push(state => resolve(jsonResponse(state))))
    }))
    renderScreen()
    const field = await screen.findByLabelText('Balance: Quillmark Bank')
    const balance = (body: DraftRequest) => body.rows.find(r => r.name === 'Quillmark Bank')?.balance
    vi.useFakeTimers()
    try {
      fireEvent.change(field, { target: { value: '100' } })
      await act(() => vi.advanceTimersByTimeAsync(800))
      expect(bodies).toHaveLength(1)
      fireEvent.change(field, { target: { value: '200' } })
      // the server answers the first save with the draft it was sent: 100
      answers[0]({ ...base, rows: base.rows.map(r => (r.name === 'Quillmark Bank' ? { ...r, balance: 100 } : r)) })
      await act(() => vi.advanceTimersByTimeAsync(800))
      expect(bodies).toHaveLength(2)
      expect(field).toHaveValue('200')
      expect(balance(bodies[0])).toBe(100)
      expect(balance(bodies[1])).toBe(200)
      answers[1]({ ...base, rows: bodies[1].rows })
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(screen.queryByText('There are unsaved changes')).toBeNull()
      expect(field).toHaveValue('200')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a stored amount grouped and groups one as it is typed, two decimals at most', async () => {
    stubState({ ...base, rows: [{ ...account('Quillmark Bank'), balance: 12500 }, account('Deposit')] })
    renderScreen()
    expect(await screen.findByLabelText('Balance: Quillmark Bank')).toHaveValue('12,500')
    const field = screen.getByLabelText('Balance: Deposit')
    fireEvent.change(field, { target: { value: '1234567,5' } })
    expect(field).toHaveValue('1,234,567.5')
    typeText(field, '55', { append: true })
    expect(field).toHaveValue('1,234,567.55')
    fireEvent.blur(field)
    expect(field).toHaveValue('1,234,567.55')
    // pasted, an extra decimal is rounded instead of cut
    fireEvent.change(field, { target: { value: '1234567,555' } })
    expect(field).toHaveValue('1,234,567.56')
  })

  it('marks an amount left unfinished ("12.") and does not send a guess', async () => {
    const bodies: { rows: { name: string; balance: number | null }[] }[] = []
    stubState(base, (_url, init) => { bodies.push(JSON.parse(String(init.body))); return base })
    renderScreen()
    const field = await screen.findByLabelText('Balance: Quillmark Bank')
    typeText(field, '12,')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    const list = screen.getByRole('list', { name: 'What prevents closing the month' })
    expect(obstacleLines(list)).toEqual(['“Quillmark Bank”, balance: not a number', 'Not started: Deposit'])
    // the account's name is a link to its fields
    expect(within(list).getByRole('link', { name: '“Quillmark Bank”' })).toHaveAttribute('href', `#${field.id}`)
    fireEvent.blur(field)
    await waitFor(() => expect(bodies.length).toBeGreaterThan(0))
    expect(bodies[0].rows.find(r => r.name === 'Quillmark Bank')?.balance).toBeNull()
    expect(field).toHaveValue('12.')
  })

  it('a stored three-decimal amount is not marked as unreadable, and is sent unchanged', async () => {
    const bodies: { rows: { name: string; balance: number | null }[] }[] = []
    const state = { ...base, rows: [{ ...account('Quillmark Bank'), balance: 1234.125 }, account('Deposit')] }
    stubState(state, (_url, init) => { bodies.push(JSON.parse(String(init.body))); return state })
    renderScreen()
    const field = await screen.findByLabelText('Balance: Quillmark Bank')
    expect(field).not.toHaveAttribute('aria-invalid')
    fireEvent.focus(field)
    fireEvent.blur(field)
    fireEvent.focus(screen.getByLabelText('Balance: Deposit'))
    fireEvent.change(screen.getByLabelText('Balance: Deposit'), { target: { value: '5' } })
    fireEvent.blur(screen.getByLabelText('Balance: Deposit'))
    await waitFor(() => expect(bodies.length).toBeGreaterThan(0))
    expect(bodies[0].rows.find(r => r.name === 'Quillmark Bank')?.balance).toBe(1234.125)
    // typed, a third decimal is dropped: never a thousand, never unreadable
    typeText(field, '1234,125')
    expect(field).toHaveValue('1,234.12')
    expect(field).not.toHaveAttribute('aria-invalid')
  })
})

describe('Month-close wizard: one ruled table per member', () => {
  /** The snapshot answers with the family in its own order (not the wizard's sorted list): the tints follow it */
  const withFamily = (members: string[]) => {
    const inner = fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/snapshot' ? Promise.resolve(jsonResponse({ members })) : inner(input, init)))
  }
  const cards = () => [...document.querySelectorAll('section.close-owner')]

  it('two members: a card each, in the rows’ order, with the initial on the member’s tint and a header of its own', async () => {
    stubState({ ...base, rows: [account('Quillmark Bank'), { ...account('Deposit'), member: 'Alex' }], members: ['Alex', 'Robin'] })
    withFamily(['Robin', 'Alex'])
    renderScreen()
    await screen.findByLabelText('Balance: Quillmark Bank')
    await waitFor(() => expect(document.querySelector('.close-owner__head .lane__avatar--tinted')).not.toBeNull())
    expect(cards()).toHaveLength(2)
    const [robin, alex] = cards()
    expect(robin).toHaveClass('card')
    expect(robin).toHaveAccessibleName('Robin')
    expect(robin.querySelector('.close-owner__head .lane__avatar')).toHaveTextContent('R')
    expect(robin.querySelector<HTMLElement>('.close-owner__head .lane__avatar')!.style.getPropertyValue('--tag')).toBe('var(--member-1)')
    expect(alex.querySelector<HTMLElement>('.close-owner__head .lane__avatar')!.style.getPropertyValue('--tag')).toBe('var(--member-2)')
    expect(within(alex as HTMLElement).getByText('Alex', { selector: 'h2' })).toBeInTheDocument()
    for (const card of cards()) expect(card.querySelectorAll('thead')).toHaveLength(1)
    expect(within(robin as HTMLElement).getByLabelText('Balance: Quillmark Bank')).toBeInTheDocument()
    expect(within(alex as HTMLElement).getByLabelText('Balance: Deposit')).toBeInTheDocument()
  })

  it('one member: one card, no head', async () => {
    stubState(base)
    renderScreen()
    await screen.findByLabelText('Balance: Quillmark Bank')
    expect(cards()).toHaveLength(1)
    expect(document.querySelector('.close-owner__head')).toBeNull()
  })

  it('a filled row starts its name with a check; an unfilled one has none', async () => {
    stubState({ ...base, rows: [account('Quillmark Bank'), { ...account('Deposit'), balance: 1, active: 0, passive: 0, expense: 0 }] })
    renderScreen()
    const deposit = await screen.findByText('Deposit', { selector: '.close-table__account' })
    expect(deposit.firstElementChild).toBe(within(deposit).getByRole('img', { name: 'filled' }))
    expect(within(screen.getByText('Quillmark Bank', { selector: '.close-table__account' })).queryByRole('img')).toBeNull()
  })

  it('the balance holds last month’s figure as its placeholder; the flows hold none; the meta line names it', async () => {
    stubState(base)
    renderScreen()
    expect(await screen.findByLabelText('Balance: Quillmark Bank')).toHaveAttribute('placeholder', fmtNum(5800, 2))
    expect(screen.getByLabelText('Expense: Quillmark Bank')).not.toHaveAttribute('placeholder')
    const meta = screen.getByText('RUB · Bank · in May: 5,800')
    expect(meta).toHaveClass('close-table__meta')
    // the figure is no longer a line of its own
    expect(document.querySelector('.close-table__hint')).toBeNull()
  })

  it('without last month the meta line is the currency and the kind', async () => {
    stubState({ ...base, hints: {} })
    renderScreen()
    expect(await screen.findByLabelText('Balance: Quillmark Bank')).not.toHaveAttribute('placeholder')
    expect(screen.getAllByText('RUB · Bank')).toHaveLength(2)
  })

  it('a started row says “not filled” under each empty field, not a line under the name', async () => {
    stubState({ ...base, rows: [{ ...account('Quillmark Bank'), balance: 1 }, account('Deposit')] })
    renderScreen()
    await screen.findByLabelText('Balance: Quillmark Bank')
    const bank = screen.getByText('Quillmark Bank', { selector: '.close-table__account' }).closest('tr')!
    expect(within(bank).getAllByText('not filled')).toHaveLength(3)
    expect(within(bank).queryByText(/^Not filled in/)).toBeNull()
    expect(document.querySelector('.close-table__missing')).toBeNull()
  })

  it('at full width the text actions are quiet buttons, not row-menu items', async () => {
    stubState(base, () => base)
    renderScreen()
    expect(await screen.findByRole('button', { name: 'No income or expenses: Quillmark Bank' })).toHaveClass('btn', 'btn--quiet')
    fireEvent.click(screen.getByRole('button', { name: 'Actions: Quillmark Bank' }))
    expect(screen.queryByRole('menuitem', { name: 'No income or expenses' })).toBeNull()
  })

  it('below 1200px “No income or expenses” is in the row menu, and works from there', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 1199px)', addEventListener: () => {}, removeEventListener: () => {} }))
    stubState(base, () => base)
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Quillmark Bank' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'No income or expenses' }))
    for (const col of ['Active income', 'Passive income', 'Expense']) expect(screen.getByLabelText(`${col}: Quillmark Bank`)).toHaveValue('0')
  })
})

describe('Month-close wizard and reads still in flight', () => {
  const ready = { ...base, problems: [], rows: base.rows.map(r => ({ ...r, balance: 1, active: 0, passive: 0, expense: 0 })) }
  const withExpense = (state: MonthCloseState, expense: number) =>
    ({ ...state, rows: state.rows.map(r => (r.name === 'Quillmark Bank' ? { ...r, expense } : r)) })

  it('opened again with a cached state, waits for its own read before the fields can be edited', async () => {
    const client = testClient()
    stubState(base)
    const first = renderAdmin(<DataPage screen={MonthCloseView} />, { client })
    await screen.findByLabelText('Balance: Quillmark Bank')
    first.unmount()
    let answer!: (state: MonthCloseState) => void
    // the snapshot (the family's order for the member tints) answers at once; the wizard's own read waits
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input) === '/api/snapshot' ? Promise.resolve(jsonResponse({ members: ['Robin'] }))
      : new Promise<Response>(resolve => { answer = state => resolve(jsonResponse(state)) })))
    renderAdmin(<DataPage screen={MonthCloseView} />, { client })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByLabelText('Balance: Quillmark Bank')).toBeNull()
    answer(ready)
    expect(await screen.findByLabelText('Balance: Quillmark Bank')).toHaveValue('1')
  })

  it('a read that lands after a save was adopted overwrites neither the saved state nor what was typed', async () => {
    const reads: ((state: MonthCloseState) => void)[] = []
    let gets = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/snapshot') return jsonResponse({ members: ['Robin'] })
      if (!init?.method || init.method === 'GET') {
        gets += 1
        if (gets === 1) return jsonResponse(ready)
        return new Promise<Response>(resolve => reads.push(state => resolve(jsonResponse(state))))
      }
      // the month was closed in another tab: closing fails, and the wizard re-reads the queue
      if (url.endsWith('/close')) return jsonResponse({ error: { code: 'month_conflict' } }, 409)
      const body = JSON.parse(String(init.body)) as DraftRequest
      return jsonResponse({ ...ready, rows: body.rows, draftSavedAt: '2031-10-05T11:32:00Z' })
    }))
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Close June 2031' }))
    await waitFor(() => expect(reads).toHaveLength(1))
    // the re-read is still in flight: the person types, and the autosave is adopted
    const field = screen.getByLabelText('Expense: Quillmark Bank')
    vi.useFakeTimers()
    try {
      fireEvent.change(field, { target: { value: '7' } })
      await act(() => vi.advanceTimersByTimeAsync(800))
      expect(screen.getByText(/Saved at/)).toBeInTheDocument()
      reads[0](withExpense(ready, 0))
      await act(() => vi.advanceTimersByTimeAsync(50))
      expect(field).toHaveValue('7')
      expect(screen.getByText(/Saved at/)).toBeInTheDocument()
      expect(screen.queryByText('There are unsaved changes')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Month-close wizard: the balance next to last month', () => {
  // last month (May 2031) the account held 412 300
  const lastMonth = { ...base, hints: { '["Quillmark Bank","Robin"]': 412300, '["Deposit","Robin"]': 500 } }
  // the server keeps the draft it is sent: a save started by leaving a field does not clear it
  const echo = (state: MonthCloseState) => stubState(state, (_url, init) => ({ ...state, rows: (JSON.parse(String(init.body)) as DraftRequest).rows }))
  const balance = () => screen.getByLabelText('Balance: Quillmark Bank')
  const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } })
  const description = (field: HTMLElement) =>
    (field.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ')

  it('says the difference from last month under the balance as it is typed, and the field is described by it', async () => {
    echo(lastMonth)
    renderScreen()
    type(await screen.findByLabelText('Balance: Quillmark Bank'), '424700')
    expect(balance()).toHaveValue('424,700')
    expect(screen.getByText('+12,400 vs last month')).toBeInTheDocument()
    expect(balance()).toHaveAccessibleDescription('+12,400 vs last month')
    fireEvent.blur(balance())
    expect(document.querySelector('.close-check')).toBeNull()
  })

  it('warns about a zero too many or too few and a flipped sign once the field is left, in the warning colour', async () => {
    echo(lastMonth)
    renderScreen()
    type(await screen.findByLabelText('Balance: Quillmark Bank'), '4247000')
    // mid-typing ("4", "42", … "4247000") no warning flickers
    expect(screen.queryByText(/Check the zeros/)).toBeNull()
    fireEvent.blur(balance())
    expect(screen.getByText('10× more than in May. Check the zeros.')).toHaveClass('close-check')
    // two sentences, each its own element: not "…vs last month10× more…"
    expect(balance()).toHaveAccessibleDescription('+3,834,700 vs last month 10× more than in May. Check the zeros.')
    type(balance(), '41230')
    expect(screen.queryByText(/Check the zeros/)).toBeNull()
    fireEvent.blur(balance())
    expect(screen.getByText('10× less than in May. Check the zeros.')).toHaveClass('close-check')
    type(balance(), '-500')
    fireEvent.blur(balance())
    expect(screen.getByText('The sign differs from the balance in May. Check it.')).toHaveClass('close-check')
  })

  it('in privacy mode the difference is not said, the warning is (it holds no amount)', async () => {
    stubPrivacyOn()
    echo(lastMonth)
    renderAdmin(<DataPage screen={MonthCloseView} />, { dashboard: true })
    type(await screen.findByLabelText('Balance: Quillmark Bank'), '4247000')
    fireEvent.blur(balance())
    expect(screen.queryByText(/vs last month/)).toBeNull()
    expect(screen.getByText('10× more than in May. Check the zeros.')).toBeInTheDocument()
  })

  it('a flow shows its amount in short, not a difference', async () => {
    echo(lastMonth)
    renderScreen()
    const expense = await screen.findByLabelText('Expense: Quillmark Bank')
    type(expense, '25000')
    expect(expense).toHaveValue('25,000')
    expect(screen.getByText(fmtCompactCurrency(25000, 'RUB'))).toBeInTheDocument()
    expect(description(expense)).toContain(fmtCompactCurrency(25000, 'RUB'))
    expect(screen.queryByText(/vs last month/)).toBeNull()
  })

  it('a warning does not stand in the way of closing', async () => {
    const ready = { ...lastMonth, problems: [], rows: base.rows.map(r => ({ ...r, balance: 1, active: 0, passive: 0, expense: 0 })) }
    echo(ready)
    renderScreen()
    type(await screen.findByLabelText('Balance: Quillmark Bank'), '4247000')
    fireEvent.blur(balance())
    expect(screen.getByText('10× more than in May. Check the zeros.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'What prevents closing the month' })).toBeNull()
    expect(closable(screen.getByRole('button', { name: 'Close June 2031' }))).toBe(true)
  })

  it('on a touchscreen the balance has the decimal keypad and a ± button; flows have no ±', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)', addEventListener: () => {}, removeEventListener: () => {} }))
    const bodies: DraftRequest[] = []
    stubState(lastMonth, (_url, init) => { bodies.push(JSON.parse(String(init.body))); return lastMonth })
    renderScreen()
    type(await screen.findByLabelText('Balance: Quillmark Bank'), '500')
    expect(balance()).toHaveAttribute('inputmode', 'decimal')
    const toggles = screen.getAllByRole('button', { name: 'Change the sign' })
    expect(toggles).toHaveLength(2) // one per balance: Quillmark Bank, Deposit
    fireEvent.click(within(balance().closest('td')!).getByRole('button', { name: 'Change the sign' }))
    expect(balance()).toHaveValue('−500')
    fireEvent.blur(balance())
    await waitFor(() => expect(bodies.length).toBeGreaterThan(0))
    expect(bodies[0].rows.find(r => r.name === 'Quillmark Bank')?.balance).toBe(-500)
  })

  it('with a mouse the balance keeps the keyboard with a minus and has no ± button', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
    stubState(lastMonth)
    renderScreen()
    expect(await screen.findByLabelText('Balance: Quillmark Bank')).not.toHaveAttribute('inputmode')
    expect(screen.getByLabelText('Expense: Quillmark Bank')).toHaveAttribute('inputmode', 'decimal')
    expect(screen.queryByRole('button', { name: 'Change the sign' })).toBeNull()
  })

  it('reads in Russian: the difference, and the times with their plural', async () => {
    await withLanguage('ru-RU', async () => {
      echo(lastMonth)
      renderScreen()
      const field = await screen.findByLabelText(`${ru('data.field.balance')}: Quillmark Bank`)
      type(field, '424700')
      // the Russian group symbol is a no-break space, which getByText would fold: the text is read as it is
      expect(description(field)).toContain(ru('data.close.diff', { value: `+${fmtNum(12400, 2)}` }))
      type(field, '9070600')
      fireEvent.blur(field)
      const month = ru('dates.inMonth.5')
      expect(description(field)).toContain(ru('data.close.checkMagnitude', { count: 22, times: '22', month }))
      expect(ru('data.close.checkMagnitude', { count: 22, times: '22', month })).not.toBe(ru('data.close.checkMagnitude', { count: 10, times: '22', month }))
    })
  })
})

it('keeps pipe-colliding identities distinct while editing rows and invalid fields', async () => {
  stubState({ ...base, rows: [
    { ...account('loan:A|B'), member: 'C|balance', balance: 10 },
    { ...account('loan:A'), member: 'B|C|balance', balance: 20 },
  ], hints: {}, problems: [] })
  renderScreen()
  const first = await screen.findByLabelText('Balance: loan:A|B')
  fireEvent.change(first, { target: { value: '15' } })
  expect(screen.getByLabelText('Balance: loan:A')).toHaveValue('20')
  typeText(first, '12,')
  expect(first).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByLabelText('Balance: loan:A')).not.toHaveAttribute('aria-invalid', 'true')
})


describe('draft conflict input retention', () => {
  it('retains a newer local edit with its own acknowledgment revision and conflicts with a later external save', async () => {
    const bodies: DraftRequest[] = []
    let acknowledge!: (response: Response) => void
    let authoritative: MonthCloseState = { ...base, draftRevision: 'external-revision', rows: base.rows.map(r => ({ ...r, balance: 999 })) }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/spending') return jsonResponse({ categories: [], accounts: [], sources: [], manual: null })
      if (!init?.method || init.method === 'GET') return jsonResponse(base)
      const body = JSON.parse(String(init.body)) as DraftRequest
      bodies.push(body)
      if (bodies.length === 1) return new Promise<Response>(resolve => { acknowledge = resolve })
      if (body.expectedRevision !== authoritative.draftRevision) return jsonResponse({ error: { code: 'draft_conflict' } }, 409)
      authoritative = { ...authoritative, rows: body.rows }
      return jsonResponse(authoritative)
    }))
    renderScreen()
    const field = await screen.findByLabelText('Balance: Quillmark Bank')
    vi.useFakeTimers()
    try {
      fireEvent.change(field, { target: { value: '100' } })
      await act(() => vi.advanceTimersByTimeAsync(800))
      expect(bodies).toHaveLength(1)
      fireEvent.change(field, { target: { value: '101' } })
      // Another writer already saved 999; this reply acknowledges only our own committed 100.
      acknowledge(jsonResponse({ ...base, rows: bodies[0].rows, draftRevision: 'own-acknowledged-revision' }))
      await act(() => vi.advanceTimersByTimeAsync(800))
      expect(bodies).toHaveLength(2)
      expect(bodies[1]).toMatchObject({ expectedRevision: 'own-acknowledged-revision' })
      expect(bodies[1].rows[0].balance).toBe(101)
      expect(field).toHaveValue('101')
      expect(screen.getByText(/The saved draft changed/)).toBeInTheDocument()
      expect(authoritative.rows[0].balance).toBe(999)
      await act(() => vi.advanceTimersByTimeAsync(1600))
      expect(bodies).toHaveLength(2)
    } finally { vi.useRealTimers() }
  })

  it('keeps typed values and stops retries on draft conflict', async () => {
    let writes = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/spending') return jsonResponse({ categories: [], accounts: [], sources: [], manual: null })
      if (init?.method === 'PUT') { writes++; return jsonResponse({ error: { code: 'draft_conflict' } }, 409) }
      return jsonResponse(base)
    })
    vi.stubGlobal('fetch', fetcher)
    renderScreen()
    const field = await screen.findByLabelText('Balance: Quillmark Bank')
    fireEvent.change(field, { target: { value: '777' } })
    fireEvent.blur(field)
    await screen.findByText(/The saved draft changed/)
    expect(field).toHaveValue('777')
    fireEvent.change(field, { target: { value: '888' } })
    fireEvent.blur(field)
    expect(field).toHaveValue('888')
    expect(writes).toBe(1)
  })
})
