import { screen } from '@testing-library/react'
import type { CashflowRowBase, FinanceSnapshot } from '../../../src/domain/types'
import { cashflowClient } from '../../../src/modules/cashflow/client'
import { HIST, withHistory } from '../../helpers/history'
import { renderWithSnapshot, stubSnapshotFetch } from '../../helpers/render'

const flow = (month: string, active: number, expense: number): CashflowRowBase =>
  ({ month, bank: 'Lumiora Bank', member: 'Robin', currency: 'USD', active, passive: 0, expense, activeBase: active, passiveBase: 0, expenseBase: expense })

/** The demo history closed at September 2026, with August and September flows (or only September's) and September's totals. */
function withFlows(rows: CashflowRowBase[]): FinanceSnapshot {
  const base = withHistory(HIST, ['2026-10'])
  return {
    ...base,
    cashflow: {
      ...base.cashflow, rows,
      closedMonth: { month: '2026-09', income: 5134, active: 5134, passive: 0, expense: 4100, net: 1034 },
      savingsRatePct: 20.14, emergencyMonths: 1.84,
    },
  }
}
const BOTH = [flow('2026-08', 5000, 4000), flow('2026-09', 5134, 4100)]
const cells = () => cashflowClient.overview!.kpis!.map(k => k.Cell)
const renderCells = (s: FinanceSnapshot) => renderWithSnapshot(<ul>{cells().map((Cell, i) => <Cell key={i} />)}</ul>, s)
const items = () => screen.getAllByRole('listitem')

beforeEach(stubSnapshotFetch)

describe('the cash-flow KPI cells', () => {
  it('are four, in order 10–40, and only the cushion is current', () => {
    expect(cashflowClient.overview!.kpis!.map(k => k.order)).toEqual([10, 20, 30, 40])
    renderCells(withFlows(BOTH))
    expect(items().map(li => li.classList.contains('kpi--current'))).toEqual([false, false, false, true])
  })

  it('income and expenses carry the closed month with the change against the month before', () => {
    renderCells(withFlows(BOTH))
    const [income, expenses] = items()
    expect(income.querySelector('.figure-label')).toHaveTextContent('Income')
    expect(income.querySelector('.kpi__value')).toHaveTextContent('$5,134')
    expect(income.querySelector('.kpi__delta')).toHaveTextContent('+$134 to August 2026')
    expect(expenses.querySelector('.kpi__value')).toHaveTextContent('$4,100')
    expect(expenses.querySelector('.kpi__delta')).toHaveTextContent('+$100 to August 2026')
  })

  it('what is left carries its change and the savings rate; the cushion its months against the goal', () => {
    renderCells(withFlows(BOTH))
    const [, , left, cushion] = items()
    expect(left.querySelector('.figure-label')).toHaveTextContent('Left after expenses')
    expect(left.querySelector('.kpi__value')).toHaveTextContent('$1,034')
    expect(left.querySelector('.kpi__delta')).toHaveTextContent('+$34 to August 2026 · savings rate 20.1%')
    expect(cushion.querySelector('.figure-label')).toHaveTextContent('Emergency fund')
    expect(cushion.querySelector('.kpi__value')).toHaveTextContent('1.8 mo')
    expect(cushion.querySelector('.kpi__delta')).toHaveTextContent('of 6 mo by the goal')
  })

  it('without the month before there is no change: just the value, and the rate on its own', () => {
    renderCells(withFlows([flow('2026-09', 5134, 4100)]))
    const [income, , left] = items()
    expect(income.querySelector('.kpi__delta')).toBeNull()
    expect(income).toHaveTextContent('Income$5,134')
    expect(left.querySelector('.kpi__delta')).toHaveTextContent('savings rate 20.1%')
    expect(left).not.toHaveTextContent('to August')
  })

  it('a month falling against the one before reads with a minus', () => {
    renderCells(withFlows([flow('2026-08', 6000, 4000), flow('2026-09', 5134, 4100)]))
    expect(items()[0].querySelector('.kpi__delta')).toHaveTextContent('−$866 to August 2026')
  })
})
