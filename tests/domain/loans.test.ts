import { describe, expect, it } from 'vitest'
import { balanceFromSchedule, balanceToday, balanceTolerance, owedOn, earlyPaymentPreview, earlyPaymentsEffect, loansTotals, computeSchedule, loanBalanceDrift, currentPaymentIndex, earlyPaymentConflict, isPaymentDay, isScheduleDone, lateEarlyPayment, payoffDate, repayOrInvest, scheduledPaymentIn, summariseSchedule, type LoanEarlyPayment } from '../../src/domain/loans'
import { round2 } from '../../src/domain/fx'
import { monthsBetween } from '../../src/domain/dates'
import { earlyPaymentRow as makeEP, loanRow as makeLoan } from '../helpers/rows'

describe('computeSchedule', () => {
  it('builds the full schedule from issue date to maturity', () => {
    const rows = computeSchedule(makeLoan(), [])
    expect(rows).toHaveLength(12)
    expect(rows[0].date).toBe('2031-03-18')           // first payment = issue + 1 month
    expect(rows[11].closingBalance).toBeLessThanOrEqual(0.01)   // fully amortised
    expect(rows[0].openingBalance).toBe(96000)
  })

  it('records the principal an early repayment credited', () => {
    const row = computeSchedule(makeLoan(), [makeEP({ amount: 6000, principal_credit: 5240.8 })]).find(r => r.earlyPayment > 0)!
    expect(row.earlyPayment).toBe(6000)
    expect(row.earlyPrincipal).toBe(5240.8)
  })

  it('credits the computed principal when the bank figure is empty', () => {
    const row = computeSchedule(makeLoan(), [makeEP({ amount: 6000, principal_credit: null })]).find(r => r.earlyPayment > 0)!
    expect(row.earlyPrincipal).toBeGreaterThan(0)
    expect(row.earlyPrincipal).toBeLessThanOrEqual(row.earlyPayment)
  })

  it('has zero early principal in a row without early repayments', () => {
    expect(computeSchedule(makeLoan(), []).every(r => r.earlyPrincipal === 0)).toBe(true)
  })

  it('returns empty schedule for invalid params', () => {
    expect(computeSchedule(makeLoan({ principal: 0 }), [])).toHaveLength(0)
    expect(computeSchedule(makeLoan({ term_months: 0 }), [])).toHaveLength(0)
  })

  it('reduce_term early payment shortens the schedule and keeps the payment', () => {
    const withEP = computeSchedule(makeLoan(), [makeEP({ amount: 24000 })])
    expect(withEP).toHaveLength(10)
    const epRow = withEP.find(r => r.date.slice(0, 7) === '2031-07')!
    expect(epRow.earlyPayment).toBe(24000)
    expect(withEP.find(r => r.date.slice(0, 7) === '2031-08')!.scheduledPayment).toBeCloseTo(8395.34, 2)
  })

  it('reduce_payment early payment lowers subsequent payments, keeps term', () => {
    const withEP = computeSchedule(makeLoan(), [
      makeEP({ amount: 24000, strategy: 'reduce_payment' }),
    ])
    const epIdx = withEP.findIndex(r => r.date.slice(0, 7) === '2031-07')
    const before = withEP[epIdx - 1].scheduledPayment
    const after  = withEP[epIdx + 1].scheduledPayment
    expect(after).toBeLessThan(before)
    expect(withEP).toHaveLength(12)
  })

  it('applies ALL early payments within the same month, not just the first', () => {
    const oneEP = computeSchedule(makeLoan(), [makeEP({ amount: 6000 })])
    const twoEPs = computeSchedule(makeLoan(), [
      makeEP({ id: 1, rowid: 1, payment_date: '2031-07-23', amount: 6000 }),
      makeEP({ id: 2, rowid: 2, payment_date: '2031-07-29', amount: 6000 }),
    ])
    const rowOne = oneEP.find(r => r.date.slice(0, 7) === '2031-07')!
    const rowTwo = twoEPs.find(r => r.date.slice(0, 7) === '2031-07')!
    expect(rowTwo.earlyPayment).toBe(12000)           // both amounts shown
    expect(rowTwo.closingBalance).toBeLessThan(rowOne.closingBalance)
    expect(twoEPs.length).toBeLessThanOrEqual(oneEP.length)
  })

  it('deducts interest accrued on the EP amount, days counted from the payment date', () => {
    // Payment day is the 18th, EP on the 23rd → 5 days of interest accrue on
    // the EP amount itself: credit = amount / (1 + dailyRate × days).
    const sched = computeSchedule(makeLoan(), [
      makeEP({ payment_date: '2031-07-23', amount: 6000 }),
    ])
    const row = sched.find(r => r.date.slice(0, 7) === '2031-07')!
    const credited       = row.openingBalance - row.principalPart - row.closingBalance
    const expectedCredit = 6000 / (1 + (9 / 365 / 100) * 5)
    expect(credited).toBeCloseTo(expectedCredit, 0)
  })

  it('uses new_payment after a reduce_payment EP instead of the formula', () => {
    const sched = computeSchedule(makeLoan(), [
      makeEP({ amount: 24000, strategy: 'reduce_payment', new_payment: 7480.25 }),
    ])
    const epIdx = sched.findIndex(r => r.date.slice(0, 7) === '2031-07')
    expect(sched[epIdx + 1].scheduledPayment).toBeCloseTo(7480.25, 2)
  })

  it('keeps the current payment after a reduce_payment EP without new_payment on a manual-payment loan', () => {
    // Stored payment 1,530.40 doesn't follow the annuity formula for these
    // params (formula gives ~1,474.91) — the formula recalc would produce a
    // bogus payment, so the current payment must be kept.
    const loan = makeLoan({
      principal: 61000, rate: 7.5, term_months: 48,
      monthly_payment: 1530.4, issue_date: '2032-03-11', payment_day: 11,
    })
    const sched = computeSchedule(loan, [
      makeEP({ payment_date: '2033-08-11', amount: 9000, strategy: 'reduce_payment' }),
    ])
    const epIdx = sched.findIndex(r => r.date.slice(0, 7) === '2033-08')
    expect(sched[epIdx + 1].scheduledPayment).toBeCloseTo(1530.4, 2)
  })

  it('uses principal_credit override instead of the interest formula', () => {
    const sched = computeSchedule(makeLoan(), [
      makeEP({ amount: 6000, principal_credit: 5240.8 }),
    ])
    const row = sched.find(r => r.date.slice(0, 7) === '2031-07')!
    const credited = row.openingBalance - row.principalPart - row.closingBalance
    expect(credited).toBeCloseTo(5240.8, 1)
  })

  it('moves the first payment a month later when the pay day is less than a month after issue', () => {
    // Issued Jun 24, payment day 21 → Jul 21 is only 27 days away → first payment Aug 21.
    const loan = makeLoan({ issue_date: '2032-06-24', payment_day: 21 })
    const sched = computeSchedule(loan, [])
    expect(sched[0].date).toBe('2032-08-21')
  })

  it('applies an EP made before the first scheduled payment in the first row', () => {
    const loan = makeLoan({ issue_date: '2032-06-24', payment_day: 21 })
    const sched = computeSchedule(loan, [
      makeEP({ payment_date: '2032-07-06', amount: 5000 }),
    ])
    expect(sched[0].date).toBe('2032-08-21')
    expect(sched[0].earlyPayment).toBe(5000)
  })

  it('applies the bank-supplied new payment to the same month when the early payment comes before the payment date', () => {
    // A manual-payment loan (1,052.30 against the formula's ~985.60) and a reduce_payment EP three
    // days before the October 2033 payment: that payment is already the new one. Figures recorded
    // from computeSchedule when this test was written.
    const loan = makeLoan({
      principal: 41000, rate: 7.2, term_months: 48,
      monthly_payment: 1052.3, issue_date: '2032-05-09', payment_day: 9,
    })
    const sched = computeSchedule(loan, [
      makeEP({ payment_date: '2033-10-03', amount: 7000, strategy: 'reduce_payment', new_payment: 905.15, principal_credit: 6990.5 }),
    ])
    const at = (ym: string) => sched.find(r => r.date.slice(0, 7) === ym)!
    expect(at('2032-06').closingBalance).toBeCloseTo(40193.7, 2)
    expect(at('2033-03').closingBalance).toBeCloseTo(32715.78, 2)
    expect(at('2033-09').scheduledPayment).toBeCloseTo(1052.3, 2)
    expect(at('2033-10').scheduledPayment).toBeCloseTo(905.15, 2)
    expect(at('2033-10').closingBalance).toBeCloseTo(19729.51, 2)
    expect(at('2034-08').closingBalance).toBeCloseTo(11645.91, 2)
    expect(sched).toHaveLength(41)
    expect(sched[sched.length - 1].date).toBe('2035-10-09')
    expect(sched[sched.length - 1].scheduledPayment).toBeCloseTo(390.03, 2)
    expect(sched[sched.length - 1].closingBalance).toBeLessThan(0.01)
  })

  describe('a mortgage issued on the 30th with early payments of both kinds', () => {
    // A fictional 7-year mortgage: 148,500 at 6.45%, issued on the 30th and paid on the 30th (February
    // clamps to its last day). Five early payments cover every case at once: an exact new_payment and
    // principal_credit, a reduce_term and a reduce_payment dated on a payment day, and the formula credit.
    const mortgage = makeLoan({
      name: 'Harbour mortgage', principal: 148500, rate: 6.45, term_months: 84, monthly_payment: 2201.55,
      issue_date: '2031-08-30', payment_day: 30, currency: 'USD', member: 'Noa', type: 'mortgage',
    })
    const ep = (id: number, payment_date: string, amount: number, strategy: string, extra: Partial<LoanEarlyPayment> = {}) =>
      makeEP({ id, rowid: id, loan_name: mortgage.name, payment_date, amount, strategy, ...extra })
    const eps = [
      ep(1, '2032-02-12', 6000, 'reduce_payment', { new_payment: 2089.4, principal_credit: 5981.4 }),
      ep(2, '2032-09-30', 9000, 'reduce_term'),
      ep(3, '2033-04-15', 5000, 'reduce_payment'),
      ep(4, '2033-12-30', 7500, 'reduce_payment'),
      ep(5, '2034-06-08', 4000, 'reduce_term', { principal_credit: 3978.65 }),
    ]
    const sched = computeSchedule(mortgage, eps)
    const at = (ym: string) => sched.find(r => r.date.slice(0, 7) === ym)!

    // A regression lock: the figures are recorded from computeSchedule itself, not checked against a bank's schedule
    it('matches the figures recorded from computeSchedule', () => {
      expect(sched).toHaveLength(77)
      expect(sched[0].date).toBe('2031-09-30')
      expect(sched[0].scheduledPayment).toBeCloseTo(2201.55, 2)
      expect(at('2032-02').date).toBe('2032-02-29')                       // leap February clamps the 30th
      expect(at('2032-02').scheduledPayment).toBeCloseTo(2089.4, 2)         // the exact new_payment, already this month
      expect(at('2032-02').closingBalance).toBeCloseTo(134064.47, 2)
      expect(at('2032-09').closingBalance).toBeCloseTo(115326.95, 2)
      expect(at('2033-04').scheduledPayment).toBeCloseTo(1981.72, 2)
      expect(at('2033-04').closingBalance).toBeCloseTo(99967.94, 2)
      expect(at('2033-12').scheduledPayment).toBeCloseTo(1816.89, 2)
      expect(at('2033-12').closingBalance).toBeCloseTo(80857.32, 2)
      expect(at('2034-06').closingBalance).toBeCloseTo(68451.36, 2)
      expect(at('2036-06').closingBalance).toBeCloseTo(31439.57, 2)
      const last = sched[sched.length - 1]
      expect(last.date).toBe('2038-01-30')
      expect(last.scheduledPayment).toBeCloseTo(384.58, 2)
    })

    it('ends at zero', () => {
      expect(sched[sched.length - 1].closingBalance).toBeLessThan(0.01)
    })

    it('puts an early payment on a payment date in that date’s row', () => {
      expect(at('2032-09').earlyPayment).toBe(9000)
      expect(at('2033-12').earlyPayment).toBe(7500)
      // a reduce_payment on the payment day is already in that day’s payment; a reduce_term on it is not
      expect(at('2033-12').scheduledPayment).toBeLessThan(at('2033-11').scheduledPayment)
      expect(at('2032-09').scheduledPayment).toBeCloseTo(at('2032-08').scheduledPayment, 6)
    })

    it('lowers the next payment after every reduce_payment', () => {
      for (const e of eps.filter(p => p.strategy === 'reduce_payment')) {
        const before = [...sched].reverse().find(r => r.date < e.payment_date)!
        const after = sched.find(r => r.date > e.payment_date)!
        expect(after.scheduledPayment, e.payment_date).toBeLessThan(before.scheduledPayment)
      }
    })

    it('shortens the term after every reduce_term', () => {
      for (const e of eps.filter(p => p.strategy === 'reduce_term')) {
        const without = computeSchedule(mortgage, eps.filter(p => p !== e))
        expect(sched.length, e.payment_date).toBeLessThan(without.length)
      }
    })

    it('credits the exact principal where it is given and the formula credit elsewhere', () => {
      const credited = (ym: string) => at(ym).openingBalance - at(ym).principalPart - at(ym).closingBalance
      expect(credited('2032-02')).toBeCloseTo(5981.4, 2)
      expect(credited('2034-06')).toBeCloseTo(3978.65, 2)
      // 7,500 on the 30th, a reduce_payment: counted from the previous payment, 30 days of interest on it
      expect(credited('2033-12')).toBeCloseTo(7500 / (1 + (6.45 / 365 / 100) * 30), 2)
    })

    it('repays the loan amount less the principal the early payments credited', () => {
      const principalPaid = sched.reduce((sum, r) => sum + r.principalPart, 0)
      const credited = sched.reduce((sum, r) => sum + (r.openingBalance - r.principalPart - r.closingBalance), 0)
      expect(principalPaid + credited).toBeCloseTo(148500, 2)
      expect(principalPaid).toBeCloseTo(148500 - credited, 2)
      expect(credited).toBeGreaterThan(5981.4 + 3978.65)
      expect(credited).toBeLessThan(6000 + 9000 + 5000 + 7500 + 4000)
    })
  })

  it('keeps end-of-month payments in consecutive months without timezone drift', () => {
    const rows = computeSchedule(makeLoan({ issue_date: '2033-12-31', payment_day: 31 }), [])
    expect(rows.slice(0, 3).map(row => row.date)).toEqual(['2034-01-31', '2034-02-28', '2034-03-31'])
  })

  it('rejects invalid dates and non-finite loan parameters', () => {
    expect(computeSchedule(makeLoan({ issue_date: 'bad-date' }), [])).toEqual([])
    expect(computeSchedule(makeLoan({ principal: Infinity }), [])).toEqual([])
  })
})

