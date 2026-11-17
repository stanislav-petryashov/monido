// Importing the months before the wizard from a spreadsheet: month-end balances of the accounts, each month closed whole.
// Pure: the server checks the plan against its data and writes it in one batch (src/server/historyImport.ts).
import { ACCOUNT_CLASSES, accountKey } from './accounts'
import { MONTH_RE, monthEnd, shiftMonth } from './dates'
import { prevFinishedMonth } from './monthClose'
import type { AssetInput } from './types'

/** One account of the import: a column of the sheet, or the account a long sheet names; `class` one of ACCOUNT_CLASSES */
export interface HistoryAccount { name: string; member: string; class: string; currency: string }
/** The sheet as the client read it: per month, the accounts' balances in `accounts` order; null — a blank cell */
export interface HistoryInput { accounts: HistoryAccount[]; months: { month: string; values: (number | null)[] }[] }

/** What the plan checks the sheet against: the closed months, the accounts already recorded, the project's currencies and members */
export interface HistoryContext {
  closedMonths: string[]
  accounts: { name: string; member: string; class: string; currency: string }[]
  currencies: string[]
  members: string[]
  today: Date
}

export type HistoryProblemCode =
  | 'no_months' | 'too_many_months' | 'too_many_accounts' | 'bad_month' | 'duplicate_month' | 'month_missing' | 'future_month'
  | 'not_before_closed' | 'not_adjacent' | 'bad_row'
  | 'bad_account' | 'duplicate_account' | 'unknown_currency' | 'unknown_member' | 'account_mismatch'
  | 'bad_value' | 'no_values' | 'blank_inside'
/** A reason the sheet cannot be imported, as a code and its params for the text */
export interface HistoryProblem { code: HistoryProblemCode; params?: Record<string, string | number> }

export interface HistoryPlan {
  /** The months the import closes, oldest first */
  months: string[]
  balances: AssetInput[]
  /** Accounts that end inside the import (or are not in the history after it): closed at their last balance */
  closures: { name: string; member: string; closedMonth: string }[]
  /** Accounts the history does not have yet */
  newAccounts: number
  /** Empty — the plan can be written */
  problems: HistoryProblem[]
}

export const MAX_HISTORY_MONTHS = 600
export const MAX_HISTORY_ACCOUNTS = 100
const MAX_NAME = 100

/**
 * The plan of an import: only months before the first closed month, ending right before it (with nothing closed, at
 * the last finished month at the latest), with no month missing in between, every value a number or blank. An account
 * blank before its first balance opens later; blank after its last one it ends there (a closure); blank between them
 * would leave a month partial, so it is a problem. Nothing is written while there is a problem.
 */
export function planHistoryImport(input: HistoryInput, ctx: HistoryContext): HistoryPlan {
  const problems: HistoryProblem[] = []
  const add = (code: HistoryProblemCode, params?: HistoryProblem['params']) => { problems.push(params ? { code, params } : { code }) }
  const empty = (): HistoryPlan => ({ months: [], balances: [], closures: [], newAccounts: 0, problems })

  if (!input.months.length) { add('no_months'); return empty() }
  if (input.months.length > MAX_HISTORY_MONTHS) { add('too_many_months', { max: MAX_HISTORY_MONTHS }); return empty() }
  if (input.accounts.length > MAX_HISTORY_ACCOUNTS) { add('too_many_accounts', { max: MAX_HISTORY_ACCOUNTS }); return empty() }

  // the months
  const rows = [...input.months].sort((a, b) => a.month.localeCompare(b.month))
  const seen = new Set<string>()
  for (const r of rows) {
    if (!MONTH_RE.test(r.month)) add('bad_month', { month: r.month })
    else if (seen.has(r.month)) add('duplicate_month', { month: r.month })
    seen.add(r.month)
    if (r.values.length !== input.accounts.length) add('bad_row', { month: r.month })
  }
  if (problems.length) return empty()
  const months = rows.map(r => r.month)
  for (let i = 1; i < months.length; i++) {
    for (let m = shiftMonth(months[i - 1], 1); m < months[i]; m = shiftMonth(m, 1)) add('month_missing', { month: m })
  }
  const last = months[months.length - 1]
  const firstClosed = [...ctx.closedMonths].sort()[0] ?? null
  if (firstClosed === null) {
    const until = prevFinishedMonth(ctx.today)
    if (last > until) add('future_month', { month: months.find(m => m > until)! })
  } else if (last >= firstClosed) add('not_before_closed', { month: firstClosed })
  else if (last !== shiftMonth(firstClosed, -1)) add('not_adjacent', { month: shiftMonth(firstClosed, -1) })

  // the accounts
  const existing = new Map(ctx.accounts.map(a => [accountKey(a.name, a.member), a]))
  const keys = new Set<string>()
  let newAccounts = 0
  input.accounts.forEach((a, i) => {
    const name = a.name.trim()
    if (!name || name.length > MAX_NAME || !(ACCOUNT_CLASSES as readonly string[]).includes(a.class)) { add('bad_account', { column: i + 1 }); return }
    const key = accountKey(name, a.member)
    if (keys.has(key)) add('duplicate_account', { name })
    keys.add(key)
    if (!ctx.currencies.includes(a.currency)) add('unknown_currency', { name, currency: a.currency })
    if (a.member && !ctx.members.includes(a.member)) add('unknown_member', { name, member: a.member })
    const known = existing.get(key)
    if (!known) newAccounts++
    else if (known.class !== a.class || known.currency !== a.currency) add('account_mismatch', { name })
  })

  // the values
  const balances: AssetInput[] = []
  const closures: HistoryPlan['closures'] = []
  input.accounts.forEach((a, i) => {
    const name = a.name.trim()
    const cells = rows.map(r => r.values[i])
    const bad = cells.findIndex(v => v !== null && !Number.isFinite(v))
    if (bad >= 0) { add('bad_value', { name, month: months[bad] }); return }
    const first = cells.findIndex(v => v !== null)
    if (first < 0) { add('no_values', { name }); return }
    const lastValue = cells.length - 1 - [...cells].reverse().findIndex(v => v !== null)
    const blank = cells.findIndex((v, j) => j > first && j < lastValue && v === null)
    if (blank >= 0) { add('blank_inside', { name, month: months[blank] }); return }
    const continues = existing.has(accountKey(name, a.member))
    // an account the later history has must reach the end of the import, or the month before the history is partial
    if (continues && lastValue < cells.length - 1) { add('blank_inside', { name, month: months[lastValue + 1] }); return }
    // a new account ends at its last balance, unless it is open at the end of an import with no history after it (the wizard asks for it next)
    if (!continues && (lastValue < cells.length - 1 || firstClosed !== null)) closures.push({ name, member: a.member, closedMonth: months[lastValue] })
    for (let j = first; j <= lastValue; j++) {
      balances.push({ date: monthEnd(months[j]), class: a.class, name, value: cells[j]!, currency: a.currency, member: a.member || null })
    }
  })
  return problems.length ? empty() : { months, balances, closures, newAccounts, problems }
}
