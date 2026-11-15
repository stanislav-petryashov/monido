import { screen, waitFor } from '@testing-library/react'
import { AdvisorPage } from '../../../src/modules/advisor/AdvisorPage'
import { AskClaudePage } from '../../../src/modules/advisor/AskClaudePage'
import { loadLocaleChunk } from '../../../src/i18n/client'
import { jsonResponse as json } from '../../helpers/http'
import { renderAdmin, snapshotClient } from '../../helpers/render'
import { makeSnapshot } from '../../helpers/snapshot'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { pageOf, viewOf } from './proposalViews'

function stubProposals(page: ReturnType<typeof pageOf>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/advisor/proposals' ? json(page) : json({ error: { code: 'not_found' } }, 404)))
}

function stub(available: boolean) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/advisor/proposals') return json(pageOf([], { available }))
    if (url === '/api/advisor/connector') return json({ available: false, reason: 'auth_mode', mcpUrl: null, connected: [] })
    return json({ error: { code: 'not_found' } }, 404)
  }))
}

beforeAll(() => loadLocaleChunk('advisor'))
afterEach(() => window.history.replaceState(null, '', '/'))

describe('Advisor tabs', () => {
  afterEach(() => resetAuth())

  it('keeps the proposals, their history and the settings for who may manage them on the first tab', async () => {
    stubProposals(pageOf([viewOf()]))
    const { unmount } = renderAdmin(<AdvisorPage />)
    await screen.findByRole('article', { name: /A car on credit/ })
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Proposals', 'History', 'Proposal settings'])
    unmount()
    setAuth({ mode: 'telegram', me: { name: 'Mila', rights: { edit: true, vote: true, manage: false } } })
    renderAdmin(<AdvisorPage />)
    await screen.findByRole('article', { name: /A car on credit/ })
    expect(screen.queryByRole('region', { name: 'Proposal settings' })).toBeNull()
  })

  it('opens on the proposals where they work, and leaves the address alone', async () => {
    stub(true)
    window.history.replaceState(null, '', '/advisor')
    renderAdmin(<AdvisorPage />)
    expect(await screen.findByRole('region', { name: 'Proposals' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/advisor')
  })

  it('opens on asking Claude where proposals do not work, with no step back in history', async () => {
    stub(false)
    window.history.pushState(null, '', '/advisor')
    const before = window.history.length
    renderAdmin(<AdvisorPage />)
    await waitFor(() => expect(window.location.pathname).toBe('/advisor/ask'))
    expect(window.history.length).toBe(before)
  })

  it('says on Ask Claude why there are no proposals, only when there are none', async () => {
    stub(false)
    const client = snapshotClient(makeSnapshot())
    const { unmount } = renderAdmin(<AskClaudePage />, { client, dashboard: true })
    expect(await screen.findByText('Proposals to the family work with sign-in through Telegram.')).toBeInTheDocument()
    unmount()
    stub(true)
    renderAdmin(<AskClaudePage />, { client: snapshotClient(makeSnapshot()), dashboard: true })
    await screen.findByRole('region', { name: 'Connect Claude' })
    expect(screen.queryByText('Proposals to the family work with sign-in through Telegram.')).toBeNull()
  })
})
