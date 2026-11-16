// Rules of the month-close wizard: which months wait, which accounts a month needs, when it may be
// closed and what closing writes. Pure functions shared by the server, the screen and tests.
import { ACCOUNT_CLASSES, accountKey, normalizeClass, tracksTransfers, type AccountClass, type AccountKey } from './accounts'
import { isoDate, latestMonth, monthEnd, monthOf, shiftMonth } from './dates'
import { round2 } from './fx'
import { computeSchedule, scheduledPaymentIn, type LoanEarlyPayment, type LoanRow } from './loans'
import type { AccountTransferInput, AssetInput, CashflowInput, LoanPaymentInput } from './types'

export interface AccountClosure { name: string; member: string; closedMonth: string }
export interface DraftRow {
  name: string; member: string; currency: string; class: AccountClass
  /** null — the field is not filled yet; zero is a value */
  balance: number | null; active: number | null; passive: number | null; expense: number | null
  /** The account closes with this month */
  closing: boolean
  /** The account was added in this draft; it was not there last month */
  added: boolean
  /** An investment account (tracksTransfers): what was put in (plus) or taken out (minus) this month; absent or null — not known. Never blocks closing */
  deposited?: number | null
}
/** One loan's line of the month-close wizard: what the schedule asks for and what is going to be written. */
export interface DraftLoanPayment {
  name: string; currency: string
  /** The schedule's payment in the month */
  scheduled: number
  /** null — the field is cleared; zero is a value */
  amount: number | null
}
export interface MonthDraft {
  rows: DraftRow[]
  /** Only what was typed: a loan with no entry is prefilled from its schedule */
  loans?: { name: string; amount: number | null }[]
}
export interface ClosedMonth { month: string; source: 'migration' | 'wizard' }

const MAX_ROWS = 200
const MAX_LOANS = 50
const MAX_TEXT = 100
type ProblemField = 'balance' | 'active' | 'passive' | 'expense'
const FIELDS: readonly ProblemField[] = ['balance', 'active', 'passive', 'expense']
const FLOWS = FIELDS.slice(1)

/** What keeps an account (or the month) from closing; the client renders `monthClose.problem.<code>`. */
export interface MonthProblem {
  code: 'no_accounts' | 'no_name' | 'no_currency' | 'duplicate' | 'missing' | 'negative' | 'loan_payment' | 'over_allocated'
  /** For `missing` and `negative`: the fields concerned, in table order */
  fields?: readonly ProblemField[]
  /** For `loan_payment`: the loan */
  name?: string
  /** For `over_allocated`: the total the lines exceed, the lines' sum and the total, in the account's currency */
  flow?: 'active' | 'passive' | 'expense'
  lines?: number
  total?: number
}

/** An account whose lines by category exceed a total (allocationExcess of its lines), for problemsIn. */
export interface AllocationExcess { name: string; member: string; flow: 'active' | 'passive' | 'expense'; lines: number; total: number }

/** One thing that keeps the month from closing; a loan line's key is `loan:<name>` */
interface ProblemEntry { key: string; name: string; member: string; problem: MonthProblem }

const filled = (v: number | null): v is number => typeof v === 'number' && Number.isFinite(v)
// The name is compared as stored, untrimmed: otherwise an account «Quillmark Bank » would lose what was typed
const keyOf = (row: { name: string; member: string }) => accountKey(row.name, row.member)
/** Text order by character codes (not localeCompare) — the same in the browser and on the server. */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
/** Row order: member, then name. */
const byAccount = (a: DraftRow, b: DraftRow) => compareText(a.member, b.member) || compareText(a.name, b.name)
/** A row with nothing typed yet */
const emptyAmounts = (): Pick<DraftRow, ProblemField> => ({ balance: null, active: null, passive: null, expense: null })
type CurrencyTotals = { currency: string; income: number; expense: number; balanceChange: number }
const emptyTotals = (currency: string): CurrencyTotals => ({ currency, income: 0, expense: 0, balanceChange: 0 })

