import { isDay, isoDate, monthOf, monthsBetween, shiftMonth } from './dates'
import { round2, roundTo } from './fx'

export interface LoanRow {
  rowid: number
  name: string
  principal: number | string
  rate: number | string
  term_months: number | string
  monthly_payment: number | string
  issue_date: string
  payment_day: number | string | null
  currency: string
  member: string
  type: string
  status: string
  closed_date: string | null
  /** The property (real_estate name) the loan is secured by; null or absent — none */
  secured_by?: string | null
}

export interface LoanEarlyPayment {
  rowid: number
  id: number
  loan_name: string
  payment_date: string
  amount: number | string
  strategy: string
  // Exact bank values (optional). new_payment — the actual monthly payment
  // after a reduce_payment EP; principal_credit — the exact amount the bank
  // credited to principal (overrides the interest-deduction formula).
  new_payment: number | string | null
  principal_credit: number | string | null
  notes: string | null
}

/** The loan types the form offers and the advisor accepts */
export const LOAN_TYPES = ['consumer', 'mortgage', 'car'] as const
export type LoanType = (typeof LOAN_TYPES)[number]

/** The longest loan term, in months (35 years): the form, the server and the advisor refuse a longer one */
export const MAX_TERM_MONTHS = 420

/** The early-payment strategies computeSchedule applies; the server refuses any other */
export const EARLY_PAYMENT_STRATEGIES: readonly string[] = ['reduce_term', 'reduce_payment']

/**
 * Whether a loan's payment day is one the server stores: none (null — the schedule takes the issue day) or a whole day
 * 1–31. computeSchedule still reads any other stored value as none.
 */
export function isPaymentDay(value: unknown): boolean {
  if (value === null || value === undefined) return true
  const day = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN
  return Number.isInteger(day) && day >= 1 && day <= 31
}

export function calcMonthlyPayment(principal: number, rate: number, term: number): number {
  if (!principal || !term) return 0
  const r = rate / 12 / 100
  if (r <= 0) return principal / term
  return principal * (r * Math.pow(1 + r, term)) / (Math.pow(1 + r, term) - 1)
}

export interface ScheduleRow {
  rowNum: number
  date: string
  openingBalance: number
  scheduledPayment: number
  principalPart: number
  interest: number
  earlyPayment: number
  closingBalance: number
  /** The day the balance reached zero in this row — an early payment's date or the installment's; absent when it did not */
  zeroedOn?: string
  /** A row with early payments: the balance after each of its events (early payments and the installment) in date order */
  events?: { date: string; balance: number }[]
}

/** The same day of the next month, clamped to its length; anchored at day 1 before changing months, so Jan 31 does not skip February. */
function nextMonth(date: Date, day: number): Date {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)))
}

/**
 * Payments that repay `bal` at `payment`: the annuity term n = ceil(-ln(1 - r·B/P) / ln(1 + r)).
 * Null when the payment does not even cover the interest, so it never amortises the balance.
 */
function annuityTerm(bal: number, payment: number, monthlyRate: number): number | null {
  if (monthlyRate <= 0) return Math.ceil(bal / payment)
  const interestShare = monthlyRate * bal / payment
  if (interestShare >= 1) return null
  return Math.ceil(-Math.log(1 - interestShare) / Math.log(1 + monthlyRate))
}

