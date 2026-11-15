import { act, fireEvent, render, screen } from '@testing-library/react'
import type { EChartsType } from 'echarts/core'
import { init, use, setPlatformAPI, type EChartsCoreOption } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { AreaChart } from '../../../src/components/charts/AreaChart'
import { buildCapitalHistory } from '../../../src/lib/capitalHistory'
import { PrivacyContext } from '../../../src/lib/privacy'
import { ThemeContext } from '../../../src/lib/themeState'

interface Captured {
  option: { grid: { right: number }; xAxis: { boundaryGap: boolean; axisLabel: { showMaxLabel: boolean } }; animation: boolean; tooltip: { showContent: boolean; triggerOn: string }; aria: { label: { description: string } }; yAxis: { axisLabel: { formatter: (v: number) => string } }; series: { id: string; connectNulls: boolean; areaStyle?: unknown; data: { value: number | null }[] }[] }
  onChartReady: (chart: EChartsType) => void
  onEvents: Record<string, (event: unknown, chart: EChartsType) => void>
  replaceMerge: string[]
}
let captured: Captured
vi.mock('../../../src/components/charts/echarts', () => import('../../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => ({ default: (props: Captured) => { captured = props; return null } }))
const history = [
  { date: '2031-01-31', assets: 100, liabilities: 20, netWorth: 80 },
  { date: '2031-03-31', assets: 150, liabilities: 10, netWorth: 140 },
]
const props = { model: buildCapitalHistory(history, null, 'amount'), visibleSeries: ['capital', 'assets', 'liabilities'] as ('capital' | 'assets' | 'liabilities')[], selectedMonth: '2031-03', onSelectMonth: vi.fn(), height: 240 }
let frames: Map<number, FrameRequestCallback>, nextFrame: number
beforeEach(() => {
  frames = new Map(); nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++nextFrame, cb); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
function flush() { act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(0)) }) }
function fakeChart() {
  const listeners = new Map<string, () => void>()
  const chart = { isDisposed: () => false, convertToPixel: () => 90, getHeight: () => 240, containPixel: () => true,
    on: (name: string, cb: () => void) => listeners.set(name, cb), off: (name: string) => listeners.delete(name),
    dispatchAction: vi.fn(() => listeners.get('finished')?.()) }
  return { chart: chart as unknown as EChartsType, listeners, dispatch: chart.dispatchAction }
}
it('plots actual gaps and replaces removed series instead of retaining merged lines', () => {
  const { rerender } = render(<AreaChart {...props} />)
  expect(captured.option.series.map(s => s.id)).toEqual(['capital', 'capital-now', 'assets', 'liabilities'])
  expect(captured.option.series[0].data.map(p => p.value)).toEqual([80, null, 140])
  expect(captured.option.series[1].data.map(p => p.value)).toEqual([80, null, 140])
  expect(captured.option.series[1].connectNulls).toBe(true)
  expect(captured.option.series[0].connectNulls).toBe(false)
  expect(captured.option.series[0].areaStyle).toBeUndefined()
  rerender(<AreaChart {...props} visibleSeries={['assets']} />)
  expect(captured.replaceMerge).toEqual(['series'])
  expect(captured.option.series.map(s => s.id)).toEqual(['assets'])
})
it('leaves room on the right for the last month\'s label, centred on the plot\'s edge', () => {
  render(<AreaChart {...props} />)
  expect(captured.option.xAxis).toMatchObject({ boundaryGap: false, axisLabel: { showMaxLabel: true } })
  expect(captured.option.grid.right).toBeGreaterThanOrEqual(24)
})
it('restores the real axis extent after an unavailable percentage range', () => {
  // SVG SSR still measures text; no canvas implementation is available in jsdom.
  setPlatformAPI({ measureText: text => ({ width: text.length * 7 }) })
  use([LineChart, GridComponent, SVGRenderer])
  const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 240 })
  try {
    const { rerender } = render(<AreaChart {...props} model={buildCapitalHistory(history, { from: '2031-02', to: '2031-03' }, 'percent')} />)
    chart.setOption(captured.option as unknown as EChartsCoreOption, { replaceMerge: ['series'] })
    rerender(<AreaChart {...props} />)
    chart.setOption(captured.option as unknown as EChartsCoreOption, { replaceMerge: ['series'] })
    const y = chart.convertToPixel({ yAxisIndex: 0 }, 140)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(240)
  } finally { chart.dispose() }
})
it('updates visible, hidden and accessible money on privacy change without cached HTML', () => {
  const { rerender, container } = render(<AreaChart {...props} />)
  const { chart } = fakeChart()
  act(() => captured.onChartReady(chart)); flush()
  act(() => captured.onEvents.updateaxispointer({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 2 }] }, chart))
  expect(container.textContent).toContain('$140')
  rerender(<PrivacyContext.Provider value={{ hidden: true, toggle: () => {} }}><AreaChart {...props} /></PrivacyContext.Provider>)
  expect(container.textContent).not.toContain('$140')
  expect(captured.option.aria.label.description).not.toContain('$140')
  expect(captured.option.yAxis.axisLabel.formatter(12345)).toBe('•••')
  expect(captured.option.tooltip).toMatchObject({ showContent: false, triggerOn: 'none' })
  expect(captured.option.animation).toBe(false)
  rerender(<PrivacyContext.Provider value={{ hidden: true, toggle: () => {} }}><AreaChart {...props} model={buildCapitalHistory(history, null, 'percent')} /></PrivacyContext.Provider>)
  expect(captured.option.yAxis.axisLabel.formatter(25)).toBe('25%')
})
it('replays on initial ready, rejects stale events and deduplicates finished updates', () => {
  const { unmount } = render(<AreaChart {...props} />)
  const first = fakeChart(), second = fakeChart()
  act(() => captured.onChartReady(first.chart)); flush(); flush()
  expect(first.dispatch).toHaveBeenCalledTimes(1)
  act(() => captured.onChartReady(second.chart)); flush()
  expect(first.listeners.size).toBe(0)
  act(() => captured.onEvents.updateaxispointer({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 0 }] }, first.chart))
  expect(props.onSelectMonth).not.toHaveBeenCalled()
  for (const value of [NaN, -1, 20, '1', null]) act(() => captured.onEvents.updateaxispointer({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value }] }, second.chart))
  expect(props.onSelectMonth).not.toHaveBeenCalled()
  act(() => captured.onEvents.updateaxispointer({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 1 }] }, second.chart))
  expect(props.onSelectMonth).toHaveBeenCalledWith('2031-02', 'pointer')
  unmount()
  expect(second.listeners.size).toBe(0)
  expect(frames.size).toBe(0)
})
it('replays same-coordinate data changes and restores the pointer after a theme remount', () => {
  const { rerender } = render(<AreaChart {...props} />)
  const first = fakeChart()
  act(() => captured.onChartReady(first.chart)); flush(); flush()
  rerender(<AreaChart {...props} model={buildCapitalHistory(history.map(p => ({ ...p, netWorth: p.netWorth * 2 })), null, 'amount')} />)
  flush(); flush()
  expect(first.dispatch).toHaveBeenCalledTimes(2)
  rerender(<ThemeContext.Provider value="dark"><AreaChart {...props} /></ThemeContext.Provider>)
  const second = fakeChart()
  act(() => captured.onChartReady(second.chart)); flush(); flush()
  expect(second.dispatch).toHaveBeenCalledTimes(1)
})
it('announces keyboard selection without cached money or hover spam', () => {
  const { container } = render(<AreaChart {...props} />)
  fireEvent.keyDown(screen.getByRole('group', { name: 'Net worth history' }), { key: 'ArrowLeft' })
  expect(props.onSelectMonth).toHaveBeenCalledWith('2031-02', 'keyboard')
  expect(container.querySelector('[aria-live]')).toBeInTheDocument()
})