describe('computeSchedule: inputs it takes without refusing, pinned as they behave today', () => {
  // the default loan: 96,000 at 9% over 12 months, issued 2031-02-18, 8,395.34 a month
  it('an early payment dated before the issue goes into the first row, as one made on the issue day', () => {
    const beforeIssue = computeSchedule(makeLoan(), [makeEP({ payment_date: '2020-01-05', amount: 5000 })])
    expect(beforeIssue[0].date).toBe('2031-03-18')
    expect(beforeIssue[0].earlyPayment).toBe(5000)
    expect(beforeIssue[0].closingBalance).toBeCloseTo(83287.16, 2)
    expect(beforeIssue).toEqual(computeSchedule(makeLoan(), [makeEP({ payment_date: '2031-02-18', amount: 5000 })]))
  })

  it.each([1, 31, '15', null, undefined])('isPaymentDay takes %j: none or a whole day 1–31', day => {
    expect(isPaymentDay(day)).toBe(true)
  })

  it.each([0, 32, -1, 1.5, '', ' ', '32', 'x', Number.NaN, true])('isPaymentDay refuses %j', day => {
    expect(isPaymentDay(day)).toBe(false)
  })

  it.each([0, 32, -1, null])('a payment day of %s falls back to the issue day', payment_day => {
    const rows = computeSchedule(makeLoan({ payment_day }), [])
    expect(rows.slice(0, 2).map(r => r.date)).toEqual(['2031-03-18', '2031-04-18'])
    expect(rows).toHaveLength(12)
  })

  it('an early payment of an unknown strategy credits the principal and keeps the payment until the balance runs out', () => {
    const rows = computeSchedule(makeLoan(), [makeEP({ amount: 24000, strategy: 'bogus' })])
    expect(rows.find(r => r.date === '2031-07-18')!.earlyPayment).toBe(24000)
    expect(rows.find(r => r.date === '2031-08-18')!.scheduledPayment).toBeCloseTo(8395.34, 2)
    expect(rows).toHaveLength(10)
    expect(rows[9].date).toBe('2031-12-18')
    expect(rows[9].scheduledPayment).toBeCloseTo(116.08, 2)
  })
})

