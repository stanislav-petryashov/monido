// The council's Telegram messages rendered from the stored state: a voter's card, the author's status message and the
// one-off notices. Pure over the proposal's view (no database, no fetch), so the same state always gives the same text
// and buttons, in the family language of the moment: a delivery row is edited only when its render (renderHash) changes.
// Plain text (no parse_mode): the title, the question, the reason and the comments are people's and Claude's own text,
// stored cleaned, and go in as they are. Every number comes from the evaluation stored at sending.
import { sha256Hex } from '../../../server/secrets'
import type { Scenario } from '../../../domain/advisor'
import { type GoalShift, type Impact } from '../../../domain/advisorImpact'
import type { ProposalVersionView, ProposalView, ProposalVoteView } from '../../../domain/api'
import type { NumberChange, ScenarioChange } from '../../../domain/proposals'
import { formatNumber, type Translate } from '../../../i18n/core'
import { DEBT_NORM_PCT } from '../../../domain/health'
import { dayOfMonth, monthTitle } from '../../../i18n/dates'
import type { Language } from '../../../i18n/languages'
import type { InlineButton } from '../../../server/bot/telegram'
import {
  agreedVotes, alternativeText, goalMove, goalsUnknown, memberName, movingGoals, proposedGoalLine, previousVersion, recommendedOf, sameDecimal, sameMoney, shownChanges,
  type CardFormats,
} from '../cardLines'

/** What a render needs besides the state: the family's `t` and language, the site's address (null — no link), the time. */
export interface CardContext { t: Translate; lang: Language; appUrl: string | null; now: Date }

/** A delivery row as far as its render goes: which message, of which version, to whom. */
export interface MessageRow { kind: 'card' | 'status' | 'notice'; notice: string; version_id: number; user_id: number }

interface Rendered { text: string; buttons: InlineButton[][] }

// --- callback data: `v:<versionId>:<a|n|k|c>` and `w:<proposalId>`, far below Telegram's 64 bytes ----------------

type VoteAction = 'agree' | 'against' | 'keep' | 'cancel'
const ACTIONS = { a: 'agree', n: 'against', k: 'keep', c: 'cancel' } as const satisfies Record<string, VoteAction>

/** A press on a version: agree, against, keep the provisional vote without a comment, cancel it. */
export const voteData = (versionId: number, action: keyof typeof ACTIONS): string => `v:${versionId}:${action}`
export const withdrawData = (proposalId: number): string => `w:${proposalId}`

/** A positive whole id written exactly as `String(id)` writes it (no sign, no leading zero, nothing a number rounds). */
const idOf = (digits: string): number | null => {
  const id = Number(digits)
  return Number.isInteger(id) && id > 0 && String(id) === digits ? id : null
}

/** A button press of the council; null — someone else's data (a sign-in press) or nonsense. */
export function parseCallback(data: string):
  | { kind: 'vote'; versionId: number; action: VoteAction }
  | { kind: 'withdraw'; proposalId: number }
  | null {
  const vote = /^v:(\d{1,16}):([ankc])$/.exec(data)
  if (vote) {
    const versionId = idOf(vote[1])
    return versionId === null ? null : { kind: 'vote', versionId, action: ACTIONS[vote[2] as keyof typeof ACTIONS] }
  }
  const withdraw = /^w:(\d{1,16})$/.exec(data)
  const proposalId = withdraw ? idOf(withdraw[1]) : null
  return proposalId === null ? null : { kind: 'withdraw', proposalId }
}

/** sha256 of the text and the buttons: what a delivery row compares with what it last delivered. */
export function renderHash(text: string, buttons: InlineButton[][]): string {
  return sha256Hex(JSON.stringify([text, buttons]))
}

// --- formatting ---------------------------------------------------------------------------------------------------

const NONE = '—'
/** Telegram's longest message text, in UTF-16 code units */
const TEXT_MAX = 4096

