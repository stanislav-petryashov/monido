import type { LoanEarlyPayment, LoanRow } from '../../src/domain/loans'
import { DEMO_FAMILIES } from '../../src/demo/family'

/** A loan of 96,000 at 9% for 12 months from February 18, 2031; monthly_payment 0 — the payment comes from the annuity formula. */
export function loanRow(overrides: Partial<LoanRow> = {}): LoanRow {
  return {
    rowid: 1,
    name: 'Test loan',
    principal: 96000,
    rate: 9,
    term_months: 12,
    monthly_payment: 0,
    issue_date: '2031-02-18',
    payment_day: 18,
    currency: 'RUB',
    member: DEMO_FAMILIES['en-US'].members[0],
    type: 'consumer',
    status: 'active',
    closed_date: null,
    ...overrides,
  }
}

/** An early payment of 6,000 on the "Test loan" on July 23, 2031 (five days after the payment day), to reduce the term. */
export function earlyPaymentRow(overrides: Partial<LoanEarlyPayment> = {}): LoanEarlyPayment {
  return {
    rowid: 1,
    id: 1,
    loan_name: 'Test loan',
    payment_date: '2031-07-23',
    amount: 6000,
    strategy: 'reduce_term',
    new_payment: null,
    principal_credit: null,
    notes: null,
    ...overrides,
  }
}
