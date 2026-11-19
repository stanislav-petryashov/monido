// What changed a closed month's net worth, cause by cause: the family's saving, the scheduled loan principal, investments,
// exchange rates, property revaluation and what the records do not explain. The rows always add up to the change.
import { RETURN_CLASSES, accountKey } from './accounts'
import { monthOf, shiftMonth } from './dates'
import { convert, round2 } from './fx'
import type { ScheduleRow } from './loans'
import type {
  CapitalSnapshot, CashflowRowBase, ChangeCandidate, ChangeItem, ChangePair, ChangeRowKey, MonthChange, MonthChangeGap, RateLookup,
} from './types'

export interface MonthChangeInput {
  month: string
  /** Net worth at the end of the month before and of the month; null — the month is the first of history */
  start: CapitalSnapshot | null; end: CapitalSnapshot
  /** The capitals are complete (capitalCoverage.capitalKnown): every balance observed and converted */
  startComplete: boolean; endComplete: boolean
  rateAt: RateLookup; base: string
  /** The month's cash-flow rows, the accounts' and the loans'; null — no flows that month (the balances form) */
  flows: CashflowRowBase[] | null
  /** Each loan's schedule by name, early repayments included */
  schedules: Map<string, ScheduleRow[]>
  /** The month's deposits (+) and withdrawals (−) of investment accounts, in each account's own currency */
  transfers: { name: string; member: string; amount: number }[]
}

/** An unexplained rest below this share of the month's other movements (and below one unit) is rounding and rate dates: no candidates */
export const MATERIAL_SHARE = 0.01

export const isMonthChange = (m: MonthChange | MonthChangeGap): m is MonthChange => 'rows' in m

const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0))