export function computeSchedule(loan: LoanRow, earlyPayments: LoanEarlyPayment[]): ScheduleRow[] {
  const principal   = Number(loan.principal)
  const rate        = Number(loan.rate)
  const termMonths  = Number(loan.term_months)
  const monthlyRate = rate / 12 / 100
  if (!Number.isFinite(principal) || principal <= 0 || !Number.isInteger(termMonths) || termMonths <= 0 || !Number.isFinite(rate) || rate < 0) return []

  let balance = principal
  const formulaPayment = calcMonthlyPayment(principal, rate, termMonths)
  if (!formulaPayment) return []
  const storedPayment = Number(loan.monthly_payment)
  const hasManualPayment = storedPayment > 0 && Number.isFinite(storedPayment) && Math.abs(storedPayment - formulaPayment) > 1
  // Use stored payment as the starting payment when manually overridden.
  // This is critical for refinanced loans where the bank's actual payment
  // differs from what the annuity formula would give for the stated parameters.
  let payment = hasManualPayment ? storedPayment : formulaPayment
  let remaining = termMonths

  const startDate = new Date(loan.issue_date)
  if (!Number.isFinite(startDate.getTime())) return []
  const issueDay = isoDate(startDate)
  const configuredDay = Number(loan.payment_day)
  const payDay = configuredDay >= 1 && configuredDay <= 31 ? configuredDay : startDate.getUTCDate()
  let currentDate = nextMonth(startDate, payDay)
  // Preserve the existing convention: the first payment is at least one month after issue.
  const minFirstDate = nextMonth(startDate, startDate.getUTCDate())
  if (currentDate < minFirstDate) currentDate = nextMonth(currentDate, payDay)

  const dailyRate = rate / 365 / 100   // for accrued-interest deduction from EPs
  let prevPayDate = new Date(startDate) // tracks last payment date for day-count

  const sorted = [...earlyPayments].sort((a, b) =>
    String(a.payment_date).localeCompare(String(b.payment_date))
  )

  const rows: ScheduleRow[] = []
  let rowNum = 1
  // a safety net: the term is at most MAX_TERM_MONTHS on input, so a schedule never reaches it
  const MAX_ROWS = 600

  while (balance > 0.01 && remaining > 0 && rows.length < MAX_ROWS) {
    const rowMonthStr = monthOf(isoDate(currentDate))
    const openingBalance = balance

    // EPs of this month; the first row also picks up EPs made before the
    // first scheduled payment (e.g. an EP between issue and first pay date).
    const isFirstRow = rows.length === 0
    const monthEPs = sorted.filter(ep => {
      const epYM = monthOf(String(ep.payment_date))
      return isFirstRow ? epYM <= rowMonthStr : epYM === rowMonthStr
    })

    let earlyAmount   = 0
    let zeroedOn: string | undefined
    let lastEventDate = prevPayDate   // for day-count of consecutive EPs in one month
    const events: { date: string; balance: number }[] = []

    // Apply one EP to the given balance: deduct the bank-style interest from
    // the amount, credit principal, apply the strategy. Returns the new balance.
    // `beforePayment` — the month's scheduled payment is still to come.
    // Banks (verified against real bank schedules) deduct interest accrued on
    // the EP amount itself for the days since the last payment/EP:
    // credit + credit × (annual_rate/365) × days = amount.
    // Interest on the rest of the balance is settled by regular payments.
    const applyEP = (earlyPay: LoanEarlyPayment, bal: number, beforePayment: boolean): number => {
      const epAmount = Number(earlyPay.amount)
      earlyAmount += epAmount

      const epDate = new Date(String(earlyPay.payment_date))
      const daysDiff = Math.max(0, Math.round(
        (epDate.getTime() - lastEventDate.getTime()) / (1000 * 60 * 60 * 24)
      ))
      // principal_credit — exact bank value, overrides the formula
      const storedCredit    = Number(earlyPay.principal_credit)
      const principalCredit = storedCredit > 0
        ? storedCredit
        : epAmount / (1 + dailyRate * daysDiff)

      const newBal  = Math.max(0, bal - principalCredit)
      if (bal > 0.01 && newBal <= 0.01 && !zeroedOn) zeroedOn = String(earlyPay.payment_date).slice(0, 10)
      lastEventDate = epDate
      // a payment dated before the issue counts from the issue day, as computeSchedule applies it
      const day = String(earlyPay.payment_date).slice(0, 10)
      events.push({ date: day < issueDay ? issueDay : day, balance: Math.max(0, newBal) })

      if (earlyPay.strategy === 'reduce_term' && newBal > 0.01) {
        // The payment stays, the term becomes the annuity term of the new
        // balance. `remaining` still counts this month's row, so an EP after
        // the payment adds it on top. A payment below the interest keeps the term.
        const term = annuityTerm(newBal, payment, monthlyRate)
        if (term !== null) remaining = beforePayment ? term : term + 1
      } else if (earlyPay.strategy === 'reduce_payment' && newBal > 0.01 && remaining > 1) {
        // new_payment — the bank's actual recalculated payment; fall back to
        // the annuity formula over the remaining term when not provided.
        // `remaining` still counts this month's row: before the payment that row
        // is charged the new payment too, after it only the months that follow are.
        // For manual-payment loans (stored payment doesn't follow the formula,
        // e.g. refinanced) the formula would give a bogus — often higher —
        // value, so keep the current payment instead.
        const bankPayment = Number(earlyPay.new_payment)
        if (bankPayment > 0) {
          payment = bankPayment
        } else if (!hasManualPayment) {
          payment = calcMonthlyPayment(newBal, rate, beforePayment ? remaining : remaining - 1)
        }
      }
      return newBal
    }

    // Bank order of operations within the month (verified against bank statements):
    // 1. EPs dated before the payment date — and same-day reduce_payment EPs,
    //    because the bank recalculates the payment before charging it that day;
    // 2. the scheduled payment (with the possibly updated amount);
    // 3. the remaining EPs (days counted from the payment date).
    const isBeforePayment = (ep: LoanEarlyPayment) => {
      const epDate = new Date(String(ep.payment_date))
      return epDate < currentDate ||
        (epDate.getTime() === currentDate.getTime() && ep.strategy === 'reduce_payment')
    }

    let preBalance = balance
    for (const earlyPay of monthEPs) {
      if (isBeforePayment(earlyPay)) preBalance = applyEP(earlyPay, preBalance, true)
    }

    const interest      = preBalance * monthlyRate
    const principalPart = Math.max(0, Math.min(payment - interest, preBalance))
    let closingBalance  = preBalance - principalPart
    if (preBalance > 0.01 && closingBalance <= 0.01 && !zeroedOn) zeroedOn = isoDate(currentDate)
    // What this month was charged: a reduce_payment EP after the payment lowers only the months that follow.
    // The last payment charges only what closes the balance.
    const charged = Math.min(payment, principalPart + interest)

    if (lastEventDate < currentDate) lastEventDate = new Date(currentDate)
    events.push({ date: isoDate(currentDate), balance: Math.max(0, closingBalance) })
    for (const earlyPay of monthEPs) {
      if (!isBeforePayment(earlyPay)) closingBalance = applyEP(earlyPay, closingBalance, false)
    }

    prevPayDate = new Date(currentDate)

    balance   = Math.max(0, closingBalance)
    remaining -= 1

    rows.push({
      rowNum,
      date: isoDate(currentDate),
      openingBalance,
      scheduledPayment: charged,
      principalPart,
      interest,
      earlyPayment: earlyAmount,
      closingBalance: balance,
      ...(zeroedOn && balance <= 0.01 ? { zeroedOn } : {}),
      ...(monthEPs.length > 0 ? { events } : {}),
    })

    rowNum++
    currentDate = nextMonth(currentDate, payDay)
  }

  return rows
}

