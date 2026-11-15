// Delivery of the council's Telegram messages from their rows (proposal_messages): each changed row is rendered from the
// stored state (cards.ts) and sent, or its message edited, only when the render differs from what was last delivered.
// `dirty` counts the store's changes since the last delivery; `updated_at` is the time of the last delivery attempt.
// Telegram is unreliable: a failure leaves the row `failed`, retried by the hourly run an hour after the last attempt (up
// to MAX_ATTEMPTS), a blocked bot, a vanished chat or a recipient no longer linked to the chat marks it `blocked` for
// good; the vote itself is already counted, and the person still has the site. Delivery is at least once: a send that
// got no answer (a timeout, a dropped connection) or a 5xx from Telegram may have arrived, so trying it again may show the
// person the message twice; such a send is tried at most AMBIGUOUS_RETRIES more times, a duplicate card being better
// than a missing one.
// The log names the row and the error code, never a text, a number of the proposal or the token.
import { deliverGroupProposals } from '../../../server/familyTelegramDelivery'
import type { Database } from '../../../server/db'
import type { ModuleEnv } from '../../../server/config'
import { SCHEDULER_ACTOR } from '../../../server/http'
import { editMessageWithButtons, isBlocked, sendButtons, TelegramError } from '../../../server/bot/telegram'
import { familyT } from '../../../server/bot/texts'
import { renderHash, renderMessage, type CardContext, type MessageRow } from './cards'
import { codeOf } from './errors'
import { readProposal } from './read'

/** A failed row is tried this many times before it is left alone (until the store marks it changed again) */
const MAX_ATTEMPTS = 24
/** A failed row waits this long after its last attempt: the hourly run retries it, a delivery after a write does not */
const RETRY_AFTER_MS = 3_600_000
/**
 * The hourly run ticks a second or so after the hour, with jitter: a row failed at one tick must be retried at the next
 * even if that tick is a few ms early, so the cutoff is this much shorter than an hour.
 */
const RETRY_SLACK_MS = 300_000
/** Retries of a send that may have arrived (no answer, or a 5xx), counting the row's earlier failures */
const AMBIGUOUS_RETRIES = 2
/**
 * `last_error` of a row whose message the person deleted and that was sent again (a second time, the row stops):
 * `resent`, or `resent:<code>` after a later failure, so the latest code still shows (and is logged once)
 */
const RESENT = 'resent'
const isResent = (lastError: string | null) => lastError === RESENT || !!lastError?.startsWith(`${RESENT}:`)
/** The latest failure's code in `last_error`, without the resend marker; null — none */
const lastCode = (lastError: string | null) => (isResent(lastError) ? lastError!.slice(RESENT.length + 1) || null : lastError)

interface DeliveryRow extends MessageRow {
  id: number; proposal_id: number; chat_id: string; message_id: number | null; state: string; dirty: number
  last_error: string | null; sent_hash: string | null; linked: number
}

export interface DeliveryCounts { sent: number; edited: number; failed: number; blocked: number; skipped: number }

/** The message to edit is gone (the person deleted it) or can no longer be edited: only a new message shows the state. */
const messageGone = (err: unknown) => err instanceof TelegramError && err.code === 'telegram.external'
  && /message to edit not found|message can't be edited/i.test(String(err.params?.detail))

// one run at a time in this process: two runs at once would both send a pending row
let lock: Promise<unknown> = Promise.resolve()

/**
 * Sends the new rows and edits the changed ones: rows marked dirty (pending or sent) and failed rows with attempts left
 * whose last attempt is an hour old; a notice is sent once and never edited. A row marked dirty again while its message
 * was on the way stays dirty for the next run. Without a bot token nothing is sent.
 */
export function deliverPending(db: Database, env: ModuleEnv, now: Date, fetchImpl: typeof fetch = fetch): Promise<DeliveryCounts> {
  const run = lock.then(() => deliverOnce(db, env, now, fetchImpl))
  lock = run.catch(() => undefined)
  return run
}

