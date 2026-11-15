import { screen } from '@testing-library/react'
import { FinancialAnswers } from '../../src/components/finance/FinancialAnswers'
import { makeSnapshot } from '../helpers/snapshot'
import { renderWithSnapshot, stubPrivacyOn } from '../helpers/render'

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) })

it('presents short history as no data error and makes categorization optional after a recorded month', () => {
  const snapshot = makeSnapshot({ warnings: [{ code: 'short_history' }] })
  renderWithSnapshot(<FinancialAnswers snapshot={snapshot} page="overview" />, snapshot)
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByText(/Less than 12 months/)).toBeNull()
  expect(screen.getByText('Data recorded for June 2031. Categorization is optional.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Break down income and expenses' })).toHaveAttribute('href', '/cashflow/categories?month=2031-06')
})

it('keeps real data warnings separate and avoids exposing optional amounts in privacy mode', () => {
  stubPrivacyOn()
  const snapshot = makeSnapshot({ warnings: [{ code: 'short_history' }, { code: 'missing_balance', params: { name: 'Savings', month: '2031-06' } }] })
  renderWithSnapshot(<FinancialAnswers snapshot={snapshot} page="overview" />, snapshot)
  expect(screen.getByText('Data warnings: 1')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Break down income and expenses' })).toBeInTheDocument()
  expect(screen.queryByText(/Unallocated income/)).toBeNull()
})

it('leaves overview quiet when short history is the only limitation and cash flow is off', () => {
  const base = makeSnapshot()
  const snapshot = { ...base, warnings: [{ code: 'short_history' as const }], trackFlows: false }
  const { container } = renderWithSnapshot(<FinancialAnswers snapshot={snapshot} page="overview" />, snapshot)
  expect(container).toBeEmptyDOMElement()
  expect(snapshot.warnings).toEqual([{ code: 'short_history' }])
})

it('retains actual data warnings without privacy masking', () => {
  const snapshot = makeSnapshot({ warnings: [{ code: 'short_history' }, { code: 'missing_balance', params: { name: 'Savings', member: 'Robin', month: '2031-06' } }] })
  renderWithSnapshot(<FinancialAnswers snapshot={snapshot} page="overview" />, snapshot)
  expect(screen.getByRole('status')).toHaveTextContent('Data warnings: 1')
  expect(screen.getByRole('status')).toHaveTextContent('Savings')
})
