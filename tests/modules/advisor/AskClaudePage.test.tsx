import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { focusManager, onlineManager } from '@tanstack/react-query'
import { AskClaudePage } from '../../../src/modules/advisor/AskClaudePage'
import type { ConnectorView } from '../../../src/domain/api'
import { jsonResponse as json } from '../../helpers/http'
import { renderAdmin, expandDisclosures, snapshotClient } from '../../helpers/render'
import { loadLocaleChunk } from '../../../src/i18n/client'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { makeSnapshot } from '../../helpers/snapshot'
import { pageOf } from './proposalViews'

const MCP_URL = 'https://family.example.org/mcp'
const GUIDE = 'You are the Monido advisor (test guide).'

const available: ConnectorView = {
  available: true, reason: null, mcpUrl: MCP_URL,
  connected: [{ member: 'Annika', you: false, clients: 1, lastIssuedAt: '2026-11-16T08:00:00.000Z' }, { member: 'Ryan', you: true, clients: 1, lastIssuedAt: '2026-11-16T08:00:00.000Z' }],
}

/** The connector answers `view`; DELETE …/mine drops the caller; the guide tool answers GUIDE. Returns the requests seen. */
function stub(view: ConnectorView | (() => ConnectorView | Response), proposals = pageOf([], { available: false })) {
  let current = view
  const calls: { url: string; method: string; contentType: string | null; body: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const contentType = new Headers(init?.headers).get('Content-Type')
    calls.push({ url, method, contentType, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body })
    if (url === '/api/advisor/connector') {
      const answer = typeof current === 'function' ? current() : current
      return answer instanceof Response ? answer : json(answer)
    }
    if (url === '/api/advisor/proposals') return json(proposals)
    if (url === '/api/spending') return json({ categories: [], sources: [], manual: null })
    if (url === '/api/advisor/connector/mine' && method === 'DELETE') {
      const value = typeof current === 'function' ? current() as ConnectorView : current
      current = { ...value, connected: value.connected.filter(c => !c.you) }
      return json(current)
    }
    if (url === '/api/advisor/tools/get_advisor_guide' && method === 'POST') {
      // Like the server's readJson: a POST without a JSON media type is a 415.
      if (!contentType?.startsWith('application/json')) return json({ error: { code: 'unsupported_media_type' } }, 415)
      return json({ result: { guide: GUIDE } })
    }
    return json({ error: { code: 'not_found' } }, 404)
  }))
  return calls
}

const writeText = vi.fn().mockResolvedValue(undefined)

// the page's texts come with its route (src/modules/advisor/client.tsx); rendered directly, it needs them loaded first
beforeAll(() => loadLocaleChunk('advisor'))
beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => {
  vi.useRealTimers()
  delete (navigator as { clipboard?: unknown }).clipboard
})

