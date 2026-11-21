// The one reader of the bot's updates: long polling, so a home server with no public address hears it too.
// Every update goes to `handle`; the offset lives in memory and `stop()` confirms it (Telegram re-sends what was not confirmed).
import type { BotStatus } from '../../domain/api'
import { errorType, logEvent } from '../log'
import { getMe, getUpdates, TelegramError } from './telegram'
import type { BotUpdate } from './updates'

const POLL_TIMEOUT_SEC = 30
const FIRST_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 60_000
/** a webhook or another reader does not go away by itself: ask again once a minute */
const CONFLICT_RETRY_MS = 60_000
const CONFLICTS = new Set(['telegram.webhook', 'telegram.other_reader'])
/** a poll that came back at once with nothing (a proxy that ignores `timeout`) waits this long before the next */
const MIN_POLL_MS = 1_000
/** how long stop() waits for Telegram to take the confirmation of the last batch */
const CONFIRM_TIMEOUT_MS = 3_000

export interface BotHandle { username(): string | null; status(): BotStatus; stop(): Promise<void> }

const wait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms).unref() })

export function startBotReader({ token, handle, fetchImpl = fetch, sleep = wait }: {
  token: string
  handle: (u: BotUpdate) => Promise<void>
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}): BotHandle {
  let username: string | null = null
  let problem: string | null = null
  let stopped = false
  let offset = 0
  const abort = new AbortController()
  let wake = () => {}
  const stopping = new Promise<void>(resolve => { wake = resolve })
  // a pause ends early on stop
  const pause = (ms: number) => Promise.race([sleep(ms), stopping])

  // the problem Settings shows: a token Telegram refuses, a webhook, another reader; network trouble is not one
  const problemOf = (err: unknown) => (err instanceof TelegramError && (err.code === 'telegram.bad_token' || CONFLICTS.has(err.code)) ? err.code : null)
  let outage: { reason: string; started: number; attempts: number } | null = null
  const failed = (operation: string, err: unknown) => {
    const reason = errorType(err)
    const changed = outage?.reason !== reason
    outage ??= { reason, started: performance.now(), attempts: 0 }
    outage.reason = reason
    outage.attempts++
    if (changed) logEvent('WARN', 'monido.telegram.poll_failed', 'Telegram polling failed', {
      'monido.operation': operation, 'error.type': reason, 'monido.attempts': outage.attempts,
      'monido.duration_ms': Math.round(performance.now() - outage.started),
    })
  }
  const recovered = (operation: string) => {
    if (!outage) return
    logEvent('INFO', 'monido.telegram.poll_recovered', 'Telegram polling recovered', {
      'monido.operation': operation, 'error.type': outage.reason, 'monido.attempts': outage.attempts,
      'monido.duration_ms': Math.round(performance.now() - outage.started),
    })
    outage = null
  }

  async function run(): Promise<void> {
    for (let backoff = FIRST_BACKOFF_MS; !stopped && username === null;) {
      try {
        username = (await getMe(token, fetchImpl, abort.signal)).username
        recovered('getMe')
        problem = null
      } catch (err) {
        if (stopped) return
        problem = problemOf(err) ?? problem
        failed('getMe', err)
        await pause(backoff)
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }
    for (let backoff = FIRST_BACKOFF_MS; !stopped;) {
      let batch
      const asked = Date.now()
      try {
        batch = await getUpdates(token, offset, POLL_TIMEOUT_SEC, fetchImpl, abort.signal)
      } catch (err) {
        if (stopped) return
        problem = problemOf(err) ?? problem
        failed('getUpdates', err)
        if (err instanceof TelegramError && CONFLICTS.has(err.code)) {
          await pause(CONFLICT_RETRY_MS)
        } else {
          await pause(backoff)
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
        }
        continue
      }
      problem = null
      recovered('getUpdates')
      backoff = FIRST_BACKOFF_MS
      for (const { updateId, update } of batch) {
        if (stopped) return
        // past this update before handling it: one that keeps failing is not fetched again forever
        offset = updateId + 1
        if (!update) continue
        try {
          await handle(update)
        } catch (err) {
          logEvent('ERROR', 'monido.telegram.update_failed', 'Telegram update handler failed', { 'error.type': errorType(err) })
        }
      }
      if (!batch.some(u => u.update) && Date.now() - asked < MIN_POLL_MS) await pause(MIN_POLL_MS)
    }
  }

  const done = run()
  return {
    username: () => username,
    status: () => ({ configured: true, username, problem }),
    stop: async () => {
      stopped = true
      abort.abort()
      wake()
      await done
      // confirm the last batch, or Telegram hands it over again after a restart; a slow answer does not hold up shutdown
      if (offset > 0) {
        await getUpdates(token, offset, 0, fetchImpl, AbortSignal.timeout(CONFIRM_TIMEOUT_MS)).catch((err: unknown) => {
          logEvent('WARN', 'monido.telegram.confirm_failed', 'Telegram update confirmation failed', { 'error.type': errorType(err) })
        })
      }
    },
  }
}