/**
 * Outstanding principal at the end of `date` ('YYYY-MM-DD'): the closing
 * balance of the last row of `schedule` (computeSchedule of this loan and its
 * early payments) on or before it. computeSchedule applies early payments per
 * calendar month, so month-end dates are exact.
 * Null when the loan is not issued yet or is closed by then (a closed loan without a close date is not).
 */
export function balanceFromSchedule(loan: LoanRow, schedule: ScheduleRow[], date: string): number | null {
  if (String(loan.issue_date).slice(0, 10) > date) return null
  // a closed loan without a close date stays a debt until its schedule pays it off
  if (loan.status === 'closed' && loan.closed_date && String(loan.closed_date).slice(0, 10) <= date) return null
  let balance = Number(loan.principal)
  for (const row of schedule) {
    if (row.date > date) break
    balance = row.closingBalance
  }
  return balance
}

/** The bank's remaining balance of a loan set against the schedule's on one day, in the loan's currency; amounts round2. */
export interface LoanBalanceDrift { bank: number; scheduled: number; diff: number; tolerance: number }

/**
 * How far the bank's remaining balance may stand from the schedule's before it is worth a question: one month's interest
 * on the original principal, at least one unit of the currency. computeSchedule charges a whole month's interest per row,
 * the first one included, while a bank counts the actual days (the code models it as rate/365 for early payments): the
 * first period alone, one to two months long, can leave the bank's balance up to about a month's interest off, and that
 * offset stays for the whole term — so the share is of the principal, not of the shrinking balance. Uneven month lengths
 * add a few days of interest at most; cents of rounding fall under the one-unit floor (the same unit computeSchedule
 * allows a stored payment before it counts as manual). A rate of 0 tolerates exactly one unit.
 */