/** `text` at most `max` code units long: cut with "…", never inside a surrogate pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const kept = text.slice(0, Math.max(0, max - 1))
  return `${/[\uD800-\uDBFF]$/.test(kept) ? kept.slice(0, -1) : kept}…`
}
const MARK = { agree: '✓', against: '✗', waiting: '⏳' } as const

/** The pieces of a render: `ctx`, and the money in a currency, a share and months in the family language. */
function formats(ctx: CardContext) {
  const { t, lang } = ctx
  const money = (v: number | null, currency: string) => (v === null ? NONE
    : new Intl.NumberFormat(lang, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v).replace('-', '−'))
  // months of the fund always keep one decimal: "5,0 → 4,7", not "5 → 4,7"
  const num = (v: number | null) => (v === null ? NONE : formatNumber(v, lang, 1, { fixed: true }))
  const pct = (v: number | null) => (v === null ? NONE : `${formatNumber(v, lang, 1)}%`)
  const rate = (v: number) => `${formatNumber(v, lang, 2)}%`
  const months = (n: number) => t('modules.advisor.bot.value.months', { n: formatNumber(n, lang, 0) })
  const date = (iso: string) => dayOfMonth(t, iso.slice(0, 10))
  const lines: CardFormats = { t, money, pct, fund: num, months }
  return { t, money, num, pct, rate, months, date, lines }
}
type Formats = ReturnType<typeof formats>

// --- the parts of a card ------------------------------------------------------------------------------------------

/** "Ryan ✓ · Annika ✗ · Mila ⏳", then "decide by …" while the proposal waits for votes; a deleted voter is left out. */
function votesLine(f: Formats, view: ProposalView, version: ProposalVersionView, { deadline }: { deadline: boolean }): string {
  const marks = version.votes.filter(v => v.member !== '').map(v => {
    const mark = !v.settled || v.vote === null ? MARK.waiting : MARK[v.vote]
    return `${v.member} ${mark}`
  })
  if (deadline) marks.push(f.t('modules.advisor.bot.card.decideBy', { date: f.date(view.deadlineAt) }))
  return marks.join(' · ')
}

function goalLine(f: Formats, g: GoalShift): string | null {
  const move = goalMove(g)
  return move && f.t(`modules.advisor.bot.numbers.${move.key}`, { name: g.name, month: g.after, months: move.months })
}

/**
 * One line each: the credit's payment, a goal or saving's own goal, then each of the payment share with its norm, money
 * left for living and the fund that reads differently now and after, and the goals that move.
 */
function numberLines(f: Formats, impact: Impact, base: string): string[] {
  const { t, money, num, pct } = f
  const lines: string[] = []
  if (impact.credit) lines.push(t('modules.advisor.bot.numbers.payment', { amount: money(impact.credit.payment, base) }))
  const goal = proposedGoalLine(f.lines, impact, base)
  if (goal) lines.push(goal)
  // a pair that reads the same on either card (cardLines.ts) is no change: left out
  const { now, after } = impact
  if (!sameDecimal(now.debtPaymentPct, after.debtPaymentPct)) {
    lines.push(t('modules.advisor.bot.numbers.debtShare', { now: pct(now.debtPaymentPct), after: pct(after.debtPaymentPct), norm: DEBT_NORM_PCT }))
  }
  if (!sameMoney(now.leftForLiving, after.leftForLiving, base)) {
    lines.push(t('modules.advisor.bot.numbers.left', { now: money(now.leftForLiving, base), after: money(after.leftForLiving, base) }))
  }
  if (!sameDecimal(now.emergencyMonths, after.emergencyMonths)) {
    lines.push(t('modules.advisor.bot.numbers.fund', { now: num(now.emergencyMonths), after: num(after.emergencyMonths) }))
  }
  const moves = movingGoals(impact).map(g => goalLine(f, g)).filter((m): m is string => m !== null)
  if (moves.length) lines.push(t('modules.advisor.bot.numbers.goals', { list: moves.join(', ') }))
  else lines.push(goalsUnknown(impact) ? t('modules.advisor.bot.numbers.goals', { list: NONE }) : t('modules.advisor.bot.numbers.noGoalMoves'))
  return lines
}

function assessmentLines(f: Formats, version: ProposalVersionView): string[] {
  const { verdict } = version
  const lines = [f.t('modules.advisor.bot.card.assessment', { risk: f.t(`modules.advisor.bot.risk.${verdict.risk}`), reason: verdict.reason })]
  const recommended = recommendedOf(version)
  if (recommended) lines.push(f.t('modules.advisor.bot.card.recommends', { alternative: alternativeText(f.lines, recommended, version.baseCurrency) }))
  return lines
}