describe('computeSchedule: a reduce_payment early payment keeps the term', () => {
  // 120,000 at 0% over 12 months, paid on the 10th: 10,000 a month; 60,000 early in April leaves 60,000
  const loan = makeLoan({ principal: 120000, rate: 0, term_months: 12, monthly_payment: 0, issue_date: '2031-01-10', payment_day: 10 })
  const ep = (payment_date: string) => makeEP({ payment_date, amount: 60000, strategy: 'reduce_payment', new_payment: null, principal_credit: null })

  it('dated before the payment day, spreads the rest over the months left, this one included', () => {
    const rows = computeSchedule(loan, [ep('2031-04-05')])
    expect(rows).toHaveLength(12)
    expect(rows.at(-1)!.date).toBe('2032-01-10')        // the 12th payment, the term's own month
    expect(rows.slice(2).map(r => r.scheduledPayment)).toEqual(Array(10).fill(4000))
  })

  it('dated after the payment day, shows in its row the payment that was charged, not the new one', () => {
    const rows = computeSchedule({ ...loan, rate: 12 }, [ep('2031-04-20')])
    const april = rows.find(r => r.date.startsWith('2031-04'))!
    expect(april.scheduledPayment).toBeCloseTo(april.principalPart + april.interest, 6)
    expect(april.scheduledPayment).toBeCloseTo(rows[0].scheduledPayment, 6)
    expect(rows.find(r => r.date.startsWith('2031-05'))!.scheduledPayment).toBeLessThan(april.scheduledPayment)
  })
})

describe('computeSchedule after reduce_term early payments', () => {
  // A fictional 4-year loan: 38,000 at 7.5%, paid on the 22nd.
  const loan = makeLoan({ principal: 38000, rate: 7.5, term_months: 48, issue_date: '2033-05-22', payment_day: 22 })
  const r = 7.5 / 12 / 100
  // Payments a balance needs at an unchanged payment: the annuity term.
  const annuityTerm = (balance: number, payment: number) => Math.ceil(-Math.log(1 - r * balance / payment) / Math.log(1 + r))
  const last = (rows: ReturnType<typeof computeSchedule>) => rows[rows.length - 1]

  it('after the month payment, keeps the payment and runs the annuity term for the new balance, ending at zero', () => {
    const sched = computeSchedule(loan, [makeEP({ payment_date: '2034-04-27', amount: 8000 })])
    const epIdx = sched.findIndex(row => row.date.slice(0, 7) === '2034-04')
    const payment = sched[0].scheduledPayment
    expect(sched[epIdx + 1].scheduledPayment).toBeCloseTo(payment, 6)
    expect(sched.length).toBe(epIdx + 1 + annuityTerm(sched[epIdx].closingBalance, payment))
    expect(last(sched).closingBalance).toBeLessThan(0.01)
  })

  it('before the month payment, counts that payment in the annuity term', () => {
    const sched = computeSchedule(loan, [makeEP({ payment_date: '2034-04-15', amount: 8000 })])
    const epIdx = sched.findIndex(row => row.date.slice(0, 7) === '2034-04')
    const balanceAfterEP = sched[epIdx].closingBalance + sched[epIdx].principalPart
    expect(sched.length).toBe(epIdx + annuityTerm(balanceAfterEP, sched[0].scheduledPayment))
    expect(last(sched).closingBalance).toBeLessThan(0.01)
  })

  it('charges only what closes the balance in the last payment', () => {
    const sched = computeSchedule(loan, [makeEP({ payment_date: '2034-04-27', amount: 8000 })])
    const final = last(sched)
    expect(final.scheduledPayment).toBeLessThanOrEqual(sched[0].scheduledPayment)
    expect(final.scheduledPayment).toBeCloseTo(final.principalPart + final.interest, 6)
    expect(final.principalPart).toBeCloseTo(final.openingBalance, 6)
  })

  it('ends at zero after several reduce_term payments mixed with reduce_payment ones', () => {
    // A fictional 15-year loan: 152,000 at 6.2%.
    const long = makeLoan({ principal: 152000, rate: 6.2, term_months: 180, issue_date: '2033-05-22', payment_day: 22 })
    const sched = computeSchedule(long, [
      makeEP({ id: 1, rowid: 1, payment_date: '2033-11-26', amount: 6500, strategy: 'reduce_payment' }),
      makeEP({ id: 2, rowid: 2, payment_date: '2034-10-14', amount: 9500 }),
      makeEP({ id: 3, rowid: 3, payment_date: '2035-11-30', amount: 5200, strategy: 'reduce_payment' }),
      makeEP({ id: 4, rowid: 4, payment_date: '2037-05-22', amount: 7300 }),
    ])
    const paymentIn = (ym: string) => sched.find(row => row.date.slice(0, 7) === ym)!.scheduledPayment
    // A reduce_payment after a reduce_term lowers the payment: the term it spreads over is the real one.
    expect(paymentIn('2035-12')).toBeLessThan(paymentIn('2035-10'))
    expect(last(sched).closingBalance).toBeLessThan(0.01)
    expect(sched.length).toBeLessThan(180)
  })

  it('repays exactly the amount less the principal the early payments credited', () => {
    const sched = computeSchedule(loan, [
      makeEP({ id: 1, rowid: 1, payment_date: '2033-12-27', amount: 4000, principal_credit: 3988.4 }),
      makeEP({ id: 2, rowid: 2, payment_date: '2034-08-09', amount: 2500, strategy: 'reduce_payment', principal_credit: 2492.7 }),
      makeEP({ id: 3, rowid: 3, payment_date: '2035-02-26', amount: 5500, principal_credit: 5481.3 }),
    ])
    const principalPaid = sched.reduce((sum, row) => sum + row.principalPart, 0)
    expect(principalPaid).toBeCloseTo(38000 - 3988.4 - 2492.7 - 5481.3, 2)
  })

  it('keeps the original remaining term when the payment cannot cover the interest', () => {
    // A fictional manual payment of 700 below the 1,000 of monthly interest on 80,000 at 15%.
    const underwater = makeLoan({ principal: 80000, rate: 15, term_months: 20, monthly_payment: 700 })
    const sched = computeSchedule(underwater, [makeEP({ payment_date: '2031-07-23', amount: 1000 })])
    expect(sched).toHaveLength(20)
  })
})

