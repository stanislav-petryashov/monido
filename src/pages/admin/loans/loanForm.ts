import { round2 } from '../../../domain/fx'
import { calcMonthlyPayment, isPaymentDay, LOAN_TYPES, MAX_TERM_MONTHS, type LoanType } from '../../../domain/loans'
import { amountsInvalid, parseAmount, parseDecimal, readAmounts } from '../amount'
import { isOptionGroup } from '../ui/optionGroup'

/** Values of a loan or early-payment form: column → typed text. */
export type Fields = Record<string, string>

/** Loan fields in form order: [column, locale key of the caption]. */
export const LOAN_FIELDS = [
  ['name',            'data.field.name'],
  ['principal',       'data.loans.field.principal'],
  ['rate',            'data.loans.field.rate'],
  ['term_months',     'data.loans.field.term_months'],
  ['monthly_payment', 'data.loans.field.monthly_payment'],
  ['issue_date',      'data.loans.field.issue_date'],
  ['payment_day',     'data.loans.field.payment_day'],
  ['currency',        'common.currency'],
  ['member',          'data.field.member'],
  ['type',            'data.field.type'],
] as const

/**
 * Whether the Field of a loan field is a group, not a label: an OptionPicker radiogroup (type, currency, member with at
 * most four options), and the term, whose TermInput holds the years / months radios.
 */
export function isGroupField(f: string, currencies: readonly string[], members: readonly string[]): boolean {
  if (f === 'term_months') return true
  const count = f === 'type' ? LOAN_TYPE_OPTIONS.length : f === 'currency' ? currencies.length : f === 'member' ? members.length : null
  return count !== null && isOptionGroup(count)
}

/**
 * Loan fields as the form shows them, in rows of three — name, owner, currency; the type on its own row; principal,
 * rate, term; payment, issue day, payment day: [column, locale key of the caption]. The caption has
 * no unit — the unit sits in the field (loanUnit). The property list of a loan uses LOAN_FIELDS and its fuller captions.
 */
export const LOAN_FORM = [
  ['name',            'data.field.name'],
  ['member',          'data.field.member'],
  ['currency',        'common.currency'],
  ['type',            'data.field.type'],
  ['principal',       'data.loans.field.principal'],
  ['rate',            'data.loans.input.rate'],
  ['term_months',     'data.loans.input.term_months'],
  ['monthly_payment', 'data.loans.input.monthly_payment'],
  ['issue_date',      'data.loans.field.issue_date'],
  ['payment_day',     'data.loans.field.payment_day'],
] as const satisfies readonly (readonly [(typeof LOAN_FIELDS)[number][0], string])[]

/** The unit shown in a loan form field: % for the rate, the loan's currency for the amounts; the term has its years / months switch. */
export function loanUnit(field: string, currency: string | undefined, t: (key: string) => string): string | undefined {
  if (field === 'rate') return t('common.unit.percent')
  if (field === 'principal' || field === 'monthly_payment') return currency || undefined
  return undefined
}

const LOAN_TYPE_CAPTION: Record<LoanType, string> = {
  consumer: 'data.loans.type.consumer',
  mortgage: 'data.loans.type.mortgage',
  car: 'data.loans.type.car',
}

/** Loan types: [value, locale key of the caption]. */
export const LOAN_TYPE_OPTIONS = LOAN_TYPES.map(v => [v, LOAN_TYPE_CAPTION[v]] as const)

/** The two amount fields of a loan: read by parseAmount, which accepts "24 000,5" and refuses what it cannot read */
const LOAN_AMOUNTS = ['principal', 'monthly_payment']

/** True when an amount field of the loan holds text parseAmount refuses; such a form is not saved. */
export const loanAmountInvalid = (data: Fields): boolean => amountsInvalid(data, LOAN_AMOUNTS)

/** True when the form's term is over MAX_TERM_MONTHS (35 years): such a form is not saved, the server refuses it too */
export const termTooLong = (data: Fields): boolean => (parseDecimal(data.term_months ?? '') ?? 0) > MAX_TERM_MONTHS

/**
 * The edit form's fields without the term when it is the stored one: a loan stored before MAX_TERM_MONTHS with a longer
 * term stays editable — the form checks and the server limits only the columns sent.
 */
export function withoutUnchangedTerm(data: Fields, stored: number | string): Fields {
  if (parseDecimal(data.term_months ?? '') !== Number(stored)) return data
  return Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'term_months'))
}

/**
 * The loan's fields as the server takes them: amounts read by parseAmount (an empty one stays empty), decimal comma → dot
 * in the rate and the term. The payment day is a day 1–31, or none (null) when "not set" is picked; a stored day outside
 * 1–31 the picker cannot hold (it shows "not set") was not touched, so it is left out and stays as stored — the server
 * checks only the columns sent. No collateral ('' in `secured_by`) is null.
 */
