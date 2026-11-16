import { LANGUAGES, languageName } from '../../src/i18n/languages'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import App from '../../src/App'
import { LanguageMenu } from '../../src/components/layout/LanguageMenu'
import { currentLanguage, i18n, applyFamilyLanguage } from '../../src/i18n/client'
import { Login } from '../../src/pages/Login'
import { queryClient } from '../../src/lib/queryClient'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { snapshotQueryKey } from '../../src/lib/useFinanceData'
import { jsonResponse } from '../helpers/http'
import { makeSnapshot } from '../helpers/snapshot'
import { testClient } from '../helpers/render'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))
vi.mock('echarts-for-react/esm/core', () => import('../helpers/echartsStub'))

const russian = languageName('ru-RU')

// the environment's own localStorage is not usable in Node 25+ (see tests/i18n/client.test.ts)
let stored: Map<string, string>
beforeEach(() => {
  stored = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => { stored.set(k, String(v)) },
  })
})

afterEach(async () => {
  await applyFamilyLanguage('en-US')
})

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Language' }))
}

describe('LanguageMenu', () => {
  it('opening the menu loads no other language: the names come from Intl', async () => {
    // the test setup may have loaded Russian already: start without it
    i18n.removeResourceBundle('ru-RU', 'translation')
    render(<LanguageMenu />)
    openMenu()
    expect(await screen.findByRole('menuitemradio', { name: russian })).toBeInTheDocument()
    expect(i18n.hasResourceBundle('ru-RU', 'translation')).toBe(false)
  })

  it('lists the languages by their own names and marks the current one', async () => {
    render(<LanguageMenu />)
    openMenu()
    expect(await screen.findByRole('menuitemradio', { name: russian })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(LANGUAGES.length)
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true')
  })

  it('choosing Russian switches the language and the document lang', async () => {
    render(<QueryClientProvider client={testClient()}><LanguageMenu /></QueryClientProvider>)
    openMenu()
    fireEvent.click(await screen.findByRole('menuitemradio', { name: russian }))
    await waitFor(() => expect(currentLanguage()).toBe('ru-RU'))
    expect(document.documentElement.lang).toBe('ru-RU')
    expect(stored.size).toBe(0)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens on the current language and ArrowDown cycles through the list', async () => {
    render(<LanguageMenu />)
    openMenu()
    const english = screen.getByRole('menuitemradio', { name: 'English' })
    expect(document.activeElement).toBe(english)
    fireEvent.keyDown(english, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(await screen.findByRole('menuitemradio', { name: russian }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(english)
  })

  it('Escape closes the menu and returns focus to the button', () => {
    render(<LanguageMenu />)
    openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Language' }))
  })
})

describe('LanguageMenu active language', () => {
  // the spies go before the file's afterEach switches back to English, which needs the real changeLanguage
  afterEach(() => vi.restoreAllMocks())
  it('choosing the language that is already active does nothing: no switch, and the next menu does not take the focus', () => {
    const change = vi.spyOn(i18n, 'changeLanguage')
    const first = render(<LanguageMenu />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }))
    expect(change).not.toHaveBeenCalled()
    expect(currentLanguage()).toBe('en-US')
    first.unmount()
    render(<LanguageMenu />)
    expect(document.activeElement).toBe(document.body)
  })
})

describe('Login screen', () => {
  beforeEach(() => setAuth({ mode: 'demo', authenticated: false, demo: { hint: 'demo-family', expiresAt: null, installUrl: null, expired: false, restarted: false } }))
  afterEach(() => resetAuth())

  it('offers the language menu before signing in (the demo)', () => {
    render(<Login />)
    expect(screen.getByRole('button', { name: 'Language' })).toBeInTheDocument()
  })

  it('a switch on the login screen does not make the menu that mounts later take the focus', async () => {
    const login = render(<Login />)
    openMenu()
    fireEvent.click(await screen.findByRole('menuitemradio', { name: russian }))
    await waitFor(() => expect(currentLanguage()).toBe('ru-RU'))
    login.unmount() // signing in replaces the login screen with the app
    render(<LanguageMenu />)
    expect(document.activeElement).toBe(document.body)
  })
})

describe('LanguageMenu failures', () => {
  // the spies go before the file's afterEach switches back to English, which needs the real changeLanguage
  afterEach(() => vi.restoreAllMocks())
  it('a locale that fails to switch keeps the current language and reports it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(i18n, 'changeLanguage').mockRejectedValue(new Error('chunk failed'))
    render(<LanguageMenu />)
    openMenu()
    fireEvent.click(await screen.findByRole('menuitemradio', { name: russian }))
    await waitFor(() => expect(log).toHaveBeenCalledWith('[language] switch failed', expect.any(Error)))
    expect(currentLanguage()).toBe('en-US')
    expect(screen.getByRole('button', { name: 'Language' })).toBeInTheDocument()
  })
})

describe('a language change inside the app', () => {
  beforeEach(() => {
    resetAuth()
    queryClient.clear()
    window.history.replaceState(null, '', '/assets')
  })
  afterEach(() => queryClient.clear())

  it('preserves shell identity, route and cached snapshot while switching language without reloading', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/auth') return jsonResponse({ mode: 'password', authenticated: true })
      if (url === '/api/snapshot') return jsonResponse(makeSnapshot())
      return jsonResponse({ error: 'unavailable' }, 503)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('scrollTo', vi.fn())
    queryClient.setQueryData(snapshotQueryKey(null), makeSnapshot())

    render(<App />)
    await waitFor(() => expect(document.querySelector('.title-row')).not.toBeNull())
    const snapshotCalls = () => fetchMock.mock.calls.filter(([u]) => String(u) === '/api/snapshot').length
    expect(snapshotCalls()).toBe(0)

    const rowBefore = document.querySelector('.title-row')
    expect(rowBefore).not.toBeNull()
    await act(() => applyFamilyLanguage('ru-RU')) // the family language arrives from the server
    await waitFor(() => expect(currentLanguage()).toBe('ru-RU'))
    // Language changes redraw the app without replacing the shell or its retained editors.
    expect(document.querySelector('.title-row')).toBe(rowBefore)
    expect(rowBefore!.isConnected).toBe(true)
    expect(document.documentElement.lang).toBe('ru-RU')

    expect(window.location.pathname).toBe('/assets')
    expect(snapshotCalls()).toBe(0)
    expect(queryClient.getQueryData(snapshotQueryKey(null))).toBeDefined()
  })
})
