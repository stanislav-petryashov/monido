// The Real estate page in the pearl design code: list + detail, the notice, the KPIs, equity of a linked property, the
// value chart, the equity waterfall, the editor in place, privacy, rights and the phone's two screens.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DataPage } from '../../src/pages/admin/DataPage'
import { RealEstateScreen } from '../../src/modules/real-estate/RealEstateScreen'
import { EquityWaterfall } from '../../src/modules/real-estate/view/EquityWaterfall'
import { RealEstateSubtitle } from '../../src/modules/real-estate/RealEstateSubtitle'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { jsonResponse, stubApi } from '../helpers/http'
import { renderAdmin, stubPrivacyOn } from '../helpers/render'
import { enterValuation, typeText } from '../helpers/adminScreens'
import { makeSnapshot } from '../helpers/snapshot'

const HOUSE = 'House on Maple Street'
const FLAT = 'Apartment in Leipzig'
const MORTGAGE = 'Maple Street mortgage'
const house = (rowid: number, valuation_year: number, value: number, notes: string | null = null) => ({ rowid, name: HOUSE, purchase_date: '2022-09-15', purchase_price: 520000, purchase_currency: 'USD', member: 'Robin', valuation_year, value, currency: 'USD', notes })
const flat = (rowid: number, valuation_year: number, value: number) => ({ rowid, name: FLAT, purchase_date: '2016-04-01', purchase_price: 216000, purchase_currency: 'EUR', member: 'Noa', valuation_year, value, currency: 'EUR', notes: null })
const ROWS = [house(1, 2022, 520000, 'Agency'), house(2, 2023, 535500), house(3, 2024, 551500), house(4, 2025, 568000), flat(5, 2024, 289000), flat(6, 2025, 299500)]

function snapshot({ linked = true, extra = {} }: { linked?: boolean; extra?: object } = {}) {
  const base = makeSnapshot()
  return {
    ...base,
    members: ['Robin', 'Noa'],
    capitalCoverage: [{ month: '2026-09', assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] }],
    asOf: { ...base.asOf, capitalDate: '2026-09-30', closedMonth: '2026-09' },
    capital: {
      ...base.capital!, date: '2026-09-30', assets: 1144126.78,
      realEstate: [
        { name: HOUSE, member: 'Robin', currency: 'USD', value: 568000, valueBase: 568000 },
        { name: FLAT, member: 'Noa', currency: 'EUR', value: 299500, valueBase: 345093.79 },
      ],
      securedLoans: linked ? [{ name: MORTGAGE, property: HOUSE, currency: 'USD', type: 'mortgage', principal: 416000, issueDate: '2022-09-15', balance: 372281.53, balanceBase: 372281.53 }] : [],
      ...extra,
    },
  }
}

function stub({ rows = ROWS, linked = true, extra = {} }: { rows?: unknown[]; linked?: boolean; extra?: object } = {}) {
  return stubApi({ real_estate: rows as Record<string, unknown>[], members: [{ rowid: 1, name: 'Robin' }, { rowid: 2, name: 'Noa' }], currencies: [{ rowid: 1, code: 'USD' }, { rowid: 2, code: 'EUR' }] },
    { answer: { '/api/snapshot': () => jsonResponse(snapshot({ linked, extra })) } })
}

const render = () => renderAdmin(<DataPage screen={RealEstateScreen} />)
const rowOf = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
const kpi = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
/** The page once the snapshot came: the share of assets is drawn from it */
const ready = async () => { await screen.findByText('Share of assets', { selector: 'dt' }); await waitFor(() => expect(kpi('Share of assets')).not.toBe('—')) }

afterEach(() => { window.history.replaceState(null, '', '/'); vi.unstubAllGlobals() })

