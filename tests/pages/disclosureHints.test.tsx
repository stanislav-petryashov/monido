import { screen } from '@testing-library/react'
import { Assets } from '../../src/pages/Assets'
import { CashFlow } from '../../src/pages/CashFlow'
import { Goals } from '../../src/pages/Goals'
import { flowsSnapshot, makeSnapshot } from '../helpers/snapshot'
import { goalsSnapshot } from '../helpers/goals'
import { renderWithSnapshot as renderPage, stubSnapshotFetch } from '../helpers/render'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))


const hintOf = (title: string) => screen.getByRole('heading', { name: new RegExp(`^${title}`) }).closest('summary')!.querySelector('.disclosure__hint')?.textContent

beforeEach(() => { stubSnapshotFetch() })
afterEach(() => { localStorage.clear() })

describe('hints in the rows', () => {
  it('History says how long the history is, gaps included, not the chart period', () => {
    const base = makeSnapshot()
    const history = [{ ...base.history[0]!, date: '2030-01-31' }, { ...base.history[0]!, date: '2030-03-31' }, { ...base.history[0]!, date: '2030-12-31' }]
    renderPage(<Assets />, makeSnapshot({ history }))
    expect(hintOf('History')).toBe('12 months, since Jan 2030')
  })







  it('Income and expenses keeps one closed row, the forecast, with no hint', () => {
    renderPage(<CashFlow />, flowsSnapshot())
    expect([...document.querySelectorAll('summary')].map(x => x.textContent)).toEqual(['Will available money cover the coming months?'])
    expect(hintOf('Will available money cover')).toBeUndefined()
  })

  it('Forecasts sets the growth against the pace the goal needs, and says nothing without either', () => {
    // the Forecasts row is independence's
    window.history.replaceState(null, '', '/goals?goal=fire')
    const base = goalsSnapshot()
    const fire = base.goals.fire!
    const view = renderPage(<Goals />, { ...base, goals: { ...base.goals, fire: { ...fire, actualCagr: 0.128, requiredCagr: 0.176 } } })
    expect(hintOf('Forecasts')).toMatch(/^\+[\d.]+% a year, \+17\.6% needed$/)
    view.unmount()
    renderPage(<Goals />, { ...base, goals: { ...base.goals, fire: { ...fire, actualCagr: 0.128, requiredCagr: null } } })
    expect(hintOf('Forecasts')).toBeUndefined()
    window.history.replaceState(null, '', '/')
  })


})
