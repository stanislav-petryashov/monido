// The advisor's evaluation of one scenario: the key numbers now and after, the credit, the goals that move, the stress
// test, the currency risk, the risk level from the health zones and the data gaps, and the alternatives, each evaluated the
// same way. Codes and numbers only, no text.
import { MAX_AMOUNT, SHARED_MEMBER, type AdvisorContext, type Scenario } from './advisor'
import { emergencyMonths } from './cashflow'
import { isoDate, monthEnd, monthOf, monthsBetween, shiftMonth } from './dates'
import { convert, round2 } from './fx'
import { allocateGoals, firstShare, goalShifts, PROJECTION_HORIZON_MONTHS, type GoalShift } from './goals'
import { DEBT_NORM_PCT, zoneOf, zoneThresholds } from './health'
import { calcMonthlyPayment } from './loans'
import type { GoalRow, GoalStatus, MsgParams, Rates, Zone } from './types'

/** The numbers compared "now → after", per month except `liquid`; null — not known (a gap says why) */
export interface KeyNumbers {
  savingsPerMonth: number | null
  /** Income − mandatory spending − loan payments */
  leftForLiving: number | null
  /** Loan payments ÷ income, % */
  debtPaymentPct: number | null
  /** Liquid money ÷ monthly expenses */
  emergencyMonths: number | null
  liquid: number | null
}
export type { GoalShift } from './goals'
export type GapCode =
  | 'short_history' | 'no_mandatory' | 'stale_manual' | 'low_coverage' | 'no_rate' | 'flows_not_tracked' | 'no_income' | 'no_goals'
  | 'loan_no_rate' | 'goal_no_rate' | 'no_earner' | 'unknown_goal' | 'month_no_rate' | 'liquid_unknown' | 'recent_drop'
/** Missing or stale data and the parts of the answer it affects */
export interface Gap { code: GapCode; params?: MsgParams; affects: readonly (keyof KeyNumbers | 'goals' | 'stress' | 'credit')[] }
/** From the zones; `unknown` — the scenario cannot be weighed (no rate for its currency, no cash flow, no income) */
export type RiskLevel = 'ok' | 'caution' | 'risky' | 'unknown'
export interface Impact {
  scenario: Scenario
  /** The scenario's amount in the base currency; null — its currency has no rate */
  amountBase: number | null
  /** Base currency; absent without rates or for saving scenarios. A positive shortfall makes payment impossible now. */
  cashFunding?: { requiredNow: number; shortfall: number }
  now: KeyNumbers
  after: KeyNumbers
  /** A credit's principal (amount − down payment), monthly payment and total overpayment, in the base currency */
  credit: { principal: number; payment: number; overpayment: number } | null
  /** Months the current savings take to collect the amount; null — nothing is saved */
  monthsToSave: number | null
  goals: GoalShift[]
  /** Each member's share of the active income, the Shared member as its own entry; they add up to 100 */
  incomeShares: { member: string; sharePct: number }[]
  /** If the largest earner's income stops: months the liquid money covers the shortfall; months null — the remaining income covers it */
  stress: { earner: string; months: number | null } | null
  currencyRisk: { currency: string; incomeCurrencies: string[] } | null
  /** `goals`: red when the proposed goal is unreachable, amber when it is at risk or another goal's status gets worse or its month moves 3 months or more later, else green */
  zones: Partial<Record<'emergency_months' | 'debt_payment_ratio' | 'savings_rate' | 'stress' | 'goals', Zone>>
  risk: RiskLevel
  gaps: Gap[]
}

/** Coverage of a month's expenses by categories below this, % — the mandatory average may be understated */
const COVERAGE_MIN_PCT = 80
/** A manual mandatory amount older than this many months is stale */
const MANUAL_STALE_MONTHS = 6
/** Closed months the averages need */
const HISTORY_MONTHS = 3
/** The id of the goal a goal or save_up scenario adds: its GoalShift in `goals` */
export const PROPOSED_ID = 'proposed'

const NO_NUMBERS: KeyNumbers = { savingsPerMonth: null, leftForLiving: null, debtPaymentPct: null, emergencyMonths: null, liquid: null }
const MONTHLY: Gap['affects'] = ['savingsPerMonth', 'leftForLiving', 'debtPaymentPct', 'emergencyMonths', 'goals', 'stress']
const MANDATORY: Gap['affects'] = ['leftForLiving', 'stress']

/** A finite number rounded to the cent; anything else (null, NaN, ±Infinity) is null. */
const out = (v: number | null): number | null => (v === null || !Number.isFinite(v) ? null : round2(v))
/** a ÷ b, null when b is not positive. */
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null)
const mul100 = (v: number | null) => (v === null ? null : v * 100)

