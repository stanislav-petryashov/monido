import { fireEvent, screen, within } from '@testing-library/react'
import { Assets } from '../../src/pages/Assets'
import { accountKey } from '../../src/domain/accounts'
import { DEMO_FAMILIES } from '../../src/demo/family'
import type { FinanceSnapshot } from '../../src/domain/types'
import { emptySnapshot, makeSnapshot } from '../helpers/snapshot'
import { pageText, renderWithSnapshot as renderPage, stubPrivacyOn, stubSnapshotFetch } from '../helpers/render'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

const BROKEN = /NaN|Infinity|undefined/
/** An element coloured as an assessment: a status chip or avatar, or a signed change */
const VERDICT = '[data-color="error"], [data-color="success"], [data-color="warning"]'

beforeEach(() => { stubSnapshotFetch() })
afterEach(() => { sessionStorage.removeItem('fc.viewCurrency') })

/** The fixture with the capital a month and a year back, and at the first history month; no start 3 months back */
function withStarts(over: Partial<FinanceSnapshot> = {}): FinanceSnapshot {
  const end = makeSnapshot().capital!
  const [lumiora, brisaluna] = end.accounts
  // a month back: Lumiora's roubles the same at a better rate, Brisaluna smaller, the apartment cheaper
  const prev = { ...end, date: '2031-05-31', accounts: [{ ...lumiora, valueBase: 16000.4 }, { ...brisaluna, value: 2500, valueBase: 2900.3 }], realEstate: [{ ...end.realEstate[0], value: 130000, valueBase: 130000 }] }
  const first = { ...end, date: '2030-06-30', accounts: [{ ...lumiora, valueBase: 15000 }, { ...brisaluna, valueBase: 5000 }], realEstate: [{ ...end.realEstate[0], value: 120000, valueBase: 120000 }] }
  return makeSnapshot({ previousCapital: prev, capitalCoverage: ['2031-05', '2031-06', '2030-06'].map(month => ({ month, assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] })), capitalBack: { quarter: null, year: first, all: first }, ...over })
}

