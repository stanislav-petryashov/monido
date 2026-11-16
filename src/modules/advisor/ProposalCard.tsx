// One proposal on the Advisor page: its status, the current version (the question, what changed since the previous one,
// the numbers "now → after", Claude's assessment, the votes), the deadline or the decision, what the signed-in person may
// do with it, and the earlier versions behind a toggle (an accepted proposal's goal is its history row's: CreateGoalDialog.tsx).
// Every number is the server's, stored at sending, in the version's own base currency; the texts the Telegram card shares
// are its keys (`modules.advisor.bot.*`).
import { createElement, useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconHourglass, IconX } from '@tabler/icons-react'
import { Card } from '../../components/ui/Card'
import { Disclosure } from '../../components/ui/Disclosure'
import { Chip } from '../../components/ui/Chip'
import type { SemanticColor } from '../../components/ui/types'
import type { Scenario } from '../../domain/advisor'
import { type GoalShift, type Impact } from '../../domain/advisorImpact'
import type { ProposalVersionView, ProposalView, ProposalVoteView } from '../../domain/api'
import { COMMENT_MAX, type NumberChange, type ProposalStatus, type ScenarioChange, type VoteValue } from '../../domain/proposals'
import { useAuth } from '../../lib/authState'
import { fmtDayNumeric, fmtInMonth, fmtMoney, fmtMonth, fmtMonths, fmtNum, fmtPct } from '../../lib/formatters'
import { useConfirm, useToast } from '../../lib/notifyState'
import { PRIVACY_MASK, usePrivacy } from '../../lib/privacy'
import { DEBT_NORM_PCT } from '../../domain/health'
import { Field } from '../../pages/admin/ui/Field'
import { FormDialog } from '../../pages/admin/ui/FormDialog'
import {
  alternativeText, goalMove, goalsUnknown, memberName, movingGoals, previousVersion, proposedGoalLine, recommendedOf, sameDecimal, sameMoney, shownChanges,
  type CardFormats,
} from './cardLines'
import { useAddComment, useVote, useWithdraw } from './useProposals'

const P = 'modules.advisor.proposals'
const B = 'modules.advisor.bot'
const NONE = '—'
/** The site's vote marks (the Telegram text keeps ✓ ✗ ⏳), each with its word for screen readers */
const MARK = { agree: IconCheck, against: IconX, waiting: IconHourglass } as const
/** A vote as the list marks it: only a counted vote is shown as given */
const MARK_PROPS = { size: 16, stroke: 2, 'aria-hidden': true, className: 'proposal-votes__mark' } as const
const markOf = (v: ProposalVoteView): keyof typeof MARK => (v.settled && v.vote !== null ? v.vote : 'waiting')
/** The last word joined to the one before it by a no-break space: a unit never wraps alone onto the next line ("+3 mo"). */
const keepLastWord = (text: string) => text.replace(/ (?=\S+$)/, '\u00a0')

/**
 * After a write whose button is gone (a vote, Withdraw): the focus goes to the proposal's card, or to its history row
 * once it has moved there. The new state may be drawn a frame or more later: while the element focused leaves the page
 * (the old card), it tries again on the next frame, for half a second at most.
 */
function focusProposal(id: number, frame = 0): void {
  requestAnimationFrame(() => {
    const target = document.getElementById(`proposal-${id}`) ?? document.getElementById(`proposal-row-${id}`)
    target?.focus()
    if (frame < 30) requestAnimationFrame(() => { if (!target?.isConnected || document.activeElement === document.body) focusProposal(id, frame + 1) })
  })
}

/** A status is an assessment: revising needs the author, accepted is good, the rest are neutral. */
const STATUS_COLOR: Record<ProposalStatus, SemanticColor> = {
  open: 'secondary', revising: 'warning', accepted: 'success', withdrawn: 'secondary', expired: 'secondary',
}