describe('Real estate: the title row', () => {
  it('says how many properties, their total on the closed month and their share of the assets', async () => {
    stub()
    renderAdmin(<RealEstateSubtitle />)
    expect(await screen.findByText('2 properties · $913,094 on September 2026 · 79.8% of assets')).toBeInTheDocument()
  })
})

describe('Real estate: the list', () => {
  it('sorts by value, gives the latest change, an equity line only to the linked property, the share track', async () => {
    stub()
    render()
    await ready()
    const rows = screen.getAllByRole('button', { name: /House on Maple Street|Apartment in Leipzig/ }).filter(b => b.classList.contains('side-list__item'))
    expect(rows.map(r => r.querySelector('.record-row__name')!.textContent)).toEqual([HOUSE, FLAT])
    expect(rows[0]).toHaveTextContent('Robin · USD · valuation 2025')
    expect(rows[0]).toHaveTextContent('+$16,500 for 2025')
    expect(rows[0]).toHaveTextContent('equity $195,718 · mortgage 65.5%')
    expect(rows[1]).toHaveTextContent('+€10,500 for 2025')
    expect(rows[1]).not.toHaveTextContent('equity')
    expect(rows[0]).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('79.8% of $1,144,127')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: "Each property's share of the assets" }).querySelectorAll('i')).toHaveLength(2)
  })

  it('/real-estate#<name> opens that property', async () => {
    stub()
    window.history.replaceState(null, '', `/real-estate#${encodeURIComponent(FLAT)}`)
    render()
    expect(await screen.findByRole('heading', { name: FLAT })).toBeInTheDocument()
    expect(rowOf(FLAT)).toHaveAttribute('aria-current', 'true')
  })
})

