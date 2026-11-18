import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootstrapPassword, loadAuth, login, logout, markUnauthorized, pollTelegramLogin, resetAuth, setAuth, startTelegramLogin } from '../../src/lib/authState'
import { applyFamilyLanguage, currentLanguage } from '../../src/i18n/client'
import { apiFetch } from '../../src/lib/api'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAuth } from '../../src/lib/authState'
import { jsonResponse as json } from '../helpers/http'

/** A failed login with its error worded now. */
async function failure(result: ReturnType<typeof login>) {
  const r = await result
  return r.ok ? r : { ...r, error: r.error() }
}

beforeEach(() => { resetAuth(); sessionStorage.clear() })
afterEach(() => sessionStorage.clear())

describe('authState', () => {
  it('loads the mode from /api/auth and marks a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'password', authenticated: false })))
    const { result } = renderHook(() => useAuth())
    await act(() => loadAuth())
    expect(result.current).toEqual({ mode: 'password', authenticated: false, failed: false, demo: null, me: null, bootstrapOpen: false, setup: null })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    await act(() => loadAuth())
    expect(result.current.failed).toBe(true)
  })

  it('keeps the setup state of /api/auth', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'password', authenticated: true, setup: 'pending' })))
    const { result } = renderHook(() => useAuth())
    await act(() => loadAuth())
    expect(result.current.setup).toBe('pending')
    act(() => markUnauthorized())
    expect(result.current.setup).toBe('pending')
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'password', authenticated: true })))
    await act(() => loadAuth())
    expect(result.current.setup).toBeNull()
  })

  it('login posts the password same-origin and becomes authenticated; wrong password returns the error', async () => {
    const fetchMock = vi.fn(async (url: string) => (url === '/api/auth' ? json({ mode: 'password', authenticated: true }) : json({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAuth())
    await act(async () => { expect(await login('plum-garden-9')).toEqual({ ok: true }) })
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ password: 'plum-garden-9' }) }))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth')
    expect(result.current.authenticated).toBe(true)
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'wrong_password' } }, 401)))
    await act(async () => { expect(await failure(login('x'))).toEqual({ ok: false, error: 'Wrong password', status: 401 }) })
  })

  it('login reports a dropped cookie when /api/auth is still not authenticated after a 200', async () => {
    const fetchMock = vi.fn(async (url: string) => (url === '/api/auth' ? json({ mode: 'password', authenticated: false }) : json({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      expect(await failure(login('plum-garden-9'))).toEqual({ ok: false, status: 0, error: 'The browser did not keep the cookie: open the site at the APP_URL address (https)' })
    })
    expect(result.current.authenticated).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/auth' ? new Response('bad gateway', { status: 502 }) : json({ ok: true }))))
    await act(async () => { expect(await failure(login('plum-garden-9'))).toEqual({ ok: false, status: 502, error: 'Request failed (HTTP 502)' }) })
    expect(result.current.authenticated).toBe(false)
  })

  it('logout and a 401 from apiFetch drop the session', async () => {
    setAuth({ mode: 'password', authenticated: true })
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true })))
    const { result } = renderHook(() => useAuth())
    await act(() => logout())
    expect(result.current.authenticated).toBe(false)
    setAuth({ authenticated: true })
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'unauthorized' } }, 401)))
    await act(async () => { await expect(apiFetch('/api/snapshot')).rejects.toMatchObject({ code: 'unauthorized' }) })
    expect(result.current.authenticated).toBe(false)
    act(() => markUnauthorized())
    expect(result.current.authenticated).toBe(false)
  })

  it('a sign-out the server did not answer keeps the session: the sign-in screen must not hide a live cookie', async () => {
    setAuth({ mode: 'password', authenticated: true })
    const { result } = renderHook(() => useAuth())
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })))
    await act(async () => { await expect(logout()).rejects.toThrow('HTTP 502') })
    expect(result.current.authenticated).toBe(true)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    await act(async () => { await expect(logout()).rejects.toThrow('offline') })
    expect(result.current.authenticated).toBe(true)
  })

  it('loads the demo session: the password hint, the end time and the install link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'demo', authenticated: true, hint: 'demo-family', expiresAt: 1_800_000, installUrl: 'https://example.org' })))
    const { result } = renderHook(() => useAuth())
    await act(() => loadAuth())
    expect(result.current).toEqual({
      mode: 'demo', authenticated: true, failed: false, me: null, bootstrapOpen: false, setup: null,
      demo: { hint: 'demo-family', expiresAt: 1_800_000, installUrl: 'https://example.org', expired: false, restarted: false, families: [], launches: 0 },
    })
  })

  it('moves the demo end time onto the device clock by the server clock', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000_000)
    // the device is 4 000 s ahead of the server: 900 s are left by both clocks
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'demo', authenticated: true, hint: 'h', expiresAt: 1_900_000, now: 1_000_000, installUrl: null })))
    await loadAuth()
    const { result } = renderHook(() => useAuth())
    expect(result.current.demo?.expiresAt).toBe(5_900_000)
  })

  it('in the demo any 401 ends the session in place instead of dropping to the sign-in screen', async () => {
    setAuth({ mode: 'demo', authenticated: true, demo: { hint: 'demo-family', expiresAt: 1_800_000, installUrl: null, expired: false, restarted: false, families: [], launches: 0 } })
    const { result } = renderHook(() => useAuth())
    // the session cookie ran out together with the sandbox: the server no longer sees one
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'unauthorized' } }, 401)))
    await act(async () => { await expect(apiFetch('/api/snapshot')).rejects.toMatchObject({ code: 'unauthorized' }) })
    expect(result.current.authenticated).toBe(true)
    expect(result.current.demo?.expired).toBe(true)
  })

  it('a 401 before the demo sign-in leaves the session not expired', async () => {
    setAuth({ mode: 'demo', authenticated: false, demo: { hint: 'demo-family', expiresAt: null, installUrl: null, expired: false, restarted: false, families: [], launches: 0 } })
    const { result } = renderHook(() => useAuth())
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'unauthorized' } }, 401)))
    await act(async () => { await expect(apiFetch('/api/snapshot')).rejects.toMatchObject({ code: 'unauthorized' }) })
    expect(result.current.demo?.expired).toBe(false)
  })
})

