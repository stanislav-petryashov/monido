// Rules of the statement import: how a statement's figures merge into a month draft, and the prefix of the legacy
// spending sources it derived from an account before account lines existed. Pure functions shared by the server and tests.
import { accountKey, type AccountClass } from './accounts'
import type { DraftRow } from './monthClose'

/**
 * The prefix of the spending sources the statement import wrote before account lines (`flow_lines`) existed
 * (`Statement: <name> — <member>`). Such rows stay as free sources; a new source may not take the prefix.
 */
export const STATEMENT_SOURCE_PREFIX = 'Statement: '

export interface StatementAccount { name: string; member: string; currency: string; class?: AccountClass; added?: boolean; carried?: boolean }
export interface StatementFigures { balance: number; active?: number; passive?: number; expense?: number }
/**
 * A statement's loan line: what was paid in the month and, optionally, the loan's remaining balance the bank shows after
 * the month's last payment (as of the month's last day, in the loan's currency). The balance is only compared with the
 * schedule, never written: applyStatement copies the name and the amount.
 */
export interface StatementLoanLine { name: string; amount: number; balance?: number }
type DraftLoans = { name: string; amount: number | null }[]

/**
 * A statement merged into a draft (the input is not changed). The account's row gets the figures given — those not given
 * stay, or are null in a new row. A row that is not there is added only with `added` and a class. Each loan line sets
 * its loan's amount, creating the entry; other entries stay.
 * @throws Error('unknown_account') for a row that is not there and may not be added
 */
export function applyStatement(
  draft: { rows: DraftRow[]; loans: DraftLoans }, account: StatementAccount, figures: StatementFigures, loans: StatementLoanLine[],
): { rows: DraftRow[]; loans: DraftLoans } {
  const key = accountKey(account.name, account.member)
  const given = (v: number | undefined, old: number | null) => (v === undefined ? old : v)
  const fill = (r: DraftRow): DraftRow => ({
    ...r,
    balance: figures.balance,
    active: given(figures.active, r.active), passive: given(figures.passive, r.passive), expense: given(figures.expense, r.expense),
  })
  let rows: DraftRow[]
  if (draft.rows.some(r => accountKey(r.name, r.member) === key)) {
    rows = draft.rows.map(r => (accountKey(r.name, r.member) === key ? fill(r) : r))
  } else if (account.added && account.class) {
    const fresh: DraftRow = {
      name: account.name, member: account.member, currency: account.currency, class: account.class,
      balance: null, active: null, passive: null, expense: null, closing: false, added: true,
    }
    rows = [...draft.rows, fill(fresh)]
  } else {
    throw new Error('unknown_account')
  }
  const merged = draft.loans.map(l => ({ ...l }))
  for (const line of loans) {
    const entry = merged.find(l => l.name === line.name)
    if (entry) entry.amount = line.amount
    else merged.push({ name: line.name, amount: line.amount })
  }
  return { rows, loans: merged }
}

/** A month with no statement for an account: the balance stays as it was, nothing flowed. */
export function carriedFigures(previousBalance: number): StatementFigures {
  return { balance: previousBalance, active: 0, passive: 0, expense: 0 }
}
