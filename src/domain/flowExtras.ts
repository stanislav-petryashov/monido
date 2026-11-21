// What a month's income-flow picture needs beyond its cash flow: per loan the scheduled principal and the interest inside
// the recorded payment, the net deposits into investment accounts, and the loans opened. Built server-side (the schedules
// and the transfers live there) at the month-end rate "What changed our net worth" uses, so the two cards agree.
import { monthEnd, monthOf } from './dates'
import { convert, round2 } from './fx'
import type { LoanRow, ScheduleRow } from './loans'
import type { AccountTransferInput, CashflowRowBase, FlowExtra, RateLookup } from './types'

export function monthFlowExtras({ months, cashflow, schedules, loans, transfers, rateAt, base }: {
  months: string[]; cashflow: CashflowRowBase[]; schedules: Map<string, ScheduleRow[]>; loans: LoanRow[]
  transfers: AccountTransferInput[]; rateAt: RateLookup; base: string
}): FlowExtra[] {
  return months.map((month): FlowExtra => {
    const rates = rateAt(monthEnd(month))
    const toBase = (amount: number, currency: string) => convert(amount, currency, base, rates)
    const noRate = { month, noRate: true as const }

    const payments = new Map<string, number>()
    for (const r of cashflow) {
      if (!r.loan || r.month !== month) continue
      if (r.expenseBase === null) return noRate
      payments.set(r.bank, (payments.get(r.bank) ?? 0) + r.expenseBase)
    }
    const monthLoans = []
    for (const [name, paid] of payments) {
      const payment = round2(paid)
      const loan = loans.find(l => l.name === name)
      const rows = (schedules.get(name) ?? []).filter(r => monthOf(r.date) === month)
      // a payment whose split is unknown (no such loan, no schedule row this month: paid late or after the schedule) is not
      // called interest: it stays with the expenses and so lands in Not split
      if (!loan || !rows.length) continue
      // the native sum to cents, then the rate, rounded once per loan and month: as capitalChange counts its debt paid
      const native = round2(rows.reduce((n, r) => n + r.principalPart, 0))
      const scheduled = native ? toBase(native, loan.currency) : 0
      if (scheduled === null) return noRate
      const principal = Math.min(round2(scheduled), payment)
      monthLoans.push({ name, payment, principal, interest: Math.max(0, round2(payment - principal)) })
    }

    let invested = 0
    for (const t of transfers) {
      if (monthOf(t.date) !== month) continue
      const amount = toBase(t.amount, t.currency)
      if (amount === null) return noRate
      invested += amount
    }
    const newLoans = loans.filter(l => monthOf(String(l.issue_date).slice(0, 10)) === month).map(l => l.name)
    return { month, loans: monthLoans, invested: round2(invested), newLoans }
  })
}