describe('Ask Claude: the family\'s connection (family password)', () => {
  const family: ConnectorView = { available: true, reason: null, mcpUrl: MCP_URL, connected: [{ member: null, you: true, clients: 2, lastIssuedAt: '2026-11-16T08:00:00.000Z' }] }
  beforeEach(() => setAuth({ mode: 'password', me: { name: null, rights: { edit: true, vote: true, manage: true } } }))
  afterEach(() => resetAuth())

  it('shows the family connection with its apps and date, keeps the address for another app, and explains the disconnect', async () => {
    stub(family)
    renderAdmin(<AskClaudePage />)
    expect(await screen.findByText('Claude is connected for the family')).toBeInTheDocument()
    expect(screen.getByText(/2 apps · last approved November 16, 2026/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Server address for Claude' })).toHaveValue(MCP_URL)
    expandDisclosures()
    expect(within(screen.getByRole('list', { name: 'Connected now' })).getByText('The family')).toBeInTheDocument()
    expect(screen.getByText(/Anyone who knows the family password can connect Claude again/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect Claude' })).toBeInTheDocument()
  })

  it('names the fallback when Telegram has no linked manager', async () => {
    stub({ available: false, reason: 'fallback', mcpUrl: null, connected: [] })
    renderAdmin(<AskClaudePage />)
    expect(await screen.findByText(/Telegram sign-in has no linked manager/)).toBeInTheDocument()
  })
})

describe('Ask Claude: connect', () => {
  it('shows the missing condition instead of the steps when the connector is unavailable', async () => {
    stub({ available: false, reason: 'auth_mode', mcpUrl: null, connected: [] })
    renderAdmin(<AskClaudePage />)
    expect(await screen.findByText('Choose the family password or Telegram sign-in to use the connector.')).toBeInTheDocument()
    expect(screen.queryByText(/Add custom connector/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Disconnect me' })).toBeNull()
  })

  it('names the https address when APP_URL is the missing condition', async () => {
    stub({ available: false, reason: 'app_url', mcpUrl: null, connected: [] })
    renderAdmin(<AskClaudePage />)
    expect(await screen.findByText(/reachable at an https address/)).toBeInTheDocument()
  })

  it('starts setup for my profile even if another member connected, and copies the server address', async () => {
    stub({ ...available, connected: [available.connected[0]] })
    renderAdmin(<AskClaudePage />)
    expect(await screen.findByRole('textbox', { name: 'Server address for Claude' })).toHaveValue(MCP_URL)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MCP_URL))
    expect(screen.queryByText('Claude is connected to your profile')).toBeNull()
  })

  it('skips setup when my profile already has access', async () => {
    stub(available)
    renderAdmin(<AskClaudePage />)
    expect(await screen.findByText('Claude is connected to your profile')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Server address for Claude' })).toBeNull()
    expandDisclosures()
    const members = screen.getByRole('list', { name: 'Connected now' })
    expect(within(members).getByText('Annika')).toBeInTheDocument()
    expect(within(members).getByText('Ryan').closest('li')).toHaveTextContent('you')
  })

  it('notices my grant while waiting and its revocation on returning to the tab, polling only while waiting', async () => {
    let current = { ...available, connected: [available.connected[0]] }
    const calls = stub(() => current)
    const reads = () => calls.filter(c => c.url === '/api/advisor/connector').length
    vi.spyOn(window, 'open').mockReturnValue(null)
    vi.useFakeTimers()
    renderAdmin(<AskClaudePage />)
    await act(() => vi.advanceTimersByTimeAsync(100))
    // not waiting: read once, then nothing behind the person's back
    const idle = reads()
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(reads()).toBe(idle)
    fireEvent.click(screen.getByRole('button', { name: 'Open Claude connectors' }))
    current = available
    await act(() => vi.advanceTimersByTimeAsync(2100))
    expect(screen.getByText('Claude is connected to your profile')).toBeInTheDocument()
    // connected: no polling either
    const settled = reads()
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(reads()).toBe(settled)
    current = { ...available, connected: [available.connected[0]] }
    act(() => focusManager.setFocused(false))
    act(() => focusManager.setFocused(true))
    await act(() => vi.advanceTimersByTimeAsync(100))
    focusManager.setFocused(undefined)
    expect(screen.queryByText('Claude is connected to your profile')).toBeNull()
    expect(screen.getByText('Access is no longer active')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Server address for Claude' })).toHaveValue(MCP_URL)
  })

  it('hides stale success on refresh failure and recovers with a manual check', async () => {
    let current: ConnectorView | Response = available
    stub(() => current)
    vi.useFakeTimers()
    renderAdmin(<AskClaudePage />)
    await act(() => vi.advanceTimersByTimeAsync(100))
    current = json({ error: { code: 'unavailable' } }, 503)
    act(() => focusManager.setFocused(false))
    act(() => focusManager.setFocused(true))
    await act(() => vi.advanceTimersByTimeAsync(100))
    focusManager.setFocused(undefined)
    expect(screen.queryByText('Claude is connected to your profile')).toBeNull()
    expect(screen.getByText('Could not check the connection')).toBeInTheDocument()
    current = available
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(screen.getByText('Claude is connected to your profile')).toBeInTheDocument()
  })

  it('stops active waiting after five minutes without claiming the OAuth request expired', async () => {
    const calls = stub({ ...available, connected: [] })
    vi.spyOn(window, 'open').mockReturnValue(null)
    renderAdmin(<AskClaudePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Claude connectors' }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
    vi.useFakeTimers()
    // Restart with fake timers to cover the full waiting window.
    fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Claude connectors' }))
    await act(() => vi.advanceTimersByTimeAsync(300100))
    expect(screen.getByText('Connection has not been confirmed yet.')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Connection has not been confirmed yet.')
    const count = calls.filter(c => c.url === '/api/advisor/connector').length
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(calls.filter(c => c.url === '/api/advisor/connector')).toHaveLength(count)
    expect(calls.every(c => c.method === 'GET')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(calls.filter(c => c.url === '/api/advisor/connector')).toHaveLength(count + 1)
  })

  it('refreshes when returning to the tab or restoring the network', async () => {
    let current = { ...available, connected: [] as ConnectorView['connected'] }
    stub(() => current)
    renderAdmin(<AskClaudePage />)
    await screen.findByRole('progressbar')
    act(() => focusManager.setFocused(false))
    current = available
    act(() => focusManager.setFocused(true))
    await screen.findByText('Claude is connected to your profile')
    act(() => onlineManager.setOnline(false))
    current = { ...available, connected: [] }
    act(() => onlineManager.setOnline(true))
    await screen.findByRole('progressbar')
    expect(screen.queryByText('Claude is connected to your profile')).toBeNull()
    focusManager.setFocused(undefined)
  })

  it('aborts a pending read and stops polling when leaving the page', async () => {
    stub({ ...available, connected: [] })
    const original = fetch
    let signal: AbortSignal | null | undefined
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/advisor/connector') {
        signal = init?.signal
        return new Promise<Response>(() => {})
      }
      return original(input, init)
    })
    const { unmount } = renderAdmin(<AskClaudePage />)
    await waitFor(() => expect(signal).toBeDefined())
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('does not let an old read restore access after disconnecting', async () => {
    stub(available)
    const original = fetch
    let late: ((response: Response) => void) | undefined
    let reads = 0
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/advisor/connector' && ++reads > 1) {
        return new Promise<Response>(resolve => { late = resolve })
      }
      return original(input, init)
    })
    vi.useFakeTimers()
    renderAdmin(<AskClaudePage />)
    await act(() => vi.advanceTimersByTimeAsync(100))
    act(() => focusManager.setFocused(false))
    act(() => focusManager.setFocused(true))
    focusManager.setFocused(undefined)
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(late).toBeDefined()
    expandDisclosures()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect me' }))
    await act(() => vi.advanceTimersByTimeAsync(100))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Disconnect' }))
    await act(() => vi.advanceTimersByTimeAsync(100))
    await act(async () => { late!(json(available)); await vi.advanceTimersByTimeAsync(100) })
    expect(screen.queryByText('Claude is connected to your profile')).toBeNull()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('says so when nobody is connected, and offers no disconnect', async () => {
    stub({ ...available, connected: [] })
    renderAdmin(<AskClaudePage />)
    await screen.findByRole('progressbar')
    expandDisclosures()
    expect(await screen.findByText('Nobody has connected Claude yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disconnect me' })).toBeNull()
  })

  it('"Disconnect me" asks first and then calls DELETE /api/advisor/connector/mine', async () => {
    const calls = stub(available)
    renderAdmin(<AskClaudePage />)
    await screen.findByText('Claude is connected to your profile')
    expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect me' }))
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect Claude?' })
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ url: '/api/advisor/connector/mine', method: 'DELETE' })))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Disconnect me' })).toBeNull())
    expect(screen.queryByText('Ryan')).toBeNull()
  })

  it('Cancel in the question calls nothing', async () => {
    const calls = stub(available)
    renderAdmin(<AskClaudePage />)
    await screen.findByText('Claude is connected to your profile')
    expandDisclosures()
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect me' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
  })

  it('tells what to do when Claude says it lost access', async () => {
    stub(available)
    renderAdmin(<AskClaudePage />)
    await screen.findByText('Claude is connected to your profile')
    expandDisclosures()
    expect(await screen.findByText(/lost access/)).toBeInTheDocument()
  })
})

describe('Ask Claude: how to use', () => {
  it('shows the examples, the limits, the disclaimer and the privacy line', async () => {
    stub(available)
    renderAdmin(<AskClaudePage />); expandDisclosures()
    const examples = await screen.findByRole('list', { name: 'Try asking Claude' })
    expect(within(examples).getAllByRole('listitem').length).toBeGreaterThanOrEqual(4)
    expect(within(examples).getAllByRole('listitem').length).toBeLessThanOrEqual(6)
    expect(screen.getByRole('heading', { name: 'What Claude can do' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What it cannot do' })).toBeInTheDocument()
    expect(screen.getByText(/not a regulated financial consultation/)).toBeInTheDocument()
    expect(screen.getByText(/Anthropic through your own Claude account/)).toBeInTheDocument()
  })

  it('How to use lists sending to the family among what Claude can do', async () => {
    stub(available)
    renderAdmin(<AskClaudePage />); expandDisclosures()
    const can = await screen.findByRole('list', { name: 'What Claude can do' })
    expect(within(can).getAllByRole('listitem')).toHaveLength(4)
    expect(within(can).getByText(/Send one chosen scenario to the family for approval in Telegram/)).toBeInTheDocument()
    const cannot = screen.getByRole('list', { name: 'What it cannot do' })
    expect(within(cannot).getByText('Change anything except spending by category and the proposals it sends.')).toBeInTheDocument()
  })

  it('still shows how to use when the connector is unavailable', async () => {
    stub({ available: false, reason: 'app_url', mcpUrl: null, connected: [] })
    renderAdmin(<AskClaudePage />); expandDisclosures()
    expect(await screen.findByRole('list', { name: 'Try asking Claude' })).toBeInTheDocument()
  })

  it('keeps the English guide behind a toggle, fetches it on the first open, and copies it', async () => {
    const calls = stub(available)
    renderAdmin(<AskClaudePage />); expandDisclosures()
    const toggle = await screen.findByRole('button', { name: 'Show the full guide' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(GUIDE)).toBeNull()
    expect(calls.some(c => c.url.includes('get_advisor_guide'))).toBe(false)
    fireEvent.click(toggle)
    expect(await screen.findByText(GUIDE)).toBeInTheDocument()
    const request = calls.find(c => c.url.includes('get_advisor_guide'))
    expect(request?.contentType).toBe('application/json')
    expect(request?.body).toEqual({})
    expect(screen.getByRole('button', { name: 'Hide the guide' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Copy guide' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(GUIDE))
    fireEvent.click(screen.getByRole('button', { name: 'Hide the guide' }))
    expect(screen.queryByText(GUIDE)).toBeNull()
  })
})

it('keeps its blocks in order: a question to copy, connecting, then how to use folded', async () => {
  stub(available)
  renderAdmin(<AskClaudePage />)
  await screen.findByText('Claude is connected to your profile')
  expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Copy a question with your data', 'Connect Claude', 'How to use'])
  expect(screen.getByText('How to use').closest('details')).not.toHaveAttribute('open')
})

it('offers deliberate manual preview and copy with password authentication, without connector setup', async () => {
  setAuth({ mode: 'password', me: null })
  const calls = stub({ available: false, reason: 'auth_mode', mcpUrl: null, connected: [] })
  renderAdmin(<AskClaudePage />, { client: snapshotClient(makeSnapshot()) })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: /Preview question/ }))
  const dialog = screen.getByRole('dialog')
  expect(writeText).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
  expect(calls.every(c => c.method === 'GET')).toBe(true)
  resetAuth()
})