describe('balanceFromSchedule', () => {
  it('returns the principal before the first payment and the closing balance after each one', () => {
    const loan = makeLoan()
    const schedule = computeSchedule(loan, [])
    expect(balanceFromSchedule(loan, schedule, '2031-02-28')).toBe(96000)
    expect(balanceFromSchedule(loan, schedule, '2031-03-31')).toBeCloseTo(schedule[0].closingBalance, 6)
    expect(balanceFromSchedule(loan, schedule, '2031-04-30')).toBeCloseTo(schedule[1].closingBalance, 6)
    // 96,000 at 9% for 12 months: payment 8,395.34; after the first payment the balance is 88,324.66
    expect(balanceFromSchedule(loan, schedule, '2031-03-31')).toBeCloseTo(88324.66, 2)
  })
  it('reflects the early payments the schedule was built with', () => {
    const loan = makeLoan()
    const ep = makeEP({ payment_date: '2031-05-14', amount: 40000, strategy: 'reduce_term' })
    const withEp = computeSchedule(loan, [ep])
    expect(balanceFromSchedule(loan, withEp, '2031-05-31')).toBeCloseTo(withEp[2].closingBalance, 6)
    expect(balanceFromSchedule(loan, withEp, '2031-05-31')).toBeLessThan(balanceFromSchedule(loan, computeSchedule(loan, []), '2031-05-31')!)
    expect(balanceFromSchedule(loan, withEp, '2031-09-30')).toBeLessThan(0.01)
  })
  it('is null before issue and after closing', () => {
    expect(balanceFromSchedule(makeLoan(), computeSchedule(makeLoan(), []), '2031-01-31')).toBeNull()
    const closed = makeLoan({ status: 'closed', closed_date: '2031-08-01' })
    expect(balanceFromSchedule(closed, computeSchedule(closed, []), '2031-07-31')).not.toBeNull()
    expect(balanceFromSchedule(closed, computeSchedule(closed, []), '2031-08-31')).toBeNull()
  })
  it('keeps a closed loan without a close date a debt until its schedule pays it off', () => {
    const undated = makeLoan({ status: 'closed', closed_date: null })
    expect(balanceFromSchedule(undated, computeSchedule(undated, []), '2031-08-31')).toBeGreaterThan(0)
    expect(loanBalanceDrift(undated, computeSchedule(undated, []), '2031-03-31', 1)).not.toBeNull()
  })
  it('is zero once the loan is repaid', () => {
    expect(balanceFromSchedule(makeLoan(), computeSchedule(makeLoan(), []), '2032-08-31')).toBeLessThan(0.01)
  })
})

describe('balanceTolerance', () => {
  it('is one month\'s interest on the original principal, at least one unit of the currency', () => {
    expect(balanceTolerance(makeLoan())).toBe(720)
    expect(balanceTolerance(makeLoan({ principal: 120000, rate: 0 }))).toBe(1)
    expect(balanceTolerance(makeLoan({ principal: 100, rate: 5 }))).toBe(1)
    // the columns as stored may be strings
    expect(balanceTolerance(makeLoan({ principal: '96000', rate: '9' }))).toBe(720)
  })
})

describe('loanBalanceDrift', () => {
  const loan = makeLoan()
  const schedule = computeSchedule(loan, [])
  const MARCH = '2031-03-31'
  const scheduled = balanceFromSchedule(loan, schedule, MARCH)!

  it('says nothing when there is nothing honest to compare', () => {
    expect(loanBalanceDrift(loan, [], MARCH, 1)).toBeNull()
    // before issue, and on or after a closed loan's closing day
    expect(loanBalanceDrift(loan, schedule, '2031-01-31', 1)).toBeNull()
    const closed = makeLoan({ status: 'closed', closed_date: '2031-03-31' })
    expect(loanBalanceDrift(closed, computeSchedule(closed, []), MARCH, 1)).toBeNull()
    for (const bad of [NaN, Infinity, -1]) expect(loanBalanceDrift(loan, schedule, MARCH, bad)).toBeNull()
  })

  it('tolerates a difference up to the tolerance, and warns one cent beyond it', () => {
    expect(scheduled).toBeCloseTo(88324.66, 2)
    const r = Math.round(scheduled * 100) / 100
    expect(loanBalanceDrift(loan, schedule, MARCH, r)).toBeNull()
    expect(loanBalanceDrift(loan, schedule, MARCH, r + 720)).toBeNull()
    expect(loanBalanceDrift(loan, schedule, MARCH, r - 720)).toBeNull()
    expect(loanBalanceDrift(loan, schedule, MARCH, r - 720.01)).toEqual({ bank: 87604.65, scheduled: 88324.66, diff: -720.01, tolerance: 720 })
    expect(loanBalanceDrift(loan, schedule, MARCH, r + 720.01)).toEqual({ bank: 89044.67, scheduled: 88324.66, diff: 720.01, tolerance: 720 })
  })

  it('rounds its amounts to the cent', () => {
    expect(loanBalanceDrift(loan, schedule, MARCH, 88324.66 + 720.011)).toEqual({ bank: 89044.67, scheduled: 88324.66, diff: 720.01, tolerance: 720 })
  })

  it('shows figures that agree: diff is bank minus scheduled as shown, even when the raw balance is x.xx5', () => {
    const tiny = makeLoan({ principal: 100.005, rate: 0, term_months: 1 })
    const rows = [{ ...computeSchedule(makeLoan(), [])[0], date: '2031-03-31', closingBalance: 100.005 }]
    const drift = loanBalanceDrift(tiny, rows, '2031-03-31', 200)
    expect(drift).toEqual({ bank: 200, scheduled: 100.01, diff: 99.99, tolerance: 1 })
    expect(drift!.diff).toBe(round2(drift!.bank - drift!.scheduled))
  })

  it('warns of a bank balance of zero against a live schedule: repaid at the bank', () => {
    expect(loanBalanceDrift(loan, schedule, MARCH, 0)).toEqual({ bank: 0, scheduled: 88324.66, diff: -88324.66, tolerance: 720 })
  })

  it('compares with the schedule built with the early payments', () => {
    const withEp = computeSchedule(loan, [makeEP({ payment_date: '2031-05-14', amount: 40000 })])
    const MAY = '2031-05-31'
    const bank = Math.round(balanceFromSchedule(loan, withEp, MAY)! * 100) / 100
    expect(loanBalanceDrift(loan, withEp, MAY, bank)).toBeNull()
    expect(loanBalanceDrift(loan, schedule, MAY, bank)).toMatchObject({ bank, tolerance: 720 })
    expect(loanBalanceDrift(loan, schedule, MAY, bank)!.diff).toBeLessThan(-720)
  })
})

