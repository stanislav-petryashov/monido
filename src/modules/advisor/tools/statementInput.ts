// Reading and checking a statement preview's input against the month being filled: every refusal is an InputError with a
// code and params, raised before anything is staged or written. The checks run in a fixed order (month, account, flows tracked,
// figures, new account (and a look-alike of an existing one), loan lines, categories, the totals the lines leave missing, the cap, period, note).
import { ACCOUNT_CLASSES, accountKey, similarNames, type AccountClass } from '../../../domain/accounts'
import { isDay, monthEnd } from '../../../domain/dates'
import { round2 } from '../../../domain/fx'
import type { DraftRow } from '../../../domain/monthClose'
import { allocationExcess, totalsOfLines } from '../../../domain/spending'
import { carriedFigures, type StatementAccount, type StatementFigures, type StatementLoanLine } from '../../../domain/statements'
import type { CategoryFlow, SpendingCategory } from '../../../domain/types'
import { InputError } from '../../../server/http'
import { isObject, readText } from '../../cashflow/spending'
import { bodyOf, invalid, missing, nonEmptyString } from '../input'
import type { MonthView } from './monthDraft'

/** One line of the account: a category (its flow decides the side) and the month's amount, in the account's currency. */
export interface StatementItem { categoryId: number; amount: number }

/** A statement checked against the month: what to merge into the draft and what to show. */
export interface ParsedStatement {
  month: string
  account: StatementAccount
  figures: StatementFigures
  loans: StatementLoanLine[]
  /** null — no lines given: the account's lines stay as they are; a list (even empty) replaces them */
  categories: StatementItem[] | null
  /** The flows whose total was not given and is the sum of that flow's lines */
  derived: CategoryFlow[]
  period: { from: string | null; to: string | null }
  note: string | null
}

/** A preview's warning: a code with params, never a text */
export interface Warning { code: string; params?: Record<string, unknown> }

/** The longest note a preview carries (shown, not stored) */
export const MAX_NOTE = 200
const MAX_ITEMS = 100
const MAX_LOANS = 50
export const FLOWS = ['active', 'passive', 'expense'] as const

/** True when any figure of the row is filled. */
export const isFilled = (r: DraftRow) => [r.balance, r.active, r.passive, r.expense].some(v => v !== null)

/** Larger than any family's figure: past it a statement was misread. */
const MAX_AMOUNT = 1e12

/** A finite number within ±MAX_AMOUNT, to the cent; below zero is `invalid_amount` unless a negative one is allowed (the balance). */
function amountOf(value: unknown, param: string, negative = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_AMOUNT) throw invalid(param)
  if (value < 0 && !negative) throw new InputError('invalid_amount')
  return round2(value)
}

/** An optional date `YYYY-MM-DD` that exists; null when absent. */
function dateOf(value: unknown, param: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !isDay(value)) throw invalid(param)
  return value
}

function flagOf(value: unknown, param: string): boolean {
  if (value === undefined || value === null) return false
  if (typeof value !== 'boolean') throw invalid(param)
  return value
}

function loanLinesOf(raw: unknown, view: MonthView): StatementLoanLine[] {
  if (!Array.isArray(raw) || raw.length > MAX_LOANS) throw invalid('loanPayments')
  const lines: StatementLoanLine[] = []
  for (const item of raw) {
    if (!isObject(item)) throw invalid('loanPayments')
    const name = nonEmptyString(item.name, 'loanPayments')
    if (lines.some(l => l.name === name)) throw invalid('loanPayments')
    // the name is only looked up among the family's loans, never stored as given
    if (!view.loanPayments.some(l => l.name === name)) throw new InputError('advisor.unknown_loan', 400, { name })
    const line: StatementLoanLine = { name, amount: amountOf(item.amount, 'loanPayments') }
    // the bank's remaining balance: only compared with the schedule, never stored
    if (item.balance !== undefined) line.balance = amountOf(item.balance, 'loanPayments')
    lines.push(line)
  }
  return lines
}

/** The account's lines: one per category, never the reserved loan one (loan repayments go to loanPayments), in the account's currency. */
function itemsOf(raw: unknown, currency: string, categoryMap: ReadonlyMap<number, SpendingCategory>): StatementItem[] {
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) throw invalid('categories')
  const items: StatementItem[] = []
  for (const item of raw) {
    if (!isObject(item)) throw invalid('categories')
    const categoryId = item.categoryId
    const category = typeof categoryId === 'number' ? categoryMap.get(categoryId) : undefined
    if (!category) throw new InputError('advisor.unknown_category', 400, { categoryId: typeof categoryId === 'number' ? categoryId : String(categoryId) })
    if (category.kind === 'loan_payment') throw new InputError('invalid_category_flow', 400, { param: 'loanPayments' })
    const amount = amountOf(item.amount, 'categories')
    if (typeof item.currency !== 'string') throw invalid('categories')
    if (item.currency !== currency) throw new InputError('advisor.currency_mismatch', 409, { expected: currency, got: item.currency })
    if (items.some(i => i.categoryId === category.id)) throw invalid('categories')
    items.push({ categoryId: category.id, amount })
  }
  return items
}

/** The account's lines as the month holds them now (none for an account not in the draft yet). */
const storedLines = (view: MonthView, account: { name: string; member: string }): StatementItem[] =>
  view.accountLines.find(a => accountKey(a.bank, a.member) === accountKey(account.name, account.member))?.items ?? []

