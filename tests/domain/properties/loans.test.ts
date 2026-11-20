// Properties of computeSchedule (src/domain/loans.ts) for generated loans with early repayments: the balance only ever
// goes down to zero, each row's parts add up, and what was paid plus what is left is the whole schedule.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { monthEnd, monthOf, shiftMonth } from '../../../src/domain/dates'
import { balanceFromSchedule, computeSchedule, currentPaymentIndex, summariseSchedule } from '../../../src/domain/loans'
import { loanWithEarly, runs } from '../../helpers/arbitraries'

const RUNS = runs(150)
/** Float dust of a few hundred rows, relative to the principal */
const eps = (principal: number) => 1e-6 * Math.max(1, principal)

describe('computeSchedule', () => {
  it('starts at the principal, carries each closing balance to the next row and never goes below zero', () => {
    fc.assert(fc.property(loanWithEarly({ manual: true }), ({ loan, eps: early }) => {
      const rows = computeSchedule(loan, early)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0].openingBalance).toBe(loan.principal)
      const bad = rows.find((r, i) => (i > 0 && r.openingBalance !== rows[i - 1].closingBalance)
        || [r.openingBalance, r.closingBalance, r.principalPart, r.interest, r.earlyPayment, r.earlyPrincipal, r.scheduledPayment].some(v => !(Number.isFinite(v) && v >= 0))
        || (r.events ?? []).some(e => e.balance < 0))
      expect(bad).toBeUndefined()
    }), RUNS)
  })

  it('each row adds up: opening less principal and early credits is closing, the charge is principal plus interest', () => {
    fc.assert(fc.property(loanWithEarly({ manual: true }), ({ loan, eps: early }) => {
      const e = eps(Number(loan.principal))
      const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
      const bad = computeSchedule(loan, early).find(r => Math.abs(r.openingBalance - r.principalPart - r.earlyPrincipal - r.closingBalance) > e
        // the last row charges only what closes the balance
        || Math.abs(r.scheduledPayment - (r.principalPart + r.interest)) > e
        // the early credits listed are the row's early principal and amount
        || Math.abs(sum((r.earlyCredits ?? []).map(c => c.principal)) - r.earlyPrincipal) > e
        || Math.abs(sum((r.earlyCredits ?? []).map(c => c.amount)) - r.earlyPayment) > e)
      expect(bad).toBeUndefined()
    }), RUNS)
  })

  it('a loan at the formula payment is paid off within its term: principal parts and early credits sum to the principal', () => {
    fc.assert(fc.property(loanWithEarly(), ({ loan, eps: early }) => {
      const rows = computeSchedule(loan, early)
      const repaid = rows.reduce((s, r) => s + r.principalPart + r.earlyPrincipal, 0)
      expect(rows.at(-1)!.closingBalance).toBeLessThanOrEqual(0.01)
      expect(Math.abs(repaid - Number(loan.principal))).toBeLessThanOrEqual(0.01 + eps(Number(loan.principal)))
      expect(rows.length).toBeLessThanOrEqual(Number(loan.term_months))
    }), RUNS)
  })

  it('the month-end balance never rises and stays within 0 and the principal', () => {
    fc.assert(fc.property(loanWithEarly({ manual: true }), ({ loan, eps: early }) => {
      const rows = computeSchedule(loan, early)
      const first = monthOf(String(loan.issue_date))
      let before = Number(loan.principal)
      for (let i = 0; i <= Number(loan.term_months) + 1; i++) {
        const b = balanceFromSchedule(loan, rows, monthEnd(shiftMonth(first, i)))!
        if (!(b >= 0 && b <= before)) expect({ month: shiftMonth(first, i), balance: b }).toEqual({ month: shiftMonth(first, i), balance: before })
        before = b
      }
    }), RUNS)
  })

  it('summariseSchedule: what was paid and what is left to pay make the whole schedule, whatever the day', () => {
    fc.assert(fc.property(loanWithEarly({ manual: true }), fc.integer({ min: -2, max: 420 }), ({ loan, eps: early }, offset) => {
      const rows = computeSchedule(loan, early)
      const today = new Date(`${shiftMonth(monthOf(String(loan.issue_date)), offset)}-15T12:00:00Z`)
      const s = summariseSchedule(rows, currentPaymentIndex(rows, today), early, today)
      const lastMonth = monthOf(rows.at(-1)!.date)
      const whole = rows.reduce((t, r) => t + r.scheduledPayment, 0)
        + early.filter(e => monthOf(e.payment_date) <= lastMonth).reduce((t, e) => t + Number(e.amount), 0)
      expect(Math.abs(s.totalPaid + s.toPay - whole)).toBeLessThanOrEqual(eps(Number(loan.principal)))
      expect(s.interestLeft).toBeLessThanOrEqual(s.overpayment + eps(Number(loan.principal)))
    }), RUNS)
  })
})
