import { latestPerAccount, normalizeClass, type AccountClass } from './accounts'
import { monthEnd, monthOf } from './dates'
import { convertRounded, round2 } from './fx'
import { balanceFromSchedule, computeSchedule, interestNext12m, repaidShare, scheduledPaymentIn, type LoanEarlyPayment, type LoanRow, type ScheduleRow } from './loans'
import type {
  AccountValue, AssetInput, CapitalSnapshot, HistoryPoint, LoanBalance,
  RateLookup, RealEstateInput, RealEstateValue, SecuredLoan,
} from './types'

export interface CapitalInputs {
  assets: AssetInput[]
  realEstate: RealEstateInput[]
  loans: LoanRow[]
  earlyPayments: LoanEarlyPayment[]
}

/** Months ('YYYY-MM') that have at least one account balance, ascending. */
function snapshotMonths(assets: AssetInput[]): string[] {
  return [...new Set(assets.map(a => monthOf(a.date)))].sort()
}

/** Balances of month `ym`; balances are never carried over from earlier months. */
function accountsIn(assets: AssetInput[], ym: string): AssetInput[] {
  return latestPerAccount(assets.filter(a => monthOf(a.date) === ym))
}

/**
 * Latest valuation up to the snapshot year; before the first one — the purchase price. Nothing before the purchase date.
 * The owner is that row's, '' when none is set.
 */
function realEstateIn(rows: RealEstateInput[], ym: string): Omit<RealEstateValue, 'valueBase'>[] {
  const year = Number(ym.slice(0, 4))
  const end = monthEnd(ym)
  const byName = new Map<string, RealEstateInput[]>()
  for (const row of rows) {
    const group = byName.get(row.name)
    if (group) group.push(row)
    else byName.set(row.name, [row])
  }
  const out: Omit<RealEstateValue, 'valueBase'>[] = []
  for (const [name, list] of byName) {
    if (list[0].purchase_date.slice(0, 10) > end) continue
    let valued: RealEstateInput | undefined
    for (const row of list) {
      if (row.valuation_year <= year && (!valued || row.valuation_year > valued.valuation_year)) valued = row
    }
    if (valued) {
      out.push({ name, member: valued.member ?? '', currency: valued.currency, value: valued.value })
    } else {
      out.push({ name, member: list[0].member ?? '', currency: list[0].purchase_currency, value: list[0].purchase_price })
    }
  }
  return out
}

const sum = (values: (number | null)[]) => values.reduce<number>((s, v) => s + (v ?? 0), 0)

/** Base-currency value summed per key, largest first; rows without a base value (no rate) are left out. */
function breakdownBy<K extends string>(rows: { key: K; valueBase: number | null }[]): { key: K; valueBase: number }[] {
  const totals = new Map<K, number>()
  for (const r of rows) if (r.valueBase !== null) totals.set(r.key, (totals.get(r.key) ?? 0) + r.valueBase)
  return [...totals].map(([key, v]) => ({ key, valueBase: round2(v) })).sort((a, b) => b.valueBase - a.valueBase)
}

/**
 * Capital at the end of month `ym` in the `base` currency; every component uses that day's rate.
 * `schedules` (loan name → computeSchedule of that loan) spares rebuilding them per month.
 */