describe('Real estate: the head and the KPIs', () => {
  it('a valuation older than the closed month says so, with the primary for the year', async () => {
    stub()
    render()
    await ready()
    expect(screen.getByText('No 2026 valuation: in September’s assets the property counts at its 2025 valuation.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enter the 2026 valuation' })).toHaveClass('btn--primary')
  })

  it('a valuation of the closed month\'s year: no notice, no band, a quiet button for the next year', async () => {
    stub({ rows: [...ROWS, house(7, 2026, 580000)] })
    render()
    await ready()
    expect(screen.queryByText(/No 2026 valuation/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Enter the 2027 valuation' })).toHaveClass('btn--ghost')
    expect(document.querySelector('.re-chart__band')).toBeNull()
  })

  it('the four KPIs; a foreign property gives its value in the base currency at the rate', async () => {
    stub()
    render()
    await ready()
    expect(kpi('Value')).toBe('$568,000')
    expect(kpi('Since purchase')).toBe('+$48,000')
    expect(screen.getByText('+9.2% of the price $520,000')).toBeInTheDocument()
    expect(kpi('Average per year')).toBe('+$16,000')
    expect(screen.getByText('over 3 years: 2022 → 2025')).toBeInTheDocument()
    expect(kpi('Share of assets')).toBe('49.6%')
    fireEvent.click(rowOf(FLAT))
    expect(await screen.findByText('≈ $345,094 at the rate of 09/30/2026')).toBeInTheDocument()
  })

  it('the equity row of a linked property: equity, loan-to-value with the loan linked, the bar', async () => {
    stub()
    render()
    await ready()
    expect(kpi('Equity')).toBe('$195,718')
    expect(kpi('Mortgage-to-value')).toBe('65.5%')
    expect(screen.getByText('valuation 2025 · on 09/30/2026')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: MORTGAGE })).toHaveAttribute('href', `/loans#${encodeURIComponent(MORTGAGE)}`)
    expect(screen.getByRole('img', { name: 'The value: equity 34.5%, mortgage 65.5%' })).toBeInTheDocument()
    fireEvent.click(rowOf(FLAT))
    await screen.findByRole('heading', { name: FLAT })
    expect(screen.queryByText('Equity', { selector: 'dt' })).toBeNull()
  })

  it('a linked loan that is not a mortgage is called a loan', async () => {
    stub({ extra: { securedLoans: [{ name: 'Home equity line', property: HOUSE, currency: 'USD', type: 'consumer', principal: 50000, issueDate: '2024-03-01', balance: 40000, balanceBase: 40000 }] } })
    render()
    await ready()
    expect(kpi('Loan-to-value')).toBe('7%')
    expect(rowOf(HOUSE)).toHaveTextContent('equity $528,000 · loan 7%')
    expect(screen.getByText('value − loan balance on 09/30/2026')).toBeInTheDocument()
  })

  it('the «···» menu points to the linked loan, or to the loan form when unlinked', async () => {
    stub()
    render()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Property actions' }))
    expect(screen.getAllByRole('menuitem').map(m => m.textContent)).toEqual(['Edit property', `Loan: ${MORTGAGE}`, 'Delete property…'])
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' })
    fireEvent.click(rowOf(FLAT))
    await screen.findByRole('heading', { name: FLAT })
    fireEvent.click(screen.getByRole('button', { name: 'Property actions' }))
    expect(screen.getAllByRole('menuitem').map(m => m.textContent)).toEqual(['Edit property', 'Link a mortgage: in the loan’s form on Loans', 'Delete property…'])
  })

  it('a viewer sees the figures but no primary, menu or row menus', async () => {
    setAuth({ me: { name: 'Robin', rights: { edit: false, vote: true, manage: false } } })
    try {
      stub()
      render()
      await ready()
      expect(screen.queryByRole('button', { name: /^Enter the/ })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Property actions' })).toBeNull()
      expect(screen.queryByRole('button', { name: /^Actions:/ })).toBeNull()
      expect(kpi('Equity')).toBe('$195,718')
    } finally { act(() => resetAuth()) }
  })

  it('privacy mode masks the list, the KPIs, equity, the chart labels, the waterfall and the table', async () => {
    stubPrivacyOn()
    stub()
    renderAdmin(<DataPage screen={RealEstateScreen} />, { dashboard: true })
    await ready()
    const page = document.querySelector('.admin-split') as HTMLElement
    expect(page).not.toHaveTextContent(/568,000|195,718|372,282|104,000|48,000|16,500|520,000|\$/)
    expect(kpi('Equity')).toBe('•••')
    expect(document.querySelectorAll('.wf__bar')).toHaveLength(2)
    expect(document.querySelectorAll('.re-chart__cb').length).toBeGreaterThan(0)
  })
})

describe('Real estate: the charts', () => {
  it('steps from the purchase year to the closed month\'s, a dot per valuation, the band for the missing year', async () => {
    stub()
    render()
    await ready()
    const chart = screen.getByRole('img', { name: `The value of ${HOUSE} by year since purchase` })
    expect(chart.querySelectorAll('.re-chart__dot')).toHaveLength(4)
    expect(chart.querySelector('.re-chart__band')).not.toBeNull()
    expect(chart).toHaveTextContent('no valuation')
    expect([...chart.querySelectorAll('.re-chart__t--now')].map(t => t.textContent)).toEqual(['2026'])
    expect(chart).toHaveTextContent('purchase $520,000 · 09/15/2022')
    expect([...chart.querySelectorAll('.re-chart__cl')].map(t => t.textContent)).toEqual(['0', '+15.5K', '+16K', '+16.5K', '—'])
  })

  it('the equity waterfall of the house: purchase, value change, repaid, now; none for Leipzig', async () => {
    stub()
    render()
    await ready()
    const wf = screen.getByRole('img', { name: 'Equity: $104,000 at purchase, $195,718 now' })
    expect([...wf.querySelectorAll('.wf__n')].map(n => n.textContent)).toEqual(['At purchase · 09/15/2022', 'Value change · 520,000 → $568,000', 'Mortgage repaid · 416,000 → $372,282', 'Now · September 2026'])
    expect([...wf.querySelectorAll('.wf__v')].map(n => n.textContent)).toEqual(['$104,000', '+$48,000', '+$43,718', '$195,718'])
    expect(screen.getByText('$104,000 → $195,718 · mortgage 65.5% of the value')).toBeInTheDocument()
    fireEvent.click(rowOf(FLAT))
    await screen.findByRole('heading', { name: FLAT })
    expect(screen.queryByRole('heading', { name: 'How the equity grew' })).toBeNull()
  })

  it('a loan in another currency hides the waterfall but keeps equity in the base currency', async () => {
    stub({ extra: { securedLoans: [{ name: MORTGAGE, property: HOUSE, currency: 'EUR', type: 'mortgage', principal: 380000, issueDate: '2022-09-15', balance: 320000, balanceBase: 368800 }] } })
    render()
    await ready()
    expect(kpi('Equity')).toBe('$199,200')
    expect(screen.queryByRole('heading', { name: 'How the equity grew' })).toBeNull()
  })
})

