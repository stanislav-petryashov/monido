import { escapeHtml } from '../../components/charts/tooltipHtml'
import { t } from '../../i18n/client'
import { fmtDate } from '../../lib/formatters'
import type { MonthlyTrendRow } from '../../lib/types'

interface TooltipParam { dataIndex: number; axisValue: string }

/**
 * A bar per month of what was left: the past in `--bar`, the last month in `--chart-1` with its value on top; an
 * overspent month is labelled at the zero line, over its bar's top, so the label stays clear of the month names — except
 * when `compact` (a phone), where the label is wider than the bar's slot and the tooltip tells it instead. No axis
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
    yAxis: { type: 'value', show: false },
    series: [{
      type: 'bar',
      barMaxWidth: 28,
      data: rows.map((r, i) => ({
        // '-': ECharts' empty value, no bar
        value: r.net ?? '-',
        itemStyle: { color: i === last ? now : past, borderRadius: 3 },
        // a bar's 'top' is its upper edge on screen: for an overspent month that is the zero line
        label: { show: r.net !== null && (i === last || (r.net < 0 && !compact)), position: 'top', ...(i === last ? { align: 'right' } : {}), formatter: () => fmt(r.net), color: ink },
      })),
    }],
  }
}