/** A scenario field's value as the card shows it; money in the version's own scenario currency. */
function fieldValue(f: Formats, field: ScenarioChange['field'], value: string | number | null, scenario: Scenario): string {
  if (value === null) return NONE
  switch (field) {
    case 'amount':
    case 'downPayment': return f.money(Number(value), scenario.currency)
    case 'termMonths': return f.months(Number(value))
    case 'ratePct': return f.rate(Number(value))
    case 'kind': return f.t(`modules.advisor.bot.value.kind.${value}`)
    case 'loanType': return f.t(`modules.advisor.bot.value.loanType.${value}`)
    case 'targetMonth': return monthTitle(f.t, String(value))
    case 'targetDate': return f.t('modules.advisor.bot.value.date', { day: f.date(String(value)), year: String(value).slice(0, 4) })
    case 'goalId': return f.t('modules.advisor.bot.value.yes')
    case 'currency':
    case 'name': return String(value)
  }
}
function numberValue(f: Formats, key: NumberChange['key'], value: number | null, base: string): string {
  switch (key) {
    case 'debtPaymentPct': return f.pct(value)
    case 'emergencyMonths': return f.num(value)
    case 'payment':
    case 'leftForLiving':
    case 'savingsPerMonth': return f.money(value, base)
  }
}

/**
 * Version 2 and later: "Compared with version 1:", then "Term: 60 mo → 72 mo" for each changed parameter and each changed
 * key number the block below does not show; each version's money in its own base currency. A change that reads the same
 * on both sides (sameChange) is left out; nothing changed — no lines.
 */
function changeLines(f: Formats, view: ProposalView, version: ProposalVersionView): string[] {
  const previous = previousVersion(view, version) ?? version
  const was = (field: string, before: string, after: string) =>
    f.t('modules.advisor.bot.card.was', { field: f.t(`modules.advisor.bot.field.${field}`), before, after })
  const shown = shownChanges(version, previous)
  const lines = [
    ...shown.scenario.map(c => was(c.field, fieldValue(f, c.field, c.before, previous.scenario), fieldValue(f, c.field, c.after, version.scenario))),
    ...shown.numbers
      .map(c => was(c.key, numberValue(f, c.key, c.before, previous.baseCurrency), numberValue(f, c.key, c.after, version.baseCurrency))),
  ]
  return lines.length ? [f.t('modules.advisor.bot.card.changedSince', { number: previous.number }), ...lines] : []
}

// --- buttons ------------------------------------------------------------------------------------------------------

/** The proposal on the site's Advisor page. */
export const proposalLink = (appUrl: string, proposalId: number): string => `${appUrl.replace(/\/+$/, '')}/advisor#proposal-${proposalId}`

function detailsRow(f: Formats, ctx: CardContext, view: ProposalView): InlineButton[][] {
  if (!ctx.appUrl) return []
  return [[{ text: f.t('modules.advisor.bot.button.details'), url: proposalLink(ctx.appUrl, view.id) }]]
}

const voteRow = (f: Formats, versionId: number): InlineButton[] => [
  { text: f.t('modules.advisor.bot.button.agree'), data: voteData(versionId, 'a') },
  { text: f.t('modules.advisor.bot.button.against'), data: voteData(versionId, 'n') },
]
const withdrawRow = (f: Formats, view: ProposalView): InlineButton[] =>
  [{ text: f.t('modules.advisor.bot.button.withdraw'), data: withdrawData(view.id) }]

// --- the messages -------------------------------------------------------------------------------------------------

const sections = (...parts: (string | string[] | null)[]) =>
  parts.map(p => (Array.isArray(p) ? p.join('\n') : p)).filter((p): p is string => !!p).join('\n\n')

/** The version a row is about and whether it is still the proposal's current one. */
function versionOf(view: ProposalView, versionId: number): { version: ProposalVersionView; current: boolean } {
  const version = [view.current, ...view.previous].find(v => v.id === versionId) ?? view.current
  return { version, current: version.id === view.current.id }
}

const voteOf = (version: ProposalVersionView, userId: number): ProposalVoteView | undefined => version.votes.find(v => v.userId === userId)

