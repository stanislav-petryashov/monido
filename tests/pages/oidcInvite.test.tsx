import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OidcInvite } from '../../src/pages/OidcInvite'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { browser } from '../../src/lib/browser'
import { jsonResponse as json } from '../helpers/http'

afterEach(() => { resetAuth(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('the provider invitation page', () => {
  it('names the member and starts the provider only on the button', async () => {
    setAuth({ mode: 'oidc', authenticated: false, provider: 'auth.example.org' })
    const assign = vi.spyOn(browser, 'go').mockImplementation(() => {})
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'POST' ? json({ url: 'https://auth.example.org/authorize?x=1' }) : json({ member: 'Ben' })))
    vi.stubGlobal('fetch', fetch)
    render(<OidcInvite code="abc" />)
    expect(await screen.findByText('This invitation links an account at auth.example.org to Ben in Monido.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Continue to auth.example.org' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://auth.example.org/authorize?x=1'))
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/oidc/invite/abc', expect.objectContaining({ method: 'POST' }))
  })

  it('says an invalid invitation is used or expired', async () => {
    setAuth({ mode: 'oidc', authenticated: false, provider: 'auth.example.org' })
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'invite_invalid' } }, 404)))
    render(<OidcInvite code="nope" />)
    expect(await screen.findByText('This invitation is used, expired or replaced. Ask for a new one')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Monido' })).toHaveAttribute('href', '/')
  })
})