export function normaliseLoanData(data: Fields): Record<string, string | null> {
  const numeric = ['rate', 'term_months']
  return Object.fromEntries(
    Object.entries(readAmounts(data, LOAN_AMOUNTS))
      .filter(([k, v]) => k !== 'payment_day' || v === '' || isPaymentDay(v))
      .map(([k, v]) => [k, (k === 'payment_day' || k === 'secured_by') && v === '' ? null : numeric.includes(k) ? v.replace(',', '.') : v])
  )
}

/**
 * The formula payment of the form's loan, or undefined until the principal and the term are known. The principal is an
 * amount (parseAmount); the rate and the term have no thousands (parseDecimal), so a rate of "6.125" stays a rate.
 */
export function formulaPayment(d: Fields): string | undefined {
  const p = parseAmount(d.principal ?? '').value ?? 0
  const r = parseDecimal(d.rate ?? '') ?? 0
  const n = parseDecimal(d.term_months ?? '') ?? 0
  return p && n ? String(round2(calcMonthlyPayment(p, r, n))) : undefined
}

/** Two payments are the same within a cent (the formula is rounded to cents, a stored one may be the bank's rounding). */
function samePayment(text: string, formula: string | undefined): boolean {
  const typed = parseAmount(text).value
  return typed !== null && formula !== undefined && Math.abs(typed - Number(formula)) <= 0.01 + 1e-9
}

/** True when the form's payment is the formula payment of its loan: the payment then follows the loan's changes. */
export const paymentFollows = (d: Fields): boolean => samePayment(d.monthly_payment ?? '', formulaPayment(d))

/**
 * The form after a change of the principal, the rate or the term: an empty payment, or one that was the formula
 * payment before the change, becomes the new formula payment — or empty while there is none (the principal or the term
 * cleared mid-edit), so that the next keystroke fills it again; a payment typed from the bank stays.
 */
export function followPayment(before: Fields, after: Fields): Fields {
  const payment = after.monthly_payment ?? ''
  const follows = payment === '' || samePayment(payment, formulaPayment(before))
  const next = formulaPayment(after)
  return follows ? { ...after, monthly_payment: next ?? '' } : after
}

/** A yearly rate above this many percent is likely a typo: the form asks to check it */
export const HIGH_RATE = 60

/**
 * What a typed rate looks like: under 1% a year it is likely a fraction ("0.12" for 12%), `suggested` in percent;
 * over HIGH_RATE it is likely a typo. Neither stops the save.
 */
export function rateCheck(rate: number | null): { kind: 'fraction'; suggested: number } | { kind: 'high' } | null {
  if (rate === null) return null
  if (rate > 0 && rate < 1) return { kind: 'fraction', suggested: Number((rate * 100).toFixed(3)) }
  if (rate > HIGH_RATE) return { kind: 'high' }
  return null
}

/** An amount field's text as a number ("6400,5" and "6400.5" both, parseAmount); empty or unreadable → null. */
export const epAmount = (text: string | undefined): number | null => (text ? parseAmount(text).value : null)

/**
 * True when an amount of the early-payment form holds text parseAmount refuses — the amount, the credited principal, and
 * the new payment when the strategy uses it; such a form is not saved (epPayload would send null in its place).
 */
export function epAmountInvalid(d: Fields): boolean {
  const fields = d['strategy'] === 'reduce_payment' ? ['amount', 'principal_credit', 'new_payment'] : ['amount', 'principal_credit']
  return amountsInvalid(d, fields)
}

// Numeric optional fields: empty input → NULL, not "" (REAL columns in SQLite).
// new_payment only makes sense for reduce_payment — drop a stale value if
// the strategy was switched to reduce_term while editing.
// The amount is sent only when the form has it: an edit may carry just the changed fields.
export function epPayload(d: Fields) {
  const isReducePayment = d['strategy'] === 'reduce_payment'
  return {
    ...d,
    ...('amount' in d ? { amount: epAmount(d['amount']) } : {}),
    new_payment:      isReducePayment ? epAmount(d['new_payment']) : null,
    principal_credit: epAmount(d['principal_credit']),
  }
}

/** Locale keys of the early-payment strategy captions */
export const STRATEGY_LABEL: Record<string, string> = { reduce_term: 'data.loans.strategy.reduce_term', reduce_payment: 'data.loans.strategy.reduce_payment' }
export const STRATEGY_OPTIONS = Object.entries(STRATEGY_LABEL)
