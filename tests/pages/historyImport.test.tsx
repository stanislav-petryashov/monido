import { fireEvent, screen, waitFor } from '@testing-library/react'
import { HistoryImport } from '../../src/pages/settings/HistoryImport'
import { PrivacyProvider } from '../../src/lib/PrivacyProvider'
import type { MonthCloseState } from '../../src/domain/api'
import { base } from '../helpers/monthClose'
import { jsonResponse } from '../helpers/http'
import { renderAdmin, stubPrivacyOn } from '../helpers/render'

const SHEET = 'Month\tQuillmark Bank\tNew Broker\n2031-03\t100\t\n2031-04\t200\t50\n'

function stub(state: MonthCloseState, answers: Record<string, unknown> = {}) {
  const calls: { url: string; method: string; body: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'GET') return jsonResponse(url === '/api/month-close' ? state : {})
    return jsonResponse(answers[`${method} ${url}`] ?? {})
  }))
  return calls
}

describe('Settings → Data → Import history', () => {
  it('reads a pasted sheet, matches a column to the recorded account, checks it and imports what was checked', async () => {
    const ok = { months: ['2031-03', '2031-04'], balances: 3, closures: 1, newAccounts: 1, problems: [] }
    const calls = stub(base, { 'POST /api/month-close/history/preview': ok, 'POST /api/month-close/history': { months: ok.months, balances: 3 } })
    renderAdmin(<HistoryImport />)
    expect(await screen.findByText('The sheet must end at April 2031, the month before your first closed one.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Paste the sheet or choose a file'), { target: { value: SHEET } })
    // the recorded account keeps its owner and currency; the new one starts without an owner, as a bank account
    const names = screen.getAllByRole('textbox', { name: 'Name' }) as HTMLInputElement[]
    expect(names.map(n => n.value)).toEqual(['Quillmark Bank', 'New Broker'])
    expect((screen.getAllByRole('combobox', { name: 'Member' }) as HTMLSelectElement[]).map(s => s.value)).toEqual(['Robin', ''])
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('Ready: months March 2031 – April 2031 (2), balances: 3, new accounts: 1, accounts that end: 1.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.url === '/api/month-close/history')).toBe(true))
    const sent = calls.find(c => c.method === 'POST' && c.url === '/api/month-close/history')!.body
    expect(sent).toEqual({
      accounts: [{ name: 'Quillmark Bank', member: 'Robin', class: 'bank', currency: 'RUB' }, { name: 'New Broker', member: '', class: 'bank', currency: 'RUB' }],
      months: [{ month: '2031-03', values: [100, null] }, { month: '2031-04', values: [200, 50] }],
    })
  })

  it('an edit after the check asks for a new check; the server’s problems are said in words', async () => {
    const bad = { months: [], balances: 0, closures: 0, newAccounts: 0, problems: [{ code: 'not_adjacent', params: { month: '2031-04' } }] }
    stub(base, { 'POST /api/month-close/history/preview': bad })
    renderAdmin(<HistoryImport />)
    fireEvent.change(await screen.findByLabelText('Paste the sheet or choose a file'), { target: { value: SHEET } })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The sheet must end at April 2031, right before the first closed month.')
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Name' })[1], { target: { value: 'Broker' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  })

  it('asks which decimal mark an ambiguous sheet uses, and says what it cannot read', async () => {
    stub(base)
    renderAdmin(<HistoryImport />)
    fireEvent.change(await screen.findByLabelText('Paste the sheet or choose a file'), { target: { value: 'Month;A\n2031-03;1,234\nsoon;2,000' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Row 3: “soon” is not a month or a date.')
    expect(screen.getByRole('combobox', { name: 'Which mark separates the decimals in these numbers?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled()
  })

  it('removes the imported history after a confirmation', async () => {
    const calls = stub({ ...base, history: { ...base.history, imported: { first: '2030-01', last: '2031-04' } } })
    renderAdmin(<HistoryImport />)
    expect(await screen.findByText('Imported history: January 2030 – April 2031.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove imported history' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('The months January 2030 – April 2031 and their balances are deleted.')
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove imported history' }).at(-1)!)
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.url === '/api/month-close/history')).toBe(true))
  })

  it('privacy mode hides the paste field and the amounts a problem quotes', async () => {
    stubPrivacyOn()
    stub(base)
    renderAdmin(<PrivacyProvider><HistoryImport /></PrivacyProvider>)
    expect(await screen.findByText('Amounts are hidden. Show them to paste a sheet.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('the template gives each recorded account a column, an owner telling apart a shared name', async () => {
    const accounts = [{ name: 'Bank', member: 'Robin', class: 'bank', currency: 'RUB' }, { name: 'Bank', member: 'Noa', class: 'bank', currency: 'RUB' }]
    stub({ ...base, members: ['Robin', 'Noa'], history: { ...base.history, accounts } })
    let csv = ''
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => { void b.text().then(t => { csv = t }); return 'blob:x' }, revokeObjectURL: () => {} }))
    renderAdmin(<HistoryImport />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download a template' }))
    await waitFor(() => expect(csv.split('\n')[0]).toBe('Month,Bank (Robin),Bank (Noa)'))
    // a sheet with those headers is matched to the two accounts by their owners
    fireEvent.change(screen.getByLabelText('Paste the sheet or choose a file'), { target: { value: 'Month,Bank (Robin),Bank (Noa)\n2031-04,1,2' } })
    expect((screen.getAllByRole('combobox', { name: 'Member' }) as HTMLSelectElement[]).map(x => x.value)).toEqual(['Robin', 'Noa'])
  })
})
