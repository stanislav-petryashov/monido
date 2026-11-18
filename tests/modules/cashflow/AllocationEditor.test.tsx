import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { AllocationEditor, type AllocationEditorProps } from '../../../src/modules/cashflow/AllocationEditor'
import type { SpendingCategory } from '../../../src/domain/types'
import { PrivacyProvider } from '../../../src/lib/PrivacyProvider'
import { typeText } from '../../helpers/adminScreens'
import { jsonResponse } from '../../helpers/http'
import { renderAdmin, stubPrivacyOn } from '../../helpers/render'

const reserved: SpendingCategory = { id: 1, name: 'loan_payments', kind: 'loan_payment', flow: 'expense', oneOff: false }
const housing: SpendingCategory = { id: 2, name: 'Housing', kind: 'mandatory', flow: 'expense', oneOff: false }
const groceries: SpendingCategory = { id: 3, name: 'Groceries', kind: 'mandatory', flow: 'expense', oneOff: false }
const salary: SpendingCategory = { id: 10, name: 'Salary', kind: 'optional', flow: 'active', oneOff: false }
const dividends: SpendingCategory = { id: 11, name: 'Dividends', kind: 'optional', flow: 'passive', oneOff: false }
const CATEGORIES = [reserved, housing, groceries, salary, dividends]

const props = (over: Partial<AllocationEditorProps> = {}): AllocationEditorProps => ({
  account: 'Quillmark Bank', categories: CATEGORIES,
  totals: { active: 6500, passive: 390, expense: 5280 },
  items: [{ categoryId: 10, amount: 6500 }, { categoryId: 2, amount: 2100 }, { categoryId: 3, amount: 3180 }],
  allocated: { active: 6500, passive: 0, expense: 5280 },
  mode: 'autosave', onChange: vi.fn(), onCommit: vi.fn(),
  ...over,
})
const draw = (p: AllocationEditorProps) => renderAdmin(<PrivacyProvider><AllocationEditor {...p} /></PrivacyProvider>)
const group = (name: string) => screen.getByRole('group', { name })
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s/g, ' ')

afterEach(() => { vi.unstubAllGlobals() })

