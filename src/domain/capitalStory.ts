// What the Income and expenses page tells about a period's net-worth change: the months of capitalChange.ts summed into one
// bridge, the sentence that names the main cause, the yardstick "how often markets went negative" and the cumulative
// history of what the family added against what net worth did.
import { isMonthChange } from './capitalChange'
import { shiftMonth } from './dates'
import { round2 } from './fx'
import type { AssetPeriod, ChangeCandidate, ChangeItem, ChangeRowKey, MonthChange, MonthChangeGap } from './types'

/** A run of closed months summed: its rows, items, moves and candidates; the rates from the first month's start to the last month's end */
export interface PeriodChange extends Omit<MonthChange, 'month'> { months: string[] }
/** A sentence as an i18n key with its params, and the sentence after it */
export interface Story { key: string; params: Record<string, string | number>; tail: Omit<Story, 'tail'> | null }
/** One point of the history: the change since the window's start; null — the month cannot be broken down, or the line has not started */
export interface ChangePoint { month: string; netWorth: number | null; added: number | null; markets: number | null; unexplained: number | null }

/** A change below this share of the start net worth reads as "barely changed" */
export const FLAT_SHARE = 0.005
/** Months of breakdown the yardstick needs */
export const MIN_YARDSTICK_MONTHS = 6
/** All time above this many months is drawn by quarter ends */
const MAX_MONTHLY_POINTS = 36

const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0))
const row = (m: { rows: Partial<Record<ChangeRowKey, number>> }, key: ChangeRowKey) => m.rows[key] ?? 0
/** What the family itself added: saved, the scheduled principal and the interest early repayments paid */
const addedOf = (m: { rows: Partial<Record<ChangeRowKey, number>> }) => sum([row(m, 'saved'), row(m, 'debtPaid'), row(m, 'earlyInterest')])
const marketsOf = (m: { rows: Partial<Record<ChangeRowKey, number>> }) => sum([row(m, 'investments'), row(m, 'fx'), row(m, 'property')])

/** A tracked month in the balances form: its saved, investments, early interest and unexplained become its accounts row */
function asBalances(m: MonthChange): MonthChange {
  if (m.form === 'balances') return m
  const { saved = 0, investments = 0, earlyInterest = 0, unexplained = 0, ...rest } = m.rows
  return { ...m, form: 'balances', rows: { accounts: sum([saved, investments, earlyInterest, unexplained]), ...rest }, candidates: [] }
}

function mergeItems(list: ChangeItem[], single: boolean): ChangeItem[] {
  const merged = new Map<string, ChangeItem>()
  for (const i of list) {
    const key = JSON.stringify([i.kind, i.name, i.member, i.currency])
    const was = merged.get(key)
    merged.set(key, was ? { ...was, amount: round2(was.amount + i.amount) } : { ...i })
  }
  // an own-currency amount describes one month; over several it would read as a sum of start balances
  return [...merged.values()].filter(i => i.amount).map(i => (single ? i : { ...i, native: undefined }))
}

export function periodChange(all: (MonthChange | MonthChangeGap)[], months: string[]): PeriodChange | MonthChangeGap {
  const byMonth = new Map(all.map(m => [m.month, m]))
  const list: MonthChange[] = []
  for (const month of months) {
    const m = byMonth.get(month)
    if (!m) return { month, reason: 'no_balance' }
    if (!isMonthChange(m)) return m
    list.push(m)
  }
  const mixed = list.some(m => m.form === 'balances')
  const used = mixed ? list.map(asBalances) : list
  const keys = [...new Set(used.flatMap(m => Object.keys(m.rows) as ChangeRowKey[]))]
  const single = used.length === 1
  const items: PeriodChange['items'] = {}
  for (const k of ['debtPaid', 'fx', 'property', 'investments'] as const) {
    const merged = mergeItems(used.flatMap(m => m.items[k] ?? []), single)
    if (used.some(m => m.items[k])) items[k] = merged
  }
  const candidates = new Map<string, ChangeCandidate>()
  for (const c of used.flatMap(m => m.candidates)) {
    const key = JSON.stringify([c.name, c.member, c.reason])
    const was = candidates.get(key)
    candidates.set(key, was ? { ...was, change: round2(was.change + c.change) } : c)
  }
  const first = used[0], last = used[used.length - 1]
  return {
    months, form: mixed ? 'balances' : 'tracked', start: first.start, end: last.end,
    rows: Object.fromEntries(keys.map(k => [k, sum(used.map(m => row(m, k)))])),
    items, pairs: used.flatMap(m => m.pairs), candidates: [...candidates.values()],
    rates: first.rates.flatMap(r => {
      const end = last.rates.find(x => x.currency === r.currency)
      return end ? [{ currency: r.currency, start: r.start, end: end.end }] : []
    }),
  }
}

const CAUSES: Record<'tracked' | 'balances', ChangeRowKey[]> = {
  tracked: ['saved', 'debtPaid', 'earlyInterest', 'investments', 'fx', 'property', 'unexplained'],
  balances: ['accounts', 'debtPaid', 'earlyInterest', 'fx', 'property'],
}
const capitalised = (k: string) => k[0].toUpperCase() + k.slice(1)