function headline(f: Formats, view: ProposalView, version: ProposalVersionView): string {
  const author = memberName(f.t, view.author.member)
  return version.number > 1
    ? f.t('modules.advisor.bot.card.updated', { author, number: version.number, title: version.title })
    : f.t('modules.advisor.bot.card.title', { author, title: version.title })
}

/** A voter's card: the proposal, its numbers, Claude's word, the votes, and what the voter may press now. */
function card(f: Formats, ctx: CardContext, view: ProposalView, row: MessageRow): Rendered {
  const { version, current } = versionOf(view, row.version_id)
  if (!current) {
    return { text: sections(headline(f, view, version), f.t('modules.advisor.bot.card.replaced', { number: view.current.number })), buttons: [] }
  }
  const author = memberName(f.t, view.author.member)
  const open = view.status === 'open'
  const mine = voteOf(version, row.user_id)
  const provisional = open && mine?.vote != null && !mine.settled
  const prompt = provisional
    ? f.t('modules.advisor.bot.card.commentPrompt', { vote: f.t(`modules.advisor.bot.vote.${mine.vote}`), author })
    : null
  const state = view.status === 'open' ? null
    : view.status === 'revising' ? f.t('modules.advisor.bot.card.revising', { author })
      : f.t(`modules.advisor.bot.card.final.${view.status}`, { author })

  const text = sections(
    [headline(f, view, version), ...(prompt ? [prompt] : [])],
    version.question,
    version.number > 1 ? changeLines(f, view, version) : null,
    numberLines(f, version.evaluation.impact, version.baseCurrency),
    assessmentLines(f, version),
    [votesLine(f, view, version, { deadline: open }), ...(state ? [state] : [])],
  )

  let buttons: InlineButton[][] = []
  if (open && provisional) {
    buttons = [[
      { text: f.t('modules.advisor.bot.button.noComment'), data: voteData(version.id, 'k') },
      { text: f.t('modules.advisor.bot.button.cancel'), data: voteData(version.id, 'c') },
    ]]
  } else if (open && mine?.vote == null) {
    buttons = [voteRow(f, version.id), ...detailsRow(f, ctx, view)]
  } else if (open && mine?.vote === 'agree') {
    buttons = [[{ text: f.t('modules.advisor.bot.button.change'), data: voteData(version.id, 'n') }], ...detailsRow(f, ctx, view)]
  }
  return { text, buttons }
}

/**
 * `build(limit)`, a text with `count` comments each cut to `limit`: whole when it fits in TEXT_MAX, else with every comment
 * cut alike, so that the rest (the outcome, the way back to Claude) stays whole.
 */
function fitComments(build: (limit: number) => string, count: number): string {
  const full = build(Infinity)
  if (full.length <= TEXT_MAX || count === 0) return full
  // what the text takes with each comment down to its "…"
  const frame = build(0).length
  return build(Math.max(1, Math.floor((TEXT_MAX - frame) / count)))
}

const againstVotes = (version: ProposalVersionView) => version.votes.filter(v => v.settled && v.vote === 'against')

/** "Annika is against: “…”" for each settled against of the version, each comment cut to `limit`. */
const againstLines = (f: Formats, version: ProposalVersionView, limit: number): string[] =>
  againstVotes(version).map(v => (v.comment
    ? f.t('modules.advisor.bot.notice.against', { member: memberName(f.t, v.member), comment: cut(v.comment, limit) })
    : f.t('modules.advisor.bot.notice.againstNoComment', { member: memberName(f.t, v.member) })))
const againstComments = (version: ProposalVersionView) => againstVotes(version).filter(v => v.comment).length

/** "Annika: “…”" for each agree with a comment, each cut to `limit`. */
const agreeComments = (f: Formats, version: ProposalVersionView, limit: number): string[] =>
  agreedVotes(version).filter(v => v.comment).map(v => f.t('modules.advisor.bot.notice.comment', { member: v.member, comment: cut(v.comment ?? '', limit) }))