describe('currentPaymentIndex', () => {
  // payments fall on the loan's payment day, the 18th
  const schedule = computeSchedule(makeLoan({ issue_date: '2033-03-08' }), [])
  const at = (day: string) => schedule[currentPaymentIndex(schedule, new Date(`${day}T12:00:00Z`))].date

  it('points at the first payment dated after today, the payment day itself counts as paid', () => {
    expect(at('2033-06-17')).toBe('2033-06-18')
    expect(at('2033-06-18')).toBe('2033-07-18')
    expect(at('2033-06-25')).toBe('2033-07-18')
    expect(at('2033-10-31')).toBe('2033-11-18')
  })

  it('is -1 once every payment is in the past', () => {
    expect(currentPaymentIndex(schedule, new Date('2037-01-01T12:00:00Z'))).toBe(-1)
  })

  it('feeds the summary from that row on', () => {
    const now = new Date('2033-10-31T12:00:00Z')
    const s = summariseSchedule(schedule, currentPaymentIndex(schedule, now), [], now)
    expect(s.paymentsLeft).toBe(schedule.filter(r => r.date > '2033-10-31').length)
  })
})

describe('summariseSchedule and isScheduleDone', () => {
  const row = (n: number, date: string, early = 0) => ({ rowNum: n, date, openingBalance: 0, scheduledPayment: 100, principalPart: 90, interest: 10, earlyPayment: early, closingBalance: 0 })
  const rows = [row(1, '2031-01-01'), row(2, '2031-02-01', 50), row(3, '2031-03-01')]

  it('splits the sums at the current row and ends on the last payment', () => {
    expect(summariseSchedule(rows, 1)).toEqual({ paymentsLeft: 2, lastPayment: '2031-03-01', toPay: 250, interestLeft: 20, totalPaid: 100, overpayment: 30 })
    expect(summariseSchedule(rows, -1)).toMatchObject({ paymentsLeft: 0, toPay: 0, totalPaid: 350 })
    expect(summariseSchedule([], -1).lastPayment).toBeNull()
  })

  it('a schedule is done once no payment is left this month or later', () => {
    expect(isScheduleDone(rows, new Date(Date.UTC(2031, 2, 15)))).toBe(false)
    expect(isScheduleDone(rows, new Date(Date.UTC(2031, 3, 15)))).toBe(true)
    expect(isScheduleDone([], new Date())).toBe(false)
  })
})

describe('summary and status of a schedule, round 2', () => {
  const row = (date: string, closingBalance: number) => ({ rowNum: 1, date, openingBalance: 100, scheduledPayment: 100, principalPart: 90, interest: 10, earlyPayment: 0, closingBalance })

  it('counts an early payment made before the first installment as paid, not as still to pay', () => {
    const loan = makeLoan()  // issued 2031-02-18, first installment 2031-03-18
    const ep = makeEP({ payment_date: '2031-02-25', amount: 5000, strategy: 'reduce_term' })
    const schedule = computeSchedule(loan, [ep])
    expect(schedule[0].earlyPayment).toBe(5000)   // the first row holds it
    const today = new Date(Date.UTC(2031, 2, 1))
    const idx = currentPaymentIndex(schedule, today)
    expect(idx).toBe(0)
    const s = summariseSchedule(schedule, idx, [ep], today)
    expect(s.totalPaid).toBe(5000)
    expect(s.toPay).toBeCloseTo(schedule.reduce((sum, r) => sum + r.scheduledPayment, 0), 6)
    // a payment still ahead stays "to pay"
    const planned = makeEP({ payment_date: '2031-03-25', amount: 5000, strategy: 'reduce_term' })
    const s2 = summariseSchedule(computeSchedule(loan, [planned]), 0, [planned], today)
    expect(s2.totalPaid).toBe(0)
  })

  it('is not done while the last row leaves a balance, however late it is', () => {
    const late = new Date(Date.UTC(2040, 0, 1))
    expect(isScheduleDone([row('2031-03-18', 50)], late)).toBe(false)
    expect(isScheduleDone([row('2031-03-18', 0)], late)).toBe(true)
  })

  it('takes the payoff date from the schedule: the last installment, or the early payment that repaid it', () => {
    const loan = makeLoan()
    const plain = computeSchedule(loan, [])
    expect(payoffDate(plain)).toBe(plain[plain.length - 1].date)
    const ep = makeEP({ payment_date: '2031-04-25', amount: 96000, strategy: 'reduce_term' })
    const early = computeSchedule(loan, [ep])
    expect(early[early.length - 1].closingBalance).toBe(0)
    expect(payoffDate(early)).toBe('2031-04-25')
    expect(payoffDate([row('2031-03-18', 50)])).toBeNull()
    expect(payoffDate([])).toBeNull()
  })

  describe('an early payment the repaid loan would not take (lateEarlyPayment)', () => {
    // 1200 at 0%, 100 a month from 2029-06-01: the last installment, 2030-06-01, repays it
    const zeroRate = makeLoan({ principal: 1200, rate: 0, term_months: 12, monthly_payment: 100, issue_date: '2029-06-01', payment_day: null })
    const plain = computeSchedule(zeroRate, [])

    it('repaid by the last installment: a payment before its day reduces, on its day only a reduce_payment one (applied first)', () => {
      expect(lateEarlyPayment(plain, '2030-05-31', 'reduce_term')).toBeNull()
      expect(lateEarlyPayment(plain, '2030-06-01', 'reduce_payment')).toBeNull()
      expect(lateEarlyPayment(plain, '2030-06-01', 'reduce_term')).toBe('2030-06-01')
      expect(lateEarlyPayment(plain, '2030-06-02', 'reduce_payment')).toBe('2030-06-01')
    })

    it('repaid by an early payment: only a payment before its day reduces', () => {
      // 100 left before the June installment, paid that morning (reduce_payment goes before the installment)
      const morning = computeSchedule(zeroRate, [makeEP({ payment_date: '2030-06-01', amount: 100, strategy: 'reduce_payment' })])
      expect(lateEarlyPayment(morning, '2030-05-31', 'reduce_payment')).toBeNull()
      expect(lateEarlyPayment(morning, '2030-06-01', 'reduce_payment')).toBe('2030-06-01')
      // the whole 96 000 on 2031-04-25, after the April installment of 2031-04-18
      const after = computeSchedule(makeLoan(), [makeEP({ payment_date: '2031-04-25', amount: 96000, strategy: 'reduce_term' })])
      expect(lateEarlyPayment(after, '2031-04-24', 'reduce_term')).toBeNull()
      expect(lateEarlyPayment(after, '2031-04-25', 'reduce_term')).toBe('2031-04-25')
    })

    it('debt left after the last row: a payment up to the end of its month; none without a schedule', () => {
      const unpaid = [row('2031-02-18', 100), row('2031-03-18', 50)]
      expect(lateEarlyPayment(unpaid, '2031-03-31', 'reduce_term')).toBeNull()
      expect(lateEarlyPayment(unpaid, '2031-04-01', 'reduce_term')).toBe('2031-03-18')
      expect(lateEarlyPayment([], '2040-01-01', 'reduce_term')).toBeNull()
    })
  })
})

