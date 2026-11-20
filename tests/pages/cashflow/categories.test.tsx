import { fireEvent, screen, within } from '@testing-library/react'
import { CashFlow } from '../../../src/pages/CashFlow'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { spendingQuery } from '../../../src/modules/cashflow/spendingWrites'
import { demoFamilyData } from '../../helpers/demoFamily'
import { renderWithSnapshot, snapshotClient, stubSnapshotFetch } from '../../helpers/render'

const { snapshot, spending } = await demoFamilyData()

beforeEach(() => { stubSnapshotFetch(); window.history.replaceState({}, '', '/cashflow') })
afterEach(() => { resetAuth(); window.history.replaceState({}, '', '/'); vi.unstubAllGlobals() })

/** The page with /api/spending already read (the accounts that hold a category) */
function renderPage(search = '') {
  window.history.replaceState({}, '', `/cashflow${search}`)
  const client = snapshotClient(snapshot)
  client.setQueryData(spendingQuery.queryKey, spending)
  return renderWithSnapshot(<CashFlow />, snapshot, { client })
}
const expenses = () => within(screen.getByRole('region', { name: 'Where the money went' }))
const income = () => within(screen.getByRole('region', { name: 'Where it came from' }))
const rowTexts = () => [...expenses().getAllByRole('button', { expanded: false }), ...expenses().queryAllByRole('button', { expanded: true })]
const phone = (matches: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({ matches: matches && query.includes('640'), addEventListener: () => {}, removeEventListener: () => {} }))

describe('where the money went', () => {
  it('rows grouped mandatory / loans / by choice, largest first, against usual with the change in ink', () => {
    renderPage()
    const groups = [...document.querySelectorAll('.cf-group')].map(g => g.textContent)
    expect(groups.map(g => g!.replace(/\$.*/, ''))).toEqual(['Mandatory', 'Loans', 'By choice'])
    const names = [...document.querySelectorAll('button.cf-row .cf-row__name')].map(n => n.textContent)
    expect(names.slice(0, 6)).toEqual(['Groceries', 'Insurance', 'Housing', 'Health', 'Transport', 'Utilities'])
    expect(names[6]).toBe('Loan payments')
    const groceries = expenses().getByRole('button', { name: /^Groceries/ })
    expect(groceries).toHaveTextContent('$1,070usually $1,045+$25')
    expect(groceries.querySelector('.cf-row__delta')).toHaveClass('delta')
    expect(expenses().getByRole('button', { name: /^Loan payments/ })).toHaveTextContent('as usual')
    expect(rowTexts().length).toBe(12)
  })

  it('the unsplit remainder ends the list with its accounts and the way to split it', () => {
    renderPage()
    const row = document.querySelector('.cf-list > .cf-row--static')!
    expect(row).toHaveTextContent('Not split$1,1443 accountsSplit')
    expect(within(row as HTMLElement).getByRole('link', { name: 'Split' })).toHaveAttribute('href', '/cashflow/categories?month=2026-09')
    expect(screen.queryByText(/Mandatory spending/)).toBeNull()
    expect(screen.getByText('$10,509 · usual is the median of 6 months before the period')).toBeInTheDocument()
  })

  it('categories + not split = the month expenses in the legend', () => {
    renderPage()
    const legend = [...document.querySelectorAll('.cf-legend li')].map(l => l.textContent)
    expect(legend).toEqual(['Mandatory $4,190 39.9%', 'Loans $3,065 29.2%', 'By choice $2,110 20.1%', 'Not split $1,144 10.9%'])
  })

  it('the quarter compares its average month', () => {
    renderPage('?p=quarter')
    expect(expenses().getByRole('button', { name: /^Travel/ })).toHaveTextContent('$4,600$1,533/mo, usually $430+$1,103')
  })

  it('a fully split year needs no coverage note; all time says how many months have categories and that there is no comparison', () => {
    renderPage('?p=year')
    expect(screen.queryByText(/months of the period here/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'All time' }))
    expect(screen.getByText(/^Expense categories start in October 2025: 12 of 36 months of the period here, .* No comparison: there are no categories before the period\.$/)).toBeInTheDocument()
  })

  it('a viewer sees no split links', () => {
    setAuth({ me: { name: 'Robin', rights: { edit: false, vote: true, manage: false } } } as never)
    renderPage()
    expect(screen.queryByRole('link', { name: 'Split' })).toBeNull()
  })
})