/** The family's money after a change: what is paid out of the liquid money now, the new monthly payment and the months it is paid. */
interface Change { paidNow: number; newPayment: number; paymentMonths: number }

/** The raw (unrounded) key numbers after a change; null where the data are missing. */
function keyNumbers(ctx: AdvisorContext, change: Change): KeyNumbers {
  const flows = ctx.months > 0
  const income = ctx.incomePerMonth
  // paying more than there is leaves nothing, not a negative fund (the risk is `risky` then)
  const liquid = ctx.liquid === null ? null : Math.max(0, ctx.liquid - change.paidNow)
  // the closed month's totals unknown (a row without a rate) or a loan's payment without a rate: no share, no fund — not one built on a zero
  const closed = flows ? ctx.closed : null
  const mandatory = ctx.mandatory?.perMonthBase ?? null
  return {
    savingsPerMonth: flows ? income - ctx.expensePerMonth - change.newPayment : null,
    leftForLiving: flows && mandatory !== null ? income - mandatory - ctx.loanPaymentsPerMonth - change.newPayment : null,
    // as on the Financial health cards: the share is the closed month's, the fund is months of the year's average expenses
    debtPaymentPct: closed && !ctx.rateless.loans.length ? mul100(ratio(ctx.loanPaymentsPerMonth + change.newPayment, closed.income)) : null,
    emergencyMonths: flows && ctx.fundExpense !== null && liquid !== null ? emergencyMonths(liquid, ctx.fundExpense + change.newPayment) : null,
    liquid,
  }
}

const rounded = (k: KeyNumbers): KeyNumbers => ({
  savingsPerMonth: out(k.savingsPerMonth), leftForLiving: out(k.leftForLiving), debtPaymentPct: out(k.debtPaymentPct),
  emergencyMonths: out(k.emergencyMonths), liquid: out(k.liquid),
})

/** The rounded key numbers as they are now, with no change. */
export function currentNumbers(ctx: AdvisorContext): KeyNumbers {
  return rounded(keyNumbers(ctx, { paidNow: 0, newPayment: 0, paymentMonths: 0 }))
}

/**
 * Stress test: if the largest earner's income stops, months = liquid after ÷ max(0, mandatory + loan payments (with the new
 * one) − the remaining income); the remaining income keeps passive income and the Shared member's. Without mandatory spending
 * the expenses stand in for mandatory + current payments (they already hold the payments). Null without cash flow or an earner.
 */
function stressTest(ctx: AdvisorContext, change: Change): { earner: string; months: number | null } | null {
  const { recent } = ctx
  if (recent.months === 0 || ctx.liquid === null) return null
  const largest = ctx.earners[0] // advisorContext sorts the earners largest first
  if (!largest) return null
  // the earners are the last three months', so is the income they are taken from
  const remaining = recent.incomePerMonth - largest.activePerMonth
  const outflow = (ctx.mandatory ? ctx.mandatory.perMonthBase + ctx.loanPaymentsPerMonth : recent.expensePerMonth) + change.newPayment
  const shortfall = Math.max(0, outflow - remaining)
  const months = shortfall > 0 ? Math.max(0, ctx.liquid - change.paidNow) / shortfall : null
  return { earner: largest.member, months: out(months) }
}

/** The goal list after the scenario: a proposed goal added, or the money put aside for a goal taken from it. */
function goalsAfter(ctx: AdvisorContext, scenario: Scenario, amountBase: number): GoalRow[] {
  const proposed = (name: string, targetDate: string): GoalRow =>
    ({ id: PROPOSED_ID, name, target: amountBase, current: 0, target_date: targetDate, emoji: null, currency: ctx.base })
  switch (scenario.kind) {
    case 'goal': return [...ctx.goals, proposed(scenario.name, scenario.targetDate)]
    case 'save_up': return [...ctx.goals, proposed('', monthEnd(scenario.targetMonth))]
    case 'buy_now':
      return ctx.goals.map(g => (g.id === scenario.goalId ? { ...g, current: g.current - Math.min(amountBase, g.current) } : g))
    case 'credit': return ctx.goals
  }
}

/** Each member's share of all active income, largest first; the Shared member is listed too (it is not an earner for the stress test). */
export function incomeSharesOf(ctx: AdvisorContext): Impact['incomeShares'] {
  const members = ctx.sharedActivePerMonth > 0
    ? [...ctx.earners, { member: SHARED_MEMBER, activePerMonth: ctx.sharedActivePerMonth }]
    : ctx.earners
  const total = members.reduce((s, e) => s + e.activePerMonth, 0)
  if (total <= 0) return []
  return members
    .map(e => ({ member: e.member, sharePct: round2((e.activePerMonth / total) * 100) }))
    .sort((a, b) => b.sharePct - a.sharePct)
}

