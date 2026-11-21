import { readCss, rule } from '../helpers/css'

const css = readCss('src/styles/overview.css')
const wchart = readCss('src/styles/wchart.css')

describe('the Overview stylesheet', () => {
  it('lets the family panels fit a phone width', () => {
    expect(rule(css, '.overview-family-cards')).toMatch(/minmax\(min\(100%, 355px\), 1fr\)/)
  })

  it('strokes the window chart\'s last segment in the primary and tints its band', () => {
    expect(rule(wchart, '.wchart__now')).toMatch(/stroke:\s*var\(--primary\)/)
    expect(rule(wchart, '.wchart__band')).toMatch(/fill:\s*var\(--primary-16\)/)
  })

  it('lets the text-sized window frame determine its height without shrinking labels', () => {
    const chart = rule(readCss('src/styles/record-charts.css'), '.gl-chart, .ln-chart, .re-chart, .wchart, .cfband, .cf-detail__chart, .ln-ends__chart, .acc-flows')
    expect(chart).toMatch(/width:\s*100%/)
    expect(chart).toMatch(/height:\s*auto/)
    expect(chart).not.toMatch(/max-height:/)
    expect(rule(wchart, '.wchart__tagText')).toMatch(/font-size:\s*12px/)
    for (const label of ['.wchart__tickLabel', '.wchart__x']) {
      const labels = [...readCss('src/styles/record-charts.css').matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selectors]) => selectors.split(',').map(s => s.trim()).includes(label))
      expect(labels?.[2]).toMatch(/font-size:\s*12px/)
    }
  })

  it('keeps the complete goal name readable below or beside its ring', () => {
    expect(rule(css, '.rings__name')).not.toMatch(/line-clamp|overflow:\s*hidden/)
    expect(rule(css, '.rings__name')).toMatch(/overflow-wrap:\s*anywhere/)
    expect(rule(css, '.rings__name')).not.toMatch(/nowrap/)
  })
})