export function balanceTolerance(loan: LoanRow): number {
  const share = Number(loan.principal) * Number(loan.rate) / 1200
  return Math.max(1, Number.isFinite(share) ? round2(share) : 0)
}

/**
 * How far the bank's remaining balance on `date` ('YYYY-MM-DD') stands from the schedule's (balanceFromSchedule of this
 * loan and `schedule`, computeSchedule of it and its early payments). Null when there is nothing honest to say: no schedule
 * (empty), no schedule balance on that date (not issued yet, or closed by then), a bank balance that is not a finite number
 * >= 0, or a difference within balanceTolerance (equal to it included). diff = bank − scheduled: negative — the bank shows
 * less debt (an early payment the app lacks?); positive — more (a recalculation, fees, a missed payment?). Both figures are
 * in the loan's currency: nothing is converted.
 */
export function loanBalanceDrift(loan: LoanRow, schedule: ScheduleRow[], date: string, bankBalance: number): LoanBalanceDrift | null {
  if (schedule.length === 0) return null
  if (!Number.isFinite(bankBalance) || bankBalance < 0) return null
  const scheduled = balanceFromSchedule(loan, schedule, date)
  if (scheduled === null) return null
  // the shown figures: diff is the difference of the rounded bank and scheduled, so the three always add up
  const bank = round2(bankBalance)
  const shown = round2(scheduled)
  const diff = round2(bank - shown)
  const tolerance = balanceTolerance(loan)
  if (Math.abs(diff) <= tolerance) return null
  return { bank, scheduled: shown, diff, tolerance }
}

/** The scheduled payments dated in `month` ('YYYY-MM') summed; 0 outside the schedule. */
export function scheduledPaymentIn(schedule: ScheduleRow[], month: string): number {
  return schedule.reduce((sum, row) => (monthOf(row.date) === month ? sum + row.scheduledPayment : sum), 0)
}

/** The share of the original amount already repaid, %, within 0–100; null when the amount is unknown. */
export function repaidShare(balance: number, principal: number): number | null {
  return principal > 0 ? Math.min(100, Math.max(0, (1 - balance / principal) * 100)) : null
}

/** Interest the schedule charges in the 12 months after month-end `date` — less than balance × rate while the debt shrinks. */
export function interestNext12m(schedule: ScheduleRow[], date: string): number {
  const until = `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`
  return schedule.reduce((sum, row) => (row.date > date && row.date <= until ? sum + row.interest : sum), 0)
}