/**
 * Checks `input` against the month being filled (`view`) and the categories that exist (`categoryMap`, by id).
 * While Cash flow is on, a total that is not given is the sum of its flow's lines when lines of that flow are given
 * (`derived`); the lines — the given ones, or else those the account holds — may not exceed the totals.
 * @throws InputError with the code of the first check that fails
 */
export function parseStatement(input: unknown, view: MonthView, categoryMap: ReadonlyMap<number, SpendingCategory>): ParsedStatement {
  const b = bodyOf(input)
  const month = nonEmptyString(b.month, 'month')
  if (view.month !== month) throw new InputError('month_out_of_order', 409)

  if (b.account === undefined || b.account === null) throw missing('account')
  if (!isObject(b.account)) throw invalid('account')
  const a = b.account
  if (a.member !== undefined && typeof a.member !== 'string') throw invalid('account.member')
  const given = { name: nonEmptyString(a.name, 'account.name'), member: a.member ?? '', currency: nonEmptyString(a.currency, 'account.currency') }
  const added = flagOf(a.added, 'account.added')
  const carried = flagOf(a.carried, 'account.carried')
  const confirmedNew = flagOf(a.confirmed_new, 'account.confirmed_new')
  if (a.class !== undefined && typeof a.class !== 'string') throw invalid('account.class')
  const cls = a.class

  const find = (name: string, member: string) => view.rows.find(r => accountKey(r.name, r.member) === accountKey(name, member))
  let row = find(given.name, given.member)
  if (!row && added) row = find(given.name.trim(), given.member.trim())
  if (!row && !(added && cls)) throw new InputError('advisor.unknown_account', 409)
  if (row && row.currency !== given.currency) throw new InputError('advisor.currency_mismatch', 409, { expected: row.currency, got: given.currency })

  const hasFlows = FLOWS.some(f => b[f] !== undefined)
  // the family does not track income and expenses: the month closes with balances only, and a flow would be dropped
  if (!view.flows && (b.categories !== undefined || hasFlows || b.loanPayments !== undefined)) throw new InputError('flows_not_tracked', 409)

  let figures: StatementFigures
  if (carried) {
    for (const param of ['balance', ...FLOWS, 'categories']) if (b[param] !== undefined) throw invalid(param)
    const previous = row ? view.hints[accountKey(row.name, row.member)] : undefined
    if (!row || previous === undefined || isFilled(row)) throw new InputError('advisor.no_previous_balance', 409)
    figures = view.flows ? carriedFigures(previous) : { balance: previous }
  } else {
    if (b.balance === undefined || b.balance === null) throw missing('balance')
    figures = { balance: amountOf(b.balance, 'balance', true) }
    for (const f of FLOWS) if (b[f] !== undefined) figures[f] = amountOf(b[f], f)
  }

  let account: StatementAccount = { name: row?.name ?? given.name, member: row?.member ?? given.member, currency: given.currency, carried }
  if (!row) {
    if (!(ACCOUNT_CLASSES as readonly string[]).includes(cls as string)) throw invalid('account.class')
    const name = readText(given.name, 'advisor.invalid_name', { field: 'name' })
    const member = readText(given.member, 'advisor.invalid_name', { field: 'member' })
    if (!view.members.includes(member)) throw new InputError('unknown_member', 400, { members: view.members })
    if (!view.currencies.includes(given.currency)) throw new InputError('unknown_currency', 400, { currencies: view.currencies })
    // a typo or a longer variant of an existing account would count the money twice: Claude asks the user first
    const similar = similarNames(name, view.rows.filter(r => r.member === member && r.currency === given.currency).map(r => r.name))
    if (similar.length && !confirmedNew) throw new InputError('advisor.similar_account', 409, { similar })
    account = { name, member, currency: given.currency, class: cls as AccountClass, added: true, carried }
  }

  const loans = b.loanPayments === undefined ? [] : loanLinesOf(b.loanPayments, view)
  // a carried account had no movement, so it keeps no lines
  const categories = carried && view.flows ? [] : b.categories === undefined ? null : itemsOf(b.categories, account.currency, categoryMap)

  const derived: CategoryFlow[] = []
  if (view.flows) {
    const list = [...categoryMap.values()]
    const sums = totalsOfLines(categories ?? [], list)
    // a re-upload always replaces: no flow is left to the old value, unless its lines give it
    for (const f of FLOWS) {
      if (figures[f] !== undefined) continue
      if (!(categories ?? []).some(i => categoryMap.get(i.categoryId)?.flow === f)) throw missing(f)
      figures[f] = sums[f]
      derived.push(f)
    }
    const totals = { active: figures.active ?? null, passive: figures.passive ?? null, expense: figures.expense ?? null }
    const [excess] = allocationExcess(categories ?? storedLines(view, account), list, totals)
    if (excess) throw new InputError('lines_exceed_total', 400, { ...excess })
  }

  const from = dateOf(b.periodFrom, 'periodFrom')
  const to = dateOf(b.periodTo, 'periodTo')
  if (from && to && from > to) throw invalid('periodTo')
  if (b.note !== undefined && b.note !== null && (typeof b.note !== 'string' || b.note.length > MAX_NOTE)) throw invalid('note')
  return { month, account, figures, loans, categories, derived, period: { from, to }, note: typeof b.note === 'string' ? b.note : null }
}

/** True when a period lies outside the month (any end that is given). */
export const periodOutside = (month: string, p: { from: string | null; to: string | null }): boolean =>
  (p.from !== null && (p.from < `${month}-01` || p.from > monthEnd(month))) || (p.to !== null && (p.to < `${month}-01` || p.to > monthEnd(month)))
