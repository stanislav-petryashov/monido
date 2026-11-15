// Telegram reminders about months that are not closed: when to send. The text is in message.ts.
// Pure functions; the day and the hour are always read in the settings' time zone.
import type { MsgParams } from '../../domain/types'

export interface Schedule { enabled: boolean; startDay: number; hour: number; timezone: string }
/** A stored failure: `errors.<code>` with its params, worded in the UI language. */
export interface StoredError { code: string; params?: MsgParams }
export interface ReminderSettings extends Schedule {
  chatId: string | null
  /** The bound account's name — shown in the settings to tell whose chat it is; null — the chat has no name */
  chatTitle: string | null
  /** ISO time of the last successful send */
  lastSentAt: string | null
  /** Why the last send failed; null — the last send went through */
  lastError: StoredError | null
}

export const START_DAY_MAX = 15

/** Date, day and hour in a time zone: the «is it time» rule must not depend on the server's zone. */
export function localTime(now: Date, timezone: string): { date: string; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, day: Number(get('day')), hour: Number(get('hour')) % 24 }
}

/** An IANA zone name Intl understands: «Europe/Moscow», «UTC». */
export function isTimezone(name: string): boolean {
  if (name !== 'UTC' && !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(name)) return false
  try { new Intl.DateTimeFormat('en', { timeZone: name }); return true } catch { return false }
}

const canRemind = (s: ReminderSettings, openMonths: string[]) =>
  s.enabled && s.chatId !== null && openMonths.length > 0 && isTimezone(s.timezone)

/**
 * Whether to send: from day startDay to the month's end — once a day, from hour `hour`,
 * while there are open months. The count starts over next month.
 */
export function shouldRemind(settings: ReminderSettings, openMonths: string[], now: Date): boolean {
  if (!canRemind(settings, openMonths)) return false
  const today = localTime(now, settings.timezone)
  if (today.day < settings.startDay || today.hour < settings.hour) return false
  return settings.lastSentAt === null || localTime(new Date(settings.lastSentAt), settings.timezone).date < today.date
}

/**
 * Noon of the local date. The open-month queue is cut at this day: otherwise west of Greenwich
 * the bot would remind about a month that has not ended there yet, and east of it would be late.
 */
export function localDay(now: Date, timezone: string): Date {
  return isTimezone(timezone) ? new Date(`${localTime(now, timezone).date}T12:00:00Z`) : now
}

const HOUR_MS = 3_600_000

/**
 * When the next reminder goes: the first hourly run (the server ticks at the top of every UTC hour) that shouldRemind
 * lets through, on the zone's clock — in a half-hour zone that is HH:30. null — none will (off, no chat, everything
 * closed). The run of the current hour has passed already.
 */
export function nextReminder(settings: ReminderSettings, openMonths: string[], now: Date): { date: string; hour: number; minute: number } | null {
  if (!canRemind(settings, openMonths)) return null
  const next = Math.floor(now.getTime() / HOUR_MS) + 1
  // the start day of the next month is at most 46 days away
  for (let i = 0; i < 46 * 24; i++) {
    const tick = new Date((next + i) * HOUR_MS)
    if (!shouldRemind(settings, openMonths, tick)) continue
    const { date, hour } = localTime(tick, settings.timezone)
    return { date, hour, minute: Number(new Intl.DateTimeFormat('en', { timeZone: settings.timezone, minute: 'numeric' }).format(tick)) }
  }
  return null
}

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/** A schedule from a request body; an error names the field. */
export function parseSchedule(body: unknown): Schedule {
  if (!body || typeof body !== 'object') throw new Error('Expected an object')
  const b = body as Record<string, unknown>
  if (typeof b.enabled !== 'boolean') throw new Error('Invalid enabled')
  if (!isInt(b.startDay, 1, START_DAY_MAX)) throw new Error(`Invalid startDay: 1–${START_DAY_MAX}`)
  if (!isInt(b.hour, 0, 23)) throw new Error('Invalid hour: 0–23')
  if (typeof b.timezone !== 'string' || !isTimezone(b.timezone)) throw new Error('Invalid timezone')
  return { enabled: b.enabled, startDay: b.startDay, hour: b.hour, timezone: b.timezone }
}