/** The sentence: the change, its largest cause (with the rate for exchange rates), then what the family added or took out */
export function changeStory(p: PeriodChange): Story {
  const change = round2(p.end - p.start)
  const added = addedOf(p)
  const tail: Story['tail'] = p.form === 'balances' ? null
    : added >= 0 ? { key: 'capitalChange.sentence.added', params: { amount: added } }
      : { key: 'capitalChange.sentence.tookOut', params: { amount: round2(-added) } }
  if (Math.abs(change) < FLAT_SHARE * Math.abs(p.start)) return { key: 'capitalChange.sentence.flat', params: { change }, tail }
  const dir = change < 0 ? 'down' : 'up'
  const cause = CAUSES[p.form].reduce((best, k) => (Math.abs(row(p, k)) > Math.abs(row(p, best)) ? k : best))
  const params: Story['params'] = { change: Math.abs(change), amount: row(p, cause) }
  if (cause !== 'fx') return { key: `capitalChange.sentence.${dir}${capitalised(cause)}`, params, tail }
  // the currency whose rate moved net worth most, phrased so the rate reads above 1 ("the ruble: 84 → 92 per dollar")
  const byCurrency = new Map<string, number>()
  for (const i of p.items.fx ?? []) byCurrency.set(i.currency, (byCurrency.get(i.currency) ?? 0) + i.amount)
  const currency = [...byCurrency].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0]
  const rate = p.rates.find(r => r.currency === currency)
  if (!rate) return { key: `capitalChange.sentence.${dir}FxPlain`, params, tail }
  if (rate.start >= 1) return { key: `capitalChange.sentence.${dir}Fx`, params: { ...params, currency: rate.currency, from: round2(rate.start), to: round2(rate.end) }, tail }
  return { key: `capitalChange.sentence.${dir}FxPer`, params: { ...params, currency: rate.currency, from: round2(1 / rate.start), to: round2(1 / rate.end) }, tail }
}

/** How many of the window's months markets and rates were negative, and whether the selected month is the largest of them */
export function yardstick(all: (MonthChange | MonthChangeGap)[], window: string[], selected: string[]): { negative: number; total: number; largest: boolean } | null {
  const inWindow = all.filter(isMonthChange).filter(m => window.includes(m.month))
  if (inWindow.length < MIN_YARDSTICK_MONTHS) return null
  const values = inWindow.map(m => ({ month: m.month, value: marketsOf(m) }))
  const lowest = values.reduce((a, b) => (b.value < a.value ? b : a))
  return {
    negative: values.filter(v => v.value < 0).length, total: values.length,
    largest: selected.length === 1 && selected[0] === lowest.month && lowest.value < 0,
  }
}

/** The months the history shows: twelve to the last closed one for a month or a quarter, the calendar year, or everything */
export function historyWindow(closed: string[], kind: AssetPeriod, end: string): string[] {
  if (kind === 'all') return closed
  if (kind === 'year') return closed.filter(m => m.slice(0, 4) === end.slice(0, 4))
  return closed.slice(-12)
}

/**
 * The window's cumulative lines from the end of the month before it. A month that cannot be broken down is a break, and its
 * change counts in neither line. The added line starts on the net worth line at the end of the month before its first
 * tracked month, so the gap between them is what markets, rates and the unexplained did from there.
 */
export function changeHistory(all: (MonthChange | MonthChangeGap)[], window: string[]): { points: ChangePoint[]; largestGap: { month: string; amount: number } | null; takeaway: Story } {
  const byMonth = new Map(all.map(m => [m.month, m]))
  const points: ChangePoint[] = window.length ? [{ month: shiftMonth(window[0], -1), netWorth: 0, added: null, markets: 0, unexplained: 0 }] : []
  let netWorth = 0, markets = 0, unexplained = 0
  let added: number | null = null
  for (const month of window) {
    const m = byMonth.get(month)
    if (!m || !isMonthChange(m)) { points.push({ month, netWorth: null, added: null, markets: null, unexplained: null }); continue }
    if (m.form === 'tracked' && added === null) {
      added = netWorth
      const before = points.at(-1)
      if (before && before.netWorth !== null) before.added = netWorth
    }
    netWorth = round2(netWorth + m.end - m.start)
    if (m.form === 'tracked') {
      added = round2(added! + addedOf(m))
      markets = round2(markets + marketsOf(m))
      unexplained = round2(unexplained + row(m, 'unexplained'))
    }
    points.push({ month, netWorth, added, markets, unexplained })
  }
  const shown = window.length > MAX_MONTHLY_POINTS
    ? points.filter((p, i) => i === 0 || i === points.length - 1 || Number(p.month.slice(5)) % 3 === 0)
    : points
  const gaps = shown.flatMap(p => (p.netWorth !== null && p.added !== null ? [{ month: p.month, amount: round2(p.netWorth - p.added) }] : []))
  const before = gaps.slice(0, -1)
  const largestGap = before.length ? before.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a)) : null
  return { points: shown, largestGap: largestGap?.amount ? largestGap : null, takeaway: takeawayOf(gaps) }
}

function takeawayOf(gaps: { month: string; amount: number }[]): Story {
  const story = (key: string, params: Story['params'] = {}): Story => ({ key: `capitalChange.takeaway.${key}`, params, tail: null })
  const last = gaps.at(-1)
  if (!last) return story('balancesOnly')
  if (last.amount >= 0) return story('marketsHelped')
  const helped = gaps.filter(g => g.amount > 0).at(-1)
  return helped ? story('marketsTookMore', { until: helped.month }) : story('onlyYou')
}
