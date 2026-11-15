import { act, renderHook } from '@testing-library/react'
import { countdown, useCountdown } from '../../src/lib/demoCountdown'

const t0 = Date.UTC(2026, 9, 21, 12, 0, 0)

describe('countdown', () => {
  it('reads the time left as m:ss', () => {
    expect(countdown(t0 + 754_000, t0)).toEqual({ text: '12:34', warning: false, done: false })
    expect(countdown(t0 + 15 * 60_000, t0)).toEqual({ text: '15:00', warning: false, done: false })
    // a part of a second still counts as a second: 0:00 shows only when the time is up
    expect(countdown(t0 + 400, t0)).toEqual({ text: '0:01', warning: true, done: false })
  })

  it('turns to a warning in the last two minutes', () => {
    expect(countdown(t0 + 120_001, t0).warning).toBe(false)
    expect(countdown(t0 + 120_000, t0).warning).toBe(true)
    expect(countdown(t0 + 100_000, t0)).toEqual({ text: '1:40', warning: true, done: false })
  })

  it('is done at zero and after it', () => {
    expect(countdown(t0, t0)).toEqual({ text: '0:00', warning: true, done: true })
    expect(countdown(t0 - 5_000, t0)).toEqual({ text: '0:00', warning: true, done: true })
  })
})

describe('useCountdown', () => {
  afterEach(() => vi.useRealTimers())

  it('ticks every second and catches up when the window gets the focus back', () => {
    vi.useFakeTimers()
    vi.setSystemTime(t0)
    const { result } = renderHook(() => useCountdown(t0 + 754_000))
    expect(result.current?.text).toBe('12:34')
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(result.current?.text).toBe('12:33')
    // a background tab's timers are throttled: the clock moved on without a tick
    vi.setSystemTime(t0 + 300_000)
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(result.current?.text).toBe('7:34')
  })

  it('is null without an end time', () => {
    const { result } = renderHook(() => useCountdown(null))
    expect(result.current).toBeNull()
  })
})
