// A refused optimistic write (useAdminWrite): the rows are read again, and the screen shows them, not the table as it
// was before the write; a row rolls back only when nothing was read in its place (a network failure).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { LoansView } from '../../../src/pages/admin/LoansView'
import { GoalsScreen } from '../../../src/modules/goals/GoalsScreen'
import { jsonResponse, sent, stubApi } from '../../helpers/http'
import { renderAdmin as renderPage, settled, testClient } from '../../helpers/render'

afterEach(() => { window.history.replaceState(null, '', '/') })
const goal = { rowid: 1, id: 'travel', name: 'Travel', target: 5000, current: 4000, target_date: '2031-12-31', emoji: null, currency: 'USD' }
const cachedNames = (client: ReturnType<typeof testClient>) => client.getQueryData<{ rows: { name: string }[] }>(['admin', 'goals'])!.rows.map(r => r.name)

async function deleteTravel() {
  fireEvent.click(await screen.findByRole('button', { name: 'Actions: Travel' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
  expect(await screen.findByText('Could not delete')).toBeInTheDocument()
}

describe('a refused optimistic write', () => {
  it('a delete refused with 409 shows the rows read again, not the table from before the write', async () => {
    const tables = { goals: [goal] }
    const client = testClient()
    // another device renamed the goal: the server refuses the delete
    stubApi(tables, { answer: { 'DELETE *': () => { tables.goals = [{ ...goal, name: 'Trip to Rome' }]; return jsonResponse({ error: { code: 'row_changed' } }, 409) } } })
    renderPage(<DataPage screen={GoalsScreen} />, { client })
    await deleteTravel()
    await settled(client)
    expect(cachedNames(client)).toEqual(['Trip to Rome'])
    expect(screen.getByText('Trip to Rome')).toBeInTheDocument()
  })

  it('a delete answered 404 (deleted elsewhere) leaves no ghost row', async () => {
    const tables = { goals: [goal] }
    const client = testClient()
    stubApi(tables, { answer: { 'DELETE *': () => { tables.goals = []; return jsonResponse({ error: { code: 'row_not_found' } }, 404) } } })
    renderPage(<DataPage screen={GoalsScreen} />, { client })
    await deleteTravel()
    await settled(client)
    expect(cachedNames(client)).toEqual([])
  })

  it('an early-payment edit refused with 409 takes the row read again, so the next save names it', async () => {
    const loan = { rowid: 1, name: 'Car loan', principal: 24000, rate: 7.5, term_months: 60, monthly_payment: 480.91, issue_date: '2029-06-01', payment_day: null, currency: 'RUB', member: 'Noa', type: 'consumer', status: 'active', closed_date: null }
    const ep = { rowid: 5, id: 5, loan_name: 'Car loan', payment_date: '2029-09-15', amount: 3000, strategy: 'reduce_term', new_payment: null, principal_credit: null, notes: null }
    const tables = { loans: [loan], loan_early_payments: [ep] }
    const client = testClient()
    // another device moved the payment to 2029-10-15: a save naming the old date is refused
    const api = stubApi(tables, { answer: { 'PUT *': () => {
      tables.loan_early_payments = [{ ...ep, payment_date: '2029-10-15' }]
      return jsonResponse({ error: { code: 'row_changed' } }, 409)
    } } })
    renderPage(<DataPage screen={LoansView} />, { client })
    fireEvent.click(await screen.findByRole('button', { name: /^Actions: / }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const dialog = document.querySelector<HTMLElement>('.ln-editor')!
    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'x' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(api, 'PUT')).toHaveLength(1))
    await screen.findAllByText('Could not save')
    await settled(client)
    expect(client.getQueryData<{ rows: { payment_date: string }[] }>(['admin', 'loan_early_payments'])!.rows.map(r => r.payment_date)).toEqual(['2029-10-15'])
  })
})