async function deliverOnce(db: Database, env: ModuleEnv, now: Date, fetchImpl: typeof fetch): Promise<DeliveryCounts> {
  const counts: DeliveryCounts = { sent: 0, edited: 0, failed: 0, blocked: 0, skipped: 0 }
  const token = env.TELEGRAM_BOT_TOKEN
  if (!token) return counts
  // `linked`: the recipient still has this chat (a deleted user, or one linked to another account since, is not sent to)
  const { results } = await db.prepare(`SELECT m.*, v.proposal_id, u.id IS NOT NULL AS linked FROM proposal_messages m
    JOIN proposal_versions v ON v.id = m.version_id
    LEFT JOIN users u ON u.id = m.user_id AND u.telegram_id = m.chat_id AND u.telegram_proposals = 1
    WHERE ((m.dirty > 0 AND m.state IN ('pending', 'sent')) OR (m.state = 'failed' AND m.attempts < ? AND m.updated_at <= ?))
      AND NOT (m.kind = 'notice' AND m.state = 'sent')
    ORDER BY m.id`).bind(MAX_ATTEMPTS, new Date(now.getTime() - (RETRY_AFTER_MS - RETRY_SLACK_MS)).toISOString()).all<DeliveryRow>()
  await deliverGroupProposals(db, env, fetchImpl)
  if (!results.length) return counts

  // the language of this run, with its t: after a switch, every message rendered from now on is in the new one
  const { t, lang } = await familyT(db)
  const ctx: CardContext = { t, lang, appUrl: env.APP_URL ?? null, now }
  const ts = now.toISOString()
  // the count is cleared only if no write marked the row again since it was read
  const clean = 'dirty = CASE WHEN dirty = ? THEN 0 ELSE dirty END'

  const log = (row: DeliveryRow, code: string, err?: unknown) => {
    if (code === lastCode(row.last_error)) return
    const status = err instanceof TelegramError && typeof err.params?.status === 'number' ? ` (${err.params.status})` : ''
    console.error(`[council] delivery ${row.id} failed: ${code}${status}`)
  }
  const block = async (row: DeliveryRow, code: string, err?: unknown) => {
    log(row, code, err)
    await db.prepare(`UPDATE proposal_messages SET state = 'blocked', dirty = 0, last_error = ?, updated_at = ? WHERE id = ?`).bind(code, ts, row.id).run()
    counts.blocked++
  }

  for (const row of results) {
    if (!row.linked || !await db.prepare('SELECT 1 FROM users WHERE id = ? AND telegram_id = ? AND telegram_proposals = 1').bind(row.user_id, row.chat_id).first()) {
      await block(row, 'unlinked')
      continue
    }
    let sending = false
    // a resend is remembered after it succeeds too
    let resent = isResent(row.last_error)
    try {
      // read for each row: a vote during this run is seen by the rows after it
      const view = await readProposal(db, row.proposal_id, SCHEDULER_ACTOR)
      const rendered = view && renderMessage(row, view, ctx)
      if (!rendered) {
        await block(row, !view ? 'no_proposal' : row.notice === 'reminder' ? 'stale' : 'unknown_notice')
        continue
      }
      const { text, buttons } = rendered
      const hash = renderHash(text, buttons)
      if (row.message_id !== null && hash === row.sent_hash) {
        await db.prepare(`UPDATE proposal_messages SET state = 'sent', ${clean}, attempts = 0, last_error = ?, updated_at = ? WHERE id = ?`)
          .bind(row.dirty, resent ? RESENT : null, ts, row.id).run()
        counts.skipped++
        continue
      }
      let messageId = row.message_id
      if (messageId !== null) {
        try {
          await editMessageWithButtons(token, row.chat_id, messageId, text, buttons, fetchImpl)
          counts.edited++
        } catch (err) {
          if (!messageGone(err)) throw err
          if (resent) {
            await block(row, 'message_gone', err)
            continue
          }
          // a new message, once: noted before the send, so that a failed send still counts as the resend
          await db.prepare('UPDATE proposal_messages SET message_id = NULL, last_error = ?, updated_at = ? WHERE id = ?').bind(RESENT, ts, row.id).run()
          row.last_error = RESENT
          resent = true
          messageId = null
        }
      }
      if (messageId === null) {
        sending = true
        messageId = (await sendButtons(token, row.chat_id, text, buttons, fetchImpl)).messageId
        counts.sent++
      }
      await db.prepare(`UPDATE proposal_messages SET message_id = ?, state = 'sent', sent_hash = ?, ${clean}, attempts = 0, last_error = ?, updated_at = ?
        WHERE id = ?`).bind(messageId, hash, row.dirty, resent ? RESENT : null, ts, row.id).run()
    } catch (err) {
      const code = codeOf(err)
      if (isBlocked(err)) {
        await block(row, code, err)
        continue
      }
      log(row, code, err)
      // a send without an answer, or with a server error, may have arrived: it is tried again only a few times
      const status = err instanceof TelegramError ? err.params?.status : undefined
      const ambiguous = sending && (code === 'telegram.unavailable' || (typeof status === 'number' && status >= 500))
      await db.prepare(`UPDATE proposal_messages SET state = 'failed',
          attempts = CASE WHEN ? AND attempts + 1 > ? THEN ? ELSE attempts + 1 END, last_error = ?, updated_at = ?
        WHERE id = ?`).bind(ambiguous ? 1 : 0, AMBIGUOUS_RETRIES, MAX_ATTEMPTS, resent ? `${RESENT}:${code}` : code, ts, row.id).run()
      counts.failed++
    }
  }
  return counts
}

// --- in the background, after a write -----------------------------------------------------------------------------

let running: Promise<void> | null = null
let queued: { db: Database; env: ModuleEnv } | null = null

async function drain(db: Database, env: ModuleEnv): Promise<void> {
  let next: { db: Database; env: ModuleEnv } | null = { db, env }
  try {
    while (next) {
      queued = null
      try {
        await deliverPending(next.db, next.env, new Date())
      } catch {
        // the error's text may hold anything of the database's; the next write or the hourly run tries again
        console.error('[council] delivery run failed')
      }
      next = queued
    }
  } finally {
    running = null
  }
}

/**
 * Delivers in the background, right after a write that changed what the messages show; never throws. Calls that come
 * while a run is on are coalesced into one more run after it, so every write is seen without a run per write.
 */
export function deliverSoon(db: Database, env: ModuleEnv): void {
  if (running) {
    queued = { db, env }
    return
  }
  running = drain(db, env)
}

/** @public A test seam: waits for the run in progress and the one queued after it. */
export const deliveries = {
  async flush(): Promise<void> {
    while (running) await running
  },
}
