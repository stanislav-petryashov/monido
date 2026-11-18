// The Loans module's check of rows-API writes to its tables (registered in ../rowChecks.ts). Server only.
import { isDay } from '../../domain/dates'
import { balanceToday, computeSchedule, earlyPaymentConflict, EARLY_PAYMENT_STRATEGIES, isPaymentDay, type LoanEarlyPayment } from '../../domain/loans'
import { loadEarlyPayments, loadLoans } from '../../server/data'
import type { Database } from '../../server/db'
import { InputError } from '../../server/http'
import { collateralExists } from '../collateral'
import { isOwnRoute } from '../ownRoute'
import type { DeleteCheck, RowCheck } from '../rowChecks'

/**
 * A collateral sent is a property that exists now (../collateral.ts: real estate, while it is on). Runs in the caller's
 * guarded transaction, so a property deleted meanwhile reruns it.
 */
async function checkCollateral(db: Database, name: unknown): Promise<void> {
  if (typeof name !== 'string' || !name || !(await collateralExists(db, name))) throw new InputError('invalid_value', 400, { column: 'secured_by' })
}

/**
 * A loan is renamed and deleted by PUT/DELETE /api/loans/:rowid, which carry its early payments, payments and drafts
 * along; the rows API would leave them on the old name: 409 loan_by_route.
 */
export const checkLoanDelete: DeleteCheck = async table => {
  if (table === 'loans') throw new InputError('loan_by_route', 409)
}

/**
 * A rename of a loan outside its own route is refused (see checkLoanDelete), a revert's included; an early payment (or a
 * reverted payment line) is added or moved to a loan that exists (400 invalid_value { column: 'loan_name' }). A payment day sent is none or a whole day 1–31, a strategy sent is a known one (400 invalid_value { column }); an early
 * payment whose date or strategy is sent may not leave an early payment that reduces nothing — itself, after the loan is
 * repaid by the others, or another one, after the loan is repaid by it (earlyPaymentConflict, as the form checks it):
 * 409 early_payment_after_payoff { date, payment } — the day the loan is repaid and the late payment's date. Only
 * the columns sent are checked, so a row stored before these checks can still be edited otherwise (renamed, closed).
 * An amount or date sent may not pay more than the loan owes that day without this payment (409 early_payment_over_balance
 * { max }), and the credited principal is never more than the amount (409 principal_credit_over_amount).
 */
export const checkLoanRow: RowCheck = async (table, { data, row }, { db, rowid, revert }) => {
  if (table === 'loans' && rowid !== null && 'name' in data && !isOwnRoute()) {
    const stored = await db.prepare('SELECT name FROM loans WHERE rowid = ?').bind(rowid).first<{ name: string }>()
    if (stored && stored.name !== data.name) throw new InputError('loan_by_route', 409)
  }
  if (table === 'loans' && 'payment_day' in data && !isPaymentDay(data.payment_day)) {
    throw new InputError('invalid_value', 400, { column: 'payment_day' })
  }
  if (table === 'loans' && 'secured_by' in data && data.secured_by !== null) await checkCollateral(db, data.secured_by)
  // a payment moved to another loan's name (a revert of one line of a loan rename) needs that loan: else it is orphaned
  if (table === 'loan_payments' && revert && 'loan_name' in data && !(await loadLoans(db)).some(l => l.name === data.loan_name)) {
    throw new InputError('invalid_value', 400, { column: 'loan_name' })
  }
  if (table !== 'loan_early_payments') return
  if ('strategy' in data && !EARLY_PAYMENT_STRATEGIES.includes(String(data.strategy))) {
    throw new InputError('invalid_value', 400, { column: 'strategy' })
  }
  const loan = (await loadLoans(db)).find(l => l.name === row.loan_name)
  if (!loan && (rowid === null || (revert && 'loan_name' in data))) throw new InputError('invalid_value', 400, { column: 'loan_name' })
  // the principal the bank credited is part of the payment, never more (an extra zero would cut the debt by the difference)
  if (('amount' in data || 'principal_credit' in data) && row.principal_credit !== null && row.principal_credit !== undefined
    && Number(row.principal_credit) > Number(row.amount)) throw new InputError('principal_credit_over_amount', 409)
  const date = row.payment_date
  if (!loan || typeof date !== 'string' || !isDay(date)) return
  // an early payment's id is its rowid (INTEGER PRIMARY KEY)
  const others = (await loadEarlyPayments(db)).filter(e => e.loan_name === loan.name && e.id !== rowid)
  if ('payment_date' in data || 'strategy' in data) {
    const payment = { ...row, rowid: rowid ?? 0, id: rowid ?? 0, payment_date: date, strategy: String(row.strategy) } as LoanEarlyPayment
    const conflict = earlyPaymentConflict(loan, others, payment)
    if (conflict) throw new InputError('early_payment_after_payoff', 409, { date: conflict.payoff, payment: conflict.late })
  }
  // at most what the loan owes as the payment's day begins (the bank applies it before that day's installment), by the
  // schedule without it, in whole units up as the form rounds
  if ('amount' in data || 'payment_date' in data) {
    const dayBefore = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000)
    const owed = balanceToday({ ...loan, status: 'active' }, computeSchedule(loan, others), dayBefore) ?? Number(loan.principal)
    if (Number(row.amount) > Math.ceil(owed)) throw new InputError('early_payment_over_balance', 409, { max: Math.ceil(owed) })
  }
}