/** Index of the current (next upcoming) payment row: the first one dated after today; -1 when the loan is fully paid. */
export function currentPaymentIndex(schedule: ScheduleRow[], today = new Date()): number {
  const todayIso = isoDate(today)
  return schedule.findIndex(r => r.date > todayIso)
}

/** What is left of a schedule from the current row on, and what it cost so far. */
export interface ScheduleSummary {
  paymentsLeft: number
  /** The date of the last payment; null for an empty schedule */
  lastPayment: string | null
  toPay: number
  interestLeft: number
  totalPaid: number
  /** Interest over the whole term */
  overpayment: number
}

/**
 * The summary of a schedule; `currentIdx` is currentPaymentIndex (-1 — everything is paid).
 * Installments are paid up to the current row; an early payment is paid by its own date (up to
 * `today`), wherever computeSchedule attached it (the first row takes those made before it, and
 * the installment of this month may have passed with an early payment still planned later in it).
 */
export function summariseSchedule(schedule: ScheduleRow[], currentIdx: number, earlyPayments: LoanEarlyPayment[] = [], today = new Date()): ScheduleSummary {
  const future = currentIdx === -1 ? [] : schedule.slice(currentIdx)
  const past = currentIdx === -1 ? schedule : schedule.slice(0, currentIdx)
  const sum = (rows: ScheduleRow[], pick: (r: ScheduleRow) => number) => rows.reduce((total, r) => total + pick(r), 0)
  const todayISO = isoDate(today)
  const lastYM = schedule.length > 0 ? monthOf(schedule[schedule.length - 1].date) : ''
  // the early payments the schedule holds; without the list, the rows' own sums dated on the row
  const early = earlyPayments.length > 0
    ? earlyPayments
        .filter(ep => monthOf(String(ep.payment_date)) <= lastYM)
        .map(ep => ({ date: String(ep.payment_date).slice(0, 10), amount: Number(ep.amount) }))
    : schedule.filter(r => r.earlyPayment > 0).map(r => ({ date: r.date, amount: r.earlyPayment }))
  // nothing left to pay: whatever the dates say, all of it is paid
  const isPaid = (date: string) => currentIdx === -1 || date <= todayISO
  const earlyPaid = early.filter(e => isPaid(e.date)).reduce((total, e) => total + e.amount, 0)
  const earlyPlanned = early.filter(e => !isPaid(e.date)).reduce((total, e) => total + e.amount, 0)
  return {
    // an early payment that cleared the balance before an installment leaves that row at 0: not a payment
    paymentsLeft: future.filter(r => r.scheduledPayment > 0).length,
    lastPayment: schedule.length > 0 ? schedule[schedule.length - 1].date : null,
    toPay: sum(future, r => r.scheduledPayment) + earlyPlanned,
    interestLeft: sum(future, r => r.interest),
    totalPaid: sum(past, r => r.scheduledPayment) + earlyPaid,
    overpayment: sum(schedule, r => r.interest),
  }
}

/** Whether the loan is still a debt on `day`: not closed, or closed without a close date or with a later one (balanceFromSchedule's rule) */
const owingOn = (loan: LoanRow, day: string) => !(loan.status === 'closed' && loan.closed_date && String(loan.closed_date).slice(0, 10) <= day)

/**
 * What the loan owes on `today` by its schedule: the balance after the last event dated on or before it — an installment
 * or an early payment (a row's `events`) — so an event dated today counts and no later one does. Null for a loan closed
 * by then and for one not issued yet (the page shows its principal as the debt at issue); a closed loan without a close
 * date stays a debt, as in balanceFromSchedule.
 */
export function balanceToday(loan: LoanRow, schedule: ScheduleRow[], today = new Date()): number | null {
  const day = isoDate(today)
  if (!owingOn(loan, day) || String(loan.issue_date).slice(0, 10) > day) return null
  let balance = Number(loan.principal)
  for (const row of schedule) {
    for (const e of row.events ?? [{ date: row.date, balance: row.closingBalance }]) {
      if (e.date > day) return balance
      balance = e.balance
    }
  }
  return balance
}

