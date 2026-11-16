// The return of one investment account, money-weighted (XIRR over monthly steps): what the money in it earned once what
// was put in and taken out (account_transfers) is set aside. In the account's own currency, no exchange rates.
import { shiftMonth } from './dates'
import { round2 } from './fx'
import { MIN_RETURN_MONTHS } from './returns'

export interface AccountReturn {
  /** The span's end balance − its start balance − what was put in (net), in the account's currency */
  gain: number
  /** Money-weighted, per year (0.07 = 7%); null under MIN_RETURN_MONTHS months, or when no rate fits (no money was in) */
  annualRate: number | null
  /** The months of the span, and the first of them */
  months: number
  firstMonth: string
}

/** Monthly rates searched between −99% and +1000% a month */
const LOW = -0.99
const HIGH = 10

/**
 * The latest unbroken run of months up to `through` (the last closed month) that each have a month-end balance and an
 * entered transfer (zero included), started from the balance of the month before it (zero when the account had no
 * balance before: it was opened in the run). A transfer counts at mid-month. Null when `through` itself has no balance or
 * no transfer entered: the return is not known.
 */
export function accountReturn(
  balances: readonly { month: string; value: number }[], transfers: readonly { month: string; amount: number }[], through: string,
): AccountReturn | null {
  const balanceOf = new Map(balances.map(b => [b.month, b.value]))
  const transferOf = new Map(transfers.map(t => [t.month, t.amount]))
  const span: string[] = []
  for (let m = through; balanceOf.has(m) && transferOf.has(m); m = shiftMonth(m, -1)) span.unshift(m)
  // the month before the run must have a balance, unless the account did not exist yet
  while (span.length > 0 && !balanceOf.has(shiftMonth(span[0], -1)) && balances.some(b => b.month < span[0])) span.shift()
  if (span.length === 0) return null
  const start = balanceOf.get(shiftMonth(span[0], -1)) ?? 0
  const end = balanceOf.get(span[span.length - 1])!
  const flows = span.map(m => transferOf.get(m)!)
  const n = span.length
  // what the start balance and each transfer grow to by the end at a monthly rate r, less the end balance
  const excess = (r: number) => start * (1 + r) ** n + flows.reduce((s, t, i) => s + t * (1 + r) ** (n - i - 0.5), 0) - end
  let rate: number | null = null
  if (n >= MIN_RETURN_MONTHS) {
    let lo = LOW
    let hi = HIGH
    if (Math.sign(excess(lo)) !== Math.sign(excess(hi)) && excess(lo) !== 0) {
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2
        if (Math.sign(excess(mid)) === Math.sign(excess(lo))) lo = mid
        else hi = mid
      }
      rate = (1 + (lo + hi) / 2) ** 12 - 1
    }
  }
  return { gain: round2(end - start - flows.reduce((s, t) => s + t, 0)), annualRate: rate, months: n, firstMonth: span[0] }
}