/** The author's status message: whom it went to and the votes, then the against and the way back, or the outcome. */
function status(f: Formats, ctx: CardContext, view: ProposalView, row: MessageRow): Rendered {
  const { version, current } = versionOf(view, row.version_id)
  if (!current) {
    return {
      text: sections(f.t('modules.advisor.bot.status.title', { title: version.title }), f.t('modules.advisor.bot.card.replaced', { number: view.current.number })),
      buttons: [],
    }
  }
  const votes = votesLine(f, view, version, { deadline: false })
  switch (view.status) {
    case 'open': {
      const others = version.votes.filter(v => v.userId !== view.author.userId && v.member !== '').map(v => v.member)
      return {
        text: sections(f.t('modules.advisor.bot.status.sent', { title: version.title, list: others.join(', '), date: f.date(view.deadlineAt) }), votes),
        buttons: [withdrawRow(f, view), ...detailsRow(f, ctx, view)],
      }
    }
    case 'revising':
      return {
        text: fitComments(limit => sections(
          f.t('modules.advisor.bot.status.title', { title: version.title }),
          votes,
          [...againstLines(f, version, limit), f.t('modules.advisor.bot.status.revising', { title: version.title })],
        ), againstComments(version)),
        buttons: [withdrawRow(f, view)],
      }
    default:
      // accepted: the comments too, as the voters' notice has them (the author gets no notice besides this message)
      return {
        text: fitComments(limit => sections(
          f.t(`modules.advisor.bot.status.final.${view.status}`, { title: version.title }),
          votes,
          view.status === 'accepted' ? agreeComments(f, version, limit) : null,
        ), view.status === 'accepted' ? agreedVotes(version).filter(v => v.comment).length : 0),
        buttons: [],
      }
  }
}

/** "Decided ✓ …, agreed: …" and every comment, each comment cut alike when all of them would not fit in one message. */
function acceptedText(f: Formats, version: ProposalVersionView): string {
  const agreed = agreedVotes(version)
  const head = f.t('modules.advisor.bot.notice.accepted', { title: version.title, list: agreed.map(v => v.member).join(', ') })
  return fitComments(limit => [head, ...agreeComments(f, version, limit)].join('\n'), agreed.filter(v => v.comment).length)
}

/** A one-off message, rendered once when it is sent: it is never edited, so its buttons are those that still apply then. */
function notice(f: Formats, ctx: CardContext, view: ProposalView, row: MessageRow): Rendered | null {
  const { version, current } = versionOf(view, row.version_id)
  const title = version.title
  const author = memberName(f.t, view.author.member)
  switch (row.notice) {
    case 'against':
      return {
        text: fitComments(limit => [...againstLines(f, version, limit), f.t('modules.advisor.bot.status.revising', { title })].join('\n'), againstComments(version)),
        buttons: current && view.status === 'revising' ? [withdrawRow(f, view)] : [],
      }
    case 'accepted':
      return { text: acceptedText(f, version), buttons: [] }
    case 'withdrawn':
      return { text: f.t('modules.advisor.bot.notice.withdrawn', { author, title }), buttons: [] }
    case 'expired':
      return { text: f.t('modules.advisor.bot.notice.expired', { title }), buttons: [] }
    case 'reminder': {
      // to the author of a proposal back with them, else to a voter who has not voted; a reminder retried after the
      // proposal moved on (decided, replaced, back with the author) or after the voter voted (settled or still in its
      // comment window) is stale: nothing is sent
      const date = f.date(view.deadlineAt)
      if (row.user_id === view.author.userId) {
        if (!current || view.status !== 'revising') return null
        return { text: f.t('modules.advisor.bot.notice.reminderAuthor', { title, date }), buttons: [withdrawRow(f, view)] }
      }
      if (!current || view.status !== 'open' || voteOf(version, row.user_id)?.vote != null) return null
      return {
        text: f.t('modules.advisor.bot.notice.reminder', { author, title, date }),
        buttons: [voteRow(f, version.id), ...detailsRow(f, ctx, view)],
      }
    }
    default:
      return null
  }
}

/**
 * The message a delivery row carries, from the proposal's state now, cut to Telegram's TEXT_MAX; null — a notice this
 * renderer does not know, or a reminder gone stale (nothing to send).
 */
export function renderMessage(row: MessageRow, view: ProposalView, ctx: CardContext): Rendered | null {
  const f = formats(ctx)
  const rendered = row.kind === 'card' ? card(f, ctx, view, row) : row.kind === 'status' ? status(f, ctx, view, row) : notice(f, ctx, view, row)
  return rendered && { text: cut(rendered.text, TEXT_MAX), buttons: rendered.buttons }
}