describe('the family language', () => {
  afterEach(async () => { await applyFamilyLanguage('en-US') })

  it('takes the family language from /api/auth', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'password', authenticated: false, language: 'ru-RU' })))
    await loadAuth()
    expect(currentLanguage()).toBe('ru-RU')
    expect(document.documentElement.lang).toBe('ru-RU')
  })

  it('keeps the language when the answer names none or an unknown one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'password', authenticated: false, language: 'xx-XX' })))
    await loadAuth()
    expect(currentLanguage()).toBe('en-US')
  })
})

describe('authState with users', () => {
  it('/api/auth fills me', async () => {
    const me = { name: 'Anna', rights: { edit: true, vote: true, manage: false } }
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'telegram', authenticated: true, me })))
    const { result } = renderHook(() => useAuth())
    await act(() => loadAuth())
    expect(result.current).toMatchObject({ mode: 'telegram', authenticated: true, me })
  })

  it('starts a Telegram sign-in and words the failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ link: 'https://t.me/bot?start=login_1' })))
    expect(await startTelegramLogin()).toEqual({ ok: true, link: 'https://t.me/bot?start=login_1' })
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'bot_not_configured' } }, 409)))
    const r = await startTelegramLogin()
    expect(r.ok ? '' : r.error()).toBe('The Telegram bot is not ready yet. Try again in a minute')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', { status: 429 })))
    const limited = await startTelegramLogin()
    expect(limited.ok ? '' : limited.error()).toBe('Too many attempts. Wait a minute')
  })

  it('polling reports waiting and expired, and on done signs in with the person', async () => {
    const me = { name: 'Anna', rights: { edit: true, vote: true, manage: false } }
    let status = 'waiting'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/auth'
      ? json(status === 'done' ? { mode: 'telegram', authenticated: true, me } : { mode: 'telegram', authenticated: false })
      : json({ status }))))
    const { result } = renderHook(() => useAuth())
    expect(await pollTelegramLogin()).toBe('waiting')
    status = 'expired'
    await act(async () => { expect(await pollTelegramLogin()).toBe('expired') })
    expect(result.current.authenticated).toBe(false)
    status = 'done'
    await act(async () => { expect(await pollTelegramLogin()).toBe('done') })
    expect(result.current).toMatchObject({ authenticated: true, me })
  })

  it('a done whose follow-up read failed is still done on the next look, which the server calls expired', async () => {
    const me = { name: 'Anna', rights: { edit: true, vote: true, manage: false } }
    let status = 'done'
    let authUp = false
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url !== '/api/auth') return json({ status })
      return authUp ? json({ mode: 'telegram', authenticated: true, me }) : new Response('bad gateway', { status: 502 })
    }))
    const { result } = renderHook(() => useAuth())
    await expect(pollTelegramLogin()).rejects.toThrow()
    // the attempt is gone after its done; the cookie is set all the same
    status = 'expired'
    await act(async () => { expect(await pollTelegramLogin()).toBe('expired') })
    expect(result.current.failed).toBe(false)
    authUp = true
    await act(async () => { expect(await pollTelegramLogin()).toBe('done') })
    expect(result.current).toMatchObject({ authenticated: true, me })
  })

  it('a 403 for a missing right reads the person\'s rights again', async () => {
    const before = { name: 'Anna', rights: { edit: true, vote: true, manage: true } }
    const after = { name: 'Anna', rights: { edit: true, vote: true, manage: false } }
    setAuth({ mode: 'telegram', authenticated: true, me: before })
    const fetchMock = vi.fn(async (url: string) => (url === '/api/auth'
      ? json({ mode: 'telegram', authenticated: true, me: after })
      : json({ error: { code: 'no_right_manage' } }, 403)))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAuth())
    await act(async () => { await expect(apiFetch('/api/settings', { method: 'PUT' })).rejects.toMatchObject({ code: 'no_right_manage' }) })
    await waitFor(() => expect(result.current.me).toEqual(after))

    // another refusal reads nothing again
    fetchMock.mockClear()
    fetchMock.mockImplementation(async () => json({ error: { code: 'invalid_value' } }, 403))
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ code: 'invalid_value' })
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['/api/x'])
  })
})

