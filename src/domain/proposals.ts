// The advisor's council, the pure part: the limits of people's and Claude's text, Claude's verdict on a proposal, the
// decision deadlines, the council settings, what changed between two versions and the outcome of the votes. No SQLite:
// the store (the server) writes and decides; these rules check its input and build its views.
import { ScenarioError, type Scenario } from './advisor'
import type { AlternativeKind, Evaluation, Impact, RiskLevel } from './advisorImpact'
import { round2, roundTo } from './fx'
import type { AdvisorSettings } from './api'

export type ProposalStatus = 'open' | 'revising' | 'accepted' | 'withdrawn' | 'expired'
export type VoteValue = 'agree' | 'against'

/** Claude's word on a proposal: the risk it names, the alternative it recommends (null — none) and a reason without numbers. */
export interface Verdict { risk: RiskLevel; recommended: AlternativeKind | null; reason: string }

// Lengths of the texts, in characters
/** A proposal's title */
export const TITLE_MAX = 80
/** The question put to the family */
export const QUESTION_MAX = 300
export const REASON_MAX = 200
/** A voter's comment */
export const COMMENT_MAX = 500
/** After a vote in Telegram, how long the bot waits for a comment before the vote is settled without one */
export const COMMENT_WINDOW_MS = 600_000
/** How long a comment sent after the window is still answered with "add it on the site" */
export const LATE_COMMENT_MS = 3_600_000
export const DEFAULT_DECIDE_DAYS = 14
export const DEFAULT_REMIND_DAYS = 3

const DAY_MS = 86_400_000
const MAX_DECIDE_DAYS = 60

/** Format characters (zero-width, bidirectional overrides), lone surrogates and the control characters that are not whitespace */
// Stryker disable next-line Regex: its mutant turns \v into \V, which a u-flag regex rejects, so the module would not load
const STRIPPED = /[\p{Cf}\p{Cs}]|(?![\t\n\v\f\r])\p{Cc}/gu

/** Removes what `cleanText` strips and settles the whitespace: one line, or lines kept with tabs as spaces. */
function settle(value: string, multiline: boolean): string {
  const text = value.replace(STRIPPED, '')
  if (!multiline) return text.replace(/\s+/gu, ' ').trim()
  return text.replace(/\r\n?|[\p{Zl}\p{Zp}]/gu, '\n').replace(/[\t\v\f]/g, ' ').trim()
}

/**
 * A person's or Claude's text made safe to store and show: without format characters, lone surrogates and control
 * characters, trimmed, cut at `max` characters (a character outside the BMP counts as one and is never split). A single-line
 * text (a title, a reason) turns every run of whitespace, line breaks included, into one space; `multiline` (a question, a
 * comment) keeps the line breaks (any line separator becomes a newline) and turns tabs into spaces. Null for a value that is
 * not a string or leaves nothing.
 */
export function cleanText(value: unknown, max: number, { multiline = false }: { multiline?: boolean } = {}): string | null {
  if (typeof value !== 'string') return null
  const text = Array.from(settle(value, multiline)).slice(0, max).join('').trimEnd()
  return text === '' ? null : text
}

/**
 * The card's numbers come only from the server: Claude's own text on it (the title, the question, the reason) that carries
 * a number, a percent or a currency sign is refused (`has_numbers`). Any numeric character counts, of any script (a digit,
 * a fraction, a superscript).
 */
export function validateCardText(text: string): 'ok' | 'has_numbers' {
  return /[\p{N}%٪‰﹪％\p{Sc}]/u.test(text) ? 'has_numbers' : 'ok'
}

const RISK_ORDER: readonly RiskLevel[] = ['ok', 'caution', 'risky']

/**
 * Checks Claude's verdict against the server's evaluation. `risk` is the computed one or one step more cautious; an
 * evaluation that cannot weigh the scenario (`unknown`) cannot be proposed. `recommended` is null (or left out) or one of
 * the evaluation's alternatives. `reason` is one line, cleaned, at most REASON_MAX characters (a longer one is refused, not
 * cut, so that Claude shortens it) and holds no numbers. Throws `ScenarioError`.
 */
