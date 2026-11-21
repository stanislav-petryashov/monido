import { screen } from '@testing-library/react'
import { StabilityCard } from '../../../src/modules/health/StabilityCard'
import { healthClient } from '../../../src/modules/health/client'
import { i18n } from '../../../src/i18n/client'
import type { FinanceSnapshot } from '../../../src/domain/types'
import { makeSnapshot } from '../../helpers/snapshot'
import { renderWithSnapshot, stubSnapshotFetch } from '../../helpers/render'

/** The Health module's rows on the second floor */
const todo = (s: FinanceSnapshot) => healthClient.overview!.todo!(s, i18n.t, String)

beforeEach(stubSnapshotFetch)
it('does not turn absent passive income into a critical stability verdict or priority warning', () => {
  const base = makeSnapshot()
  const metrics = Object.fromEntries(Object.entries(base.health!.metrics).map(([key, metric]) => [key, { ...metric, zone: key === 'fi_rate' || key === 'income_diversification' ? 'red' : 'green' }]))
  const snapshot = makeSnapshot({ health: { composite: 70, metrics } })
  renderWithSnapshot(<StabilityCard />, snapshot)
  expect(screen.queryAllByText('Critical')).toHaveLength(0)
  expect(todo(snapshot)).toEqual([])
})
it.each(['emergency_months', 'debt_payment_ratio'] as const)('keeps actual %s risk visible', key => {
  const base = makeSnapshot()
  renderWithSnapshot(<StabilityCard />, makeSnapshot({ health: { ...base.health!, metrics: { [key]: { value: key === 'emergency_months' ? 0 : 60, zone: 'red' } } } }))
  expect(screen.getByText('Critical')).toBeInTheDocument()
})

it('does not announce unavailable stability metrics when only independence metrics are null', () => {
  const base = makeSnapshot()
  const metrics = Object.fromEntries(Object.entries(base.health!.metrics).map(([key, metric]) => [key, { ...metric, zone: key === 'fi_rate' || key === 'income_diversification' ? null : 'green' }]))
  expect(todo(makeSnapshot({ health: { composite: 70, metrics } }))).toEqual([])
})

it.each([[0, '0'], [0.001, '<0.01'], [0.01, '0.01']] as const)('formats a reserve and payment share of %s', (value, display) => {
  renderWithSnapshot(<StabilityCard />, makeSnapshot({ health: { composite: 50, metrics: {
    emergency_months: { value, zone: 'red' },
    debt_payment_ratio: { value, zone: 'green' },
  } } }))
  expect(screen.getByText(`${display} months of expenses in reserve`)).toBeVisible()
  expect(screen.getByText(`Loan payments use ${display}% of income`)).toBeVisible()
})