/** Accounts from balance and flow rows: month, name, member, currency, type. A flow row is always a bank account. */
const balanceAccounts = (balances: AssetInput[]) =>
  balances.map(b => ({ month: monthOf(b.date), name: b.name, member: b.member ?? '', currency: b.currency, class: normalizeClass(b.class) }))
const flowAccounts = (flows: CashflowInput[]) =>
  flows.map(f => ({ month: monthOf(f.date), name: f.bank, member: f.member, currency: f.currency, class: 'bank' as const }))

/** The last finished month: in October it is September. */
export function prevFinishedMonth(today: Date): string {
  return shiftMonth(monthOf(isoDate(today)), -1)
}

/** Finished months after the last closed one, oldest first; an empty history starts with last month. */
export function openMonths(closed: string[], today: Date): string[] {
  const until = prevFinishedMonth(today)
  const last = latestMonth(closed)
  if (last === null) return [until]
  const months: string[] = []
  for (let m = shiftMonth(last, 1); m <= until; m = shiftMonth(m, 1)) months.push(m)
  return months
}

/**
 * The month's accounts: every account with a balance or flows in the previous closed month, except
 * those closed by then, plus the ones added in the draft. Values and the closing flag come from the draft.
 * A flow-only account (no balance ever entered) is asked for too: otherwise its income and
 * expenses would silently vanish from later months.
 */
export function accountsFor(
  prevMonth: string | null, balances: AssetInput[], flows: CashflowInput[], closures: AccountClosure[], draft: MonthDraft | null,
): DraftRow[] {
  // Only those closed exactly last month: a name closed earlier and taken again is a live account
  const gone = new Set(closures.filter(c => c.closedMonth === prevMonth).map(c => accountKey(c.name, c.member)))
  const typed = new Map((draft?.rows ?? []).map(r => [keyOf(r), r]))
  const required = new Map<AccountKey, DraftRow>()
  // Balances first: the type from a balance beats the «bank» of a flow row
  for (const a of [...balanceAccounts(balances), ...flowAccounts(flows)]) {
    if (prevMonth === null || a.month !== prevMonth) continue
    const key = accountKey(a.name, a.member)
    if (gone.has(key) || required.has(key)) continue
    const d = typed.get(key)
    required.set(key, {
      name: a.name, member: a.member, currency: a.currency, class: a.class,
      balance: d?.balance ?? null, active: d?.active ?? null, passive: d?.passive ?? null, expense: d?.expense ?? null,
      closing: d?.closing ?? false, added: false,
      ...(tracksTransfers(a.class) && d?.deposited != null ? { deposited: d.deposited } : {}),
    })
  }
  const added = (draft?.rows ?? []).filter(r => r.added && !required.has(keyOf(r)))
  return [...[...required.values()].sort(byAccount), ...added.sort(byAccount)]
}

export interface AccountInfo { name: string; member: string; currency: string; class: AccountClass }

/** Why an account cannot be added to a draft */
export type NewAccountProblem = 'nameRequired' | 'currencyRequired' | 'duplicate'

/**
 * An account added to a draft (Close month, the setup's accounts step): the trimmed name, no amounts yet, `added`; or why
 * not: no name, no currency, or the same name and member already among `rows` (accountKey).
 */
export function newDraftAccount(values: AccountInfo, rows: DraftRow[]): { row: DraftRow } | { problem: NewAccountProblem } {
  const name = values.name.trim()
  if (!name) return { problem: 'nameRequired' }
  if (!values.currency) return { problem: 'currencyRequired' }
  const key = accountKey(name, values.member)
  if (rows.some(r => accountKey(r.name, r.member) === key)) return { problem: 'duplicate' }
  return { row: { ...values, name, ...emptyAmounts(), closing: false, added: true } }
}

/**
 * The loan lines a draft keeps: only the typed ones, which is every line that differs from its schedule, plus those named in
 * `edited` (typed on the screen, even back to the schedule's amount). The rest are prefilled from the schedule on reading.
 */
