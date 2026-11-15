// The advisor's input: the scenario a family member asks about, and the family's numbers it is weighed against.
import { AVERAGE_MONTHS, averagedRows } from './cashflow'
import { isDay, isoDate, MONTH_RE, monthOf, shiftMonth } from './dates'
import { round2 } from './fx'
import { loanPaymentsBase } from './health'
import { liquidKnown } from './overviewBlocks'
import { MAX_TERM_MONTHS } from './loans'
import type { MandatorySpending } from './spending'
import type { FinanceSnapshot, GoalRow } from './types'

/**
 * One plan to evaluate: a purchase from own money (`goalId` — the goal the money was put aside for), a purchase on
 * credit (`downPayment` in the scenario currency, below the amount), saving up for a purchase by `targetMonth`
 * ('YYYY-MM'), or a new goal by `targetDate` ('YYYY-MM-DD'). Amounts are in `currency`.
 */
export type Scenario =
  | { kind: 'buy_now'; amount: number; currency: string; goalId?: string }
  | { kind: 'credit'; amount: number; currency: string; termMonths: number; ratePct: number; downPayment: number; loanType: 'consumer' | 'mortgage' }
  | { kind: 'save_up'; amount: number; currency: string; targetMonth: string }
  | { kind: 'goal'; name: string; amount: number; currency: string; targetDate: string }

/** @public A scenario that cannot be evaluated: a required parameter is missing or has a wrong value; `param` names it. */
export class ScenarioError extends Error {
  readonly code: 'missing_param' | 'invalid_param'
  readonly param: string
  constructor(code: 'missing_param' | 'invalid_param', param: string) {
    super(`${code}: ${param}`)
    this.name = 'ScenarioError'
    this.code = code
    this.param = param
  }
}

const KINDS = ['buy_now', 'credit', 'save_up', 'goal'] as const
const LOAN_TYPES = ['consumer', 'mortgage'] as const
/** The largest amount accepted, in the scenario currency: far beyond any family's purchase, and keeps every month count in range */
export const MAX_AMOUNT = 1e9
/** A goal name, like a category or source name: 1–60 characters, no control or format characters */
const MAX_NAME = 60
const BAD_TEXT = /[\p{Cc}\p{Cf}]/u

/** The member that owns joint accounts (migration 0002): its income is nobody's salary. */
export const SHARED_MEMBER = 'Shared'

/**
 * @public Checks a scenario from outside (a tool call, a request body) and returns it typed. Throws `ScenarioError`: `missing_param`
 * for an absent required parameter (a credit needs the term, the rate, the down payment and the loan type), `invalid_param`
 * for a wrong one — an amount ≤ 0 or above 1e9, a down payment not below the amount, a save_up month not after this month,
 * a goal date before `today`.
 */
