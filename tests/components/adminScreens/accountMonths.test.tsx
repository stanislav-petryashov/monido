// The Accounts detail's lower part: Income and expenses' categories block (the module's `accountDetail`) and the monthly table.
import { fireEvent, screen, within } from '@testing-library/react'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { AccountsView } from '../../../src/pages/admin/AccountsView'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { jsonResponse, stubApi } from '../../helpers/http'
import { renderAdmin as renderPage } from '../../helpers/render'
import { correctButton } from '../../helpers/adminScreens'

afterEach(() => { window.history.replaceState(null, '', '/'); resetAuth() })

const balance = (rowid: number, date: string, value: number, name = 'Harbor') => ({ rowid, date, class: 'bank', name, value, currency: 'USD', member: 'Robin' })
const flow = (rowid: number, date: string, income: number, expense: number) => ({ rowid, date, bank: 'Harbor', member: 'Robin', active_income: income, passive_income: 0, expense, currency: 'USD' })
const tables = (withFlows = true) => ({
  assets: [balance(1, '2031-04-30', 1000), balance(2, '2031-05-31', 1200)],
  monthly_cashflow: withFlows ? [flow(1, '2031-04-01', 1000, 600), flow(2, '2031-05-01', 1000, 600)] : [],
  currencies: [{ rowid: 1, code: 'USD' }], members: [{ rowid: 1, name: 'Robin' }],
})
const month = (m: string, items: { categoryId: number; amount: number }[], bank = 'Harbor') => ({
  month: m, bank, member: 'Robin', currency: 'USD', totals: { active: 1000, passive: 0, expense: 600 }, items,
  allocated: { active: 0, passive: 0, expense: 0 }, orphaned: false,
})
const spending = {
  categories: [
    { id: 1, name: 'Salary', kind: 'optional', flow: 'active', oneOff: false },
    { id: 2, name: 'Groceries', kind: 'mandatory', flow: 'expense', oneOff: false },
    { id: 3, name: 'Rent', kind: 'mandatory', flow: 'expense', oneOff: false },
  ],
  accounts: [
    month('2031-05', [{ categoryId: 1, amount: 1000 }, { categoryId: 2, amount: 200 }, { categoryId: 3, amount: 100 }]),
    month('2031-04', [{ categoryId: 1, amount: 900 }, { categoryId: 2, amount: 300 }]),
    // another account's lines and a month before the 12 do not count
    month('2031-05', [{ categoryId: 1, amount: 777 }], 'Other'),
    month('2030-01', [{ categoryId: 1, amount: 5000 }]),
  ],
  sources: [], manual: null,
}
const withSpending = { answer: { '/api/spending': () => jsonResponse(spending) } }

describe('Accounts: where the money comes from and goes', () => {
  it('sums the account\'s lines over 12 months by category, with shares and the uncategorised rest', async () => {
    stubApi(tables(), withSpending)
    renderPage(<DataPage screen={AccountsView} />)
    const card = (await screen.findByRole('heading', { name: 'Where the money comes from and goes' })).closest('section') as HTMLElement
    const rows = (side: string) => [...within(card).getByRole('heading', { name: new RegExp(`^${side}`) }).parentElement!.querySelectorAll('li')].map(li => li.textContent)
    expect(within(card).getByRole('heading', { name: 'Comes in$2,000' })).toBeInTheDocument()
    expect(rows('Comes in')).toEqual(['Salary$1,900 · 95%', 'Uncategorised$100 · 5%'])
    expect(within(card).getByRole('heading', { name: 'Goes out$1,200' })).toBeInTheDocument()
    expect(rows('Goes out')).toEqual(['Groceries$500 · 42%', 'Rent$100 · 8%', 'Uncategorised$600 · 50%'])
  })

  it('is not drawn for an account without lines', async () => {
    stubApi(tables())
    renderPage(<DataPage screen={AccountsView} />)
    await screen.findByRole('heading', { name: 'Income and expenses by month' })
    expect(screen.queryByRole('heading', { name: 'Where the money comes from and goes' })).toBeNull()
  })
})

describe('Accounts: the monthly table', () => {
  const table = async () => screen.findByRole('table')
  const cells = (t: HTMLElement, ym: string) => [...within(t).getByText(ym).closest('tr')!.querySelectorAll('td')].map(td => td.textContent)

  it('writes the change against the month before, and income and expenses for an account with flows', async () => {
    stubApi(tables())
    renderPage(<DataPage screen={AccountsView} />)
    const t = await table()
    expect(within(t).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Month', 'Balance, USD', 'Change, USD', 'Income, USD', 'Expenses, USD', 'Correct'])
    expect(cells(t, 'May 2031')).toEqual(['May 2031', '1,200', '+200', '1,000', '600', 'Correct'])
    expect(cells(t, 'Apr 2031')).toEqual(['Apr 2031', '1,000', '—', '1,000', '600', 'Correct'])
    expect(screen.queryByText(/No income or expenses are kept/)).toBeNull()
  })

  it('an account without flows has no flow columns and says what its change is', async () => {
    stubApi(tables(false))
    renderPage(<DataPage screen={AccountsView} />)
    const t = await table()
    expect(within(t).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Month', 'Balance, USD', 'Change, USD', 'Correct'])
    expect(await screen.findByText(/No income or expenses are kept for this account: only the month-end balance/)).toBeInTheDocument()
  })

  it('“Correct” on an older row opens the month editor with that month', async () => {
    stubApi(tables())
    renderPage(<DataPage screen={AccountsView} />)
    fireEvent.click(await correctButton('Apr 2031'))
    expect(screen.getByLabelText('Balance')).toHaveValue('1,000')
    expect(screen.getByLabelText('Month')).toHaveValue('2031-04')
  })

  it('a viewer sees the table without “Correct”', async () => {
    stubApi(tables())
    setAuth({ me: { name: 'Robin', rights: { edit: false, vote: true, manage: false } } })
    renderPage(<DataPage screen={AccountsView} />)
    const t = await table()
    expect(within(t).getAllByRole('columnheader').map(h => h.textContent)).not.toContain('Correct')
    expect(screen.queryByRole('button', { name: /^Correct/ })).toBeNull()
  })
})