describe('Real estate: the valuations and the editor', () => {
  it('lists each valuation newest first with its change; the first equal to the price says so', async () => {
    stub()
    render()
    await ready()
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map(r => r.querySelector('td')!.textContent)).toEqual(['2025', '2024', '2023', '2022'])
    expect(rows[0]).toHaveTextContent('+$16,500 +3%')
    expect(rows[3]).toHaveTextContent('= the purchase price')
    expect(rows[3]).toHaveTextContent('Agency')
    expect(screen.getByText('4 valuations · newest first · in USD')).toBeInTheDocument()
  })

  it('the new valuation: the year prefilled, the last one as placeholder, the live comparison; the primary goes quiet', async () => {
    stub()
    render()
    await ready()
    await enterValuation()
    expect(screen.getByRole('textbox', { name: 'Year' })).toHaveValue('2026')
    const value = screen.getByRole('textbox', { name: 'Value (USD)' })
    expect(value).toHaveAttribute('placeholder', '568,000')
    expect(within(screen.getByRole('radiogroup', { name: 'Currency' })).getByRole('radio', { name: 'USD' })).toBeChecked()
    expect(screen.getByText('the last valuation, 2025: $568,000')).toBeInTheDocument()
    typeText(value, '585000')
    expect(screen.getByText('vs the 2025 valuation: +$17,000 +3% · since purchase +$65,000')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enter the 2026 valuation' })).toHaveClass('btn--ghost')
  })

  it('edit property names how many valuations change and sends one update', async () => {
    const fetchMock = stub()
    fetchMock.answer({ 'POST /api/real-estate/update': () => jsonResponse({ saved: true }) })
    render()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Property actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit property' }))
    expect(screen.getByText('Changes all 4 valuations of the property at once')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Maple House' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/real-estate/update')).toBe(true))
  })
})

describe('Real estate on a phone', () => {
  const phone = () => {
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: /max-width: (900|640)px/.test(query), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('scrollTo', vi.fn())
  }

  it('the list first without a selected row; a row opens the property with «← Real estate», back asks before dropping an edit', async () => {
    phone()
    stub()
    render()
    await screen.findByText('79.8% of $1,144,127')
    expect(screen.queryByRole('heading', { name: HOUSE })).toBeNull()
    expect(rowOf(HOUSE)).not.toHaveAttribute('aria-current')
    fireEvent.click(rowOf(HOUSE))
    expect(await screen.findByRole('heading', { name: HOUSE })).toBeInTheDocument()
    await enterValuation()
    typeText(screen.getByRole('textbox', { name: 'Value (USD)' }), '585000')
    fireEvent.click(screen.getByRole('button', { name: 'Real estate' }))
    const question = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })
    fireEvent.click(within(question).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: HOUSE })).toBeNull())
  })
})