/** A recent saving this many points of the year's income below the year's average saving is a drop worth saying */
export const RECENT_DROP_POINTS = 10

/**
 * The recent trend notably worse than the year the figures are planned on: the last three months' saving below the year's
 * by more than RECENT_DROP_POINTS % of the year's income. Null — no drop, or no year longer than the recent months.
 */
function recentDrop(ctx: AdvisorContext): { recentPerMonth: number; yearPerMonth: number } | null {
  const { recent } = ctx
  if (!ctx.trackFlows || recent.months === 0 || ctx.months <= recent.months || ctx.incomePerMonth <= 0) return null
  const year = ctx.incomePerMonth - ctx.expensePerMonth
  const last = recent.incomePerMonth - recent.expensePerMonth
  return year - last > (RECENT_DROP_POINTS / 100) * ctx.incomePerMonth ? { recentPerMonth: round2(last), yearPerMonth: round2(year) } : null
}

/** The gaps of the data themselves, whatever the scenario: history, income, mandatory spending, rate-less loans and goals. */
function dataOnlyGaps(ctx: AdvisorContext): Gap[] {
  const gaps: Gap[] = []
  // the family does not track income and expenses: the monthly figures are unknown, so there is nothing to ask about them
  if (!ctx.trackFlows) gaps.push({ code: 'flows_not_tracked', affects: MONTHLY })
  else if (ctx.months < HISTORY_MONTHS) gaps.push({ code: 'short_history', params: { months: ctx.months }, affects: MONTHLY })
  // the savings rate (the zone of savingsPerMonth) needs income too
  const drop = recentDrop(ctx)
  if (drop) gaps.push({ code: 'recent_drop', params: drop, affects: ['savingsPerMonth', 'goals'] })
  if (ctx.months > 0 && ctx.incomePerMonth <= 0) gaps.push({ code: 'no_income', affects: ['savingsPerMonth', 'debtPaymentPct', 'stress'] })
  // income, but nobody's salary (all of it the Shared member's, or passive): no largest earner to stop
  if (ctx.months > 0 && ctx.incomePerMonth > 0 && ctx.earners.length === 0) gaps.push({ code: 'no_earner', affects: ['stress'] })
  const m = ctx.mandatory
  if (!m) { if (ctx.trackFlows) gaps.push({ code: 'no_mandatory', affects: MANDATORY }) }
  else if (m.source === 'manual' && m.updatedAt
    && monthsBetween(monthOf(m.updatedAt), monthOf(isoDate(ctx.today))) > MANUAL_STALE_MONTHS) {
    gaps.push({ code: 'stale_manual', params: { month: monthOf(m.updatedAt) }, affects: MANDATORY })
  }
  const low = ctx.coverage.filter((c): c is number => c !== null && c < COVERAGE_MIN_PCT)
  if (low.length) gaps.push({ code: 'low_coverage', params: { pct: Math.min(...low) }, affects: MANDATORY })
  for (const l of ctx.rateless.loans) {
    gaps.push({ code: 'loan_no_rate', params: { currency: l.currency, name: l.name }, affects: ['debtPaymentPct', 'leftForLiving', 'stress'] })
  }
  // the closed month has flows but a row without a rate: its totals, which the payment share and the fund are graded on, are unknown
  if (ctx.months > 0 && ctx.month !== null && ctx.closed === null) gaps.push({ code: 'month_no_rate', params: { month: ctx.month }, affects: ['debtPaymentPct'] })
  // no balances, or a bank account missing or without a rate
  if (ctx.liquid === null) gaps.push({ code: 'liquid_unknown', affects: ['liquid', 'emergencyMonths', 'stress'] })
  for (const g of ctx.rateless.goals) gaps.push({ code: 'goal_no_rate', params: { currency: g.currency, name: g.name, goalId: g.id }, affects: ['goals'] })
  if (ctx.goals.length === 0 && ctx.rateless.goals.length === 0) gaps.push({ code: 'no_goals', affects: ['goals'] })
  return gaps
}

/** The gaps that do not depend on a scenario (no `no_rate` for its amount, no `unknown_goal`): what the family's data lack. */
export function contextGaps(ctx: AdvisorContext): Gap[] {
  return dataOnlyGaps(ctx)
}