export function typedLoanLines(lines: DraftLoanPayment[], edited: Record<string, unknown> | null = null): { name: string; amount: number | null }[] {
  return lines
    .filter(l => (edited !== null && l.name in edited) || l.amount !== l.scheduled)
    .map(({ name, amount }) => ({ name, amount }))
}

/**
 * Accounts seen in the last 12 months that this month does not ask for and that are not closed:
 * if last month was entered only partly, a skipped account comes back in one click.
 */
export function suggestedAccounts(
  prevMonth: string | null, balances: AssetInput[], flows: CashflowInput[], closures: AccountClosure[], current: DraftRow[],
): AccountInfo[] {
  if (prevMonth === null) return []
  const from = shiftMonth(prevMonth, -11)
  const taken = new Set(current.map(keyOf))
  const closedIn = new Map(closures.map(c => [accountKey(c.name, c.member), c.closedMonth]))
  const seen = new Map<AccountKey, AccountInfo & { month: string }>()
  // a balance knows the account type and beats a flow row of the same month, so it comes after it
  for (const a of [...flowAccounts(flows), ...balanceAccounts(balances)]) {
    if (a.month < from || a.month > prevMonth) continue
    const key = accountKey(a.name, a.member)
    if (taken.has(key)) continue
    const prev = seen.get(key)
    if (!prev || a.month >= prev.month) seen.set(key, a)
  }
  return [...seen.entries()]
    .filter(([key, a]) => !((closedIn.get(key) ?? '') >= a.month))
    .map(([, a]) => ({ name: a.name, member: a.member, currency: a.currency, class: a.class }))
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.member, b.member))
}

const byName = (a: { name: string }, b: { name: string }) => compareText(a.name, b.name)

/**
 * The month's loan lines: every loan the schedule (with its own early payments) asks a payment for in the month,
 * plus the ones the draft typed an entry for. The amount is the typed entry if there is one, else the schedule's.
 * A loan closed before the month asks for nothing; a closed loan without a close date asks while its schedule does.
 */
export function loanPaymentsFor(month: string, loans: LoanRow[], earlyPayments: LoanEarlyPayment[], draft: MonthDraft | null): DraftLoanPayment[] {
  const typed = new Map((draft?.loans ?? []).map(l => [l.name, l.amount]))
  return loans.flatMap(loan => {
    const closed = loan.status === 'closed' && !!loan.closed_date && monthOf(String(loan.closed_date)) < month
    const scheduled = closed ? 0 : round2(scheduledPaymentIn(computeSchedule(loan, earlyPayments.filter(e => e.loan_name === loan.name)), month))
    if (!(scheduled > 0) && !typed.has(loan.name)) return []
    return [{ name: loan.name, currency: loan.currency, scheduled, amount: typed.has(loan.name) ? typed.get(loan.name) ?? null : scheduled }]
  }).sort(byName)
}

/**
 * A draft from rows already stored for this month (entered past the wizard or returned when a
 * closing is undone); a flow-only account is included too, without a balance.
 */
export function draftFromRows(
  month: string, balances: AssetInput[], flows: CashflowInput[], before: Set<AccountKey>, closing: Set<AccountKey>, payments: LoanPaymentInput[] = [],
  transfers: AccountTransferInput[] = [],
): MonthDraft {
  const rows = new Map<AccountKey, DraftRow>()
  for (const b of balances) {
    if (monthOf(b.date) !== month) continue
    const key = accountKey(b.name, b.member)
    rows.set(key, {
      name: b.name, member: b.member ?? '', currency: b.currency, class: normalizeClass(b.class),
      ...emptyAmounts(), balance: b.value, closing: closing.has(key), added: !before.has(key),
    })
  }
  for (const f of flows) {
    if (monthOf(f.date) !== month) continue
    const key = accountKey(f.bank, f.member)
    const row = rows.get(key) ?? {
      name: f.bank, member: f.member, currency: f.currency, class: 'bank' as AccountClass,
      ...emptyAmounts(), closing: closing.has(key), added: !before.has(key),
    }
    rows.set(key, { ...row, active: f.active_income, passive: f.passive_income, expense: f.expense })
  }
  for (const t of transfers) {
    const row = monthOf(t.date) === month ? rows.get(accountKey(t.name, t.member)) : undefined
    if (row) row.deposited = t.amount
  }
  const loans = payments.filter(p => monthOf(p.date) === month).map(p => ({ name: p.loan_name, amount: p.amount }))
  return loans.length ? { rows: [...rows.values()], loans } : { rows: [...rows.values()] }
}

