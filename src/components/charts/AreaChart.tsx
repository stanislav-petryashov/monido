import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { EChartsType } from 'echarts/core'
import { useTranslation } from 'react-i18next'
import type { CapitalHistoryModel, CapitalSeriesKey } from '../../lib/capitalHistory'
import { fmtDate, fmtMonth, fmtPct } from '../../lib/formatters'
import { useDashboard } from '../../lib/dashboardState'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import { resolveColor } from '../../lib/chartColors'
import { ThemedChart } from './ThemedChart'

interface Props {
  model: CapitalHistoryModel
  visibleSeries: CapitalSeriesKey[]
  selectedMonth: string | null
  onSelectMonth: (month: string, source: 'pointer' | 'keyboard') => void
  height: number
}
const TOKENS = { capital: '--chart-1', assets: '--chart-2', liabilities: '--chart-3', capitalReal: '--text-3' } as const
const REPLACE_SERIES = ['series']
const key = (name: string) => `pages.netWorth.historyPanel.${name}`

/** ECharts draws marks; every tooltip and accessible money label is current React text. */
export function AreaChart({ model, visibleSeries, selectedMonth, onSelectMonth, height }: Props) {
  const { t } = useTranslation()
  const { fmt, fmtCompact } = useDashboard()
  const { hidden } = usePrivacy()
  const id = useId()
  const [interaction, setInteraction] = useState<{ month: string; source: 'pointer' | 'keyboard'; shown: boolean; revision: string } | null>(null)
  const revision = JSON.stringify([model, visibleSeries])
  const latest = useRef({ model, selectedMonth, onSelectMonth, revision })
  const instance = useRef<EChartsType | null>(null)
  const detach = useRef<(() => void) | null>(null)
  const frame = useRef<number | null>(null)
  const guard = useRef<string | null>(null)
  const clearFrame = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])
  const schedule = useCallback(() => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const chart = instance.current, current = latest.current
      if (!chart || chart.isDisposed() || !current.selectedMonth) return
      const index = current.model.selected.findIndex(m => m.month === current.selectedMonth)
      if (index < 0) return
      const x = chart.convertToPixel({ xAxisIndex: 0 }, index), y = chart.getHeight() / 2
      if (typeof x !== 'number' || !Number.isFinite(x) || !chart.containPixel({ gridIndex: 0 }, [x, y])) return
      const next = JSON.stringify([current.revision, index, x, y])
      if (guard.current === next) return
      guard.current = next
      chart.dispatchAction({ type: 'updateAxisPointer', x, y, axesInfo: [{ axisDim: 'x', axisIndex: 0, value: index }] }, { silent: true })
    })
  }, [])
  const ready = useCallback((chart: EChartsType) => {
    clearFrame()
    detach.current?.()
    instance.current = chart
    guard.current = null
    const finished = () => { if (instance.current === chart && !chart.isDisposed()) schedule() }
    chart.on('finished', finished)
    detach.current = () => { chart.off('finished', finished) }
    schedule()
  }, [clearFrame, schedule])
  useLayoutEffect(() => {
    latest.current = { model, selectedMonth, onSelectMonth, revision }
    schedule()
  })
  useLayoutEffect(() => () => { clearFrame(); detach.current?.(); detach.current = null; instance.current = null }, [clearFrame])
  const events = useMemo(() => ({
    updateaxispointer: (event: unknown, chart: EChartsType) => {
      if (instance.current !== chart || chart.isDisposed() || !event || typeof event !== 'object') return
      const axes = (event as { axesInfo?: { axisDim?: string; axisIndex?: number; value?: unknown }[] }).axesInfo
      if (!Array.isArray(axes)) return
      const i = axes.find(a => a?.axisDim === 'x' && a.axisIndex === 0)?.value
      const current = latest.current
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= current.model.selected.length) {
        if (!axes.length) setInteraction(old => old?.shown ? { ...old, shown: false } : old)
        return
      }
      const month = current.model.selected[i].month
      setInteraction(old => old?.source === 'pointer' && old.shown && old.month === month && old.revision === current.revision ? old : { month, source: 'pointer', shown: true, revision: current.revision })
      if (current.selectedMonth !== month) current.onSelectMonth(month, 'pointer')
    },
  }), [])
  const index = model.selected.findIndex(m => m.month === selectedMonth)
  const selected = model.selected[index]
  const shownSeries = model.series.filter(s => visibleSeries.includes(s.key))
  const rows = shownSeries.map(s => {
    const amount = s.amounts[index], value = s.values[index]
    return { ...s, amount: amount == null || !Number.isFinite(amount) ? t(key('unavailableValue')) : hidden ? PRIVACY_MASK : fmt(amount),
      percent: s.unavailableReason ? t(key(s.unavailableReason)) : value == null ? t(key('unavailableValue')) : fmtPct(value, { sign: true, preserveNonzero: true }) }
  })
  const details = <>
    <p className="capital-chart__date">{selected ? fmtMonth(selected.month) : t(key('empty'))}</p>
    {!selected?.point ? <p className="note">{t(key('missingMonth'))}</p> : <dl className="capital-chart__values">{rows.map(s => <div key={s.key}>
      <dt><i aria-hidden="true" style={{ background: `var(${TOKENS[s.key]})` }} />{t(key(s.key))}</dt>
      <dd>{s.amount}{model.unit === 'percent' && <span>{s.percent}</span>}</dd>
    </div>)}</dl>}
    {model.baseMonth && <p className="note">{t(key('base'), { month: fmtMonth(model.baseMonth) })}</p>}
  </>
  const describe = !selected ? t(key('empty')) : !selected.point ? `${fmtMonth(selected.month)}; ${t(key('missingMonth'))}` : [fmtMonth(selected.month), ...rows.map(s => `${t(key(s.key))}: ${s.amount}${model.unit === 'percent' ? ` (${s.percent})` : ''}`)].join('; ')
  const active = interaction?.revision === revision && interaction.month === selectedMonth
  const hide = () => setInteraction(old => old?.shown ? { ...old, shown: false } : old)
  return <div className="capital-chart">
    <div className="capital-chart__plot" role="group" aria-label={t(key('graph'))} aria-describedby={`${id}-help ${id}-details`} tabIndex={0} onPointerLeave={e => { if (e.pointerType !== 'touch') hide() }} onBlur={hide}
      onKeyDown={e => {
        if (e.key === 'Escape') { hide(); return }
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const next = Math.max(0, Math.min(model.selected.length - 1, index + (e.key === 'ArrowLeft' ? -1 : 1)))
        const month = model.selected[next]?.month
        if (!month || month === selectedMonth) return
        setInteraction({ month, source: 'keyboard', shown: true, revision }); onSelectMonth(month, 'keyboard')
      }}>
      <span id={`${id}-help`} className="sr-only">{t(key('instructions'))}</span>
      <ThemedChart height={height} onEvents={events} onChartReady={ready} replaceMerge={REPLACE_SERIES} buildOption={() => {
        const plotted = shownSeries.filter(s => !s.unavailableReason)
        const hasValues = plotted.some(s => s.values.some(v => v !== null))
        return {
          animation: false, aria: { enabled: true, label: { description: describe } },
          tooltip: { trigger: 'axis', showContent: false, triggerOn: 'none' }, axisPointer: { triggerOn: 'mousemove|click' },
          // right: room for half of the last month's label, centred on the plot's right edge (boundaryGap: false)
          grid: { left: 4, right: 28, top: 16, bottom: 40, containLabel: true },
          xAxis: { type: 'category', boundaryGap: false, data: model.selected.map(m => m.month), axisLabel: { formatter: fmtDate, hideOverlap: true, interval: 'auto', showMaxLabel: true },
            axisPointer: { show: true, snap: false, label: { show: false }, lineStyle: { type: 'dashed', color: resolveColor('--text-3') } } },
          yAxis: { type: 'value', scale: true, splitNumber: 3, min: hasValues ? null : 0, max: hasValues ? null : 1, axisLabel: { show: hasValues, formatter: (v: number) => model.unit === 'percent' ? fmtPct(v, { preserveNonzero: true }) : hidden ? PRIVACY_MASK : fmtCompact(v) } },
          series: plotted.flatMap(s => {
            const last = s.values.findLastIndex(v => v !== null), previous = s.values.findLastIndex((v, i) => v !== null && i < last)
            const hue = resolveColor(TOKENS[s.key])
            // Net worth is the main series: its past is ink (--bar), only the last segment and the end dot are violet. That is a
            // second series over the same months, which keeps the axis tooltip and the accessible summary as they are: both
            // read the months, not the series. Assets and loans keep their hue whole, so the three lines stay apart.
            const now = s.key === 'capital'
            const line = (id: string, color: string, data: (number | null)[], connectNulls: boolean, marker: boolean) => ({
              // net worth in today's money: a dashed muted line beside the nominal one, never the main series
              id, name: t(key(s.key)), type: 'line', smooth: false, connectNulls, showSymbol: true, symbol: 'emptyCircle', lineStyle: { width: 2, color, type: s.key === 'capitalReal' ? 'dashed' : 'solid' }, itemStyle: { color },
              data: data.map((value, i) => ({ value, symbolSize: marker && value !== null && i === last ? 7 : 0 })),
            })
            if (!now) return [line(s.key, hue, s.values, false, true)]
            // the last segment: the end point and the one before it (a missing month between them is bridged)
            const ends = s.values.map((v, i) => (i === last || i === previous ? v : null))
            return [line(s.key, resolveColor('--bar'), s.values, false, false), line(`${s.key}-now`, hue, ends, true, true)]
          }),
        }
      }} />
      {active && interaction?.shown && <div className="capital-chart__tooltip" aria-hidden="true" style={{ left: `clamp(0px, ${model.selected.length > 1 ? index / (model.selected.length - 1) * 70 : 0}%, max(0px, 100% - 260px))` }}>{details}</div>}
    </div>
    <div id={`${id}-details`} className="sr-only" role="group" aria-label={t(key('selected'))}>{details}</div>
    <div className="sr-only" aria-live="polite" aria-atomic="true">{active && interaction?.source === 'keyboard' ? describe : ''}</div>
  </div>
}
