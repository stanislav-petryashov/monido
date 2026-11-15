// The Loans page on the demo family's loans as the mock-up drew them (today 10.11.2026, the closed month September 2026):
// the family total and the subtitle, the rows, the KPIs, the early payments' effect, the preview of a new one for both
// strategies, the close flow, the viewer, the phone's two screens.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { LoansView } from '../../../src/pages/admin/LoansView'
import { LoansSubtitle } from '../../../src/modules/loans/LoansSubtitle'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { jsonResponse, sent, stubApi } from '../../helpers/http'
import { renderAdmin, snapshotClient, stubPrivacyOn } from '../../helpers/render'
import { makeSnapshot } from '../../helpers/snapshot'

const MORTGAGE = { rowid: 1, name: 'Maple Street mortgage', principal: 416000, rate: 6.5, term_months: 360, monthly_payment: 2629.4, issue_date: '2022-09-15', payment_day: 15, currency: 'USD', member: 'Ryan', type: 'mortgage', status: 'active', closed_date: null, secured_by: 'House on Maple Street' as string | null }
const CAR = { rowid: 2, name: 'Car loan', principal: 25000, rate: 7, term_months: 60, monthly_payment: 495.03, issue_date: '2024-02-10', payment_day: 10, currency: 'USD', member: 'Annika', type: 'consumer', status: 'active', closed_date: null, secured_by: null }
const ep = (id: number, payment_date: string, amount: number, strategy: string, extra = {}) => ({ id, loan_name: MORTGAGE.name, payment_date, amount, strategy, new_payment: null, principal_credit: null, notes: null, ...extra })
const EPS = [
  ep(17, '2024-02-20', 5000, 'reduce_payment', { new_payment: 2597.36, principal_credit: 4991.35 }),
  ep(18, '2025-02-08', 6000, 'reduce_term'), ep(19, '2025-08-14', 4000, 'reduce_payment'), ep(20, '2026-02-09', 7500, 'reduce_term'),
]
const HOUSE = { rowid: 1, name: 'House on Maple Street', purchase_date: '2022-09-01', purchase_price: 520000, purchase_currency: 'USD', member: null, valuation_year: 2026, value: 560000, currency: 'USD', notes: null }

const base = makeSnapshot()
const SNAPSHOT = makeSnapshot({
  asOf: { capitalDate: '2026-09-30', closedMonth: '2026-09', openMonths: [], today: '2031-07-03' },
  members: ['Ryan', 'Annika'],
  capital: {
    ...base.capital!, date: '2026-09-30', liabilities: 385453.58,
    loans: [
      { name: MORTGAGE.name, member: 'Ryan', type: 'mortgage', currency: 'USD', rate: 6.5, balance: 372281.53, balanceBase: 372281.53, payment: 2569.75, paymentBase: 2569.75, repaidPct: 10.5, interestNext12m: 24000, interestNext12mBase: 24000 },
      { name: CAR.name, member: 'Annika', type: 'consumer', currency: 'USD', rate: 7, balance: 13172.05, balanceBase: 13172.05, payment: 495.03, paymentBase: 495.03, repaidPct: 47, interestNext12m: 800, interestNext12mBase: 800 },
    ],
  },
  health: { composite: null, metrics: { debt_payment_ratio: { value: 21.75, zone: 'green' } } },
})

const stub = (tables: Record<string, unknown[]> = {}, answer = {}) => stubApi({ loans: [MORTGAGE, CAR], loan_early_payments: EPS, real_estate: [HOUSE], ...tables }, { answer: { '/api/snapshot': () => jsonResponse(SNAPSHOT), ...answer } })
const render = (ui = <DataPage screen={LoansView} />) => renderAdmin(ui, { client: snapshotClient(SNAPSHOT), dashboard: true })
/** The figure under a KPI's label, and the line under it */
const kpi = (label: string) => { const v = screen.getAllByRole('term').find(t => t.textContent === label)!.nextElementSibling!; return [v.textContent, v.nextElementSibling?.textContent] }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
})
afterEach(() => { vi.useRealTimers(); window.history.replaceState(null, '', '/') })