export function monthChange(input: MonthChangeInput): MonthChange | MonthChangeGap {
  const { month, start, end, rateAt, base, flows, schedules, transfers } = input
  if (!start) return { month, reason: 'no_previous' }
  const rateless = (c: CapitalSnapshot) =>
    c.accounts.some(a => a.valueBase === null) || c.realEstate.some(r => r.valueBase === null) || c.loans.some(l => l.balanceBase === null)
  if (!input.endComplete) return { month, reason: rateless(end) ? 'no_rate' : 'no_balance' }
  // the month before is the incomplete one: the person is sent to it
  if (!input.startComplete) return { month, reason: rateless(start) ? 'no_rate' : 'no_balance', at: shiftMonth(month, -1) }
  if (flows?.some(r => [r.activeBase, r.passiveBase, r.expenseBase].some(v => v === null))) return { month, reason: 'no_rate' }

  // base units per unit of a currency at the end of the month before (r0) and of the month (r1)
  const rate = (currency: string, date: string) => convert(1, currency, base, rateAt(date))
  const r0 = (c: string) => rate(c, start.date), r1 = (c: string) => rate(c, end.date)
  const gap = (): MonthChangeGap => ({ month, reason: 'no_rate' })

  const accountsBefore = new Map(start.accounts.map(a => [accountKey(a.name, a.member), a]))
  const accountsAfter = new Map(end.accounts.map(a => [accountKey(a.name, a.member), a]))
  const homesBefore = new Map(start.realEstate.map(r => [r.name, r]))
  const homesAfter = new Map(end.realEstate.map(r => [r.name, r]))
  const loansBefore = new Map(start.loans.map(l => [l.name, l]))
  const loansAfter = new Map(end.loans.map(l => [l.name, l]))

  // Exchange rates: a holding held at both ends in the same foreign currency moves by its start amount × the rate change
  const fx: ChangeItem[] = []
  const rates = new Map<string, { currency: string; start: number; end: number }>()
  const fxOf = (currency: string, native: number, sign: 1 | -1): number | null => {
    if (currency === base) return 0
    const a = r0(currency), b = r1(currency)
    if (a === null || b === null) return null
    rates.set(currency, { currency, start: a, end: b })
    return round2(sign * native * (b - a))
  }
  const held = <T extends { currency: string }>(before: Map<string, T>, after: Map<string, T>) =>
    [...before].flatMap(([key, s]) => { const e = after.get(key); return e && e.currency === s.currency ? [[s, e] as const] : [] })
  for (const [s] of held(accountsBefore, accountsAfter)) {
    const amount = fxOf(s.currency, s.value, 1)
    if (amount === null) return gap()
    if (amount) fx.push({ kind: 'account', name: s.name, member: s.member, currency: s.currency, amount, native: s.value })
  }
  for (const [s] of held(homesBefore, homesAfter)) {
    const amount = fxOf(s.currency, s.value, 1)
    if (amount === null) return gap()
    if (amount) fx.push({ kind: 'realEstate', name: s.name, member: s.member, currency: s.currency, amount, native: s.value })
  }
  for (const [s] of held(loansBefore, loansAfter)) {
    const amount = fxOf(s.currency, s.balance, -1)
    if (amount === null) return gap()
    if (amount) fx.push({ kind: 'loan', name: s.name, member: s.member, currency: s.currency, amount, native: s.balance })
  }

  // Property revaluation: a valuation's own-currency change between two valuations, at the end rate
  const property: ChangeItem[] = []
  for (const [s, e] of held(homesBefore, homesAfter)) {
    const r = r1(e.currency)
    if (r === null) return gap()
    const amount = round2((e.value - s.value) * r)
    if (amount) property.push({ kind: 'realEstate', name: e.name, member: e.member, currency: e.currency, amount, native: round2(e.value - s.value) })
  }

  // The scheduled principal of the month's regular payments; the early repayments are a neutral pair, their interest a loss
  const debtPaid: ChangeItem[] = []
  const pairs: ChangePair[] = []
  let earlyInterest = 0
  for (const name of new Set([...loansBefore.keys(), ...loansAfter.keys()])) {
    const loan = (loansAfter.get(name) ?? loansBefore.get(name))!
    const schedule = schedules.get(name) ?? []
    const rows = schedule.filter(r => monthOf(r.date) === month)
    // early repayments count in the month they were paid, which is not always their installment row's
    const early = schedule.flatMap(x => (x.earlyCredits
      ? x.earlyCredits.filter(c => monthOf(c.date) === month)
      : monthOf(x.date) === month && x.earlyPayment ? [{ amount: x.earlyPayment, principal: x.earlyPrincipal }] : []))
    if (!rows.length && !early.length) continue
    const r = r1(loan.currency)
    if (r === null) return gap()
    const principal = round2(sum(rows.map(x => x.principalPart)) * r)
    if (principal) debtPaid.push({ kind: 'loan', name, member: loan.member, currency: loan.currency, amount: principal, native: sum(rows.map(x => x.principalPart)) })
    const credited = round2(sum(early.map(c => c.principal)) * r)
    if (credited) pairs.push({ kind: 'early', name, amount: credited })
    earlyInterest += round2(sum(early.map(c => c.principal - c.amount)) * r)
  }

  // Purchases, sales and new loans: their value is assumed to have come from or gone to the family's accounts
  for (const [name, e] of homesAfter) if (!homesBefore.has(name)) pairs.push({ kind: 'purchase', name, amount: e.valueBase! })
  for (const [name, s] of homesBefore) if (!homesAfter.has(name)) pairs.push({ kind: 'sale', name, amount: -s.valueBase! })
  for (const [name, e] of loansAfter) if (!loansBefore.has(name) && e.balanceBase) pairs.push({ kind: 'newLoan', name, amount: -e.balanceBase })
  const counter = round2(-sum(pairs.map(p => p.amount)))
  if (counter) pairs.push({ kind: 'accounts', name: '', amount: counter })

  const delta = round2(end.netWorth - start.netWorth)
  const known: Partial<Record<ChangeRowKey, number>> = {
    debtPaid: sum(debtPaid.map(i => i.amount)),
    ...(earlyInterest ? { earlyInterest: round2(earlyInterest) } : {}),
    fx: sum(fx.map(i => i.amount)),
    property: sum(property.map(i => i.amount)),
    ...(pairs.length ? { moves: 0 } : {}),
  }
  const items = { debtPaid, fx, property }
  const result = (form: MonthChange['form'], rows: Partial<Record<ChangeRowKey, number>>, extra: Partial<MonthChange> = {}): MonthChange => ({
    month, form, start: start.netWorth, end: end.netWorth, rows, items, pairs, candidates: [],
    rates: [...rates.values()].sort((a, b) => a.currency.localeCompare(b.currency)), ...extra,
  })

  if (flows === null) {
    const accounts = round2(delta - sum(Object.values(known)))
    return result('balances', { accounts, ...known })
  }

  const saved = sum(flows.map(r => r.activeBase! + r.passiveBase! - r.expenseBase!))
  const accountFlow = (name: string, member: string) => flows.find(r => !r.loan && r.bank === name && r.member === member)
  const transferOf = (name: string, member: string) => transfers.find(t => t.name === name && t.member === member)

  // Investments: an investment account's change less its deposits and its own recorded flows, in the months with deposits entered
  const investments: ChangeItem[] = []
  for (const [key, e] of accountsAfter) {
    const t = transferOf(e.name, e.member)
    if (!RETURN_CLASSES.includes(e.class) || !t) continue
    const r = r1(e.currency)
    if (r === null) return gap()
    const s = accountsBefore.get(key)
    const own = accountFlow(e.name, e.member)
    const native = round2(e.value - (s?.value ?? 0) - t.amount - (own ? own.active + own.passive - own.expense : 0))
    const amount = round2(native * r)
    if (amount) investments.push({ kind: 'account', name: e.name, member: e.member, currency: e.currency, amount, native })
  }

  const rows: Partial<Record<ChangeRowKey, number>> = { saved, ...known, investments: sum(investments.map(i => i.amount)) }
  const unexplained = round2(delta - sum(Object.values(rows)))

  // The accounts that may explain the rest: not shares of it, the records cannot attribute it additively
  const candidates: ChangeCandidate[] = []
  const floor = Math.max(1, MATERIAL_SHARE * sum(Object.values(rows).map(v => Math.abs(v ?? 0))))
  if (Math.abs(unexplained) >= floor) {
    for (const key of new Set([...accountsBefore.keys(), ...accountsAfter.keys()])) {
      const s = accountsBefore.get(key), e = accountsAfter.get(key)
      const a = (e ?? s)!
      const r = r1(a.currency)
      const change = r === null ? round2(-(s?.valueBase ?? 0)) : round2(((e?.value ?? 0) - (s?.value ?? 0)) * r)
      const own = accountFlow(a.name, a.member)
      const investment = RETURN_CLASSES.includes(a.class)
      // an investment account with its deposits entered is explained by the investments row
      if (investment && transferOf(a.name, a.member)) continue
      if (investment) candidates.push({ name: a.name, member: a.member, reason: 'no_transfer', change })
      else if (change && !(own && (own.active || own.passive || own.expense))) candidates.push({ name: a.name, member: a.member, reason: 'no_record', change })
    }
  }

  return result('tracked', { ...rows, unexplained }, { items: { ...items, investments }, candidates })
}
