import { round2 } from './fx'
import type { CapitalSnapshot, SecuredLoan } from './types'

/** A valuation of a property in a year */
export interface Valuation { year: number; value: number; currency: string }

/** What a property gained since it was bought; every field is in the valuation's currency */
export interface PropertyGain {
  /** The latest valuation minus the purchase price */
  amount: number
  /** `amount` as a percentage of the purchase price; null for a free purchase (price 0) */
  percent: number | null
  /** `amount` per year held (the valuation's year minus the purchase year); null when under a year passed or the purchase year is unknown */
  perYear: number | null
  currency: string
}

/** The newest valuation, or null for none */
export function latestValuation(valuations: Valuation[]): Valuation | null {
  return valuations.reduce<Valuation | null>((best, v) => (best === null || v.year > best.year ? v : best), null)
}

/**
 * The change from the purchase to the latest valuation. null when there is nothing to compare: no valuation, no purchase price,
 * or the two are in different currencies (the domain does not guess a rate for a past purchase).
 */
export function propertyGain(
  purchase: { price: number; date: string; currency: string },
  valuations: Valuation[],
): PropertyGain | null {
  const latest = latestValuation(valuations)
  if (!latest || !Number.isFinite(purchase.price) || latest.currency !== purchase.currency) return null
  const amount = latest.value - purchase.price
  // an empty or unreadable purchase date has no year: no per-year figure rather than a gain spread over ~2000 years
  const boughtIn = Number(String(purchase.date ?? '').slice(0, 4))
  const years = Number.isFinite(boughtIn) && boughtIn > 0 ? latest.year - boughtIn : NaN
  return {
    amount,
    percent: purchase.price > 0 ? (amount / purchase.price) * 100 : null,
    perYear: years >= 1 ? amount / years : null,
    currency: latest.currency,
  }
}

/** A valuation with its change against the one before it (the first: against the purchase price) */
export type ValuationChange<V extends Valuation = Valuation> = V & ChangeFields
interface ChangeFields {
  /** What it was compared with: the previous valuation's value, or the purchase price for the first */
  before: number
  /** Whether `before` is the purchase price */
  againstPurchase: boolean
  /** value − before; null when the two are in different currencies */
  change: number | null
  /** `change` as a percentage of `before`; null without a change or for a `before` of 0 */
  pct: number | null
}

/** Each valuation (its other fields kept), newest first, with its change against the previous one; the first against the purchase price. */
export function valuationChanges<V extends Valuation>(valuations: V[], purchase: { price: number; currency: string }): ValuationChange<V>[] {
  const oldest = [...valuations].sort((a, b) => a.year - b.year)
  return oldest.map((v, i) => {
    const prev = oldest[i - 1] ?? { value: purchase.price, currency: purchase.currency }
    const change = prev.currency === v.currency && Number.isFinite(prev.value) ? v.value - prev.value : null
    return { ...v, before: prev.value, againstPurchase: i === 0, change, pct: change !== null && prev.value !== 0 ? (change / prev.value) * 100 : null }
  }).reverse()
}

/** Complete property total and its share of a known, positive asset total. */
export function propertyTotals(values: readonly (number | null)[], assetTotal: number | null): { total: number | null; sharePct: number | null } {
  if (values.some(v => v === null || !Number.isFinite(v))) return { total: null, sharePct: null }
  const total = round2(values.reduce<number>((sum, value) => sum + value!, 0))
  return { total, sharePct: assetTotal !== null && Number.isFinite(assetTotal) && assetTotal > 0 ? total / assetTotal * 100 : null }
}

/** A property's share of the snapshot's assets, %; null when it has no base value (no rate) or there are no assets. */
export function propertyShare(capital: Pick<CapitalSnapshot, 'assets' | 'realEstate'>, name: string): number | null {
  const valueBase = capital.realEstate.find(r => r.name === name)?.valueBase ?? null
  return valueBase !== null && capital.assets > 0 ? (valueBase / capital.assets) * 100 : null
}

