import { useEffect, useState } from 'react'

/** The last two minutes of a demo session read as a warning. */
const WARNING_MS = 2 * 60_000

export interface Countdown {
  /** the time left as m:ss; a part of a second counts as a whole one, so 0:00 shows only when the time is up */
  text: string
  warning: boolean
  done: boolean
}

/** The time left until `expiresAt` (epoch ms) at `now`. */
export function countdown(expiresAt: number, now: number): Countdown {
  const left = expiresAt - now
  const seconds = Math.max(0, Math.ceil(left / 1000))
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return { text, warning: left <= WARNING_MS, done: left <= 0 }
}

/**
 * The countdown to `expiresAt`, ticking every second; null without an end time. A background tab's timers are throttled,
 * so the clock is read again when the window gets the focus back.
 */
export function useCountdown(expiresAt: number | null): Countdown | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (expiresAt === null) return
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, 1000)
    window.addEventListener('focus', tick)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', tick)
    }
  }, [expiresAt])
  return expiresAt === null ? null : countdown(expiresAt, now)
}
