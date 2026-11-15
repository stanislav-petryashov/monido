import { screen } from '@testing-library/react'
import { Goals } from '../../src/pages/Goals'
import { makeSnapshot } from '../helpers/snapshot'
import { goalsSnapshot } from '../helpers/goals'
import { renderWithSnapshot as renderPage, stubPrivacyOn, stubSnapshotFetch } from '../helpers/render'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

/** The local calendar of a zone three hours ahead of UTC (Moscow, Istanbul): the reads a local-time bug would make */
const AHEAD_MS = 3 * 60 * 60 * 1000

beforeEach(() => {
  stubSnapshotFetch()
  vi.useFakeTimers({ toFake: ['Date'] })
  // 31 December 22:00 UTC: already 1 January in that zone
  vi.setSystemTime(new Date('2030-12-31T22:00:00Z'))
  // the worker's own zone cannot be switched (vitest.config.ts): the local getters are made to read that zone instead
  vi.spyOn(Date.prototype, 'getFullYear').mockImplementation(function (this: Date) { return new Date(this.getTime() + AHEAD_MS).getUTCFullYear() })
  vi.spyOn(Date.prototype, 'getMonth').mockImplementation(function (this: Date) { return new Date(this.getTime() + AHEAD_MS).getUTCMonth() })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Goals counts the calendar in UTC', () => {
  it('explains the annual model assumption and the saved amount entered by hand under independence, in privacy mode', () => {
    stubPrivacyOn()
    window.history.replaceState(null, '', '/goals?goal=fire')
    const { container } = renderPage(<Goals />, goalsSnapshot())
    expect(container.querySelector('.gl-calc')).toHaveTextContent(/entered by hand.*8% a year is a model assumption, not a promise\./)
    expect(container.textContent).toContain('•••')
    expect(container.textContent).not.toMatch(/205,000|2,000,000/)
    window.history.replaceState(null, '', '/')
  })

  it('shows goal conversion and incomplete-flow warnings near the projection without category-only warnings', () => {
    const base = makeSnapshot()
    renderPage(<Goals />, makeSnapshot({ goals: { ...base.goals, items: [
      { id: 'trip', name: 'Goal capital', target: 100, current: 20, target_date: '2033-06-30', emoji: null, currency: 'XYZ', targetBase: null, currentBase: null },
    ] }, warnings: [
      { code: 'fx_unknown_currency', ref: 'goal:trip', params: { currency: 'XYZ', name: 'Goal capital' } },
      { code: 'missing_cashflow', params: { name: 'Missing flows', member: 'Robin', month: '2031-06' } },
      { code: 'fx_unknown_currency', ref: 'category:999', params: { currency: 'XYZ', name: 'Unrelated category' } },
    ] }))
    expect(screen.getByRole('status')).toHaveTextContent('Goal capital')
    expect(screen.getByRole('status')).toHaveTextContent('Missing flows')
    expect(screen.getByRole('status')).not.toHaveTextContent('Unrelated category')
  })

  it('does not show today’s unrelated fallback when there are no goals to convert', () => {
    const base = makeSnapshot()
    renderPage(<Goals />, makeSnapshot({ goals: { ...base.goals, fire: null }, warnings: [
      { code: 'fx_fallback', ref: 'XYZ 2031-07-03', params: { currency: 'XYZ', date: '2031-07-03', used: '2031-07-02' } },
    ] }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('does not attach another currency’s current-date fallback to a goal', () => {
    const base = makeSnapshot()
    renderPage(<Goals />, makeSnapshot({ goals: { ...base.goals, items: [
      { id: 'trip', name: 'Trip', target: 100, current: 0, target_date: '2033-06-30', emoji: null, currency: 'USD', targetBase: 100, currentBase: 0 },
    ] }, warnings: [
      { code: 'fx_fallback', ref: 'XYZ 2031-07-03', params: { currency: 'XYZ', date: '2031-07-03', used: '2031-07-02' } },
    ] }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
