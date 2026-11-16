// Repay early or invest: compare_early_repayment weighs an early payment on one of the family's loans against investing
// the same amount (repayOrInvest, as the Loans page's early-payment editor shows it), with the emergency fund before and
// after the money leaves the liquid assets (evaluate_purchase's buy_now path). Read-only.
import { isDay, isoDate } from '../../../domain/dates'
import { ANNUAL_RETURN } from '../../../domain/goals'
import { repayOrInvest } from '../../../domain/loans'
import { parseScenario } from '../../../domain/advisor'
import { loadEarlyPayments, loadLoans } from '../../../server/data'
import { InputError } from '../../../server/http'
import { ANSWER_RULES } from '../guide'
import { bodyOf, invalid, missing, nonEmptyString } from '../input'
import { weighScenario } from './evaluate'
import type { AdvisorTool } from './registry'

const STRATEGIES = ['reduce_term', 'reduce_payment'] as const

export const compareEarlyRepayment: AdvisorTool = {
  name: 'compare_early_repayment',
  description: 'Repay a loan early or invest the same money? For one of the family\'s loans (name as get_family_overview lists it), an amount in the loan\'s currency, a strategy (reduce_term: the payment stays, the loan ends sooner; reduce_payment: the term stays, the payment drops), an optional date (YYYY-MM-DD, today or later; today when absent) and an optional yearly return of the investment (returnPct, after tax, in the loan\'s currency; 8 when absent). Both paths cost the family the same each month until the loan\'s own last payment (horizon): repaying invests every payment it frees, investing puts the amount in at once. Answers loanRatePct (what repaying earns for certain: the break-even return), returnPct, currency (the loan\'s), horizon, investEnd, repayEnd, diff (investEnd − repayEnd) and better (invest, repay or level), and the emergency fund in months now and after the amount leaves the liquid money (emergency, from the family\'s numbers; null when not known) with gaps. Say first that repaying is certain and investing is not; quote the figures as given. advisor.unknown_loan: no such loan; advisor.repay_nothing_ahead: the loan is repaid by that date or has under two payments left.',
  inputSchema: {
    type: 'object',
    properties: {
      loan: { type: 'string', minLength: 1, description: 'The loan\'s name' },
      amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e9, description: 'The early payment, in the loan\'s currency' },
      strategy: { type: 'string', enum: [...STRATEGIES] },
      date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The day of the early payment, today or later; today when absent' },
      returnPct: { type: 'number', minimum: 0, maximum: 100, description: 'The expected yearly return of the investment, after tax, %; 8 when absent' },
    },
    required: ['loan', 'amount', 'strategy'],
    additionalProperties: false,
  },
  right: null,
  async run(ctx, input) {
    const b = bodyOf(input)
    const name = nonEmptyString(b.loan, 'loan')
    if (b.amount === undefined) throw missing('amount')
    if (typeof b.amount !== 'number' || !(b.amount > 0) || b.amount > 1e9) throw invalid('amount')
    if (b.strategy === undefined) throw missing('strategy')
    if (!(STRATEGIES as readonly unknown[]).includes(b.strategy)) throw invalid('strategy')
    const today = isoDate(ctx.now)
    const date = b.date === undefined ? today : b.date
    if (typeof date !== 'string' || !isDay(date) || date < today) throw invalid('date')
    const returnPct = b.returnPct === undefined ? ANNUAL_RETURN * 100 : b.returnPct
    if (typeof returnPct !== 'number' || !(returnPct >= 0) || returnPct > 100) throw invalid('returnPct')

    const loan = (await loadLoans(ctx.db)).find(l => l.name === name)
    if (!loan) throw new InputError('advisor.unknown_loan', 404, { name })
    const payments = (await loadEarlyPayments(ctx.db)).filter(p => p.loan_name === name)
    const result = repayOrInvest(loan, payments, { payment_date: date, amount: b.amount }, b.strategy as typeof STRATEGIES[number], returnPct)
    if (!result) throw new InputError('advisor.repay_nothing_ahead', 409, { name })
    const { evaluation } = await weighScenario(ctx, now => parseScenario({ kind: 'buy_now', amount: b.amount, currency: loan.currency }, now))
    const level = Math.abs(result.diff) < Math.max(result.investEnd, result.repayEnd) * 0.001
    return {
      loanRatePct: Number(loan.rate), returnPct, currency: loan.currency,
      ...result,
      better: level ? 'level' : result.diff > 0 ? 'invest' : 'repay',
      emergency: { now: evaluation.impact.now.emergencyMonths, after: evaluation.impact.after.emergencyMonths },
      gaps: evaluation.impact.gaps.map(g => g.code),
      answerRules: ANSWER_RULES,
    }
  },
}