describe('status and payoff rules, round 3', () => {
  const late = new Date(Date.UTC(2040, 0, 1))
  const loan = makeLoan({ issue_date: '2021-02-18', payment_day: 18 })
  const ep = (o: object) => makeEP({ payment_date: '2021-07-23', amount: 6000, strategy: 'reduce_term', ...o })

  it('a payment entered to the cent leaves a few cents at the end: still repaid', () => {
    const exact = computeSchedule(loan, [ep({ amount: 24000, strategy: 'reduce_payment' })])[6].scheduledPayment
    const rounded = computeSchedule(loan, [ep({ amount: 24000, strategy: 'reduce_payment', new_payment: Math.floor(exact * 100) / 100 })])
    const last = rounded[rounded.length - 1]
    expect(last.closingBalance).toBeGreaterThan(0.01)
    expect(isScheduleDone(rounded, late)).toBe(true)
    expect(payoffDate(rounded)).toBe(last.date)
  })

  it('real debt at the term limit (50 left on a 495 payment) is not repaid', () => {
    const rows = [{ rowNum: 1, date: '2030-02-18', openingBalance: 545, scheduledPayment: 495, principalPart: 495, interest: 0, earlyPayment: 0, closingBalance: 50 }]
    expect(isScheduleDone(rows, late)).toBe(false)
    expect(payoffDate(rows)).toBeNull()
  })

  it('an early payment before the final installment, then the installment repays the rest: the installment day', () => {
    const before = computeSchedule(loan, [])[10].closingBalance
    const half = ep({ payment_date: '2022-02-10', amount: before * 0.5 })
    const rows = computeSchedule(loan, [half])
    expect(rows[rows.length - 1].date).toBe('2022-02-18')
    expect(payoffDate(rows)).toBe('2022-02-18')
  })

  it('a tiny extra early payment after the one that zeroed the balance does not move the payoff date', () => {
    const full = ep({ payment_date: '2021-07-25', amount: 80000 })
    const tiny = ep({ id: 2, rowid: 2, payment_date: '2021-07-28', amount: 100 })
    expect(payoffDate(computeSchedule(loan, [full, tiny]))).toBe('2021-07-25')
  })

  it('a rounding residual of a few cents (0.029 on 12 rows) is repaid', () => {
    const rows = computeSchedule(loan, [ep({ amount: 24000, strategy: 'reduce_payment', new_payment: 4867.49 })])
    const last = rows[rows.length - 1].closingBalance
    expect(last).toBeGreaterThan(0.01)
    expect(last).toBeLessThan(0.12)
    expect(isScheduleDone(rows, late)).toBe(true)
    expect(payoffDate(rows)).toBe(rows[rows.length - 1].date)
  })

  it('500 left after a manual payment short of the loan is debt, not rounding', () => {
    const rows = computeSchedule(makeLoan({ principal: 100000, rate: 0, term_months: 1, monthly_payment: 99500 }), [])
    expect(rows).toHaveLength(1)
    expect(rows[0].closingBalance).toBeCloseTo(500, 6)
    expect(isScheduleDone(rows, late)).toBe(false)
    expect(payoffDate(rows)).toBeNull()
  })

  it('50 left at the end of a 60-row schedule is debt, not rounding', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      rowNum: i + 1, date: `20${30 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-18`, openingBalance: 1000,
      scheduledPayment: 1000, principalPart: 1000, interest: 0, earlyPayment: 0, closingBalance: i === 59 ? 50 : 1000,
    }))
    expect(isScheduleDone(rows, late)).toBe(false)
    expect(payoffDate(rows)).toBeNull()
    rows[59].closingBalance = 0.5
    expect(isScheduleDone(rows, late)).toBe(true)
  })

  it('a row left at zero by an early payment that cleared the balance is not a payment left', () => {
    const l = makeLoan({ issue_date: '2031-02-18', payment_day: 18 })
    const full = ep({ payment_date: '2031-07-10', amount: 100000 })
    const rows = computeSchedule(l, [full])
    expect(rows[rows.length - 1].scheduledPayment).toBe(0)
    const today = new Date(Date.UTC(2031, 5, 20, 12))
    const idx = currentPaymentIndex(rows, today)
    expect(rows[idx].date).toBe('2031-07-18')
    expect(summariseSchedule(rows, idx, [full], today).paymentsLeft).toBe(0)
  })

  it('a planned early payment later this month counts as to pay although this month\'s installment has passed', () => {
    const l = makeLoan({ issue_date: '2031-02-18', payment_day: 18 })
    const today = new Date(Date.UTC(2031, 6, 20, 12))
    const planned = ep({ payment_date: '2031-07-25', amount: 5000 })
    const idx = currentPaymentIndex(computeSchedule(l, [planned]), today)
    const withPlanned = summariseSchedule(computeSchedule(l, [planned]), idx, [planned], today)
    const without = summariseSchedule(computeSchedule(l, []), idx, [], today)
    expect(withPlanned.totalPaid).toBeCloseTo(without.totalPaid, 6)
    expect(withPlanned.toPay).toBeGreaterThan(5000 - 1)
  })
})

describe('scheduledPaymentIn', () => {
  it('sums the payments dated in the month and is 0 outside the schedule', () => {
    const rows = computeSchedule(makeLoan(), [])
    expect(scheduledPaymentIn(rows, '2031-03')).toBe(rows[0].scheduledPayment)
    expect(scheduledPaymentIn(rows, '2031-03')).toBeGreaterThan(0)
    expect(scheduledPaymentIn(rows, '2031-02')).toBe(0)
    expect(scheduledPaymentIn(rows, '2032-03')).toBe(0)
    expect(scheduledPaymentIn([], '2031-03')).toBe(0)
    const twice = [rows[0], { ...rows[0], scheduledPayment: 5 }]
    expect(scheduledPaymentIn(twice, '2031-03')).toBe(rows[0].scheduledPayment + 5)
  })
})

describe('computeSchedule over a grid of loans (properties, 2,160 cases)', () => {
  // 5 rates × 6 terms × 4 issue days (month ends, a leap day, mid-month) × 6 payment days × no / reduce_term /
  // reduce_payment early payment of 20,000 on 2031-09-10 (before the issue for the 2032 loans: it goes into row 1)
  const RATES = [0, 0.1, 5, 12.5, 29.9]
  const TERMS = [1, 2, 12, 59, 360, 600]
  const ISSUES = ['2031-01-31', '2032-02-29', '2031-03-30', '2031-06-15']
  const DAYS = [null, 1, 28, 29, 30, 31]
  const STRATEGIES = [null, 'reduce_term', 'reduce_payment']

  it('every schedule ends repaid, chains its balances, pays once a month in consecutive months, never negative; without an early payment it runs the whole term', () => {
    const violations: string[] = []
    let cases = 0
    for (const rate of RATES) for (const term_months of TERMS) for (const issue_date of ISSUES) for (const payment_day of DAYS) for (const strategy of STRATEGIES) {
      cases++
      const loan = makeLoan({ principal: 100000, rate, term_months, monthly_payment: 0, issue_date, payment_day })
      const eps = strategy ? [makeEP({ payment_date: '2031-09-10', amount: 20000, strategy })] : []
      const rows = computeSchedule(loan, eps)
      const tag = `${rate}% ${term_months}m ${issue_date} day ${payment_day} ${strategy ?? 'no EP'}`
      if (rows.length === 0) { violations.push(`empty: ${tag}`); continue }
      if (rows[rows.length - 1].closingBalance > 0.01) violations.push(`not repaid: ${tag}`)
      if (!strategy && rows.length !== term_months) violations.push(`${rows.length} rows: ${tag}`)
      if (rows.some(r => r.principalPart < 0 || r.interest < 0 || r.scheduledPayment < 0 || r.closingBalance < 0)) violations.push(`negative: ${tag}`)
      for (let i = 1; i < rows.length; i++) {
        if (Math.abs(rows[i].openingBalance - rows[i - 1].closingBalance) > 1e-6) { violations.push(`chain broken at row ${i + 1}: ${tag}`); break }
        if (monthsBetween(rows[i - 1].date, rows[i].date) !== 1) { violations.push(`${rows[i - 1].date} → ${rows[i].date}: ${tag}`); break }
      }
    }
    expect(cases).toBe(2160)
    expect(violations).toEqual([])
  })
})

