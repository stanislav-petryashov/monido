import { fireEvent, screen, within } from '@testing-library/react'
import { resetAuth } from '../../../src/lib/authState'
import { renderAdmin, stubPrivacyOn } from '../../helpers/render'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { MonthCloseView } from '../../../src/pages/admin/MonthCloseView'
import { base, renderScreen, stubState } from '../../helpers/monthClose'

afterEach(() => { resetAuth(); vi.unstubAllGlobals() })

const BANK = '["Quillmark Bank","Robin"]'
/** May's figures of Quillmark Bank: the salary and the zero passive income repeat, the expense does not */
const withHints = {
  ...base,
  flowHints: { [BANK]: { active: { last: 5000, steady: true }, passive: { last: 0, steady: true }, expense: { last: 3100, steady: false } } },
}

describe('Month-close wizard: last month’s flows and steady figures', () => {
  it('says last month’s figure under an empty flow field, and offers it only when it is steady', async () => {
    stubState(withHints, () => withHints)
    renderScreen()
    const active = await screen.findByLabelText('Active income: Quillmark Bank')
    const cell = active.closest('td')!
    expect(within(cell).getByText('in May: 5,000')).toBeInTheDocument()
    expect(within(cell).getByRole('button', { name: 'Use 5,000 for Active income: Quillmark Bank' })).toBeInTheDocument()
    const expense = screen.getByLabelText('Expense: Quillmark Bank').closest('td')!
    expect(within(expense).getByText('in May: 3,100')).toBeInTheDocument()
    expect(within(expense).queryByRole('button', { name: /^Use/ })).toBeNull()
  })

  it('“Use” types the figure into the field as the person would; nothing is filled by itself', async () => {
    stubState(withHints, () => withHints)
    renderScreen()
    const active = await screen.findByLabelText('Active income: Quillmark Bank')
    expect(active).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Use 5,000 for Active income: Quillmark Bank' }))
    expect(active).toHaveValue('5,000')
    expect(screen.queryByRole('button', { name: 'Use 5,000 for Active income: Quillmark Bank' })).toBeNull()
  })

  it('the row menu fills only the empty steady fields, never the balance or a figure that changed', async () => {
    stubState(withHints, () => withHints)
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: Quillmark Bank' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fill steady figures (2)' }))
    expect(screen.getByLabelText('Active income: Quillmark Bank')).toHaveValue('5,000')
    expect(screen.getByLabelText('Passive income: Quillmark Bank')).toHaveValue('0')
    expect(screen.getByLabelText('Expense: Quillmark Bank')).toHaveValue('')
    expect(screen.getByLabelText('Balance: Quillmark Bank')).toHaveValue('')
  })

  it('privacy mode hides the suggested amounts', async () => {
    stubPrivacyOn()
    stubState(withHints, () => withHints)
    renderAdmin(<DataPage screen={MonthCloseView} />, { dashboard: true })
    const cell = (await screen.findByLabelText('Active income: Quillmark Bank')).closest('td')!
    expect(within(cell).queryByText(/5,000/)).toBeNull()
    expect(within(cell).getByRole('button', { name: /^Use/ })).toBeInTheDocument()
  })
})

describe('Month-close wizard: deposits of an investment account', () => {
  const broker = { ...base, rows: [{ ...base.rows[0], name: 'Orb Broker', class: 'broker' as const }, base.rows[1]] }

  it('asks a broker account what was put in or taken out, a bank account not; typed in, it goes into the draft', async () => {
    const sent: unknown[] = []
    stubState(broker, (_url, init) => { sent.push(JSON.parse(String(init.body))); return broker })
    renderScreen()
    const field = await screen.findByLabelText('Put in (+) or taken out (−) this month: Orb Broker')
    expect(screen.queryByLabelText(/Put in .*: Deposit/)).toBeNull()
    fireEvent.change(field, { target: { value: '-250' } })
    fireEvent.blur(field)
    await vi.waitFor(() => expect(sent.at(-1)).toMatchObject({ rows: [expect.objectContaining({ name: 'Orb Broker', deposited: -250 }), expect.anything()] }))
  })
})
