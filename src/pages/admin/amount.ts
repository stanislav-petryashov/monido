import { fmtCompact, fmtCompactCurrency } from '../../lib/formatters'
import type { ToastApi } from '../../lib/notifyState'
import { hasUnreadDate } from './dateMask'

/**
 * An amount from an input field. An empty field means "not filled in" (value null); text that
 * cannot be read unambiguously is an error (invalid): "1.000" may be a thousand or one, and
 * guessing is not allowed — a wrong guess would record an amount a thousand times smaller.
 */
export function parseAmount(text: string): { value: number | null; invalid: boolean } {
  const clean = text.replace(/\s/g, '')
  if (clean === '') return { value: null, invalid: false }
  const match = /^(-?\d+)(?:[.,](\d+))?$/.exec(clean)
  if (!match) return { value: null, invalid: true }
  const [, whole, fraction] = match
  // exactly three digits after the separator with a non-zero whole part is most likely a thousands separator
  if (fraction?.length === 3 && Number(whole) !== 0) return { value: null, invalid: true }
  return { value: Number(fraction ? `${whole}.${fraction}` : whole), invalid: false }
}

/**
 * The text a form is prefilled with for a stored amount. String(n) is right except for exactly three decimals
 * ("1234.125"), which parseAmount refuses as a possible thousands separator: a stored number must save untouched,
 * so such text gets a fourth digit ("1234.1250" reads back as 1234.125). Typed text keeps parseAmount's rules.
 */
export function amountText(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /^-?[1-9]\d*\.\d{3}$/.test(text) ? `${text}0` : text
}

/** True when one of a form's amount fields `keys` holds text parseAmount refuses; such a form is not saved. */
export function amountsInvalid(data: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some(k => typeof data[k] === 'string' && parseAmount(data[k]).invalid)
}

/** False, with the notification, when an amount (`amountsBad`) or a date of the form cannot be read: such a form is not saved */
export function readable(data: Record<string, unknown>, amountsBad: boolean, toast: ToastApi, t: (key: string) => string): boolean {
  if (amountsBad) toast.error(t('data.common.saveFailed'), t('data.common.notNumber'))
  else if (hasUnreadDate(data)) toast.error(t('data.common.saveFailed'), t('data.common.dateUnread'))
  else return true
  return false
}

/**
 * A form with its amount fields `keys` as the server takes them: typed text read by parseAmount ("24 000,5" → "24000.5"),
 * an empty one stays empty, text it refuses stays as typed (check amountsInvalid first); numbers and the other fields as they are.
 */
export function readAmounts<T extends Record<string, unknown>>(data: T, keys: readonly string[]): T {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => {
    if (!keys.includes(k) || typeof v !== 'string') return [k, v]
    const { value, invalid } = parseAmount(v)
    return [k, invalid ? v : value === null ? '' : String(value)]
  })) as T
}

/**
 * A number that has no thousands — a rate, a term: a comma or a dot is the decimal separator, so "6.125" is six and an
 * eighth (parseAmount would refuse it as a possible thousand). Empty or unreadable text → null.
 */
export function parseDecimal(text: string): number | null {
  const clean = text.trim()
  if (!/^-?\d+(?:[.,]\d+)?$/.test(clean)) return null
  return Number(clean.replace(',', '.'))
}

/** From this size an amount is repeated under its field in short: the zeros of 1 250 000 are easy to miscount. */
const COMPACT_FROM = 10_000

/** A large typed amount in short for under its field: in its currency when `unit` is one ("12.5M ₽"); none in privacy mode. */
export function compactHint(amount: number | null, unit: string | undefined, hidden: boolean): string | undefined {
  if (hidden || amount === null || Math.abs(amount) < COMPACT_FROM) return undefined
  return unit ? fmtCompactCurrency(amount, unit) : fmtCompact(amount)
}
