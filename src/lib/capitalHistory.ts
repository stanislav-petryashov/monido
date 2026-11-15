import type { HistoryPoint } from '../domain/types'
import { monthOf, shiftMonth } from '../domain/dates'

export type CapitalSeriesKey = 'capital' | 'assets' | 'liabilities'
export type CapitalHistoryUnit = 'amount' | 'percent'
export type CapitalHistoryPreset = '3m' | '6m' | '12m' | 'all'
export interface CapitalMonthRange { from: string; to: string }
export interface CapitalMonth { month: string; point: HistoryPoint | null }
export interface CapitalHistoryState {
  preset: CapitalHistoryPreset | null
  customRange: CapitalMonthRange | null
  unit: CapitalHistoryUnit
  visibleSeries: CapitalSeriesKey[]
  selectedMonth: string | null
}
export interface CapitalHistoryModel {
  unit: CapitalHistoryUnit
  months: CapitalMonth[]
  selected: CapitalMonth[]
  range: CapitalMonthRange | null
  baseMonth: string | null
  series: { key: CapitalSeriesKey; values: (number | null)[]; unavailableReason: 'nonpositive-base' | 'missing-base' | 'invalid-base' | null }[]
}

const FIELDS = { capital: 'netWorth', assets: 'assets', liabilities: 'liabilities' } as const
const KEYS: CapitalSeriesKey[] = ['capital', 'assets', 'liabilities']
const clamp = (month: string, from: string, to: string) => month < from ? from : month > to ? to : month

export function initialCapitalHistoryState(): CapitalHistoryState {
  return { preset: '12m', customRange: null, unit: 'amount', visibleSeries: [...KEYS], selectedMonth: null }
}

export function capitalPresetRange(history: readonly HistoryPoint[], preset: CapitalHistoryPreset): CapitalMonthRange | null {
  if (!history.length) return null
  const first = monthOf(history[0].date)
  const to = monthOf(history[history.length - 1].date)
  // N months of change need N + 1 balances: "12 months" starts at the balance a year before the latest, like the year's delta
  const from = preset === 'all' ? first : shiftMonth(to, -Number.parseInt(preset))
  return { from: from < first ? first : from, to }
}

/** One slot per calendar month; gaps never acquire values or a later percentage baseline. */
export function buildCapitalHistory(history: readonly HistoryPoint[], input: CapitalMonthRange | null, unit: CapitalHistoryUnit, unavailableMonths: readonly string[] = []): CapitalHistoryModel {
  const full = capitalPresetRange(history, 'all')
  const months: CapitalMonth[] = []
  let range: CapitalMonthRange | null = null
  if (full) {
    const unavailable = new Set(unavailableMonths)
    const points = new Map(history.filter(p => !unavailable.has(monthOf(p.date))).map(p => [monthOf(p.date), p]))
    for (let month = full.from; month <= full.to; month = shiftMonth(month, 1)) months.push({ month, point: points.get(month) ?? null })
    const a = input?.from ?? full.from
    const b = input?.to ?? full.to
    range = { from: clamp(a < b ? a : b, full.from, full.to), to: clamp(a < b ? b : a, full.from, full.to) }
  }
  const selected = range ? months.filter(m => m.month >= range.from && m.month <= range.to) : []
  const series: CapitalHistoryModel['series'] = KEYS.map(key => {
    const field = FIELDS[key]
    const base = selected[0]?.point?.[field]
    const unavailableReason = unit !== 'percent' || !selected.length ? null : base === undefined ? 'missing-base' : !Number.isFinite(base) ? 'invalid-base' : base <= 0 ? 'nonpositive-base' : null
    const values = selected.map(({ point }) => {
      const value = point?.[field]
      if (value === undefined || !Number.isFinite(value) || unavailableReason) return null
      const result = unit === 'amount' ? value : (value / base! - 1) * 100
      return Number.isFinite(result) ? result : null
    })
    return { key, values, unavailableReason }
  })
  return { unit, months, selected, range, baseMonth: unit === 'percent' ? range?.from ?? null : null, series }
}

export function resolveCapitalHistory(history: readonly HistoryPoint[], state: CapitalHistoryState, unavailableMonths?: readonly string[]): { model: CapitalHistoryModel; selectedMonth: string | null } {
  const range = state.preset ? capitalPresetRange(history, state.preset) : state.customRange
  const model = buildCapitalHistory(history, range, state.unit, unavailableMonths)
  return { model, selectedMonth: model.range ? clamp(state.selectedMonth ?? model.range.to, model.range.from, model.range.to) : null }
}