/** The context gaps with the scenario's own: `no_rate` first, `unknown_goal` last. */
function dataGaps(ctx: AdvisorContext, scenario: Scenario, amountBase: number | null): Gap[] {
  const gaps: Gap[] = []
  if (amountBase === null) {
    gaps.push({ code: 'no_rate', params: { currency: scenario.currency }, affects: [...Object.keys(NO_NUMBERS) as (keyof KeyNumbers)[], 'goals', 'stress', 'credit'] })
  }
  gaps.push(...dataOnlyGaps(ctx))
  const goalId = scenario.kind === 'buy_now' ? scenario.goalId : undefined
  if (goalId !== undefined && !ctx.goals.some(g => g.id === goalId) && !ctx.rateless.goals.some(g => g.id === goalId)) {
    gaps.push({ code: 'unknown_goal', params: { goalId }, affects: ['goals'] })
  }
  return gaps
}

/** An existing goal moved later by fewer months than this keeps the goals zone green: a quarter; a longer move is a cost (R8: 34 months) */
const NOTABLE_MOVE_MONTHS = 3

/** An existing goal reached NOTABLE_MOVE_MONTHS or more later than before, or no longer reached */
const movesLater = (g: GoalShift) => g.before !== null && (g.after === null || monthsBetween(g.before, g.after) >= NOTABLE_MOVE_MONTHS)

/**
 * The goals' zone of a plan: the proposed goal unreachable is red; at risk, an existing goal's status made worse or its
 * projected month moved later by a quarter (NOTABLE_MOVE_MONTHS) or more, amber.
 */
function goalsZone(shifts: readonly GoalShift[]): Zone {
  const proposed = shifts.find(s => s.goalId === PROPOSED_ID)
  if (proposed?.statusAfter === 'unreachable') return 'red'
  const worse = shifts.some(s => s.goalId !== PROPOSED_ID && s.statusBefore !== null
    && (STATUS_RANK[s.statusAfter] > STATUS_RANK[s.statusBefore] || movesLater(s)))
  return proposed?.statusAfter === 'at_risk' || worse ? 'amber' : 'green'
}

/** Paying more than the liquid money is risky whatever else is known; without the amount, the flows or income it is unknown; else from the zones. */
function riskOf(zones: Impact['zones'], beyondLiquid: boolean, weighable: boolean): RiskLevel {
  if (beyondLiquid) return 'risky'
  if (!weighable) return 'unknown'
  const all = Object.values(zones)
  if (all.includes('red')) return 'risky'
  return all.includes('amber') ? 'caution' : 'ok'
}

/**
 * @public Evaluates one scenario against the family's context. `rates` (today's) convert the scenario's amounts to the base
 * currency; a currency without one gives null "after" numbers and a `no_rate` gap — never a throw, NaN or Infinity. Formulas
 * (spec "Precise rules → Formulas"): savings after = savings − new payment; payment share = (current + new payments) ÷ income;
 * left for living = income − mandatory − current payments − new payment; emergency after = (liquid − paid now) ÷ (expenses +
 * new payment); the stress test in `stressTest`. A credit's payment comes out of the goals' savings for its term only. An
 * own-money purchase does not change the monthly savings, so no goal moves unless the money was put aside for one (`goalId`).
 */
