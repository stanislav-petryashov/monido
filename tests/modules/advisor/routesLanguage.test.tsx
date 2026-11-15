import { Suspense, createElement } from 'react'
import { act, screen } from '@testing-library/react'
import { advisorClient } from '../../../src/modules/advisor/client'
import advisorEn from '../../../src/locales/advisor/en-US.json'
import advisorRu from '../../../src/locales/advisor/ru-RU.json'
import type { ConnectorView } from '../../../src/domain/api'
import { jsonResponse as json } from '../../helpers/http'
import { withLanguage } from '../../helpers/i18n'
import { renderAdmin } from '../../helpers/render'

// The routes after their chunk is loaded: the language switch. The first loads are in routes.test.tsx and
// routesConsent.test.tsx, each alone in its file.

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
  it('switching the family language after opening /advisor shows the page in the new language', async () => {
    renderRoute('/advisor/ask')
    expect(await screen.findByText(advisorEn.modules.advisor.use.title)).toBeInTheDocument()
    await withLanguage('ru-RU', async () => {
      expect(await screen.findByText(advisorRu.modules.advisor.use.title)).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: advisorRu.modules.advisor.connect.address })).toBeInTheDocument()
    })
    await act(async () => {})
    expect(await screen.findByText(advisorEn.modules.advisor.use.title)).toBeInTheDocument()
  })
})
