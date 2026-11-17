import { escapeHtml } from '../../components/charts/tooltipHtml'
import { t } from '../../i18n/client'
import { fmtDate } from '../../lib/formatters'
import type { MonthlyTrendRow } from '../../lib/types'

interface TooltipParam { dataIndex: number; axisValue: string }

/**
 * A bar per month of what was left: the past in `--bar`, the last month in `--chart-1` with its value on top. Only the
 * largest overspend is named, under its bar's end: a label is wider than its slot, so at the zero line it ran over the
 * neighbours' bars and a second overspent month's label; under zero only overspent bars stand, and the axis keeps room
 * below the deepest one so the label clears the month names. On a phone (`compact`) the tooltip tells it instead. No axis
 * figures: the card's number says the total, the tooltip each month. A month whose totals are unknown (no rate) has no
 * bar and a dash.
 */
export function buildNetOption(rows: MonthlyTrendRow[], fmtAmount: (v: number) => string, resolve: (token: string) => string, compact = false) {
  const fmt = (v: number | null) => (v === null ? '—' : fmtAmount(v))
  const last = rows.length - 1
  const labels = rows.map(r => fmtDate(r.month))
  const description = t('charts.netByMonth', {
    rows: rows.map((r, i) => t('charts.cashflow.row', { month: labels[i], income: fmt(r.income), expense: fmt(r.expense), net: fmt(r.net) })).join('; '),
  })
  const [past, now, ink] = [resolve('--bar'), resolve('--chart-1'), resolve('--text-2')]
  const nets = rows.map(r => r.net)
  const deepest = nets.reduce<number>((at, v, i) => (v !== null && v < 0 && i !== last && (at < 0 || v < nets[at]!) ? i : at), -1)
  return {
    aria: { enabled: true, label: { description } },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: TooltipParam[]) => {
        const i = params[0]?.dataIndex ?? 0
        return `<b>${escapeHtml(params[0]?.axisValue ?? '')}</b><br/>${escapeHtml(fmt(rows[i]?.net ?? null))}`
      },
    },
    grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: labels, axisTick: { show: false }, axisLine: { show: false } },
    // a fifth of the range under the deepest bar: the room for its label inside the grid, above the month names
    yAxis: { type: 'value', show: false, min: (v: { min: number; max: number }) => (v.min < 0 ? v.min - (v.max - v.min) / 5 : v.min) },
    series: [{
      type: 'bar',
      barMaxWidth: 28,
      data: rows.map((r, i) => ({
        // '-': ECharts' empty value, no bar
        value: r.net ?? '-',
        itemStyle: { color: i === last ? now : past, borderRadius: 3 },
        // 'bottom' of a negative bar is its lower end on screen
        label: i === last
          ? { show: r.net !== null, position: 'top', align: 'right', formatter: () => fmt(r.net), color: ink }
          : { show: i === deepest && !compact, position: 'bottom', formatter: () => fmt(r.net), color: ink },
      })),
    }],
  }
}