describe('Real estate: incomplete totals', () => {
  it('keeps missing conversions unknown while preserving own-currency valuations', async () => {
    const values = [{ name: HOUSE, member: 'Robin', currency: 'EUR', value: 9122000, valueBase: null }, { name: FLAT, member: 'Noa', currency: 'EUR', value: 16078500, valueBase: null }]
    stub({ rows: [flat(1, 2025, 9122000), { ...flat(2, 2025, 16078500), name: HOUSE }], extra: { realEstate: values } })
    renderAdmin(<><RealEstateSubtitle /><DataPage screen={RealEstateScreen} /></>)
    expect(await screen.findByText(/2 properties · — on September 2026 · — of assets/)).toBeInTheDocument()
    expect(screen.getAllByText(/no exchange rate to convert/i).length).toBeGreaterThan(0)
    expect(rowOf(HOUSE)).toHaveTextContent('€16,078,500')
    expect(rowOf(FLAT)).toHaveTextContent('€9,122,000')
    expect(screen.queryByText(/0% of \$/)).toBeNull()
  })
  it('explains a property absent from the closed snapshot without claiming a missing rate', async () => {
    stub({ extra: { realEstate: [{ name: HOUSE, member: 'Robin', currency: 'USD', value: 568000, valueBase: 568000 }] } })
    render()
    expect(await screen.findByText(/not in the closed snapshot/i)).toBeInTheDocument()
    expect(screen.queryByText(/no exchange rate to convert/i)).toBeNull()
    expect(rowOf(FLAT)).toHaveTextContent('€299,500')
  })
  it('shows a known zero total and share', async () => {
    stub({ extra: { realEstate: [{ name: HOUSE, member: 'Robin', currency: 'USD', value: 0, valueBase: 0 }, { name: FLAT, member: 'Noa', currency: 'EUR', value: 0, valueBase: 0 }] } })
    renderAdmin(<RealEstateSubtitle />)
    expect(await screen.findByText('2 properties · $0 on September 2026 · 0% of assets')).toBeInTheDocument()
  })
})


