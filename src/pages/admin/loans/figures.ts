import { computeSchedule, loansTotals, type LoanEarlyPayment, type LoanRow, type LoansTotals, type ScheduleRow } from '../../../domain/loans'
import type { FinanceSnapshot } from '../../../domain/types'

/** An early payment as the table answers: loan_early_payments has id INTEGER PRIMARY KEY AUTOINCREMENT, and SQLite does not return rowid as a separate column for such tables */
export type StoredPayment = Omit<LoanEarlyPayment, 'rowid'> & { rowid?: number }
export const withRowid = (rows: StoredPayment[]): LoanEarlyPayment[] => rows.map(r => ({ ...r, rowid: r.rowid ?? r.id }))

/** A loan with its own early payments and its schedule */
export interface LoanItem { loan: LoanRow; payments: LoanEarlyPayment[]; schedule: ScheduleRow[] }

export function loanItems(loans: LoanRow[], payments: LoanEarlyPayment[]): LoanItem[] {
  return loans.map(loan => {
    const own = payments.filter(ep => ep.loan_name === loan.name)
    return { loan, payments: own, schedule: computeSchedule(loan, own) }
  })
}

/**
 * The family totals of the loans on `today` (loansTotals) in the snapshot's currency, a foreign loan at the closed
 * month's rate — the ratio of a record of its currency in the snapshot's capital, which convert() gave there; without a
 * snapshot, in the loans' one currency. `currency` null — the loans have several currencies and there is no snapshot.
 */
export function familyTotals(items: LoanItem[], snapshot: FinanceSnapshot | undefined, today: Date): LoansTotals & { currency: string | null } {
  const currencies = [...new Set(items.map(i => i.loan.currency))]
  const currency = snapshot?.baseCurrency ?? (currencies.length === 1 ? currencies[0] : null)
  const capital = snapshot?.capital
  // shortcut: the snapshot carries no per-currency rates (only its own `rates.perUsd`), so convert() cannot run here; the rate is
  // read off the closed month's records of that currency (their base value is convert()'s at month-end); a currency none of
  // them holds has none. Upgrade when the snapshot exposes its Rates.
  const rate = (code: string): number | null => {
    const pairs = [
      ...(capital?.loans ?? []).map(l => [l.currency, l.balance, l.balanceBase] as const),
      ...(capital?.accounts ?? []).map(a => [a.currency, a.value, a.valueBase] as const),
      ...(capital?.realEstate ?? []).map(r => [r.currency, r.value, r.valueBase] as const),
    ]
    const found = pairs.find(([c, value, base]) => c === code && value > 0 && base !== null && base > 0)
    return found ? found[2]! / found[1] : null
  }
  const toBase = (value: number, code: string) => {
    if (code === currency) return value
    const r = currency === null ? null : rate(code)
    return r === null ? null : value * r
  }
  return { ...loansTotals(items, today, toBase), currency }
}
