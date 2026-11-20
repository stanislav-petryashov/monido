import { languageName } from '../../src/i18n/languages'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { Login } from '../../src/pages/Login'
import { DEMO_FAMILY_CARDS } from '../../src/demo/family'
import { resetAuth, setAuth, useAuth } from '../../src/lib/authState'
import { jsonResponse as json } from '../helpers/http'
import { ru, withLanguage } from '../helpers/i18n'

afterEach(() => { resetAuth(); sessionStorage.removeItem('fc.bootstrapLanguage') })

describe('Login', () => {
  it('names the browser tab in the UI language, following a switch', async () => {
    document.title = ''
    render(<Login />)
    expect(document.title).toBe('Monido')
    await withLanguage('ru-RU', () => waitFor(() => expect(document.title).toBe(ru('app.title'))))
  })

  it('shows the typed password on request and hides it again', () => {
    render(<Login />)
    const field = screen.getByLabelText('Password')
    const eye = screen.getByRole('button', { name: 'Show password' })
    expect(field).toHaveAttribute('type', 'password')
    fireEvent.click(eye)
    expect(field).toHaveAttribute('type', 'text')
    expect(eye).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(eye)
    expect(field).toHaveAttribute('type', 'password')
  })

  it('names the field by its caption alone, not with the eye inside the same label', () => {
    render(<Login />)
    const field = screen.getByLabelText('Password')
    expect(document.getElementById(field.getAttribute('aria-labelledby') ?? '')).toHaveTextContent(/^Password$/)
  })

  it('reads where the password lives with the field, and the error once there is one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'wrong_password' } }, 401)))
    render(<Login />)
    const field = screen.getByLabelText('Password')
    const described = () => (field.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent)
    expect(described()).toEqual([expect.stringContaining('Forgot the password?')])
    fireEvent.change(field, { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    expect(described()).toEqual([expect.stringContaining('Forgot the password?'), 'Wrong password'])
  })

  it('submits the password and shows the server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'wrong_password' } }, 401)))
    render(<Login />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Wrong password'))
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('words the error again in the new language after a switch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'wrong_password' } }, 401)))
    render(<Login />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Wrong password'))
    await withLanguage('ru-RU', () => waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(ru('errors.wrong_password'))))
  })

  it('explains a cookie the browser did not keep (https APP_URL opened over http)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/auth' ? json({ mode: 'password', authenticated: false }) : json({ ok: true }))))
    render(<Login />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The browser did not keep the cookie: open the site at the APP_URL address (https)'))
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('tells the user to wait on 429 and does not submit an empty password', async () => {
    const fetchMock = vi.fn(async () => json({ error: { code: 'too_many_attempts' } }, 429))
    vi.stubGlobal('fetch', fetchMock)
    render(<Login />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts. Wait a minute'))
  })
})

describe('Login forgot line', () => {
  it('the password screen shows the new forgot line, no .env', () => {
    render(<Login />)
    expect(screen.getByText(/Forgot the password\?/)).toHaveTextContent('Ask the family member who manages the settings')
    expect(document.body.textContent).not.toContain('.env')
  })
})

describe('Login in bootstrap', () => {
  const fields = () => [screen.getByLabelText('Family password'), screen.getByLabelText('Repeat the password')]
  const fill = (a: string, b: string) => {
    const [first, second] = fields()
    fireEvent.change(first, { target: { value: a } })
    fireEvent.change(second, { target: { value: b } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and sign in' }))
  }
  beforeEach(() => setAuth({ mode: 'bootstrap', authenticated: false, bootstrapOpen: true }))

  it('open: two new-password fields, the hint, mismatch and too-short shown as alerts, no request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<Login />)
    expect(fields().map(f => f.getAttribute('autocomplete'))).toEqual(['new-password', 'new-password'])
    expect(screen.getByText('At least 12 characters.')).toBeInTheDocument()
    fill('short', 'short')
    expect(screen.getByRole('alert')).toHaveTextContent('The password must be at least 12 characters')
    fill('long enough password', 'another long password')
    expect(screen.getByRole('alert')).toHaveTextContent('The two passwords do not match')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('open: success posts { password } and reads /api/auth again', async () => {
    const fetchMock = vi.fn<(url: string, init: { body: string }) => Promise<Response>>(async url => (url === '/api/auth' ? json({ mode: 'password', authenticated: true }) : json({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    // one reader of the auth state for the whole test, rendered before the change it waits for
    const auth = renderHook(() => useAuth()).result
    render(<Login />)
    fill('long enough password', 'long enough password')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth'))
    const post = fetchMock.mock.calls.find(c => c[0] === '/api/auth/bootstrap')!
    expect(JSON.parse(post[1].body)).toEqual({ password: 'long enough password' })
    await waitFor(() => expect(auth.current.authenticated).toBe(true))
  })

  it('a bootstrap_closed answer switches the card to the closed state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'bootstrap_closed' } }, 409)))
    render(<Login />)
    fill('long enough password', 'long enough password')
    expect(await screen.findByText('The time to set the password has passed')).toBeInTheDocument()
    expect(screen.queryByLabelText('Family password')).toBeNull()
  })

  it('counts code points: 12 emoji pass the client check', async () => {
    const fetchMock = vi.fn(async (url: string) => (url === '/api/auth' ? json({ mode: 'password', authenticated: true }) : json({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    render(<Login />)
    const emoji = '😀'.repeat(12)
    fill(emoji, emoji)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/bootstrap', expect.anything()))
  })

  it('closed: the restart text with the command in <code>, no fields; Try again reads /api/auth', async () => {
    setAuth({ mode: 'bootstrap', authenticated: false, bootstrapOpen: false })
    const fetchMock = vi.fn(async () => json({ mode: 'bootstrap', authenticated: false, bootstrapOpen: true }))
    vi.stubGlobal('fetch', fetchMock)
    render(<Login />)
    expect(screen.queryByLabelText('Family password')).toBeNull()
    expect(screen.getByText('docker compose restart app').tagName).toBe('CODE')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth'))
    expect(await screen.findByLabelText('Family password')).toBeInTheDocument()
  })
})

describe('Login language menu', () => {
  it('offers a browser-local language choice before family sign-in', () => {
    render(<Login />)
    expect(screen.getByRole('button', { name: 'Language' })).toBeInTheDocument()
  })
})

describe('Login in the demo', () => {
  const DEMO = { hint: 'demo-family', expiresAt: null, installUrl: null, expired: false, restarted: false, families: DEMO_FAMILY_CARDS, launches: 0 }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T09:00:00Z'))
    setAuth({ mode: 'demo', authenticated: false, demo: DEMO })
  })
  afterEach(() => vi.useRealTimers())

  it('lists every family in its own words, the chosen one checked; picking one switches the language; no menu in the corner', async () => {
    render(<Login />)
    expect(screen.queryByRole('button', { name: 'Language' })).toBeNull()
    const group = screen.getByRole('group', { name: 'Family' })
    const rows = within(group).getAllByRole('radio')
    expect(rows).toHaveLength(7)
    expect(screen.getByRole('radio', { name: /English/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /English/ }).closest('label')).toHaveTextContent('EnglishRyan and Annika, USA$ €')
    const russian = DEMO_FAMILY_CARDS[1]
    expect(screen.getByRole('radio', { name: new RegExp(languageName('ru-RU')) }).closest('label')).toHaveTextContent(`${russian.members[0]}`)
    expect(screen.getByRole('radio', { name: new RegExp(languageName('ru-RU')) }).closest('label')).toHaveTextContent(russian.place)
    expect(screen.getByRole('radio', { name: /中文/ }).closest('label')).toHaveTextContent('周然和林悦，中国')
    await withLanguage('en-US', async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Deutsch/ }))
      await waitFor(() => expect(screen.getByRole('radio', { name: /Deutsch/ })).toBeChecked())
    })
  })

  it('while a language loads, the sign-in and the other families wait for it', async () => {
    render(<Login />)
    await withLanguage('en-US', async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Deutsch/ }))
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
      // the rows stay focusable (aria-disabled) and ignore a pick while the switch runs
      expect(screen.getByRole('radio', { name: /Español/ })).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(screen.getByRole('radio', { name: /Español/ }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Anmelden' })).toBeEnabled())
      expect(screen.getByRole('radio', { name: /Deutsch/ })).toBeChecked()
      expect(screen.getByRole('radio', { name: /Español/ })).not.toHaveAttribute('aria-disabled')
    })
  })

  it('fills the password in and says so; sends it with the language shown on the screen', async () => {
    const fetchMock = vi.fn<(url: string, init: { body: string }) => Promise<Response>>(async url => (url === '/api/auth' ? json({ mode: 'demo', authenticated: true, hint: 'demo-family' }) : json({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    await withLanguage('ru-RU', async () => {
      render(<Login />)
      expect(screen.getByLabelText(ru('auth.password'))).toHaveValue('demo-family')
      fireEvent.click(screen.getByRole('button', { name: ru('auth.signIn') }))
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ password: 'demo-family', language: 'ru-RU' })
  })

  it('names the password in a note under the field, in <code>, and shows no notice', async () => {
    render(<Login />)
    const code = screen.getByText('demo-family')
    expect(code.tagName).toBe('CODE')
    expect(code.closest('p')).toHaveTextContent('The demo password is demo-family. It is already filled in: just press Sign in.')
    expect(screen.queryByRole('status')).toBeNull()
    await withLanguage('ru-RU', () => {
      const line = ru('demo.login.passwordNote', { password: 'demo-family' }).replace(/<\/?code>/g, '')
      return waitFor(() => expect(screen.getByText('demo-family').closest('p')?.textContent).toBe(line))
    })
  })

  it('the pitch: the headline and three facts; the third counts the launches from the first one', () => {
    const { unmount } = render(<Login />)
    expect(screen.getByRole('heading', { level: 1, name: "A family's money, end to end." })).toBeInTheDocument()
    expect(screen.getByRole('list').textContent).toBe('7families, one per language15minutes in a private copy0to install')
    unmount()
    setAuth({ mode: 'demo', authenticated: false, demo: { ...DEMO, launches: 1 } })
    const second = render(<Login />)
    expect(screen.getByRole('list')).toHaveTextContent('1demo opened')
    second.unmount()
    setAuth({ mode: 'demo', authenticated: false, demo: { ...DEMO, launches: 1284 } })
    render(<Login />)
    expect(screen.getByRole('list')).toHaveTextContent('1,284demos opened')
  })

  it('says the demo was restarted when Start over found the server no longer knows the visitor', async () => {
    setAuth({ mode: 'demo', authenticated: false, demo: { ...DEMO, restarted: true } })
    render(<Login />)
    expect(screen.getByRole('status')).toHaveTextContent('The demo was restarted. Sign in again')
    await withLanguage('ru-RU', () => waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(ru('demo.login.restarted'))))
  })

  it('says how long to wait when the demo is busy, updating or over the limit for the network', async () => {
    const cases = [
      [503, 'demo_busy', 300, 'The demo is busy right now. Try again in about 5 minutes'],
      [503, 'demo_updating', 30, 'The demo is being updated. Try again in about 1 minute'],
      [429, 'demo_ip_limit', 601, 'Too many demo sessions from your network. Try again in about 11 minutes'],
    ] as const
    for (const [status, code, retryAfter, text] of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code, params: { retryAfter } } }, status)))
      const { unmount } = render(<Login />)
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(text))
      unmount()
    }
  })

  it('words the wait in Russian with the plural form of the minutes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'demo_busy', params: { retryAfter: 300 } } }, 503)))
    render(<Login />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('about 5 minutes'))
    await withLanguage('ru-RU', () => waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(ru('errors.demo_busy', { count: 5 }))))
    expect(ru('errors.demo_busy', { count: 5 })).not.toBe(ru('errors.demo_busy', { count: 2 }))
  })

  it('signs in and keeps the end time of the session, the families and the count', async () => {
    const expiresAt = Date.parse('2026-10-21T09:15:00Z')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/auth'
      ? json({ mode: 'demo', authenticated: true, hint: 'demo-family', expiresAt, now: Date.now(), installUrl: null, families: DEMO_FAMILY_CARDS, launches: 7 })
      : json({ ok: true, expiresAt, now: Date.now() }))))
    const auth = renderHook(() => useAuth()).result
    render(<Login />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(auth.current.authenticated).toBe(true))
    expect(auth.current.demo).toEqual({ hint: 'demo-family', expiresAt, installUrl: null, expired: false, restarted: false, families: DEMO_FAMILY_CARDS, launches: 7 })
  })
})

