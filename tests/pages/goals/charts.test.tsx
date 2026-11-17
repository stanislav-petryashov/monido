// The Goals charts: how a goal accumulates (independence with its strategies) and how the goals share the saving, the
// table in cents, tracking off and privacy. The demo family on 12.11.2026 (tests/helpers/goals.ts).
import { fireEvent, screen, within } from '@testing-library/react'
import { Goals } from '../../../src/pages/Goals'
import { DEMO_GOALS, goalsSnapshot, GOALS_TODAY } from '../../helpers/goals'
import { renderWithSnapshot, stubPrivacyOn, stubSnapshotFetch } from '../../helpers/render'

beforeEach(() => {
  stubSnapshotFetch()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(GOALS_TODAY)
  window.history.replaceState(null, '', '/goals')
})
afterEach(() => {
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

const card = (title: RegExp) => screen.getByRole('heading', { name: title }).closest('section')!
const accumulation = () => card(/^(How it accumulates|When it is reached)$/)
const shares = () => card(/^How the goals share/)

describe('how a goal accumulates', () => {
  it('the cushion: the amount by the deadline, the month reached and the pace in the key', () => {
    renderWithSnapshot(<Goals />, goalsSnapshot())
    const svg = accumulation().querySelector('svg')!
    expect(svg).toHaveTextContent('$54,230 by the deadline')
    expect(svg).toHaveTextContent('05/2028')
    expect(svg).toHaveTextContent('deadline 12/2027')
    expect(svg.querySelector('.gl-chart__plan')).not.toBeNull()
    expect(svg.querySelector('.gl-chart__held')).not.toBeNull()
    expect(accumulation().querySelector('.gl-key')).toHaveTextContent('to make 12/2027: $2,385 a month')
    // violet only on today
    expect(svg.querySelectorAll('.gl-chart__today, .gl-chart__now')).toHaveLength(2)
  })

  it('independence: the forecast at 8% and the 5–11% return range with their months; no fixed +500 line', () => {
    window.history.replaceState(null, '', '/goals?goal=fire')
    renderWithSnapshot(<Goals />, goalsSnapshot())
    const key = accumulation().querySelector('.gl-key')!
    expect(key).toHaveTextContent('forecast at 8%: 05/2046')
    expect(key).not.toHaveTextContent('a month:')
    // the band: earlier at 11% than at 8%, later at 5%
    expect(key).toHaveTextContent('5–11% return: 07/2042 – 01/2053')
    expect(accumulation().querySelector('svg')).toHaveTextContent('$1,190,083 by the deadline')
  })

  it('a reached independence goal: «reached» in the key, never «not reached»', () => {
    window.history.replaceState(null, '', '/goals?goal=fire')
    renderWithSnapshot(<Goals />, goalsSnapshot({ goals: DEMO_GOALS.map(g => (g.id === 'fire' ? { ...g, current: g.target } : g)) }))
    const key = accumulation().querySelector('.gl-key')!
    expect(key).not.toHaveTextContent('not reached')
    expect(key).toHaveTextContent('5–11% return: reached – reached')
  })

  it('tracking off draws only the pace line', () => {
    const { container } = renderWithSnapshot(<Goals />, goalsSnapshot({ track: false }))
    const svg = accumulation().querySelector('svg')!
    expect(svg.querySelector('.gl-chart__pace')).not.toBeNull()
    expect(svg.querySelector('.gl-chart__plan, .gl-chart__held, .gl-chart__dot')).toBeNull()
    expect(container.querySelector('.gl-table')).toBeNull()
  })

  it('privacy masks the labels and the titles; the months stay', () => {
    stubPrivacyOn()
    renderWithSnapshot(<Goals />, goalsSnapshot())
    expect(accumulation()).not.toHaveTextContent(/\$\d/)
    expect(accumulation()).toHaveTextContent('••• by the deadline')
    expect(accumulation()).toHaveTextContent('05/2028')
    expect(shares()).not.toHaveTextContent(/\$\d/)
    expect([...shares().querySelectorAll('rect title')].every(t => !/\$\d/.test(t.textContent ?? ''))).toBe(true)
  })
})

describe('how the goals share the saving', () => {
  it('24 months of bars that add up to the saving, the chosen goal in ink', () => {
    renderWithSnapshot(<Goals />, goalsSnapshot())
    expect(screen.getByRole('heading', { name: 'How the goals share $2,141 a month' })).toBeInTheDocument()
    const bars = shares().querySelectorAll('svg g')
    expect(bars).toHaveLength(24)
    expect(shares().querySelectorAll('rect.gl-sh--sel').length).toBeGreaterThan(0)
    // independence first gets money in 05.2028, the 18th bar
    expect(bars[16].querySelector('rect title')?.textContent).not.toMatch(/independence/)
    expect([...bars[17].querySelectorAll('rect title')].some(t => /^Financial independence by 55: \$1,934, May 2028$/.test(t.textContent ?? ''))).toBe(true)
  })

  it('the table in cents adds up: needed 13 939,25, gets now 2 140,76, 11 798,49 short', () => {
    renderWithSnapshot(<Goals />, goalsSnapshot())
    const rows = [...shares().querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('td')].map(c => c.textContent))
    expect(rows).toEqual([
      ['Trip to Japan', '$933.33', '$933.33', '—', '05/2027'],
      ['Emergency fund (6 months)', '$2,384.62', '$1,207.43', 'from 06/2027: $2,141', '05/2028'],
      ['Financial independence by 55', '$10,621.30', '$0.00', 'from 05/2028: $2,141', '05/2046 at 8%'],
      ['Total', '$13,939.25', '$2,140.76', '', '$11,798.49 short'],
    ])
  })

  it('a row selects its goal', () => {
    renderWithSnapshot(<Goals />, goalsSnapshot())
    fireEvent.click(within(shares()).getByRole('button', { name: 'Financial independence by 55' }))
    expect(window.location.search).toBe('?goal=fire')
    expect(screen.getByRole('heading', { name: 'When it is reached' })).toBeInTheDocument()
  })

  it('tracking off: one sentence with each goal\'s need, no bars and no 0', () => {
    renderWithSnapshot(<Goals />, goalsSnapshot({ track: false }))
    const off = card(/^How the goals share the savings$/)
    expect(off).toHaveTextContent('The goals need a month: $933 for Trip to Japan, $2,385 for Emergency fund (6 months), $10,621 for Financial independence by 55.')
    expect(off.querySelector('svg')).toBeNull()
  })
})
