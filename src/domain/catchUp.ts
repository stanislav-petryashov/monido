// Catching up after a pause: the months a family missed, all but the newest, closed on one grid of month-end balances.
// Pure: which months the grid takes, its rows, what is missing and what closing writes. Income and expenses of those months
// stay unrecorded (no monthly_cashflow rows), which is how the domain tells them from months of real zeros.
import { accountKey, type AccountClass } from './accounts'
import { monthOf } from './dates'
import { accountsFor, closingWrites, type AccountClosure, type DraftRow, type MonthDraft } from './monthClose'
import type { AssetInput, CashflowInput } from './types'

/** One account of the grid; `cells[i]` is the balance at the end of the grid's `months[i]`, null when not typed yet */
export interface CatchUpRow { name: string; member: string; currency: string; class: AccountClass; cells: (number | null)[] }

/**
 * The open months the grid takes: all but the newest (closed in the wizard, so the monthly figures are fresh), and only up to
 * the first month that already has income or expense data, which is left to the wizard and named. Below two open months: none.
 */
export function catchUpMonths(queue: readonly string[], hasData: (month: string) => boolean): { months: string[]; leftOut: string | null } {
  if (queue.length < 2) return { months: [], leftOut: null }
  const months: string[] = []
  for (const month of queue.slice(0, -1)) {
    if (hasData(month)) return { months, leftOut: month }
    months.push(month)
  }
  return { months, leftOut: null }
}

/** A wizard draft holds more than balances: any flow, transfer or loan figure, or an account added or closing in it. */
export function draftHasData(draft: MonthDraft | null): boolean {
  if (!draft) return false
  return draft.rows.some(r => r.active !== null || r.passive !== null || r.expense !== null || (r.deposited ?? null) !== null || r.added || r.closing)
    || (draft.loans ?? []).some(l => l.amount !== null)
}

/**
 * The grid's rows: the accounts the first grid month asks for (the month before's, less those closed then). A cell starts
 * from a balance already entered for that month (closing replaces it, as the wizard does), else from a balances-only draft.
 */
export function catchUpRows(
  prevMonth: string | null, months: readonly string[], assets: AssetInput[], cashflow: CashflowInput[], closures: AccountClosure[],
  drafts: Readonly<Record<string, MonthDraft | null>>,
): CatchUpRow[] {
  return accountsFor(prevMonth, assets, cashflow, closures, null).map(a => {
    const key = accountKey(a.name, a.member)
    const cells = months.map(month => {
      const stored = assets.find(b => monthOf(b.date) === month && accountKey(b.name, b.member) === key)
      if (stored) return stored.value
      return drafts[month]?.rows.find(r => accountKey(r.name, r.member) === key)?.balance ?? null
    })
    return { name: a.name, member: a.member, currency: a.currency, class: a.class, cells }
  })
}

/** The grey hint under an empty cell: the nearest typed cell to its left, else the last known balance before the grid */
export function cellHint(row: CatchUpRow, index: number, lastKnown: number | undefined): number | undefined {
  for (let i = index - 1; i >= 0; i--) if (row.cells[i] !== null) return row.cells[i] as number
  return lastKnown
}

/** The months with empty cells and how many, oldest first: what keeps "Close" off. Zero and negative balances are values. */
export function catchUpProblems(months: readonly string[], rows: readonly CatchUpRow[]): { month: string; missing: number }[] {
  return months.map((month, i) => ({ month, missing: rows.filter(r => r.cells[i] === null).length })).filter(p => p.missing > 0)
}

const asDraftRow = (r: CatchUpRow, balance: number | null): DraftRow => ({
  name: r.name, member: r.member, currency: r.currency, class: r.class, balance, active: null, passive: null, expense: null, closing: false, added: false,
})

/** What closing writes, month by month: the month-end balances only (no flows, transfers or loan payments). */
export function catchUpWrites(months: readonly string[], rows: readonly CatchUpRow[]): { month: string; assets: AssetInput[] }[] {
  return months.map((month, i) => ({ month, assets: closingWrites(month, rows.map(r => asDraftRow(r, r.cells[i])), false).assets }))
}
