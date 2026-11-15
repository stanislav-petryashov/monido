import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { resetAuth, setAuth, useAuth } from '../../src/lib/authState'
import { useSaveSetup, useSetup } from '../../src/lib/setup'
import { jsonResponse } from '../helpers/http'
import { testClient } from '../helpers/render'

afterEach(() => { resetAuth() })

describe('setup hooks', () => {
  it('useSetup reads GET /api/setup', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ state: 'pending', hasData: false, hasAccounts: false })))
    const client = testClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useSetup(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual({ state: 'pending', hasData: false, hasAccounts: false }))
  })

  it('useSaveSetup puts the state, re-reads /api/auth, then drops the setup read', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url === '/api/auth') return jsonResponse({ mode: 'password', authenticated: true, setup: 'skipped' })
      return jsonResponse({ state: 'skipped', hasData: false, hasAccounts: false })
    }))
    const client = testClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => ({ save: useSaveSetup(), auth: useAuth() }), { wrapper })
    await act(() => result.current.save.mutateAsync('skipped'))
    expect(calls).toEqual(['PUT /api/setup', 'GET /api/auth'])
    expect(result.current.auth.setup).toBe('skipped')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'setup'] })
  })

  it('useSaveSetup takes the state from the answer when /api/auth cannot be read again', async () => {
    setAuth({ mode: 'password', authenticated: true, setup: 'pending' })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth') return jsonResponse({ error: { code: 'internal' } }, 500)
      return jsonResponse({ state: 'done', hasData: false, hasAccounts: false })
    }))
    const client = testClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => ({ save: useSaveSetup(), auth: useAuth() }), { wrapper })
    await act(() => result.current.save.mutateAsync('done'))
    expect(result.current.auth.setup).toBe('done')
    expect(result.current.auth.authenticated).toBe(true)
  })
})