/** What the page shows as owed on `today`: balanceToday, the principal for a loan not issued yet (its debt at issue); null for one closed by then. */
export function owedOn(loan: LoanRow, schedule: ScheduleRow[], today = new Date()): number | null {
  const day = isoDate(today)
  return balanceToday(loan, schedule, today) ?? (owingOn(loan, day) && String(loan.issue_date ?? '').slice(0, 10) > day ? Number(loan.principal) : null)
}

/** What the loan's early payments did: interest over the term without them − with them, the months the last payment moved, and that last payment without them. */
export interface EarlyPaymentsEffect { interestSaved: number; monthsSaved: number; lastWithout: string; /** The early payments' sum */ total: number }

/** The schedule with and without the loan's early payments set side by side; null without early payments or a schedule. */
export function earlyPaymentsEffect(loan: LoanRow, payments: LoanEarlyPayment[]): EarlyPaymentsEffect | null {
  if (payments.length === 0) return null
  const withEP = computeSchedule(loan, payments)
  const without = computeSchedule(loan, [])
  if (withEP.length === 0 || without.length === 0) return null
  const interest = (rows: ScheduleRow[]) => rows.reduce((sum, r) => sum + r.interest, 0)
  const lastWithout = without[without.length - 1].date
  return {
    interestSaved: interest(without) - interest(withEP), monthsSaved: monthsBetween(withEP[withEP.length - 1].date, lastWithout), lastWithout,
    total: payments.reduce((sum, ep) => sum + Number(ep.amount), 0),
  }
}

/** An early payment being typed: its date and amount, and the bank's figures when known */
export interface EarlyPaymentDraft { payment_date: string; amount: number | null; new_payment?: number | null; principal_credit?: number | null }

/** What a draft does with one strategy: interest left now − with it, the new last payment, the payments left, the payment from its date on */
export interface EarlyPaymentOutcome { interestSaved: number; lastPayment: string; paymentsLeft: number; payment: number }

/**
 * The draft added to the loan's `payments`, for both strategies, through computeSchedule — the order and the interest
 * deduction of a saved payment, so the preview is what saving gives. Null for a draft without a readable date or a
 * positive amount; a strategy's outcome is null when lateEarlyPayment refuses it (the loan is repaid by then).
 */
export interface EarlyPaymentPreview {
  /** The loan without the draft: its last payment, the payments left, the payment from the draft's date on (interestSaved 0) */
  current: EarlyPaymentOutcome
  reduce_term: EarlyPaymentOutcome | null
  reduce_payment: EarlyPaymentOutcome | null
}

export function earlyPaymentPreview(loan: LoanRow, payments: LoanEarlyPayment[], draft: EarlyPaymentDraft, today = new Date()): EarlyPaymentPreview | null {
  const date = draft.payment_date
  if (!isDay(date) || !(Number(draft.amount) > 0)) return null
  const base = computeSchedule(loan, payments)
  if (base.length === 0) return null
  const left = (rows: ScheduleRow[], eps: LoanEarlyPayment[]) => summariseSchedule(rows, currentPaymentIndex(rows, today), eps, today)
  const now = left(base, payments)
  const paymentFrom = (rows: ScheduleRow[]) => (rows.find(r => r.date >= date && r.scheduledPayment > 0) ?? rows[rows.length - 1]).scheduledPayment
  const outcome = (strategy: 'reduce_term' | 'reduce_payment'): EarlyPaymentOutcome | null => {
    if (lateEarlyPayment(base, date, strategy) !== null) return null
    const ep: LoanEarlyPayment = {
      rowid: 0, id: 0, loan_name: loan.name, payment_date: date, amount: Number(draft.amount), strategy, notes: null,
      new_payment: strategy === 'reduce_payment' ? draft.new_payment ?? null : null, principal_credit: draft.principal_credit ?? null,
    }
    const eps = [...payments, ep]
    const rows = computeSchedule(loan, eps)
    const s = left(rows, eps)
    // over the whole term: the rows before the draft are the same in both, so a back-dated draft counts from its own date
    return { interestSaved: now.overpayment - s.overpayment, lastPayment: s.lastPayment ?? date, paymentsLeft: s.paymentsLeft, payment: paymentFrom(rows) }
  }
  return {
    current: { interestSaved: 0, lastPayment: now.lastPayment ?? date, paymentsLeft: now.paymentsLeft, payment: paymentFrom(base) },
    reduce_term: outcome('reduce_term'), reduce_payment: outcome('reduce_payment'),
  }
}