/** The value formats of a card: money in a currency (masked in privacy mode), "now → after" pairs, scenario fields. */
function useFormats() {
  const { t } = useTranslation()
  const { hidden } = usePrivacy()
  const money = (v: number | null, currency: string) => (v === null ? NONE : hidden ? PRIVACY_MASK : `${fmtMoney(v)} ${currency}`)
  const months = (n: number) => t(`${B}.value.months`, { count: n, n: fmtNum(n, 0) })
  const lines: CardFormats = { t, money, pct: v => fmtPct(v), fund: v => fmtNum(v, 1, { fixed: true }), months }

  function field(f: ScenarioChange['field'], value: string | number | null, scenario: Scenario): string {
    if (value === null) return NONE
    switch (f) {
      case 'amount':
      case 'downPayment': return money(Number(value), scenario.currency)
      case 'termMonths': return months(Number(value))
      case 'ratePct': return fmtPct(Number(value), { digits: 2 })
      case 'kind': return t(`${B}.value.kind.${value}`)
      case 'loanType': return t(`${B}.value.loanType.${value}`)
      case 'targetMonth': return fmtMonth(String(value))
      case 'targetDate': return fmtDayNumeric(String(value))
      case 'goalId': return t(`${B}.value.yes`)
      case 'currency':
      case 'name': return String(value)
    }
  }
  function number(key: NumberChange['key'], value: number | null, currency: string): string {
    switch (key) {
      case 'debtPaymentPct': return fmtPct(value)
      case 'emergencyMonths': return fmtMonths(value, { fixed: true })
      case 'payment':
      case 'leftForLiving':
      case 'savingsPerMonth': return money(value, currency)
    }
  }
  return { t, money, field, number, lines }
}
type Formats = ReturnType<typeof useFormats>

/** A heading and the block it names (a list, the numbers), tied by aria-labelledby. */
function Titled({ title, hint, children }: { title: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <>
      <h4 className="proposal__subhead"><span id={id}>{title}</span>{hint}</h4>
      {children(id)}
    </>
  )
}

function goalLine(f: Formats, g: GoalShift): string | null {
  const move = goalMove(g)
  if (!move) return null
  if (move.key === 'goalBy') return f.t(`${P}.goalBy`, { name: g.name, inMonth: fmtInMonth(g.after!), year: g.after!.slice(0, 4) })
  return f.t(`${B}.numbers.${move.key}`, { name: g.name, count: move.months, months: fmtNum(move.months, 0) })
}

/**
 * The payment, then each of the payment share with its norm, money left for living and the fund that reads differently now
 * and after (as on the Telegram card: with no loan the share stays as it is and is left out), the goals that move.
 */
function Numbers({ impact, currency }: { impact: Impact; currency: string }) {
  const f = useFormats()
  const { t } = f
  const moves = movingGoals(impact).map(g => goalLine(f, g)).filter((m): m is string => m !== null).map(keepLastWord)
  const { now, after } = impact
  // a pair that reads the same on either card (cardLines.ts) is no change: left out
  const comparisons = [
    ...(sameDecimal(now.debtPaymentPct, after.debtPaymentPct) ? [] : [{
      label: t(`${B}.field.debtPaymentPct`), now: fmtPct(now.debtPaymentPct), after: fmtPct(after.debtPaymentPct),
      note: t(`${P}.norm`, { norm: fmtPct(DEBT_NORM_PCT) }),
    }]),
    ...(sameMoney(now.leftForLiving, after.leftForLiving, currency) ? [] : [{
      label: t(`${B}.field.leftForLiving`), now: f.money(now.leftForLiving, currency), after: f.money(after.leftForLiving, currency),
    }]),
    ...(sameDecimal(now.emergencyMonths, after.emergencyMonths) ? [] : [{
      label: t(`${B}.field.emergencyMonths`), now: fmtMonths(now.emergencyMonths, { fixed: true }), after: fmtMonths(after.emergencyMonths, { fixed: true }),
    }]),
  ]
  return <Titled title={t(`${P}.numbers`)}>{id => <div className="proposal-impact" role="group" aria-labelledby={id}>
    {impact.credit && <dl className="proposal-impact__single proposal-impact__payment"><dt>{t(`${B}.field.payment`)}</dt><dd>{f.money(impact.credit.payment, currency)}</dd></dl>}
    {comparisons.length > 0 && <table className="proposal-comparison" aria-labelledby={id}>
      <thead><tr><th scope="col">{t(`${P}.indicator`)}</th><th scope="col">{t(`${P}.now`)}</th><th scope="col">{t(`${P}.after`)}</th></tr></thead>
      <tbody>{comparisons.map(row => <tr key={row.label}>
        <th scope="row">{row.label}{'note' in row && <span className="proposal__norm">{row.note}</span>}</th>
        <td><span className="proposal-comparison__label" aria-hidden="true">{t(`${P}.now`)}</span>{row.now}</td>
        <td><span className="proposal-comparison__label" aria-hidden="true">{t(`${P}.after`)}</span>{row.after}</td>
      </tr>)}</tbody>
    </table>}
    <dl className="proposal-impact__single"><dt>{t(`${P}.goals`)}</dt><dd>{moves.length ? moves.join(', ') : goalsUnknown(impact) ? NONE : t(`${B}.numbers.noGoalMoves`)}</dd></dl>
  </div>}</Titled>
}