describe('a sign-in takes the setup state', () => {
  it('a password sign-in on a fresh page keeps setup pending, so the wizard shows', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/auth'
      ? json({ mode: 'password', authenticated: true, setup: 'pending' })
      : json({ ok: true }))))
    const { result } = renderHook(() => useAuth())
    await act(async () => { expect(await login('plum-garden-9')).toEqual({ ok: true }) })
    expect(result.current.setup).toBe('pending')
  })

  it('a Telegram sign-in keeps setup pending', async () => {
    const me = { name: 'Anna', rights: { edit: true, vote: true, manage: true } }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/auth'
      ? json({ mode: 'telegram', authenticated: true, me, setup: 'pending' })
      : json({ status: 'done' }))))
    const { result } = renderHook(() => useAuth())
    await act(async () => { expect(await pollTelegramLogin()).toBe('done') })
    expect(result.current).toMatchObject({ authenticated: true, me, setup: 'pending' })
  })
})

it('keeps the browser-selected language through bootstrap and initial pending setup without settings writes', async () => {
  await applyFamilyLanguage('ru-RU')
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => json({ mode: 'bootstrap', authenticated: false, language: 'en-US' }))
  vi.stubGlobal('fetch', fetchMock)
  await loadAuth()
  expect(currentLanguage()).toBe('ru-RU')
  fetchMock.mockImplementation(async () => json({ ok: true }))
  await bootstrapPassword('long family password')
  fetchMock.mockImplementation(async () => json({ mode: 'password', authenticated: true, setup: 'pending', language: 'en-US' }))
  await loadAuth()
  expect(currentLanguage()).toBe('ru-RU')
  expect(fetchMock.mock.calls.every(call => ['/api/auth', '/api/auth/bootstrap'].includes(call[0]))).toBe(true)
  await applyFamilyLanguage('en-US')
})

it('carries the bootstrap locale across a fresh auth load and clears it after setup', async () => {
  await applyFamilyLanguage('ru-RU')
  vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true })))
  expect(await bootstrapPassword('long family password')).toEqual({ ok: true })
  resetAuth()
  await applyFamilyLanguage('en-US')
  vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'password', authenticated: true, setup: 'pending', language: 'en-US' })))
  await loadAuth()
  expect(currentLanguage()).toBe('ru-RU')
  vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'password', authenticated: true, setup: 'done', language: 'en-US' })))
  await loadAuth()
  expect(currentLanguage()).toBe('en-US')
  await applyFamilyLanguage('ru-RU')
  vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'password', authenticated: true, setup: 'pending', language: 'en-US' })))
  await loadAuth()
  expect(currentLanguage()).toBe('en-US')
})
