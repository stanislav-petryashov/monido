import { isoDate, monthOf, monthsBetween, shiftMonth } from './dates'
import { convert, round2 } from './fx'
import type { CoastFire, GoalAllocation, GoalItem, GoalRow, GoalStatus, GoalsPlan, HistoryPoint, Rates } from './types'

/** Shared nominal annual return assumption: the independence goal grows at it inside the plan. */
export const ANNUAL_RETURN = 0.08

/** The independence strategy: the plan re-run with this much more saved a month (in USD; the snapshot converts it) */
export const SCENARIO_EXTRA_USD = 500
/** The independence goal's return range around the base: lower and higher by this much a year (the lower never below zero) */
export const FIRE_RETURN_SPREAD = 0.03

/** The low and high yearly returns the independence goal is also forecast at: base ∓ FIRE_RETURN_SPREAD, the low clamped at 0. */
export function fireReturnRange(base = ANNUAL_RETURN): { low: number; high: number } {
  return { low: Math.max(0, base - FIRE_RETURN_SPREAD), high: base + FIRE_RETURN_SPREAD }
}

/** An under-funded goal the savings would take longer than this to reach is unreachable: no projected month (and no Date out of range). */
export const PROJECTION_HORIZON_MONTHS = 1200

// no lookbehind: this file is in the browser bundle and Safari before 16.4 rejects it at load
const FIRE_WORD = /(?:^|[^\p{L}\p{N}])fire(?![\p{L}\p{N}])/iu

/** Whether a goal is the financial-independence goal: "fire" as a whole word (not inside a longer run of letters or digits) in its key or its name ("Fireplace" is not). */
export function isFireGoal(g: { id: string; name: string }): boolean {
  return FIRE_WORD.test(g.id) || FIRE_WORD.test(g.name)
}

/** Whole calendar months from `today` to `targetDate` (clamped at 0); both in UTC, like every domain date. */
export function monthsUntil(targetDate: string, today: Date): number {
  return Math.max(0, monthsBetween(monthOf(isoDate(today)), monthOf(targetDate)))
}

/** What a goal may still miss and count as reached, relative to its target: the float dust of the monthly shares */
const REACHED_TOLERANCE = 1e-9

/**
 * The goal plan, month by month from the month after today up to PROJECTION_HORIZON_MONTHS; amounts in the `base` currency
 * at `rates` (today's). Each month the savings (none when negative) go to the open goals in deadline order (ties: the input
 * order), each taking at most what it still needs ÷ the months left to its deadline, this one included (a goal past its
 * deadline: all it still needs); the money no goal takes is not spread further. A goal is reached the month nothing is left
 * to collect, and takes nothing after, so its share passes to the next ones. `allocBase` is the share in the first month;
 * `requiredMonthlyBase` what is left ÷ the months to the deadline today (0 past it); `projectedDate` the month the goal is
 * reached: `on_track` by its deadline month, `at_risk` later, `unreachable` (no month) when the horizon ends first — except
 * a goal whose deadline is beyond the horizon and that got its whole share every month: `on_track` at its deadline month.
 * The independence goal (isFireGoal; the first one) also grows at `fireReturn` a year, compounded monthly, on what it holds:
 * it is reached, and stops taking, the month that value reaches its target. `shares` is each goal's share month by month
 * (index 0 is the month after today) up to the month it is reached or the horizon.
 * `cut` lowers the savings of the first `cut.months` months by `cut.perMonthBase` (a new loan's payment over its term; the pool
 * never below 0); `monthlySavingsBase` and the surplus stay the savings without it. Goals whose currency has no rate are left
 * out; the snapshot warns about them.
 */
export function allocateGoals(
  goals: GoalRow[], monthlySavingsBase: number, today: Date, rates: Rates, base: string,
  cut: { perMonthBase: number; months: number } = { perMonthBase: 0, months: 0 }, fireReturn = ANNUAL_RETURN,
): GoalsPlan {
  const { plans, sim, pool } = simulate(goals, monthlySavingsBase, today, rates, base, cut, fireReturn)
  const thisMonth = monthOf(isoDate(today))
  const allocations: GoalAllocation[] = plans.map((b, i) => {
    const { reachedAt, first, onSchedule, shares } = sim[i]
    let status: GoalAllocation['status']
    let projectedDate: string | null = null
    if (b.done) status = 'done'
    else if (reachedAt !== null) {
      status = reachedAt <= b.months ? 'on_track' : 'at_risk'
      projectedDate = shiftMonth(thisMonth, reachedAt)
    } else if (b.months > PROJECTION_HORIZON_MONTHS && onSchedule && pool > 0) {
      // funded at its share every month of the horizon: the same share reaches it at its deadline
      status = 'on_track'
      projectedDate = shiftMonth(thisMonth, b.months)
    } else status = 'unreachable'
    return {
      goal: b.g,
      progressPct: b.targetBase > 0 ? (b.currentBase / b.targetBase) * 100 : 0,
      monthsToDeadline: b.months,
      requiredMonthlyBase: b.required,
      allocBase: first,
      shares,
      status,
      projectedDate,
    }
  })

  const totalRequiredBase = plans.reduce((s, b) => s + b.required, 0)
  return { allocations, totalRequiredBase, monthlySavingsBase, surplusBase: monthlySavingsBase - totalRequiredBase }
}

