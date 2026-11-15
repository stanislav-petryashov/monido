import { screen } from '@testing-library/react'
import { AppShell } from '../../src/components/layout/AppShell'
import { i18n, initClientI18n } from '../../src/i18n/client'
import recordsEn from '../../src/locales/records/en-US.json'
import { jsonResponse } from '../helpers/http'
import { renderWithSnapshot, testClient } from '../helpers/render'

// The Records and Settings screens as the app draws them: inside DataPage, whose loader brings the `records` chunk.
// tests/setup.ts loads that chunk for every test; a fresh instance here starts without it, as the browser does. This file
// holds only the first load: any other test in it could load the chunk first (recordsChunkLanguage.test.tsx has the rest).

beforeAll(() => initClientI18n('en-US'))
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/admin/')) return jsonResponse({ rows: [], columns: [] })
    return jsonResponse({ error: 'unavailable' }, 503)
  }))
  vi.stubGlobal('scrollTo', vi.fn())
  window.history.replaceState(null, '', '/accounts')
})

const renderApp = () => renderWithSnapshot(<AppShell />, undefined, { client: testClient(), notify: true })

describe('the records chunk', () => {
  it('a Records screen waits for its texts: no raw key is ever rendered', async () => {
    expect(i18n.exists('data.accounts.empty')).toBe(false)
    renderApp()
    expect(await screen.findByText(recordsEn.data.accounts.empty)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\bdata\.[a-z]+\./)
  })
})