describe('earlyPaymentConflict', () => {
  // 1200 at 0%, 100 a month from 2029-06-01: 100 is left before the last installment of 2030-06-01
  const loan = makeLoan({ principal: 1200, rate: 0, term_months: 12, monthly_payment: 100, issue_date: '2029-06-01', payment_day: null })
  const morning = makeEP({ id: 1, rowid: 1, payment_date: '2030-06-01', amount: 50, strategy: 'reduce_payment' })

  it('the payment itself after the payoff by the others: the payoff day, its own date', () => {
    expect(earlyPaymentConflict(loan, [], makeEP({ payment_date: '2030-06-02', amount: 10, strategy: 'reduce_term' })))
      .toEqual({ payoff: '2030-06-01', late: '2030-06-02' })
  })

  it('a stored payment left after the payoff the new one brings forward: that payment\'s date', () => {
    expect(earlyPaymentConflict(loan, [morning], makeEP({ payment_date: '2030-05-31', amount: 100, strategy: 'reduce_term' })))
      .toEqual({ payoff: '2030-05-31', late: '2030-06-01' })
    expect(earlyPaymentConflict(loan, [morning], makeEP({ payment_date: '2030-05-31', amount: 30, strategy: 'reduce_term' }))).toBeNull()
  })

  it('a stored payment already late without the new one does not count', () => {
    const stale = makeEP({ id: 2, rowid: 2, payment_date: '2031-01-01', amount: 10, strategy: 'reduce_term' })
    expect(earlyPaymentConflict(loan, [stale], makeEP({ payment_date: '2029-10-01', amount: 10, strategy: 'reduce_term' }))).toBeNull()
  })
})

// The demo family's loans as the dev database holds them (the Loans mock-up's figures, today 10.11.2026)
const MORTGAGE = makeLoan({
  rowid: 1, name: 'Maple Street mortgage', principal: 416000, rate: 6.5, term_months: 360, monthly_payment: 2629.4,
  issue_date: '2022-09-15', payment_day: 15, currency: 'USD', type: 'mortgage',
})
const MORTGAGE_EPS = [
  makeEP({ id: 17, rowid: 17, loan_name: MORTGAGE.name, payment_date: '2024-02-20', amount: 5000, strategy: 'reduce_payment', new_payment: 2597.36, principal_credit: 4991.35 }),
  makeEP({ id: 18, rowid: 18, loan_name: MORTGAGE.name, payment_date: '2025-02-08', amount: 6000, strategy: 'reduce_term' }),
  makeEP({ id: 19, rowid: 19, loan_name: MORTGAGE.name, payment_date: '2025-08-14', amount: 4000, strategy: 'reduce_payment' }),
  makeEP({ id: 20, rowid: 20, loan_name: MORTGAGE.name, payment_date: '2026-02-09', amount: 7500, strategy: 'reduce_term' }),
]
const CAR = makeLoan({ rowid: 2, name: 'Car loan', principal: 25000, rate: 7, term_months: 60, monthly_payment: 495.03, issue_date: '2024-02-10', payment_day: 10, currency: 'USD' })
const NOV_10 = new Date('2026-11-10T12:00:00Z')
const mortgageSchedule = computeSchedule(MORTGAGE, MORTGAGE_EPS)
const carSchedule = computeSchedule(CAR, [])

describe('balanceToday', () => {
  it('is the balance after the last payment whose date has come: a row dated today counts, a later one does not', () => {
    expect(round2(balanceToday(MORTGAGE, mortgageSchedule, NOV_10)!)).toBe(371728.31)
    expect(round2(balanceToday(CAR, carSchedule, NOV_10)!)).toBe(12333.22)
    expect(round2(balanceToday(MORTGAGE, mortgageSchedule, new Date('2026-11-15T12:00:00Z'))!)).toBe(371172.09)
    expect(round2(balanceToday(CAR, carSchedule, new Date('2026-11-09T12:00:00Z'))!)).toBe(12753.85)
  })

  it('to pay − interest ahead = the balance today, to the cent', () => {
    for (const [loan, schedule, eps] of [[MORTGAGE, mortgageSchedule, MORTGAGE_EPS], [CAR, carSchedule, []]] as const) {
      const s = summariseSchedule(schedule, currentPaymentIndex(schedule, NOV_10), [...eps], NOV_10)
      expect(round2(s.toPay - s.interestLeft)).toBe(round2(balanceToday(loan, schedule, NOV_10)!))
    }
  })

  it('counts an early payment dated today before its month’s installment, and not one dated tomorrow', () => {
    const ep = (date: string) => makeEP({ loan_name: CAR.name, payment_date: date, amount: 1000, principal_credit: 1000 })
    const before = balanceToday(CAR, carSchedule, new Date('2026-12-05T12:00:00Z'))!
    expect(balanceToday(CAR, computeSchedule(CAR, [ep('2026-12-05')]), new Date('2026-12-05T12:00:00Z'))).toBeCloseTo(before - 1000, 6)
    expect(balanceToday(CAR, computeSchedule(CAR, [ep('2026-12-06')]), new Date('2026-12-05T12:00:00Z'))).toBeCloseTo(before, 6)
  })

  it('is null for a closed loan and for one not issued yet', () => {
    expect(balanceToday({ ...CAR, status: 'closed', closed_date: '2026-10-20' }, carSchedule, NOV_10)).toBeNull()
    expect(balanceToday({ ...CAR, status: 'closed', closed_date: null }, carSchedule, NOV_10)).toBe(balanceToday(CAR, carSchedule, NOV_10))
    expect(balanceToday({ ...CAR, issue_date: '2026-12-01' }, computeSchedule({ ...CAR, issue_date: '2026-12-01' }, []), NOV_10)).toBeNull()
  })
})

describe('owedOn', () => {
  it('is balanceToday, the principal for a loan not issued yet, and null for one closed by then', () => {
    const later = { ...CAR, issue_date: '2026-12-01' }
    expect(owedOn(CAR, carSchedule, NOV_10)).toBe(balanceToday(CAR, carSchedule, NOV_10))
    expect(owedOn(later, computeSchedule(later, []), NOV_10)).toBe(Number(CAR.principal))
    expect(owedOn({ ...later, status: 'closed', closed_date: '2026-10-20' }, computeSchedule(later, []), NOV_10)).toBeNull()
  })
})

describe('earlyPaymentsEffect', () => {
  it('the mortgage: −27 months, −68 761.05 $, without them the last payment 15.09.2052', () => {
    const e = earlyPaymentsEffect(MORTGAGE, MORTGAGE_EPS)!
    expect(e.monthsSaved).toBe(27)
    expect(round2(e.interestSaved)).toBe(68761.05)
    expect(e.lastWithout).toBe('2052-09-15')
    expect(e.total).toBe(22500)
  })

  it('is null without early payments', () => {
    expect(earlyPaymentsEffect(CAR, [])).toBeNull()
  })
})

