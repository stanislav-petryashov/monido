import { readCssVar, readCssPx, resolveColor } from '../../lib/chartColors'
import { useResolvedTheme, type ResolvedTheme } from '../../lib/themeState'
import { core } from './echarts'

/** The categorical palette of the charts. */
const CHART_PALETTE_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'] as const

function chartThemeName(resolved: ResolvedTheme): string {
  return `vuexy-${resolved}`
}

/** The ECharts theme from the current token values; it depends on data-theme on <html>. */
export function buildChartTheme() {
  const text2 = resolveColor('--text-2')
  const text3 = resolveColor('--text-3')
  const axis = {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: text3, fontSize: readCssPx('--fs-meta', 12) },
  }
  return {
    color: CHART_PALETTE_TOKENS.map(t => resolveColor(t)),
    backgroundColor: 'transparent',
    textStyle: { fontFamily: readCssVar('--font', 'sans-serif'), color: text2 },
    categoryAxis: { ...axis, splitLine: { show: false } },
    // the gridlines are the rule of the tables, four of them: the chart is ruled like a page
    valueAxis: { ...axis, splitNumber: 4, splitLine: { lineStyle: { color: resolveColor('--rule'), type: 'solid' } } },
    legend: { textStyle: { color: text2, fontSize: readCssPx('--fs-sm', 14) }, icon: 'rect', itemWidth: 10, itemHeight: 10 },
    tooltip: {
      backgroundColor: resolveColor('--tooltip-bg'),
      borderWidth: 0,
      textStyle: { color: resolveColor('--tooltip-text'), fontSize: readCssPx('--fs-sm', 14) },
      // The tooltip is an HTML element, so var() works here.
      extraCssText: 'border-radius:var(--r-card);padding:var(--sp-1) var(--sp-15);box-shadow:var(--shadow-md)',
    },
    bar: { itemStyle: { borderRadius: [2, 2, 0, 0] } },
    line: { lineStyle: { width: 2 }, symbol: 'none', smooth: false },
    pie: { itemStyle: { borderColor: resolveColor('--paper'), borderWidth: 3 } },
  }
}

const registered = new Set<ResolvedTheme>()

/** Registers a mode's theme once and returns its name for <ReactECharts theme>. */
export function ensureChartTheme(resolved: ResolvedTheme): string {
  if (!registered.has(resolved)) {
    core.registerTheme(chartThemeName(resolved), buildChartTheme())
    registered.add(resolved)
  }
  return chartThemeName(resolved)
}

/**
 * The ECharts theme name for the current mode. Pass it as the `key` too:
 * the chart does not redraw itself when CSS variables change.
 */
export function useChartTheme(): string {
  const resolved = useResolvedTheme()
  return ensureChartTheme(resolved)
}