/**
 * What the independence goal holds month by month on a plan: index 0 today (`pv`), then the month before × (1 + `annualReturn`/12)
 * plus that month's share (none after the shares end), up to `months` months ahead.
 */
export function fireValues(pv: number, shares: number[], annualReturn: number, months: number): number[] {
  const out = [pv]
  for (let n = 1; n <= months; n++) out.push(out[n - 1] * (1 + annualReturn / 12) + (shares[n - 1] ?? 0))
  return out
}

/** The plan while the savings are unknown (income and expenses not tracked): what the goals need, no shortfall, no pace. */
export function unknownSavingsPlan(plan: GoalsPlan): GoalsPlan {
  return {
    ...plan,
    monthlySavingsBase: null,
    surplusBase: null,
    allocations: plan.allocations.map(a => ({ ...a, allocBase: 0, shares: [], status: a.status === 'done' ? 'done' : null, projectedDate: null })),
  }
}

/**
 * The snapshot's goals in its base currency, as the advisor builds them, for plans run on the client with `{}` rates: target and
 * saved are the items' base amounts; a goal without a rate (no base amount) is left out, as allocateGoals leaves it out.
 */
export function goalsInBase(items: GoalItem[], base: string): GoalRow[] {
  return items.flatMap(g => (g.targetBase === null || g.currentBase === null ? [] : [{ ...g, target: g.targetBase, current: g.currentBase, currency: base }]))
}

/** Binary search steps of savingToMeet: the bound halves 50 times, far below a cent */
const MEET_STEPS = 50

/**
 * The smallest monthly saving with which the plan (allocateGoals, the same arguments) reaches `goalId` by its deadline
 * (`on_track`): a binary search between 0 and what the goals at or ahead of it in the plan need a month (a goal past its
 * deadline: all it still needs), which always makes it. Null — it is on track or done already, it is not in the plan (no
 * rate), the savings are unknown, or even that bound does not make it (a goal past its deadline is late whatever is saved).
 */
export function savingToMeet(goals: GoalRow[], goalId: string, saving: number | null, today: Date, rates: Rates, base: string): number | null {
  if (saving === null) return null
  const statusAt = (s: number) => allocateGoals(goals, s, today, rates, base).allocations.find(a => a.goal.id === goalId)?.status
  const plan = allocateGoals(goals, saving, today, rates, base)
  const at = plan.allocations.findIndex(a => a.goal.id === goalId)
  if (at < 0 || plan.allocations[at].status === 'on_track' || plan.allocations[at].status === 'done') return null
  const bound = plan.allocations.slice(0, at + 1).reduce((s, a) => {
    if (a.status === 'done') return s
    if (a.monthsToDeadline > 0) return s + a.requiredMonthlyBase
    return s + Math.max(0, (convert(a.goal.target - a.goal.current, a.goal.currency, base, rates) ?? 0))
  }, 0)
  if (statusAt(bound) !== 'on_track') return null
  let lo = 0, hi = bound
  for (let k = 0; k < MEET_STEPS; k++) {
    const mid = (lo + hi) / 2
    if (statusAt(mid) === 'on_track') hi = mid
    else lo = mid
  }
  return hi
}

/**
 * What a goal gets from the plan by month (its `shares`, index 0 the month after `thisMonth`): `now`, the first month's
 * share; `later` — the first later month its share changes (a nearer goal reached passes its share on) with that share
 * and the one of the month after (the first is short when the nearer goal took part of it); null — it does not change.
 */
