import { Suspense, createElement } from 'react'
import { screen } from '@testing-library/react'
import { advisorClient } from '../../../src/modules/advisor/client'
import { i18n } from '../../../src/i18n/client'
import advisorEn from '../../../src/locales/advisor/en-US.json'
import type { ConnectorView } from '../../../src/domain/api'
import { jsonResponse as json } from '../../helpers/http'
import { renderAdmin } from '../../helpers/render'

// The routes as the shell renders them: the lazy page, no chunk loaded beforehand (the page tests load it themselves).
// This file holds only the first load: any other test in it could load the chunk first (routesLanguage.test.tsx has the rest).

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
  it('Ask Claude waits for its texts: no raw key is ever rendered', async () => {
    expect(i18n.exists('modules.advisor.use.title')).toBe(false)
    renderRoute('/advisor/ask')
    expect(await screen.findByText(advisorEn.modules.advisor.use.title)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/modules\.advisor\./)
  })
})
