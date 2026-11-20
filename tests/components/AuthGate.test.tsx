import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { AuthGate } from '../../src/components/AuthGate'
import { apiFetch } from '../../src/lib/api'
import { markUnauthorized, resetAuth } from '../../src/lib/authState'
import { jsonResponse as json } from '../helpers/http'
import { ru, withLanguage } from '../helpers/i18n'
import { renderWithClient as render, testClient } from '../helpers/render'

// the login form belongs to the login screen: find it by structure, not by its wording
const passwordField = () => document.querySelector<HTMLInputElement>('input[type="password"]')
const waitForLogin = () => waitFor(() => expect(passwordField()).not.toBeNull())

beforeEach(() => resetAuth())

describe('AuthGate', () => {
  it('shows the login screen in password mode and the app after login, keeping the URL', async () => {
    window.history.replaceState(null, '', '/close')
    let loggedIn = false
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/login') loggedIn = true
      return url === '/api/auth' ? json({ mode: 'password', authenticated: loggedIn }) : json({ ok: true })
    }))
    render(<AuthGate><div>App</div></AuthGate>)
    await waitForLogin()
    expect(window.location.pathname).toBe('/close')
    fireEvent.change(passwordField()!, { target: { value: 'secret-pass' } })
    fireEvent.click(document.querySelector('button[type="submit"]')!)
    expect(await screen.findByText('App')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/close')
  })

  it('renders the app straight away when authenticated and returns to login on a later 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'password', authenticated: true })))
    render(<AuthGate><div>App</div></AuthGate>)
    expect(await screen.findByText('App')).toBeInTheDocument()
    act(() => markUnauthorized())
    await waitForLogin()
  })

  it('clears the query cache when the session ends, so the next login starts fresh', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'password', authenticated: true })))
    const client = testClient()
    client.setQueryData(['snapshot'], { capital: 1 })
    render(<AuthGate><div>App</div></AuthGate>, { client })
    expect(await screen.findByText('App')).toBeInTheDocument()
    expect(client.getQueryData(['snapshot'])).toEqual({ capital: 1 })
    act(() => markUnauthorized())
    await waitForLogin()
    expect(client.getQueryData(['snapshot'])).toBeUndefined()
    expect(client.getQueryCache().getAll()).toHaveLength(0)
  })

  it('returns to the login screen when a 401 arrives through apiFetch', async () => {
    // the session is gone on the server: /api/auth, read again after the 401, says so too
    let signedIn = true
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url !== '/api/snapshot') return json({ mode: 'password', authenticated: signedIn })
      signedIn = false
      return json({ error: { code: 'unauthorized' } }, 401)
    }))
    render(<AuthGate><div>App</div></AuthGate>)
    expect(await screen.findByText('App')).toBeInTheDocument()
    await act(async () => { await expect(apiFetch('/api/snapshot')).rejects.toMatchObject({ code: 'unauthorized' }) })
    await waitForLogin()
    expect(screen.queryByText('App')).not.toBeInTheDocument()
  })

  it('after a 401 the sign-in screen takes the mode the server has now (switched on another device)', async () => {
    let mode = 'password'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url !== '/api/snapshot') return json({ mode, authenticated: mode === 'password' })
      mode = 'telegram'
      return json({ error: { code: 'unauthorized' } }, 401)
    }))
    render(<AuthGate><div>App</div></AuthGate>)
    expect(await screen.findByText('App')).toBeInTheDocument()
    await act(async () => { await expect(apiFetch('/api/snapshot')).rejects.toMatchObject({ code: 'unauthorized' }) })
    // the Telegram sign-in, not the password form that would answer "wrong mode"
    expect(await screen.findByRole('button', { name: 'Sign in with Telegram' })).toBeInTheDocument()
    expect(passwordField()).toBeNull()
  })

  it('explains a dead server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    render(<AuthGate><div>App</div></AuthGate>)
    expect(await screen.findByRole('alert')).toHaveTextContent('The server is unavailable')
  })

  it('shows its messages in the language chosen later, without a reload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    render(<AuthGate><div>App</div></AuthGate>)
    expect(await screen.findByRole('alert')).toHaveTextContent('The server is unavailable')
    await withLanguage('ru-RU', async () => {
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(ru('auth.serverDown')))
    })
  })

  it('shows the Telegram button in telegram mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'telegram', authenticated: false, me: null })))
    render(<AuthGate><div>App</div></AuthGate>)
    expect(await screen.findByRole('button', { name: 'Sign in with Telegram' })).toBeInTheDocument()
  })

  it('mode bootstrap draws Login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'bootstrap', authenticated: false, me: null, bootstrapOpen: true })))
    render(<AuthGate><div>App</div></AuthGate>)
    expect(await screen.findByRole('button', { name: 'Save and sign in' })).toBeInTheDocument()
  })
})

describe('AuthGate and the identity provider', () => {
  const signedIn = (name: string) => vi.stubGlobal('fetch', vi.fn(async () =>
    json({ mode: 'oidc', authenticated: true, me: { name, rights: { edit: true, vote: true, manage: false } }, provider: 'auth.example.org' })))

  it('after an invitation, says who is signed in now and takes the code out of the address', async () => {
    window.history.replaceState(null, '', '/?oidc_invite=bound')
    signedIn('Ben')
    render(<AuthGate><div>App</div></AuthGate>, { notify: true })
    // the toast and its announcement for screen readers
    expect((await screen.findAllByText('Your account at auth.example.org is linked. You are signed in as Ben.')).length).toBeGreaterThan(0)
    expect(window.location.search).toBe('')
  })

  it('a refusal that comes back to a signed-in person is said too', async () => {
    window.history.replaceState(null, '', '/?sign_in_error=oidc_taken')
    signedIn('Anna')
    render(<AuthGate><div>App</div></AuthGate>, { notify: true })
    expect(await screen.findByText('This account at the identity provider is already linked to another member.')).toBeInTheDocument()
  })

  it('a broken invitation link says the invitation is invalid instead of failing the page', async () => {
    window.history.replaceState(null, '', '/invite/oidc/%E0%A4%A')
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'oidc', authenticated: false, provider: 'auth.example.org' })))
    render(<AuthGate><div>App</div></AuthGate>)
    expect(await screen.findByText('This invitation is used, expired or replaced. Ask for a new one')).toBeInTheDocument()
    window.history.replaceState(null, '', '/')
  })
})
