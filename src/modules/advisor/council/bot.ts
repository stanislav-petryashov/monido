// The council in the bot: a voter's presses on their card (Agree, Against, Change vote, No comment, Cancel vote), the
// author's Withdraw, and the comment: the person's next private text while the vote's comment window is open. A press
// writes a provisional vote (store.ts) that counts only once settled: by the comment, by No comment, or when the window
// runs out, which is checked on every update the council hears and by a timer per vote, besides the hourly run.
// Private chats only: a private chat's id is the person's own, so a press or a text anywhere else is not them voting.
// Every press is answered (Telegram shows a spinner until then), also when the store fails. The log names the press and
// an error code, never a text, a number of the proposal or the token.
import { logEvent } from '../../../server/log'
import { COMMENT_MAX, COMMENT_WINDOW_MS, LATE_COMMENT_MS, cleanText } from '../../../domain/proposals'
import { answerCallback, sendMessage } from '../../../server/bot/telegram'
import { familyT } from '../../../server/bot/texts'
import type { BotUpdate } from '../../../server/bot/updates'
import type { ModuleEnv } from '../../../server/config'
import type { Database } from '../../../server/db'
import { InputError, type Actor } from '../../../server/http'
import type { Translate } from '../../../i18n/core'
import { findUser, type UserRow } from '../../../server/users'
import { parseCallback, proposalLink } from './cards'
import { memberName } from '../cardLines'
import { deliverSoon } from './delivery'
import { codeOf } from './errors'
import { readProposal, versionBlock } from './read'
import { cancelVote, castVote, lateVoteOf, pendingVoteOf, settleDue, settleVote, withdraw, type VoteResult } from './store'

interface CouncilContext { db: Database; env: ModuleEnv; now?: Date; fetchImpl?: typeof fetch }
type Press = NonNullable<ReturnType<typeof parseCallback>>
/** What a press comes to: the answer's text and whether it wrote (the messages then change). */
interface Outcome { text: string; wrote: boolean }

/** A message to Telegram that does not arrive is logged by its code; what was written stays. */
async function tell(what: string, send: () => Promise<unknown>): Promise<void> {
  try {
    await send()
  } catch (err) {
    logEvent('ERROR', 'monido.council.bot_failed', 'Council bot operation failed', { 'monido.operation': what, 'error.type': codeOf(err) })
  }
}

/** The person as the journal's actor: through the bot. Their rights do not matter here: the version lists its voters. */
const actorOf = (user: UserRow): Actor => ({ name: user.member, source: 'bot', rights: user.rights, userId: user.id })

/**
 * Settles the votes whose comment window has closed and delivers what that changed; never throws (it runs on a timer).
 * @public (a test seam: the timer's run)
 */
export async function settleDueAndDeliver(db: Database, env: ModuleEnv, now = new Date()): Promise<void> {
  try {
    if (await settleDue(db, now) > 0) deliverSoon(db, env)
  } catch (err) {
    logEvent('ERROR', 'monido.council.bot_failed', 'Council bot operation failed', { 'monido.operation': 'timer', 'error.type': codeOf(err) })
  }
}

/** The one pending settle timer per database: presses in a burst do not pile up timers. */
const settleTimers = new WeakMap<Database, ReturnType<typeof setTimeout>>()

/**
 * A second after the window of a vote just cast closes, it is settled even if the person does nothing more. While a
 * timer is armed no other is: a vote cast meanwhile is settled by the hourly run or the next update the council hears.
 */
function settleLater(db: Database, env: ModuleEnv): void {
  if (settleTimers.has(db)) return
  const timer = setTimeout(() => {
    settleTimers.delete(db)
    void settleDueAndDeliver(db, env)
  }, COMMENT_WINDOW_MS + 1000)
  settleTimers.set(db, timer)
  // the timer does not keep the server alive: the hourly run and the next update settle the vote too
  timer.unref?.()
}