/** Last month's balances — a hint next to the field, not its value. */
export function hintsFor(prevMonth: string | null, balances: AssetInput[]): Record<AccountKey, number> {
  const hints: Record<AccountKey, number> = {}
  if (prevMonth === null) return hints
  for (const b of balances) if (monthOf(b.date) === prevMonth) hints[accountKey(b.name, b.member)] = b.value
  return hints
}

/** Last month's figure of a flow field, and whether it is steady (the same in one of the two closed months before). */
export interface FlowHint { last: number; steady: boolean }
export type FlowHints = Record<AccountKey, Partial<Record<'active' | 'passive' | 'expense', FlowHint>>>
const FLOW_COLUMNS = { active: 'active_income', passive: 'passive_income', expense: 'expense' } as const

/**
 * Suggestions for the flow fields, learned from the history instead of declared: last closed month's figure per account
 * and field, steady when it repeats exactly in one of the two closed months before it (no average: it would invent a
 * figure that never existed). `legacyExpense(month)` marks a month whose expenses still held the loan payments (closed
 * before they were entered apart): an expense is never steady against it. Nothing is filled in: the screen offers it.
 */
export function flowHintsFor(closedMonths: readonly string[], flows: CashflowInput[], legacyExpense: (month: string) => boolean): FlowHints {
  const [last, ...before] = [...closedMonths].sort().reverse().slice(0, 3)
  const hints: FlowHints = {}
  if (last === undefined) return hints
  const rowsIn = (month: string) => new Map(flows.filter(f => monthOf(f.date) === month).map(f => [accountKey(f.bank, f.member), f]))
  const earlier = before.map(month => ({ month, rows: rowsIn(month) }))
  for (const [key, row] of rowsIn(last)) {
    const hint: FlowHints[AccountKey] = {}
    for (const [field, column] of Object.entries(FLOW_COLUMNS) as [keyof typeof FLOW_COLUMNS, typeof FLOW_COLUMNS[keyof typeof FLOW_COLUMNS]][]) {
      const value = round2(row[column])
      const comparable = (month: string) => field !== 'expense' || (!legacyExpense(last) && !legacyExpense(month))
      const steady = earlier.some(e => comparable(e.month) && e.rows.has(key) && round2(e.rows.get(key)![column]) === value)
      hint[field] = { last: value, steady }
    }
    hints[key] = hint
  }
  return hints
}

/** A typed balance next to last month's: the difference, and a warning a typo is likely. Not a problem: it does not block closing. */
export interface BalanceCheck {
  diff: number
  /** `magnitude` — five or more times larger or smaller (a zero too many or too few); `sign` — the sign flipped */
  warning: 'magnitude' | 'sign' | null
  /** For `magnitude`: how many times, rounded */
  times: number | null
}

/** The balance `value` checked against last month's `previous`. Zero is a value (the account was emptied), never a warning. */
export function balanceCheck(value: number, previous: number): BalanceCheck {
  const diff = round2(value - previous)
  const ratio = previous === 0 ? 0 : value / previous
  if (ratio >= 5 || (ratio > 0 && ratio <= 0.2)) return { diff, warning: 'magnitude', times: Math.round(Math.max(ratio, 1 / ratio)) }
  if (ratio < 0) return { diff, warning: 'sign', times: null }
  return { diff, warning: null, times: null }
}

/**
 * What keeps the month from closing: one entry per account, then per loan line (key `loan:<name>`, the name is in the
 * problem), then per account whose lines exceed a total (`excess`, from allocationExcess; the server enforces the same
 * rule at close); empty — it may close. Without the cash-flow module only the balance is needed.
 */
