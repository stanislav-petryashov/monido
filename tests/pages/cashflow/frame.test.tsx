import { fireEvent, screen, within } from '@testing-library/react'
import { CashFlow } from '../../../src/pages/CashFlow'
import { OverviewNetCard } from '../../../src/modules/cashflow/OverviewNetCard'
import { CashflowFinding, CategoriesLead, SplitAction } from '../../../src/pages/cashflow/TitleParts'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import type { FinanceSnapshot } from '../../../src/domain/types'
import { demoFamilyData } from '../../helpers/demoFamily'
import { renderWithSnapshot, stubPrivacyOn, stubSnapshotFetch } from '../../helpers/render'

vi.mock('../../../src/components/charts/echarts', () => import('../../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../../helpers/echartsStub'))

const { snapshot, rows, build } = await demoFamilyData()

beforeEach(() => { stubSnapshotFetch(); window.history.replaceState({}, '', '/cashflow') })
afterEach(() => { resetAuth(); window.history.replaceState({}, '', '/') })

const kpis = () => [...document.querySelectorAll('.kpis--facts .kpi')].map(k => k.textContent)
const hit = (month: string) => document.querySelector<SVGRectElement>(`.cfband__hit[aria-label^="${month}"]`) ?? (() => { throw new Error(`no column ${month}`) })()
const allSplit = (s: FinanceSnapshot): FinanceSnapshot => {
  const split = (m: FinanceSnapshot['spending']['months'][number]) => ({ ...m, unallocatedBase: 0 })
  return { ...s, spending: { ...s.spending, months: s.spending.months.map(split) }, income: { months: s.income.months.map(split) } }
}

describe('the finding under the title', () => {
  it('September: saved, the rate against usual and the expenses against the usual month', () => {
    const { container } = renderWithSnapshot(<CashflowFinding />, snapshot)
    expect(container.textContent).toBe('September 2026: saved $3,584, 25.4% of income (usually 19.3%). Expenses are $819 below a usual month.')
  })

  it('the quarter: per month, most of all travel', () => {
    window.history.replaceState({}, '', '/cashflow?p=quarter')
    const { container } = renderWithSnapshot(<CashflowFinding />, snapshot)
    expect(container.textContent).toBe('July – September 2026: saved $6,422, 15.3% of income (usually 20.3%). Expenses are $720 a month above a usual month, most of all Travel +$1,113.')
  })
})