export function parseScenario(body: unknown, today: Date): Scenario {
  const b = (body !== null && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const has = (key: string) => b[key] !== undefined && b[key] !== null
  const need = (key: string): unknown => {
    if (!has(key)) throw new ScenarioError('missing_param', key)
    return b[key]
  }
  const invalid = (key: string): never => { throw new ScenarioError('invalid_param', key) }
  const number = (key: string, ok: (v: number) => boolean): number => {
    const v = need(key)
    return typeof v === 'number' && Number.isFinite(v) && ok(v) ? v : invalid(key)
  }
  const oneOf = <T extends string>(key: string, values: readonly T[]): T => {
    const v = need(key)
    return values.includes(v as T) ? v as T : invalid(key)
  }

  const kind = oneOf('kind', KINDS)
  const amount = number('amount', v => v > 0 && v <= MAX_AMOUNT)
  const currencyValue = need('currency')
  const currency = typeof currencyValue === 'string' && /^[A-Z]{3}$/.test(currencyValue) ? currencyValue : invalid('currency')
  const todayIso = isoDate(today)

  switch (kind) {
    case 'buy_now': {
      if (!has('goalId')) return { kind, amount, currency }
      const goalId = b.goalId
      return typeof goalId === 'string' && goalId !== '' ? { kind, amount, currency, goalId } : invalid('goalId')
    }
    case 'credit': {
      const termMonths = number('termMonths', v => Number.isInteger(v) && v >= 1 && v <= MAX_TERM_MONTHS)
      const ratePct = number('ratePct', v => v >= 0 && v <= 100)
      const downPayment = number('downPayment', v => v >= 0 && v < amount)
      const loanType = oneOf('loanType', LOAN_TYPES)
      return { kind, amount, currency, termMonths, ratePct, downPayment, loanType }
    }
    case 'save_up': {
      const targetMonth = need('targetMonth')
      // strictly after this month: a target this month leaves no month to save in
      return typeof targetMonth === 'string' && isMonth(targetMonth) && targetMonth > monthOf(todayIso)
        ? { kind, amount, currency, targetMonth }
        : invalid('targetMonth')
    }
    case 'goal': {
      const rawName = need('name')
      const name = typeof rawName === 'string' ? rawName.trim() : ''
      if (!name || name.length > MAX_NAME || BAD_TEXT.test(name)) invalid('name')
      const targetDate = need('targetDate')
      return typeof targetDate === 'string' && isDay(targetDate) && targetDate >= todayIso
        ? { kind, name, amount, currency, targetDate }
        : invalid('targetDate')
    }
  }
}

function isMonth(v: string): boolean {
  return MONTH_RE.test(v)
}

/** The family's numbers the advisor weighs a scenario against; every amount in `base`. */
export interface AdvisorContext {
  base: string; today: Date
  /** The closed month the 3-month window ends at; null — no cash flow */
  month: string | null
  /** Closed months with flows in the 3-month window */
  months: number
  /** 3-month averages; expenses include loan payments */
  incomePerMonth: number; expensePerMonth: number
  /**
   * The closed month's income and expenses (loan payments included): emergency months and the debt payment share are graded
   * on them, as Financial health grades them, so the advisor and the dashboard show one figure. Null — no closed month with
   * flows, or its totals are unknown (a row without a rate; gap `month_no_rate`)
   */
  closed: { income: number; expense: number } | null
  /** Σ capital.loans[].paymentBase — the current scheduled payments (a loan without a rate left out) */
  loanPaymentsPerMonth: number
  mandatory: MandatorySpending | null
  /** coveragePct of the window's months with category data, oldest first */
  coverage: (number | null)[]
  /** The bank accounts' money at the latest balances; null — no balances, or one is missing or without a rate (gap `liquid_unknown`) */
  liquid: number | null
  /** 3-month average active income per member, largest first, Shared excluded */
  earners: { member: string; activePerMonth: number }[]
  /** The Shared member's 3-month average active income: income, but nobody's salary */
  sharedActivePerMonth: number
  /** Currencies of active income in the window, sorted */
  incomeCurrencies: string[]
  /** The snapshot's goals in the base currency (target/current = …Base); a goal without a rate is left out */
  goals: GoalRow[]
  /** What could not be converted to the base currency and is left out above: loans with a payment this month, goals */
  rateless: { loans: { name: string; currency: string }[]; goals: { id: string; name: string; currency: string }[] }
  /** The family tracks income and expenses; false — the monthly figures are unknown, not short (gap `flows_not_tracked`) */
  trackFlows: boolean
}

/** @public The advisor's context from a snapshot: the 3-month averages are the snapshot's `avg3m`, nothing is recomputed from raw rows but the earners. */
export function advisorContext(s: FinanceSnapshot, today: Date): AdvisorContext {
  const month = s.asOf.closedMonth
  const avg = s.cashflow.avg3m
  const start = month ? shiftMonth(month, 1 - AVERAGE_MONTHS) : null
  const inWindow = (m: string) => month !== null && start !== null && m >= start && m <= month
  const rows = s.cashflow.rows.filter(r => !r.loan && inWindow(r.month))

  // the rows avg3m averages (a month with a rateless row left out): summed over the same months it is divided by
  const byMember = new Map<string, number>()
  let shared = 0
  for (const r of averagedRows(s.cashflow.rows, month, AVERAGE_MONTHS).filter(r => !r.loan)) {
    if (!r.activeBase) continue
    if (r.member === SHARED_MEMBER) shared += r.activeBase
    else byMember.set(r.member, (byMember.get(r.member) ?? 0) + r.activeBase)
  }
  const divisor = Math.max(1, avg.months)
  const earners = [...byMember]
    .map(([member, total]) => ({ member, activePerMonth: round2(total / divisor) }))
    .filter(e => e.activePerMonth > 0)
    .sort((a, b) => b.activePerMonth - a.activePerMonth || a.member.localeCompare(b.member))

  return {
    base: s.baseCurrency,
    today,
    month,
    months: avg.months,
    incomePerMonth: round2(avg.expensePerMonth + avg.netPerMonth),
    expensePerMonth: avg.expensePerMonth,
    closed: s.cashflow.closedMonth && { income: s.cashflow.closedMonth.income, expense: s.cashflow.closedMonth.expense },
    loanPaymentsPerMonth: round2(loanPaymentsBase(s.capital?.loans ?? [])),
    mandatory: s.spending.mandatory,
    coverage: s.spending.months.filter(m => inWindow(m.month)).map(m => m.coveragePct),
    liquid: s.capital && liquidKnown(s) ? s.capital.liquid : null,
    earners,
    sharedActivePerMonth: round2(shared / divisor),
    // every month of the window, a rateless one too: the currency risk is about what the family is paid in, not about the sums
    incomeCurrencies: [...new Set(rows.filter(r => r.active > 0).map(r => r.currency))].sort(),
    goals: s.goals.items.flatMap(g => g.targetBase === null || g.currentBase === null ? [] : [{
      id: g.id, name: g.name, target: g.targetBase, current: g.currentBase, target_date: g.target_date, emoji: g.emoji, currency: s.baseCurrency,
    }]),
    rateless: {
      loans: (s.capital?.loans ?? []).filter(l => l.paymentBase === null && l.payment > 0).map(l => ({ name: l.name, currency: l.currency })),
      goals: s.goals.items.filter(g => g.targetBase === null || g.currentBase === null).map(g => ({ id: g.id, name: g.name, currency: g.currency })),
    },
    trackFlows: s.trackFlows,
  }
}
