import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { AuthSettingsView, UserView } from '../../src/domain/api'
import { OidcSwitch } from '../../src/pages/settings/OidcSwitch'
import { SignInSettings } from '../../src/pages/settings/SignInSettings'
import { authSettingsView } from '../helpers/authSettings'
import { browser } from '../../src/lib/browser'
import { jsonResponse } from '../helpers/http'
import { renderAdmin } from '../helpers/render'

const anna: UserView = { id: 1, member: 'Anna', telegram: null, invitePending: false, rights: { manage: true, edit: true, vote: true }, identity: false }
const ben: UserView = { id: 2, member: 'Ben', telegram: null, invitePending: false, rights: { manage: false, edit: true, vote: true }, identity: false }
const READY: AuthSettingsView['switchToOidc'] = {
  configured: true, problem: null, provider: 'auth.example.org', redirectUri: 'https://money.test/api/auth/oidc/callback', linkedManager: false, proof: null,
}

function stub(view: AuthSettingsView) {
  const calls: { url: string; method: string; body: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET'
    if (method !== 'GET') calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (url === '/api/auth-settings') return jsonResponse(view)
    if (url === '/api/users') return jsonResponse({ users: [anna, ben], mode: view.mode, meId: null, bot: { configured: false, username: null, problem: null }, provider: 'auth.example.org' })
    if (url === '/api/auth/oidc/test') return jsonResponse({ url: 'https://auth.example.org/authorize?x=1' })
    return jsonResponse({ ok: true })
  }))
  return calls
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/') })

describe('the switch to the provider', () => {
  it('shows the redirect URI to register and starts the test sign-in for the chosen manager', async () => {
    const calls = stub(authSettingsView({ switchToOidc: READY }))
    const assign = vi.spyOn(browser, 'go').mockImplementation(() => {})
    window.history.replaceState(null, '', '/settings/access')
    renderAdmin(<OidcSwitch view={authSettingsView({ switchToOidc: READY })} />)
    expect(screen.getByText('https://money.test/api/auth/oidc/callback')).toBeInTheDocument()
    const button = await screen.findByRole('button', { name: 'Test sign-in at auth.example.org' })
    // the managers come with the users list: until then there is nobody to sign in as
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://auth.example.org/authorize?x=1'))
    expect(calls).toEqual([{ url: '/api/auth/oidc/test', method: 'POST', body: { userId: 1, return: '/settings/access' } }])
  })

  it('after the test sign-in, says who confirmed and switches with the family password', async () => {
    const view = authSettingsView({ switchToOidc: { ...READY, linkedManager: true, proof: { member: 'Anna', manage: true, provider: 'Anna Example' } } })
    const calls = stub(view)
    renderAdmin(<OidcSwitch view={view} />)
    expect(screen.getByText('Anna confirmed, signed in at auth.example.org as Anna Example')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Current family password'), { target: { value: 'a family password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Switch to auth.example.org' }))
    await waitFor(() => expect(calls).toContainEqual({ url: '/api/auth-settings/mode', method: 'POST', body: { mode: 'oidc', current: 'a family password' } }))
  })

  it('names what is missing in the setup', () => {
    const view = authSettingsView({ switchToOidc: { ...READY, problem: 'secret_missing', provider: null } })
    stub(view)
    renderAdmin(<OidcSwitch view={view} />)
    expect(screen.getByText(/OIDC_CLIENT_SECRET/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Test sign-in/ })).toBeNull()
  })

  it('from Telegram, the choice says to go back to the family password first', async () => {
    const view = authSettingsView({ mode: 'telegram', stored: 'telegram', switchToOidc: READY })
    stub(view)
    renderAdmin(<SignInSettings users={{ mode: 'telegram', bot: { configured: false, username: null, problem: null }, users: [anna], meId: 1, provider: 'auth.example.org' }} hideBot />)
    fireEvent.change(await screen.findByLabelText('Sign-in method'), { target: { value: 'oidc' } })
    expect(screen.getByText('Switch to the family password first, then to the identity provider.')).toBeInTheDocument()
  })
})