/**
 * Version 2 and later: "Compared with version 1:" and a "was → now" line per changed parameter and number; one that
 * reads the same on both sides (sameChange, as on the Telegram card) is left out.
 */
function Changes({ view, version }: { view: ProposalView; version: ProposalVersionView }) {
  const f = useFormats()
  const { t } = f
  const previous = previousVersion(view, version)
  if (!previous) return null
  const shown = shownChanges(version, previous)
  const lines = [
    ...shown.scenario
      .map(c => t(`${B}.card.was`, {
        field: t(`${B}.field.${c.field}`), before: f.field(c.field, c.before, previous.scenario), after: f.field(c.field, c.after, version.scenario),
      })),
    ...shown.numbers
      .map(c => t(`${B}.card.was`, {
        field: t(`${B}.field.${c.key}`), before: f.number(c.key, c.before, previous.baseCurrency), after: f.number(c.key, c.after, version.baseCurrency),
      })),
  ]
  if (lines.length === 0) return null
  return (
    <Titled title={t(`${B}.card.changedSince`, { number: previous.number })}>
      {id => <ul aria-labelledby={id} className="advisor-list">{lines.map(line => <li key={line}>{line}</li>)}</ul>}
    </Titled>
  )
}

/**
 * "Ryan ✓", "Annika ✗ “comment”", "Mila ⏳"; a deleted voter is left out. One's own vote still in the bot's comment window
 * shows as given and "not counted yet" (another's shows as not voted: only a counted vote is shown as given).
 * `live`: the current version of an open proposal — only there can one's own provisional vote still be settled.
 */
function Votes({ votes, live }: { votes: ProposalVoteView[]; live: boolean }) {
  const { t } = useTranslation()
  const me = useAuth().me?.name ?? null
  const members = votes.filter(v => v.member !== '')
  return (
    <Titled title={t(`${P}.votes`)} hint={<span className="proposal-votes__tally">{t(`${P}.responded`, { answered: fmtNum(members.filter(v => v.settled && v.vote !== null).length, 0), total: fmtNum(members.length, 0) })}</span>}>
      {id => (
        <ul aria-labelledby={id} className="proposal-votes">
          {members.map(v => {
            const pending = live && !v.settled && v.vote !== null && v.member === me
            const mark = pending && v.vote !== null ? v.vote : markOf(v)
            return (
              <li key={v.userId} className="proposal-votes__item">
                <span className="proposal-votes__who">{v.member}</span>{' '}
                {createElement(MARK[mark], MARK_PROPS)}
                <span className="proposal-votes__state">{t(`${P}.mark.${mark}`)}</span>
                {pending && <>{' '}<span className="proposal-votes__date">{t(`${P}.mark.pending`)}</span></>}
                {v.settled && v.votedAt && <>{' '}<span className="proposal-votes__date">{fmtDayNumeric(v.votedAt)}</span></>}
                {v.settled && v.comment && <>{' '}<span className="proposal-votes__comment">{t(`${P}.quote`, { comment: v.comment })}</span></>}
              </li>
            )
          })}
        </ul>
      )}
    </Titled>
  )
}

