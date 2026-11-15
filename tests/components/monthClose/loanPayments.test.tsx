import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { DraftRequest } from '../../../src/domain/api'
import { resetAuth } from '../../../src/lib/authState'
import { base, renderScreen, stubState, closable } from '../../helpers/monthClose'

afterEach(() => { resetAuth() })

const ready = {
  ...base, problems: [],
  rows: base.rows.map(r => ({ ...r, balance: 1, active: 0, passive: 0, expense: 0 })),
  loanPayments: [{ name: 'Car loan', currency: 'RUB', scheduled: 1000, amount: 1000 }],
}

describe('Month-close wizard: loan payments', () => {
  it('shows a line per loan with the scheduled amount and the hint about account expenses', async () => {
    stubState(ready)
    renderScreen()
    const section = (await screen.findByRole('heading', { name: 'Loan payments' })).closest('section')!
    expect(within(section).getByText('Car loan')).toBeInTheDocument()
    expect(within(section).getByLabelText('Amount: Car loan')).toHaveValue('1,000')
    // the schedule in its own grey cell beside the amount, the same figure or not
    expect(within(section).getByText('By schedule: 1,000.00')).toHaveClass('close-loan__sched')
    // the loans are a card of their own, the same ruled table as the accounts
    expect(section).toHaveClass('card', 'close-loans')
    // a note outside the table head: the head is hidden on a phone
    const hint = screen.getByText('Expenses: leave out loan payments, they are entered in the block below.')
    expect(hint.closest('thead')).toBeNull()
    expect(hint.closest('table')).toBeNull()
    // the column is the loan, not the block's title again
    expect(within(section).getByRole('columnheader', { name: 'Loan' })).toBeInTheDocument()
    expect(within(section).queryByRole('columnheader', { name: 'Loan payments' })).toBeNull()
  })

  it('“+ Account” stays right under the accounts table, before the loan block', async () => {
    stubState(ready)
    renderScreen()
    const heading = await screen.findByRole('heading', { name: 'Loan payments' })
    const add = screen.getByRole('button', { name: '+ Account' })
    expect(add.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('has no block and no hint without loans', async () => {
    stubState({ ...ready, loanPayments: [] })
    renderScreen()
    await screen.findByLabelText('Expense: Quillmark Bank')
    expect(screen.queryByRole('heading', { name: 'Loan payments' })).toBeNull()
    expect(screen.queryByText(/leave out loan payments/)).toBeNull()
  })

  it('an edited amount is saved in the draft; the schedule is shown beside a different amount', async () => {
    const sent: DraftRequest[] = []
    stubState(ready, (_url, init) => { sent.push(JSON.parse(String(init.body))); return ready })
    renderScreen()
    const field = await screen.findByLabelText('Amount: Car loan')
    fireEvent.change(field, { target: { value: '1200' } })
    expect(field).toHaveValue('1,200')
    expect(screen.getByText('By schedule: 1,000.00')).toBeInTheDocument()
    fireEvent.blur(field)
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].loans).toEqual([{ name: 'Car loan', amount: 1200 }])
    expect(sent[0].rows).toHaveLength(2)
  })

  it('a cleared amount blocks closing with the loan’s problem text', async () => {
    stubState(ready)
    renderScreen()
    const field = await screen.findByLabelText('Amount: Car loan')
    expect(closable(await screen.findByRole('button', { name: 'Close June 2031' }))).toBe(true)
    fireEvent.change(field, { target: { value: '' } })
    expect(closable(screen.getByRole('button', { name: 'Close June 2031' }))).toBe(false)
    const list = screen.getByRole('list', { name: 'What prevents closing the month' })
    expect(within(list).getByText('Loan payment “Car loan”: enter an amount (zero if nothing was paid)')).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    // zero is a value
    fireEvent.change(field, { target: { value: '0' } })
    expect(closable(screen.getByRole('button', { name: 'Close June 2031' }))).toBe(true)
  })
})
