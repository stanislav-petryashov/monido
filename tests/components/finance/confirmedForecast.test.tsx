import { fireEvent, screen } from '@testing-library/react'
import { ForecastPanel } from '../../../src/components/finance/ForecastPanel'
import { makeSnapshot } from '../../helpers/snapshot'
import { renderWithSnapshot, snapshotClient, stubSnapshotFetch } from '../../helpers/render'
import { t } from '../../../src/i18n/client'

vi.mock('../../../src/components/charts/echarts', () => import('../../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../../helpers/echartsStub'))
beforeEach(stubSnapshotFetch)

function setup(change: 'month' | 'currency' | 'balance' | 'coverage' | null = null) {
  const s = makeSnapshot({ warnings: [], capitalCoverage: [{ month: '2031-06', assetsKnown: true, liquidKnown: true, capitalKnown: change !== 'coverage', missingAccounts: [] }] })
  s.capital!.accounts = [{ name: 'Cash', member: '', currency: 'USD', value: 1000, valueBase: 1000, class: 'bank' }]
  const client = snapshotClient(s)
  client.setQueryData(['admin', 'availability'], { assessments: [{ name: 'Cash', member: '', month: change === 'month' ? '2031-05' : '2031-06', currency: change === 'currency' ? 'EUR' : 'USD', balance: change === 'balance' ? 900 : 1000, available: true, reserve: 200, goals: 100, commitments: 50 }] })
  renderWithSnapshot(<ForecastPanel snapshot={s} />, s, { client })
}

it('imports only on click, retains other assumptions and explains the imported source after edits', () => {
  setup()
  const starting = screen.getByLabelText(`${t('financialQuestions.forecast.starting')} (USD)`)
  expect(starting).toHaveValue('')
  fireEvent.change(screen.getByLabelText(`${t('financialQuestions.forecast.income')} (USD)`), { target: { value: '777' } })
  fireEvent.click(screen.getByRole('button', { name: t('financialQuestions.forecast.useConfirmed') }))
  expect(starting).toHaveValue('850')
  expect(screen.getByLabelText(`${t('financialQuestions.forecast.reserve')} (USD)`)).toHaveValue('200')
  expect(screen.getByLabelText(`${t('financialQuestions.forecast.income')} (USD)`)).toHaveValue('777')
  expect(screen.getByRole('status')).toHaveTextContent('2031-06-30')
  fireEvent.change(starting, { target: { value: '800' } })
  expect(starting).toHaveValue('800')
  expect(screen.getByRole('status')).toHaveTextContent('editable')
})
it.each(['month', 'currency', 'balance', 'coverage'] as const)('refuses incompatible %s confirmations with visible guidance', change => {
  setup(change)
  expect(screen.queryByRole('button', { name: t('financialQuestions.forecast.useConfirmed') })).toBeNull()
  expect(screen.getByText(t('financialQuestions.forecast.confirmUnavailable'))).toBeInTheDocument()
})

it('formats money while keeping an empty forecast field empty', () => {
  setup()
  const starting = screen.getByLabelText(`${t('financialQuestions.forecast.starting')} (USD)`)
  fireEvent.change(starting, { target: { value: '1234567' } })
  expect(starting).toHaveValue('1,234,567')
  fireEvent.change(starting, { target: { value: '' } })
  expect(starting).toHaveValue('')
})

it('identifies an excessive income reduction and accepts the 100% boundary', () => {
  setup()
  fireEvent.click(screen.getByText(t('financialQuestions.forecast.stressControls')))
  const reduction = screen.getByLabelText(t('financialQuestions.forecast.incomeLossPct'))
  fireEvent.change(reduction, { target: { value: '101' } })
  fireEvent.blur(reduction)
  expect(reduction).toHaveAttribute('aria-invalid', 'true')
  expect(reduction).toHaveAccessibleDescription(t('financialQuestions.forecast.invalidInputs'))
  fireEvent.change(reduction, { target: { value: '100' } })
  expect(reduction).not.toHaveAttribute('aria-invalid')
  expect(screen.getByLabelText(`${t('financialQuestions.forecast.reserve')} (USD)`)).toHaveValue('0')
})