/** A version as it was sent: the question, the changes, the numbers, Claude's assessment and the votes. */
function VersionBody({ view, version, decision }: { view: ProposalView; version: ProposalVersionView; decision?: ReactNode }) {
  const f = useFormats()
  const { t } = f
  const recommended = recommendedOf(version)
  const goal = proposedGoalLine(f.lines, version.evaluation.impact, version.baseCurrency)
  return (
    <>
      <p className="proposal__question">{version.question}</p>
      <div className="proposal-layout"><div className="proposal-layout__impact">
      <Numbers impact={version.evaluation.impact} currency={version.baseCurrency} />
      <Disclosure variant="row" title={t(`${P}.details`)} titleAs="h4">
        {version.number > 1 && <Changes view={view} version={version} />}
        {goal && <p className="proposal__text">{goal}</p>}
        <p className="proposal__text">{t(`${B}.card.assessment`, { risk: t(`${B}.risk.${version.verdict.risk}`), reason: version.verdict.reason })}</p>
        {recommended && <p className="proposal__text">{t(`${B}.card.recommends`, { alternative: alternativeText(f.lines, recommended, version.baseCurrency) })}</p>}
      </Disclosure>
      </div><div className="proposal-decide">
      <Votes votes={version.votes} live={view.status === 'open' && version.id === view.current.id} />
      {decision}
      </div></div>
    </>
  )
}

/** An earlier version, read-only. */
function EarlierVersion({ view, version }: { view: ProposalView; version: ProposalVersionView }) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <section aria-labelledby={id} className="proposal__earlier">
      <h4 id={id} className="proposal__subhead">{t(`${P}.version`, { number: version.number })}</h4>
      <VersionBody view={view} version={version} />
    </section>
  )
}

type VoteMode = VoteValue | 'comment'

/** Agree or Against with an optional comment, or a comment on one's own agree: the vote button, as in the bot. */
function VoteDialog({ proposal, mode, onDone }: { proposal: ProposalView; mode: VoteMode; onDone: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const vote = useVote()
  const addComment = useAddComment()
  const [text, setText] = useState('')
  const title = proposal.current.title
  const author = proposal.author.member

  async function submit(): Promise<boolean> {
    const comment = text.trim()
    let request: Promise<unknown>
    if (mode === 'comment') {
      if (!comment) { toast.error(t(`${P}.commentFailed`), t(`${P}.needComment`)); return false }
      request = addComment.mutateAsync({ id: proposal.id, comment, versionId: proposal.current.id })
    } else {
      request = vote.mutateAsync({ id: proposal.id, vote: mode, versionId: proposal.current.id, ...(comment ? { comment } : {}) })
    }
    const done = await request.then(() => true, () => false)
    if (done) { onDone(); focusProposal(proposal.id) }
    return done
  }

  const texts = mode === 'comment'
    ? { title: t(`${P}.commentTitle`, { title }), text: t(`${P}.commentText`, { author }), submit: t(`${P}.saveComment`), field: t(`${P}.commentField`) }
    : { title: t(`${P}.${mode}Title`, { title }), text: t(`${P}.${mode}Text`, { author }), submit: t(`${B}.button.${mode}`), field: t(`${P}.comment`) }
  return (
    <FormDialog title={texts.title} description={texts.text} submitLabel={texts.submit} onSubmit={submit} onCancel={onDone}>
      <div className="form-stack">
        <Field label={texts.field}>
          <textarea className="admin-input proposal-comment" rows={4} maxLength={COMMENT_MAX} value={text} onChange={e => setText(e.target.value)} />
        </Field>
      </div>
    </FormDialog>
  )
}

/** What the signed-in person may do: vote, change an agree or comment on a counted one, withdraw their own. */
function Actions({ proposal }: { proposal: ProposalView }) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const withdraw = useWithdraw()
  const [dialog, setDialog] = useState<VoteMode | null>(null)
  const { status, you } = proposal
  const open = status === 'open'
  // only the open current version takes votes; the author's agree is given at sending
  const voter = open && you.voter && !you.author
  const agreed = you.vote === 'agree'
  const author = you.author && (open || status === 'revising')

  async function askWithdraw() {
    const yes = await confirm({
      title: t(`${P}.withdrawTitle`, { title: proposal.current.title }),
      text: t(`${P}.withdrawText`),
      confirmLabel: t(`${B}.button.withdraw`),
      tone: 'warning',
    })
    if (yes) withdraw.mutate(proposal.id, { onSuccess: () => focusProposal(proposal.id) })
  }

  const buttons = [
    ...(voter && !agreed ? [
      <button key="agree" type="button" className="btn btn--primary" onClick={() => setDialog('agree')}>{t(`${B}.button.agree`)}</button>,
      <button key="against" type="button" className="btn btn--ghost" onClick={() => setDialog('against')}>{t(`${B}.button.against`)}</button>,
    ] : []),
    ...(voter && agreed ? [
      <button key="change" type="button" className="btn btn--ghost" onClick={() => setDialog('against')}>{t(`${B}.button.change`)}</button>,
    ] : []),
    // a comment goes on a counted agree only: while the bot's comment window is open, the comment is written there
    ...(voter && agreed && you.settled ? [
      <button key="comment" type="button" className="btn btn--ghost" onClick={() => setDialog('comment')}>{t(`${P}.addComment`)}</button>,
    ] : []),
    ...(author ? [
      <button key="withdraw" type="button" className="btn btn--ghost" aria-disabled={withdraw.isPending || undefined} onClick={() => { if (!withdraw.isPending) void askWithdraw() }}>{t(`${B}.button.withdraw`)}</button>,
    ] : []),
  ]
  // an open proposal with no buttons for a member who neither votes on it nor sent it: one line why
  const outsider = open && !you.voter && !you.author
  return (
    <>
      {outsider && <p className="proposal__text">{t(`${B}.answer.notVoter`)}</p>}
      {buttons.length > 0 && <div className="form-actions form-actions--start">{buttons}</div>}
      {dialog !== null && <VoteDialog proposal={proposal} mode={dialog} onDone={() => setDialog(null)} />}
    </>
  )
}