describe('Login outside the demo', () => {
  it('shows no demo texts', () => {
    setAuth({ mode: 'password', authenticated: false, demo: null })
    render(<Login />)
    expect(screen.queryByText(/Demo password/)).toBeNull()
    expect(screen.queryByText(/fictional/)).toBeNull()
  })
})

describe('Login in telegram mode', () => {
  const me = { name: 'Anna', rights: { edit: true, vote: true, manage: false } }
  const LINK = 'https://t.me/family_bot?start=login_abc'
  let status: string
  let open: ReturnType<typeof vi.fn>
  beforeEach(() => {
    status = 'waiting'
    open = vi.fn()
    vi.stubGlobal('open', open)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    setAuth({ mode: 'telegram', authenticated: false })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/telegram' && init?.method === 'POST') return json({ link: LINK })
      if (url === '/api/auth/telegram') return json({ status })
      // the session cookie exists only once the bot confirmed
      return json(status === 'done' ? { mode: 'telegram', authenticated: true, me } : { mode: 'telegram', authenticated: false })
    }))
  })
  afterEach(() => { vi.useRealTimers() })

  async function press() {
    render(<Login />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Telegram' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  }

  it('shows only the Telegram button, then the link while it waits, and signs in on done', async () => {
    const auth = renderHook(() => useAuth()).result
    await press()
    expect(document.querySelector('input[type="password"]')).toBeNull()
    expect(open).toHaveBeenCalledWith(LINK, '_blank', 'noopener')
    expect(screen.getByRole('link', { name: 'Open Telegram' })).toHaveAttribute('href', LINK)
    expect(screen.getByText(/Waiting for your confirmation/)).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(auth.current.authenticated).toBe(false)
    status = 'done'
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(auth.current).toMatchObject({ authenticated: true, me })
  })

  it('an expired attempt offers to start again, and stops polling', async () => {
    await press()
    status = 'expired'
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.getByText('The sign-in request has expired.')).toBeInTheDocument()
    const calls = vi.mocked(fetch).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls)
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('stops polling when the screen goes away', async () => {
    const view = render(<Login />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Telegram' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    view.unmount()
    const calls = vi.mocked(fetch).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls)
  })

  it('says so when the bot is not ready', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'bot_not_configured' } }, 409)))
    await press()
    expect(screen.getByRole('alert')).toHaveTextContent('The Telegram bot is not ready yet')
    expect(open).not.toHaveBeenCalled()
  })
})