export function problemsIn(rows: DraftRow[], flows = true, loans: DraftLoanPayment[] = [], excess: readonly AllocationExcess[] = []): ProblemEntry[] {
  if (!rows.length) return [{ key: '', name: '', member: '', problem: { code: 'no_accounts' } }]
  const seen = new Map<AccountKey, number>()
  for (const r of rows) seen.set(keyOf(r), (seen.get(keyOf(r)) ?? 0) + 1)
  const fields = flows ? FIELDS : FIELDS.filter(f => f === 'balance')
  const problems: ProblemEntry[] = []
  for (const r of rows) {
    const empty = fields.filter(f => !filled(r[f]))
    const negative = flows ? FLOWS.filter(f => filled(r[f]) && r[f] < 0) : []
    const problem: MonthProblem | null = !r.name.trim() ? { code: 'no_name' }
      : !r.currency.trim() ? { code: 'no_currency' }
        : (seen.get(keyOf(r)) ?? 0) > 1 ? { code: 'duplicate' }
          : empty.length ? { code: 'missing', fields: empty }
            : negative.length ? { code: 'negative', fields: negative }
              : null
    if (problem) problems.push({ key: keyOf(r), name: r.name, member: r.member, problem })
  }
  // the name stays in the problem, not in the entry: the text of a loan problem already names the loan
  for (const l of loans) {
    if (!filled(l.amount) || l.amount < 0) problems.push({ key: `loan:${l.name}` as const, name: '', member: '', problem: { code: 'loan_payment', name: l.name } })
  }
  if (flows) {
    for (const e of excess) {
      problems.push({ key: keyOf(e), name: e.name, member: e.member, problem: { code: 'over_allocated', flow: e.flow, lines: e.lines, total: e.total } })
    }
  }
  return problems
}

/** Rows that close the month: the balance on the last day, flows and loan payments on the first; zeros are written explicitly. While income and expenses are not tracked — balances only. */
export function closingWrites(month: string, rows: DraftRow[], flows = true, loans: DraftLoanPayment[] = []): {
  assets: AssetInput[]; cashflow: CashflowInput[]; loanPayments: LoanPaymentInput[]; closures: AccountClosure[]; transfers: AccountTransferInput[]
} {
  return {
    assets: rows.map(r => ({
      date: monthEnd(month), class: r.class, name: r.name, value: r.balance ?? 0, currency: r.currency, member: r.member || null,
    })),
    cashflow: flows ? rows.map(r => ({
      date: `${month}-01`, bank: r.name, member: r.member,
      active_income: r.active ?? 0, passive_income: r.passive ?? 0, expense: r.expense ?? 0, currency: r.currency,
    })) : [],
    loanPayments: flows ? loans.map(l => ({ date: `${month}-01`, loan_name: l.name, amount: l.amount ?? 0, currency: l.currency })) : [],
    closures: rows.filter(r => r.closing).map(r => ({ name: r.name, member: r.member, closedMonth: month })),
    // only what was typed: an empty field writes no row (not known), a zero writes zero
    transfers: rows.filter(r => tracksTransfers(r.class) && filled(r.deposited ?? null))
      .map(r => ({ date: `${month}-01`, name: r.name, member: r.member, amount: r.deposited!, currency: r.currency })),
  }
}

/** Per-currency totals for a self-check: flows from rows entered in full (and the loan payments, as expenses), balances against last month. */
export function draftTotals(rows: DraftRow[], hints: Record<AccountKey, number>, flows = true, loans: DraftLoanPayment[] = []): CurrencyTotals[] {
  const totals = new Map<string, CurrencyTotals>()
  for (const r of rows) {
    const t = totals.get(r.currency) ?? emptyTotals(r.currency)
    if (flows && filled(r.active) && filled(r.passive) && filled(r.expense)) {
      t.income += r.active + r.passive
      t.expense += r.expense
    }
    if (filled(r.balance)) t.balanceChange += r.balance - (hints[keyOf(r)] ?? 0)
    totals.set(r.currency, t)
  }
  if (flows) {
    for (const l of loans) {
      if (!filled(l.amount)) continue
      const t = totals.get(l.currency) ?? emptyTotals(l.currency)
      t.expense += l.amount
      totals.set(l.currency, t)
    }
  }
  return [...totals.values()].sort((a, b) => compareText(a.currency, b.currency))
}