/** A proposal's card; `id="proposal-<id>"` is where the Telegram card's "Details on the site" lands (it takes the focus). */
export function ProposalCard({ proposal }: { proposal: ProposalView }) {
  const { t } = useTranslation()
  const titleId = useId()
  const earlierId = useId()
  const [earlier, setEarlier] = useState(false)
  const { current, status } = proposal
  const author = memberName(t, proposal.author.member)
  // the deadline while it waits (to decide, or for the author's next version), else when it was decided
  const date = fmtDayNumeric(status === 'open' || status === 'revising' ? proposal.deadlineAt : proposal.decidedAt)
  return (
    <article id={`proposal-${proposal.id}`} tabIndex={-1} aria-labelledby={titleId} className="proposal">
      <Card>
        <div className="proposal__head">
          <Chip color={STATUS_COLOR[status]}>{t(`${P}.status.${status}`)}</Chip>
          <h3 id={titleId} className="proposal__title">{current.title}</h3>
          <span className="proposal__version">{t(`${P}.version`, { number: current.number })}</span>
        </div>
        <p className="proposal__meta">{t(`${P}.from`, { author, date: fmtDayNumeric(current.createdAt) })}</p>
        <VersionBody view={proposal} version={current} decision={<>
          {status === 'revising' && <p className="proposal__text">{proposal.you.author ? t(`${B}.status.revising`, { title: current.title }) : t(`${B}.card.revising`, { author })}</p>}
          <p className="proposal__meta">{t(`${P}.when.${status}`, { date })}</p>
          <Actions proposal={proposal} />
        </>} />
        {proposal.previous.length > 0 && (
          <>
            <div className="form-actions form-actions--start">
              <button type="button" className="btn btn--ghost" aria-expanded={earlier} aria-controls={earlierId} onClick={() => setEarlier(o => !o)}>
                {t(earlier ? `${P}.earlierHide` : `${P}.earlierShow`)}
              </button>
            </div>
            <div id={earlierId}>
              {earlier && proposal.previous.map(v => <EarlierVersion key={v.id} view={proposal} version={v} />)}
            </div>
          </>
        )}
      </Card>
    </article>
  )
}