/** The family's loans still owing (not closed by today), in the base currency: sums of the loans as the page shows them (whole units, the payment to the cent) */
export interface LoansTotals {
  /** Open loans */
  count: number
  /** Owed today (balanceToday); null — a loan's currency has no rate */
  balance: number | null
  /** The next payment of each open loan; null — no rate */
  payment: number | null
  /** Each loan still paying (its last payment after today), with its next payment in the base currency (null — no rate): the payments track */
  payments: { name: string; payment: number | null }[]
  /** Interest still ahead; null — no rate */
  interestAhead: number | null
  /** The month after the first paying loans end, and the monthly payment of the ones still paying from then; null — no rate, or no loan pays on after them */
  endsNext: { from: string; paymentAfter: number } | null
}

/**
 * The totals of the open loans on `today`, each loan with its schedule; `toBase` converts an amount of a currency into
 * the base one (null — no rate). A loan not issued yet counts in `count` only; one its schedule has repaid (not closed
 * yet) counts in `count` and the balance, not in `payments` or `endsNext`.
 */
export function loansTotals(items: { loan: LoanRow; schedule: ScheduleRow[]; payments: LoanEarlyPayment[] }[], today: Date, toBase: (value: number, currency: string) => number | null): LoansTotals {
  const open = items.filter(i => owingOn(i.loan, isoDate(today)))
  const parts = open.map(({ loan, schedule, payments }) => {
    const idx = currentPaymentIndex(schedule, today)
    const owed = balanceToday(loan, schedule, today)
    if (owed === null) return null
    const s = summariseSchedule(schedule, idx, payments, today)
    const pay = idx === -1 ? 0 : schedule[idx].scheduledPayment
    const base = (v: number) => toBase(v, loan.currency)
    return { name: loan.name, balance: base(owed), payment: base(pay), interest: base(s.interestLeft), last: s.lastPayment }
  }).filter(p => p !== null)
  const sum = (pick: (p: (typeof parts)[number]) => number | null, digits: number) => parts.some(p => pick(p) === null)
    ? null : roundTo(parts.reduce((total, p) => total + roundTo(pick(p)!, digits), 0), digits)
  const payment = sum(p => p.payment, 2)
  // a loan its schedule has already repaid (not closed yet) still counts and owes its rounding, but no longer pays or ends
  const paying = parts.filter(p => p.last !== null && p.last > isoDate(today))
  const first = [...paying].sort((a, b) => a.last!.localeCompare(b.last!))[0]
  // every loan ending in the first one's month stops paying together; none left paying — no "from then" figure
  const endMonth = first && monthOf(first.last!)
  const ending = paying.filter(p => monthOf(p.last!) === endMonth)
  const stopping = ending.some(p => p.payment === null) ? null : ending.reduce((total, p) => total + roundTo(p.payment!, 2), 0)
  return {
    count: open.length,
    balance: sum(p => p.balance, 0),
    payment,
    interestAhead: sum(p => p.interest, 0),
    payments: paying.map(p => ({ name: p.name, payment: p.payment })),
    endsNext: paying.length > ending.length && payment !== null && stopping !== null
      ? { from: shiftMonth(endMonth, 1), paymentAfter: round2(payment - stopping) } : null,
  }
}