/** What the family owns of a property with linked loans, in the snapshot's currency */
export interface PropertyEquity {
  /** The value the assets use; null — no rate */
  valueBase: number | null
  /** Σ the linked loans' balances at the snapshot date; null — one of them has no rate */
  debtBase: number | null
  /** value − debt; null when either is unknown */
  equityBase: number | null
  /** debt / value, %; null when either is unknown or the value is 0 */
  ltvPct: number | null
  loans: SecuredLoan[]
}

/**
 * Equity and loan-to-value of property `name` at the snapshot's date: its value there less the balances of the loans
 * secured by it (from the schedule, a closed one 0). Null when no loan is linked to it.
 */
export function propertyEquity(capital: Pick<CapitalSnapshot, 'realEstate' | 'securedLoans'>, name: string): PropertyEquity | null {
  const property = capital.realEstate.find(r => r.name === name)
  const loans = capital.securedLoans.filter(l => l.property === name)
  if (!property || loans.length === 0) return null
  const valueBase = property.valueBase
  const debtBase = loans.some(l => l.balanceBase === null) ? null : round2(loans.reduce((s, l) => s + l.balanceBase!, 0))
  return {
    valueBase, debtBase, loans,
    equityBase: valueBase === null || debtBase === null ? null : round2(valueBase - debtBase),
    ltvPct: valueBase === null || debtBase === null || valueBase === 0 ? null : (debtBase / valueBase) * 100,
  }
}

/** Whether every loan linked to a property is a mortgage: the page then names them so («Mortgage»), else «Loan» */
export const securedByMortgage = (loans: Pick<SecuredLoan, 'type'>[]): boolean => loans.length > 0 && loans.every(l => l.type === 'mortgage')

/** A loan issued up to this many days after the purchase (or before it) paid for the purchase */
const WITH_PURCHASE_DAYS = 31

/** A row of the "How the equity grew" waterfall; every amount is in the property's currency */
export type EquityStep =
  /** equity at purchase: the price less the loans issued with it; `noLoan` — none was */
  | { kind: 'start'; date: string; amount: number; noLoan: boolean }
  /** a loan issued later took this much equity out (amount < 0) */
  | { kind: 'borrowed'; loan: string; date: string; amount: number }
  /** the value's change from the purchase price */
  | { kind: 'value'; from: number; to: number; amount: number }
  /** a loan's principal repaid by the snapshot date */
  | { kind: 'repaid'; loan: string; from: number; to: number; amount: number }
  /** equity now: value − Σ balances */
  | { kind: 'end'; amount: number }

/**
 * How the equity grew from the purchase to the snapshot: the start (price − the loans issued with it), a "borrowed" step
 * for each loan issued later, the value's change and each loan's repaid principal, then the end; amounts round2, so for
 * amounts in cents the steps sum to the end to the cent. Null when the purchase, the value and every loan are not in one currency (no rate is guessed for the past).
 */
export function equitySteps(
  purchase: { price: number; date: string; currency: string },
  value: { value: number; currency: string },
  loans: Pick<SecuredLoan, 'name' | 'principal' | 'issueDate' | 'currency' | 'balance'>[],
): EquityStep[] | null {
  if (value.currency !== purchase.currency || loans.some(l => l.currency !== purchase.currency)) return null
  const bought = Date.parse(purchase.date.slice(0, 10))
  const withPurchase = (l: (typeof loans)[number]) => !Number.isFinite(bought) || (Date.parse(l.issueDate) - bought) / 86_400_000 <= WITH_PURCHASE_DAYS
  const early = loans.filter(withPurchase)
  const late = loans.filter(l => !withPurchase(l)).sort((a, b) => a.issueDate.localeCompare(b.issueDate))
  const start = purchase.price - early.reduce((s, l) => s + l.principal, 0)
  return [
    { kind: 'start', date: purchase.date.slice(0, 10), amount: round2(start), noLoan: early.length === 0 },
    ...late.map(l => ({ kind: 'borrowed' as const, loan: l.name, date: l.issueDate, amount: -l.principal })),
    { kind: 'value', from: purchase.price, to: value.value, amount: round2(value.value - purchase.price) },
    ...loans.map(l => ({ kind: 'repaid' as const, loan: l.name, from: l.principal, to: l.balance, amount: round2(l.principal - l.balance) })),
    { kind: 'end', amount: round2(value.value - loans.reduce((s, l) => s + l.balance, 0)) },
  ]
}
