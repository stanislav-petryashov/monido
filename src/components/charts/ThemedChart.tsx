import ReactECharts from 'echarts-for-react/esm/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EChartsType } from 'echarts/core'
import { chartAnimationEnabled, readCssPx, readCssVar } from '../../lib/chartColors'
import { core } from './echarts'
import { useChartTheme } from './theme'

function withFont(value: unknown, field: string, size: number, family: string): unknown {
  if (Array.isArray(value)) return value.map(v => withFont(v, field, size, family))
  if (!value || typeof value !== 'object') return value
  return { ...value, [field]: { ...(value as Record<string, object>)[field], fontSize: size, fontFamily: family } }
}

function fontIsReady(): boolean {
  return typeof document === 'undefined' || !document.fonts || (document.fonts.status === 'loaded' && document.fonts.check('12px "Onest Variable"', 'Family'))
}

/**
 * The shell every chart shares: ECharts core, the theme of the page (the chart is drawn again when it changes), animation
 * unless the person asks for less motion, full width at `height`. `buildOption` runs in this component's render, after
 * the theme is read, so the colours it resolves (resolveColor) are the new theme's when the theme changes.
 */
export function ThemedChart({ buildOption, height, onEvents, onChartReady, replaceMerge }: {
  buildOption: () => object
  height: number
  onEvents?: Record<string, (event: unknown, chart: EChartsType) => void>
  onChartReady?: (chart: EChartsType) => void
  replaceMerge?: string[]
}) {
  const theme = useChartTheme()
  const instance = useRef<EChartsType | null>(null)
  const probe = useRef<HTMLSpanElement>(null)
  const [metadataSize, setMetadataSize] = useState(() => readCssPx('--fs-meta', 12))
  const [fontReady, setFontReady] = useState(fontIsReady)
  const ready = useCallback((chart: EChartsType) => { instance.current = chart; onChartReady?.(chart) }, [onChartReady])
  useEffect(() => {
    let active = true
    const pending = () => { if (active) setFontReady(false) }
    const redraw = () => {
      if (!active) return
      setFontReady(fontIsReady())
      if (instance.current && !instance.current.isDisposed()) instance.current.resize()
    }
    const fonts = document.fonts
    void fonts?.ready.then(redraw)
    fonts?.addEventListener('loading', pending)
    fonts?.addEventListener('loadingdone', redraw)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => setMetadataSize(readCssPx('--fs-meta', 12)))
    if (probe.current) observer?.observe(probe.current)
    return () => { active = false; observer?.disconnect(); fonts?.removeEventListener('loading', pending); fonts?.removeEventListener('loadingdone', redraw) }
  }, [])
  const option = buildOption() as { aria?: { enabled?: boolean; label?: { description?: string } } }
  const textOption = option as Record<string, unknown>
  const smallSize = readCssPx('--fs-sm', 14)
  // A different font key prevents zrender from retaining widths measured before Onest arrived.
  const family = fontReady ? readCssVar('--font', 'sans-serif') : 'system-ui, -apple-system, sans-serif'
  const description = option.aria?.enabled ? option.aria.label?.description : undefined
  return <div role={description ? 'img' : undefined} aria-label={description}>
    <span ref={probe} className="chart-type-probe" aria-hidden="true" />
    <ReactECharts echarts={core} key={theme} theme={theme} option={{ animation: chartAnimationEnabled(), ...option,
      textStyle: { ...(textOption.textStyle as object), fontFamily: family },
      ...(textOption.xAxis ? { xAxis: withFont(textOption.xAxis, 'axisLabel', metadataSize, family) } : {}),
      ...(textOption.yAxis ? { yAxis: withFont(textOption.yAxis, 'axisLabel', metadataSize, family) } : {}),
      ...(textOption.legend ? { legend: withFont(textOption.legend, 'textStyle', smallSize, family) } : {}),
      ...(textOption.tooltip ? { tooltip: withFont(textOption.tooltip, 'textStyle', smallSize, family) } : {}),
    }} opts={{ renderer: 'svg' }} style={{ height, width: '100%' }} onEvents={onEvents} onChartReady={ready} replaceMerge={replaceMerge} />
  </div>
}