export function evaluateScenario(ctx: AdvisorContext, scenario: Scenario, rates: Rates): Impact {
  const amountBase = convert(scenario.amount, scenario.currency, ctx.base, rates)
  const downBase = scenario.kind === 'credit' ? convert(scenario.downPayment, scenario.currency, ctx.base, rates) : 0

  const nowRaw = keyNumbers(ctx, { paidNow: 0, newPayment: 0, paymentMonths: 0 })
  let credit: Impact['credit'] = null
  let change: Change | null = null
  if (amountBase !== null && downBase !== null) {
    if (scenario.kind === 'credit') {
      const principal = amountBase - downBase
      const payment = calcMonthlyPayment(principal, scenario.ratePct, scenario.termMonths)
      credit = { principal: round2(principal), payment: round2(payment), overpayment: round2(payment * scenario.termMonths - principal) }
      change = { paidNow: downBase, newPayment: payment, paymentMonths: scenario.termMonths }
    } else {
      change = { paidNow: scenario.kind === 'buy_now' ? amountBase : 0, newPayment: 0, paymentMonths: 0 }
    }
  }
  const afterRaw = change ? keyNumbers(ctx, change) : NO_NUMBERS
  const savingsNow = nowRaw.savingsPerMonth

  let goals: GoalShift[] = []
  if (change && amountBase !== null && savingsNow !== null) {
    const before = allocateGoals(ctx.goals, Math.max(0, savingsNow), ctx.today, {}, ctx.base, undefined, ctx.annualReturn)
    // a loan's payment leaves the goals' savings only while it is paid
    const goalsAfterIt = goalsAfter(ctx, scenario, amountBase)
    const cut = { perMonthBase: change.newPayment, months: change.paymentMonths }
    const after = allocateGoals(goalsAfterIt, Math.max(0, savingsNow), ctx.today, {}, ctx.base, cut, ctx.annualReturn)
    const first = goalsAfterIt.some(g => g.id === PROPOSED_ID)
      ? firstShare(goalsAfterIt, Math.max(0, savingsNow), ctx.today, {}, ctx.base, cut, PROPOSED_ID, ctx.annualReturn) : null
    goals = goalShifts(before, after, first, PROPOSED_ID)
  }

  const stress = change ? stressTest(ctx, change) : null
  // a zone comes from the figure as shown (rounded), as on the health cards: 1.004 months shows as 1, which is red
  const after = rounded(afterRaw)
  const zones: Impact['zones'] = {}
  if (after.emergencyMonths !== null) zones.emergency_months = zoneOf('emergency_months', after.emergencyMonths)
  if (after.debtPaymentPct !== null) zones.debt_payment_ratio = zoneOf('debt_payment_ratio', after.debtPaymentPct)
  const savingsRate = afterRaw.savingsPerMonth === null ? null : out(mul100(ratio(afterRaw.savingsPerMonth, ctx.incomePerMonth)))
  if (savingsRate !== null) zones.savings_rate = zoneOf('savings_rate', savingsRate)
  if (stress) zones.stress = stress.months === null ? 'excellent' : zoneOf('emergency_months', stress.months)
  if (change && savingsNow !== null) zones.goals = goalsZone(goals)

  const known = ctx.incomeCurrencies
  return {
    scenario,
    amountBase: out(amountBase),
    ...(change && ctx.liquid !== null && (scenario.kind === 'buy_now' || scenario.kind === 'credit') ? {
      cashFunding: { requiredNow: round2(change.paidNow), shortfall: round2(Math.max(0, change.paidNow - ctx.liquid)) },
    } : {}),
    now: rounded(nowRaw),
    after,
    credit,
    monthsToSave: amountBase !== null && savingsNow !== null && savingsNow > 0 ? Math.ceil(amountBase / savingsNow) : null,
    goals,
    incomeShares: incomeSharesOf(ctx),
    stress,
    currencyRisk: known.length && !known.includes(scenario.currency) ? { currency: scenario.currency, incomeCurrencies: [...known] } : null,
    zones,
    risk: riskOf(zones, change !== null && ctx.liquid !== null && change.paidNow > ctx.liquid,
      change !== null && ctx.months > 0 && ctx.incomePerMonth > 0
        // paying now or a new payment is weighed against the fund and the payment share: unknown without them
        && (scenario.kind === 'goal' || scenario.kind === 'save_up' || (ctx.closed !== null && ctx.liquid !== null))),
    gaps: dataGaps(ctx, scenario, amountBase),
  }
}

export type AlternativeKind = 'smaller' | 'save_up' | 'longer_term' | 'bigger_down_payment' | 'later_date' | 'earlier_date'
/** Another way to the same purchase or goal, with its own full evaluation */
export interface Alternative {
  kind: AlternativeKind; scenario: Scenario; impact: Impact
  /** Base-currency cash bridge, assuming unchanged price, existing liquidity and expenses; not a future snapshot. */
  purchaseAfterSaving?: { price: number; additionalSavings: number; retainedReserve: number; retainedReserveMonths: number | null }
}
/** A scenario's impact and at most `MAX_ALTERNATIVES` alternatives */
export interface Evaluation { impact: Impact; alternatives: Alternative[] }

const MAX_ALTERNATIVES = 3
/** Months of expenses the liquid money keeps after a purchase or a down payment: where the emergency zone turns green */
const FUND_MONTHS = zoneThresholds('emergency_months')[1]
/** Alternative amounts are rounded down to this many units of the scenario currency */
const AMOUNT_STEP = 1000
const LONGER_TERM_STEP_MONTHS = 12
const LONGEST_TERM_MONTHS: Record<Extract<Scenario, { kind: 'credit' }>['loanType'], number> = { consumer: 84, mortgage: 360 }
/** The down payment of the "bigger_down_payment" alternative: at most this share of the amount, and at least this much more */
const MAX_DOWN_SHARE = 0.9
const MIN_DOWN_STEP_SHARE = 0.1

