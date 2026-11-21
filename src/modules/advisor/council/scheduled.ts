// The council's hourly run: the bot's timers are lost on a restart, so everything time-driven is also done here.
import { logEvent } from '../../../server/log'
import type { Database } from '../../../server/db'
import type { ModuleEnv } from '../../../server/config'
import { deliverPending, type DeliveryCounts } from './delivery'
import { codeOf } from './errors'
import { expireDue, recheckOpen, remindDue, settleDue } from './store'

interface CouncilRun { settled: number; recheckOpen: number; expired: number; reminders: number; delivery: DeliveryCounts }

const NO_DELIVERY: DeliveryCounts = { sent: 0, edited: 0, failed: 0, blocked: 0, skipped: 0 }

/** One step of the run: its result, or `fallback` after logging its name and the error's code (no text, no number). */
async function step<T>(name: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    logEvent('ERROR', 'monido.council.scheduled_failed', 'Scheduled council step failed', { 'monido.operation': name, 'error.type': codeOf(err) })
    return fallback
  }
}

/**
 * The hourly run for the council, each step on its own so that a failing one does not stop the next: settles the
 * provisional votes whose comment window has closed (the bot's timer may have been lost), re-checks the acceptance of
 * the open proposals (a deleted voter may have been the only one missing — before the expiry, so such a proposal is
 * accepted, not expired), closes the proposals past their deadline, creates the due reminders, then delivers what all
 * of that wrote and retries the failed messages. Never throws.
 */
export async function runCouncilScheduled(db: Database, env: ModuleEnv, now = new Date(), fetchImpl?: typeof fetch): Promise<CouncilRun> {
  const settled = await step('settle', 0, () => settleDue(db, now))
  const rechecked = await step('recheck', 0, () => recheckOpen(db, now))
  const expired = await step('expire', 0, async () => (await expireDue(db, now)).length)
  const reminders = await step('remind', 0, () => remindDue(db, now))
  const delivery = await step('deliver', NO_DELIVERY, () => deliverPending(db, env, now, fetchImpl))
  return { settled, recheckOpen: rechecked, expired, reminders, delivery }
}