describe('the Loans page on 10.11.2026', () => {
  it('the subtitle: the loans, the debt today, the payments a month and their share of the closed month’s income', async () => {
    stub()
    render(<LoansSubtitle />)
    expect(await screen.findByText('2 loans · $384,061 on 11/10/2026 · $3,065 a month, 21.8% of September income')).toBeInTheDocument()
  })

  it('the list leads with the debt today and names the closed month’s figure under it', async () => {
    stub()
    const { container } = render()
    await screen.findByRole('heading', { name: MORTGAGE.name })
    expect(container.querySelector('.ln-total')).toHaveTextContent('Owed on 11/10/2026$384,061in the September net worth: $385,454')
    const row = screen.getByRole('button', { name: new RegExp(MORTGAGE.name) })
    expect(row).toHaveTextContent('$371,728')
    expect(row).toHaveTextContent('Ryan · 6.5%')
    expect(row).toHaveTextContent('$2,569.75/mo')
    expect(row).toHaveTextContent('until 06/15/2050 · 10.6% repaid')
    expect(screen.getByRole('button', { name: /Car loan/ })).toHaveTextContent('$12,333')
    expect(container.querySelector('.re-share')).toHaveTextContent('Payments a month$3,065 · 21.8% of income')
    expect(screen.getByText('from Mar 2029: $2,570 a month')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Loan terms: from issue to the last payment' }).querySelectorAll('.ln-ends__bar')).toHaveLength(2)
  })

  it('one balance per loan: the KPI, the row and the total agree; to pay − interest ahead = the balance', async () => {
    stub()
    render()
    await screen.findByRole('heading', { name: MORTGAGE.name })
    expect(kpi('Balance on 11/10/2026')).toEqual(['$371,728', 'after the payment of 10/15/2026 · in the September net worth $372,282'])
    expect(kpi('Monthly payment')).toEqual(['$2,569.75', '11/15/2026 · interest $2,013.53'])
    expect(kpi('Last payment')).toEqual(['06/15/2050', '284 payments left'])
    expect(kpi('Interest ahead')).toEqual(['$356,283', '$728,012 to pay in all'])
    expect(screen.getByText('Repaid $44,272 of $416,000')).toBeInTheDocument()
    expect(screen.getByText('Early payments of $22,500, 4 of them, cut the term by 27 months and the interest by $68,761.')).toBeInTheDocument()
    expect(screen.getByText('Without them the last payment would be 09/15/2052.')).toBeInTheDocument()
  })

  it('the head: tags with the collateral as a link to Real estate, one primary, the menu', async () => {
    stub()
    render()
    const tags = await screen.findByRole('list', { name: 'Loan details' })
    expect(await within(tags).findByRole('link', { name: 'House on Maple Street' })).toHaveAttribute('href', '/real-estate#House%20on%20Maple%20Street')
    expect([...tags.children].map(t => t.textContent)).toEqual(['RRyan', 'Mortgage', 'USD', '6.5% a year', 'issued 09/15/2022', 'payment on day 15', 'collateral: House on Maple Street'])
    expect(screen.getByRole('button', { name: 'Early payment' })).toHaveClass('btn--primary')
  })

  it('/loans#<name> opens that loan', async () => {
    stub()
    window.history.replaceState(null, '', `/loans#${encodeURIComponent(CAR.name)}`)
    render()
    expect(await screen.findByRole('heading', { name: CAR.name })).toBeInTheDocument()
    expect(kpi('Balance on 11/10/2026')[0]).toBe('$12,333')
    expect(screen.queryByText(/^Early payments of/)).toBeNull()
    expect(screen.getByText(/^No early payments yet/)).toBeInTheDocument()
  })

  it('keeps the payment breakdown and bank figures labelled in the mobile records', async () => {
    stub()
    const { container } = render()
    await screen.findByRole('heading', { name: MORTGAGE.name })
    const next = container.querySelector('.ln-sched [aria-current="true"]')!
    expect(within(next as HTMLElement).getByText('Next payment')).toBeInTheDocument()
    expect(next.querySelector('.ln-payment-amount')).toHaveAttribute('data-label', 'Payment')
    expect(next.querySelector('.ln-payment-principal')).toHaveAttribute('data-label', 'Principal')
    expect(next.querySelector('.ln-payment-balance')).toHaveAttribute('data-label', 'Balance after payment')
    const bankRow = container.querySelector('.ln-eps tbody tr:last-child')!
    expect(bankRow.querySelector('[data-label="Applied to principal"]')).not.toHaveClass('ln-payment-empty')
    expect(bankRow.querySelector('[data-label="Applied to principal"]')).toHaveTextContent('$4,991.35')
    expect(container.querySelector('.ln-eps tbody tr:first-child [data-label="Applied to principal"]')).toHaveClass('ln-payment-empty')
  })

  it('privacy mode masks every amount, the list’s tracks keep their shapes', async () => {
    stubPrivacyOn()
    stub()
    const { container } = render()
    await screen.findByRole('heading', { name: MORTGAGE.name })
    for (const sel of ['.ln-list', '.acc-kpis', '.ln-progress', '.ln-effect', '.ln-chart', '.ln-eps', '.ln-sched']) expect(container.querySelector(sel)).not.toHaveTextContent(/\$\d/)
    expect(container.querySelectorAll('.re-track i').length).toBeGreaterThan(0)
  })
})

describe('the early payment previewed in place', () => {
  const open = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Early payment' }))
    const editor = document.querySelector<HTMLElement>('.ln-editor')!
    fireEvent.change(within(editor).getByLabelText('Date'), { target: { value: '2026-12-14' } })
    fireEvent.change(within(editor).getByLabelText(/^Amount \(/), { target: { value: '5000' } })
    return editor
  }

  it('shows both strategies’ effects side by side, and the primary goes white while it is open', async () => {
    stub()
    render()
    const editor = await open()
    const [term, payment] = within(editor).getAllByRole('radio').map(r => r.closest('label')!)
    expect(term).toHaveTextContent('Reduce termlast payment 09/15/2049instead of 06/15/2050, 9 payments fewerinterest −$17,410')
    expect(payment).toHaveTextContent('Reduce paymentpayment $2,532.65instead of $2,569.75, the same terminterest −$3,728')
    // the limit is the balance on the draft's day: after the 15.11 payment, below today's
    expect(within(editor).getByText('Max: 371,172')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Early payment' })).toHaveClass('btn--ghost')
  })

  it('follows the amount and the date', async () => {
    stub()
    render()
    const editor = await open()
    const term = () => within(editor).getAllByRole('radio')[0].closest('label')!
    const before = term().textContent
    fireEvent.change(within(editor).getByLabelText(/^Amount \(/), { target: { value: '10000' } })
    expect(term().textContent).not.toBe(before)
    fireEvent.change(within(editor).getByLabelText('Date'), { target: { value: '' } })
    expect(term()).toHaveTextContent(/^Reduce term$/)
  })

  it('«New payment» only to reduce the payment; saving sends the chosen strategy', async () => {
    const fetchMock = stub({}, { 'POST *': () => jsonResponse({ ok: true }) })
    render()
    const editor = await open()
    expect(within(editor).queryByLabelText(/^New payment/)).toBeNull()
    fireEvent.click(within(editor).getByRole('radio', { name: /^Reduce payment/ }))
    expect(within(editor).getByLabelText(/^New payment/)).toBeInTheDocument()
    expect(within(editor).getByText(/“New payment” and “Applied to principal”/)).toBeInTheDocument()
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1))
    expect(sent(fetchMock, 'POST')[0].body).toMatchObject({ loan_name: MORTGAGE.name, payment_date: '2026-12-14', amount: 5000, strategy: 'reduce_payment', new_payment: null })
  })

  it('over the limit it is refused with the current message', async () => {
    const fetchMock = stub()
    render()
    const editor = await open()
    fireEvent.change(within(editor).getByLabelText(/^Amount \(/), { target: { value: '371500' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('The amount 371,500 exceeds the balance on the payment date (371,172)')).toBeInTheDocument()
    expect(sent(fetchMock, 'POST')).toHaveLength(0)
  })
})

describe('the loan edited in place', () => {
  it('names the early payments a rename carries', async () => {
    stub()
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Loan actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit loan' }))
    expect(await screen.findByText('The new name goes to the loan’s 4 early payments too')).toBeInTheDocument()
    expect(screen.getByText('Calculated from the amount, rate and term')).toBeInTheDocument()
  })
})

describe('the close flow', () => {
  // the car loan repaid in full on 20.10.2026: the schedule ends in October
  const repaid = { loan_early_payments: [...EPS, { id: 30, loan_name: CAR.name, payment_date: '2026-10-20', amount: 12778.32, strategy: 'reduce_term', new_payment: null, principal_credit: null, notes: null }] }

  it('offers «Close loan» as the one primary, with the totals in the confirmation, Cancel by default', async () => {
    const fetchMock = stub(repaid, { 'PUT *': () => jsonResponse({ saved: true }) })
    window.history.replaceState(null, '', `/loans#${encodeURIComponent(CAR.name)}`)
    render()
    const close = await screen.findByRole('button', { name: 'Close loan' })
    expect(close).toHaveClass('btn--primary')
    expect(screen.queryByRole('button', { name: 'Early payment' })).toBeNull()
    expect(screen.getByText('The schedule says this loan was repaid on 10/20/2026. Confirm with your bank before closing it.')).toBeInTheDocument()
    expect(kpi('Balance')).toEqual(['$0', 'repaid 10/20/2026'])
    expect(kpi('Total paid')[1]).toMatch(/^of which interest \$3,59\d$/)
    // the family figures leave it out at once: the debt, the payments, no «When they end» with one loan still paying
    expect(screen.getByText('Owed on 11/10/2026').nextElementSibling).toHaveTextContent('$371,728')
    expect(screen.getByText('Payments a month').nextElementSibling).toHaveTextContent('$2,570 · 21.8% of income')
    expect(screen.queryByText('When they end')).toBeNull()
    expect(document.querySelectorAll('.re-share .re-track i')).toHaveLength(1)
    fireEvent.click(close)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/Record the loan as closed on 10\/20\/2026\..*Total paid \$28,61\d, of which interest \$3,59\d\./)
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close loan' }))
    await waitFor(() => expect(sent(fetchMock, 'PUT')).toHaveLength(1))
    expect(sent(fetchMock, 'PUT')[0].body).toEqual({ expectedName: CAR.name, status: 'closed', closed_date: '2026-10-20' })
  })
})

describe('a viewer', () => {
  it('sees no primary, menu, editors, close or reopen', async () => {
    setAuth({ me: { name: 'Robin', rights: { edit: false, vote: true, manage: false } } })
    try {
      stub()
      render()
      await screen.findByRole('heading', { name: MORTGAGE.name })
      expect(screen.queryByRole('button', { name: 'Early payment' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Loan actions' })).toBeNull()
      expect(screen.queryByRole('button', { name: /^Actions:/ })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Close loan' })).toBeNull()
    } finally { act(() => resetAuth()) }
  })
})

describe('on a phone', () => {
  it('the list is the first screen; a row opens the loan on its own, «← Loans» goes back behind the discard guard', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: /max-width: (640|900)px/.test(query), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('scrollTo', () => {})
    try {
      stub()
      render()
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(MORTGAGE.name) }))
      expect(await screen.findByRole('heading', { name: MORTGAGE.name })).toBeInTheDocument()
      const chart = screen.getByRole('img', { name: /^Maple Street mortgage: the balance/ })
      expect(chart.getAttribute('viewBox')).toBe('0 0 340 230')
      expect(chart.querySelector('.ln-chart__gap text')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Early payment' }))
      fireEvent.change(within(document.querySelector<HTMLElement>('.ln-editor')!).getByLabelText(/^Amount \(/), { target: { value: '5000' } })
      fireEvent.click(screen.getByRole('button', { name: 'Loans' }))
      fireEvent.click(within(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', { name: 'Discard changes' }))
      await waitFor(() => expect(screen.queryByRole('heading', { name: MORTGAGE.name })).toBeNull())
      expect(document.querySelector('.ln-editor')).toBeNull()
    } finally { vi.unstubAllGlobals() }
  })
})