const floorToStep = (v: number) => Math.floor(v / AMOUNT_STEP) * AMOUNT_STEP
/** Saving up and the date alternatives name a month at most this many months from today: thirty years */
const ALTERNATIVE_WINDOW_MONTHS = 360

/** The month counts from `from` to `to`, both included, stepping towards `to` (down when `from` is above it). */
function* span(from: number, to: number): Generator<number> {
  const step = to >= from ? 1 : -1
  for (let n = from; step > 0 ? n <= to : n >= to; n += step) yield n
}

/** 'YYYY-MM' `n` months after this month; null when `n` is not a month count within the projection horizon (shiftMonth would leave the Date range). */
function monthAhead(ctx: AdvisorContext, n: number): string | null {
  return Number.isInteger(n) && n >= 1 && n <= PROJECTION_HORIZON_MONTHS ? shiftMonth(monthOf(isoDate(ctx.today)), n) : null
}

type Candidate = Omit<Alternative, 'impact'>

/** How far a goal is from its deadline: a status may stay or get better, never rise in this order */
const STATUS_RANK: Record<GoalStatus, number> = { done: 0, on_track: 0, at_risk: 1, unreachable: 2 }

/**
 * Whether a purchase saved for by a month fits next to the existing goals: the proposed goal is on track, every existing goal
 * on track stays on track (its month may move, never past its deadline) and no status gets worse — a goal already late may be
 * reached later (it is in the shifts, and the goals zone turns amber from a quarter's move), never not at all. For the plans of `evaluateScenario`
 * (`goalShifts`).
 */
function fitsNextToGoals(shifts: GoalShift[]): boolean {
  return shifts.some(g => g.goalId === PROPOSED_ID && g.statusAfter === 'on_track')
    && shifts.every(g => g.statusBefore === null || STATUS_RANK[g.statusAfter] <= STATUS_RANK[g.statusBefore])
}

/**
 * The first of the `months` (counts of months ahead, in the order given; only those from 1 to ALTERNATIVE_WINDOW_MONTHS)
 * by which saving `amountBase` fits next to the existing goals (`fitsNextToGoals`), the goals allocated as `evaluateScenario`
 * does; `at` builds the scenario ending in a month. Null — none fits.
 */
function fittingMonth(ctx: AdvisorContext, amountBase: number, months: Iterable<number>, at: (month: string) => Extract<Scenario, { kind: 'goal' | 'save_up' }>): string | null {
  const savings = ctx.incomePerMonth - ctx.expensePerMonth
  if (amountBase <= 0 || savings <= 0) return null
  const before = allocateGoals(ctx.goals, savings, ctx.today, {}, ctx.base, undefined, ctx.annualReturn)
  for (const n of months) {
    const month = n <= ALTERNATIVE_WINDOW_MONTHS ? monthAhead(ctx, n) : null
    if (month === null) continue
    const after = allocateGoals(goalsAfter(ctx, at(month), amountBase), savings, ctx.today, {}, ctx.base, undefined, ctx.annualReturn)
    // the fit needs no firstShare
    if (fitsNextToGoals(goalShifts(before, after, null, PROPOSED_ID))) return month
  }
  return null
}

/** Saving `amount` (scenario currency; `amountBase` in the base): the earliest month `fittingMonth` finds, none without one. */
function saveUp(ctx: AdvisorContext, currency: string, amount: number, amountBase: number): Candidate[] {
  const at = (targetMonth: string): Scenario & { kind: 'save_up' } => ({ kind: 'save_up', amount, currency, targetMonth })
  const targetMonth = amount > 0 && amount <= MAX_AMOUNT ? fittingMonth(ctx, amountBase, span(1, ALTERNATIVE_WINDOW_MONTHS), at) : null
  return targetMonth ? [{ kind: 'save_up', scenario: at(targetMonth) }] : []
}

/**
 * The largest down payment (scenario currency, a multiple of AMOUNT_STEP, at most MAX_DOWN_SHARE of the amount) after which the
 * liquid money still covers more than FUND_MONTHS of expenses with the new payment: liquid − D > F × (expenses + payment(amount
 * − D)). The payment is linear in the principal (k per unit), so D < (liquid − F × (expenses + k × amount)) ÷ (1 − F × k), solved
 * in the base currency; the floored candidate is then checked with the real payment and stepped down until it holds. When
 * F × k ≥ 1 (a very short term) a bigger down payment only helps, so the cap is the one to check. Null — none keeps the fund.
 */
