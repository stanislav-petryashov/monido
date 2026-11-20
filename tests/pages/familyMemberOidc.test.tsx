import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { UserView } from '../../src/domain/api'
import { FamilyMember } from '../../src/pages/settings/FamilyMember'
import { jsonResponse } from '../helpers/http'
import { expandDisclosures, renderAdmin } from '../helpers/render'
import { setAuth, resetAuth } from '../../src/lib/authState'

const MANAGER = { edit: true, vote: true, manage: true }
const ben: UserView = { id: 2, member: 'Ben', telegram: null, invitePending: false, rights: { edit: true, vote: true, manage: false }, identity: false }
const BOT = { configured: false, username: null, problem: null }

function stub() {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET'
    if (method !== 'GET') calls.push({ url, method })
    if (url === '/api/users/2/identity-invite') return jsonResponse({ link: 'https://money.test/invite/oidc/abc', expiresAt: '2031-10-10T10:00:00.000Z' })
    return jsonResponse({ users: [], mode: 'oidc', meId: 1, bot: BOT, provider: 'auth.example.org' })
  }))
  return calls
}

afterEach(() => { resetAuth(); vi.unstubAllGlobals() })

describe('a member and the identity provider', () => {
  it('a manager gets an invitation link for a member without a linked account', async () => {
    setAuth({ mode: 'oidc', authenticated: true, me: { name: 'Anna', rights: MANAGER } })
    const calls = stub()
    renderAdmin(<FamilyMember member={{ rowid: 2, name: 'Ben' }} user={ben} bot={BOT} provider="auth.example.org" mode="oidc" current={false} onInvited={() => {}} />)
    expandDisclosures()
    expect(screen.getAllByText('No account at auth.example.org linked').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Invite to link auth.example.org' }))
    expect(await screen.findByText('https://money.test/invite/oidc/abc')).toBeInTheDocument()
    expect(calls).toEqual([{ url: '/api/users/2/identity-invite', method: 'POST' }])
  })

  it('unlinking asks to confirm first', async () => {
    setAuth({ mode: 'oidc', authenticated: true, me: { name: 'Anna', rights: MANAGER } })
    const calls = stub()
    renderAdmin(<FamilyMember member={{ rowid: 2, name: 'Ben' }} user={{ ...ben, identity: true }} bot={BOT} provider="auth.example.org" mode="oidc" current={false} onInvited={() => {}} />)
    expandDisclosures()
    fireEvent.click(screen.getByRole('button', { name: 'Unlink auth.example.org' }))
    const dialog = await screen.findByRole('dialog')
    expect(calls).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(calls).toEqual([{ url: '/api/users/2/identity', method: 'DELETE' }]))
  })
})
