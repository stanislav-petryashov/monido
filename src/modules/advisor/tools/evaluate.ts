import { advisorContext, parseScenario, ScenarioError, type Scenario } from '../../../domain/advisor'
import { evaluate } from '../../../domain/advisorImpact'
import { MAX_TERM_MONTHS } from '../../../domain/loans'
import { InputError } from '../../../server/http'
import { ANSWER_RULES } from '../guide'
import { bodyOf } from '../input'
import { advisorSnapshot, todayRates } from './snapshot'
import type { AdvisorTool, ToolContext } from './registry'

/**
 * Weighs the scenario against the family with today's rates: the parsed scenario, the family currency and the evaluation;
 * a bad or incomplete scenario is 400 `missing_param` / `invalid_param` naming the parameter. The evaluate tools answer it,
 * and a proposal stores it (./proposals.ts).
 */
export async function weighScenario(ctx: ToolContext, parse: (today: Date) => Scenario) {
  let scenario: Scenario
  try { scenario = parse(ctx.now) } catch (err) {
    if (err instanceof ScenarioError) throw new InputError(err.code, 400, { param: err.param })
    throw err
  }
  const snapshot = await advisorSnapshot(ctx)
  const rates = await todayRates(ctx, [snapshot.baseCurrency, scenario.currency])
  return { scenario, baseCurrency: snapshot.baseCurrency, evaluation: evaluate(advisorContext(snapshot, ctx.now), scenario, rates) }
}

/** What the evaluate tools answer: the family currency, the evaluation and the rules of the answer Claude writes from it */
async function weigh(ctx: ToolContext, parse: (today: Date) => Scenario) {
  const { baseCurrency, evaluation } = await weighScenario(ctx, parse)
  return { baseCurrency, evaluation, answerRules: ANSWER_RULES }
}

const CURRENCY = { type: 'string', pattern: '^[A-Z]{3}$', description: 'ISO 4217 code of the amount, three capital letters, e.g. USD' }

const PURCHASE_PROPERTIES = {
  kind: { type: 'string', enum: ['buy_now', 'credit', 'save_up'] },
  amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e9, description: 'The price, in `currency`' },
  currency: CURRENCY,
  goalId: { type: 'string', description: 'buy_now only: the id of the goal the money was put aside for (from get_family_overview)' },
  termMonths: { type: 'integer', minimum: 1, maximum: MAX_TERM_MONTHS, description: 'credit: the term in months' },
  ratePct: { type: 'number', minimum: 0, maximum: 100, description: 'credit: the yearly interest rate, %' },
  downPayment: { type: 'number', minimum: 0, description: 'credit: paid at once, in `currency`, below the amount' },
  loanType: { type: 'string', enum: ['consumer', 'mortgage'], description: 'credit: the kind of loan' },
  targetMonth: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'save_up: the month the money is needed, YYYY-MM' },
}

const GOAL_PROPERTIES = {
  name: { type: 'string', minLength: 1, maxLength: 60, description: 'The goal\'s name' },
  amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e9, description: 'The target sum, in `currency`' },
  currency: CURRENCY,
  targetDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The day the money is needed, YYYY-MM-DD, not in the past' },
}

/** A scenario as either evaluate tool takes it, `kind` telling which: what a proposal sends (./proposals.ts). */
export const SCENARIO_SCHEMA = {
  type: 'object',
  properties: {
    ...PURCHASE_PROPERTIES,
    kind: { type: 'string', enum: ['buy_now', 'credit', 'save_up', 'goal'], description: 'goal: a new savings goal, as evaluate_goal weighs it' },
    amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e9, description: 'The price or the goal\'s target sum, in `currency`' },
    name: { ...GOAL_PROPERTIES.name, description: 'goal: the goal\'s name' },
    targetDate: { ...GOAL_PROPERTIES.targetDate, description: 'goal: the day the money is needed, YYYY-MM-DD, not in the past' },
  },
  required: ['kind', 'amount', 'currency'],
  additionalProperties: false,
}

export const evaluatePurchase: AdvisorTool = {
  name: 'evaluate_purchase',
  description: 'Weighs a purchase against the family\'s real numbers: what it does to the savings, what is left for living, the loan payment share, the emergency fund and the goals, the stress test, the risk and up to three alternatives. Required by kind: buy_now (own money) — amount, currency; optional goalId when the money was put aside for that goal. credit — amount, currency, termMonths, ratePct, downPayment (in the same currency, below the amount; 0 for none) and loanType. save_up — amount, currency, targetMonth (YYYY-MM, after this month); its goals entry `proposed` carries requiredMonthly, firstShare and, when nearer goals take savings ahead of it, takenAhead, as in evaluate_goal. A missing required field answers 400 missing_param naming it: ask the family for it, never guess. Every figure is computed by the server in the family currency. Follow answerRules in your answer.',
  inputSchema: {
    type: 'object',
    properties: PURCHASE_PROPERTIES,
    required: ['kind', 'amount', 'currency'],
    additionalProperties: false,
  },
  right: null,
  run: (ctx, input) => weigh(ctx, today => {
    // a new goal has its own tool: refused before the parse, so a goal missing its name is not told to supply one; any other kind outside the three is parseScenario's invalid_param
    if (bodyOf(input).kind === 'goal') throw new ScenarioError('invalid_param', 'kind')
    return parseScenario(input, today)
  }),
}

export const evaluateGoal: AdvisorTool = {
  name: 'evaluate_goal',
  description: 'Weighs a new savings goal against the family\'s real numbers: the monthly contribution it needs, which existing goals move and by how many months, the risk and, when it is out of reach, a later date — or, when no later one within thirty years fits, the nearest earlier date that does. The goals entry `proposed` is the new goal: requiredMonthly is the contribution it needs a month, an even spread from next month to its date, in the family currency; firstShare is what the plan actually pays into it: the first month it gets money (month, YYYY-MM) and what it gets a month then (perMonth; null — it never gets any) — say when money starts and how much with it, and call requiredMonthly only the even spread, never "requiredMonthly a month from that month"; takenAhead, whenever goals with a nearer or the same deadline take savings ahead of it, is what the goals with a nearer or the same deadline (existing goals first) take a month now (perMonth) and the month the last of them is reached (untilMonth; null — one of them is never reached) — the savings go to the nearest deadline first, and a reached goal\'s share passes to the next ones. The financial-independence goal\'s month includes the family\'s expected return a year (expectedReturnPct in get_family_overview; 8% unless the family set its own) on what it holds; it stops taking savings that month, so a goal after it is funded from then. A later or earlier date keeps every goal that is on track on track; it may move a goal that is already late, and lists that move. All four fields are required; a missing one answers 400 missing_param naming it. Follow answerRules in your answer.',
  inputSchema: {
    type: 'object',
    properties: GOAL_PROPERTIES,
    required: ['name', 'amount', 'currency', 'targetDate'],
    additionalProperties: false,
  },
  right: null,
  run: (ctx, input) => weigh(ctx, today => {
    const { name, amount, currency, targetDate } = bodyOf(input)
    return parseScenario({ kind: 'goal', name, amount, currency, targetDate }, today)
  }),
}
