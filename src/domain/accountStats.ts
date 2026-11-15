import { shiftMonth } from './dates'
import { round2 } from './fx'

/** A finding about the account: a locale key (`pages.accounts.finding.*`) and its params; amounts in the account's currency */
export interface AccountFinding { key: string; params: Record<string, string | number> }

export interface AccountStats {
  /** The balance at the end of `lastMonth`; null — the account has no row there */
  last: number | null
  monthChange: number | null; monthPct: number | null
  /** Against the balance 12 months before `lastMonth`; null — no row then */
  yearChange: number | null; yearPct: number | null
  /** Over the 12 months up to `lastMonth`; null — fewer than 3 balances there */
  range: { min: number; minMonth: string; max: number; maxMonth: string; avg: number } | null
  /** Every month from the first balance to the last one: null for the first and for a month or its previous one without a balance */
  changes: { month: string; change: number | null }[]
  /** One row per calendar year of the history, 12 cells: a month's change, null — no change known */
  heat: { year: string; cells: ({ month: string; change: number } | null)[] }[]
  /** Months of the 12 up to `lastMonth` the balance rose / fell */
  upMonths12: number; downMonths12: number
  /** Any month with a non-zero income or expense */
  hasFlows: boolean
  flows12: { income: number; expense: number; left: number }
  findings: AccountFinding[]
}

/** A month's expense this many times the 12-month average is a peak */
const PEAK = 1.6
/** A balance under this share of its yearly average is a finding */
const BELOW = 0.9

const pct = (change: number | null, base: number | undefined) => (change === null || !base ? null : (change / Math.abs(base)) * 100)

/**
 * What the account's detail shows, from its month-end balances and monthly flows in its own currency. Months after
 * `lastMonth` (the last closed month) are not counted.
 */
export function accountStats(
  balances: { month: string; value: number }[], flows: { month: string; income: number; expense: number }[], lastMonth: string,
): AccountStats {
  const bal = new Map(balances.filter(b => b.month <= lastMonth).map(b => [b.month, b.value]))
  const flowRows = flows.filter(f => f.month <= lastMonth)
  const months = [...bal.keys()].sort()
  const from12 = shiftMonth(lastMonth, -11)
  const in12 = (m: string) => m >= from12 && m <= lastMonth

  const changes: AccountStats['changes'] = []
  if (months.length) {
    for (let m = months[0]; m <= months[months.length - 1]; m = shiftMonth(m, 1)) {
      const v = bal.get(m), p = bal.get(shiftMonth(m, -1))
      changes.push({ month: m, change: v === undefined || p === undefined ? null : round2(v - p) })
    }
  }
  const changeOf = new Map(changes.map(c => [c.month, c.change]))

  const last = bal.get(lastMonth) ?? null
  const monthChange = changeOf.get(lastMonth) ?? null
  const yearAgo = bal.get(shiftMonth(lastMonth, -12))
  const yearChange = last === null || yearAgo === undefined ? null : round2(last - yearAgo)

  const points = months.filter(in12).map(m => ({ month: m, value: bal.get(m)! }))
  let range: AccountStats['range'] = null
  if (points.length >= 3) {
    const min = points.reduce((a, b) => (b.value < a.value ? b : a))
    const max = points.reduce((a, b) => (b.value > a.value ? b : a))
    range = { min: min.value, minMonth: min.month, max: max.value, maxMonth: max.month, avg: round2(points.reduce((s, p) => s + p.value, 0) / points.length) }
  }

  const changes12 = changes.filter(c => in12(c.month) && c.change !== null).map(c => c.change!)
  const upMonths12 = changes12.filter(c => c > 0).length
  const downMonths12 = changes12.filter(c => c < 0).length

  const heat: AccountStats['heat'] = []
  if (months.length) {
    for (let y = Number(months[0].slice(0, 4)); y <= Number(months[months.length - 1].slice(0, 4)); y++) {
      heat.push({
        year: String(y),
        cells: Array.from({ length: 12 }, (_, i) => {
          const month = `${y}-${String(i + 1).padStart(2, '0')}`
          const change = changeOf.get(month)
          return change == null ? null : { month, change }
        }),
      })
    }
  }

  const flows12rows = flowRows.filter(f => in12(f.month))
  const income = round2(flows12rows.reduce((s, f) => s + f.income, 0))
  const expense = round2(flows12rows.reduce((s, f) => s + f.expense, 0))

  const findings: AccountFinding[] = []
  if (changes12.length >= 3) {
    findings.push(upMonths12 === 12
      ? { key: 'pages.accounts.finding.grewAll', params: { count: upMonths12, of: changes12.length } }
      : { key: 'pages.accounts.finding.grew', params: { count: upMonths12, of: changes12.length } })
  }
  if (flows12rows.length) {
    // over the window's months with flows: a short history is not diluted by months it never had
    const average = expense / flows12rows.length
    const peak = flows12rows.reduce((a, b) => (b.expense > a.expense ? b : a))
    if (average > 0 && peak.expense >= average * PEAK) {
      findings.push({ key: 'pages.accounts.finding.expensePeak', params: { month: peak.month, amount: peak.expense, average: round2(average) } })
    }
  }
  // «below its average» reads only for a positive average: under a negative one 90% of it is above it
  if (range && range.avg > 0 && last !== null && last < range.avg * BELOW) {
    findings.push({ key: 'pages.accounts.finding.belowAverage', params: { amount: round2(range.avg - last) } })
  }

  return {
    last, monthChange, monthPct: pct(monthChange, bal.get(shiftMonth(lastMonth, -1))),
    yearChange, yearPct: pct(yearChange, yearAgo),
    range, changes, heat, upMonths12, downMonths12,
    hasFlows: flowRows.some(f => f.income !== 0 || f.expense !== 0),
    flows12: { income, expense, left: round2(income - expense) },
    findings,
  }
}