/**
 * The balance that still counts as repaid: a cent per installment (at least a cent) — a payment entered to the
 * cent leaves up to about a cent of rounding per row at the end of the term (0.12 on 12 rows), which is not debt.
 */
function repaidWithin(schedule: ScheduleRow[]): number {
  return Math.max(0.01, 0.01 * schedule.length)
}

/**
 * Whether a loan's status should be "closed": the last payment's month has passed and the balance is repaid
 * (within repaidWithin). A closing balance of 0 alone proves nothing while payments remain: every annuity ends at 0;
 * and a schedule that stops at the term limit with real debt left is not done.
 */
export function isScheduleDone(schedule: ScheduleRow[], today = new Date()): boolean {
  if (schedule.length === 0) return false
  const nowYM = monthOf(isoDate(today))
  return !schedule.some(r => monthOf(r.date) >= nowYM) && schedule[schedule.length - 1].closingBalance <= repaidWithin(schedule)
}

/**
 * The day the loan was actually repaid, or null while debt is left (the rule of isScheduleDone): the day of the event
 * that brought the balance to zero — an early payment or the installment — else the last installment (a rounding
 * remainder is cleared by it).
 */
export function payoffDate(schedule: ScheduleRow[]): string | null {
  const last = schedule[schedule.length - 1]
  if (!last || last.closingBalance > repaidWithin(schedule)) return null
  return last.zeroedOn ?? last.date
}

/**
 * The day to name when an early payment of `date` and `strategy` would reduce nothing, else null: computeSchedule
 * applies it when the balance is already repaid, so the form refuses it. `schedule` is the loan's schedule without
 * this payment. computeSchedule's order within a month: early payments before the installment's day (and a
 * reduce_payment one on that day), the installment, the rest; payments of one day in the order entered, a new one last.
 * - Repaid by an early payment on day Z (the installment then charges nothing): only a payment before Z reduces.
 * - Repaid by the last installment on day D: a payment before D, or a reduce_payment one on D.
 * - Debt left after the last row: a payment up to the end of that row's month (later months have no row).
 */
export function lateEarlyPayment(schedule: ScheduleRow[], date: string, strategy: string): string | null {
  const last = schedule[schedule.length - 1]
  if (!last) return null
  const payoff = payoffDate(schedule)
  if (payoff === null) return monthOf(date) <= monthOf(last.date) ? null : last.date
  if (date < payoff) return null
  const beforeInstallment = last.principalPart > 0.01 && date === last.date && strategy === 'reduce_payment'
  return beforeInstallment ? null : payoff
}

/**
 * Whether writing `payment` (new, or changed — then left out of `others`) beside the loan's `others` leaves an early
 * payment that reduces nothing (lateEarlyPayment): the payment itself, repaid by the others before it, or one of the
 * others, repaid before it by the payment. `payoff` is the day the loan is repaid, `late` the late payment's date; null
 * when none is. An other already late without the payment (stored before this check) is not the payment's doing and
 * does not count.
 */
export function earlyPaymentConflict(loan: LoanRow, others: LoanEarlyPayment[], payment: LoanEarlyPayment): { payoff: string; late: string } | null {
  const own = lateEarlyPayment(computeSchedule(loan, others), String(payment.payment_date), payment.strategy)
  if (own !== null) return { payoff: own, late: String(payment.payment_date) }
  for (const other of others) {
    const rest = others.filter(o => o !== other)
    const date = String(other.payment_date)
    if (lateEarlyPayment(computeSchedule(loan, rest), date, other.strategy) !== null) continue
    // the payment is entered after the stored ones: last among the payments of its day, as computeSchedule orders them
    const payoff = lateEarlyPayment(computeSchedule(loan, [...rest, payment]), date, other.strategy)
    if (payoff !== null) return { payoff, late: date }
  }
  return null
}
