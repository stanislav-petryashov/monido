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
export interface Story {
  key: string; params: Record<string, string | number>
  /** The amount params shown with their sign (the others as a size: the words say which way) */
  signed?: string[]
  tail: Omit<Story, 'tail'> | null
}
/** One point of the history: the change since the window's start; null — the month cannot be broken down, or the line has not started */
export interface ChangePoint {
  month: string; netWorth: number | null; added: number | null; markets: number | null; unexplained: number | null
  /** The month's own net-worth change; null at the window's start and at a gap */
  change: number | null
}

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
  // barely changed: a cause against the change is larger than the change itself, so the causes cancelled out
  const against = CAUSES[p.form].some(k => Math.sign(row(p, k)) === -Math.sign(change) && Math.abs(row(p, k)) > Math.abs(change))
  if (change === 0 || against) return p.form === 'balances'
    ? { key: 'capitalChange.sentence.flatBalances', params: { change }, signed: ['change'], tail: null }
    : { key: 'capitalChange.sentence.flat', params: { change, added, markets: marketsOf(p) }, signed: ['change', 'added', 'markets'], tail: null }
  const dir = change < 0 ? 'down' : 'up'
  // the largest row that points the way the change went; only when none does, the largest of all
  const largest = (keys: ChangeRowKey[]) => keys.reduce((best, k) => (Math.abs(row(p, k)) > Math.abs(row(p, best)) ? k : best))
  const along = CAUSES[p.form].filter(k => Math.sign(row(p, k)) === Math.sign(change))
  const cause = largest(along.length ? along : CAUSES[p.form])
  const params: Story['params'] = { change: Math.abs(change), amount: row(p, cause) }
  if (cause !== 'fx') return { key: `capitalChange.sentence.${dir}${capitalised(cause)}`, params, tail }
  const rate = mainRate(p)
  if (!rate) return { key: `capitalChange.sentence.${dir}FxPlain`, params, tail }
  return { key: `capitalChange.sentence.${dir}${rate.inverse ? 'FxPer' : 'Fx'}`, params: { ...params, currency: rate.currency, from: rate.from, to: rate.to }, tail }
}

/** The rate of the currency whose move changed net worth most, phrased so it reads above 1 ("the ruble: 84 → 92 per dollar": inverse); null — no rate move */
export function mainRate(p: PeriodChange): { currency: string; from: number; to: number; inverse: boolean } | null {
  const byCurrency = new Map<string, number>()
  for (const i of p.items.fx ?? []) byCurrency.set(i.currency, (byCurrency.get(i.currency) ?? 0) + i.amount)
  const currency = [...byCurrency].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0]
  const rate = p.rates.find(r => r.currency === currency)
  if (!rate) return null
  return rate.start >= 1
    ? { currency: rate.currency, from: round2(rate.start), to: round2(rate.end), inverse: false }
    : { currency: rate.currency, from: round2(1 / rate.start), to: round2(1 / rate.end), inverse: true }
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
  if (kind === 'year') return closed.filter(m => m >= shiftMonth(end, -11) && m <= end)
  // the last twelve, or the twelve ending at a picked month older than them, so it stays on the chart
  return closed.filter(m => m <= end).slice(-12).length === 12 && !closed.slice(-12).includes(end) ? closed.filter(m => m <= end).slice(-12) : closed.slice(-12)
}

/**
 * The window's cumulative lines from the end of the month before it. A month that cannot be broken down is a break, and its
 * change counts in neither line. The added line starts on the net worth line at the end of the month before its first
 * tracked month, so the gap between them is what markets, rates and the unexplained did from there.
 */
export function changeHistory(all: (MonthChange | MonthChangeGap)[], window: string[]): { points: ChangePoint[]; largestGap: { month: string; amount: number } | null; takeaway: Story; missing: string[] } {
  const byMonth = new Map(all.map(m => [m.month, m]))
  // the first month of history has no month before it: it is the window's starting point itself
  const first = byMonth.get(window[0])
  const startsAtFirst = !!first && !isMonthChange(first) && first.reason === 'no_previous'
  const months = startsAtFirst ? window.slice(1) : window
  const points: ChangePoint[] = window.length ? [{ month: startsAtFirst ? window[0] : shiftMonth(window[0], -1), netWorth: 0, added: null, markets: 0, unexplained: 0, change: null }] : []
  let netWorth = 0, markets = 0, unexplained = 0
  let added: number | null = null
  const missing: string[] = []
  for (const month of months) {
    const m = byMonth.get(month)
    if (!m || !isMonthChange(m)) { points.push({ month, netWorth: null, added: null, markets: null, unexplained: null, change: null }); missing.push(month); continue }
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
    points.push({ month, netWorth, added, markets, unexplained, change: round2(m.end - m.start) })
  }
  const shown = window.length > MAX_MONTHLY_POINTS
    ? points.filter((p, i) => i === 0 || i === points.length - 1 || Number(p.month.slice(5)) % 3 === 0)
    : points
  const gaps = shown.flatMap(p => (p.netWorth !== null && p.added !== null ? [{ month: p.month, amount: round2(p.netWorth - p.added) }] : []))
  const before = gaps.slice(0, -1)
  const largestGap = before.length ? before.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a)) : null
  // the takeaway reads what markets and rates did, never the unexplained rest the gap between the lines also holds
  const marketRun = shown.flatMap(p => (p.added !== null && p.markets !== null ? [{ month: p.month, amount: p.markets }] : []))
  return { points: shown, largestGap: largestGap?.amount ? largestGap : null, takeaway: takeawayOf(marketRun), missing }
}

function takeawayOf(gaps: { month: string; amount: number }[]): Story {
  const story = (key: string, params: Story['params'] = {}): Story => ({ key: `capitalChange.takeaway.${key}`, params, tail: null })
  const last = gaps.at(-1)
  if (!last) return story('balancesOnly')
  if (last.amount >= 0) return story('marketsHelped')
  const helped = gaps.filter(g => g.amount > 0).at(-1)
  return helped ? story('marketsTookMore', { until: helped.month }) : story('onlyYou')
}

export interface CapitalChangeView {
  /** The last closed month with a breakdown entry, the period's end, its months and every closed month */
  last: string; end: string; months: string[]; all: string[]
  change: PeriodChange | MonthChangeGap
  story: Story | null
  yard: ReturnType<typeof yardstick>
  history: ReturnType<typeof changeHistory>
}

/** Everything the block shows for a period ending at `month` (the last closed month when it is not one); null — no closed month */
export function capitalChangeView(all: (MonthChange | MonthChangeGap)[], kind: AssetPeriod, month: string | null): CapitalChangeView | null {
  const closed = all.map(m => m.month)
  const last = closed.at(-1)
  if (!last) return null
  const end = month && closed.includes(month) ? month : last
  const from = kind === 'all' ? '' : shiftMonth(end, -({ month: 1, quarter: 3, year: 12, all: 0 }[kind] - 1))
  const inRange = closed.filter(m => m >= from && m <= end)
  // the first month of history has nothing before it: the period starts at its end
  const head = all.find(m => m.month === inRange[0])
  const months = head && !isMonthChange(head) && head.reason === 'no_previous' && inRange.length > 1 ? inRange.slice(1) : inRange
  const change = periodChange(all, months)
  const window = historyWindow(closed, kind, end)
  return {
    last, end, months, all: closed, change, story: 'rows' in change ? changeStory(change) : null,
    yard: yardstick(all, window, months), history: changeHistory(all, window),
  }
}