export function shareSteps(shares: number[], thisMonth: string): { now: number; later: { month: string; perMonthBase: number; next: number | null } | null } {
  const now = shares[0] ?? 0
  const i = shares.findIndex((v, k) => k > 0 && v > SHARE_CENT && Math.abs(v - now) > SHARE_CENT)
  return { now, later: i < 0 ? null : { month: shiftMonth(thisMonth, i + 1), perMonthBase: shares[i], next: shares[i + 1] ?? null } }
}
/** Half a cent: shares that differ by less are the same on the page */
const SHARE_CENT = 0.005

/**
 * When the plan of allocateGoals (the same arguments) starts paying into `goalId`, and how much a month then: the first
 * month it gets money, 'YYYY-MM', and the larger of what it gets that month and the next (the first is short when a nearer
 * goal is reached that same month and passes on only what it leaves). Null — it never gets any, it is reached already or
 * it is not in the plan.
 */
export function firstShare(
  goals: GoalRow[], monthlySavingsBase: number, today: Date, rates: Rates, base: string,
  cut: { perMonthBase: number; months: number }, goalId: string,
): { month: string; perMonthBase: number } | null {
  const { plans, sim } = simulate(goals, monthlySavingsBase, today, rates, base, cut)
  const i = plans.findIndex(b => b.g.id === goalId)
  const s = sim[i]
  if (!s || s.startAt === null) return null
  return { month: shiftMonth(monthOf(isoDate(today)), s.startAt), perMonthBase: Math.max(s.startTake, s.nextTake) }
}

/** The month-by-month run behind allocateGoals and firstShare: the goals in funding order and what each got. */
function simulate(
  goals: GoalRow[], monthlySavingsBase: number, today: Date, rates: Rates, base: string,
  cut: { perMonthBase: number; months: number }, fireReturn = ANNUAL_RETURN,
) {
  const fireId = goals.find(isFireGoal)?.id
  const growth = 1 + fireReturn / 12
  const plans = goals
    .map(g => ({ g, targetBase: convert(g.target, g.currency, base, rates), currentBase: convert(g.current, g.currency, base, rates) }))
    .filter((b): b is { g: GoalRow; targetBase: number; currentBase: number } => b.targetBase !== null && b.currentBase !== null)
    // Array.prototype.sort is stable: the same deadline keeps the input order
    .sort((a, b) => a.g.target_date.localeCompare(b.g.target_date))
    .map(({ g, targetBase, currentBase }) => {
      const months = monthsUntil(g.target_date, today)
      const remainingBase = Math.max(0, targetBase - currentBase)
      const done = currentBase >= targetBase
      const required = done || months <= 0 ? 0 : remainingBase / months
      return { g, targetBase, currentBase, months, remainingBase, done, required }
    })

  const pool = Math.max(0, monthlySavingsBase)
  const poolOf = (n: number) => (n <= cut.months ? Math.max(0, monthlySavingsBase - cut.perMonthBase) : pool)
  const sim = plans.map(b => ({
    left: b.remainingBase, reachedAt: b.done ? 0 : null as number | null, first: 0, onSchedule: true,
    // the first month with money and what it got then and the month after
    startAt: null as number | null, startTake: 0, nextTake: 0,
    // the share of each month; the independence goal's value with its return (the others: unused)
    shares: [] as number[], fire: b.g.id === fireId, value: b.currentBase,
  }))
  for (let n = 1; n <= PROJECTION_HORIZON_MONTHS; n++) {
    let free = poolOf(n)
    let open = false
    plans.forEach((b, i) => {
      const s = sim[i]
      if (s.reachedAt !== null) return
      const share = s.left / Math.max(1, b.months - n + 1)
      const take = Math.min(free, share)
      if (take < share * (1 - REACHED_TOLERANCE)) s.onSchedule = false
      if (n === 1) s.first = take
      if (s.startAt === null && take > b.targetBase * REACHED_TOLERANCE) { s.startAt = n; s.startTake = take }
      else if (s.startAt === n - 1) s.nextTake = take
      s.left -= take
      free -= take
      s.shares.push(take)
      if (s.fire) s.value = s.value * growth + take
      if (s.fire ? s.value >= b.targetBase * (1 - REACHED_TOLERANCE) : s.left <= b.targetBase * REACHED_TOLERANCE) s.reachedAt = n
      else open = true
    })
    // every goal reached, or nothing to share now or later (and no return to grow on): no later month changes anything
    const growing = fireReturn > 0 && sim.some(s => s.fire && s.reachedAt === null && s.value > 0)
    if (!open || (pool === 0 && n >= cut.months && !growing)) break
  }
  return { plans, sim, pool }
}

