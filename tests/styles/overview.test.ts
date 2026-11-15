import { readCss, rule } from '../helpers/css'

const css = readCss('src/styles/overview.css')
const wchart = readCss('src/styles/wchart.css')
const tokens = readCss('src/styles/tokens.css')

describe('the Overview stylesheet', () => {
  it('leaves the current year of the comb on the plain paper and strokes the months grey, the selected one primary', () => {
    expect(css).not.toMatch(/\.comb__year--current\s*\{[^}]*background/)
    expect(rule(css, '.comb__year')).toMatch(/background:\s*var\(--paper\)/)
    expect(rule(css, '.comb__bar')).toMatch(/background:\s*var\(--bar-soft\)/)
    expect(rule(css, '.comb__stroke:hover:not(:disabled) .comb__bar')).toMatch(/background:\s*var\(--bar\)/)
    expect(rule(css, '.comb__stroke[aria-pressed="true"] .comb__bar')).toMatch(/background:\s*var\(--primary\)/)
    expect(rule(css, '.comb__stroke--none .comb__bar')).toMatch(/background:\s*transparent/)
  })

  it('draws the open month as a dashed primary outline', () => {
    expect(rule(css, '.comb__stroke--open .comb__bar')).toMatch(/dashed var\(--primary\)/)
  })

  it('makes every stroke a full-height transparent button with the bar drawn inside it, the focus ring on the button', () => {
    expect(rule(css, '.comb__strokes')).toMatch(/height:\s*34px/)
    expect(rule(css, '.comb__strokes')).toMatch(/align-items:\s*stretch/)
    const stroke = rule(css, '.comb__stroke')
    expect(stroke).toMatch(/background:\s*transparent/)
    expect(stroke).not.toMatch(/height:/)
    expect(rule(css, '.comb__stroke:focus-visible')).toMatch(/outline:\s*2px solid var\(--primary\)/)
  })

  it('strokes the window chart\'s last segment in the primary and tints its band', () => {
    expect(rule(wchart, '.wchart__now')).toMatch(/stroke:\s*var\(--primary\)/)
    expect(rule(wchart, '.wchart__band')).toMatch(/fill:\s*var\(--primary-16\)/)
  })

  it('lays the net-worth block out in two columns: the figures and the bridge on the left, the chart across both rows', () => {
    const nw = rule(css, '.nw')
    expect(nw).toMatch(/display:\s*grid/)
    expect(nw).toMatch(/grid-template-columns:\s*300px minmax\(0, 1fr\)/)
    expect(nw).toMatch(/grid-template-areas:\s*"head chart" "bridge chart"/)
    expect(nw).toMatch(/gap:\s*var\(--sp-3\)/)
    expect(rule(css, '.nw .bridge-block')).toMatch(/align-self:\s*end/)
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

  it('puts the block in one column on narrow screens and hides the gridline labels on a phone', () => {
    expect(css).toMatch(/@media \(max-width: 1279px\)\s*\{\s*\.nw\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/)
    expect(wchart).toMatch(/@media \(max-width: 640px\)\s*\{\s*\.wchart__tickLabel\s*\{\s*display:\s*none/)
  })

  it('keeps the module cards off the net-worth card when there is no KPI row: the grid has its own top margin', () => {
    expect(rule(css, '.overview-grid')).toMatch(/margin:\s*var\(--sp-3\) 0/)
  })

  it('keeps the complete goal name readable below or beside its ring', () => {
    expect(rule(tokens, '.rings__name')).not.toMatch(/line-clamp|overflow:\s*hidden/)
    expect(rule(tokens, '.rings__name')).toMatch(/overflow-wrap:\s*anywhere/)
    expect(rule(tokens, '.rings__name')).not.toMatch(/nowrap/)
  })
})