/** The words for a vote that changed nothing, or `recorded` for one that did. */
function voteText(t: Translate, result: VoteResult | { outcome: 'nothing' }, recorded: string): string {
  switch (result.outcome) {
    case 'recorded': return recorded
    case 'unchanged':
    case 'nothing': return t('modules.advisor.bot.answer.unchanged')
    case 'replaced': return t('modules.advisor.bot.answer.replaced', { number: result.version })
    case 'closed': return t(`modules.advisor.bot.answer.closed.${result.status}`)
    case 'not_voter': return t('modules.advisor.bot.answer.notVoter')
    case 'gone': return t('modules.advisor.bot.answer.gone')
  }
}

async function withdrawPress(t: Translate, db: Database, proposalId: number, actor: Actor, now: Date): Promise<Outcome> {
  try {
    await withdraw(db, proposalId, actor, now)
    return { text: t('modules.advisor.bot.answer.withdrawn'), wrote: true }
  } catch (err) {
    if (!(err instanceof InputError)) throw err
    if (err.code === 'advisor.not_author') return { text: t('modules.advisor.bot.answer.notAuthor'), wrote: false }
    if (err.code === 'advisor.proposal_closed') {
      const view = await readProposal(db, proposalId, actor)
      if (view) return { text: t(`modules.advisor.bot.answer.closed.${view.status}`), wrote: false }
    }
    if (err.code === 'advisor.proposal_closed' || err.code === 'advisor.proposal_not_found') return { text: t('modules.advisor.bot.answer.gone'), wrote: false }
    throw err
  }
}

/** One press by a known person in their own chat, after the lazy settling. */
async function act(t: Translate, db: Database, env: ModuleEnv, press: Press, user: UserRow, now: Date): Promise<Outcome> {
  const actor = actorOf(user)
  if (press.kind === 'withdraw') return withdrawPress(t, db, press.proposalId, actor, now)
  const { versionId, action } = press
  if (action === 'agree' || action === 'against') {
    const result = await castVote(db, versionId, user.id, action, { settle: 'provisional', by: 'button' }, actor, now)
    if (result.outcome === 'recorded') settleLater(db, env)
    return { text: voteText(t, result, t('modules.advisor.bot.answer.commentAsk')), wrote: result.outcome === 'recorded' }
  }
  if (action === 'keep') {
    const result = await settleVote(db, versionId, user.id, null, 'button', actor, now)
    return { text: voteText(t, result, t('modules.advisor.bot.answer.recorded')), wrote: result.outcome === 'recorded' }
  }
  if (await cancelVote(db, versionId, user.id, actor, now)) return { text: t('modules.advisor.bot.answer.cancelled'), wrote: true }
  // no provisional vote to cancel: on a gone, replaced or closed version it says so, else there was nothing
  const why = await versionBlock(db, versionId)
  return { text: why ? voteText(t, why, '') : t('modules.advisor.bot.answer.nothingToCancel'), wrote: false }
}

async function onPress(update: Extract<BotUpdate, { kind: 'callback' }>, token: string, ctx: CouncilContext): Promise<boolean> {
  const press = parseCallback(update.data)
  if (!press) return false
  const { db, env, fetchImpl } = ctx
  const now = ctx.now ?? new Date()
  let t: Translate | null = null
  let text: string | undefined
  let changed = false
  try {
    t = (await familyT(db)).t
    // a press in another chat than the person's own (a forwarded card) is answered, and changes nothing
    if (update.chatId === update.from.id) {
      const user = await findUser(db, { telegramId: update.from.id })
      if (!user) {
        text = t('modules.advisor.bot.answer.notVoter')
      } else {
        changed = await settleDue(db, now) > 0
        const outcome = await act(t, db, env, press, user, now)
        text = outcome.text
        changed ||= outcome.wrote
      }
    }
  } catch (err) {
    logEvent('ERROR', 'monido.council.bot_failed', 'Council bot operation failed', { 'monido.operation': press.kind === 'vote' ? press.action : press.kind, 'error.type': codeOf(err) })
    text = t?.('modules.advisor.bot.answer.failed')
  } finally {
    // what the lazy settling changed is shown even when the press itself then failed
    if (changed) deliverSoon(db, env)
  }
  await tell('answer', () => answerCallback(token, update.id, fetchImpl, text))
  return true
}

/** The late replies already sent, per database: one per vote (version, user, window), forgotten when the vote is no longer late. */
const lateTold = new WeakMap<Database, Map<string, number>>()

