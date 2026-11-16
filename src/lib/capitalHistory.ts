import type { HistoryPoint } from '../domain/types'
import { monthOf, shiftMonth } from '../domain/dates'
import { todaysMoneyFactor } from '../domain/goals'

export type CapitalSeriesKey = 'capital' | 'assets' | 'liabilities' | 'capitalReal'
/**
 * The "in today's money" line: the inflation rate when the dashboard is in the inflation's currency; else why there is none
 * (no inflation set, or another currency: there it would mix exchange rates into inflation).
 */
export type RealLine = { ratePct: number } | { unavailable: 'no-inflation' } | { unavailable: 'other-currency'; currency: string }
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
  series: {
    key: CapitalSeriesKey
    /** As the unit shows them: amounts, or % against the range's first month */
    values: (number | null)[]
    /** The amounts behind the values, whatever the unit (the tooltip's) */
    amounts: (number | null)[]
    unavailableReason: 'nonpositive-base' | 'missing-base' | 'invalid-base' | 'no-inflation' | 'other-currency' | null
  }[]
}

const FIELDS = { capital: 'netWorth', assets: 'assets', liabilities: 'liabilities', capitalReal: 'netWorth' } as const
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

/**
 * One slot per calendar month; gaps never acquire values or a later percentage baseline. With `real`, a fourth series:
 * net worth in the last month's money (todaysMoneyFactor), off until chosen, or its reason when there is none.
 */
export function buildCapitalHistory(history: readonly HistoryPoint[], input: CapitalMonthRange | null, unit: CapitalHistoryUnit, unavailableMonths: readonly string[] = [], real?: RealLine): CapitalHistoryModel {
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
  const last = full?.to ?? ''
  const keys: CapitalSeriesKey[] = real ? [...KEYS, 'capitalReal'] : KEYS
  const series: CapitalHistoryModel['series'] = keys.map(key => {
    const field = FIELDS[key]
    const scale = (month: string) => (key === 'capitalReal' && real && 'ratePct' in real ? todaysMoneyFactor(month, last, real.ratePct) : 1)
    const amounts = selected.map(({ month, point }) => {
      const value = point?.[field]
      return value === undefined || !Number.isFinite(value) ? null : value * scale(month)
    })
    if (key === 'capitalReal' && real && 'unavailable' in real) return { key, values: selected.map(() => null), amounts: selected.map(() => null), unavailableReason: real.unavailable }
    const raw = selected[0]?.point?.[field]
    const base = raw === undefined ? undefined : raw * scale(selected[0].month)
    const unavailableReason = unit !== 'percent' || !selected.length ? null : base === undefined ? 'missing-base' : !Number.isFinite(base) ? 'invalid-base' : base <= 0 ? 'nonpositive-base' : null
    const values = amounts.map(value => {
      if (value === null || unavailableReason) return null
      const result = unit === 'amount' ? value : (value / base! - 1) * 100
      return Number.isFinite(result) ? result : null
    })
    return { key, values, amounts, unavailableReason }
  })
  return { unit, months, selected, range, baseMonth: unit === 'percent' ? range?.from ?? null : null, series }
}

export function resolveCapitalHistory(history: readonly HistoryPoint[], state: CapitalHistoryState, unavailableMonths?: readonly string[], real?: RealLine): { model: CapitalHistoryModel; selectedMonth: string | null } {
  const range = state.preset ? capitalPresetRange(history, state.preset) : state.customRange
  const model = buildCapitalHistory(history, range, state.unit, unavailableMonths, real)
  return { model, selectedMonth: model.range ? clamp(state.selectedMonth ?? model.range.to, model.range.from, model.range.to) : null }
}