describe('a category opened', () => {
  it('Travel in the quarter: July 2026 the largest month, Bluefinch the source in September, a link to change its split', () => {
    renderPage('?p=quarter')
    const travel = expenses().getByRole('button', { name: /^Travel/ })
    fireEvent.click(travel)
    expect(travel).toHaveAttribute('aria-expanded', 'true')
    expect(window.location.search).toBe('?p=quarter&category=11')
    const detail = document.querySelector<HTMLElement>('.cf-detail')!
    expect(detail).toHaveTextContent('Travel: $4,600 for July – September 2026 ($1,533 a month). Usually $430: the median of 6 months before the period. The largest month is July 2026, $3,820.')
    expect(within(detail).getByText('Where it came from in September')).toBeInTheDocument()
    expect(within(detail).getByText('Bluefinch High-Yield Savings')).toBeInTheDocument()
    // the loan payments come from other sources (the statement cards): they are listed too and add up to the category
    fireEvent.click(expenses().getByRole('button', { name: /^Loan payments/ }))
    const loans = document.querySelector<HTMLElement>('.cf-detail')!
    expect([...loans.querySelectorAll('.cf-sources li')].map(li => li.textContent)).toEqual([
      'Harborline card — Ryan · other source$2,570', 'Brisaluna card — Annika · other source$495',
    ])
    fireEvent.click(expenses().getByRole('button', { name: /^Travel/ }))
    expect(within(detail).getByRole('link', { name: 'Change the split of September' })).toHaveAttribute('href', '/cashflow/categories?month=2026-09')
    expect([...detail.querySelectorAll('.cfband__net--now')]).toHaveLength(3)
  })

  it('a second click and Escape close it', () => {
    renderPage()
    const travel = expenses().getByRole('button', { name: /^Travel/ })
    fireEvent.click(travel)
    fireEvent.click(travel)
    expect(document.querySelector('.cf-detail')).toBeNull()
    fireEvent.click(travel)
    fireEvent.keyDown(document.querySelector('.cf-detail')!, { key: 'Escape' })
    expect(document.querySelector('.cf-detail')).toBeNull()
    expect(travel).toHaveFocus()
  })

  it('at 390 it is a screen of its own with the way back', () => {
    phone(true)
    renderPage('?category=11')
    expect(screen.queryByRole('region', { name: 'Where the money went' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Travel' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Income and expenses' }))
    expect(window.location.search).toBe('')
    expect(screen.getByRole('region', { name: 'Where the money went' })).toBeInTheDocument()
  })
})

describe('where it came from', () => {
  it('active / passive, the sources, the unsplit income and the members adding up to the totals', () => {
    renderPage()
    const card = income()
    expect(document.querySelector('.cf-ap')).toHaveTextContent('Active $12,550passive $1,543 · 10.9%')
    expect(card.getByText('Salary')).toBeInTheDocument()
    const rows = [...document.querySelectorAll('.cf-who tbody tr')].map(r => r.textContent)
    expect(rows).toEqual(['RRyan$7,240$6,100', 'AAnnika$6,853$4,409'])
    expect(card.getByText("Loan payments count to the loan's owner.")).toBeInTheDocument()
    expect(card.queryByText(/One-off income/)).toBeNull()
  })

  it('the one-off line appears for December 2025', () => {
    renderPage('?m=2025-12')
    expect(income().getByText('One-off income $7,000 (Bonus) is not counted in forecasts.')).toBeInTheDocument()
  })
})
