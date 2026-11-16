import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { LoansView } from '../../../src/pages/admin/LoansView'
import type { Mock } from 'vitest'
import { type Answer, deferred, jsonResponse, sent, stubApi } from '../../helpers/http'
import { renderAdmin as renderPage, settled, stubPrivacyOn, testClient } from '../../helpers/render'
import { withLanguage } from '../../helpers/i18n'
import { header, typeText } from '../../helpers/adminScreens'
import { resetAuth, setAuth } from '../../../src/lib/authState'
afterEach(() => { window.history.replaceState(null, '', '/') })

/** The early payment's editor in place */
const editor = () => document.querySelector<HTMLElement>('.ln-editor')!
/** The chosen loan's head is drawn */
const loaded = () => screen.findByRole('list', { name: 'Loan details' })

/** «Early payment», the head's primary: the editor opens as the top row of the early payments */
const openEarly = async () => fireEvent.click(await screen.findByRole('button', { name: 'Early payment' }))
/** «···» → «Edit loan»: the loan's form in place of its head */
async function editLoan() {
  fireEvent.click(await screen.findByRole('button', { name: 'Loan actions' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit loan' }))
}

describe('Loans screen', () => {
  it('refreshes the summary after a save: the debt on this page must not wait for leaving it', async () => {
    const fetchMock = stubLoans({}, { 'POST *': () => jsonResponse({ ok: true }) })
    renderPage(<DataPage screen={LoansView} />)
    await openEarly()
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2029-10-15' } })
    fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '1000' } })
    const reads = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/snapshot')).length
    await waitFor(() => expect(reads()).toBeGreaterThan(0))
    const before = reads()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1))
    await waitFor(() => expect(reads()).toBeGreaterThan(before))
  })

  it('locks early payment input during a save and unlocks unchanged values after failure', async () => {
    const gate = deferred()
    const fetchMock = stubLoans({}, { 'POST *': () => gate.promise.then(() => jsonResponse({ error: 'boom' }, 500)) })
    renderPage(<DataPage screen={LoansView} />)
    await openEarly()
    const input = screen.getByLabelText(/^Amount \(/)
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2029-10-15' } })
    fireEvent.change(input, { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1))
    expect(input).toBeDisabled()
    fireEvent.keyDown(input, { key: '2' })
    expect(input).toHaveValue('1,000')
    gate.resolve()
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
    expect(input).toBeEnabled()
    expect(input).toHaveValue('1,000')
  })
  it('keeps a dirty loan editor and its target when refetch removes the selected loan', async () => {
    const tables = { loans: [{ rowid: 1, name: 'A', principal: 24000, rate: 7.5, term_months: 60, monthly_payment: 480.91, issue_date: '2029-06-01', payment_day: null, currency: 'USD', member: 'Noa', type: 'consumer', status: 'active', closed_date: null }, { rowid: 2, name: 'B', principal: 100, rate: 0, term_months: 12, monthly_payment: 10, issue_date: '2029-06-01', payment_day: null, currency: 'USD', member: 'Noa', type: 'consumer', status: 'active', closed_date: null }] }
    const fetchMock = stubApi(tables, { answer: { 'PUT *': () => jsonResponse({ error: 'gone' }, 404) } })
    const client = testClient()
    renderPage(<DataPage screen={LoansView} />, { client })
    await editLoan()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft A' } })
    fireEvent.click(screen.getByRole('button', { name: /B/ }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    tables.loans = tables.loans.filter(row => row.name !== 'A')
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'loans'] }) })
    await waitFor(() => expect(screen.queryByRole('button', { name: /^A / })).toBeNull())
    expect(screen.getByLabelText('Name')).toHaveValue('Draft A')
    fireEvent.submit(screen.getByLabelText('Name').closest('form')!)
    fireEvent.submit(screen.getByLabelText('Name').closest('form')!)
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
    expect(sent(fetchMock, 'PUT')).toHaveLength(1)
    expect(sent(fetchMock, 'PUT')[0]).toMatchObject({ url: '/api/loans/1', body: { expectedName: 'A' } })
    expect(screen.getByLabelText('Name')).toHaveValue('Draft A')
  })
  const loan = { rowid: 1, name: 'Car loan', principal: 24000, rate: 7.5, term_months: 60, monthly_payment: 480.91, issue_date: '2029-06-01', payment_day: null, currency: 'RUB', member: 'Noa', type: 'consumer', status: 'active', closed_date: null }
  const stubLoans = (over: object = {}, answer: Record<string, Answer> = {}) => stubApi({
    loans: [{ ...loan, ...over }],
    loan_early_payments: [{ rowid: 5, id: 5, loan_name: 'Car loan', payment_date: '2029-09-15', amount: 3000, strategy: 'reduce_term', new_payment: null, principal_credit: null, notes: null }],
  }, { answer })

  it('gives each loan its rate and repaid share from its own record, with no closed month yet', async () => {
    stubLoans({ rate: 11.2 })
    renderPage(<DataPage screen={LoansView} />)
    const row = await screen.findByRole('button', { name: /Car loan/ })
    expect(row).toHaveTextContent('11.2%')
    expect(row).toHaveTextContent(/\d+% repaid/)
  })

  it('writes the rate through the number formatter, in the UI language', async () => {
    stubLoans({ rate: 11.2 })
    await withLanguage('ru-RU', async () => {
      renderPage(<DataPage screen={LoansView} />)
      const row = await screen.findByRole('button', { name: /Car loan/ })
      expect(row).toHaveTextContent(`${(11.2).toLocaleString('ru-RU')}%`)
    })
  })

  it('a closed loan without a close date is still owing: the list gives its rate and balance by schedule', async () => {
    stubLoans({ rate: 11.2, status: 'closed', closed_date: null })
    renderPage(<DataPage screen={LoansView} />)
    const row = await screen.findByRole('button', { name: /Car loan/ })
    expect(row).toHaveTextContent('11.2%')
    expect(row).toHaveTextContent('repaid')
  })

  it('gives no facts for a closed loan, and no repaid share when the amount is unknown', async () => {
    stubLoans({ rate: 11.2, status: 'closed', closed_date: '2025-01-10' })
    const { unmount } = renderPage(<DataPage screen={LoansView} />)
    const closed = await screen.findByRole('button', { name: /Car loan/ })
    expect(closed).not.toHaveTextContent('11.2%')
    unmount()
    stubLoans({ rate: 11.2, principal: 0 })
    renderPage(<DataPage screen={LoansView} />)
    const row = await screen.findByRole('button', { name: /Car loan/ })
    expect(row).toHaveTextContent('11.2%')
    expect(row).not.toHaveTextContent('repaid')
  })

  it('states the interest ahead of the selected loan in its own currency', async () => {
    stubLoans({ currency: 'EUR' })
    renderPage(<DataPage screen={LoansView} />)
    expect((await screen.findByText('Interest ahead')).nextElementSibling).toHaveTextContent(/^€/)
  })

  it('identifies displayed balances and payoff amounts as calculated rather than bank-confirmed', async () => {
    stubPrivacyOn()
    stubLoans()
    renderPage(<DataPage screen={LoansView} />, { dashboard: true })
    expect(await screen.findByText(/Loan balances, interest and payoff amounts are calculated from the schedule/)).toHaveTextContent(/bank/)
    expect(screen.getByText(/Loan balances, interest and payoff amounts/).closest('.admin-panel')).not.toHaveTextContent(/24,000/)
  })

  it('the header\'s “+ Loan” is a secondary button: the violet fill is for commit actions', async () => {
    stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    const add = await within(header()).findByRole('button', { name: '+ Loan' })
    expect(add).toHaveClass('btn--ghost')
    expect(add).not.toHaveClass('btn--primary')
  })

  it('leaves task navigation to the shell instead of duplicating a header link', async () => {
    stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    expect(within(header()).queryByRole('link', { name: 'View on Net worth' })).toBeNull()
  })

  it('opens with the loan the address names, else the first', async () => {
    const second = { ...loan, rowid: 2, name: 'Phone plan' }
    const stubTwo = () => stubApi({ loans: [loan, second], loan_early_payments: [] })
    stubTwo()
    window.history.replaceState(null, '', `/loans#${encodeURIComponent('Phone plan')}`)
    const { unmount } = renderPage(<DataPage screen={LoansView} />)
    expect(await screen.findByRole('button', { name: /Phone plan/ })).toHaveAttribute('aria-current', 'true')
    unmount()

    stubTwo()
    window.history.replaceState(null, '', `/loans#${encodeURIComponent('Sold car')}`)
    renderPage(<DataPage screen={LoansView} />)
    expect(await screen.findByRole('button', { name: /Car loan/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /Phone plan/ })).not.toHaveAttribute('aria-current')
  })

  it('no “Active” chip: the head leads with the KPIs, the balance today first', async () => {
    // issued a year ago: the schedule is under way
    const issued = new Date()
    issued.setUTCFullYear(issued.getUTCFullYear() - 1)
    stubLoans({ issue_date: issued.toISOString().slice(0, 10) })
    renderPage(<DataPage screen={LoansView} />)
    await loaded()
    expect(screen.queryByText('Active')).toBeNull()
    expect(document.querySelector('.chip')).toBeNull()
    const terms = screen.getAllByRole('term').map(t => t.textContent)
    expect(terms).toEqual([expect.stringMatching(/^Balance on \d\d\/\d\d\/\d{4}$/), 'Monthly payment', 'Last payment', 'Interest ahead'])
  })

  it('a closed loan is marked neutrally: dimmed in the list without a balance, a «Closed» tag in the head', async () => {
    stubLoans({ status: 'closed', closed_date: '2025-06-02' })
    renderPage(<DataPage screen={LoansView} />)
    const row = await screen.findByRole('button', { name: /Car loan/ })
    expect(row).toHaveClass('ln-row--closed')
    expect(row).toHaveTextContent('closed 06/02/2025')
    expect(row.querySelector('.record-row__bal')).toBeEmptyDOMElement()
    expect(within(screen.getByRole('list', { name: 'Loan details' })).getByText('Closed 06/02/2025')).toBeInTheDocument()
  })

  it('offers “+ Loan” in the header, «Early payment» as the one primary and the loan actions behind «···»', async () => {
    stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    expect(await within(header()).findByRole('button', { name: '+ Loan' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Early payment' })).toHaveClass('btn--primary')
    expect(document.querySelectorAll('.btn--primary')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Loan actions' }))
    expect(screen.getAllByRole('menuitem').map(m => m.textContent)).toEqual(['Edit loan', 'Delete loan…'])
  })

  it('labels every field of the new-loan form', async () => {
    stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    fireEvent.click(await within(header()).findByRole('button', { name: '+ Loan' }))
    const dialog = screen.getByRole('dialog', { name: 'New loan' })
    expect(within(dialog).getByLabelText('Name')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Rate (%)')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Type')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByLabelText('Rate (%)')).toBeNull()
  })

  it('does not send an unreadable loan amount, and reads a grouped one', async () => {
    const fetchMock = stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    fireEvent.click(await within(header()).findByRole('button', { name: '+ Loan' }))
    const dialog = screen.getByRole('dialog', { name: 'New loan' })
    const posts = () => sent(fetchMock, 'POST')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Boat loan' } })
    // unreadable: a separator with no digits after it (a typed "1.000" is now "1.00", a readable one)
    typeText(within(dialog).getByLabelText(/^Loan amount/), '1,')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a number')
    expect(posts()).toHaveLength(0)
    expect(screen.getByRole('dialog', { name: 'New loan' })).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(/^Loan amount/), { target: { value: '24 000,5' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toMatchObject({ name: 'Boat loan', principal: '24000.5' })
  })

  it('does not send a loan without a name, new or renamed', async () => {
    const fetchMock = stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    const writes = () => sent(fetchMock, ['POST', 'PUT'])
    fireEvent.click(await within(header()).findByRole('button', { name: '+ Loan' }))
    const dialog = screen.getByRole('dialog', { name: 'New loan' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '   ' } })
    fireEvent.change(within(dialog).getByLabelText(/^Loan amount/), { target: { value: '10000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the loan\'s name')
    expect(screen.getByRole('dialog', { name: 'New loan' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await editLoan()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => a.textContent?.includes('Enter the loan\'s name'))).toBe(true))
    expect(writes()).toHaveLength(0)
  })

  it('does not send a term over 420 months (35 years), new or edited; 420 is sent', async () => {
    const fetchMock = stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    const writes = () => sent(fetchMock, ['POST', 'PUT'])
    fireEvent.click(await within(header()).findByRole('button', { name: '+ Loan' }))
    const dialog = screen.getByRole('dialog', { name: 'New loan' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Mortgage' } })
    fireEvent.change(within(dialog).getByLabelText(/^Loan amount/), { target: { value: '100000' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Months' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Term' }), { target: { value: '421' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(dialog).getAllByRole('alert').some(a => a.classList.contains('field__error'))).toBe(true))
    const term = within(dialog).getByRole('textbox', { name: 'Term' })
    expect(term).toHaveAttribute('aria-invalid', 'true')
    expect(term).toHaveAccessibleDescription(/The term is at most 35 years/ )
    expect(term).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'New loan' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await editLoan()
    fireEvent.click(screen.getByRole('radio', { name: 'Months' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Term' }), { target: { value: '421' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getAllByRole('alert').filter(a => a.textContent?.includes('The term is at most 35 years (420 months)')).length).toBeGreaterThanOrEqual(2))
    expect(writes()).toHaveLength(0)
    const editTerm = screen.getByRole('textbox', { name: 'Term' })
    expect(editTerm).toHaveAttribute('aria-invalid', 'true')
    expect(editTerm).toHaveFocus()

    fireEvent.change(screen.getByRole('textbox', { name: 'Term' }), { target: { value: '420' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0].body).toMatchObject({ term_months: '420' })
  })

  it('a loan stored with a term over the limit (480 months) stays editable: the unchanged term is not sent; changed to 421 it is refused', async () => {
    const fetchMock = stubLoans({ term_months: 480 })
    renderPage(<DataPage screen={LoansView} />)
    const writes = () => sent(fetchMock, ['POST', 'PUT'])
    await editLoan()
    fireEvent.change(screen.getByLabelText(/^Rate/), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0].body).toMatchObject({ rate: '6' })
    expect('term_months' in (writes()[0].body as Record<string, unknown>)).toBe(false)

    await editLoan()
    fireEvent.click(screen.getByRole('radio', { name: 'Months' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Term' }), { target: { value: '421' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Term' })).toHaveAccessibleDescription(/The term is at most/))
    expect(writes()).toHaveLength(1)
  })

  it('the new-loan form sends the currency and the member it shows', async () => {
    const fetchMock = stubApi({
      loans: [{ ...loan }], loan_early_payments: [],
      currencies: [{ rowid: 1, code: 'EUR' }, { rowid: 2, code: 'RUB' }],
      members: [{ rowid: 1, name: 'Robin' }, { rowid: 2, name: 'Noa' }],
    })
    renderPage(<DataPage screen={LoansView} />)
    fireEvent.click(await within(header()).findByRole('button', { name: '+ Loan' }))
    const dialog = screen.getByRole('dialog', { name: 'New loan' })
    await waitFor(() => expect(within(screen.getByRole('radiogroup', { name: 'Currency' })).getByRole('radio', { name: 'EUR' })).toBeChecked())
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Boat loan' } })
    fireEvent.change(within(dialog).getByLabelText(/^Loan amount/), { target: { value: '10000' } })
    fireEvent.change(within(dialog).getByLabelText(/^Rate/), { target: { value: '5' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Term' }), { target: { value: '12' } })
    fireEvent.change(within(dialog).getByLabelText('Issue date'), { target: { value: '2031-01-01' } })
    const shownMember = (within(screen.getByRole('radiogroup', { name: 'Member' })).getByRole('radio', { checked: true }) as HTMLInputElement).value
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'POST')).not.toHaveLength(0))
    const post = sent(fetchMock, 'POST')[0]
    expect(post.body).toMatchObject({ name: 'Boat loan', currency: 'EUR', member: shownMember })
    expect(shownMember).not.toBe('')
  })

  it('a new loan is in the family currency, as a new account, not the first listed one', async () => {
    const fetchMock = stubApi({
      loans: [{ ...loan }], loan_early_payments: [],
      currencies: [{ rowid: 1, code: 'EUR' }, { rowid: 2, code: 'RUB' }, { rowid: 3, code: 'USD' }],
      members: [{ rowid: 1, name: 'Noa' }],
    })
    renderPage(<DataPage screen={LoansView} />)
    fireEvent.click(await within(header()).findByRole('button', { name: '+ Loan' }))
    const dialog = screen.getByRole('dialog', { name: 'New loan' })
    await waitFor(() => expect(within(screen.getByRole('radiogroup', { name: 'Currency' })).getByRole('radio', { name: 'USD' })).toBeChecked())
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Boat loan' } })
    fireEvent.change(within(dialog).getByLabelText(/^Loan amount/), { target: { value: '10000' } })
    fireEvent.change(within(dialog).getByLabelText(/^Rate/), { target: { value: '5' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Term' }), { target: { value: '12' } })
    fireEvent.change(within(dialog).getByLabelText('Issue date'), { target: { value: '2031-01-01' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'POST')).not.toHaveLength(0))
    expect(sent(fetchMock, 'POST')[0].body).toMatchObject({ name: 'Boat loan', currency: 'USD' })
  })

  it('the edit form of a loan without a payment day sends none (null) once the day is cleared, not an empty text', async () => {
    const fetchMock = stubLoans({ payment_day: 5 })
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    fireEvent.change(screen.getByLabelText('Payment day'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'PUT')).not.toHaveLength(0))
    expect(sent(fetchMock, 'PUT')[0].body).toMatchObject({ payment_day: null })
  })

  it('an unchanged edit form writes nothing and closes', async () => {
    const fetchMock = stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull())
    expect(sent(fetchMock, 'PUT')).toHaveLength(0)
  })

  it('the edit form of a loan stored with payment day 32 leaves the untouched day out, so the save goes through', async () => {
    const fetchMock = stubLoans({ payment_day: 32 })
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    typeText(screen.getByRole('textbox', { name: 'Name' }), 'Car loan 2')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'PUT')).not.toHaveLength(0))
    const body = sent(fetchMock, 'PUT')[0].body as Record<string, unknown>
    expect(body).toMatchObject({ name: 'Car loan 2' })
    expect('payment_day' in body).toBe(false)
  })

  it('the edit form sends only the fields it changed: an unchanged rate, amount or term is not rewritten', async () => {
    const fetchMock = stubLoans({ principal: 24000.125, monthly_payment: 1234.125 })
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    typeText(screen.getByRole('textbox', { name: 'Name' }), 'Car loan 2')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'PUT')).not.toHaveLength(0))
    expect(sent(fetchMock, 'PUT')[0].body).toEqual({ expectedName: 'Car loan', name: 'Car loan 2' })
  })

  describe('the edit card is a form', () => {
    const puts = (fetchMock: ReturnType<typeof stubLoans>) => sent(fetchMock, 'PUT')
    /** Enter in a field, as a browser does it: the form is submitted unless the keydown was stopped */
    const pressEnter = (input: HTMLElement) => {
      if (fireEvent.keyDown(input, { key: 'Enter' })) fireEvent.submit(input.closest('form')!)
    }

    it('Save with a half-typed issue date writes nothing, not an empty date, and says why', async () => {
      const fetchMock = stubLoans()
      const client = testClient()
      renderPage(<DataPage screen={LoansView} />, { client })
      await editLoan()
      const date = screen.getByRole('textbox', { name: 'Issue date' })
      fireEvent.change(date, { target: { value: '06/1' } })
      fireEvent.blur(date)
      expect(screen.getByText('Finish the date: MM/DD/YYYY')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(date).toHaveFocus()
      expect(date).toHaveAccessibleDescription(/Finish the date/)
      expect(puts(fetchMock)).toHaveLength(0)
      // Enter on the date itself is held by the field, Enter elsewhere is refused by the save
      pressEnter(date)
      pressEnter(screen.getByRole('textbox', { name: 'Name' }))
      await settled(client)
      expect(puts(fetchMock)).toHaveLength(0)
      expect(screen.getByRole('textbox', { name: 'Issue date' })).toBeInTheDocument()
    })

    it('focuses an impossible issue date and names the actual date error', async () => {
      const fetchMock = stubLoans()
      renderPage(<DataPage screen={LoansView} />)
      await editLoan()
      const date = screen.getByRole('textbox', { name: 'Issue date' })
      fireEvent.change(date, { target: { value: '13/32/2026' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(date).toHaveAttribute('aria-invalid', 'true')
      expect(date).toHaveAccessibleDescription(/no such date/i)
      expect(date).toHaveFocus()
      expect(puts(fetchMock)).toHaveLength(0)
    })

    it('Enter in a field saves, Escape cancels', async () => {
      const fetchMock = stubLoans()
      renderPage(<DataPage screen={LoansView} />)
      await editLoan()
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' })
      expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
      await editLoan()
      fireEvent.change(screen.getByRole('textbox', { name: 'Issue date' }), { target: { value: '2029-07-01' } })
      pressEnter(screen.getByRole('textbox', { name: 'Name' }))
      await waitFor(() => expect(puts(fetchMock)).toHaveLength(1))
      expect(puts(fetchMock)[0].body).toMatchObject({ issue_date: '2029-07-01' })
      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull())
    })
  })

  it('renaming sends one atomic loan edit without dependency requests', async () => {
    const fetchMock = stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Auto loan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull())
    expect(sent(fetchMock, ['PUT', 'POST', 'DELETE'])).toEqual([
      expect.objectContaining({ method: 'PUT', url: '/api/loans/1', body: expect.objectContaining({ name: 'Auto loan' }) }),
    ])
  })

  it('a failed atomic edit retains entered fields and the prior status', async () => {
    stubLoans({}, { 'PUT *': () => jsonResponse({ error: 'boom' }, 500) })
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Auto loan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Auto loan')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
    expect(await screen.findByRole('heading', { name: 'Car loan' })).toBeInTheDocument()
    expect(screen.queryByText('Closed')).toBeNull()
  })

  it('a double submit of the edit form writes the loan once, and Save waits while it is written', async () => {
    const gate = deferred()
    const fetchMock = stubLoans({}, { 'PUT *': (_init, fallback) => gate.promise.then(fallback) })
    const loanPuts = () => sent(fetchMock, 'PUT').filter(r => r.url === '/api/loans/1')
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    typeText(screen.getByRole('textbox', { name: 'Name' }), 'Car loan 2')
    const form = screen.getByRole('textbox', { name: 'Name' }).closest('form') as HTMLFormElement
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeDisabled()
    gate.resolve()
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull())
    expect(loanPuts()).toHaveLength(1)
  })

  it('the edit form saves an untouched term switched to years unchanged', async () => {
    const fetchMock = stubLoans({ term_months: 67 })
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    fireEvent.click(screen.getByRole('radio', { name: 'Years' }))
    expect(screen.getByRole('textbox', { name: 'Term' })).toHaveValue('5.58')
    typeText(screen.getByRole('textbox', { name: 'Name' }), 'Car loan 2')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'PUT')).not.toHaveLength(0))
    // still the stored 67 months, not 5.58 years read back: an unchanged term is left out of the PUT
    expect('term_months' in (sent(fetchMock, 'PUT')[0].body as Record<string, unknown>)).toBe(false)
  })

  it('fills the monthly payment rounded to cents, so the form can be saved', async () => {
    stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    fireEvent.click(await within(header()).findByRole('button', { name: '+ Loan' }))
    const dialog = screen.getByRole('dialog', { name: 'New loan' })
    fireEvent.change(within(dialog).getByLabelText(/^Loan amount/), { target: { value: '10001' } })
    fireEvent.change(within(dialog).getByLabelText(/^Rate/), { target: { value: '0' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Months' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Term' }), { target: { value: '8' } })
    expect(within(dialog).getByLabelText(/^Monthly payment/)).toHaveValue('1,250.13')
  })

  it.each([['6.125', '2,430.44'], ['3,875', '1,880.95'], ['3.875', '1,880.95']])('reads a rate of %j with three decimals as a rate, not as thousands', async (rate, payment) => {
    stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    fireEvent.click(await within(header()).findByRole('button', { name: '+ Loan' }))
    const dialog = screen.getByRole('dialog', { name: 'New loan' })
    fireEvent.change(within(dialog).getByLabelText(/^Loan amount/), { target: { value: '400000' } })
    fireEvent.change(within(dialog).getByLabelText(/^Rate/), { target: { value: rate } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Term' }), { target: { value: '30' } })
    expect(within(dialog).getByLabelText(/^Monthly payment/)).toHaveValue(payment)
    // the principal typed last reads the rate the same way
    fireEvent.change(within(dialog).getByLabelText(/^Loan amount/), { target: { value: '400 000' } })
    expect(within(dialog).getByLabelText(/^Monthly payment/)).toHaveValue(payment)
  })

  it('the edit form reads a three-decimal rate too', async () => {
    stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    fireEvent.change(screen.getByLabelText(/^Rate/), { target: { value: '6.125' } })
    expect(screen.getByLabelText(/^Monthly payment/)).toHaveValue('465.38')
  })

  describe('the new-loan form', () => {
    const open = async () => {
      stubLoans()
      renderPage(<DataPage screen={LoansView} />)
      fireEvent.click(await within(header()).findByRole('button', { name: '+ Loan' }))
      return screen.getByRole('dialog', { name: 'New loan' })
    }
    const type = (dialog: HTMLElement, name: RegExp, value: string) => fireEvent.change(within(dialog).getByRole('textbox', { name }), { target: { value } })

    it('says the payment is calculated while it follows the formula, and offers the formula back once one is typed', async () => {
      const dialog = await open()
      type(dialog, /^Loan amount/, '3000000')
      type(dialog, /^Rate/, '12')
      type(dialog, /^Term/, '20')
      const payment = within(dialog).getByLabelText(/^Monthly payment/)
      const formula = (payment as HTMLInputElement).value
      expect(formula).toBe('33,032.58')
      expect(within(dialog).getByText('Calculated from the amount, rate and term')).toBeInTheDocument()
      expect(within(dialog).queryByRole('button', { name: /^Use the formula/ })).toBeNull()

      type(dialog, /^Monthly payment/, '33500')
      expect(within(dialog).queryByText('Calculated from the amount, rate and term')).toBeNull()
      // a typed payment stays when the loan changes
      type(dialog, /^Loan amount/, '2500000')
      expect(payment).toHaveValue('33,500')
      const back = within(dialog).getByRole('button', { name: 'Use the formula: 27,527.15' })
      expect(back).toHaveAttribute('type', 'button')
      fireEvent.click(back)
      expect(payment).toHaveValue('27,527.15')
      expect(within(dialog).getByText('Calculated from the amount, rate and term')).toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'New loan' })).toBeInTheDocument()
    })

    it('a rate under 1% asks whether it was meant in percent, and the button fixes it', async () => {
      const dialog = await open()
      type(dialog, /^Rate/, '0.12')
      expect(within(dialog).getByText('0.12%: did you mean 12%?')).toBeInTheDocument()
      const fix = within(dialog).getByRole('button', { name: 'Make it 12%' })
      expect(fix).toHaveAttribute('type', 'button')
      fireEvent.click(fix)
      expect(within(dialog).getByLabelText(/^Rate/)).toHaveValue('12')
      expect(within(dialog).queryByText(/did you mean/)).toBeNull()
    })

    it('a rate over 60% asks to check it', async () => {
      const dialog = await open()
      type(dialog, /^Rate/, '125')
      expect(within(dialog).getByText('Over 60% a year: check the rate')).toBeInTheDocument()
      type(dialog, /^Rate/, '12.5')
      expect(within(dialog).queryByText(/check the rate/)).toBeNull()
    })

    it('takes the term in years or in months and stores months', async () => {
      const fetchMock = stubLoans()
      renderPage(<DataPage screen={LoansView} />)
      fireEvent.click(await within(header()).findByRole('button', { name: '+ Loan' }))
      const dialog = screen.getByRole('dialog', { name: 'New loan' })
      const unit = within(dialog).getByRole('radiogroup', { name: 'Years or months' })
      expect(within(unit).getByRole('radio', { name: 'Years' })).toBeChecked()
      fireEvent.click(within(unit).getByRole('radio', { name: 'Months' }))
      type(dialog, /^Term/, '240')
      expect(within(dialog).getByText('20 years')).toBeInTheDocument()
      fireEvent.click(within(unit).getByRole('radio', { name: 'Years' }))
      expect(within(dialog).getByRole('textbox', { name: 'Term' })).toHaveValue('20')
      expect(within(dialog).getByText('240 mo')).toBeInTheDocument()
      type(dialog, /^Term/, '20,5')
      expect(within(dialog).getByRole('textbox', { name: 'Term' })).toHaveValue('20.5')
      expect(within(dialog).getByText('246 mo')).toBeInTheDocument()
      fireEvent.click(within(unit).getByRole('radio', { name: 'Months' }))
      expect(within(dialog).getByRole('textbox', { name: 'Term' })).toHaveValue('246')
      expect(within(dialog).getByText('20 years 6 mo')).toBeInTheDocument()
      type(dialog, /^Name/, 'Boat loan')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(sent(fetchMock, 'POST')).not.toHaveLength(0))
      const post = sent(fetchMock, 'POST')[0]
      expect(post.body).toMatchObject({ term_months: '246' })
    })

    it('the term caption names the whole control and is not a label around the unit switch', async () => {
      const dialog = await open()
      const term = within(dialog).getByRole('group', { name: 'Term' })
      const unit = within(term).getByRole('radiogroup', { name: 'Years or months' })
      expect(unit.closest('label')).toBeNull()
      expect(within(term).getByRole('textbox', { name: 'Term' })).toBeInTheDocument()
    })
  })

  it('the edit form opens a term of 66 months in months, and keeps a payment typed from the bank', async () => {
    stubLoans({ term_months: 66, monthly_payment: 500 })
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    expect(screen.getByRole('radio', { name: 'Months' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Term' })).toHaveValue('66')
    expect(screen.getByRole('button', { name: /^Use the formula/ })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Rate/), { target: { value: '8' } })
    expect(screen.getByLabelText(/^Monthly payment/)).toHaveValue('500')
  })

  it('the editor stays while a save is pending, and a double Enter writes once', async () => {
    const gate = deferred()
    const fetchMock = stubLoans({}, { 'POST *': () => gate.promise.then(() => jsonResponse({})) })
    renderPage(<DataPage screen={LoansView} />)
    await openEarly()
    const dialog = editor()
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2029-10-15' } })
    const amount = within(dialog).getByLabelText(/^Amount \(/)
    fireEvent.change(amount, { target: { value: '1000' } })
    fireEvent.keyDown(amount, { key: 'Enter' })
    fireEvent.keyDown(amount, { key: 'Enter' })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled())
    fireEvent.keyDown(amount, { key: 'Escape' })
    expect(editor()).toBeInTheDocument()
    gate.resolve()
    await waitFor(() => expect(document.querySelector('.ln-editor')).toBeNull())
    expect(sent(fetchMock, 'POST')).toHaveLength(1)
  })

  it('the early payment weighs repaying against investing: the loan rate first, then the result at the return typed', async () => {
    const fetchMock = stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    await openEarly()
    const dialog = editor()
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2030-06-01' } })
    fireEvent.change(within(dialog).getByLabelText(/^Amount \(/), { target: { value: '5000' } })
    fireEvent.click(within(dialog).getByText('And if you invested it instead?'))
    expect(within(dialog).getByText(/Repaying earns a certain 7\.5% a year/)).toBeInTheDocument()
    expect(within(dialog).getByText(/^At 8% a year, investing leaves .+ more by the end of \w+ 20\d\d$/)).toBeInTheDocument()
    const field = within(dialog).getByLabelText('Expected return a year (%)')
    fireEvent.change(field, { target: { value: '5' } })
    expect(within(dialog).getByText(/^At 5% a year, repaying leaves .+ more/)).toBeInTheDocument()
    // Enter in the return field recomputes, it does not save the payment
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(sent(fetchMock, 'POST')).toEqual([])
  })

  it('an early payment is added in place, as the top row of the table', async () => {
    const fetchMock = stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    await openEarly()
    const dialog = editor()
    expect(within(dialog).getByText(/^Max: /)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2029-10-15' } })
    fireEvent.change(within(dialog).getByLabelText(/^Amount \(/), { target: { value: '1000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'POST').map(r => r.url)).toContain('/api/admin/loan_early_payments'))
    await waitFor(() => expect(document.querySelector('.ln-editor')).toBeNull())
  })

  it('refuses an early payment the repaid loan would not take, on add and on edit: a reduce_term one on the last installment\'s day; the day before is sent', async () => {
    // 1200 at 0% over 12 months from 2029-06-01, 100 a month: repaid on 2030-06-01; with 300 paid early on 2029-09-15
    // (reduce_term) on 2030-03-01. A reduce_term payment on the last installment's day comes after it, with nothing left to
    // reduce. An edit is checked against the schedule without the payment being edited.
    const fetchMock = stubApi({
      loans: [{ ...loan, principal: 1200, rate: 0, term_months: 12, monthly_payment: 100 }],
      loan_early_payments: [{ rowid: 5, id: 5, loan_name: 'Car loan', payment_date: '2029-09-15', amount: 300, strategy: 'reduce_term', new_payment: null, principal_credit: null, notes: null }],
    })
    renderPage(<DataPage screen={LoansView} />)
    const writes = () => sent(fetchMock, ['POST', 'PUT'])
    const tooLate = (day: string) => `The loan is repaid on ${day}: by then this payment has nothing left to reduce`

    await openEarly()
    let dialog = editor()
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2030-03-01' } })
    fireEvent.change(within(dialog).getByLabelText(/^Amount \(/), { target: { value: '100' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(tooLate('03/01/2030'))
    expect(writes()).toHaveLength(0)
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2030-02-28' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    await waitFor(() => expect(document.querySelector('.ln-editor')).toBeNull())

    fireEvent.click(await screen.findByRole('button', { name: /^Actions: 09\/15\/2029/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    dialog = editor()
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2030-06-01' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => a.textContent?.includes(tooLate('06/01/2030')))).toBe(true))
    expect(writes()).toHaveLength(1)
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2030-05-31' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(2))
    expect(writes()[1].body).toMatchObject({ payment_date: '2030-05-31' })
  })

  it('refuses an early payment that repays the loan before a stored one, naming the stored one, on add and on edit', async () => {
    // 1200 at 0% over 12 months from 2029-06-01, 100 a month: 100 is left before the last installment of 2030-06-01, and
    // 50 paid on its morning (reduce_payment) still reduces it. 100 on 2030-05-31 repays the loan that day.
    const fetchMock = stubApi({
      loans: [{ ...loan, principal: 1200, rate: 0, term_months: 12, monthly_payment: 100 }],
      loan_early_payments: [
        { rowid: 5, id: 5, loan_name: 'Car loan', payment_date: '2030-06-01', amount: 50, strategy: 'reduce_payment', new_payment: null, principal_credit: null, notes: null },
        { rowid: 6, id: 6, loan_name: 'Car loan', payment_date: '2029-09-15', amount: 20, strategy: 'reduce_term', new_payment: null, principal_credit: null, notes: null },
      ],
    })
    renderPage(<DataPage screen={LoansView} />)
    const writes = () => sent(fetchMock, ['POST', 'PUT'])
    const repaysBefore = 'With this payment the loan is repaid on 05/31/2030: the early payment of 06/01/2030 would have nothing left to reduce'

    await openEarly()
    let dialog = editor()
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2030-05-31' } })
    fireEvent.change(within(dialog).getByLabelText(/^Amount \(/), { target: { value: '80' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(repaysBefore)
    expect(writes()).toHaveLength(0)
    fireEvent.change(within(dialog).getByLabelText(/^Amount \(/), { target: { value: '30' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    await waitFor(() => expect(document.querySelector('.ln-editor')).toBeNull())

    // the 20 of 2029-09-15 moved to 2030-05-31 and raised to 100: without it, 100 is left by then
    fireEvent.click(await screen.findByRole('button', { name: /^Actions: 09\/15\/2029/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    dialog = editor()
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2030-05-31' } })
    fireEvent.change(within(dialog).getByLabelText(/^Amount \(/), { target: { value: '100' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => a.textContent?.includes(repaysBefore))).toBe(true))
    expect(writes()).toHaveLength(1)
  })

  it('privacy mode masks the limit in the early-payment editor and in the two over-the-limit messages', async () => {
    stubPrivacyOn()
    stubLoans()
    renderPage(<DataPage screen={LoansView} />, { dashboard: true })
    await openEarly()
    let dialog = editor()
    expect(within(dialog).getByText('Max: •••')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2029-10-15' } })
    fireEvent.change(within(dialog).getByLabelText(/^Amount \(/), { target: { value: '99999999' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/exceeds the balance on the payment date \(•••\)/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(document.querySelector('.ln-editor')).toBeNull())

    fireEvent.click(await screen.findByRole('button', { name: /^Actions: 09\/15\/2029/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    dialog = editor()
    fireEvent.change(within(dialog).getByLabelText(/^Amount \(/), { target: { value: '99999999' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/exceeds the loan amount \(•••\)/)).toBeInTheDocument()
    expect(screen.queryByText(/24,000/)).toBeNull()
  })

  it('does not write an early payment whose amounts cannot be read, on add and on edit', async () => {
    const fetchMock = stubLoans()
    const writes = () => sent(fetchMock, ['POST', 'PUT'])
    renderPage(<DataPage screen={LoansView} />)
    await openEarly()
    let dialog = editor()
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2029-10-15' } })
    // unreadable: a separator with no digits after it (a typed "1.000" is now "1.00", a readable one)
    typeText(within(dialog).getByLabelText(/^Amount \(/), '1,')
    // Enter, before the field is left: the blur error has not shown yet
    fireEvent.keyDown(within(dialog).getAllByRole('textbox')[1], { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a number')
    expect(writes()).toHaveLength(0)
    expect(editor()).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(document.querySelector('.ln-editor')).toBeNull())

    fireEvent.click(await screen.findByRole('button', { name: /^Actions: 09\/15\/2029 · ₽3,000\.00$/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    dialog = editor()
    typeText(within(dialog).getByLabelText(/^Applied to principal \(/), '2,')
    fireEvent.keyDown(within(dialog).getAllByRole('textbox')[1], { key: 'Enter' })
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => /Not a number/.test(a.textContent ?? ''))).toBe(true))
    expect(writes()).toHaveLength(0)
    expect(editor()).toBeInTheDocument()
  })

  it('keeps the original payment identity after refetch reuses its id', async () => {
    const tables = { loans: [loan], loan_early_payments: [{ rowid: 5, id: 5, loan_name: 'Car loan', payment_date: '2029-09-15', amount: 3000, strategy: 'reduce_term', new_payment: null, principal_credit: null, notes: null }] }
    const fetchMock = stubApi(tables, { answer: { 'PUT *': () => jsonResponse({ error: { code: 'row_changed' } }, 409) } })
    const client = testClient()
    renderPage(<DataPage screen={LoansView} />, { client })
    fireEvent.click(await screen.findByRole('button', { name: /^Actions: 09\/15\/2029/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const dialog = editor()
    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'Retained' } })
    tables.loan_early_payments[0] = { ...tables.loan_early_payments[0], payment_date: '2029-10-15' }
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'loan_early_payments'] }) })
    await settled(client)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
    expect(sent(fetchMock, 'PUT')).toEqual([expect.objectContaining({ url: '/api/admin/loan_early_payments/5', body: expect.objectContaining({ expectedIdentity: { loan_name: 'Car loan', payment_date: '2029-09-15' }, notes: 'Retained' }) })])
    expect(within(dialog).getByLabelText('Note')).toHaveValue('Retained')
  })

  it('editing an early payment opens the same editor in its row, prefilled, and saves with PUT', async () => {
    const fetchMock = stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Actions: 09\/15\/2029 · ₽3,000\.00$/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const dialog = editor()
    expect(within(dialog).getByLabelText('Date')).toHaveValue('09/15/2029')
    expect(within(dialog).getByLabelText(/^Amount \(/)).toHaveValue('3,000')
    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'bonus' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'PUT').map(r => r.url)).toContain('/api/admin/loan_early_payments/5'))
    await waitFor(() => expect(document.querySelector('.ln-editor')).toBeNull())
  })

  it('reaches early-payment actions through a menu named by the payment date', async () => {
    stubLoans()
    renderPage(<DataPage screen={LoansView} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Actions: 09\/15\/2029 · ₽3,000\.00$/ }))
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  it('early-payment save does not silently close or reopen a loan', async () => {
    for (const status of ['active', 'closed']) {
      const fetchMock = stubApi({ loans: [{ ...loan, status, issue_date: status === 'active' ? '2020-01-01' : '2029-06-01' }], loan_early_payments: [{ rowid: 5, id: 5, loan_name: 'Car loan', payment_date: status === 'active' ? '2020-03-16' : '2029-09-15', amount: 3000, strategy: 'reduce_term', new_payment: null, principal_credit: null, notes: null }] })
      const client = testClient()
      const view = renderPage(<DataPage screen={LoansView} />, { client })
      fireEvent.click(await screen.findByRole('button', { name: status === 'active' ? /^Actions: 03\/16\/2020/ : /^Actions: 09\/15\/2029/ }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
      fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Updated' } })
      fireEvent.click(within(editor()).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(document.querySelector('.ln-editor')).toBeNull())
      await settled(client)
      expect(sent(fetchMock, ['POST', 'PUT', 'DELETE'])).toEqual([
        expect.objectContaining({ method: 'PUT', url: '/api/admin/loan_early_payments/5' }),
      ])
      view.unmount()
    }
  })
})

describe('Empty screens say what to do next', () => {
  it('loans', async () => {
    stubApi()
    renderPage(<DataPage screen={LoansView} />)
    expect(await screen.findByText('Add your first loan: “+ Loan”.')).toBeInTheDocument()
    expect(screen.queryByText(/from the list on the left/)).toBeNull()
  })
})

describe('Loans screen: summary, chart, list balance, intentional status', () => {
  const loan = { rowid: 1, name: 'Car loan', principal: 24000, rate: 7.5, term_months: 60, monthly_payment: 480.91, issue_date: '2029-06-01', payment_day: null, currency: 'USD', member: 'Noa', type: 'consumer', status: 'active', closed_date: null }
  const ep = { rowid: 5, id: 5, loan_name: 'Car loan', payment_date: '2029-09-15', amount: 3000, strategy: 'reduce_term', new_payment: null, principal_credit: null, notes: null }

  it('reads the KPIs from the schedule as of today: balance, payment with its interest, last payment, interest ahead', async () => {
    const issued = new Date()
    issued.setUTCFullYear(issued.getUTCFullYear() - 1)
    stubApi({ loans: [{ ...loan, issue_date: issued.toISOString().slice(0, 10) }], loan_early_payments: [] })
    renderPage(<DataPage screen={LoansView} />)
    await loaded()
    const value = (term: string) => screen.getByText(term).nextElementSibling
    expect(value('Monthly payment')).toHaveTextContent(/^\$480\.91$/)
    expect(value('Monthly payment')!.nextElementSibling).toHaveTextContent(/ · interest \$\d+\.\d\d$/)
    expect(value('Last payment')!.nextElementSibling).toHaveTextContent('48 payments left')
    expect(value('Interest ahead')!.nextElementSibling).toHaveTextContent(/^\$[\d,]+ to pay in all$/)
    expect(screen.getByText(/^Repaid \$[\d,]+ of \$24,000$/)).toBeInTheDocument()
    expect(screen.getByText(/^Loan balances, interest and payoff amounts are calculated/)).toBeInTheDocument()
  })

  it('says what the early payments did, only when there are some', async () => {
    stubApi({ loans: [loan], loan_early_payments: [ep] })
    const first = renderPage(<DataPage screen={LoansView} />)
    expect(await screen.findByText(/^Early payments of \$3,000, 1 of them, cut the term by \d+ months? and the interest by \$[\d,]+\.$/)).toBeInTheDocument()
    expect(screen.getByText(/^Without them the last payment would be 06\/01\/2034\.$/)).toBeInTheDocument()
    first.unmount()
    stubApi({ loans: [loan], loan_early_payments: [] })
    renderPage(<DataPage screen={LoansView} />)
    await loaded()
    expect(screen.queryByText(/^Early payments of/)).toBeNull()
  })

  it('draws the balance chart: today in violet, a dot per early payment and the loan without them dashed, with the months saved', async () => {
    stubApi({ loans: [loan], loan_early_payments: [ep] })
    const { container, unmount } = renderPage(<DataPage screen={LoansView} />)
    const chart = await screen.findByRole('img', { name: 'Car loan: the balance by the schedule, from issue to the last payment' })
    expect(chart.querySelectorAll('.ln-chart__dot')).toHaveLength(1)
    expect(chart.querySelector('.ln-chart__without')).not.toBeNull()
    expect(chart.querySelector('.ln-chart__gap text')).toHaveTextContent(/^−\d+ mo$/)
    expect(container.querySelector('.ln-key')).toHaveTextContent(/without early payments: until 06\/01\/2034/)
    unmount()
    stubApi({ loans: [loan], loan_early_payments: [] })
    renderPage(<DataPage screen={LoansView} />)
    const plain = await screen.findByRole('img', { name: /^Car loan: the balance/ })
    expect(plain.querySelector('.ln-chart__without')).toBeNull()
    expect(plain.querySelector('.ln-chart__dot')).toBeNull()
  })

  it('says how an early payment would help when there are none, outside any table', async () => {
    stubApi({ loans: [loan], loan_early_payments: [] })
    renderPage(<DataPage screen={LoansView} />)
    const empty = await screen.findByText(/^No early payments yet\./)
    expect(empty.closest('table')).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Closing balance' })).toBeInTheDocument()
  })

  it('shows the monthly payment as money in the loan currency and masks it in privacy mode', async () => {
    stubApi({ loans: [loan], loan_early_payments: [] })
    const { unmount } = renderPage(<DataPage screen={LoansView} />)
    expect((await screen.findByText('Monthly payment')).nextElementSibling).toHaveTextContent(/^\$\d[\d,]*\.\d\d$/)
    unmount()
    stubPrivacyOn()
    stubApi({ loans: [loan], loan_early_payments: [] })
    renderPage(<DataPage screen={LoansView} />, { dashboard: true })
    expect((await screen.findByText('Monthly payment')).nextElementSibling).toHaveTextContent('•••')
  })

  it('a loan not issued yet leads with its balance at issue, not a balance today', async () => {
    const future = new Date()
    future.setUTCFullYear(future.getUTCFullYear() + 1)
    stubApi({ loans: [{ ...loan, issue_date: future.toISOString().slice(0, 10) }], loan_early_payments: [] })
    renderPage(<DataPage screen={LoansView} />)
    await loaded()
    const terms = screen.getAllByRole('term')
    expect(terms[0]).toHaveTextContent('Balance at issue')
    expect(terms[0].nextElementSibling).toHaveTextContent('$24,000')
  })

  it('shows the balance today beside the name of an active loan, its payment and its end under it', async () => {
    stubApi({ loans: [loan], loan_early_payments: [] })
    renderPage(<DataPage screen={LoansView} />)
    const item = await screen.findByRole('button', { name: /Car loan/ })
    expect(within(item).getByText('$24,000')).toHaveClass('record-row__bal')
    expect(within(item).getByText('$480.91/mo')).toBeInTheDocument()
    expect(within(item).getByText('until 06/01/2034 · 0% repaid')).toBeInTheDocument()
  })

  it('masks the list balance, the family total and the KPIs in privacy mode', async () => {
    stubPrivacyOn()
    stubApi({ loans: [loan], loan_early_payments: [] })
    const { container } = renderPage(<DataPage screen={LoansView} />, { dashboard: true })
    const item = await screen.findByRole('button', { name: /Car loan/ })
    expect(within(item).getAllByText(/•••/).length).toBeGreaterThan(0)
    expect(container.querySelector('.ln-total__v')).toHaveTextContent('•••')
    expect(screen.getByText('Interest ahead').nextElementSibling).toHaveTextContent('•••')
    expect(container.querySelector('.acc-kpis')).not.toHaveTextContent(/\$\d/)
    expect(container.querySelector('.ln-progress')).not.toHaveTextContent(/\$\d/)
    expect(container.querySelector('.ln-list')).not.toHaveTextContent(/\$\d/)
  })

  it('masks the schedule and the early payments in privacy mode, the row menu label too', async () => {
    stubPrivacyOn()
    stubApi({
      loans: [loan],
      loan_early_payments: [{ rowid: 5, id: 5, loan_name: 'Car loan', payment_date: '2029-09-15', amount: 3000, strategy: 'reduce_term', new_payment: null, principal_credit: null, notes: null }],
    })
    renderPage(<DataPage screen={LoansView} />, { dashboard: true })
    await screen.findByRole('button', { name: /Car loan/ })
    const [schedule, early] = await screen.findAllByRole('table').then(tables => {
      const byHeader = (name: string) => tables.find(t => within(t).queryByRole('columnheader', { name }))!
      return [byHeader('Closing balance'), byHeader('Strategy')]
    })
    const first = within(schedule).getAllByRole('row')[1]
    expect(within(first).getAllByText('•••').length).toBeGreaterThanOrEqual(4)
    expect(schedule).not.toHaveTextContent(/24,000|480\.91/)
    expect(early).not.toHaveTextContent('3,000')
    expect(within(early).getByText('•••')).toBeInTheDocument()
    expect(within(early).getByRole('button', { name: /•••/ })).not.toHaveAccessibleName(/3,000/)
  })

  it('opening a paid-off loan sends no mutation', async () => {
    const fetchMock = stubApi({ loans: [{ ...loan, issue_date: '2020-01-01', term_months: 12, monthly_payment: 0 }], loan_early_payments: [] })
    const client = testClient()
    renderPage(<DataPage screen={LoansView} />, { client })
    await loaded()
    await settled(client)
    expect(sent(fetchMock, ['POST', 'PUT', 'DELETE'])).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Close loan' })).toBeInTheDocument()
  })

  const puts = (fetchMock: Mock) => sent<Record<string, unknown>>(fetchMock, 'PUT')
  /** The screen on a client of its own, for settled() */
  const renderLoans = () => {
    const client = testClient()
    renderPage(<DataPage screen={LoansView} />, { client })
    return client
  }
  const done = { ...loan, issue_date: '2020-01-01', term_months: 12, monthly_payment: 0 }

  it.each(['active', 'closed'])('waits for early-payment data before offering a status action for %s loans', async status => {
    const gate = deferred<Response>()
    const stored = status === 'active' ? done : { ...loan, status: 'closed' }
    const fetchMock = stubApi({ loans: [stored] }, { answer: { '/api/admin/loan_early_payments': () => gate.promise } })
    renderLoans()
    await loaded()
    const action = status === 'active' ? 'Close loan' : 'Reopen loan'
    expect(screen.queryByRole('button', { name: action })).toBeNull()
    gate.resolve(jsonResponse({ rows: [], columns: [] }))
    expect(await screen.findByRole('button', { name: action })).toBeInTheDocument()
    expect(sent(fetchMock, ['POST', 'PUT', 'DELETE'])).toHaveLength(0)
  })

  it('reopening an unfinished closed loan is confirmed, single-flight, and preserves status on failure', async () => {
    const gate = deferred()
    const fetchMock = stubApi({ loans: [{ ...loan, status: 'closed', closed_date: '2030-01-01' }], loan_early_payments: [] }, { answer: { 'PUT *': () => gate.promise.then(() => jsonResponse({ error: 'boom' }, 500)) } })
    renderLoans()
    const reopen = await screen.findByRole('button', { name: 'Reopen loan' })
    fireEvent.click(reopen)
    expect(puts(fetchMock)).toHaveLength(0)
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reopen loan' }))
    fireEvent.click(reopen)
    await waitFor(() => expect(reopen).toBeDisabled())
    expect(puts(fetchMock)).toEqual([expect.objectContaining({ url: '/api/loans/1', body: { expectedName: 'Car loan', status: 'active', closed_date: null } })])
    gate.resolve()
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
    expect(screen.getByText('Closed 01/01/2030')).toBeInTheDocument()
    expect(reopen).not.toBeDisabled()
  })

  it('does not write when the stored status already matches the schedule', async () => {
    const fetchMock = stubApi({ loans: [{ ...done, status: 'closed', closed_date: '2021-01-01' }, { ...loan, rowid: 2, name: 'Other' }], loan_early_payments: [] })
    const client = renderLoans()
    await loaded()
    await settled(client)
    expect(puts(fetchMock)).toHaveLength(0)
  })

  it('opening a stored-closed loan whose schedule is not done writes nothing: opening never reopens', async () => {
    const fetchMock = stubApi({ loans: [{ ...loan, status: 'closed', closed_date: '2030-01-01' }], loan_early_payments: [] })
    const client = renderLoans()
    await loaded()
    await settled(client)
    expect(puts(fetchMock)).toHaveLength(0)
  })

  it('deleting an early payment leaves a stored-closed loan closed', async () => {
    const stored = { ...loan, status: 'closed', closed_date: '2030-01-01' }
    let payments = [{ ...ep }]
    const puts: { url: string; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'DELETE') { payments = []; return jsonResponse({ ok: true }) }
      if (init?.method === 'PUT') { puts.push({ url, body: JSON.parse(String(init.body)) }); return jsonResponse({ ok: true }) }
      if (url === '/api/admin/loans') return jsonResponse({ rows: [stored], columns: [] })
      if (url === '/api/admin/loan_early_payments') return jsonResponse({ rows: payments, columns: [] })
      return jsonResponse({ rows: [], columns: [] })
    }))
    renderPage(<DataPage screen={LoansView} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Actions: 09\/15\/2029/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await screen.findByText(/^No early payments yet/)
    expect(puts).toHaveLength(0)
    expect(screen.getByText('Closed 01/01/2030')).toBeInTheDocument()
  })

  describe('a closed loan whose stored closing day differs from the schedule', () => {
    const wrong = { ...done, status: 'closed', closed_date: '2020-08-15' }
    const note = 'Closed on 08/15/2020; the schedule says it was repaid on 01/01/2021.'

    it('names both days and offers the payoff day, writing nothing on open', async () => {
      const fetchMock = stubApi({ loans: [wrong], loan_early_payments: [] })
      const client = renderLoans()
      expect(await screen.findByText(note)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Use 01/01/2021' })).toBeInTheDocument()
      await settled(client)
      expect(puts(fetchMock)).toHaveLength(0)
    })

    it('clicking sends exactly the payoff day for that loan', async () => {
      const fetchMock = stubApi({ loans: [wrong, { ...loan, rowid: 2, name: 'Other' }], loan_early_payments: [] })
      renderPage(<DataPage screen={LoansView} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Use 01/01/2021' }))
      await waitFor(() => expect(puts(fetchMock)).toHaveLength(1))
      expect(puts(fetchMock)[0]).toMatchObject({ url: '/api/loans/1', body: { expectedName: 'Car loan', closed_date: '2021-01-01' } })
    })

    it('is absent when the stored day matches, and for an active loan', async () => {
      stubApi({ loans: [{ ...done, status: 'closed', closed_date: '2021-01-01' }], loan_early_payments: [] })
      const first = renderPage(<DataPage screen={LoansView} />)
      await screen.findByText('Closed 01/01/2021')
      expect(screen.queryByText(/the schedule says/)).toBeNull()
      first.unmount()
      stubApi({ loans: [{ ...done, status: 'active', closed_date: null }], loan_early_payments: [] })
      renderPage(<DataPage screen={LoansView} />)
      await loaded()
      expect(screen.queryByText(/the schedule says/)).toBeNull()
    })

    it('shows no note for a loan closed before its schedule ends: the owner closed it on purpose', async () => {
      stubApi({ loans: [{ ...loan, status: 'closed', closed_date: '2030-01-01' }], loan_early_payments: [] })
      renderPage(<DataPage screen={LoansView} />)
      await screen.findByText('Closed 01/01/2030')
      expect(screen.queryByText(/the schedule says/)).toBeNull()
      expect(screen.queryByRole('button', { name: /^Use / })).toBeNull()
    })

    it('without a stored day the note names only the payoff day, with the same button', async () => {
      const fetchMock = stubApi({ loans: [{ ...done, status: 'closed', closed_date: null }], loan_early_payments: [] })
      renderPage(<DataPage screen={LoansView} />)
      expect(await screen.findByText('The schedule says it was repaid on 01/01/2021.')).toBeInTheDocument()
      expect(screen.queryByText(/Closed on —/)).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Use 01/01/2021' }))
      await waitFor(() => expect(puts(fetchMock)).toHaveLength(1))
      expect(puts(fetchMock)[0].body).toEqual({ expectedName: 'Car loan', closed_date: '2021-01-01' })
    })

    it('a double click sends one edit: the button waits for the write', async () => {
      const gate = deferred()
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PUT') { await gate.promise; return jsonResponse({ ok: true }) }
        return jsonResponse(String(input) === '/api/admin/loans' ? { rows: [wrong], columns: [] } : { rows: [], columns: [] })
      })
      vi.stubGlobal('fetch', fetchMock)
      renderPage(<DataPage screen={LoansView} />)
      const button = await screen.findByRole('button', { name: 'Use 01/01/2021' })
      fireEvent.click(button)
      fireEvent.click(button)
      await waitFor(() => expect(button).toBeDisabled())
      gate.resolve()
      await waitFor(() => expect(button).not.toBeDisabled())
      expect(puts(fetchMock)).toHaveLength(1)
    })

    it('shows the note but no button without the edit right', async () => {
      setAuth({ me: { name: 'Robin', rights: { edit: false, vote: true, manage: false } } })
      try {
        stubApi({ loans: [wrong], loan_early_payments: [] })
        renderPage(<DataPage screen={LoansView} />)
        expect(await screen.findByText(note)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /^Use / })).toBeNull()
      } finally { act(() => resetAuth()) }
    })
  })

  it('writes nothing for a user without the edit right', async () => {
    setAuth({ me: { name: 'Robin', rights: { edit: false, vote: true, manage: false } } })
    try {
      const fetchMock = stubApi({ loans: [done], loan_early_payments: [] })
      const client = renderLoans()
      await loaded()
      await settled(client)
      expect(puts(fetchMock)).toHaveLength(0)
      expect(screen.queryByRole('button', { name: 'Close loan' })).toBeNull()
    } finally { act(() => resetAuth()) }
  })

  it('explicit payoff waits for confirmation and successful persistence, with one request', async () => {
    const gate = deferred()
    const stored = { ...done, closed_date: null as string | null }
    const fetchMock = stubApi({ loans: [stored], loan_early_payments: [] }, { answer: { 'PUT *': () => gate.promise.then(() => { stored.status = 'closed'; stored.closed_date = '2021-01-01'; return jsonResponse({ saved: true }) }) } })
    renderLoans()
    const close = await screen.findByRole('button', { name: 'Close loan' })
    fireEvent.click(close)
    expect(puts(fetchMock)).toHaveLength(0)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close loan' }))
    fireEvent.click(close)
    await waitFor(() => expect(close).toBeDisabled())
    expect(screen.queryByText(/^Closed \d/)).toBeNull()
    expect(puts(fetchMock)).toEqual([expect.objectContaining({ url: '/api/loans/1', body: { expectedName: 'Car loan', status: 'closed', closed_date: '2021-01-01' } })])
    gate.resolve()
    expect(await screen.findByText('Closed 01/01/2021')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close loan' })).toBeNull()
    expect(puts(fetchMock)).toHaveLength(1)
  })

  it('cancelling payoff and a failed payoff preserve the active status and action', async () => {
    const fetchMock = stubApi({ loans: [done], loan_early_payments: [] }, { answer: { 'PUT *': () => jsonResponse({ error: 'boom' }, 500) } })
    renderLoans()
    fireEvent.click(await screen.findByRole('button', { name: 'Close loan' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(puts(fetchMock)).toHaveLength(0)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close loan' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Close loan' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close loan' }))
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
    expect(screen.queryByText(/^Closed \d/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Close loan' })).not.toBeDisabled()
  })

  it('draws a one-payment loan: the line starts at the balance at issuance', async () => {
    stubApi({ loans: [{ ...loan, term_months: 1 }], loan_early_payments: [] })
    renderPage(<DataPage screen={LoansView} />)
    const chart = await screen.findByRole('img', { name: /^Car loan: the balance/ })
    expect(chart.querySelector('.ln-chart__ahead')!.getAttribute('d')!.split('L')).toHaveLength(2)
  })
})

describe('Atomic loan deletion', () => {
  const loan = { rowid: 1, name: 'Car loan', principal: 24000, rate: 7.5, term_months: 60, monthly_payment: 480.91, issue_date: '2029-06-01', payment_day: null, currency: 'RUB', member: 'Noa', type: 'consumer', status: 'active', closed_date: null }

  it('sends one delete and retains the loan on failure', async () => {
    const fetchMock = stubApi({ loans: [loan], loan_early_payments: [] }, { answer: { 'DELETE *': () => jsonResponse({ error: 'boom' }, 500) } })
    renderPage(<DataPage screen={LoansView} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Loan actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete loan…' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Could not delete')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Car loan/ })).toHaveAttribute('aria-current', 'true')
    expect(sent(fetchMock, 'DELETE')).toEqual([expect.objectContaining({ url: '/api/loans/1' })])
    expect(screen.getByRole('heading', { name: 'Car loan' })).toBeInTheDocument()
  })
})

describe('the collateral field of the loan form', () => {
  const mortgage = { rowid: 1, name: 'Mortgage', principal: 416000, rate: 6.5, term_months: 360, monthly_payment: 2629.4, issue_date: '2029-06-01', payment_day: null, currency: 'USD', member: 'Noa', type: 'mortgage', status: 'active', closed_date: null, secured_by: null as string | null }
  const estate = [
    { rowid: 1, name: 'House', purchase_date: '2029-01-01', purchase_price: 520000, purchase_currency: 'USD', member: null, valuation_year: 2029, value: 520000, currency: 'USD', notes: null },
    { rowid: 2, name: 'House', purchase_date: '2029-01-01', purchase_price: 520000, purchase_currency: 'USD', member: null, valuation_year: 2030, value: 530000, currency: 'USD', notes: null },
    { rowid: 3, name: 'Flat', purchase_date: '2020-01-01', purchase_price: 200000, purchase_currency: 'EUR', member: null, valuation_year: 2030, value: 230000, currency: 'EUR', notes: null },
  ]
  const field = () => screen.getByRole('radiogroup', { name: 'Secured by property' })

  it('restores the selected collateral when delayed property data arrives', async () => {
    const gate = deferred<Response>()
    const fetchMock = stubApi({ loans: [{ ...mortgage, secured_by: 'House' }], loan_early_payments: [] }, {
      answer: { 'GET /api/admin/real_estate': () => gate.promise },
    })
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    expect(within(field()).getByRole('radio', { name: 'None' })).toBeChecked()
    gate.resolve(jsonResponse({ rows: estate, columns: Object.keys(estate[0]) }))
    await waitFor(() => expect(within(field()).getByRole('radio', { name: 'House' })).toBeChecked())
    expect(sent(fetchMock, ['POST', 'PUT', 'DELETE'])).toHaveLength(0)
  })

  it('retains cached collateral options after a background query fails', async () => {
    let fail = false
    stubApi({ loans: [{ ...mortgage, secured_by: 'House' }], loan_early_payments: [], real_estate: estate }, {
      answer: { 'GET /api/admin/real_estate': (_init, next) => fail ? jsonResponse({}, 503) : next() },
    })
    const client = testClient()
    renderPage(<DataPage screen={LoansView} />, { client })
    await editLoan()
    await waitFor(() => expect(within(field()).getByRole('radio', { name: 'House' })).toBeChecked())
    fail = true
    await act(() => client.invalidateQueries({ queryKey: ['admin', 'real_estate'] }))
    expect(client.getQueryState(['admin', 'real_estate'])?.status).toBe('error')
    expect(within(field()).getByRole('radio', { name: 'House' })).toBeChecked()
  })

  it('does not clear stored collateral after an initial property query fails', async () => {
    const fetchMock = stubApi({ loans: [{ ...mortgage, secured_by: 'House' }], loan_early_payments: [] }, {
      answer: { 'GET /api/admin/real_estate': () => jsonResponse({}, 503), 'PUT *': () => jsonResponse({ saved: true }) },
    })
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Home loan' } })
    fireEvent.submit(screen.getByLabelText('Name').closest('form')!)
    await waitFor(() => expect(sent(fetchMock, 'PUT')).toHaveLength(1))
    expect(sent(fetchMock, 'PUT')[0].body).toEqual({ name: 'Home loan', expectedName: 'Mortgage' })
  })

  it('lists None and each property once, and saves the name, then none as null', async () => {
    const fetchMock = stubApi({ loans: [mortgage], loan_early_payments: [], real_estate: estate }, { answer: { 'PUT *': () => jsonResponse({ saved: true }) } })
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    await waitFor(() => expect(within(field()).getAllByRole('radio').map(r => r.closest('label')!.textContent)).toEqual(['None', 'House', 'Flat']))
    expect(within(field()).getByRole('radio', { name: 'None' })).toBeChecked()
    fireEvent.click(within(field()).getByRole('radio', { name: 'House' }))
    fireEvent.submit(screen.getByLabelText('Name').closest('form')!)
    await waitFor(() => expect(sent(fetchMock, 'PUT')).toHaveLength(1))
    expect(sent(fetchMock, 'PUT')[0].body).toEqual({ secured_by: 'House', expectedName: 'Mortgage' })
  })

  it('sends null when a linked loan is set to None', async () => {
    const fetchMock = stubApi({ loans: [{ ...mortgage, secured_by: 'House' }], loan_early_payments: [], real_estate: estate }, { answer: { 'PUT *': () => jsonResponse({ saved: true }) } })
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    await waitFor(() => expect(within(field()).getByRole('radio', { name: 'House' })).toBeChecked())
    fireEvent.click(within(field()).getByRole('radio', { name: 'None' }))
    fireEvent.submit(screen.getByLabelText('Name').closest('form')!)
    await waitFor(() => expect(sent(fetchMock, 'PUT')).toHaveLength(1))
    expect(sent(fetchMock, 'PUT')[0].body).toEqual({ secured_by: null, expectedName: 'Mortgage' })
  })

  it('a link to a property that no longer exists shows None, is not offered, and is not rewritten by another edit', async () => {
    const fetchMock = stubApi({ loans: [{ ...mortgage, secured_by: 'Castle' }], loan_early_payments: [], real_estate: estate }, { answer: { 'PUT *': () => jsonResponse({ saved: true }) } })
    renderPage(<DataPage screen={LoansView} />)
    await editLoan()
    await waitFor(() => expect(within(field()).getByRole('radio', { name: 'None' })).toBeChecked())
    expect(within(field()).queryByRole('radio', { name: 'Castle' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Home loan' } })
    fireEvent.submit(screen.getByLabelText('Name').closest('form')!)
    await waitFor(() => expect(sent(fetchMock, 'PUT')).toHaveLength(1))
    expect(sent(fetchMock, 'PUT')[0].body).toEqual({ name: 'Home loan', expectedName: 'Mortgage' })
  })

  it('is offered in the new-loan form too', async () => {
    stubApi({ loans: [mortgage], loan_early_payments: [], real_estate: estate })
    renderPage(<DataPage screen={LoansView} />)
    fireEvent.click(await screen.findByRole('button', { name: '+ Loan' }))
    expect(await within(screen.getByRole('dialog')).findByRole('radio', { name: 'House' })).toBeInTheDocument()
  })

  it('is not shown to a viewer, who has no loan form', async () => {
    setAuth({ me: { name: 'Robin', rights: { edit: false, vote: true, manage: false } } })
    try {
      stubApi({ loans: [{ ...mortgage, secured_by: 'House' }], loan_early_payments: [], real_estate: estate })
      renderPage(<DataPage screen={LoansView} />)
      expect(await screen.findByRole('button', { name: /Mortgage/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Loan actions' })).toBeNull()
      expect(screen.queryByRole('radiogroup', { name: 'Secured by property' })).toBeNull()
    } finally { act(() => resetAuth()) }
  })
})

it('loans failed first read offers retry instead of an empty list', async () => {
  let fail = true
  stubApi({}, { answer: { 'GET /api/admin/loans': (_init, next) => fail ? jsonResponse({}, 503) : next() } })
  renderPage(<DataPage screen={LoansView} />)
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  expect(screen.queryByText(/add your first loan/i)).not.toBeInTheDocument()
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument())
})

it('failed early-payment read does not present a schedule as complete', async () => {
  stubApi({ loans: [{ rowid: 1, name: 'Loan', principal: 10000, rate: 5, term_months: 24, monthly_payment: 450, issue_date: '2029-01-01', currency: 'USD', member: 'Noa', type: 'consumer', status: 'active' }] }, { answer: { 'GET /api/admin/loan_early_payments': () => jsonResponse({}, 503) } })
  renderPage(<DataPage screen={LoansView} />)
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Early payment' })).not.toBeInTheDocument()
  expect(screen.queryByRole('table', { name: /schedule/i })).not.toBeInTheDocument()
})