describe('Assets page', () => {
  it('explains omitted balances and fallback rates by the totals, without unrelated flow or goal warnings', () => {
    stubPrivacyOn()
    const base = makeSnapshot()
    const accounts = [
      { ...base.capital!.accounts[0], name: 'Bank|Robin', member: 'Noa', currency: 'XYZ', valueBase: null },
      { ...base.capital!.accounts[0], name: 'Zero bank', member: 'Noa', valueBase: 0 },
    ]
    const { container } = renderPage(<Assets />, makeSnapshot({ capital: { ...base.capital!, accounts }, warnings: [
      { code: 'fx_unknown_currency', ref: accountKey('Bank|Robin', 'Noa'), params: { currency: 'XYZ', name: 'Omitted balance' } },
      { code: 'missing_balance', params: { name: 'Missing balance', member: 'Noa', month: '2031-06' } },
      { code: 'fx_fallback', ref: 'RUB 2031-06-30', params: { currency: 'RUB', date: '2031-06-30', used: '2031-06-29' } },
      { code: 'missing_cashflow', params: { name: 'Unrelated flows', member: 'Noa', month: '2031-06' } },
      { code: 'fx_unknown_currency', ref: 'goal:trip', params: { currency: 'XYZ', name: 'Unrelated goal' } },
      { code: 'fx_unknown_currency', ref: accountKey('Bank', 'Robin|Noa'), params: { currency: 'XYZ', name: 'Colliding name in flows' } },
      { code: 'fx_fallback', ref: 'XYZ 2031-07-03', params: { currency: 'XYZ', date: '2031-07-03', used: '2031-07-02' } },
    ] }))
    const warnings = screen.getByRole('status')
    expect(warnings).toHaveTextContent('Omitted balance')
    expect(warnings).toHaveTextContent('Missing balance')
    expect(warnings).toHaveTextContent('2031-06-29 was used')
    expect(warnings).not.toHaveTextContent(/Unrelated flows|Unrelated goal|Colliding name|2031-07-02/)
    // a holding without a rate stays listed, its value unknown
    expect(screen.getByRole('link', { name: 'Bank|Robin' }).closest('li')!.querySelector('.holdings__val')).toHaveTextContent(/^—$/)
    expect(screen.getByRole('link', { name: 'Zero bank' }).closest('li')).toHaveTextContent('•••')
    expect(container.textContent).not.toMatch(/15,748|47,835/)
  })

  it('does not label a converted account balance as omitted for historical cash flow of the same identity', () => {
    stubPrivacyOn()
    const base = makeSnapshot()
    const name = 'Same entity'
    const member = 'Robin'
    const ref = accountKey(name, member)
    const { container } = renderPage(<Assets />, makeSnapshot({
      capital: { ...base.capital!,
        accounts: [{ ...base.capital!.accounts[0], name, member, currency: 'USD', valueBase: 120 }],
        loans: [],
      },
      cashflow: { ...base.cashflow, rows: [{ month: '2031-05', bank: name, member, currency: 'XYZ', active: 10, passive: 0, expense: 1, activeBase: null, passiveBase: null, expenseBase: null }] },
      warnings: [{ code: 'fx_unknown_currency', ref, params: { currency: 'XYZ', name } }],
    }))
    expect(screen.getByRole('link', { name }).closest('li')).toHaveTextContent('•••')
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.textContent).not.toContain('$120')
  })

  it('keeps a valid zero balance distinct from an unavailable conversion', () => {
    const base = makeSnapshot()
    renderPage(<Assets />, makeSnapshot({ capital: { ...base.capital!, accounts: [
      { ...base.capital!.accounts[0], name: 'Zero bank', valueBase: 0 },
      { ...base.capital!.accounts[1], name: 'Unavailable bank', valueBase: null },
    ] } }))
    expect(screen.getByRole('link', { name: 'Zero bank' }).closest('li')).toHaveTextContent('$0')
    const unavailable = screen.getByRole('link', { name: 'Unavailable bank' }).closest('li')!
    expect(unavailable.querySelector('.holdings__val')).toHaveTextContent(/^—$/)
    expect(unavailable).not.toHaveTextContent('$0')
  })

  it('leads with the total assets of the month and how they changed, with no trend', () => {
    const { container } = renderPage(<Assets />, withStarts())
    expect(screen.getByText('Assets · June 2031')).toBeInTheDocument()
    // the total is the holdings' sum, the one the map's shares are of
    expect(container.querySelector('.assets-top .hl__value')).toHaveTextContent('$153,268')
    expect(container.querySelector('.assets-top .hl__deltas')).toHaveTextContent('+$4,367over the month · +2.9%')
    expect(screen.getByText('changes since May 31, 2031')).toBeInTheDocument()
    expect(container.querySelector('.hl__chart, .trend')).toBeNull()
  })

  it('offers four periods, the one without a start disabled with its reason', () => {
    renderPage(<Assets />, withStarts())
    const pills = screen.getByRole('group', { name: 'Period of the changes' })
    expect(within(pills).getAllByRole('button').map(b => b.textContent)).toEqual(['Month', 'Quarter', 'Year', 'All time'])
    expect(within(pills).getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true')
    const quarter = within(pills).getByRole('button', { name: 'Quarter' })
    expect(quarter).toBeDisabled()
    expect(quarter).toHaveAttribute('title', 'No balances at the start of this period')
  })

  it('turns the delta and the finding to the picked period', () => {
    const { container } = renderPage(<Assets />, withStarts())
    const top = container.querySelector('section.card.assets-top')!
    expect(top).toHaveTextContent('City apartment added the most, $4,000; Lumiora Bank lost the most, $252, on the exchange rate alone.')
    fireEvent.click(within(screen.getByRole('group', { name: 'Period of the changes' })).getByRole('button', { name: 'All time' }))
    expect(top.querySelector('.hl__deltas')).toHaveTextContent('+$13,268since Jun 2030 · +9.5%')
    expect(top).toHaveTextContent('City apartment added the most, $14,000; Brisaluna Bank lost the most, $1,480, on the exchange rate alone.')
  })

  it('without any period shows the total and the map alone, no pill pressed', () => {
    const { container } = renderPage(<Assets />, makeSnapshot({ capitalCoverage: [{ month: '2031-06', assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] }] }))
    const pills = screen.getByRole('group', { name: 'Period of the changes' })
    expect(within(pills).getAllByRole('button').filter(b => b.getAttribute('aria-pressed') === 'true')).toEqual([])
    expect(container.querySelector('.assets-top .hl__value')).toHaveTextContent('$184,508')
    expect(container.querySelector('.assets-top .hl__deltas, .assets-top__finding')).toBeNull()
    expect(container.querySelectorAll('.asset-tile')).toHaveLength(3)
    expect(container.querySelector('.asset-tile__c')!.textContent).not.toMatch(/over/)
    expect(screen.queryByText(/changes since/)).toBeNull()
  })

  it('leaves a fall without a status colour', () => {
    const base = withStarts()
    const { container } = renderPage(<Assets />, { ...base, previousCapital: { ...base.previousCapital!, realEstate: [{ ...base.capital!.realEstate[0], valueBase: 140000 }] } })
    const delta = container.querySelector('.assets-top .delta')!
    expect(delta.textContent).toMatch(/^−/)
    expect(delta.className).toBe('delta')
  })

  it('names the owner in the finding when two holdings share a name', () => {
    const base = withStarts()
    const twin = { ...base.capital!.accounts[1], name: 'Lumiora Bank' }
    const { container } = renderPage(<Assets />, { ...base, capital: { ...base.capital!, accounts: [base.capital!.accounts[0], twin] }, previousCapital: { ...base.previousCapital!, accounts: [base.previousCapital!.accounts[0], { ...base.previousCapital!.accounts[1], name: 'Lumiora Bank' }] } })
    expect(container.querySelector('.assets-top__finding')).toHaveTextContent(`Lumiora Bank · ${DEMO_FAMILIES['en-US'].members[0]} lost the most`)
  })

  it('falls back to the first period with a start', () => {
    const { container } = renderPage(<Assets />, withStarts({ previousCapital: null }))
    expect(screen.getByRole('button', { name: 'Month' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Year' })).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelector('.assets-top .hl__deltas')).toHaveTextContent('over the year')
  })

  it('links each asset row to its own record: an account by name and member, a property by name', () => {
    renderPage(<Assets />, makeSnapshot())
    expect(screen.getByRole('link', { name: 'Lumiora Bank' })).toHaveAttribute('href', `/accounts#${encodeURIComponent(JSON.stringify(['Lumiora Bank', DEMO_FAMILIES['en-US'].members[0]]))}`)
    expect(screen.getByRole('link', { name: 'City apartment' })).toHaveAttribute('href', '/real-estate#City%20apartment')
  })
})

describe('Assets: the blocks', () => {
  it('carries no verdict colour: a change is a fact, not an assessment', () => {
    const { container } = renderPage(<Assets />, withStarts())
    expect(container.querySelector('.assets-top .delta')).not.toBeNull()
    expect(container.querySelector(VERDICT)).toBeNull()
  })

  it('renders an empty database without broken numbers or a zero next to "No data"', () => {
    const { container } = renderPage(<Assets />, emptySnapshot())
    expect(pageText(container)).not.toMatch(BROKEN)
    expect(pageText(container)).not.toContain('$0')
  })
})
