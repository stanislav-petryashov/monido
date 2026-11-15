import { Suspense, createElement } from 'react'
import { screen } from '@testing-library/react'
import { advisorClient } from '../../../src/modules/advisor/client'
import { i18n } from '../../../src/i18n/client'
import advisorEn from '../../../src/locales/advisor/en-US.json'
import type { ConnectorView } from '../../../src/domain/api'
import { jsonResponse as json } from '../../helpers/http'
import { renderAdmin } from '../../helpers/render'

// The consent route's first load, alone in its file: a test before it could load the advisor chunk first.

const view: ConnectorView = { available: true, reason: null, mcpUrl: 'https://family.example.org/mcp', connected: [] }

const route = (path: string) => {
  const found = advisorClient.routes!.find(r => r.path === path)
  if (!found) throw new Error(`no route ${path}`)
  return found
}
const renderRoute = (path: string) => renderAdmin(<Suspense fallback={null}>{createElement(route(path).page)}</Suspense>)

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
    String(input) === '/api/advisor/connector' ? json(view) : json({ error: { code: 'not_found' } }, 404)))
})
afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('Advisor routes', () => {
  it('the consent screen waits for its texts too', async () => {
    expect(i18n.exists('modules.advisor.consent.back')).toBe(false)
    window.history.replaceState(null, '', '/advisor/connect')
    renderRoute('/advisor/connect')
    expect(await screen.findByRole('link', { name: advisorEn.modules.advisor.consent.back })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/modules\.advisor\./)
  })
})