export function parseVerdict(body: unknown, evaluation: Evaluation): Verdict {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  if (b.risk === undefined || b.risk === null) throw new ScenarioError('missing_param', 'risk')
  const computed = RISK_ORDER.indexOf(evaluation.impact.risk)
  const given = RISK_ORDER.indexOf(b.risk as RiskLevel)
  const risk = RISK_ORDER[given]
  if (computed < 0 || risk === undefined || given < computed || given > computed + 1) throw new ScenarioError('invalid_param', 'risk')

  const recommended = b.recommended ?? null
  if (recommended !== null && !evaluation.alternatives.some(a => a.kind === recommended)) throw new ScenarioError('invalid_param', 'recommended')

  if (b.reason === undefined || b.reason === null) throw new ScenarioError('missing_param', 'reason')
  if (typeof b.reason !== 'string') throw new ScenarioError('invalid_param', 'reason')
  const reason = cleanText(b.reason, Infinity)
  if (reason === null) throw new ScenarioError('missing_param', 'reason')
  if (Array.from(reason).length > REASON_MAX) throw new ScenarioError('invalid_param', 'reason')
  if (validateCardText(reason) !== 'ok') throw new ScenarioError('invalid_param', 'reason')

  return { risk, recommended: recommended as AlternativeKind | null, reason }
}

/** The decision deadline: `decideDays` whole days after `from`, ISO. */
export const deadlineAfter = (from: Date, decideDays: number): string => new Date(from.getTime() + decideDays * DAY_MS).toISOString()

/** When the reminder goes: `remindDays` before the deadline, ISO; null — reminders are off. */
export const remindAt = (deadline: string, remindDays: number | null): string | null =>
  remindDays === null ? null : new Date(Date.parse(deadline) - remindDays * DAY_MS).toISOString()

const isIntIn = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max

/**
 * The council settings from a request: `decideDays` an integer 1–60, `remindDays` null (no reminder) or an integer 1–59
 * below `decideDays` (a reminder on the deadline day would come too late). Throws `ScenarioError('invalid_param')`.
 */
export function parseSettings(body: unknown): AdvisorSettings {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!isIntIn(b.decideDays, 1, MAX_DECIDE_DAYS)) throw new ScenarioError('invalid_param', 'decideDays')
  const { decideDays, remindDays } = b
  if (remindDays !== null && !(isIntIn(remindDays, 1, MAX_DECIDE_DAYS - 1) && remindDays < decideDays)) {
    throw new ScenarioError('invalid_param', 'remindDays')
  }
  return { decideDays, remindDays }
}

export interface ScenarioChange {
  field: 'kind' | 'amount' | 'currency' | 'termMonths' | 'ratePct' | 'downPayment' | 'loanType' | 'targetMonth' | 'targetDate' | 'name' | 'goalId'
  before: string | number | null
  after: string | number | null
}
const SCENARIO_FIELDS: readonly ScenarioChange['field'][] = [
  'kind', 'amount', 'currency', 'termMonths', 'ratePct', 'downPayment', 'loanType', 'targetMonth', 'targetDate', 'name', 'goalId',
]

/** The fields of the scenario that differ between two versions, in a fixed order; a field one side lacks is null there. */
export function scenarioChanges(before: Scenario, after: Scenario): ScenarioChange[] {
  const value = (s: Scenario, f: ScenarioChange['field']) => ((s as Record<string, unknown>)[f] ?? null) as string | number | null
  return SCENARIO_FIELDS
    .map(field => ({ field, before: value(before, field), after: value(after, field) }))
    .filter(c => c.before !== c.after)
}

export interface NumberChange {
  key: 'payment' | 'debtPaymentPct' | 'leftForLiving' | 'emergencyMonths' | 'savingsPerMonth'
  before: number | null
  after: number | null
}
/** Each compared number and the precision it is shown with: money to the cent, a share and months to one decimal. */
const NUMBER_KEYS: readonly [NumberChange['key'], (v: number) => number][] = [
  ['payment', round2], ['debtPaymentPct', v => roundTo(v, 1)], ['leftForLiving', round2],
  ['emergencyMonths', v => roundTo(v, 1)], ['savingsPerMonth', round2],
]

/** The key numbers "after" that changed between two versions: the credit payment and the rest of `after`, compared as shown. */
export function numberChanges(before: Impact, after: Impact): NumberChange[] {
  const value = (i: Impact, key: NumberChange['key']) => (key === 'payment' ? i.credit?.payment ?? null : i.after[key])
  return NUMBER_KEYS
    .map(([key, round]) => ({ key, before: value(before, key), after: value(after, key), round }))
    .filter(c => (c.before === null ? null : c.round(c.before)) !== (c.after === null ? null : c.round(c.after)))
    .map(({ key, before: b, after: a }) => ({ key, before: b, after: a }))
}

interface VoteState { userId: number; vote: VoteValue; settled: boolean }

/** Every voter in order with their vote (null — none yet) and whether it is settled; `member` is '' for a user no longer known. */
export function voteSummary(voters: readonly number[], votes: readonly VoteState[], members: Record<number, string>) {
  return voters.map(userId => {
    const v = votes.find(x => x.userId === userId)
    return { userId, member: members[userId] ?? '', vote: v?.vote ?? null, settled: v?.settled ?? false }
  })
}
