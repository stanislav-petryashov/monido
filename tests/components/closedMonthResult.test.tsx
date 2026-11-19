import { screen } from '@testing-library/react'
import ClosedMonthResult from '../../src/components/finance/ClosedMonthResult'
import { isMonthChange } from '../../src/domain/capitalChange'
import type { FinanceSnapshot, Milestone } from '../../src/domain/types'
import { demoFamilyData } from '../helpers/demoFamily'
import { renderWithSnapshot, stubPrivacyOn } from '../helpers/render'

const { snapshot } = await demoFamilyData()
const changes = (snapshot.capitalChange ?? []).filter(isMonthChange)
const down = changes.find(c => c.form === 'tracked' && c.end < c.start)!.month
const last = changes.at(-1)!.month
const ms = (month: string, list: Partial<Milestone>[]): FinanceSnapshot['milestones'] =>
  list.map((m, i) => ({ month, kind: 'loanPaidOff', params: { name: 'Car loan' }, headline: i === 0, celebrated: true, ...m }) as Milestone)
const show = (month: string, s: FinanceSnapshot = snapshot, yearHref?: (year: number) => string | null) =>
  renderWithSnapshot(<ClosedMonthResult month={month} snapshot={s} yearHref={yearHref} />, s)

describe('the closed-month result', () => {
  it('a down month shows what the family added and what markets took', () => {
    show(down)
    expect(screen.getByText(/^You (added|took out) .+\. Markets and rates (added|took) /)).toBeInTheDocument()
  })

  it('says the month\'s change beside its net worth', () => {
    show(last)
    expect(screen.getByText(/^Net worth: \$[\d,]+, [+−]\$[\d,]+ for the month\.$/)).toBeInTheDocument()
  })

  it('the recap table scrolls as a named region a keyboard can reach', () => {
    show(last)
    expect(screen.getByRole('region', { name: 'The month in figures' })).toHaveAttribute('tabindex', '0')
  })

  it('the headline milestone, then "Also:" for the rest', () => {
    show(last, { ...snapshot, milestones: ms(last, [{}, { kind: 'emergencyFund', level: 6, params: { months: 6 } }]) })
    expect(screen.getByText('Car loan paid off.')).toBeInTheDocument()
    expect(screen.getByText('Also: Emergency fund: above 6 months of expenses for the first time.')).toBeInTheDocument()
  })

  it('a month closed by an import shows no milestone lines', () => {
    show(last, { ...snapshot, milestones: ms(last, [{ celebrated: false }]) })
    expect(screen.queryByText('Car loan paid off.')).toBeNull()
  })

  it('a milestone amount stays in the family currency', () => {
    show(last, { ...snapshot, milestones: ms(last, [{ kind: 'netWorthMark', level: 600_000, params: { amount: 600_000 }, currency: 'RUB' }]) })
    expect(screen.getByText('Net worth passed ₽600,000 for the first time.')).toBeInTheDocument()
  })

  it('a balances-form month says the change in accounts, no "You added"', () => {
    const balances = changes.map(c => (c.month === last ? { ...c, form: 'balances' as const, rows: { accounts: 1000, debtPaid: 0 } } : c))
    show(last, { ...snapshot, capitalChange: balances })
    expect(screen.getByText(/^Accounts changed by /)).toBeInTheDocument()
    expect(screen.queryByText(/^You added /)).toBeNull()
  })

  it('a gap month keeps the incomplete net worth text', () => {
    show(last, { ...snapshot, capitalChange: [...changes.slice(0, -1), { month: last, reason: 'no_rate' }], capitalCoverage: snapshot.capitalCoverage!.map(c => (c.month === last ? { ...c, capitalKnown: false } : c)) })
    expect(screen.getByText(/net worth is not shown/)).toBeInTheDocument()
    expect(screen.queryByText(/^You added /)).toBeNull()
  })

  it('the recap table compares the month and writes a dash, not 0, for an unknown cell', () => {
    show(last, { ...snapshot, fundHistory: snapshot.fundHistory!.map(f => (f.month === last ? { ...f, months: null } : f)) })
    const fund = screen.getByRole('row', { name: /^Emergency fund/ })
    expect(fund.textContent).toBe('Emergency fund———')
    expect(screen.getByRole('columnheader', { name: 'vs a year ago' })).toBeInTheDocument()
  })

  it('a fund change under a tenth of a month is not drawn as zero', () => {
    const prev = snapshot.fundHistory!.at(-2)!.month
    show(last, { ...snapshot, fundHistory: snapshot.fundHistory!.map(f => (f.month === last ? { ...f, months: 3.01 } : f.month === prev ? { ...f, months: 3 } : f)) })
    expect(screen.getByRole('row', { name: /^Emergency fund/ }).textContent).toMatch(/^Emergency fund3 mo\+0\.01 mo/)
  })

  // the fund is months, not money: it stays, as on the Health card
  it('privacy masks every amount', () => {
    stubPrivacyOn()
    show(down, { ...snapshot, milestones: ms(down, [{ kind: 'netWorthMark', level: 600_000, params: { amount: 600_000 }, currency: 'USD' }]) })
    const text = document.querySelector('section.card')!.textContent!.replace(/(?<!\d)(19|20)\d{2}(?!\d)/g, '').replace(/[+−]?[\d.]+\s?mo/g, '')
    expect(text).not.toMatch(/\d{2}/)
  })

  it('a December card links to the year when the module gives its address', () => {
    const december = changes.map(c => c.month).filter(m => m.endsWith('-12')).at(-1)!
    const { unmount } = show(december, snapshot, y => `/year/${y}`)
    expect(screen.getByRole('link', { name: "The year's results" })).toHaveAttribute('href', `/year/${december.slice(0, 4)}`)
    unmount()
    const june = show(changes.map(c => c.month).filter(m => m.endsWith('-06')).at(-1)!, snapshot, y => `/year/${y}`)
    expect(screen.queryByRole('link', { name: "The year's results" })).toBeNull()
    june.unmount()
    show(december, snapshot, () => null)
    expect(screen.queryByRole('link', { name: "The year's results" })).toBeNull()
  })
})