/**
 * What the open goals ahead of `goalId` in the plan (a nearer or the same deadline, funded first) take from the monthly
 * savings now, and the month the last of them is reached — a nearer goal that takes nothing now but is funded once another is
 * reached counts too; `untilMonth` null — one of them is never reached, so it takes savings to the end of the horizon. Null —
 * they take nothing now or later (nothing saved), or the goal is the first or not in the plan.
 */
export function savingsTakenAhead(plan: GoalsPlan, goalId: string): { perMonthBase: number; untilMonth: string | null } | null {
  const at = plan.allocations.findIndex(a => a.goal.id === goalId)
  const ahead = plan.allocations.slice(0, Math.max(0, at)).filter(a => a.status !== 'done')
  const perMonthBase = ahead.reduce((s, a) => s + a.allocBase, 0)
  const reached = ahead.map(a => a.projectedDate).filter((m): m is string => m !== null)
  if (perMonthBase <= 0 && reached.length === 0) return null
  return {
    perMonthBase,
    untilMonth: reached.length < ahead.length ? null : reached.reduce((a, b) => (b > a ? b : a)),
  }
}

/** A goal whose projected month or status the scenario changes; `before`/`after` are 'YYYY-MM' (null — not reached); the proposed goal has `statusBefore: null` */
export interface GoalShift {
  goalId: string; name: string; before: string | null; after: string | null; shiftMonths: number | null; statusBefore: GoalStatus | null; statusAfter: GoalStatus
  /** The proposed goal only: what it needs a month, from next month, to make its date, in the base currency (due this month: all of it) */
  requiredMonthly?: number
  /**
   * The proposed goal only, whenever goals with a nearer or the same deadline (existing goals first) take savings ahead of it,
   * on track or not: what they take a month now, and the month the last of them is reached; `untilMonth` null — one of them
   * is never reached
   */
  takenAhead?: { perMonth: number; untilMonth: string | null }
  /**
   * The proposed goal only: when the plan starts paying into it ('YYYY-MM', the first month it gets money) and what it gets
   * a month then, in the base currency; null — it never gets any. Absent in evaluations stored before it existed.
   */
  firstShare?: { month: string; perMonth: number } | null
}
/**
 * Goals whose projected month or status differs between the plans, and the proposed goal (`proposedId`; the advisor's
 * scenario, the Goals page's draft) itself, in the order of the plan
 * after; the proposed goal with the contribution it needs, what the nearer goals take ahead of it, when they take anything,
 * and `first` — when the plan starts paying into it and how much (firstShare).
 */
export function goalShifts(before: GoalsPlan, after: GoalsPlan, first: { month: string; perMonthBase: number } | null, proposedId: string): GoalShift[] {
  const shifts: GoalShift[] = []
  for (const a of after.allocations) {
    const b = before.allocations.find(x => x.goal.id === a.goal.id)
    if (b && b.projectedDate === a.projectedDate && b.status === a.status) continue
    if (!b && a.goal.id !== proposedId) continue
    const from = b?.projectedDate ?? null
    const shift: GoalShift = {
      goalId: a.goal.id, name: a.goal.name, before: from, after: a.projectedDate,
      shiftMonths: from !== null && a.projectedDate !== null ? monthsBetween(from, a.projectedDate) : null,
      // allocateGoals always weighs a status: null is only the snapshot's plan with unknown savings
      statusBefore: b?.status ?? null, statusAfter: a.status!,
    }
    if (a.goal.id === proposedId) {
      // the proposed goal is in the base currency; due this month, it has no month left to spread over
      shift.requiredMonthly = round2(a.monthsToDeadline > 0 ? a.requiredMonthlyBase : Math.max(0, a.goal.target - a.goal.current))
      const ahead = savingsTakenAhead(after, proposedId)
      if (ahead) shift.takenAhead = { perMonth: round2(ahead.perMonthBase), untilMonth: ahead.untilMonth }
      shift.firstShare = first && { month: first.month, perMonth: round2(first.perMonthBase) }
    }
    shifts.push(shift)
  }
  return shifts
}

/** The first month a goal gets money from the plan ('YYYY-MM'); null — never in its shares */
const startOf = (shares: number[], thisMonth: string): string | null => {
  const i = shares.findIndex(v => v > SHARE_CENT)
  return i < 0 ? null : shiftMonth(thisMonth, i + 1)
}

/** A goal the draft moves: the month it is reached and the first month it gets money, before and after */
export interface PreviewMove {
  goalId: string; name: string
  before: string | null; after: string | null
  startBefore: string | null; startAfter: string | null
  statusAfter: GoalStatus
}