function fundKeepingDownPayment(ctx: AdvisorContext, scenario: Extract<Scenario, { kind: 'credit' }>, rates: Rates): number | null {
  const { amount, currency, ratePct, termMonths } = scenario
  const toBase = (v: number) => convert(v, currency, ctx.base, rates)
  const amountBase = toBase(amount)
  const { liquid, fundExpense } = ctx
  if (amountBase === null || liquid === null || fundExpense === null) return null
  const keepsFund = (down: number) => {
    const downBase = toBase(down)
    const principalBase = toBase(amount - down)
    if (downBase === null || principalBase === null) return false
    return liquid - downBase > FUND_MONTHS * (fundExpense + calcMonthlyPayment(principalBase, ratePct, termMonths))
  }
  // capped in the scenario currency, so the trip through the base currency cannot lose a step
  const cap = floorToStep(MAX_DOWN_SHARE * amount)
  const k = calcMonthlyPayment(1, ratePct, termMonths)
  const lower = 1 - FUND_MONTHS * k
  if (lower <= 0) return keepsFund(cap) ? cap : null
  const boundBase = (liquid - FUND_MONTHS * (fundExpense + k * amountBase)) / lower
  const bound = boundBase > 0 ? convert(boundBase, ctx.base, currency, rates) : null
  if (bound === null) return null
  let down = Math.min(floorToStep(bound), cap)
  // the bound is exact up to rounding, so this steps down once at most
  while (down > 0 && !keepsFund(down)) down -= AMOUNT_STEP
  return down > 0 ? down : null
}

/** The credit alternatives, in order: a smaller amount, saving up for it, a bigger down payment, a longer term. */
function creditCandidates(ctx: AdvisorContext, scenario: Extract<Scenario, { kind: 'credit' }>, impact: Impact, rates: Rates, amountBase: number): Candidate[] {
  const out: Candidate[] = []
  const downBase = convert(scenario.downPayment, scenario.currency, ctx.base, rates)
  const toBase = (v: number) => convert(v, scenario.currency, ctx.base, rates)
  const toScenario = (v: number) => convert(v, ctx.base, scenario.currency, rates)
  const { ratePct, termMonths } = scenario
  const zone = impact.zones.debt_payment_ratio
  const overNorm = zone === 'amber' || zone === 'red'

  // smaller: the principal whose payment is the room left under the norm, plus the down payment; only for a share at or over
  // the norm, and not while a loan without a rate leaves the current payments understated
  const room = ctx.closed === null ? 0 : (ctx.closed.income * DEBT_NORM_PCT) / 100 - ctx.loanPaymentsPerMonth
  if (overNorm && ctx.rateless.loans.length === 0 && room > 0 && downBase !== null) {
    const r = ratePct / 12 / 100
    const principal = r > 0 ? (room * (1 - Math.pow(1 + r, -termMonths))) / r : room * termMonths
    const inCurrency = toScenario(principal + downBase)
    if (inCurrency !== null) {
      let amount = floorToStep(inCurrency)
      // a share exactly at the norm is already amber: one step lower keeps it under
      const principalBase = toBase(amount - scenario.downPayment)
      if (principalBase !== null && calcMonthlyPayment(principalBase, ratePct, termMonths) >= room) amount -= AMOUNT_STEP
      if (amount > scenario.downPayment && amount < scenario.amount) out.push({ kind: 'smaller', scenario: { ...scenario, amount } })
    }
  }

  // save_up: the month the whole amount is on track next to the existing goals
  out.push(...saveUp(ctx, scenario.currency, scenario.amount, amountBase))

  // bigger_down_payment: the largest down payment that keeps the fund with the new payment, when it adds at least 10% of the amount
  const downPayment = fundKeepingDownPayment(ctx, scenario, rates)
  if (downPayment !== null && downPayment - scenario.downPayment >= MIN_DOWN_STEP_SHARE * scenario.amount) {
    out.push({ kind: 'bigger_down_payment', scenario: { ...scenario, downPayment } })
  }

  // longer_term: only when the payment share is amber or red
  const longer = Math.min(termMonths + LONGER_TERM_STEP_MONTHS, LONGEST_TERM_MONTHS[scenario.loanType])
  if (overNorm && longer > termMonths) out.push({ kind: 'longer_term', scenario: { ...scenario, termMonths: longer } })
  return out
}

/**
 * A goal (or saving up) at risk or unreachable: the first month after its own that `fittingMonth` finds within the window;
 * none — the nearest month before its own that fits, as `earlier_date` (a goal funded behind a far, late one may be on track
 * only ahead of it).
 */