export function capitalAt(
  inputs: CapitalInputs, ym: string, rateAt: RateLookup, base: string, schedules?: Map<string, ScheduleRow[]>,
): CapitalSnapshot {
  const date = monthEnd(ym)
  const rates = rateAt(date)
  const toBase = (value: number, currency: string) => convertRounded(value, currency, base, rates)

  const accounts: AccountValue[] = accountsIn(inputs.assets, ym).map(a => ({
    name: a.name, member: a.member ?? '', class: normalizeClass(a.class),
    currency: a.currency, value: a.value, valueBase: toBase(a.value, a.currency),
  }))
  const realEstate: RealEstateValue[] = realEstateIn(inputs.realEstate, ym)
    .map(r => ({ ...r, valueBase: toBase(r.value, r.currency) }))
  const loans: LoanBalance[] = []
  const securedLoans: SecuredLoan[] = []
  for (const loan of inputs.loans) {
    const schedule = schedules?.get(loan.name)
      ?? computeSchedule(loan, inputs.earlyPayments.filter(ep => ep.loan_name === loan.name))
    const balance = balanceFromSchedule(loan, schedule, date)
    const issued = String(loan.issue_date).slice(0, 10) <= date
    // a closed loan secured by a property still says so, with nothing left owing
    if (loan.secured_by && issued && realEstate.some(r => r.name === loan.secured_by)) {
      const owed = round2(balance ?? 0)
      securedLoans.push({
        name: loan.name, property: loan.secured_by, currency: loan.currency, principal: Number(loan.principal),
        issueDate: String(loan.issue_date).slice(0, 10), type: loan.type || 'consumer', balance: owed, balanceBase: owed === 0 ? 0 : toBase(owed, loan.currency),
      })
    }
    if (balance === null) continue
    const interest = interestNext12m(schedule, date)
    const payment = round2(scheduledPaymentIn(schedule, ym))
    const principal = Number(loan.principal)
    loans.push({
      name: loan.name, member: loan.member, type: loan.type || 'consumer', currency: loan.currency,
      rate: Number(loan.rate), balance: round2(balance),
      repaidPct: repaidShare(balance, principal),
      // 0 owed is 0 in any currency, as for a secured loan above
      balanceBase: balance === 0 ? 0 : toBase(balance, loan.currency),
      payment, paymentBase: toBase(payment, loan.currency),
      interestNext12m: round2(interest), interestNext12mBase: toBase(interest, loan.currency),
    })
  }

  const accountsBase = sum(accounts.map(a => a.valueBase))
  const realEstateBase = sum(realEstate.map(r => r.valueBase))
  const liabilities = sum(loans.map(l => l.balanceBase))
  const byClass = new Map<AccountClass | 'real_estate', number>()
  for (const a of accounts) byClass.set(a.class, (byClass.get(a.class) ?? 0) + (a.valueBase ?? 0))
  if (realEstateBase) byClass.set('real_estate', realEstateBase)

  return {
    date,
    assets: round2(accountsBase + realEstateBase),
    liabilities: round2(liabilities),
    netWorth: round2(accountsBase + realEstateBase - liabilities),
    liquid: round2(sum(accounts.filter(a => a.class === 'bank').map(a => a.valueBase))),
    byClass: [...byClass].map(([c, v]) => ({ class: c, valueBase: round2(v) })).sort((a, b) => b.valueBase - a.valueBase),
    byCurrency: breakdownBy([...accounts, ...realEstate].map(x => ({ key: x.currency, valueBase: x.valueBase })))
      .map(({ key, valueBase }) => ({ currency: key, valueBase })),
    // A property without an owner counts under '' like an account without a member
    byMember: breakdownBy([...accounts, ...realEstate].map(x => ({ key: x.member, valueBase: x.valueBase })))
      .map(({ key, valueBase }) => ({ member: key, valueBase })),
    accounts, realEstate, loans, securedLoans,
  }
}

/** Each loan's schedule by name, its early repayments included: built once for the whole history */
export function loanSchedules(inputs: CapitalInputs): Map<string, ScheduleRow[]> {
  return new Map(inputs.loans.map(loan => [loan.name, computeSchedule(loan, inputs.earlyPayments.filter(ep => ep.loan_name === loan.name))]))
}

export function capitalHistory(inputs: CapitalInputs, rateAt: RateLookup, base: string, schedules = loanSchedules(inputs)): CapitalSnapshot[] {
  // One schedule per loan for the whole history: rebuilding it every month dominated the snapshot's CPU.
  return snapshotMonths(inputs.assets).map(ym => capitalAt(inputs, ym, rateAt, base, schedules))
}

export function toHistoryPoint(c: CapitalSnapshot): HistoryPoint {
  return { date: c.date, assets: c.assets, liabilities: c.liabilities, netWorth: c.netWorth }
}
