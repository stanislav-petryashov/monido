import { createElement, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { ToastContext, type ToastApi } from '../../src/lib/notifyState'
import { botNamePoll, useAdminWrite, useLoadFailedToast } from '../../src/pages/admin/adminQuery'
import type { AuthSettingsView } from '../../src/domain/api'
import { testClient } from '../helpers/render'

const toast: ToastApi = { success: vi.fn(), error: vi.fn() }
function wrapperWith(client = testClient()) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, createElement(ToastContext.Provider, { value: toast }, children))
}
beforeEach(() => vi.clearAllMocks())

describe('useAdminWrite', () => {
  it('announces success by title, or by title and text, and refetches its keys before it resolves', async () => {
    const client = testClient()
    let reads = 0
    const { result } = renderHook(() => {
      useQuery({ queryKey: ['admin', 'goals'], queryFn: async () => ++reads })
      return useAdminWrite([['admin', 'goals']])
    }, { wrapper: wrapperWith(client) })
    await waitFor(() => expect(reads).toBe(1))
    expect(await result.current(() => Promise.resolve({ ok: true }), 'Saved', 'Could not save')).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('Saved')
    expect(client.getQueryData(['admin', 'goals'])).toBe(2)
    await result.current(() => Promise.resolve(), ['Account added', 'Quillmark Bank · Robin'], 'Could not save')
    expect(toast.success).toHaveBeenLastCalledWith('Account added', 'Quillmark Bank · Robin')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('on failure announces the error, refetches nothing and resolves to false; null means no success notification', async () => {
    const { result } = renderHook(() => useAdminWrite([]), { wrapper: wrapperWith() })
    const boom = new Error('boom')
    expect(await result.current(() => Promise.reject(boom), 'Saved', 'Could not save')).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Could not save', boom)
    expect(await result.current(() => Promise.resolve(), null, 'Could not save')).toBe(true)
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('useLoadFailedToast', () => {
  afterEach(() => { vi.useRealTimers() })

  /**
   * Two queries that fail when the test says, each stamped with the clock the test sets (errorUpdatedAt is Date.now());
   * a failure resolves once the hook has rendered it.
   */
  function twoFailing() {
    const fails: Record<string, (e: Error) => void> = {}
    const failing = (key: 'a' | 'b') => () => new Promise<never>((_, reject) => { fails[key] = reject })
    const { result } = renderHook(() => {
      const a = useQuery({ queryKey: ['admin', 'a'], queryFn: failing('a'), retry: false })
      const b = useQuery({ queryKey: ['admin', 'b'], queryFn: failing('b'), retry: false })
      useLoadFailedToast(a, b)
      return { a: a.errorUpdatedAt, b: b.errorUpdatedAt }
    }, { wrapper: wrapperWith() })
    return async (key: 'a' | 'b', at: number, message: string) => {
      await waitFor(() => expect(fails[key]).toBeDefined())
      vi.setSystemTime(at)
      await act(async () => { fails[key](new Error(message)) })
      await waitFor(() => expect(result.current[key]).toBe(at))
    }
  }

  it('reports a load in which several queries failed once, after the last one settles, with the newest error', async () => {
    const failAt = twoFailing()
    await failAt('b', 2_000, 'newer')
    expect(toast.error).not.toHaveBeenCalled()
    await failAt('a', 1_000, 'older')
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error).toHaveBeenCalledWith('Could not load data', expect.objectContaining({ message: 'newer' }))
  })

  it('of errors stamped in the same millisecond reports the later-declared query\'s', async () => {
    const failAt = twoFailing()
    await failAt('a', 1_000, 'first')
    await failAt('b', 1_000, 'second')
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error).toHaveBeenCalledWith('Could not load data', expect.objectContaining({ message: 'second' }))
  })
})

describe('botNamePoll', () => {
  const viewWith = (bot: AuthSettingsView['bot']) => ({
    mode: 'password', locked: false, password: { set: true, source: 'app' }, bot,
    switchToTelegram: { bot: false, linkedManager: false, proof: null }, fallback: null,
  }) as AuthSettingsView

  it('every 2 s while a token has no name and no problem, for at most a minute; never otherwise', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const query = { state: { data: viewWith({ source: 'app', username: null, problem: null }) } }
    expect(botNamePoll(query)).toBe(2000)
    now.mockReturnValue(1_059_000)
    expect(botNamePoll(query)).toBe(2000)
    now.mockReturnValue(1_060_000)
    expect(botNamePoll(query)).toBe(false)
    expect(botNamePoll({ state: {} })).toBe(false)
    expect(botNamePoll({ state: { data: viewWith({ source: null, username: null, problem: null }) } })).toBe(false)
    expect(botNamePoll({ state: { data: viewWith({ source: 'app', username: 'family_bot', problem: null }) } })).toBe(false)
    expect(botNamePoll({ state: { data: viewWith({ source: 'env', username: null, problem: 'telegram.bad_token' }) } })).toBe(false)
  })

  it('a wait that ended starts its minute afresh the next time', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0)
    const query = { state: { data: viewWith({ source: 'app', username: null, problem: null }) } }
    expect(botNamePoll(query)).toBe(2000)
    query.state.data = viewWith({ source: 'app', username: 'family_bot', problem: null })
    expect(botNamePoll(query)).toBe(false)
    now.mockReturnValue(120_000)
    query.state.data = viewWith({ source: 'app', username: null, problem: null })
    expect(botNamePoll(query)).toBe(2000)
  })
})

it('retry refetches only failed GETs', async () => {
  const { render, screen, fireEvent } = await import('@testing-library/react')
  const { AdminReadNotice } = await import('../../src/pages/admin/ui/AdminReadNotice')
  const failed = vi.fn().mockResolvedValue(undefined)
  const success = vi.fn().mockResolvedValue(undefined)
  render(<AdminReadNotice queries={[
    { data: undefined, error: new Error('offline'), isPending: false, isFetching: false, refetch: failed },
    { data: [], error: null, isPending: false, isFetching: false, refetch: success },
  ]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(failed).toHaveBeenCalledTimes(1)
  expect(success).not.toHaveBeenCalled()
})

it('keeps retry visible and disabled while a failed GET is retrying', async () => {
  const { render, screen, fireEvent } = await import('@testing-library/react')
  const { AdminReadNotice } = await import('../../src/pages/admin/ui/AdminReadNotice')
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const failed = { data: undefined, error: new Error('offline'), isPending: false, isFetching: false, refetch: () => pending }
  const { rerender } = render(<AdminReadNotice queries={[failed]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  rerender(<AdminReadNotice queries={[{ ...failed, error: null, isPending: true, isFetching: true }]} />)
  expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
  await act(async () => finish())
})
