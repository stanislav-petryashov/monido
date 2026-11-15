import { screen, within } from '@testing-library/react'
import { assetChanges } from '../../src/domain/assetChanges'
import { ChangeWaterfall } from '../../src/pages/assets/ChangeWaterfall'
import { Assets } from '../../src/pages/Assets'
import { renderWithSnapshot as renderPage, stubPrivacyOn, stubSnapshotFetch } from '../helpers/render'
import { mockupMonth } from '../helpers/assets'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

beforeEach(() => { stubSnapshotFetch() })

const chart = () => screen.getByRole('img', { name: /The change of the assets holding by holding/ })
const rows = () => [...chart().querySelectorAll('.wf__row')]
const names = () => rows().map(r => r.querySelector('.wf__n')!.textContent)

describe('Change waterfall', () => {
  it('runs from the start total to the end total, named in its label', () => {
    renderPage(<Assets />, mockupMonth())
    expect(chart()).toHaveAccessibleName('The change of the assets holding by holding, from $1,141,971 to $1,144,127')
    const values = [...chart().querySelectorAll('.wf__v')].map(v => v.textContent)
    expect(values[0]).toBe('$1,141,971')
    expect(values.at(-1)).toBe('$1,144,127')
    expect(chart().querySelector('.wf__tick--now')).not.toBeNull()
    expect(screen.getByText('May 2031 → June 2031 · +$2,156')).toBeInTheDocument()
  })

  it('a holding without a rate at the start counts like an opened one: the waterfall still ends at the headline', () => {
    const s = mockupMonth()
    s.previousCapital = { ...s.previousCapital!, accounts: s.previousCapital!.accounts.map(a => (a.name === 'Rheinau Bank' ? { ...a, valueBase: null } : a)) }
    const changes = assetChanges(s, 'month')!
    expect(changes.endTotal).toBe(assetChanges(mockupMonth(), 'month')!.endTotal)
    expect(changes.startTotal + changes.change).toBeCloseTo(changes.endTotal, 2)
    expect(changes.holdings.find(h => h.name === 'Rheinau Bank')).toMatchObject({ startNoRate: true, noRate: false, startBase: 0, change: 10723 })
    renderPage(<Assets />, s)
    expect(screen.queryByRole('img', { name: /The change of the assets holding by holding/ })).toBeNull()
    expect(screen.getAllByText('Some asset values are unavailable for this period.').length).toBeGreaterThan(0)
  })

  it('lists each holding by its change, largest gain first', () => {
    renderPage(<Assets />, mockupMonth())
    expect(names()).toEqual(['Harborline Checking', 'Granite Peak 401(k)', 'Silverleaf 401(k)', 'Kestrel Brokerage', 'Bluefinch Savings', 'Rheinau Bank', 'House on Maple Street', 'Apartment in Leipzig'])
  })

  it('names a move of the rate alone, shows a zero without a bar, paints each bar in its map tone', () => {
    renderPage(<Assets />, mockupMonth())
    const row = (name: string) => rows().find(r => r.querySelector('.wf__n')!.textContent === name)!
    expect(row('Apartment in Leipzig')).toHaveTextContent('−$2,024 · rate')
    expect(row('Harborline Checking')).toHaveTextContent('+$1,720')
    expect(row('Harborline Checking')).not.toHaveTextContent('rate')
    expect(row('House on Maple Street').querySelector('.wf__bar')).toBeNull()
    expect(row('House on Maple Street')).toHaveTextContent('$0')
    expect(row('Apartment in Leipzig').querySelector('.wf__bar')).toHaveClass('asset-tone--re-2')
    expect(row('Granite Peak 401(k)').querySelector('.wf__bar')).toHaveClass('asset-tone--br')
    expect(row('Bluefinch Savings').querySelector('.wf__bar')).toHaveClass('asset-tone--bk-2')
  })

  it('keeps the bars inside the frame', () => {
    renderPage(<Assets />, mockupMonth())
    const width = Number(chart().getAttribute('viewBox')!.split(' ')[2])
    for (const bar of chart().querySelectorAll('.wf__bar')) {
      const x = Number(bar.getAttribute('x')), w = Number(bar.getAttribute('width'))
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x + w).toBeLessThanOrEqual(width)
    }
  })

  it('keeps a long rouble label inside the frame', () => {
    const changes = assetChanges(mockupMonth(), 'month')!
    // a rouble-sized amount: "+₽17,200,000 · rate" and the like
    const rub = (v: number) => `${v < 0 ? '−' : ''}₽${Math.abs(Math.round(v * 10000)).toLocaleString('en-US')}`
    renderPage(<ChangeWaterfall changes={changes} endMonth="2031-06" fmt={rub} />, mockupMonth())
    const width = Number(chart().getAttribute('viewBox')!.split(' ')[2])
    expect(chart()).toHaveTextContent('−₽20,240,000 · rate')
    for (const v of chart().querySelectorAll('.wf__v')) {
      expect(Number(v.getAttribute('x')) + v.textContent!.length * 7, v.textContent!).toBeLessThanOrEqual(width)
    }
  })

  it('is not drawn without a period', () => {
    renderPage(<Assets />, mockupMonth({ previousCapital: null }))
    expect(screen.queryByRole('img', { name: /The change of the assets/ })).toBeNull()
  })

  it('masks the amounts in privacy mode', () => {
    stubPrivacyOn()
    renderPage(<Assets />, mockupMonth())
    expect(chart().textContent).not.toMatch(/\d,\d{3}/)
  })
})


describe('Phone asset contributions', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))))
  afterEach(() => vi.unstubAllGlobals())

  it('groups signs, sorts by impact, preserves zeroes and uses one scale and the map tones', () => {
    const snapshot = mockupMonth()
    const changes = assetChanges(snapshot, 'month')!
    const { container } = renderPage(<Assets />, snapshot)
    const decreases = screen.getByRole('region', { name: 'Decreased value' })
    expect(within(decreases).getAllByRole('listitem')[0]).toHaveTextContent('Apartment in Leipzig')
    expect(decreases).toHaveTextContent('rate')
    expect(screen.getByRole('region', { name: 'Unchanged' })).toHaveTextContent('House on Maple Street')
    const items = [...container.querySelectorAll('.contributions__row')]
    expect(items).toHaveLength(changes.holdings.filter(h => !h.noRate).length)
    const max = Math.max(...changes.holdings.map(h => Math.abs(h.change)))
    for (const item of items) {
      const holding = changes.holdings.find(h => item.querySelector('.contributions__name')!.textContent!.startsWith(h.name))!
      const bar = item.querySelector('i')!
      expect(parseFloat(bar.style.width)).toBeCloseTo(Math.abs(holding.change) / max * 100)
      expect(bar.className).toMatch(/^asset-tone--/)
    }
    expect(container.querySelector('.contributions__totals')).toHaveTextContent('$1,141,971')
    expect(container.querySelector('.contributions__totals')).toHaveTextContent('$1,144,127')
    expect(container.querySelector('.wf')).toBeNull()
  })

  it('masks mobile amounts in privacy mode', () => {
    stubPrivacyOn()
    const { container } = renderPage(<Assets />, mockupMonth())
    expect(container.querySelector('.contributions')!.textContent).not.toMatch(/\d,\d{3}/)
  })
})
