// The Accounts detail's charts: the balance with last year (WindowChart), the month heatmap, income and expenses (Task 4).
import { fireEvent, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { accountStats } from '../../../src/domain/accountStats'
import { shiftMonth } from '../../../src/domain/dates'
import { BalanceCard, type AccountWindow } from '../../../src/pages/admin/accounts/BalanceCard'
import { FlowsChart } from '../../../src/pages/admin/accounts/FlowsChart'
import { MonthHeatmap } from '../../../src/pages/admin/accounts/MonthHeatmap'
import { renderWithClient, stubPrivacyOn } from '../../helpers/render'

const LAST = '2031-05'
/** `n` month ends up to May 2031, oldest first, the values from `value(i)` */
const series = (n: number, value: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => ({ month: shiftMonth(LAST, i - n + 1), value: value(i) }))
/** 36 months rising by 10, 20, 30, 40 in turn, March 2031 by 500 more */
const STEPS = [10, 20, 30, 40]
const rising = (() => {
  let v = 5000
  return series(36, i => (v += i === 0 ? 0 : STEPS[i % 4] + (i === 33 ? 500 : 0)))
})()

function Card({ balances = rising, compact = false }: { balances?: { month: string; value: number }[]; compact?: boolean }) {
  const [win, setWin] = useState<AccountWindow>('12')
  return <BalanceCard name="Harborline" currency="USD" balances={balances} lastMonth={LAST} window={win} onWindow={setWin} compact={compact} />
}

const pointsOf = (el: Element) => el.getAttribute('points')!.split(' ').map(p => p.split(',').map(Number))

describe('BalanceCard', () => {
  it('switches the window between 12 months and the whole history', () => {
    const { container } = renderWithClient(<Card />)
    expect(screen.getByRole('img', { name: 'Harborline: the balance by month, June 2030 – May 2031' })).toBeInTheDocument()
    expect(pointsOf(container.querySelector('.wchart__past')!)).toHaveLength(12)
    expect(screen.getByRole('button', { name: '12 months' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'All time' }))
    expect(screen.getByRole('img', { name: 'Harborline: the balance by month, June 2028 – May 2031' })).toBeInTheDocument()
    expect(pointsOf(container.querySelector('.wchart__past')!)).toHaveLength(36)
  })

  it('draws last year dashed only in the 12-month window with the checkbox on, inside the scale', () => {
    const { container } = renderWithClient(<Card />)
    const box = screen.getByRole('checkbox', { name: 'last year dashed' })
    expect(box).toBeChecked()
    const ghost = container.querySelector('.wchart__ghost')!
    expect(pointsOf(ghost)).toHaveLength(12)
    expect(container.querySelector('.wchart__ghostLabel')).toHaveTextContent('a year ago')
    // the gridlines span the year-ago line too: none of its points is under the lowest one
    const lowest = Math.max(...[...container.querySelectorAll('.wchart__tick')].map(l => Number(l.getAttribute('y1'))))
    expect(Math.max(...pointsOf(ghost).map(([, y]) => y))).toBeLessThanOrEqual(lowest)
    fireEvent.click(box)
    expect(container.querySelector('.wchart__ghost')).toBeNull()
    fireEvent.click(box)
    expect(container.querySelector('.wchart__ghost')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'All time' }))
    expect(container.querySelector('.wchart__ghost')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('offers no last year without a year before the window', () => {
    const { container } = renderWithClient(<Card balances={rising.slice(-12)} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(container.querySelector('.wchart__ghost')).toBeNull()
  })

  it('names the biggest month only when it is at least twice the median absolute change', () => {
    const { container, unmount } = renderWithClient(<Card />)
    expect(container.querySelector('.wchart__event')).toHaveTextContent('March 2031: +$520, the biggest month')
    unmount()
    // changes of 10 … 19: the largest is under twice the median
    const even = renderWithClient(<Card balances={series(24, i => 5000 + i * 10 + (i % 10))} />)
    expect(even.container.querySelector('.wchart__event')).toBeNull()
    // nor its column's amount: the Overview's label is opted out of here
    expect(even.container.querySelector('.wchart__chgLabel')).toBeNull()
  })

  it('captions the year-ago line at its first drawn segment, not at a lone point', () => {
    // a year before the window: one balance in June 2029, then a gap, then August 2029 on
    const balances = [...series(12, i => 6000 + i * 10), ...series(22, i => 5000 + i * 10).filter(b => b.month < '2030-06' && b.month !== '2029-07')]
      .sort((a, b) => a.month.localeCompare(b.month))
    const { container } = renderWithClient(<Card balances={balances} />)
    const [segment] = [...container.querySelectorAll('.wchart__ghost')]
    const [x0] = pointsOf(segment)[0]
    expect(Number(container.querySelector('.wchart__ghostLabel')!.getAttribute('x'))).toBeCloseTo(x0 + 4, 1)
    const firstPast = pointsOf(container.querySelector('.wchart__past')!)[0][0]
    expect(x0).toBeGreaterThan(firstPast)
  })

  it('masks the amounts in privacy mode', () => {
    stubPrivacyOn()
    const { container } = renderWithClient(<Card />, { dashboard: true })
    expect(container.querySelector('.wchart__tagText')).toHaveTextContent('•••')
    expect(container.textContent).not.toMatch(/\$/)
  })
})

describe('MonthHeatmap', () => {
  // November 2029 … May 2031 without July 2030: rises, one fall in March 2031
  const balances = series(19, i => 1000 + i * 100 - (i === 16 ? 400 : 0)).filter(b => b.month !== '2030-07')
  const stats = accountStats(balances, [], LAST)

  it('splits enlarged text into half-years without duplicating or losing month values', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(512)
    document.documentElement.style.fontSize = '32px'
    document.documentElement.style.setProperty('--fs-meta', '.75rem')
    try {
      const { container } = renderWithClient(<MonthHeatmap stats={stats} lastMonth={LAST} currency="USD" compact={false} />)
      expect(container.querySelectorAll('.acc-heat__year')).toHaveLength(6)
      expect(container.querySelectorAll('.acc-heat__cell')).toHaveLength(36)
      expect(container.querySelectorAll('.acc-heat__cell--last')).toHaveLength(1)
      expect(container.querySelectorAll('[title="May 2031: +$100"]')).toHaveLength(1)
      expect(container.querySelectorAll('[title="Apr 2031: +$500"]')).toHaveLength(1)
    } finally {
      document.documentElement.style.removeProperty('font-size')
      document.documentElement.style.removeProperty('--fs-meta')
    }
  })

  it('draws a row per year, a dashed cell only for a gap, empty cells outside the history, the last month outlined, the meta counts', () => {
    const { container } = renderWithClient(<MonthHeatmap stats={stats} lastMonth={LAST} currency="USD" compact={false} />)
    const heat = screen.getByRole('img', { name: 'The change of the balance by month, 2029 – 2031' })
    expect([...heat.querySelectorAll('.acc-heat__year')].map(y => y.textContent)).toEqual(['2029', '2030', '2031'])
    expect(heat.querySelectorAll('.acc-heat__cell')).toHaveLength(36)
    // only the real gap is dashed: 2030's July and August; before the first balance (2029-11) and after May 2031 empty
    expect(heat.querySelectorAll('.acc-heat__cell--none')).toHaveLength(2)
    expect(heat.querySelectorAll('.acc-heat__cell--out')).toHaveLength(10 + 7)
    // the first month: a plain cell without a value
    const first = heat.querySelectorAll('.acc-heat__cell')[10]
    expect(first.className).toBe('acc-heat__cell')
    expect(first).toHaveTextContent('')
    const last = heat.querySelectorAll('.acc-heat__cell--last')
    expect(last).toHaveLength(1)
    expect(last[0]).toHaveAttribute('title', 'May 2031: +$100')
    // −300 against the largest change, +500: the second step
    expect(heat.querySelector('[title="Mar 2031: −$300"]')).toHaveClass('acc-heat__cell--down-2')
    expect(heat.querySelector('[title="Apr 2031: +$500"]')).toHaveTextContent('+500')
    expect(container.querySelector('.acc-card__meta')).toHaveTextContent('change of the balance · 15 months up, 1 down')
    // the grid is an image: its content in words beside it
    expect(container.querySelector('.sr-only')).toHaveTextContent(
      'The balance rose in 15 months and fell in 1. The biggest rise: April 2031, +$500. The biggest fall: March 2031, −$300.')
  })

  it('writes no numbers in the cells on a phone, nor in privacy mode', () => {
    const { container, unmount } = renderWithClient(<MonthHeatmap stats={stats} lastMonth={LAST} currency="USD" compact />)
    expect([...container.querySelectorAll('.acc-heat__cell')].every(c => c.textContent === '')).toBe(true)
    unmount()
    stubPrivacyOn()
    const masked = renderWithClient(<MonthHeatmap stats={stats} lastMonth={LAST} currency="USD" compact={false} />, { dashboard: true })
    expect([...masked.container.querySelectorAll('.acc-heat__cell')].every(c => c.textContent === '')).toBe(true)
    expect(masked.container.querySelector('.acc-heat__cell--last')).toHaveAttribute('title', 'May 2031: •••')
  })
})

describe('FlowsChart', () => {
  it('does not invert columns while its measured container is temporarily narrower than the label lanes', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(24)
    const { container } = renderWithClient(<FlowsChart name="Narrow" currency="USD" flows={[{ month: LAST, income: 100, expense: 50 }]} lastMonth={LAST} window="12" firstMonth={null} compact />)
    expect(Number(container.querySelector('rect.acc-flows__inc')!.getAttribute('width'))).toBeGreaterThan(0)
  })
  it('keeps year labels apart in a narrow thirty-year history without dropping flows', () => {
    const flows = series(360, () => 1).map(({ month }) => ({ month, income: 100, expense: 50 }))
    const { container } = renderWithClient(<FlowsChart name="History" currency="USD" flows={flows} lastMonth={LAST} window="all" firstMonth={null} compact />)
    const xs = [...container.querySelectorAll('.acc-flows__x')].map(el => Number(el.getAttribute('x')))
    expect(xs.length).toBeGreaterThan(1)
    expect(xs.slice(1).every((x, i) => x - xs[i] >= 32)).toBe(true)
    expect(container.querySelectorAll('rect.acc-flows__inc')).toHaveLength(360)
  })
  const flows = series(14, i => i).map(({ month }, i) => ({ month, income: 7100, expense: i === 13 ? 5300 : 3500 }))

  it('draws the window\'s months, income up and expenses down, and sums them in the meta', () => {
    const { container } = renderWithClient(<FlowsChart name="Harborline" currency="USD" flows={flows} lastMonth={LAST} window="12" firstMonth="2029-01" compact={false} />)
    expect(screen.getByRole('img', { name: 'Harborline: income and expenses by month, June 2030 – May 2031' })).toBeInTheDocument()
    expect(container.querySelectorAll('.acc-flows__inc')).toHaveLength(12 + 1)
    expect(container.querySelectorAll('rect.acc-flows__exp')).toHaveLength(12)
    expect(pointsOf(container.querySelector('polyline.acc-flows__left')!)).toHaveLength(12)
    expect(container.querySelector('.acc-card__meta')).toHaveTextContent('over 12 months: income $85,200 · expenses $43,800 · left +$41,400')
  })

  it('a month without a flow row is a gap: no column, the «left» line broken there', () => {
    const { container } = renderWithClient(<FlowsChart name="Harborline" currency="USD" flows={flows.filter(f => f.month !== '2030-12')} lastMonth={LAST} window="12" firstMonth={null} compact={false} />)
    expect(container.querySelectorAll('rect.acc-flows__exp')).toHaveLength(11)
    expect([...container.querySelectorAll('polyline.acc-flows__left')].map(l => pointsOf(l).length)).toEqual([6, 5])
    expect(container.querySelector('.acc-card__meta')).toHaveTextContent('income $78,100 · expenses $40,300 · left +$37,800')
  })

  it('over all time it starts where the balance card does; amounts masked in privacy mode', () => {
    stubPrivacyOn()
    const { container } = renderWithClient(<FlowsChart name="Harborline" currency="USD" flows={flows} lastMonth={LAST} window="all" firstMonth="2030-01" compact={false} />, { dashboard: true })
    expect(within(container).getByRole('img', { name: 'Harborline: income and expenses by month, January 2030 – May 2031' })).toBeInTheDocument()
    expect(container.querySelector('.acc-card__meta')).toHaveTextContent('over all time: income ••• · expenses ••• · left •••')
    expect(container.textContent).not.toMatch(/\$/)
  })
})
