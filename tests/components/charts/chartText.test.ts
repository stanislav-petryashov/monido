import { describe, expect, it } from 'vitest'
import { fitAxisLabels, wrapChartText } from '../../../src/components/charts/chartText'

describe('fitAxisLabels', () => {
  it('drops the label that would run into a placed one, the edges placed first (the 2026-11-17 overlaps)', () => {
    // "Sept. '25" grows right from the left edge and met "Okt." 28 units further
    const labels = [
      { x: 0, text: "Sept. '25", anchor: 'start' as const },
      { x: 28, text: 'Okt.', anchor: 'middle' as const },
      { x: 120, text: 'Jan.', anchor: 'middle' as const },
      { x: 200, text: 'Apr.', anchor: 'end' as const },
    ]
    expect(fitAxisLabels(labels).map(l => l.text)).toEqual(["Sept. '25", 'Jan.', 'Apr.'])
  })

  it('keeps every label when there is room, and the last over its neighbour when they meet', () => {
    const spaced = [0, 100, 200].map(x => ({ x, text: 'Mai', anchor: 'middle' as const }))
    expect(fitAxisLabels(spaced)).toHaveLength(3)
    const crowded = [{ x: 0, text: 'août', anchor: 'middle' as const }, { x: 80, text: "août '28", anchor: 'middle' as const }, { x: 110, text: "nov. '28", anchor: 'end' as const }]
    expect(fitAxisLabels(crowded).map(l => l.text)).toEqual(['août', "nov. '28"])
  })
})

describe('wrapChartText', () => {
  it('keeps every character across the lines', () => {
    expect(wrapChartText('Assets of 1 000 000 that month', 96).join('')).toBe('Assets of 1 000 000 that month')
  })
})
