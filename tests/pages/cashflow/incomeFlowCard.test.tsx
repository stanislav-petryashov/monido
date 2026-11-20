import { fireEvent, screen, within } from '@testing-library/react'
import { cashflowPeriodView } from '../../../src/domain/cashflowPeriod'
import { incomeFlow, type FlowNode, type FlowSide, type IncomeFlow } from '../../../src/domain/incomeFlow'
import { IncomeFlowCard } from '../../../src/pages/cashflow/IncomeFlowCard'
import { demoFamilyData } from '../../helpers/demoFamily'
import { renderWithSnapshot } from '../../helpers/render'

const { snapshot } = await demoFamilyData()
const view = cashflowPeriodView(snapshot, 'year', null)!
const sideOf = (side: FlowSide) => incomeFlow(view, snapshot.flowExtras ?? [], { spending: snapshot.spending.months, income: snapshot.income.months }, side)
const YEAR = { source: sideOf('source'), person: sideOf('person') }
const fmt = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`
const same = (flow: IncomeFlow) => ({ source: flow, person: flow })

const node = (key: string, kind: FlowNode['kind'], amount: number, total: number, children?: FlowNode[]): FlowNode =>
  ({ key, kind, name: kind === 'source' ? 'Salary' : null, amount, share: (amount / total) * 100, ...(children ? { children } : {}) })
// 5,000 earned, 10,000 spent: 5,000 taken from savings; the loan's 300 principal is all that was saved; a car loan opened
const OVERSPENT: IncomeFlow = {
  left: [node('source:1', 'source', 5000, 10000), node('takenFromSavings', 'takenFromSavings', 5000, 10000)],
  right: [node('saved', 'saved', 300, 10000, [node('paidDown', 'paidDown', 300, 10000)]), node('interest', 'interest', 700, 10000), node('notSplit', 'notSplit', 9000, 10000)],
  total: 10000, income: 5000, net: -5000, saved: -4700, inflows: true, newLoans: ['Car loan'],
}
// 10,000 earned, 9,000 spent, 1,500 invested: 500 taken from accounts
const DEPOSITED: IncomeFlow = {
  left: [node('source:1', 'source', 10000, 10500), node('takenFromAccounts', 'takenFromAccounts', 500, 10500)],
  right: [node('saved', 'saved', 1500, 10500, [node('invested', 'invested', 1500, 10500)]), node('notSplit', 'notSplit', 9000, 10500)],
  total: 10500, income: 10000, net: 1000, saved: 1000, inflows: true, newLoans: [],
}

function render(props: Partial<Parameters<typeof IncomeFlowCard>[0]> = {}) {
  const onOpenCategory = vi.fn()
  renderWithSnapshot(<IncomeFlowCard flows={YEAR} periodName="October 2025 – September 2026" fmt={fmt} compact={false}
    splitTo={m => `/cashflow/categories?month=${m}`} onOpenCategory={onOpenCategory} {...props} />, snapshot)
  return { onOpenCategory, card: screen.getByRole('region', { name: 'Where the income went' }) }
}
const group = (name: RegExp) => screen.getByRole('button', { name })
const chart = () => document.querySelector('svg.cf-flow__svg')

describe('IncomeFlowCard', () => {
  it('the finding names what was saved and its three parts; "Why not" explains the difference', () => {
    render()
    expect(screen.getByText('Of $175,050 earned, you saved $41,945 (24%): $26,661 stayed on accounts, $11,084 paid down loans, $4,200 invested.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Why not $30,861?' }))
    expect(screen.getByText(/Income minus expenses is \$30,861\. Those expenses include \$11,084 of loan principal/)).toBeInTheDocument()
  })

  it('money taken from accounts uses the "came in" finding; an overspent period says so and what was paid down', () => {
    render({ flows: same(DEPOSITED) })
    expect(screen.getByText(/^Of the \$10,500 that came in, \$10,000 of it earned, you saved \$1,500/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Why not/ })).toBeNull()
  })

  it('an overspent period says how much more was spent and what the loans still paid down', () => {
    render({ flows: same(OVERSPENT) })
    expect(screen.getByText('You spent $5,000 more than you earned: the difference was taken from your money. The loan payments still paid down $300 of debt.')).toBeInTheDocument()
  })

  it('only the groups are buttons, with aria-expanded; Saved and the sources are focusable with their amounts', () => {
    render()
    const buttons = within(chart() as unknown as HTMLElement).getAllByRole('button')
    expect(buttons.map(b => b.getAttribute('aria-label')!.split(':')[0])).toEqual(['Mandatory', 'Loan interest', 'Optional'])
    expect(buttons.every(b => b.getAttribute('aria-expanded') === 'false')).toBe(true)
    const saved = chart()!.querySelector('[data-key="saved"]')!
    expect(saved).toHaveAttribute('tabindex', '0')
    expect(saved).not.toHaveAttribute('role', 'button')
    expect(saved.getAttribute('aria-label')).toBe('Saved: $41,945, 24% of income')
    expect(chart()!.querySelector('[data-key^="source:"]')).toHaveAttribute('aria-label', 'Salary: $150,320, 85.9% of income')
  })

  it('clicking Mandatory opens its categories on the chart and in the list; it is the only open node', () => {
    render()
    fireEvent.click(group(/^Mandatory/))
    expect(group(/^Mandatory/)).toHaveAttribute('aria-expanded', 'true')
    expect(chart()!.querySelectorAll('.is-open')).not.toHaveLength(0)
    expect([...chart()!.querySelectorAll('.cf-flow__node.is-open')].map(n => n.getAttribute('data-key'))).toEqual(['mandatory'])
    expect(chart()!.querySelector('[data-key="category:4"]')).not.toBeNull()
    const list = screen.getByRole('list', { name: 'Mandatory' })
    expect(within(list).getAllByRole('listitem').map(li => li.querySelector('.cf-flow__name')!.textContent)).toEqual(['Groceries', 'Insurance', 'Housing', 'Health', 'Transport', 'Utilities'])
    expect(screen.getByText('Mandatory opened')).toBeInTheDocument()
    fireEvent.click(group(/^Optional/))
    expect(group(/^Mandatory/)).toHaveAttribute('aria-expanded', 'false')
    expect(chart()!.querySelector('[data-key="category:4"]')).toBeNull()
  })

  it('Enter opens a group; Escape closes the tooltip first, then the group, and the focus stays', () => {
    render()
    const mandatory = group(/^Mandatory/)
    mandatory.focus()
    fireEvent.focus(mandatory)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Spending on the mandatory categories.')
    fireEvent.keyDown(mandatory, { key: 'Enter' })
    expect(mandatory).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(mandatory, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(mandatory).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(mandatory, { key: 'Escape' })
    expect(group(/^Mandatory/)).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(group(/^Mandatory/))
  })

  it('with the "Why not" panel open, Escape closes only the panel', () => {
    render()
    fireEvent.click(group(/^Mandatory/))
    fireEvent.click(screen.getByRole('button', { name: 'Why not $30,861?' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Why not $30,861?' }), { key: 'Escape' })
    expect(screen.queryByText(/^Income minus expenses is/)).toBeNull()
    expect(group(/^Mandatory/)).toHaveAttribute('aria-expanded', 'true')
  })

  it('By person switches the left side and keeps the right', () => {
    render()
    const right = () => [...chart()!.querySelectorAll('.cf-flow__node[data-level="1"]')].map(n => n.getAttribute('data-key'))
    const before = right()
    fireEvent.click(screen.getByRole('button', { name: 'By person' }))
    expect([...chart()!.querySelectorAll('.cf-flow__node[data-level="0"]')].map(n => n.getAttribute('aria-label')!.split(':')[0])).toEqual(['Ryan', 'Annika'])
    expect(right()).toEqual(before)
  })

  it('Table lists every node and category with its amount and share', () => {
    render()
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(chart()).toBeNull()
    const table = screen.getByRole('table')
    expect(table).toHaveClass('page-table')
    const rows = within(table).getAllByRole('row').map(r => [...r.querySelectorAll('th, td')].map(c => c.textContent))
    expect(rows).toContainEqual(['Salary', '$150,320', '85.9%'])
    expect(rows).toContainEqual(['Saved', '$41,945', '24%'])
    expect(rows).toContainEqual(['Paid down debt', '$11,084', '6.3%'])
    expect(rows).toContainEqual(['Groceries', '$13,100', '7.5%'])
    expect(rows).toContainEqual(['Maple Street mortgage', '$24,586', '14%'])
  })

  it('Open history calls back with the category', () => {
    const { onOpenCategory } = render()
    fireEvent.click(group(/^Optional/))
    fireEvent.click(within(screen.getByRole('list', { name: 'Optional' })).getAllByRole('button', { name: 'Open history' })[1]!)
    expect(onOpenCategory).toHaveBeenCalledWith(11)
  })

  it('a masking fmt masks every amount; the shares stay', () => {
    render({ fmt: () => '•••' })
    expect(screen.queryByText(/\$\d/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/\$\d/)
    expect(chart()!.querySelector('[data-key="saved"]')!.getAttribute('aria-label')).toBe('Saved: •••, 24% of income')
  })

  it('on a phone: the list, no chart; a tap opens a group', () => {
    render({ compact: true })
    expect(chart()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Mandatory/ }))
    expect(screen.getByRole('list', { name: 'Mandatory' })).toBeInTheDocument()
  })

  it('lines above a month name it with the way to fix its split; a viewer gets the text only', () => {
    render({ flows: same({ problem: 'linesExceed', month: '2026-03' }) })
    expect(screen.getByText(/^For March 2026 the categories add up to more/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fix the split of March 2026' })).toHaveAttribute('href', '/cashflow/categories?month=2026-03')
    expect(chart()).toBeNull()
  })

  it('a viewer gets no link to fix the split', () => {
    render({ flows: same({ problem: 'linesExceed', month: '2026-03' }), splitTo: null })
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('a missing rate says so and draws nothing', () => {
    render({ flows: same({ problem: 'noRate' }) })
    expect(screen.getByText('Some amounts have no exchange rate, so the picture is not drawn.')).toBeInTheDocument()
    expect(chart()).toBeNull()
  })

  it('the tooltip of money taken in names the loans opened in the period, as a share of what came in', () => {
    render({ flows: same(OVERSPENT) })
    fireEvent.focus(chart()!.querySelector('[data-key="takenFromSavings"]')!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Loans opened in this period: Car loan.')
    expect(screen.getByRole('tooltip')).toHaveTextContent('50% of what came in')
  })
})