describe('the KPIs and the period', () => {
  it('September against the usual month', () => {
    renderWithSnapshot(<CashFlow />, snapshot)
    expect(kpis()).toEqual([
      'Came in$14,093usually $13,966 · +$126',
      'Went out$10,509usually $11,328 · −$819',
      'Saved$3,584usually $2,701 · +$882',
      'Savings rate25.4%usually 19.3% · median of 6 months before September',
    ])
  })

  it('the quarter compares its average month', () => {
    window.history.replaceState({}, '', '/cashflow?p=quarter')
    renderWithSnapshot(<CashFlow />, snapshot)
    expect(kpis()[0]).toBe('Came in$41,991$13,997 a month on average, usually $13,974 · +$23')
  })

  it('a month picked on the chart and with ‹ moves every figure; › stops at the last closed month', () => {
    renderWithSnapshot(<CashFlow />, snapshot)
    const later = screen.getByRole('button', { name: 'Month later' })
    expect(later).toBeDisabled()
    expect(later).toHaveAttribute('title', 'October 2026 is not closed yet')
    fireEvent.click(hit('July 2026'))
    expect(window.location.search).toBe('?m=2026-07')
    expect(kpis()[2]).toMatch(/^Overspent\$528/)
    expect(document.querySelector('.kpi__value--bad')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Month earlier' }))
    expect(document.querySelector('.cf-period__range')!.textContent).toBe('June 2026')
    expect(kpis()[0]).toMatch(/^Came in\$14,090/)
    fireEvent.click(screen.getByRole('button', { name: 'Quarter' }))
    expect(screen.getByText('April – June 2026')).toBeInTheDocument()
  })

  it('a month with a row without a rate is a gap: no bar, no line through it, dashes in its name; the page still opens', () => {
    const victim = rows.cashflow.find(r => r.date.startsWith('2026-08') && r.active_income > 0)!
    const s = build({ ...rows, cashflow: [...rows.cashflow.map(r => (r === victim ? { ...r, currency: 'XYZ' } : r)),
      { ...victim, bank: 'Odd', currency: 'XYZ', date: '2026-09-01' }] })
    renderWithSnapshot(<CashFlow />, s)
    expect(hit('August 2026')).toHaveAttribute('aria-label', expect.stringContaining('—'))
    expect(document.querySelector('.cfband__net[data-month="2026-08"]')).toBeNull()
    expect(document.querySelector('.cfband__net[data-month="2026-07"]')).not.toBeNull()
    for (const path of document.querySelectorAll('.cfband path')) expect(path.getAttribute('d')).not.toMatch(/NaN/)
    // thirteen months to September, August and September unknown: the line has eleven points
    expect(document.querySelector('.cfband__line--income')!.getAttribute('d')!.match(/[ML]/g)).toHaveLength(11)
    expect(kpis()).toEqual([])
  })

  it('Overview: a month of the twelve without a rate leaves the total and its savings rate unknown together', () => {
    const victim = rows.cashflow.find(r => r.date.startsWith('2026-08') && r.active_income > 0)!
    const s = build({ ...rows, cashflow: rows.cashflow.map(r => (r === victim ? { ...r, currency: 'XYZ' } : r)) })
    const { container } = renderWithSnapshot(<OverviewNetCard />, s)
    expect(container.querySelector('.net-card__value')).toHaveTextContent('—')
    expect(container.querySelector('.overview-card-meta')).toHaveTextContent('—')
    document.body.innerHTML = ''
    const full = renderWithSnapshot(<OverviewNetCard />, snapshot).container
    expect(full.querySelector('.overview-card-meta')).not.toHaveTextContent('—')
  })

  it('the overspent months (the June repair, the July trip) are red in the band and the strip', () => {
    renderWithSnapshot(<CashFlow />, snapshot)
    expect(document.querySelector('.cfband__net[data-month="2026-06"]')).toHaveClass('cfband__net--over')
    expect(document.querySelector('.cfband__net[data-month="2026-07"]')).toHaveClass('cfband__net--over')
    expect(document.querySelectorAll('.cfband__net--over')).toHaveLength(2)
    expect(document.querySelector('.cfband__gap--over')).not.toBeNull()
    expect(document.querySelector('.cfband__net[data-month="2026-09"]')).toHaveClass('cfband__net--now')
    expect(screen.getByText('Jun −$3,862')).toBeInTheDocument()
  })

  it('the figures on the chart are ink and the columns name their months', () => {
    renderWithSnapshot(<CashFlow />, snapshot)
    expect([...document.querySelectorAll('.cfband__value')].map(v => v.textContent)).toEqual(['$14,093', '$10,509'])
    expect(hit('September 2026')).toHaveAccessibleName('September 2026: income $14,093, expenses $10,509, saved $3,584')
    expect(hit('September 2026')).toHaveAttribute('aria-pressed', 'true')
  })

  it('privacy masks the chart labels and the column titles', () => {
    stubPrivacyOn()
    const { container } = renderWithSnapshot(<CashFlow />, snapshot)
    const chart = within(container.querySelector<HTMLElement>('.cfband-wrap')!)
    expect(container.querySelector('.cfband')!.textContent).not.toMatch(/\d[\d,.]*\s?\$|\$\s?\d/)
    expect(hit('September 2026').querySelector('title')!.textContent).toBe('September 2026: income •••, expenses •••, saved •••')
    expect(chart.getAllByText('•••').length).toBeGreaterThan(0)
  })
})

describe('the primary "Split <amount> <month>"', () => {
  it('with unsplit amounts it opens the categories screen on that month', () => {
    renderWithSnapshot(<SplitAction />, snapshot)
    expect(screen.getByRole('link', { name: 'Split $1,144 of September' })).toHaveAttribute('href', '/cashflow/categories?month=2026-09')
  })

  it('none when all is split, for a viewer and with tracking off', () => {
    const { unmount } = renderWithSnapshot(<SplitAction />, allSplit(snapshot))
    expect(screen.queryByRole('link')).toBeNull()
    unmount()
    const off = renderWithSnapshot(<SplitAction />, { ...snapshot, trackFlows: false })
    expect(screen.queryByRole('link')).toBeNull()
    off.unmount()
    setAuth({ me: { name: 'Robin', rights: { edit: false, vote: true, manage: false } } } as never)
    renderWithSnapshot(<SplitAction />, snapshot)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('an unsplit amount without a rate: no button; the categories screen says it cannot be counted', () => {
    const unknown = { ...snapshot, spending: { ...snapshot.spending, months: snapshot.spending.months.map(m => (m.month === '2026-09' ? { ...m, unallocatedBase: null } : m)) } }
    renderWithSnapshot(<SplitAction />, unknown)
    expect(screen.queryByRole('link')).toBeNull()
    const { container } = renderWithSnapshot(<CategoriesLead />, unknown)
    expect(container.textContent).toBe("Split each account's income and expenses by category. September 2026: a line has no exchange rate, so what is left to split cannot be counted.")
  })

  it('tracking off: the notice, then the period and what changed net worth', () => {
    renderWithSnapshot(<CashFlow />, { ...snapshot, trackFlows: false })
    expect(screen.getByText('Income and expenses tracking is off')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Period' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'What changed our net worth' })).toBeInTheDocument()
  })
})

