import { fireEvent, screen, within } from '@testing-library/react'
import { Assets } from '../../src/pages/Assets'
import { shiftMonth } from '../../src/domain/dates'
import type { FinanceSnapshot } from '../../src/domain/types'
import { renderWithSnapshot as renderPage, stubSnapshotFetch } from '../helpers/render'
import { mockupMonth } from '../helpers/assets'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

beforeEach(() => { stubSnapshotFetch() })
afterEach(() => { window.history.replaceState(null, '', '/') })

const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0)).toISOString().slice(0, 10)

/** Forty months up to June 2031, the assets growing by 1 000 a month to the mock-up's total; every period has a start */
function withHistory(): FinanceSnapshot {
  const base = mockupMonth()
  const history = Array.from({ length: 40 }, (_, i) => {
    const date = lastDay(shiftMonth('2031-06', i - 39))
    const assets = 1144127 - (39 - i) * 1000
    return { date, assets, liabilities: 0, netWorth: assets }
  })
  const at = (ym: string) => ({ ...base.previousCapital!, date: lastDay(ym) })
  return { ...base, history, capitalCoverage: history.map(p => ({ month: p.date.slice(0, 7), assetsKnown: true, liquidKnown: true, capitalKnown: true, missingAccounts: [] })), capitalBack: { quarter: at('2031-03'), year: at('2030-06'), all: at('2028-03') } }
}

const card = () => screen.getByRole('region', { name: /^Assets over/ })
const pick = (name: string) => fireEvent.click(within(screen.getByRole('group', { name: 'Period of the changes' })).getByRole('button', { name }))
/** The x of each point of the line */
const xs = () => card().querySelector('.wchart__past')!.getAttribute('points')!.split(' ').map(p => Number(p.split(',')[0]))

describe('Assets history card', () => {
  it('shows six months around the month, the month shaded from its start', () => {
    renderPage(<Assets />, withHistory())
    expect(within(card()).getByRole('heading')).toHaveTextContent('Assets over 6 months')
    expect(card()).toHaveTextContent('since January 2031')
    expect(within(card()).getByRole('img')).toHaveAccessibleName('6 months to June 2031')
    const span = card().querySelector('.wchart__span')!
    const x = Number(span.getAttribute('x'))
    // the span starts just before May, the period's start, and after April
    expect(x).toBeLessThan(xs()[4])
    expect(x).toBeGreaterThan(xs()[3])
    expect(card().querySelector('.wchart__spanLabel')).toHaveTextContent('+$2,156 over the month')
  })

  it('draws in the broad frame across the card', () => {
    renderPage(<Assets />, withHistory())
    expect(within(card()).getByRole('img').getAttribute('viewBox')).toBe('0 0 1100 260')
  })

  it('keeps the gridline labels apart on a narrow scale', () => {
    renderPage(<Assets />, withHistory())
    const labels = [...card().querySelectorAll('.wchart__tickLabel')].map(l => l.textContent)
    expect(labels.length).toBeGreaterThanOrEqual(3)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toContain('$1.135M')
  })

  it('widens the window with the period: 12 for the quarter, 2 years for the year, 36 months for all time unshaded', () => {
    renderPage(<Assets />, withHistory())
    pick('Quarter')
    expect(within(card()).getByRole('img')).toHaveAccessibleName('12 months to June 2031')
    pick('Year')
    expect(within(card()).getByRole('heading')).toHaveTextContent('Assets over 2 years')
    expect(within(card()).getByRole('img')).toHaveAccessibleName('24 months to June 2031')
    pick('All time')
    expect(within(card()).getByRole('heading')).toHaveTextContent('Assets over 36 months')
    expect(within(card()).getByRole('img')).toHaveAccessibleName('36 months to June 2031')
    expect(card().querySelector('.wchart__span')).toBeNull()
  })

  it('opens the History disclosure from its link', () => {
    renderPage(<Assets />, withHistory())
    const link = within(card()).getByRole('link', { name: /Detailed history/ })
    expect(link).toHaveAttribute('href', '#history')
    fireEvent.click(link)
    const details = document.getElementById('history') as HTMLDetailsElement
    expect(details.open).toBe(true)
    expect(document.activeElement).toBe(details)
  })
})

it('explains a gap and does not shade a change across it', () => {
  const s = withHistory()
  s.history = s.history.filter(p => p.date.slice(0, 7) !== '2031-04')
  renderPage(<Assets />, s)
  expect(card()).toHaveTextContent('Some asset values are unavailable for this period.')
  expect(card().querySelector('.wchart__span')).toBeNull()
})
