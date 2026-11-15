// Accounts and Real estate: the latest amount in the list, the chart above the table, the currency of the amounts (Accounts draws
// its balance through WindowChart, Real estate its value through ValueStepChart).
import { screen, within } from '@testing-library/react'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { AccountsView } from '../../../src/pages/admin/AccountsView'
import { RealEstateScreen } from '../../../src/modules/real-estate/RealEstateScreen'
import { stubApi } from '../../helpers/http'
import { renderAdmin as renderPage, stubPrivacyOn } from '../../helpers/render'


const bank = (rowid: number, date: string, value: number) => ({ rowid, date, class: 'bank', name: 'Brisaluna Bank', value, currency: 'EUR', member: 'Robin' })
const stubAccounts = () => stubApi({
  assets: [bank(1, '2031-03-31', 5000), bank(2, '2031-05-31', 5800), bank(3, '2031-04-30', 5400)],
  monthly_cashflow: [],
  currencies: [{ rowid: 1, code: 'EUR' }],
  members: [{ rowid: 1, name: 'Robin' }],
})

describe('Accounts record views', () => {
  it('shows the latest balance under the name, the balance chart in the account currency and the currency in the headers', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    const item = await screen.findByRole('button', { name: /Brisaluna Bank/ })
    expect(within(item).getByText('€5,800')).toBeInTheDocument()
    const chart = await screen.findByRole('img', { name: 'Brisaluna Bank: the balance by month, March 2031 – May 2031' })
    expect(chart.querySelector('.wchart__tagText')).toHaveTextContent('€5,800')
    expect(chart.querySelectorAll('.wchart__dot')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Month by month' })).toBeInTheDocument()
    // no income or expenses kept for the account: no flows chart
    expect(screen.queryByRole('heading', { name: 'Income and expenses by month' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Balance, EUR' })).toBeInTheDocument()
  })

  it('writes the history amounts with grouped thousands, cents only when there are some', async () => {
    stubApi({
      assets: [bank(1, '2031-03-31', 5000), bank(2, '2031-04-30', 5400.5)],
      monthly_cashflow: [], currencies: [{ rowid: 1, code: 'EUR' }], members: [{ rowid: 1, name: 'Robin' }],
    })
    renderPage(<DataPage screen={AccountsView} />)
    const history = await screen.findByRole('table')
    expect(within(history).getByRole('cell', { name: '5,000' })).toBeInTheDocument()
    expect(within(history).getByRole('cell', { name: '5,400.5' })).toBeInTheDocument()
  })

  it('has no Close month button in the history header', async () => {
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />)
    await screen.findByRole('heading', { name: 'Monthly history' })
    expect(screen.queryByRole('link', { name: 'Close month' })).toBeNull()
  })

  it('masks the list amount in privacy mode', async () => {
    stubPrivacyOn()
    stubAccounts()
    renderPage(<DataPage screen={AccountsView} />, { dashboard: true })
    const item = await screen.findByRole('button', { name: /Brisaluna Bank/ })
    expect(within(item).getByText('•••')).toBeInTheDocument()
    expect(item).not.toHaveTextContent('5,800')
    const history = await screen.findByRole('table')
    expect(within(history).queryByText(/5,800|5,400|5,000/)).toBeNull()
    // three balances and two changes; a masked change carries no sign
    expect(within(history).getAllByText('•••')).toHaveLength(5)
    expect(history).not.toHaveTextContent('+•••')
  })
})

describe('Real estate record views', () => {
  const row = (rowid: number, valuation_year: number, value: number) => ({ rowid, name: 'City apartment', valuation_year, value, currency: 'EUR', purchase_date: '2027-01-01', purchase_price: 200000, purchase_currency: 'EUR', notes: null, member: null })
  const stub = () => stubApi({ real_estate: [row(1, 2029, 230000), row(2, 2031, 260000), row(3, 2030, 240000)] })
  const kpi = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent

  it('shows the value, the change since purchase and per year, the list value, and draws no ECharts', async () => {
    stub()
    renderPage(<DataPage screen={RealEstateScreen} />)
    const item = await screen.findByRole('button', { name: /City apartment/ })
    expect(within(item).getByText('€260,000')).toBeInTheDocument()
    expect(screen.getAllByRole('term').map(t => t.textContent)).toEqual(['Value', 'Since purchase', 'Average per year', 'Share of assets'])
    expect(kpi('Value')).toBe('€260,000')
    expect(kpi('Since purchase')).toBe('+€60,000')
    expect(screen.getByText('+30% of the price €200,000')).toBeInTheDocument()
    expect(kpi('Average per year')).toBe('+€15,000')
    expect(screen.getByText('over 4 years: 2027 → 2031')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'The value of City apartment by year since purchase' })).toBeInTheDocument()
  })

  it('hides the change since purchase when the purchase and the valuation are in different currencies', async () => {
    stubApi({ real_estate: [{ ...row(1, 2031, 260000), purchase_currency: 'USD' }] })
    renderPage(<DataPage screen={RealEstateScreen} />)
    await screen.findByRole('button', { name: /City apartment/ })
    expect(screen.getAllByRole('term').map(t => t.textContent)).toEqual(['Value', 'Share of assets'])
  })

  it('shows each valuation in its currency with its change against the one before, the first against the price', async () => {
    stub()
    renderPage(<DataPage screen={RealEstateScreen} />)
    await screen.findByRole('button', { name: /City apartment/ })
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1).map(r => [...r.querySelectorAll('td')].slice(0, 3).map(c => c.textContent))
    expect(rows).toEqual([['2031', '€260,000', '+€20,000 +8%'], ['2030', '€240,000', '+€10,000 +4%'], ['2029', '€230,000', '+€30,000 +15%']])
  })

  it('masks every amount in privacy mode: KPIs, list, chart labels, table', async () => {
    stubPrivacyOn()
    stub()
    renderPage(<DataPage screen={RealEstateScreen} />, { dashboard: true })
    await screen.findByRole('button', { name: /City apartment/ })
    const page = document.querySelector('.admin-split') as HTMLElement
    expect(page).not.toHaveTextContent(/260,000|240,000|230,000|200,000|60,000|15,000|\$|€/)
    expect(kpi('Average per year')).toBe('•••')
    const chart = screen.getByRole('img', { name: /by year since purchase/ })
    expect(chart.querySelectorAll('.re-chart__step')).toHaveLength(1)
    expect(chart).toHaveTextContent('•••')
  })
})
