import { screen, within } from '@testing-library/react'
import { CashFlow } from '../../src/pages/CashFlow'
import { accountKey } from '../../src/domain/accounts'
import { demoFamilyData } from '../helpers/demoFamily'
import { renderWithSnapshot, stubPrivacyOn, stubSnapshotFetch } from '../helpers/render'

const { snapshot } = await demoFamilyData()

beforeEach(() => { stubSnapshotFetch(); window.history.replaceState({}, '', '/cashflow') })
afterEach(() => window.history.replaceState({}, '', '/'))

const card = () => within(screen.getByRole('region', { name: 'What changed in net worth' }))
const open = (search: string) => { window.history.replaceState({}, '', `/cashflow${search}`); return renderWithSnapshot(<CashFlow />, snapshot) }
const waterfall = () => [...document.querySelectorAll('.cf-capital .wf__v')].map(v => v.textContent)

// "What changed in net worth" closes Income and expenses: the part of the change the flows do not explain, and the records behind it
describe('what changed in net worth', () => {
  it('September: 755 551 → +3 584 → −462 → 758 673, the records led by Apartment in Leipzig', () => {
    open('')
    expect(waterfall()).toEqual(['$755,551', '+$3,584', '−$462', '$758,673'])
    expect(card().getByText('Net worth on 08/31/2026')).toBeInTheDocument()
    expect(card().getByText('September 2026 · +$3,122')).toBeInTheDocument()
    const records = [...document.querySelectorAll('.cf-moves__list li')].map(li => li.textContent)
    expect(records[0]).toBe('Apartment in LeipzigAnnika−$2,024')
    expect(records).toHaveLength(6)
    expect(card().getByText(/^3 more; all records together \+\$3,122/)).toBeInTheDocument()
  })

  it('the phone keeps full dates, signed contributions and their common scale', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('640'), addEventListener: () => {}, removeEventListener: () => {} }))
    open('')
    expect([...document.querySelectorAll('.cf-bridge .num')].map(v => v.textContent)).toEqual(['$755,551', '+$3,584', '−$462', '$758,673'])
    expect(card().getByText('Net worth on 08/31/2026')).toBeInTheDocument()
    expect(card().getByText('Net worth on 09/30/2026')).toBeInTheDocument()
    const bars = [...document.querySelectorAll<HTMLElement>('.cf-bridge__track i')]
    expect(bars[0].style.width).toBe('100%')
    expect(parseFloat(bars[1].style.width)).toBeGreaterThan(12)
    expect(parseFloat(bars[1].style.width)).toBeLessThan(14)
    expect(document.querySelector('.cf-capital .wf')).toBeNull()
  })

  it('the phone masks every capital amount in privacy mode', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('640'), addEventListener: () => {}, removeEventListener: () => {} }))
    stubPrivacyOn()
    open('')
    expect([...document.querySelectorAll('.cf-bridge .num')].map(v => v.textContent)).toEqual(['•••', '•••', '•••', '•••'])
  })

  it('the record links open their records', () => {
    open('')
    expect(card().getByRole('link', { name: 'Harborline Checking' })).toHaveAttribute('href', `/accounts#${encodeURIComponent(accountKey('Harborline Checking', 'Ryan'))}`)
    expect(card().getByRole('link', { name: 'Car loan' })).toHaveAttribute('href', expect.stringMatching(/^\/loans#/))
  })

  it("the quarter's bridge runs from 30.06.2026; the records are the closed month's only", () => {
    open('?p=quarter')
    expect(waterfall()[0]).toBe('$746,679')
    expect(card().getByText('Net worth on 06/30/2026')).toBeInTheDocument()
    expect(card().getByText('Records are broken down only for the last closed month.')).toBeInTheDocument()
    expect(card().queryByRole('link')).toBeNull()
  })

  it('a missing month: the empty line instead of a waterfall', () => {
    window.history.replaceState({}, '', '/cashflow?p=quarter')
    const analysisMonths = snapshot.analysisMonths!.map(m => (m.month === '2026-08' ? { ...m, capital: false } : m))
    renderWithSnapshot(<CashFlow />, { ...snapshot, analysisMonths })
    expect(card().getByText('No net worth at the end of the month before the period: nothing to compare with.')).toBeInTheDocument()
    expect(document.querySelector('.cf-capital')).toBeNull()
  })

  it('privacy masks the waterfall and the records, the names stay', () => {
    stubPrivacyOn()
    open('')
    expect(waterfall().every(v => v === '•••')).toBe(true)
    expect(card().getByRole('link', { name: 'Harborline Checking' })).toBeInTheDocument()
    expect(document.querySelector('.cf-moves__list')!.textContent).not.toMatch(/\$/)
  })
})
