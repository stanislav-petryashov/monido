import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryObserver } from '@tanstack/react-query'
import { DemoEnded } from '../../../src/components/demo/DemoEnded'
import { apiFetch } from '../../../src/lib/api'
import { loadAuth, resetAuth, setAuth, useAuth } from '../../../src/lib/authState'
import { snapshotQueryKey } from '../../../src/lib/useFinanceData'
import { renderWithClient, snapshotClient } from '../../helpers/render'
import { jsonResponse as json } from '../../helpers/http'
import { emptySnapshot } from '../../helpers/snapshot'

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0)
const INSTALL = 'https://example.org/family-finance'

function demo(left: number) {
  setAuth({ mode: 'demo', authenticated: true, demo: { hint: 'demo-family', expiresAt: NOW + left, installUrl: INSTALL, expired: false, restarted: false } })
}

/** The sign-in state next to the dialog: a test checks that the session is kept or dropped. */
function Probe() {
  const auth = useAuth()
  return <output data-testid="auth">{String(auth.authenticated)}</output>
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => { vi.useRealTimers(); resetAuth() })

describe('DemoEnded', () => {
  it('stays hidden while the session runs', () => {
    demo(754_000)
    renderWithClient(<DemoEnded />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens on a 401 demo_expired without dropping to the sign-in screen; Start over brings a fresh sandbox', async () => {
    demo(754_000)
    const client = snapshotClient(emptySnapshot())
    // an observer keeps the snapshot query active, as the page does: refreshSnapshot refetches it, fresh or not
    const observer = new QueryObserver(client, { queryKey: snapshotQueryKey(null), queryFn: () => apiFetch('/api/snapshot'), staleTime: Infinity })
    const unsubscribe = observer.subscribe(() => {})
    renderWithClient(<><DemoEnded /><Probe /></>, { client })

    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'demo_expired' } }, 401)))
    await act(async () => { await expect(apiFetch('/api/snapshot')).rejects.toMatchObject({ code: 'demo_expired' }) })
    const dialog = screen.getByRole('dialog', { name: 'Your demo session has ended' })
    expect(dialog).toHaveTextContent('Your changes were deleted. Start over with the original data, or install Monido yourself.')
    expect(screen.getByRole('link', { name: 'Install it yourself' })).toHaveAttribute('href', INSTALL)
    expect(screen.getByTestId('auth')).toHaveTextContent('true')
    expect(screen.getByRole('button', { name: 'Start over' })).toHaveFocus()

    const fetchMock = vi.fn(async (url: string) => (url === '/api/demo/restart' ? json({ ok: true, expiresAt: NOW + 15 * 60_000 }) : json(emptySnapshot())))
    vi.stubGlobal('fetch', fetchMock)
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fetchMock).toHaveBeenCalledWith('/api/demo/restart', expect.objectContaining({ method: 'POST', body: JSON.stringify({ language: 'en-US' }) }))
    // the cached snapshot came from the old sandbox: it is loaded again
    await waitFor(() => expect(fetchMock.mock.calls.map(([url]) => url)).toContain('/api/snapshot'))
    unsubscribe()
  })

  it('opens when the countdown reaches zero', () => {
    demo(-1)
    renderWithClient(<DemoEnded />)
    expect(screen.getByRole('dialog', { name: 'Your demo session has ended' })).toBeInTheDocument()
  })

  it('cannot be dismissed with Escape', () => {
    demo(0)
    renderWithClient(<DemoEnded />)
    const dialog = screen.getByRole('dialog')
    act(() => { (dialog as HTMLDialogElement).close() })
    expect(screen.getByRole('dialog', { name: 'Your demo session has ended' })).toBeInTheDocument()
  })

  it('words a busy demo and stays open', async () => {
    demo(0)
    renderWithClient(<DemoEnded />)
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'demo_busy', params: { retryAfter: 61 } } }, 503)))
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The demo is busy right now. Try again in about 2 minutes'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('sends the visitor to the sign-in screen, marked restarted, when the server no longer knows them', async () => {
    demo(0)
    renderWithClient(<><DemoEnded /><Probe /></>)
    const { result } = renderHook(() => useAuth())
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'unauthorized' } }, 401)))
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('false'))
    expect(result.current.demo).toMatchObject({ restarted: true, expired: false, expiresAt: null })
  })

  it('a device clock 10 minutes fast does not end the session early: the end is counted from the server clock', async () => {
    // the server says 12:00 and 15 minutes left; the device reads 12:10
    vi.setSystemTime(NOW + 10 * 60_000)
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'demo', authenticated: true, hint: 'demo-family', expiresAt: NOW + 15 * 60_000, now: NOW, installUrl: INSTALL })))
    await loadAuth()
    const { result } = renderHook(() => useAuth())
    expect(result.current.demo?.expiresAt).toBe(NOW + 25 * 60_000)
    renderWithClient(<DemoEnded />)
    expect(screen.queryByRole('dialog')).toBeNull()
    // 14 minutes later on both clocks: the focus reads the device clock and checks with the server, a minute is left
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'demo', authenticated: true, hint: 'demo-family', expiresAt: NOW + 15 * 60_000, now: NOW + 14 * 60_000, installUrl: INSTALL })))
    act(() => { vi.setSystemTime(NOW + 24 * 60_000); window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(result.current.demo?.expiresAt).toBe(NOW + 25 * 60_000))
    expect(screen.queryByRole('dialog')).toBeNull()
    // past the server's end: the dialog
    act(() => { vi.setSystemTime(NOW + 25 * 60_000 + 1); window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Your demo session has ended' })).toBeInTheDocument())
  })

  it('Start over counts the new end from the server clock too', async () => {
    demo(0)
    vi.setSystemTime(NOW + 10 * 60_000)
    renderWithClient(<DemoEnded />)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/demo/restart' ? json({ ok: true, expiresAt: NOW + 15 * 60_000, now: NOW }) : json(emptySnapshot()))))
    const { result } = renderHook(() => useAuth())
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(result.current.demo?.expiresAt).toBe(NOW + 25 * 60_000)
  })

  it('checks the session with the server when the window gets the focus back', async () => {
    demo(60_000)
    renderWithClient(<DemoEnded />)
    // another tab started over: the server knows the new end time
    const fetchMock = vi.fn(async () => json({ mode: 'demo', authenticated: true, hint: 'demo-family', expiresAt: NOW + 20 * 60_000, now: NOW + 5 * 60_000, installUrl: INSTALL }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAuth())
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(result.current.demo?.expiresAt).toBe(NOW + 15 * 60_000))
    expect(fetchMock).toHaveBeenCalledWith('/api/auth')
    expect(screen.queryByRole('dialog')).toBeNull()
    // the sandbox is gone
    vi.stubGlobal('fetch', vi.fn(async () => json({ mode: 'demo', authenticated: false, hint: 'demo-family', expiresAt: null, installUrl: INSTALL })))
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Your demo session has ended' })).toBeInTheDocument())
    expect(result.current.authenticated).toBe(true)
  })

  it('renders nothing outside the demo', () => {
    setAuth({ mode: 'password', authenticated: true, demo: null })
    renderWithClient(<DemoEnded />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
