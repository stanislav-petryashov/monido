import { describe, expect, it } from 'vitest'
import { isTimezone, localDay, localTime, nextReminder, parseSchedule, shouldRemind, type ReminderSettings } from '../../../src/modules/reminders/domain'

const at = (iso: string) => new Date(iso)
const settings = (o: Partial<ReminderSettings> = {}): ReminderSettings => ({
  enabled: true, startDay: 3, hour: 10, timezone: 'Europe/Moscow',
  chatId: '42', chatTitle: 'Robin', lastSentAt: null, lastError: null, ...o,
})
const open = ['2031-09']

describe('localTime', () => {
  it('reads the day and the hour in the chosen zone', () => {
    expect(localTime(at('2031-10-02T22:30:00Z'), 'Europe/Moscow')).toEqual({ date: '2031-10-03', day: 3, hour: 1 })
    expect(localTime(at('2031-10-03T05:30:00Z'), 'America/Los_Angeles')).toEqual({ date: '2031-10-02', day: 2, hour: 22 })
    expect(localTime(at('2031-12-31T11:30:00Z'), 'Pacific/Tongatapu')).toEqual({ date: '2032-01-01', day: 1, hour: 0 })
  })
  it('never reports hour 24 at midnight', () => {
    expect(localTime(at('2031-10-03T00:00:00Z'), 'UTC').hour).toBe(0)
  })
})

describe('isTimezone', () => {
  it('accepts IANA names and refuses anything else', () => {
    expect(isTimezone('Europe/Moscow')).toBe(true)
    expect(isTimezone('UTC')).toBe(true)
    for (const bad of ['Moscow', '', 'Europe/Nowhere', '+03:00 or so']) expect(isTimezone(bad), bad).toBe(false)
  })
})

describe('shouldRemind', () => {
  // 3 October, 10:00 in Moscow = 07:00 UTC
  it('sends on the start day at the chosen hour', () => {
    expect(shouldRemind(settings(), open, at('2031-10-03T07:05:00Z'))).toBe(true)
  })
  it('waits for the start day and for the hour', () => {
    expect(shouldRemind(settings(), open, at('2031-10-02T12:00:00Z'))).toBe(false)
    expect(shouldRemind(settings(), open, at('2031-10-03T06:59:00Z'))).toBe(false)
  })
  it('sends later the same day if the hour was missed, and on every following day of the month', () => {
    expect(shouldRemind(settings(), open, at('2031-10-03T18:00:00Z'))).toBe(true)
    expect(shouldRemind(settings({ lastSentAt: '2031-10-03T07:05:00Z' }), open, at('2031-10-04T07:05:00Z'))).toBe(true)
    expect(shouldRemind(settings({ lastSentAt: '2031-10-03T07:05:00Z' }), open, at('2031-10-31T07:05:00Z'))).toBe(true)
  })
  it('sends once a day: a second run the same local day does nothing', () => {
    const sent = settings({ lastSentAt: '2031-10-03T07:05:00Z' })
    expect(shouldRemind(sent, open, at('2031-10-03T08:05:00Z'))).toBe(false)
    expect(shouldRemind(sent, open, at('2031-10-03T20:55:00Z'))).toBe(false)
    // 21:05 UTC: already 4 October in Moscow, but not 10 o'clock yet
    expect(shouldRemind(sent, open, at('2031-10-03T21:05:00Z'))).toBe(false)
  })
  it('starts over in the next month and waits for its start day', () => {
    const sent = settings({ lastSentAt: '2031-10-31T07:05:00Z' })
    expect(shouldRemind(sent, open, at('2031-11-01T07:05:00Z'))).toBe(false)
    expect(shouldRemind(sent, open, at('2031-11-03T07:05:00Z'))).toBe(true)
  })
  it('judges the day in the chosen zone, not in UTC', () => {
    // 2 October 23:30 UTC: in Moscow it is the 3rd, 02:30 — the day has come, the hour has not
    expect(shouldRemind(settings({ hour: 2 }), open, at('2031-10-02T23:30:00Z'))).toBe(true)
    // in Los Angeles 3 October 10:00 = 17:00 UTC
    const la = settings({ timezone: 'America/Los_Angeles' })
    expect(shouldRemind(la, open, at('2031-10-03T16:59:00Z'))).toBe(false)
    expect(shouldRemind(la, open, at('2031-10-03T17:00:00Z'))).toBe(true)
  })
  it.each([
    ['disabled', settings({ enabled: false })],
    ['no chat', settings({ chatId: null })],
  ])('stays silent when %s', (_, s) => {
    expect(shouldRemind(s, open, at('2031-10-03T07:05:00Z'))).toBe(false)
  })
  it('stays silent when every month is closed', () => {
    expect(shouldRemind(settings(), [], at('2031-10-03T07:05:00Z'))).toBe(false)
  })
  it('stays silent rather than guess when the stored zone is broken', () => {
    expect(shouldRemind(settings({ timezone: 'Nowhere/Land' }), open, at('2031-10-03T07:05:00Z'))).toBe(false)
  })
})

