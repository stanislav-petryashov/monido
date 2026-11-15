import { createElement } from 'react'
import { vi } from 'vitest'

/**
 * A stand-in for both chart modules in page tests, which check the page around a chart, not the chart:
 *
 *   vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
 *   vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))
 *
 * `core` replaces the app's ECharts core (no canvas in jsdom); the default export replaces the React chart with an
 * empty `data-testid="chart"` box. A test that reads the chart's options mocks the module itself.
 * @public (read through the vi.mock factories above, which knip does not follow)
 */
export const core = { registerTheme: vi.fn(), use: vi.fn() }

export default function ChartStub() {
  return createElement('div', { 'data-testid': 'chart' })
}
