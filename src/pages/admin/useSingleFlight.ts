import { useRef, useState } from 'react'

/**
 * A guard against a double submit: `run(task)` starts the task unless another one is still running (then the call is
 * ignored and returns undefined). The ref makes the guard synchronous, so two events in one tick start one task;
 * `pending` (state) is for `disabled`; `isRunning()` reads the ref, for a check that must be right within the same tick.
 */
export function useSingleFlight(): [run: <T>(task: () => Promise<T>) => Promise<T | undefined>, pending: boolean, isRunning: () => boolean] {
  const running = useRef(false)
  const [pending, setPending] = useState(false)
  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (running.current) return undefined
    running.current = true
    setPending(true)
    try {
      return await task()
    } finally {
      running.current = false
      setPending(false)
    }
  }
  return [run, pending, () => running.current]
}
