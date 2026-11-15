import { afterEach, describe, expect, it, vi } from 'vitest'
import { msUntilNextHour, startHourly } from '../../src/server/schedule'

afterEach(() => vi.useRealTimers())

describe('hourly schedule', () => {
  it('computes the wait until the next full hour', () => {
    expect(msUntilNextHour(new Date('2031-10-18T09:15:30.000Z'))).toBe((44 * 60 + 29) * 1000 + 1000)
    expect(msUntilNextHour(new Date('2031-10-18T09:00:00.000Z'))).toBe(60 * 60 * 1000)
  })

  it('runs first at the full hour (plus a one-second margin), then every hour, and stops', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2031-10-18T09:15:00.000Z'))
    const run = vi.fn().mockResolvedValue(undefined)
    const stop = startHourly(run)
    await vi.advanceTimersByTimeAsync(45 * 60 * 1000)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(new Date(Date.now()).toISOString()).toBe('2031-10-18T10:00:01.000Z')
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(run).toHaveBeenCalledTimes(2)
    stop()
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('reschedules after each run: a slow run does not shift the next tick off the hour', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2031-10-18T09:59:00.000Z'))
    const at: string[] = []
    const run = vi.fn(async () => {
      at.push(new Date(Date.now()).toISOString())
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000))
    })
    const stop = startHourly(run)
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    expect(at).toEqual(['2031-10-18T10:00:01.000Z', '2031-10-18T11:00:01.000Z'])
    stop()
  })

  it('stop() during a run cancels the next tick', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2031-10-18T09:59:00.000Z'))
    let stop = () => {}
    const run = vi.fn(async () => { stop() })
    stop = startHourly(run)
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('logs a failed run and keeps the schedule', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2031-10-18T09:59:00.000Z'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const stop = startHourly(run)
    await vi.advanceTimersByTimeAsync(62 * 60 * 1000)
    expect(run).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledWith('[scheduled] run failed', 'boom')
    stop()
    error.mockRestore()
  })
})
