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

  it('names only the largest overspend, under its bar\'s end, never at the zero line among the neighbours', () => {
    expect(bars()[1].label).toMatchObject({ show: true, position: 'bottom' })
    expect(bars()[1].label.formatter()).toBe('$-300')
    // the 2026-11-17 overlap: two overspent months side by side both labelled at zero; now only the deeper one is named
    const two = [rows[0], { month: '2026-08', income: 1, expense: 281, net: -280 }, { month: '2026-09', income: 1, expense: 9, net: -8 }, rows[2]]
    const data = buildNetOption(two, fmt, resolve).series[0].data as Bar[]
    expect(data.map(b => b.label.show)).toEqual([false, true, false, true])
  })

  it('keeps room under the deepest bar for its label: the value axis starts a fifth of the range below it', () => {
    const { min } = buildNetOption(rows, fmt, resolve).yAxis as unknown as { min: (v: { min: number; max: number }) => number }
    expect(min({ min: -300, max: 1034 })).toBeCloseTo(-300 - 1334 / 5)
    expect(min({ min: 0, max: 1034 })).toBe(0)
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