it('offers language before bootstrap and rewords its password error without writing settings', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  setAuth({ mode: 'bootstrap', authenticated: false, bootstrapOpen: true })
  render(<Login />)
  fireEvent.change(screen.getByLabelText('Family password'), { target: { value: 'short' } })
  fireEvent.change(screen.getByLabelText('Repeat the password'), { target: { value: 'short' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save and sign in' }))
  expect(screen.getByRole('alert')).toHaveTextContent('The password must be at least 12 characters')
  fireEvent.click(screen.getByRole('button', { name: 'Language' }))
  fireEvent.click(await screen.findByRole('menuitemradio', { name: languageName('ru-RU') }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(ru('errors.password_too_short')))
  expect(screen.getByLabelText(ru('auth.bootstrap.password'))).toHaveValue('short')
  expect(fetchMock).not.toHaveBeenCalled()
  await withLanguage('en-US', async () => {})
})

describe('Login in the provider mode', () => {
  afterEach(() => { window.history.replaceState(null, '', '/') })

  it('shows one button that goes to the provider with the current page to come back to', () => {
    window.history.replaceState(null, '', '/goals?view=year')
    setAuth({ mode: 'oidc', authenticated: false, provider: 'auth.example.org' })
    render(<Login />)
    const button = screen.getByRole('link', { name: 'Sign in with auth.example.org' })
    expect(button).toHaveAttribute('href', `/api/auth/oidc/start?return=${encodeURIComponent('/goals?view=year')}`)
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('says why a sign-in came back refused, and takes the code out of the address', () => {
    window.history.replaceState(null, '', '/?sign_in_error=oidc_not_linked')
    setAuth({ mode: 'oidc', authenticated: false, provider: 'auth.example.org' })
    render(<Login />)
    expect(screen.getByRole('alert')).toHaveTextContent('This account is not linked to anyone in the family. Ask whoever manages Monido for an invitation.')
    expect(window.location.search).toBe('')
  })

  it('after an invitation accepted before the switch, says the account is linked', () => {
    window.history.replaceState(null, '', '/?oidc_invite=bound')
    setAuth({ mode: 'password', authenticated: false, provider: 'auth.example.org' })
    render(<Login />)
    expect(screen.getByRole('status')).toHaveTextContent('Your account at auth.example.org is linked.')
  })
})