/** What a goal being edited or created does to the plan, before it is saved; `noRate` — its currency has no rate here */
export type PlanPreview = { noRate: true } | {
  noRate: false
  /** What it needs a month to make its deadline */
  need: number
  /** Its place in the plan, 1 the nearest deadline */
  order: number
  /** null — the saving is unknown: only the need is known */
  plan: {
    steps: ReturnType<typeof shareSteps>
    status: GoalStatus
    projectedDate: string | null
    /** The other goals whose month or first month with money moves (goalShifts, with the first months) */
    moves: PreviewMove[]
  } | null
}

/**
 * The plan with a draft goal (one being edited replaces its stored row by `draft.id`; a new one is added), run as the
 * advisor runs it: on base amounts with `{}` rates. `goals` are already in `base` (goalsInBase); the draft is converted
 * with `rates`. `saving` null — unknown: only the need and the place in the plan.
 */
export function planPreview(goals: GoalRow[], draft: GoalRow, saving: number | null, today: Date, rates: Rates, base: string): PlanPreview {
  const target = convert(draft.target, draft.currency, base, rates)
  const current = convert(draft.current, draft.currency, base, rates)
  if (target === null || current === null) return { noRate: true }
  const inBase: GoalRow = { ...draft, target, current, currency: base }
  const others = goals.filter(g => g.id !== draft.id)
  const withDraft = [...others, inBase]
  const after = allocateGoals(withDraft, Math.max(0, saving ?? 0), today, {}, base)
  const at = after.allocations.findIndex(a => a.goal.id === draft.id)
  const a = after.allocations[at]
  if (saving === null) return { noRate: false, need: a.requiredMonthlyBase, order: at + 1, plan: null }
  const before = allocateGoals(goals, Math.max(0, saving), today, {}, base)
  const thisMonth = monthOf(isoDate(today))
  const shifted = new Set(goalShifts(before, after, null, draft.id).map(s => s.goalId))
  const moves = after.allocations.flatMap((x): PreviewMove[] => {
    const b = before.allocations.find(y => y.goal.id === x.goal.id)
    if (!b || x.goal.id === draft.id) return []
    const startBefore = startOf(b.shares, thisMonth), startAfter = startOf(x.shares, thisMonth)
    if (!shifted.has(x.goal.id) && startBefore === startAfter) return []
    return [{ goalId: x.goal.id, name: x.goal.name, before: b.projectedDate, after: x.projectedDate, startBefore, startAfter, statusAfter: x.status! }]
  })
  return {
    noRate: false, need: a.requiredMonthlyBase, order: at + 1,
    plan: { steps: shareSteps(a.shares, thisMonth), status: a.status!, projectedDate: a.projectedDate, moves },
  }
}

export function computeCoastFire(currentNwBase: number, fireTargetBase: number, annualReturn: number, monthsToDeadline: number): CoastFire {
  const r = annualReturn / 12
  const coastNumberBase = fireTargetBase / Math.pow(1 + r, Math.max(0, monthsToDeadline))
  return {
    reached: currentNwBase >= coastNumberBase,
    gapBase: Math.max(0, coastNumberBase - currentNwBase),
  }
}

/** Net worth growth per year from the first point to the last; null when either is a `partial` month (its net worth unknown) */
export function computeCagr(history: HistoryPoint[], partial: ReadonlySet<string>): number | null {
  if (history.length < 2) return null
  const first = history[0]
  const last = history[history.length - 1]
  if (partial.has(monthOf(first.date)) || partial.has(monthOf(last.date))) return null
  const months = monthsBetween(monthOf(first.date), monthOf(last.date))
  if (months <= 0 || first.netWorth <= 0 || last.netWorth <= 0) return null
  return Math.pow(last.netWorth / first.netWorth, 12 / months) - 1
}

export function requiredCagr(currentNwBase: number, fireTargetBase: number, monthsToDeadline: number): number | null {
  if (currentNwBase <= 0 || monthsToDeadline <= 0) return null
  return Math.pow(fireTargetBase / currentNwBase, 1 / (monthsToDeadline / 12)) - 1
}

/**
 * What one unit of `month` is worth in `last`'s money at a yearly inflation of `ratePct` %: (1 + rate)^(months / 12). The net
 * worth chart's "in today's money" line; a year's change on it is realReturn of the nominal change.
 */
export function todaysMoneyFactor(month: string, last: string, ratePct: number): number {
  return (1 + ratePct / 100) ** (monthsBetween(month, last) / 12)
}

export function realReturn(nominal: number, inflation: number): number {
  return (1 + nominal) / (1 + inflation) - 1
}
