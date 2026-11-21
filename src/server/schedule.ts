// The hourly timer: a tick at the top of every hour (with a second of margin).
import { errorType, logEvent } from './log'
const HOUR_MS = 60 * 60 * 1000
// a timer may fire a millisecond early; the margin keeps the tick inside the right hour
const MARGIN_MS = 1000

export function msUntilNextHour(now: Date): number {
  const next = new Date(now)
  next.setUTCMinutes(0, 0, 0)
  next.setTime(next.getTime() + HOUR_MS)
  return next.getTime() - now.getTime()
}

/**
 * Calls run at the top of every hour; an error is logged and the schedule goes on. Returns stop().
 * The next tick is planned afresh after each run, so an early or long tick does not shift the schedule.
 */
export function startHourly(run: () => Promise<void>, now: () => Date = () => new Date()): () => void {
  let timeout: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  const schedule = () => { timeout = setTimeout(() => { void tick() }, msUntilNextHour(now()) + MARGIN_MS) }
  const tick = async () => {
    try { await run() } catch (err) { logEvent('ERROR', 'monido.schedule.run_failed', 'Scheduled run failed', { 'error.type': errorType(err) }) }
    if (!stopped) schedule()
  }
  schedule()
  return () => {
    stopped = true
    if (timeout) clearTimeout(timeout)
  }
}