describe('nextReminder', () => {
  it('names today, tomorrow or the start day of the next month', () => {
    expect(nextReminder(settings(), open, at('2031-10-03T05:00:00Z'))).toEqual({ date: '2031-10-03', hour: 10, minute: 0 })
    expect(nextReminder(settings({ lastSentAt: '2031-10-03T07:05:00Z' }), open, at('2031-10-03T09:00:00Z'))).toEqual({ date: '2031-10-04', hour: 10, minute: 0 })
    expect(nextReminder(settings(), open, at('2031-10-01T09:00:00Z'))).toEqual({ date: '2031-10-03', hour: 10, minute: 0 })
    expect(nextReminder(settings({ lastSentAt: '2031-10-31T07:05:00Z' }), open, at('2031-10-31T09:00:00Z'))).toEqual({ date: '2031-11-03', hour: 10, minute: 0 })
    expect(nextReminder(settings({ lastSentAt: '2031-12-31T07:05:00Z' }), open, at('2031-12-31T09:00:00Z'))).toEqual({ date: '2032-01-03', hour: 10, minute: 0 })
  })
  it('names the hourly run that sends it in a half-hour zone: 10:30, not 10:00', () => {
    // Kolkata is UTC+5:30: runs come at HH:30 local; at 09:30 the hour is not reached yet, at 10:30 it is
    const kolkata = settings({ timezone: 'Asia/Kolkata' })
    const next = nextReminder(kolkata, open, at('2031-10-03T03:10:00Z'))
    expect(next).toEqual({ date: '2031-10-03', hour: 10, minute: 30 })
    expect(shouldRemind(kolkata, open, at('2031-10-03T04:00:00Z'))).toBe(false)
    expect(shouldRemind(kolkata, open, at('2031-10-03T05:00:00Z'))).toBe(true)
  })
  it('is null when nothing will be sent', () => {
    expect(nextReminder(settings(), [], at('2031-10-03T05:00:00Z'))).toBeNull()
    expect(nextReminder(settings({ enabled: false }), open, at('2031-10-03T05:00:00Z'))).toBeNull()
    expect(nextReminder(settings({ chatId: null }), open, at('2031-10-03T05:00:00Z'))).toBeNull()
  })
})

describe('parseSchedule', () => {
  const ok = { enabled: true, startDay: 3, hour: 10, timezone: 'Europe/Moscow' }
  it('accepts a schedule within the limits', () => {
    expect(parseSchedule({ ...ok, extra: 1 })).toEqual(ok)
    expect(parseSchedule({ ...ok, startDay: 1, hour: 0 })).toMatchObject({ startDay: 1, hour: 0 })
    expect(parseSchedule({ ...ok, startDay: 15, hour: 23 })).toMatchObject({ startDay: 15, hour: 23 })
  })
  it.each([
    ['startDay', { ...ok, startDay: 0 }], ['startDay', { ...ok, startDay: 16 }], ['startDay', { ...ok, startDay: 3.5 }], ['startDay', { ...ok, startDay: '3' }],
    ['hour', { ...ok, hour: 24 }], ['hour', { ...ok, hour: -1 }],
    ['timezone', { ...ok, timezone: 'Moscow' }], ['enabled', { ...ok, enabled: 'yes' }],
  ])('names the field when %s is out of range', (field, body) => {
    expect(() => parseSchedule(body)).toThrow(field)
  })
  it('refuses a body that is not an object', () => {
    expect(() => parseSchedule(null)).toThrow()
    expect(() => parseSchedule('x')).toThrow()
  })
})

describe('review: boundaries', () => {
  it('nextReminder does not skip the short day of a DST change', () => {
    // Sydney, 3 October 23:30 local; on 4 October the clocks go forward — the day has 23 hours
    const s = settings({ timezone: 'Australia/Sydney', startDay: 1, lastSentAt: '2031-10-03T00:30:00Z' })
    expect(nextReminder(s, open, at('2031-10-03T13:30:00Z'))).toEqual({ date: '2031-10-04', hour: 10, minute: 0 })
  })
  it('nextReminder names the next run, not an hour that has already passed', () => {
    // 15:20 in Moscow, reminder hour 10, nothing sent today — it goes at 16:00
    expect(nextReminder(settings(), open, at('2031-10-03T12:20:00Z'))).toEqual({ date: '2031-10-03', hour: 16, minute: 0 })
    // after 23:00 there are no more runs today
    expect(nextReminder(settings(), open, at('2031-10-03T20:20:00Z'))).toEqual({ date: '2031-10-04', hour: 10, minute: 0 })
  })
  it('works at the edges of the day', () => {
    expect(shouldRemind(settings({ hour: 0 }), open, at('2031-10-02T21:00:00Z'))).toBe(true)      // 3 October 00:00 in Moscow
    expect(shouldRemind(settings({ hour: 23 }), open, at('2031-10-03T19:59:00Z'))).toBe(false)    // 22:59
    expect(shouldRemind(settings({ hour: 23 }), open, at('2031-10-03T20:00:00Z'))).toBe(true)     // 23:00
    const tonga = settings({ timezone: 'Pacific/Tongatapu', startDay: 1 })
    expect(shouldRemind(tonga, open, at('2031-09-30T20:59:00Z'))).toBe(false)                      // 1 October 09:59
    expect(shouldRemind(tonga, open, at('2031-09-30T21:00:00Z'))).toBe(true)                       // 1 October 10:00
  })
  it('localDay gives noon of the local date, so the queue is cut by the local month', () => {
    // 30 September 17:00 in Los Angeles — already 1 October in UTC
    expect(localDay(at('2031-10-01T00:00:00Z'), 'America/Los_Angeles').toISOString()).toBe('2031-09-30T12:00:00.000Z')
    expect(localDay(at('2031-09-30T21:00:00Z'), 'Pacific/Tongatapu').toISOString()).toBe('2031-10-01T12:00:00.000Z')
    const now = at('2031-10-01T00:00:00Z')
    expect(localDay(now, 'Nowhere/Land')).toBe(now)
  })
})

