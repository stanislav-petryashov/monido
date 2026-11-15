// The bank's remaining balance of a loan set against the app's schedule, for the statement and loan tools: a warning only,
// never a refusal, and nothing is stored. Both figures are in the loan's currency, so no rate is ever looked up.
import { round2 } from '../../../domain/fx'
import { balanceFromSchedule, computeSchedule, loanBalanceDrift, type LoanRow, type ScheduleRow } from '../../../domain/loans'
import { loadEarlyPayments, loadLoans } from '../../../server/data'
import type { ToolContext } from './registry'

interface DriftWarning { code: 'loan_balance_differs'; params: Record<string, unknown> }

/** The loan_balance_differs warning for the bank's `bank` balance on `date`; null when the two agree or there is nothing to compare (loanBalanceDrift). */
export function driftWarning(loan: LoanRow, schedule: ScheduleRow[], date: string, bank: number): DriftWarning | null {
  const drift = loanBalanceDrift(loan, schedule, date, bank)
  if (!drift) return null
  return { code: 'loan_balance_differs', params: { name: loan.name, ...drift, date, currency: loan.currency } }
}

/** One loan line checked: the schedule's balance on the day (null when it has none) and the warning, if any. */
export interface LoanBalanceCheck { name: string; scheduledBalance: number | null; warning: DriftWarning | null }

/**
 * Each named loan's schedule balance on `date` ('YYYY-MM-DD'), with its own early payments, and the warning when a line
 * carries the bank's balance and it stands beyond the tolerance. Reads the loans only when there is a line; a name that is
 * not a loan any more has no schedule balance.
 */
export async function loanBalanceChecks(ctx: ToolContext, lines: readonly { name: string; balance?: number }[], date: string): Promise<LoanBalanceCheck[]> {
  if (lines.length === 0) return []
  const [loans, earlyPayments] = await Promise.all([loadLoans(ctx.db), loadEarlyPayments(ctx.db)])
  return lines.map(line => {
    const loan = loans.find(l => l.name === line.name)
    if (!loan) return { name: line.name, scheduledBalance: null, warning: null }
    const schedule = computeSchedule(loan, earlyPayments.filter(e => e.loan_name === loan.name))
    const balance = schedule.length === 0 ? null : balanceFromSchedule(loan, schedule, date)
    return {
      name: line.name,
      scheduledBalance: balance === null ? null : round2(balance),
      warning: line.balance === undefined ? null : driftWarning(loan, schedule, date, line.balance),
    }
  })
}
