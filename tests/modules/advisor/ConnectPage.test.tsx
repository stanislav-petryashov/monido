import { fireEvent, screen, waitFor } from '@testing-library/react'
import { ConnectPage } from '../../../src/modules/advisor/ConnectPage'
import { browser } from '../../../src/modules/advisor/useConnector'
import type { ConsentRequest } from '../../../src/domain/api'
import { jsonResponse as json } from '../../helpers/http'
import { renderAdmin } from '../../helpers/render'
import { loadLocaleChunk } from '../../../src/i18n/client'

const request: ConsentRequest = { clientName: 'Claude', redirectHost: 'claude.ai', member: 'Ryan' }
const ALLOWED = 'https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz'
const DENIED = 'https://claude.ai/api/mcp/auth_callback?error=access_denied&state=xyz'

/** GET answers `view` (or the error); POST answers the redirect for the approval. Returns the POST bodies. */
function stub(view: ConsentRequest | { status: number; code: string }) {
  const posts: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (!url.startsWith('/api/advisor/oauth/requests/')) return json({ error: { code: 'not_found' } }, 404)
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { approve: boolean }
      posts.push({ url, body })
      return json({ redirect: body.approve ? ALLOWED : DENIED })
    }
    if ('code' in view) return json({ error: { code: view.code } }, view.status)
    return json(view)
  }))
  return posts
}

let go: ReturnType<typeof vi.spyOn>
// the page's texts come with its route (src/modules/advisor/client.tsx); rendered directly, it needs them loaded first
beforeAll(() => loadLocaleChunk('advisor'))
beforeEach(() => { go = vi.spyOn(browser, 'go').mockImplementation(() => {}) })
afterEach(() => {
  window.history.replaceState(null, '', '/')
})

const open = (search: string) => window.history.replaceState(null, '', `/advisor/connect${search}`)

describe('Connect page', () => {
  it('asks to act as the family when the family password signs', async () => {
    open('?request=req-1')
    stub({ ...request, member: null })
    renderAdmin(<ConnectPage />)
    expect(await screen.findByRole('heading', { name: 'Allow Claude to act as the family?' })).toBeInTheDocument()
    expect(screen.getByText(/enter data as the family: statements, loans and spending\. Proposals need Telegram sign-in/)).toBeInTheDocument()
  })

  it('names the member, the client and the redirect host', async () => {
    open('?request=req-1')
    stub(request)
    renderAdmin(<ConnectPage />)
    expect(await screen.findByRole('heading', { name: 'Allow Claude to act as Ryan?' })).toBeInTheDocument()
    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(screen.getByText('claude.ai')).toBeInTheDocument()
  })

  it('shows an attacker-chosen name as plain text, cleaned of control and format characters', async () => {
    open('?request=req-1')
    stub({ ...request, clientName: 'Claude‮<b>evil</b>\u0000' })
    renderAdmin(<ConnectPage />)
    expect(await screen.findByText('Claude<b>evil</b>')).toBeInTheDocument()
    expect(document.querySelector('b')).toBeNull()
  })

  it('an unnamed client is shown as such, the host still plainly', async () => {
    open('?request=req-1')
    stub({ ...request, clientName: null, redirectHost: 'localhost' })
    renderAdmin(<ConnectPage />)
    expect(await screen.findByText('Unnamed app')).toBeInTheDocument()
    expect(screen.getByText('localhost')).toBeInTheDocument()
  })

  it('Allow posts approve: true and navigates to the returned redirect', async () => {
    open('?request=req-1')
    const posts = stub(request)
    renderAdmin(<ConnectPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith(ALLOWED))
    expect(posts).toEqual([{ url: '/api/advisor/oauth/requests/req-1', body: { approve: true } }])
  })

  it('a pressed Allow keeps the focus and answers once', async () => {
    open('?request=req-1')
    const posts = stub(request)
    renderAdmin(<ConnectPage />)
    const allow = await screen.findByRole('button', { name: 'Allow' })
    allow.focus()
    fireEvent.click(allow)
    await waitFor(() => expect(allow).toHaveAttribute('aria-disabled', 'true'))
    expect(allow).not.toBeDisabled()
    expect(allow).toHaveFocus()
    fireEvent.click(allow)
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1))
    expect(posts).toHaveLength(1)
  })

  it('Deny posts approve: false and navigates to the returned access_denied redirect', async () => {
    open('?request=req-1')
    const posts = stub(request)
    renderAdmin(<ConnectPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith(DENIED))
    expect(posts).toEqual([{ url: '/api/advisor/oauth/requests/req-1', body: { approve: false } }])
  })

  it('does not navigate to a redirect that is not http(s)', async () => {
    open('?request=req-1')
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' ? json({ redirect: 'javascript:alert(1)' }) : json(request)))
    renderAdmin(<ConnectPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(go).not.toHaveBeenCalled()
  })

  it('an expired request shows the error and a link to /advisor', async () => {
    open('?request=req-1')
    stub({ status: 404, code: 'advisor.request_expired' })
    renderAdmin(<ConnectPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('expired or was already answered')
    expect(screen.getByRole('link', { name: 'Open Advisor → Ask Claude' })).toHaveAttribute('href', '/advisor/ask')
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull()
  })

  it('a request started in another browser says to start again in this one', async () => {
    open('?request=req-1')
    stub({ status: 403, code: 'advisor.request_elsewhere' })
    renderAdmin(<ConnectPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('started in another browser')
    expect(screen.getByRole('alert')).toHaveTextContent('in this browser')
  })

  it('an error from /oauth/authorize shows its message and the link', async () => {
    open('?error=advisor.unknown_client')
    renderAdmin(<ConnectPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('does not know the app')
    expect(screen.getByRole('link', { name: 'Open Advisor → Ask Claude' })).toHaveAttribute('href', '/advisor/ask')
  })

  it('an unknown error code or no parameters at all reads as an incomplete request', async () => {
    open('?error=whatever')
    const { unmount } = renderAdmin(<ConnectPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('incomplete')
    unmount()
    open('')
    renderAdmin(<ConnectPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('incomplete')
  })
})