describe('earlyPaymentPreview', () => {
  const draft = { payment_date: '2026-12-14', amount: 5000 }

  it('5 000 $ on 14.12.2026: reduce term ends 15.09.2049 with 275 payments, reduce payment 2 532.65 $', () => {
    const p = earlyPaymentPreview(MORTGAGE, MORTGAGE_EPS, draft, NOV_10)!
    expect(p.reduce_term).toMatchObject({ lastPayment: '2049-09-15', paymentsLeft: 275 })
    expect(round2(p.reduce_term!.interestSaved)).toBe(17409.99)
    expect(round2(p.reduce_payment!.payment)).toBe(2532.65)
    expect(round2(p.reduce_payment!.interestSaved)).toBe(3727.59)
    expect(p.reduce_payment!.lastPayment).toBe('2050-06-15')
    expect(p.current).toMatchObject({ lastPayment: '2050-06-15', paymentsLeft: 284 })
    expect(round2(p.current.payment)).toBe(2569.75)
  })

  it('equals what saving the draft gives, for both strategies', () => {
    const p = earlyPaymentPreview(MORTGAGE, MORTGAGE_EPS, draft, NOV_10)!
    for (const strategy of ['reduce_term', 'reduce_payment'] as const) {
      const eps = [...MORTGAGE_EPS, makeEP({ loan_name: MORTGAGE.name, ...draft, strategy })]
      const saved = computeSchedule(MORTGAGE, eps)
      const s = summariseSchedule(saved, currentPaymentIndex(saved, NOV_10), eps, NOV_10)
      expect(p[strategy]!.lastPayment).toBe(s.lastPayment)
      expect(p[strategy]!.paymentsLeft).toBe(s.paymentsLeft)
    }
  })

  it('takes the bank’s new payment and a manual-payment loan the way a saved payment does', () => {
    const typed = earlyPaymentPreview(MORTGAGE, MORTGAGE_EPS, { ...draft, new_payment: 2500 }, NOV_10)!
    expect(typed.reduce_payment!.payment).toBe(2500)
    const manual = { ...CAR, monthly_payment: 600 }
    const p = earlyPaymentPreview(manual, [], { payment_date: '2026-12-09', amount: 2000 }, NOV_10)!
    const eps = [makeEP({ loan_name: CAR.name, payment_date: '2026-12-09', amount: 2000, strategy: 'reduce_payment' })]
    const saved = computeSchedule(manual, eps)
    expect(p.reduce_payment!.payment).toBe(saved.find(r => r.date >= '2026-12-09')!.scheduledPayment)
    expect(p.reduce_payment!.payment).toBe(600)
  })

  it('a back-dated draft counts the interest it saves from its own date', () => {
    const p = earlyPaymentPreview(MORTGAGE, MORTGAGE_EPS, { payment_date: '2026-03-10', amount: 5000 }, NOV_10)!
    const eps = [...MORTGAGE_EPS, makeEP({ loan_name: MORTGAGE.name, payment_date: '2026-03-10', amount: 5000, strategy: 'reduce_term' })]
    const total = (rows: ReturnType<typeof computeSchedule>) => rows.reduce((s, r) => s + r.interest, 0)
    expect(p.reduce_term!.interestSaved).toBeCloseTo(total(mortgageSchedule) - total(computeSchedule(MORTGAGE, eps)), 6)
  })

  it('is null for an unreadable draft; a strategy is null after payoff', () => {
    expect(earlyPaymentPreview(CAR, [], { payment_date: '', amount: 5000 }, NOV_10)).toBeNull()
    expect(earlyPaymentPreview(CAR, [], { payment_date: '2026-12-09', amount: null }, NOV_10)).toBeNull()
    expect(earlyPaymentPreview(CAR, [], { payment_date: '2030-01-01', amount: 100 }, NOV_10)).toMatchObject({ reduce_term: null, reduce_payment: null })
  })
})

describe('loansTotals', () => {
  const items = [{ loan: MORTGAGE, schedule: mortgageSchedule, payments: MORTGAGE_EPS }, { loan: CAR, schedule: carSchedule, payments: [] }]
  const same = (v: number) => v

  it('the demo on 10.11.2026: 384 061 owed, 3 064.78 a month; the car ends first, then 2 569.75 a month', () => {
    const t = loansTotals(items, NOV_10, same)
    expect(t).toMatchObject({ count: 2, balance: 384061, payment: 3064.78, endsNext: { from: '2029-03', paymentAfter: 2569.75 } })
    expect(t.payments.map(p => p.name)).toEqual([MORTGAGE.name, CAR.name])
    expect(t.interestAhead).toBe(356283 + 1033)
  })

  it('loans ending in the same month all stop paying then; with none paying on there is no "from then" figure', () => {
    const twin = { loan: { ...CAR, name: 'Second car' }, schedule: carSchedule, payments: [] }
    expect(loansTotals([...items, twin], NOV_10, same).endsNext).toEqual({ from: '2029-03', paymentAfter: 2569.75 })
    expect(loansTotals([items[1], twin], NOV_10, same).endsNext).toBeNull()
  })

  it('the Close state (the car repaid in full on 20.10.2026, not closed): counted, but no payment, end or track', () => {
    const eps = [makeEP({ loan_name: CAR.name, payment_date: '2026-10-20', amount: 12778.32, strategy: 'reduce_term' })]
    const repaid = [items[0], { loan: CAR, schedule: computeSchedule(CAR, eps), payments: eps }]
    const t = loansTotals(repaid, NOV_10, same)
    expect(t).toMatchObject({ count: 2, balance: 371728, payment: 2569.75, endsNext: null })
    expect(t.payments.map(p => p.name)).toEqual([MORTGAGE.name])
  })

  it('leaves a closed loan out, and is null without a rate', () => {
    const closed = [items[0], { ...items[1], loan: { ...CAR, status: 'closed', closed_date: '2026-10-20' } }]
    expect(loansTotals(closed, NOV_10, same)).toMatchObject({ count: 1, balance: 371728, endsNext: null })
    expect(loansTotals(items, NOV_10, (v, c) => (c === 'USD' ? null : v)).balance).toBeNull()
  })
})

describe('repayOrInvest', () => {
  // a 20-year mortgage at 9%, 600,000 paid early on a payment day five years in
  const mortgage = makeLoan({ principal: 3_000_000, rate: 9, term_months: 240, issue_date: '2031-02-18' })
  const draft = { payment_date: '2036-02-18', amount: 600_000 }

  it('at a return equal to the loan rate the two paths end level, for either strategy', () => {
    for (const strategy of ['reduce_term', 'reduce_payment'] as const) {
      const r = repayOrInvest(mortgage, [], draft, strategy, 9)!
      expect(Math.abs(r.diff), strategy).toBeLessThan(r.investEnd * 0.002)
      // between two payment days: the amount waits the days to the next one, not a whole month
      const mid = repayOrInvest(mortgage, [], { ...draft, payment_date: '2036-03-03' }, strategy, 9)!
      expect(Math.abs(mid.diff), `${strategy} mid-month`).toBeLessThan(mid.investEnd * 0.002)
    }
  })

  it('a higher return favours investing, a lower one repaying; the horizon is the loan’s own last payment', () => {
    const high = repayOrInvest(mortgage, [], draft, 'reduce_term', 12)!
    const low = repayOrInvest(mortgage, [], draft, 'reduce_term', 5)!
    expect(high.diff).toBeGreaterThan(0)
    expect(low.diff).toBeLessThan(0)
    expect(high.horizon).toBe(computeSchedule(mortgage, []).at(-1)!.date)
    expect(high.investEnd).toBeCloseTo(600_000 * (1 + 0.01) ** (high.payments - 1), 0)
  })

  it('the loan’s other early payments are in both paths', () => {
    const other = makeEP({ loan_name: mortgage.name, payment_date: '2033-05-20', amount: 200_000 })
    const r = repayOrInvest(mortgage, [other], draft, 'reduce_payment', 9)!
    expect(Math.abs(r.diff)).toBeLessThan(r.investEnd * 0.002)
  })

  it('nothing for no amount, a date the schedule refuses, or under two payments left', () => {
    expect(repayOrInvest(mortgage, [], { ...draft, amount: null }, 'reduce_term', 8)).toBeNull()
    expect(repayOrInvest(mortgage, [], { ...draft, payment_date: '2051-01-20' }, 'reduce_term', 8)).toBeNull()
    expect(repayOrInvest(makeLoan(), [], { payment_date: '2032-01-25', amount: 1000 }, 'reduce_term', 8)).toBeNull()
  })
})