function otherDate(ctx: AdvisorContext, scenario: Extract<Scenario, { kind: 'goal' | 'save_up' }>, impact: Impact, amountBase: number): Candidate[] {
  const proposed = impact.goals.find(g => g.goalId === PROPOSED_ID)
  if (!proposed || (proposed.statusAfter !== 'at_risk' && proposed.statusAfter !== 'unreachable')) return []
  const own = monthsBetween(monthOf(isoDate(ctx.today)), scenario.kind === 'goal' ? monthOf(scenario.targetDate) : scenario.targetMonth)
  const at = (month: string): Extract<Scenario, { kind: 'goal' | 'save_up' }> =>
    (scenario.kind === 'goal' ? { ...scenario, targetDate: monthEnd(month) } : { ...scenario, targetMonth: month })
  const later = own < ALTERNATIVE_WINDOW_MONTHS ? fittingMonth(ctx, amountBase, span(own + 1, ALTERNATIVE_WINDOW_MONTHS), at) : null
  if (later) return [{ kind: 'later_date', scenario: at(later) }]
  const earlier = own > 1 ? fittingMonth(ctx, amountBase, span(Math.min(own, ALTERNATIVE_WINDOW_MONTHS + 1) - 1, 1), at) : null
  return earlier ? [{ kind: 'earlier_date', scenario: at(earlier) }] : []
}

/**
 * @public Evaluates a scenario and its alternatives, each with its own `evaluateScenario` impact; at most three, in the order
 * smaller, save_up, bigger_down_payment, longer_term (credit), save_up of the shortfall below the emergency fund (buy_now
 * without a goalId), later_date or else earlier_date (goal, save_up). Saving up and later dates name the earliest month (a
 * later date: after its own; an earlier date: the latest month before its own) at which the purchase fits next to the
 * existing goals (`fittingMonth`, `fitsNextToGoals`): it is on track, every goal on track stays on track and no status gets
 * worse — a goal already late may be reached later, and its impact shows that move; none when no month within thirty years
 * (ALTERNATIVE_WINDOW_MONTHS) fits, and any whose own impact does not show it fitting is dropped. The bigger down payment
 * keeps the emergency fund above 3 months of expenses with the new payment. None without the numbers to build them on: the
 * amount without a rate, no cash flow, no income. Credit amounts are in the scenario currency, rounded down to 1000.
 */
export function evaluate(ctx: AdvisorContext, scenario: Scenario, rates: Rates): Evaluation {
  const impact = evaluateScenario(ctx, scenario, rates)
  const amountBase = convert(scenario.amount, scenario.currency, ctx.base, rates)
  if (amountBase === null || ctx.months === 0 || ctx.incomePerMonth <= 0) return { impact, alternatives: [] }

  let candidates: Candidate[] = []
  switch (scenario.kind) {
    case 'credit':
      candidates = creditCandidates(ctx, scenario, impact, rates, amountBase)
      break
    case 'buy_now': {
      // without the liquid money or the expenses the fund's shortfall is unknown: nothing to save up
      const { liquid, fundExpense } = ctx
      if (liquid === null || fundExpense === null) break
      // save what the purchase would take from the emergency fund; money put aside for a goal has the goal's own month
      const shortBase = amountBase - (liquid - FUND_MONTHS * fundExpense)
      const short = shortBase > 0 && scenario.goalId === undefined ? convert(shortBase, ctx.base, scenario.currency, rates) : null
      // rounded up to whole units, so it still covers the gap; the month is searched for that rounded amount
      const rounded = short === null ? null : Math.ceil(short)
      const roundedBase = rounded === null ? null : convert(rounded, scenario.currency, ctx.base, rates)
      if (rounded !== null && roundedBase !== null) {
        const retained = liquid + roundedBase - amountBase
        candidates = saveUp(ctx, scenario.currency, rounded, roundedBase).map(candidate => ({
          ...candidate,
          purchaseAfterSaving: {
            price: round2(amountBase), additionalSavings: round2(roundedBase),
            retainedReserve: round2(retained), retainedReserveMonths: out(emergencyMonths(retained, fundExpense)),
          },
        }))
      }
      break
    }
    case 'goal':
    case 'save_up':
      candidates = otherDate(ctx, scenario, impact, amountBase)
      break
  }
  // a month to save by is offered only when its own impact shows it fits next to the goals
  const dated: readonly AlternativeKind[] = ['save_up', 'later_date', 'earlier_date']
  const honest = (a: Alternative) => !dated.includes(a.kind) || fitsNextToGoals(a.impact.goals)
  return {
    impact,
    alternatives: candidates.map(c => ({ ...c, impact: evaluateScenario(ctx, c.scenario, rates) })).filter(honest).slice(0, MAX_ALTERNATIVES),
  }
}
