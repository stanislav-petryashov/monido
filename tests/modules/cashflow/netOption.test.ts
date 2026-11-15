import { describe, expect, it } from 'vitest'
import { buildNetOption } from '../../../src/modules/cashflow/netOption'

const fmt = (v: number) => `$${v}`
const resolve = (token: string) => token
const rows = [
  { month: '2026-07', income: 5000, expense: 4000, net: 1000 },
  { month: '2026-08', income: 5000, expense: 5300, net: -300 },
  { month: '2026-09', income: 5134, expense: 4100, net: 1034 },
]
type Bar = { value: number; itemStyle: { color: string }; label: { show: boolean; position: string; formatter: () => string } }
const bars = (compact = false) => (buildNetOption(rows, fmt, resolve, compact).series[0].data as Bar[])

describe('buildNetOption', () => {
  it('draws the past in --bar and the last month in --chart-1 with its value on top', () => {
    expect(bars().map(b => b.itemStyle.color)).toEqual(['--bar', '--bar', '--chart-1'])
    expect(bars()[2].label).toMatchObject({ show: true, position: 'top' })
    expect(bars()[2].label.formatter()).toBe('$1034')
    expect(bars()[0].label.show).toBe(false)
  })

  it('labels an overspent month at the zero line, over its bar\'s top, clear of the month names', () => {
    expect(bars()[1].label).toMatchObject({ show: true, position: 'top' })
    expect(bars()[1].label.formatter()).toBe('$-300')
  })

  it('on a phone leaves the overspent month to the tooltip and keeps the last month\'s value', () => {
    expect(bars(true)[1].label.show).toBe(false)
    expect(bars(true)[2].label).toMatchObject({ show: true, position: 'top' })
  })

  it('a month whose totals are unknown (no rate) has no bar and a dash', () => {
    const gap = [rows[0], { month: '2026-08', income: null, expense: null, net: null }, rows[2]]
    const option = buildNetOption(gap, fmt, resolve)
    const data = option.series[0].data as unknown as { value: number | string; label: { show: boolean } }[]
    expect(data[1]).toMatchObject({ value: '-', label: { show: false } })
    expect(option.aria.label.description).toContain("Aug'26: income —, expenses —, net —")
    expect(option.tooltip.formatter([{ dataIndex: 1, axisValue: "Aug'26" }])).toContain('—')
  })

  it('describes every month for a screen reader and hides the value axis', () => {
    const option = buildNetOption(rows, fmt, resolve)
    expect(option.aria.label.description).toContain("Jul'26: income $5000, expenses $4000, net $1000")
    expect(option.yAxis.show).toBe(false)
    expect(option.xAxis.data).toEqual(["Jul'26", "Aug'26", "Sep'26"])
  })
})
