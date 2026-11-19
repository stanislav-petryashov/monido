import { useState } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { CapitalHistory } from '../../src/pages/cashflow/CapitalHistory'
import { changeHistory } from '../../src/domain/capitalStory'
import type { ChangeRowKey, MonthChange, MonthChangeGap } from '../../src/domain/types'
import { renderWithSnapshot } from '../helpers/render'

// The mockup's year, in thousands: you added, markets and rates, the unexplained rest
const YEAR: [string, number, number, number][] = [
  ['2025-04', 100, 60, -5], ['2025-05', 95, -20, 3], ['2025-06', 110, 80, -4], ['2025-07', 90, 40, 0], ['2025-08', 105, -120, -6],
  ['2025-09', 98, 30, 2], ['2025-10', 120, 150, -3], ['2025-11', 100, -60, -8], ['2025-12', 180, 90, -10], ['2026-01', 70, 40, -2],
  ['2026-02', 102, -30, 4], ['2026-03', 107, -350, -12],
]
function year(): (MonthChange | MonthChangeGap)[] {
  let nw = 11_079_000
  return YEAR.map(([month, you, markets, rest]) => {
    const rows: Partial<Record<ChangeRowKey, number>> = { saved: you * 1000, debtPaid: 0, investments: 0, fx: markets * 1000, property: 0, unexplained: rest * 1000 }
    const end = nw + (you + markets + rest) * 1000
    const m: MonthChange = { month, form: 'tracked', start: nw, end, rows, items: {}, pairs: [], candidates: [], rates: [] }
    nw = end
    return m
  })
}
const window12 = YEAR.map(([m]) => m)
const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}`
const compactMoney = (v: number) => `${v / 1000}K`
const show = (o: { all?: (MonthChange | MonthChangeGap)[]; compact?: boolean; band?: boolean; fmt?: (v: number) => string; fmtCompact?: (v: number) => string } = {}) => {
  const onPick = vi.fn()
  renderWithSnapshot(<CapitalHistory history={changeHistory(o.all ?? year(), window12)} period={['2026-03']} onPick={onPick}
    fmt={o.fmt ?? money} fmtCompact={o.fmtCompact ?? compactMoney} compact={o.compact ?? false} band={o.band ?? true} />)
  return onPick
}

describe('CapitalHistory', () => {
  it('labels both lines and the difference at the end', () => {
    show()
    expect(screen.getByText('You added +$1,277,000')).toBeInTheDocument()
    expect(screen.getByText('Net worth +$1,146,000')).toBeInTheDocument()
    // the explanation is a second line under the amount: one long line ran past the card's edge
    expect(screen.getByText('Difference −$131,000')).toBeInTheDocument()
    expect(screen.getByText('markets, rates and unexplained')).toBeInTheDocument()
  })

  it('says the takeaway and marks the largest difference', () => {
    show()
    expect(screen.getByText(/Markets and rates kept it above what you added until February 2026/)).toBeInTheDocument()
    expect(screen.getByText('largest difference: +$257,000, January 2026')).toBeInTheDocument()
  })

  it('names each month button from its figures and picks it', () => {
    const onPick = show()
    const october = screen.getByRole('button', { name: /^October 2025: net worth \+\$925,000, you added \+\$718,000, difference \+\$207,000/ })
    fireEvent.click(october)
    expect(onPick).toHaveBeenCalledWith('2025-10')
  })

  it('shows the month in the tooltip on focus, split as in the bridge', () => {
    show()
    fireEvent.focus(screen.getByRole('button', { name: /^October 2025/ }))
    const tip = document.querySelector('.ch-tip')!
    expect(tip.textContent).toContain('cumulative since 03/31/2025')
    expect(tip.textContent).toContain('+$220,000')
    expect(tip.textContent).toContain('October alone+$267,000')
  })

  it('keeps a hidden table of the window for screen readers', () => {
    show()
    const rows = [...document.querySelectorAll('table.sr-only tbody tr')]
    expect(rows).toHaveLength(12)
    expect(rows[11].textContent).toContain('+$1,146,000')
  })

  it('masks every amount in privacy mode', () => {
    show({ fmt: () => '•••', fmtCompact: () => '•••' })
    const texts = [...document.querySelectorAll('.ch text, table.sr-only td')].map(n => n.textContent ?? '')
    expect(texts.some(t => /\$|\d{3}/.test(t.replace(/\d{4}/g, '')))).toBe(false)
    expect(screen.getByRole('button', { name: /^October 2025/ }).getAttribute('aria-label')).not.toMatch(/\$/)
  })

  it('breaks the line at a gap month', () => {
    const all = year()
    all[4] = { month: '2025-08', reason: 'no_rate' }
    show({ all })
    const d = document.querySelector('.ch__line--net')!.getAttribute('d')!
    expect(d.match(/M/g)).toHaveLength(2)
  })

  it('labels the ends at the latest point, even when its month has no flows', () => {
    const all = year()
    const last = all[11] as MonthChange
    all[11] = { ...last, form: 'balances', rows: { accounts: last.end - last.start, debtPaid: 0, fx: 0, property: 0 } }
    show({ all })
    expect(screen.getByText('Net worth +$1,146,000')).toBeInTheDocument()
    expect(screen.queryByText(/^You added \+/)).toBeNull()
  })

  it('a month browsed on a phone gives way when it leaves the window', () => {
    // the page keeps the chart mounted while its period moves: the history and the period change, the browsed month stays
    function Page() {
      const [late, setLate] = useState(true)
      return <>
        <button type="button" onClick={() => setLate(false)}>Move to December 2025</button>
        <CapitalHistory history={late ? changeHistory(year(), window12) : changeHistory(year().slice(0, 9), window12.slice(0, 9))}
          period={late ? ['2026-03'] : ['2025-12']} onPick={() => {}} fmt={money} fmtCompact={compactMoney} compact />
      </>
    }
    renderWithSnapshot(<Page />)
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(document.querySelector('.ch-month')!.textContent).toContain('February 2026')
    fireEvent.click(screen.getByRole('button', { name: 'Move to December 2025' }))
    expect(document.querySelector('.ch-month')?.textContent).toContain('December 2025')
  })

  it('says which months the net-worth line leaves out', () => {
    const all = year()
    all[4] = { month: '2025-08', reason: 'no_rate' }
    show({ all })
    expect(screen.getByText(/^Net worth \+\$[\d,]+ without Aug$/)).toBeInTheDocument()
  })

  it('draws no period band for a year', () => {
    show({ band: false })
    expect(document.querySelector('.ch__period')).toBeNull()
  })

  it('shows the month details under the chart on a phone', () => {
    const onPick = show({ compact: true })
    expect(document.querySelector('.ch-month')!.textContent).toContain('March 2026')
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show February 2026 in the bridge' }))
    expect(onPick).toHaveBeenCalledWith('2026-02')
  })
})
