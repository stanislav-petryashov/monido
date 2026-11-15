// The lines a proposal's Telegram card (council/cards.ts) and its site card (ProposalCard.tsx) word alike: the proposed
// goal's line, the recommended alternative in words, and which values count as unchanged. Pure over the stored evaluation;
// each card brings its own value formats (whole units in Telegram, cents and the code on the site), the keys are the same
// (`modules.advisor.bot.*`), and the equality is one, so both cards leave out the same lines.
import type { Scenario } from '../../domain/advisor'
import { PROPOSED_ID, type Alternative, type GoalShift, type Impact } from '../../domain/advisorImpact'
import type { ProposalVersionView, ProposalView, ProposalVoteView } from '../../domain/api'
import type { NumberChange, ScenarioChange } from '../../domain/proposals'
import type { Translate } from '../../i18n/core'
import { monthTitle } from '../../i18n/dates'

const B = 'modules.advisor.bot'
const NONE = '—'

/** How a card writes a value: money in a currency (null — a dash), a share of income, the fund's months, a term. */
export interface CardFormats {
  t: Translate
  money: (v: number | null, currency: string) => string
  pct: (v: number | null) => string
  fund: (v: number | null) => string
  months: (n: number) => string
}

// --- unchanged values ---------------------------------------------------------------------------------------------

/** `a` and `b` rounded to `digits` decimals are one number; null equals only null. */
const sameAt = (digits: number, a: number | null, b: number | null) =>
  (a === null || b === null ? a === b : Number(a.toFixed(digits)) === Number(b.toFixed(digits)))

/** Two amounts read the same on both cards: the same currency and the same whole units (the coarser card's). */
export const sameMoney = (a: number | null, b: number | null, currencyA: string, currencyB = currencyA): boolean =>
  currencyA === currencyB && sameAt(0, a, b)

/** Two shares of income or two fund months read the same: one decimal. */
export const sameDecimal = (a: number | null, b: number | null): boolean => sameAt(1, a, b)

/**
 * A was → now change both cards write the same on both sides, so neither shows it: money in whole units of the same
 * currency, shares and the fund to one decimal, a rate to two, a term in whole months, a goal set or not (each prints
 * "yes"), anything else as it is.
 */
function sameChange(
  key: ScenarioChange['field'] | NumberChange['key'], before: string | number | null, after: string | number | null,
  currencyBefore: string, currencyAfter: string,
): boolean {
  const num = (v: string | number | null) => (v === null ? null : Number(v))
  switch (key) {
    case 'amount':
    case 'downPayment':
    case 'payment':
    case 'leftForLiving':
    case 'savingsPerMonth': return sameMoney(num(before), num(after), currencyBefore, currencyAfter)
    case 'debtPaymentPct':
    case 'emergencyMonths': return sameDecimal(num(before), num(after))
    case 'ratePct': return sameAt(2, num(before), num(after))
    case 'termMonths': return sameAt(0, num(before), num(after))
    // every goal prints as "yes": only setting or clearing it shows
    case 'goalId': return (before === null) === (after === null)
    default: return before === after
  }
}

/** A member's name on a card; "someone" when the account is gone (its name is empty). */
export const memberName = (t: Translate, member: string): string => member || t(`${B}.card.someone`)

/** The key numbers the numbers block shows itself (now → after): the was-lines leave them out. */
const shownInBlock = (key: NumberChange['key'], impact: Impact): boolean =>
  key === 'debtPaymentPct' || key === 'leftForLiving' || key === 'emergencyMonths' || (key === 'payment' && impact.credit !== null)

/** The version `version` follows (number − 1) among the proposal's; undefined for the first */
export const previousVersion = (view: ProposalView, version: ProposalVersionView): ProposalVersionView | undefined =>
  [view.current, ...view.previous].find(v => v.number === version.number - 1)

/**
 * What a card shows of "Compared with version N": the scenario parameters and the key numbers that changed and read
 * differently on the two sides (sameChange); the numbers the block below shows itself are left out too.
 */
export function shownChanges(version: ProposalVersionView, previous: ProposalVersionView): { scenario: ScenarioChange[]; numbers: NumberChange[] } {
  return {
    scenario: version.changes.scenario
      .filter(c => !sameChange(c.field, c.before, c.after, previous.scenario.currency, version.scenario.currency)),
    numbers: version.changes.numbers
      .filter(c => !shownInBlock(c.key, version.evaluation.impact) && !sameChange(c.key, c.before, c.after, previous.baseCurrency, version.baseCurrency)),
  }
}

// --- goals, the recommendation, the voters ------------------------------------------------------------------------

/** The goals that move; the proposed goal has its own line, it is not one of them. */
export const movingGoals = (impact: Impact): GoalShift[] => impact.goals.filter(g => g.goalId !== PROPOSED_ID)

/**
 * How a goal the proposal moves reads on both cards: its key under `modules.advisor.bot.numbers` (`goalBy` — a date it
 * did not have) and the months it moves; null — it does not move.
 */
export function goalMove(g: GoalShift): { key: 'goalOut' | 'goalBy' | 'goalLater' | 'goalEarlier'; months: number } | null {
  if (g.after === null) return g.before === null ? null : { key: 'goalOut', months: 0 }
  if (g.shiftMonths === null) return { key: 'goalBy', months: 0 }
  if (g.shiftMonths === 0) return null
  return { key: g.shiftMonths > 0 ? 'goalLater' : 'goalEarlier', months: Math.abs(g.shiftMonths) }
}

