import { screen } from '@testing-library/react'
import { SwitchNotice } from '../../../src/modules/advisor/SwitchNotice'
import type { ConnectorView } from '../../../src/domain/api'
import { jsonResponse as json } from '../../helpers/http'
import { renderAdmin } from '../../helpers/render'
import { loadLocaleChunk } from '../../../src/i18n/client'

const view = (connected: ConnectorView['connected']): ConnectorView => ({ available: true, reason: null, mcpUrl: 'https://f.example/mcp', connected })
const stub = (answer: ConnectorView) => vi.stubGlobal('fetch', vi.fn(async () => json(answer)))

beforeAll(() => loadLocaleChunk('advisor'))

describe('the warning before a sign-in switch', () => {
  it('warns while Claude is connected', async () => {
    stub(view([{ member: 'Ryan', you: true, clients: 1, lastIssuedAt: '2026-11-16T08:00:00.000Z' }]))
    renderAdmin(<SwitchNotice />)
    expect(await screen.findByText(/Switching the sign-in disconnects Claude for everyone/)).toBeInTheDocument()
  })

  it('says nothing when nobody is connected', async () => {
    stub(view([]))
    const { container } = renderAdmin(<SwitchNotice />)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(container).toBeEmptyDOMElement()
  })
})
