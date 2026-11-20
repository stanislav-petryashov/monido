import { screen } from '@testing-library/react'
import { NetWorthBlock } from '../../src/pages/overview/NetWorthBlock'
import { WindowChart } from '../../src/pages/overview/WindowChart'
import { monthWindow } from '../../src/domain/overviewBlocks'
import { fmtCurrency } from '../../src/lib/formatters'
import { HIST, withHistory } from '../helpers/history'
import { renderWithSnapshot, stubPrivacyOn } from '../helpers/render'

/** What the dashboard's `fmt` writes for the fixture's USD snapshot */
const fmt = (v: number) => fmtCurrency(v, 'USD')
const snapshot = withHistory(HIST, ['2026-10'])

/** The window as a phone: every max-width query matches */
const phone = () => vi.stubGlobal('matchMedia', (query: string) =>
  ({ matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} }))
const frameWidth = (svg: Element) => Number(svg.getAttribute('viewBox')!.split(' ')[2])

const draw = (month: string) => renderWithSnapshot(<NetWorthBlock snapshot={snapshot} month={month} />, snapshot)

afterEach(() => vi.unstubAllGlobals())

describe('NetWorthBlock', () => {
  it('makes the full headline keyboard reachable with a privacy-aware name', () => {
    const large = { ...snapshot, history: snapshot.history.map(p => ({ ...p, netWorth: 150026376449 })) }
    renderWithSnapshot(<NetWorthBlock snapshot={large} month="2026-09" />, large)
    const amount = screen.getByRole('region', { name: /\$150,026,376,449/ })
    expect(amount).toHaveAttribute('tabindex', '0')
    expect(amount).toHaveTextContent('$150,026,376,449')
  })

  it('shows the selected month, its net worth, both changes and the value tag on the chart', () => {
    const { container } = draw('2026-09')
    const block = container.querySelector('section.card.nw')
    expect(block).not.toBeNull()
    expect(block!.querySelector('.figure-label')).toHaveTextContent('Net worth · September 2026')
    expect(block!.querySelector('.hl__value')).toHaveTextContent(fmt(758673))
    expect(block!.querySelector('.hl__value')).toHaveAttribute('role', 'region')
    const deltas = block!.querySelector('.nw__deltas')!
    expect(deltas).toHaveTextContent(`+${fmt(3122)} over the month`)
    expect(deltas).toHaveTextContent(`+${fmt(43278)} over the year`)
    expect(deltas.querySelector('.delta')!.className).toBe('delta num')
    expect(block!.querySelector('.wchart__tagText')).toHaveTextContent(fmt(758673))
    expect(screen.getByRole('img', { name: '13 months to September 2026' })).toHaveClass('wchart')
  })

  it('a partial month (a balance missing or without a rate) shows a dash and a note, no changes and no bridge', () => {
    const partial = { ...snapshot, capitalCoverage: [{ month: '2026-09', assetsKnown: true, liquidKnown: true, capitalKnown: false, missingAccounts: [] }] }
    const { container } = renderWithSnapshot(<NetWorthBlock snapshot={partial} month="2026-09" />, partial)
    expect(container.querySelector('.hl__value')).toHaveTextContent('—')
    expect(container.querySelector('.nw__deltas')).toHaveTextContent('')
    expect(container.querySelector('.note')).toHaveTextContent('net worth is not shown')
    expect(container.querySelector('.bridge')).toBeNull()
  })

  it('a partial month is a gap on the chart: no point, line or change through it, its value not written', () => {
    const partial = { ...snapshot, capitalCoverage: [{ month: '2026-08', assetsKnown: true, liquidKnown: true, capitalKnown: false, missingAccounts: [] }] }
    const august = snapshot.history.find(p => p.date.startsWith('2026-08'))!
    const { container } = renderWithSnapshot(<NetWorthBlock snapshot={partial} month="2026-08" />, partial)
    const chart = container.querySelector('.wchart')!
    expect(chart.querySelector('.wchart__dot')).toBeNull()
    expect(chart.querySelector('.wchart__now')).toBeNull()
    expect(chart.textContent).not.toContain(fmt(august.netWorth))
    expect(chart.querySelectorAll('.wchart__chg--now')).toHaveLength(0)
    expect(chart.querySelectorAll('.wchart__past')).toHaveLength(1)
    expect(container.querySelector('.hl__value')).toHaveTextContent('—')
  })

  it('a partial month inside the window breaks the line in two', () => {
    const partial = { ...snapshot, capitalCoverage: [{ month: '2026-05', assetsKnown: true, liquidKnown: true, capitalKnown: false, missingAccounts: [] }] }
    const { container } = renderWithSnapshot(<NetWorthBlock snapshot={partial} month="2026-09" />, partial)
    expect(container.querySelectorAll('.wchart__past')).toHaveLength(2)
    expect(container.querySelector('.wchart__dot')).not.toBeNull()
  })

  it('draws four gridlines for the window to September 2026, with compact labels, and three x labels', () => {
    const { container } = draw('2026-09')
    expect(container.querySelectorAll('.wchart__tick')).toHaveLength(4)
    expect([...container.querySelectorAll('.wchart__tickLabel')].map(n => n.textContent)).toEqual(['$700K', '$720K', '$740K', '$760K'])
    expect([...container.querySelectorAll('.wchart__x')].map(n => n.textContent)).toEqual(['Sep 2025', 'Mar 2026', 'Sep 2026'])
    expect(container.querySelector('.wchart__past')).not.toBeNull()
    expect(container.querySelector('.wchart__now')).not.toBeNull()
    expect(container.querySelector('.wchart__band')).toHaveAttribute('rx', '8')
    expect(container.querySelector('.wchart__dot')).not.toBeNull()
  })

  it("draws each month's change under the line: the selected one in the primary, the largest labelled", () => {
    const { container } = draw('2026-09')
    const cols = container.querySelectorAll('.wchart__chg')
    expect(cols.length).toBeGreaterThan(10)
    expect(container.querySelectorAll('.wchart__chg--now')).toHaveLength(1)
    expect(container.querySelector('.wchart__zero')).not.toBeNull()
    expect(container.querySelector('.wchart__chgLabel')!.textContent).toMatch(/^[+−]\$\d/)
    expect(container.querySelector('.wchart__lane')).toHaveTextContent('per month')
  })

  it('makes the label lane as wide as the longest gridline label, so long ones stay inside the frame', () => {
    const labels = (fmtCompact: (v: number) => string) => {
      document.body.innerHTML = ''
      const svg = renderWithSnapshot(<WindowChart window={monthWindow(HIST, '2026-09')} fmtCompact={fmtCompact} value="x" label="w" />, snapshot).container.querySelector('.wchart')!
      return Number(svg.querySelector('.wchart__tick')!.getAttribute('x1'))
    }
    const short = labels(v => `$${v / 1000}K`)
    const long = labels(v => `${v / 1000} thous. $`)
    expect(long).toBeGreaterThan(short)
    expect(long).toBeGreaterThanOrEqual('760 thous. $'.length * 6.4)
  })

  it('shades the highlighted period from its first point, reads the asked field and names the largest change', () => {
    const win = monthWindow(HIST, '2026-09', 13, 'assets')
    const { container } = renderWithSnapshot(
      <WindowChart window={win} fmtCompact={v => `$${v / 1000}K`} value="x" label="w" field="assets" highlight={{ from: 9, label: '+3 months' }} calendar event={(m, c) => `${m}: ${c}`} />, snapshot)
    const spans = container.querySelectorAll('.wchart__span')
    expect(spans).toHaveLength(1)
    const ticks = container.querySelectorAll('.wchart__tick')
    const left = Number(ticks[0].getAttribute('x1'))
    const step = (Number(ticks[0].getAttribute('x2')) - left) / 12
    const colW = Math.min(18, Math.max(4, step * 0.5))
    expect(Number(spans[0].getAttribute('x'))).toBeCloseTo(left + 9 * step - colW, 0)
    expect(container.querySelector('.wchart__spanLabel')).toHaveTextContent('+3 months')
    expect(container.querySelector('.wchart__band')).toBeNull()
    // the line ends at the assets, the highest gridline above them
    const dot = Number(container.querySelector('.wchart__dot')!.getAttribute('cy'))
    expect(dot).toBeGreaterThanOrEqual(Number(ticks[ticks.length - 1].getAttribute('y1')))
    const largest = win.changes.reduce<number>((best, c) => (c !== null && Math.abs(c) > Math.abs(best) ? c : best), 0)
    expect(container.querySelector('.wchart__event')).toHaveTextContent(`: ${largest}`)
    expect(container.querySelector('.wchart__chgLabel')).toBeNull()
  })

  it.each([false, true])('keeps the span inside the frame from the first point and from the last (compact: %s)', compact => {
    for (const from of [0, 12]) {
      document.body.innerHTML = ''
      const { container } = renderWithSnapshot(
        <WindowChart window={monthWindow(HIST, '2026-09', 13, 'assets')} fmtCompact={String} value="x" label="w" field="assets" highlight={{ from, label: 'p' }} compact={compact} />, snapshot)
      const svg = container.querySelector('.wchart')!
      const span = container.querySelector('.wchart__span')!
      const x = Number(span.getAttribute('x'))
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x + Number(span.getAttribute('width'))).toBeLessThanOrEqual(frameWidth(svg))
      expect(Number(span.getAttribute('width'))).toBeGreaterThan(0)
    }
  })

  it('keeps the span caption and the value tag apart when the last months are shaded', () => {
    // the Assets page's month: the last point just under the top gridline, its tag up in the band where the caption sits
    const rising = [1135500, 1137300, 1135100, 1134900, 1141971, 1144127].map((assets, i) => ({ date: `2026-0${i + 4}-28`, assets, liabilities: 0, netWorth: assets }))
    for (const [from, compact] of [[4, false], [4, true], [3, false], [5, false]] as const) {
      document.body.innerHTML = ''
      const label = '+$2,156 over the month'
      const { container } = renderWithSnapshot(
        <WindowChart window={monthWindow(rising, '2026-09', 6, 'assets')} fmtCompact={String} value="$1,144,127" label="w" field="assets" highlight={{ from, label }} compact={compact} />, snapshot)
      const text = container.querySelector('.wchart__spanLabel')!
      const tx = Number(text.getAttribute('x')), w = label.length * 7
      const cap = text.getAttribute('text-anchor') === 'end' ? { x0: tx - w, x1: tx } : { x0: tx, x1: tx + w }
      const cy = Number(text.getAttribute('y'))
      const tag = container.querySelector('.wchart__tag')!
      const t = { x0: Number(tag.getAttribute('x')), y0: Number(tag.getAttribute('y')) }
      const t1 = { x1: t.x0 + Number(tag.getAttribute('width')), y1: t.y0 + Number(tag.getAttribute('height')) }
      const meets = cap.x0 < t1.x1 && cap.x1 > t.x0 && cy - 11 < t1.y1 && cy + 3 > t.y0
      expect(meets, `from ${from}${compact ? ' compact' : ''}`).toBe(false)
    }
  })

  it('keeps the first month, with its year, on a phone and thins the rest; the last month is always named', () => {
    const { container } = renderWithSnapshot(<WindowChart window={monthWindow(HIST, '2026-09', 12, 'assets')} fmtCompact={String} value="x" label="w" field="assets" calendar compact />, snapshot)
    // Jul is two months before Sep with a label every three: it gives way, or the two meet (German Aug. × Sept., 2026-11-17)
    expect([...container.querySelectorAll('.wchart__x')].map(n => n.textContent)).toEqual(["Oct'25", "Jan'26", 'Apr', 'Sep'])
  })

  it('labels every month of a short calendar window and the years of a long one', () => {
    const xs = (size: number) => {
      document.body.innerHTML = ''
      const { container } = renderWithSnapshot(<WindowChart window={monthWindow(HIST, '2026-09', size, 'assets')} fmtCompact={String} value="x" label="w" field="assets" calendar />, snapshot)
      return [...container.querySelectorAll('.wchart__x')].map(n => n.textContent)
    }
    expect(xs(6)).toEqual(["Apr'26", 'May', 'Jun', 'Jul', 'Aug', 'Sep'])
    expect(xs(36)).toEqual(['2024', '2025', '2026'])
  })

  it('keeps the value tag inside the viewBox when the selected point sits at the right edge', () => {
    const { container } = draw('2026-09')
    const tag = container.querySelector('.wchart__tag')!
    const x = Number(tag.getAttribute('x'))
    const width = Number(tag.getAttribute('width'))
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x + width).toBeLessThanOrEqual(frameWidth(container.querySelector('.wchart')!))
  })

  it('draws the wide frame on a wide screen and the compact one on a phone, the tag inside both', () => {
    const wide = draw('2026-09').container.querySelector('.wchart')!
    expect(wide).toHaveAttribute('viewBox', '0 0 700 248')
    expect(wide).not.toHaveClass('wchart--compact')
    document.body.innerHTML = ''
    phone()
    const { container } = draw('2026-09')
    const svg = container.querySelector('.wchart')!
    expect(svg).toHaveClass('wchart--compact')
    expect(svg).toHaveAttribute('viewBox', '0 0 320 224')
    const tag = container.querySelector('.wchart__tag')!
    expect(Number(tag.getAttribute('x')) + Number(tag.getAttribute('width'))).toBeLessThanOrEqual(320)
    expect(container.querySelector('.wchart__tagText')).toHaveTextContent(fmt(758673))
  })

  it('draws the bridge of the selected month: its net worth and loans as shares of its assets, not the latest capital', () => {
    const { container } = draw('2024-09')
    const point = HIST[11]
    expect(point.netWorth).toBe(603469)
    const net = container.querySelector<HTMLElement>('.bridge__net')!
    const loans = container.querySelector<HTMLElement>('.bridge__loans')!
    expect(parseFloat(net.style.width)).toBeCloseTo((603469 / point.assets) * 100, 1)
    expect(parseFloat(loans.style.width)).toBeCloseTo((385454 / point.assets) * 100, 1)
    const row = container.querySelector('.bridge__row')!
    expect(row).toHaveTextContent(`Net worth ${fmt(603469)}`)
    expect(row).toHaveTextContent(`Loans ${fmt(385454)}`)
    expect(row).not.toHaveTextContent(fmt(snapshot.capital!.netWorth))
    expect(container.querySelector('.note')).toHaveTextContent(fmt(point.assets))
  })

  it('hides the bridge when the month has no point', () => {
    const { container } = draw('2020-01')
    expect(container.querySelector('.bridge')).toBeNull()
    expect(container.querySelector('.hl__value')).toHaveTextContent('—')
  })

  it('reads "first recorded month" for the first point and omits the year change', () => {
    const { container } = draw('2023-10')
    const deltas = container.querySelector('.nw__deltas')!
    expect(deltas).toHaveTextContent('first recorded month')
    expect(deltas).not.toHaveTextContent('over the year')
    expect(deltas.querySelector('.delta')).toBeNull()
    expect(container.querySelector('.hl__value')).toHaveTextContent(fmt(534089))
    // one point only: the window is that point, the chart still names it
    expect(screen.getByRole('img', { name: '1 month to October 2023' })).toBeInTheDocument()
  })

  it('masks the value, the tag and the bridge captions in privacy mode', () => {
    stubPrivacyOn()
    const { container } = draw('2026-09')
    const digits = (container.textContent ?? '').replace(/[^0-9]/g, '')
    expect(digits).not.toContain('758673')
    expect(container.querySelector('.hl__value')).toHaveTextContent('•••')
    expect(screen.getByRole('region', { name: '•••' })).not.toHaveAttribute('title')
    expect(container.querySelector('.wchart__tagText')).toHaveTextContent('•••')
    expect(container.querySelector('.bridge__row')).toHaveTextContent('Net worth •••')
    expect(container.querySelector('.bridge__row')).toHaveTextContent('Loans •••')
    for (const label of container.querySelectorAll('.wchart__tickLabel')) expect(label).toHaveTextContent('•••')
  })
})