/** Goals not weighed (no savings figure, too little history) are not known to stay put. */
export const goalsUnknown = (impact: Impact): boolean => impact.gaps.some(g => g.code !== 'no_goals' && g.affects.includes('goals'))

/** The alternative the verdict recommends, if the evaluation has it. */
export const recommendedOf = (version: ProposalVersionView): Alternative | undefined =>
  version.evaluation.alternatives.find(a => a.kind === version.verdict.recommended)

/** The votes that agreed, counted, from a member still there. */
export const agreedVotes = (version: ProposalVersionView): ProposalVoteView[] =>
  version.votes.filter(v => v.settled && v.vote === 'agree' && v.member !== '')

// --- the proposed goal and the alternative ------------------------------------------------------------------------

/** The month a saving or a goal scenario ends in, as 'YYYY-MM'; null — another kind. */
const scenarioMonth = (s: Scenario): string | null =>
  (s.kind === 'save_up' ? s.targetMonth : s.kind === 'goal' ? s.targetDate.slice(0, 7) : null)

const monthNumber = (ym: string) => Number(ym.slice(5, 7))
/** 'YYYY-MM' → "by January 2029" (Russian: the dative) */
const byMonth = (t: Translate, ym: string) => `${t(`${B}.value.byMonth.${monthNumber(ym)}`)} ${ym.slice(0, 4)}`
/** 'YYYY-MM' → "January 2029" after "instead of", "from" (Russian: the genitive) */
const ofMonth = (t: Translate, ym: string) => `${t(`dates.monthOf.${monthNumber(ym)}`)} ${ym.slice(0, 4)}`

const proposedOf = (impact: Impact): GoalShift | undefined => impact.goals.find(g => g.goalId === PROPOSED_ID)

/**
 * What the plan pays into the goal, in the base currency: with nearer goals ahead of it (takenAhead) the month it starts
 * and the amount a month then, else the amount alone (it starts at once). Null — no firstShare: it never gets money, or
 * the evaluation was stored before firstShare existed (then the card says no amount at all).
 */
function share(f: CardFormats, goal: GoalShift, base: string): { from: string | null; amount: string } | null {
  if (!goal.firstShare) return null
  return { from: goal.takenAhead ? ofMonth(f.t, goal.firstShare.month) : null, amount: f.money(goal.firstShare.perMonth, base) }
}

/**
 * A goal or saving proposal's own goal: "Renovation: by December 2027, $1,429 a month"; late — by the month it is reached
 * instead of the asked one; with nearer goals ahead, "…; the money goes to it from April 2028, $2,138 a month" (the plan's
 * firstShare; requiredMonthly, the even spread, is not printed); unreachable — said so. A saving is "The purchase". Null —
 * another kind, or the goal not weighed.
 */
export function proposedGoalLine(f: CardFormats, impact: Impact, base: string): string | null {
  const s = impact.scenario
  const goal = proposedOf(impact)
  const asked = scenarioMonth(s)
  if (!goal || asked === null) return null
  const name = s.kind === 'goal' ? s.name : f.t(`${B}.goal.purchase`)
  if (goal.statusAfter === 'unreachable' || goal.after === null) return f.t(`${B}.goal.unreachable`, { name })
  const text = goal.statusAfter === 'at_risk'
    ? f.t(`${B}.goal.late`, { name, by: byMonth(f.t, goal.after), asked: ofMonth(f.t, asked) })
    : f.t(`${B}.goal.onTrack`, { name, by: byMonth(f.t, asked) })
  const paid = share(f, goal, base)
  if (!paid) return text
  return paid.from === null ? f.t(`${B}.goal.amount`, { text, amount: paid.amount }) : f.t(`${B}.goal.from`, { text, ...paid })
}

const DATED: readonly Alternative['kind'][] = ['later_date', 'earlier_date', 'save_up']

/**
 * The recommended alternative in words: a later or an earlier date or a saving — its month and what the plan pays into it
 * (from when, with nearer goals ahead); the others — the payment share and the fund it leads to, each only when it differs
 * from now (sameDecimal).
 */
export function alternativeText(f: CardFormats, a: Alternative, base: string): string {
  const s = a.scenario
  const month = scenarioMonth(s)
  const head = f.t(`${B}.alternative.${a.kind}`, {
    amount: f.money(s.amount, s.currency),
    term: s.kind === 'credit' ? f.months(s.termMonths) : NONE,
    down: s.kind === 'credit' ? f.money(s.downPayment, s.currency) : NONE,
    month: month === null ? NONE : monthTitle(f.t, month),
    by: month === null ? NONE : byMonth(f.t, month),
  })
  const goal = DATED.includes(a.kind) ? proposedOf(a.impact) : undefined
  if (goal) {
    const paid = share(f, goal, base)
    if (!paid) return head
    const numbers = paid.from === null
      ? f.t(`${B}.alternative.monthly`, { amount: paid.amount })
      : f.t(`${B}.alternative.from`, paid)
    return f.t(`${B}.alternative.withNumbers`, { alternative: head, numbers })
  }
  const { now, after } = a.impact
  const numbers = [
    ...(sameDecimal(now.debtPaymentPct, after.debtPaymentPct) ? [] : [f.t(`${B}.alternative.share`, { share: f.pct(after.debtPaymentPct) })]),
    ...(sameDecimal(now.emergencyMonths, after.emergencyMonths) ? [] : [f.t(`${B}.alternative.fund`, { fund: f.fund(after.emergencyMonths) })]),
  ]
  return numbers.length ? f.t(`${B}.alternative.withNumbers`, { alternative: head, numbers: numbers.join(', ') }) : head
}