describe('AllocationEditor', () => {
  it('two groups, each saying what of its total the lines allocate and what is left as Other', () => {
    draw(props())
    expect(text(group('Income'))).toContain('Of 6,890.00: 6,500.00 allocated · 390.00 unallocated')
    expect(text(group('Expenses'))).toContain('Of 5,280.00: 5,280.00 allocated · fully allocated')
    expect(within(group('Income')).getByLabelText('Amount: Income line 1')).toHaveValue('6,500')
  })

  it('drops a line whose category was deleted: it is not sent back', () => {
    const onChange = vi.fn()
    draw(props({ items: [{ categoryId: 10, amount: 6500 }, { categoryId: 99, amount: 50 }], onChange }))
    fireEvent.change(screen.getByLabelText('Amount: Income line 1'), { target: { value: '7000' } })
    expect(onChange).toHaveBeenLastCalledWith([{ categoryId: 10, amount: 7000 }], false, expect.anything(), [{ categoryId: 10, amount: 6500 }, { categoryId: 99, amount: 50 }])
  })

  it('a select offers only its direction, never the reserved loan category', () => {
    draw(props())
    const income = within(group('Income line 1')).getByRole('combobox')
    expect(within(income).getAllByRole('option').map(o => o.textContent)).toEqual(['Salary', 'Dividends'])
    const expense = within(group('Expense line 1')).getByRole('combobox')
    // the other line's category is not offered twice
    expect(within(expense).getAllByRole('option').map(o => o.textContent)).toEqual(['Housing'])
  })

  it('a total not filled in reads “Of —”; lines over a total mark the header', () => {
    draw(props({ totals: { active: null, passive: null, expense: 5000 } }))
    expect(text(group('Income'))).toContain('Of —: 6,500.00 allocated')
    const over = within(group('Expenses')).getByText(/more than the total/)
    expect(over).toHaveClass('allocation__summary--over')
  })

  it('with one income total filled in and the other not, the header says each flow’s own state instead of “Of —”', () => {
    draw(props({ totals: { active: 5000, passive: null, expense: 5280 }, items: [], allocated: { active: 0, passive: 0, expense: 0 } }))
    expect(text(group('Income'))).toContain('Active: 0.00 of 5,000.00 allocated · Passive: total not filled in')
    expect(text(group('Income'))).not.toContain('Of —')
    expect(within(group('Income')).getByText(/^Active:/)).not.toHaveClass('allocation__summary--over')
  })

  it('a flow whose total is not filled in still says how much is already allocated to it', () => {
    draw(props({ totals: { active: 5000, passive: null, expense: 5280 }, items: [{ categoryId: 12, amount: 200 }], allocated: { active: 0, passive: 200, expense: 0 } }))
    expect(text(group('Income'))).toContain('Active: 0.00 of 5,000.00 allocated · Passive: 200.00 allocated, total not filled in')
  })

  it('lines over the one total filled in say so, though the other total is not filled in yet', () => {
    draw(props({ totals: { active: 100, passive: null, expense: 5280 }, items: [{ categoryId: 10, amount: 120 }], allocated: { active: 120, passive: 0, expense: 0 } }))
    const over = within(group('Income')).getByText(/more than/)
    expect(over).toHaveClass('allocation__summary--over')
    expect(text(group('Income'))).toContain('Of —: 120.00 allocated, more than a total filled in')
  })

  it('opens on the lines as typed when one is not a number yet', () => {
    draw(props({ items: [{ categoryId: 10, amount: 6500 }], typed: [{ categoryId: 10, amount: '6,500' }, { categoryId: 2, amount: '12,' }] }))
    expect(within(group('Expenses')).getByLabelText('Amount: Expense line 1')).toHaveValue('12,')
  })

  it('tells each edit as lines, and the leaving of the panel once', () => {
    const p = props()
    draw(p)
    fireEvent.change(within(group('Income')).getByLabelText('Amount: Income line 1'), { target: { value: '6000' } })
    expect(p.onChange).toHaveBeenLastCalledWith([{ categoryId: 10, amount: 6000 }, { categoryId: 2, amount: 2100 }, { categoryId: 3, amount: 3180 }], false, expect.any(Array), p.items)
    // the header follows the edit at once
    expect(text(group('Income'))).toContain('Of 6,890.00: 6,000.00 allocated · 890.00 unallocated')
    fireEvent.click(within(group('Income')).getByRole('button', { name: 'Add income line' }))
    const added = within(group('Income line 2')).getByRole('combobox')
    expect(added).toHaveValue('11')
    typeText(within(group('Income line 2')).getByLabelText('Amount: Income line 2'), '12,')
    expect(p.onChange).toHaveBeenLastCalledWith(expect.any(Array), true, expect.arrayContaining([{ categoryId: 11, amount: '12.' }]), p.items)
    fireEvent.click(within(group('Expense line 2')).getByRole('button', { name: 'Remove line' }))
    expect(p.onChange).toHaveBeenLastCalledWith([{ categoryId: 10, amount: 6000 }, { categoryId: 2, amount: 2100 }], true, expect.any(Array), p.items)
    fireEvent.blur(within(group('Income')).getByLabelText('Amount: Income line 1'), { relatedTarget: document.body })
    expect(p.onCommit).toHaveBeenCalledTimes(1)
  })

  it('a group without categories of its direction is left out', () => {
    draw(props({ categories: [reserved, housing], items: [], allocated: { active: 0, passive: 0, expense: 0 } }))
    expect(screen.queryByRole('group', { name: 'Income' })).toBeNull()
    expect(text(group('Expenses'))).toContain('Of 5,280.00: 0.00 allocated · 5,280.00 unallocated')
  })

  it('without any category offers the standard ones and a link to the Records screen', async () => {
    const posts: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/spending/categories' && init?.method === 'POST') posts.push(JSON.parse(String(init.body)))
      return jsonResponse({ categories: [], accounts: [], sources: [], manual: null })
    }))
    draw(props({ categories: [reserved], items: [], allocated: { active: 0, passive: 0, expense: 0 } }))
    expect(screen.getByText('No categories yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Categories' })).toHaveAttribute('href', '/cashflow/categories')
    fireEvent.click(screen.getByRole('button', { name: 'Add standard categories' }))
    await waitFor(() => expect(posts).toHaveLength(19))
    expect(posts[0]).toEqual({ name: 'Housing', kind: 'mandatory' })
    // income categories carry their flow, not a kind; a bonus does not repeat
    expect(posts.slice(12)).toEqual([
      { name: 'Salary', flow: 'active' }, { name: 'Business', flow: 'active' }, { name: 'Bonus', flow: 'active', oneOff: true },
      { name: 'Dividends', flow: 'passive' }, { name: 'Interest', flow: 'passive' }, { name: 'Rent', flow: 'passive' }, { name: 'Benefits', flow: 'passive' },
    ])
  })

  it('explicit mode draws no Save button: a dialog around it saves and reads onChange', () => {
    const onChange = vi.fn()
    draw(props({ mode: 'explicit', onChange, onCommit: undefined }))
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    fireEvent.change(within(group('Expenses')).getByLabelText('Amount: Expense line 1'), { target: { value: '2000' } })
    expect(onChange).toHaveBeenLastCalledWith([{ categoryId: 10, amount: 6500 }, { categoryId: 2, amount: 2000 }, { categoryId: 3, amount: 3180 }], false, expect.any(Array), expect.any(Array))
  })

  it('says its own save state and error', () => {
    const first = draw(props({ status: 'saving' }))
    expect(screen.getByText('Saving…')).toBeInTheDocument()
    first.unmount()
    draw(props({ error: 'boom' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved: boom')
  })

  it('privacy mode masks the header, not the fields', () => {
    stubPrivacyOn()
    draw(props())
    expect(text(group('Income'))).not.toContain('6,890')
    expect(within(group('Income')).getByLabelText('Amount: Income line 1')).toHaveValue('6,500')
  })
})
