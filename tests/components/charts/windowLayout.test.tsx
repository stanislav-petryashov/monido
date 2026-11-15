import { monthWindow } from '../../../src/domain/overviewBlocks'
import { WindowChart } from '../../../src/pages/overview/WindowChart'
import { renderWithClient } from '../../helpers/render'

describe('window chart scale layout', () => {
  it.each([
    [23_500_000, 26_300_000],
    [-4_000_000, -1_000_000],
    [5, 9],
    [50_000_000, 50_000_000],
  ])('keeps a readable grid for %s to %s without changing the history', (first, last) => {
    const history = [first, last].map((netWorth, i) => ({ date: `2026-0${i + 1}-28`, netWorth, assets: netWorth, liabilities: 0 }))
    const window = monthWindow(history, '2026-02')
    const original = structuredClone(window)
    const { container } = renderWithClient(<WindowChart window={window} fmtCompact={String} value={String(last)} label="History" />)
    const lines = [...container.querySelectorAll('.wchart__tick')].map(e => Number(e.getAttribute('y1')))
    expect(lines.length).toBeLessThanOrEqual(5)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.every((y, i) => i === 0 || lines[i - 1] - y >= 20)).toBe(true)
    expect(window).toEqual(original)
    const points = container.querySelector('.wchart__past')!.getAttribute('points')!.split(' ').map(p => Number(p.split(',')[1]))
    expect(points.every(y => y >= Math.min(...lines) - 0.1 && y <= Math.max(...lines) + 0.1)).toBe(true)
  })
})

it('does not connect or scale through an unavailable month', () => {
  const history = [100, 999, 120].map((assets, i) => ({ date: `2031-0${i + 8}-28`, assets, netWorth: assets, liabilities: 0 }))
  history[2].date = '2031-10-28'
  const window = monthWindow(history, '2031-10', 3, 'assets')
  const { container } = renderWithClient(<WindowChart window={window} fmtCompact={String} value="120" label="History" field="assets" unavailableMonths={['2031-09']} />)
  expect(container.querySelectorAll('.wchart__past, .wchart__now')).toHaveLength(0)
  expect(container.textContent).not.toContain('999')
  expect(container.querySelectorAll('.wchart__chg')).toHaveLength(0)
})

it('spaces observations by calendar distance across an unobserved month', () => {
  const history = ['08', '10', '11'].map((m, i) => ({ date: `2031-${m}-28`, assets: 100 + i * 10, netWorth: 100 + i * 10, liabilities: 0 }))
  const window = monthWindow(history, '2031-11', 3, 'assets')
  const { container } = renderWithClient(<WindowChart window={window} fmtCompact={String} value="120" label="History" field="assets" calendar unavailableMonths={[]} />)
  const labels = [...container.querySelectorAll('.wchart__x')]
  const x = labels.map(e => Number(e.getAttribute('x')))
  expect(x[1] - x[0]).toBeCloseTo(2 * (x[2] - x[1]), 0)
  expect(container.querySelectorAll('.wchart__past')).toHaveLength(1)
  expect(container.querySelector('.wchart__past')!.getAttribute('points')!.split(' ')).toHaveLength(2)
})

it('does not leak the selected tag through its overflow caption when unavailable', () => {
  const history = [{ date: '2031-08-31', assets: 100, netWorth: 100, liabilities: 0 }, { date: '2031-09-30', assets: 999, netWorth: 999, liabilities: 0 }]
  const window = monthWindow(history, '2031-09', 2, 'assets')
  const value = 'secret '.repeat(200)
  const { container } = renderWithClient(<WindowChart window={window} fmtCompact={String} value={value} label="History" field="assets" unavailableMonths={['2031-09']} />)
  expect(container.textContent).not.toContain('secret')
})