/** Old months closed before the wizard where an account of the previous month has no balance or flows. */
export function incompleteMonths(months: ClosedMonth[], assets: AssetInput[], cashflow: CashflowInput[], flows = true): { month: string; missing: number }[] {
  const migrated = months.filter(m => m.source === 'migration').map(m => m.month).sort()
  const balances = new Set(assets.map(a => `${monthOf(a.date)}|${accountKey(a.name, a.member)}`))
  const flowKeys = new Set(cashflow.map(c => `${monthOf(c.date)}|${accountKey(c.bank, c.member)}`))
  const result = []
  for (let i = 1; i < migrated.length; i++) {
    const [prev, month] = [migrated[i - 1], migrated[i]]
    if (shiftMonth(prev, 1) !== month) continue
    const accounts = new Set(assets.filter(a => monthOf(a.date) === prev).map(a => accountKey(a.name, a.member)))
    const missing = [...accounts].filter(key => !balances.has(`${month}|${key}`) || (flows && !flowKeys.has(`${month}|${key}`))).length
    if (missing) result.push({ month, missing })
  }
  return result
}

const isText = (v: unknown, limit = MAX_TEXT): v is string => typeof v === 'string' && v.length <= limit
const isValue = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v))

/** A draft from a request body: extra keys are dropped, a wrong shape is an error naming the field. */
export function parseDraft(body: unknown): MonthDraft {
  const { rows, loans } = (body ?? {}) as { rows?: unknown; loans?: unknown }
  if (!Array.isArray(rows)) throw new Error('Expected rows')
  if (rows.length > MAX_ROWS) throw new Error('Too many rows')
  if (loans !== undefined && !Array.isArray(loans)) throw new Error('Expected loans')
  if (loans && loans.length > MAX_LOANS) throw new Error('Too many loans')
  return {
    ...(loans && {
      loans: loans.map((raw, i) => {
        const l = (raw ?? {}) as Record<string, unknown>
        if (!isText(l.name, 1000)) throw new Error(`Invalid name in loan ${i + 1}`)
        if (!isValue(l.amount)) throw new Error(`Invalid amount in loan ${i + 1}`)
        return { name: l.name, amount: l.amount }
      }),
    }),
    rows: rows.map((raw, i) => {
      const r = (raw ?? {}) as Record<string, unknown>
      for (const f of ['name', 'member', 'currency'] as const) if (!isText(r[f], f === 'name' ? 1000 : MAX_TEXT)) throw new Error(`Invalid ${f} in row ${i + 1}`)
      if (!(ACCOUNT_CLASSES as readonly unknown[]).includes(r.class)) throw new Error(`Invalid class in row ${i + 1}`)
      for (const f of FIELDS) if (!isValue(r[f])) throw new Error(`Invalid ${f} in row ${i + 1}`)
      for (const f of ['closing', 'added'] as const) if (typeof r[f] !== 'boolean') throw new Error(`Invalid ${f} in row ${i + 1}`)
      // a draft saved before the field existed has none
      if (r.deposited !== undefined && !isValue(r.deposited)) throw new Error(`Invalid deposited in row ${i + 1}`)
      return {
        name: r.name as string, member: r.member as string, currency: r.currency as string, class: r.class as AccountClass,
        balance: r.balance as number | null, active: r.active as number | null, passive: r.passive as number | null, expense: r.expense as number | null,
        closing: r.closing as boolean, added: r.added as boolean,
        ...(typeof r.deposited === 'number' ? { deposited: r.deposited } : {}),
      }
    }),
  }
}