describe('Real estate: coverage and privacy', () => {
  it('does not use a partial closed-month asset denominator', async () => {
    const data = { ...snapshot(), capitalCoverage: [{ month: '2026-09', assetsKnown: false, liquidKnown: false, capitalKnown: false, missingAccounts: [] }] }
    stubApi({ real_estate: ROWS, members: [], currencies: [] }, { answer: { '/api/snapshot': () => jsonResponse(data) } })
    renderAdmin(<><RealEstateSubtitle /><DataPage screen={RealEstateScreen} /></>)
    expect(await screen.findByText(/2 properties · \$913,094 on September 2026 · — of assets/)).toBeInTheDocument()
    expect(screen.getAllByText(/asset total is unavailable/i).length).toBeGreaterThan(0)
    expect(kpi('Share of assets')).toBe('—')
    expect(screen.queryByRole('img', { name: "Each property's share of the assets" })).toBeNull()
    expect(screen.queryByText(/79.8% of/)).toBeNull()
  })
  it.each([
    ['missing', []],
    ['a different complete month', [{ month: '2026-08', assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] }]],
  ])('does not use %s coverage for the closed-month denominator', async (_label, capitalCoverage) => {
    const data = { ...snapshot(), capitalCoverage }
    stubApi({ real_estate: ROWS, members: [], currencies: [] }, { answer: { '/api/snapshot': () => jsonResponse(data) } })
    renderAdmin(<><RealEstateSubtitle /><DataPage screen={RealEstateScreen} /></>)
    expect(await screen.findByText(/2 properties · \$913,094 on September 2026 · — of assets/)).toBeInTheDocument()
    expect(screen.getAllByText(/asset total is unavailable/i).length).toBeGreaterThan(0)
    expect(kpi('Value')).toBe('$568,000')
    expect(kpi('Share of assets')).toBe('—')
    expect(rowOf(HOUSE)).toHaveTextContent('$568,000')
    expect(rowOf(FLAT)).toHaveTextContent('€299,500')
    expect(screen.queryByRole('img', { name: "Each property's share of the assets" })).toBeNull()
    expect(screen.queryByText(/79.8% of/)).toBeNull()
  })
  it('keeps unknown totals and their explanations safe in privacy mode', async () => {
    stubPrivacyOn()
    stub({ extra: { realEstate: [{ name: HOUSE, member: 'Robin', currency: 'USD', value: 568000, valueBase: 568000 }, { name: FLAT, member: 'Noa', currency: 'EUR', value: 9122000, valueBase: null }] } })
    renderAdmin(<><RealEstateSubtitle /><DataPage screen={RealEstateScreen} /></>, { dashboard: true })
    expect(await screen.findByText(/2 properties · — on September 2026 · — of assets/)).toBeInTheDocument()
    expect(screen.getAllByText(/no exchange rate to convert/i).length).toBeGreaterThan(0)
    const page = document.querySelector('.admin-split') as HTMLElement
    expect(page).not.toHaveTextContent(/568,000|9,122,000|1,144,127/)
    expect(page.innerHTML).not.toMatch(/568,000|9,122,000|1,144,127/)
  })
  it('explains a missing snapshot without calling it a conversion error', async () => {
    const data = { ...snapshot(), capital: null, capitalCoverage: [] }
    stubApi({ real_estate: ROWS, members: [], currencies: [] }, { answer: { '/api/snapshot': () => jsonResponse(data) } })
    render()
    expect(await screen.findByText(/not in the closed snapshot/i)).toBeInTheDocument()
    expect(screen.queryByText(/no exchange rate to convert/i)).toBeNull()
    expect(rowOf(FLAT)).toHaveTextContent('€299,500')
  })
  it('does not invent a conversion error for an empty list', async () => {
    stub({ rows: [], extra: { realEstate: [] } })
    render()
    expect(await screen.findByText('No properties yet')).toBeInTheDocument()
    expect(screen.queryByText(/no exchange rate to convert/i)).toBeNull()
  })
})


describe('Real estate: mobile equity breakdown', () => {
  const steps = [
    { kind: 'start' as const, date: '2022-01-01', amount: 100, noLoan: true },
    { kind: 'borrowed' as const, loan: 'Loan', date: '2023-01-01', amount: -40 },
    { kind: 'value' as const, from: 100, to: 80, amount: -20 },
    { kind: 'repaid' as const, loan: 'Loan', from: 40, to: 30, amount: 10 },
    { kind: 'end' as const, amount: 50 },
  ]
  it('preserves negative contributions and endpoints, and scales all bars together', () => {
    const { container } = renderAdmin(<EquityWaterfall steps={steps} currency="USD" month="2026-09" ltv={37.5} compact mortgage={false} />, { dashboard: true })
    const items = [...container.querySelectorAll('.equity-breakdown__step')]
    expect(items.map(item => item.querySelector('.num')!.textContent)).toEqual(['−$40', '−$20', '+$10'])
    expect(items.map(item => item.querySelector('i')!.style.width)).toEqual(['100%', '50%', '25%'])
    expect(items[1].querySelector('i')).toHaveClass('asset-tone--re')
    expect(items[2].querySelector('i')).toHaveClass('asset-tone--re-2')
    expect([...container.querySelectorAll('.equity-breakdown__total .num')].map(e => e.textContent)).toEqual(['$100', '$50'])
    expect(container.querySelector('.wf')).toBeNull()
  })
  it('masks amounts in the mobile breakdown', () => {
    stubPrivacyOn()
    const { container } = renderAdmin(<EquityWaterfall steps={steps} currency="USD" month="2026-09" ltv={37.5} compact mortgage={false} />, { dashboard: true })
    expect([...container.querySelectorAll('.equity-breakdown .num')].map(e => e.textContent)).toEqual(Array(5).fill('•••'))
  })
})
