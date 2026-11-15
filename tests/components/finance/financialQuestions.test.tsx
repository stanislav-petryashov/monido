import { fireEvent, screen } from '@testing-library/react'
import { ForecastPanel } from '../../../src/components/finance/ForecastPanel'
import { makeSnapshot } from '../../helpers/snapshot'
import { renderWithSnapshot, stubPrivacyOn, stubSnapshotFetch } from '../../helpers/render'
import { t } from '../../../src/i18n/client'

vi.mock('../../../src/components/charts/echarts', () => import('../../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../../helpers/echartsStub'))
beforeEach(stubSnapshotFetch)

it('asks for a starting cash assumption and calculates a scenario after valid input', () => {
  renderWithSnapshot(<ForecastPanel snapshot={makeSnapshot()} />, makeSnapshot())
  expect(screen.getByText(t('financialQuestions.forecast.needInputs'))).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText(`${t('financialQuestions.forecast.starting')} (USD)`), { target: { value: '1000' } })
  fireEvent.change(screen.getByLabelText(`${t('financialQuestions.forecast.income')} (USD)`), { target: { value: '100' } })
  fireEvent.change(screen.getByLabelText(`${t('financialQuestions.forecast.expense')} (USD)`), { target: { value: '200' } })
  expect(screen.getByText(t('financialQuestions.forecast.results'))).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: t('financialQuestions.forecast.reset') }))
  expect(screen.getByText(t('financialQuestions.forecast.needInputs'))).toBeInTheDocument()
})

it('does not render financial input values or category names in privacy mode', () => {
  stubPrivacyOn()
  const s = makeSnapshot()
  const { container } = renderWithSnapshot(<><ForecastPanel snapshot={s} /></>, s)
  expect(container.querySelector('input')).toBeNull()
  expect(container.querySelector('canvas')).toBeNull()
  expect(container.textContent).not.toContain('1000')
})


it('reports invalid scenario bounds without presenting a financial result', () => {
  renderWithSnapshot(<ForecastPanel snapshot={makeSnapshot()} />, makeSnapshot())
  for (const [key, value] of [['starting', '1000'], ['income', '100'], ['expense', '80'], ['incomeLossPct', '101']]) {
    fireEvent.change(screen.getByLabelText(`${t(`financialQuestions.forecast.${key}`)}${key === 'incomeLossPct' ? '' : ' (USD)'}`), { target: { value } })
  }
  expect(screen.getByText(t('financialQuestions.forecast.invalidInputs'))).toBeInTheDocument()
  expect(screen.queryByText(t('financialQuestions.forecast.results'))).toBeNull()
})