/** True the first time for this vote: a second text in the late hour is taken quietly. A restart may repeat one reply. */
function firstLateReply(db: Database, key: string, until: number, now: Date): boolean {
  let told = lateTold.get(db)
  if (!told) lateTold.set(db, told = new Map())
  for (const [k, end] of told) if (end <= now.getTime()) told.delete(k)
  if (told.has(key)) return false
  told.set(key, until)
  return true
}

/**
 * The reply to a comment that came after its vote was settled without one, by what can still be done: on an open
 * proposal's current version, add it on the site; while revising, nothing (the author has the against); a replaced
 * version or a decided proposal is past commenting.
 */
async function lateText(t: Translate, db: Database, env: ModuleEnv, late: { versionId: number; proposalId: number }, actor: Actor): Promise<string> {
  const minutes = COMMENT_WINDOW_MS / 60_000
  const view = await readProposal(db, late.proposalId, actor)
  const closed = (status: string, params?: Record<string, unknown>) =>
    t('modules.advisor.bot.lateCommentClosed', { minutes, status: t(`modules.advisor.bot.lateStatus.${status}`, params) })
  if (!view) return closed('gone')
  if (view.status !== 'open' && view.status !== 'revising') return closed(view.status)
  if (view.current.id !== late.versionId) return closed('replaced', { number: view.current.number })
  if (view.status === 'revising') {
    return t('modules.advisor.bot.lateCommentRevising', { minutes, author: memberName(t, view.author.member) })
  }
  return env.APP_URL
    ? t('modules.advisor.bot.lateComment', { minutes, url: proposalLink(env.APP_URL, late.proposalId) })
    : t('modules.advisor.bot.lateCommentNoLink', { minutes })
}

async function onText(update: Extract<BotUpdate, { kind: 'message' }>, token: string, ctx: CouncilContext): Promise<boolean> {
  if (update.chatType !== 'private' || update.chatId !== update.from.id) return false
  // a command is never a comment: it is another handler's (the reminders' /start)
  if (update.text.startsWith('/')) return false
  const { db, env, fetchImpl } = ctx
  const user = await findUser(db, { telegramId: update.from.id })
  if (!user) return false
  const actor = actorOf(user)
  const now = ctx.now ?? new Date()
  const reply = (text: string) => tell('reply', () => sendMessage(token, update.chatId, text, fetchImpl))
  // first the windows that have closed: a text after its vote's window is late, not a comment
  if (await settleDue(db, now) > 0) deliverSoon(db, env)
  const pending = await pendingVoteOf(db, user.id, now)
  if (pending) {
    const comment = cleanText(update.text, COMMENT_MAX, { multiline: true })
    // nothing left of it after cleaning (only invisible characters): not a comment, the vote still waits
    if (!comment) return false
    const result = await settleVote(db, pending.versionId, user.id, comment, 'comment', actor, now)
    // `nothing`: the timer settled the vote between the two reads; the text is then a late one
    if (result.outcome !== 'nothing') {
      deliverSoon(db, env)
      const { t } = await familyT(db)
      const view = result.outcome === 'recorded' ? await readProposal(db, pending.proposalId, actor) : null
      await reply(view
        ? t('modules.advisor.bot.commentSaved', { author: memberName(t, view.author.member), title: view.current.title })
        : voteText(t, result, ''))
      return true
    }
  }
  const late = await lateVoteOf(db, user.id, now)
  if (!late) return false
  const until = Date.parse(late.closedAt) + LATE_COMMENT_MS
  if (firstLateReply(db, `${late.versionId}:${user.id}:${late.closedAt}`, until, now)) {
    const { t } = await familyT(db)
    await reply(await lateText(t, db, env, late, actor))
  }
  return true
}

/**
 * The council's part of the bot: true when the update was a council press (always answered) or a comment, a late one
 * included; anything else (a group chat, an unknown account, a text with no vote waiting, a command) goes on to the
 * next handler. Without a bot token there is no bot to answer through.
 */
export async function handleCouncilUpdate(update: BotUpdate, ctx: CouncilContext): Promise<boolean> {
  const token = ctx.env.TELEGRAM_BOT_TOKEN
  if (!token) return false
  return update.kind === 'callback' ? onPress(update, token, ctx) : onText(update, token, ctx)
}
