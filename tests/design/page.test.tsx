import { render, screen } from '@testing-library/react'
import { DesignProviders } from '../../design/providers'
import { designClient } from '../../design/setup'
import { useSnapshot } from '../../src/lib/useFinanceData'
import { settled } from '../helpers/render'

function Probe() {
  const { data } = useSnapshot()
  return <p>{data ? `net worth ${data.capital?.netWorth}` : 'loading'}</p>
}

// The catalog runs with no dev server and no sign-in: every query a component makes is already in the cache
describe('the design catalog providers', () => {
  it('serve the fixed snapshot without a request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const client = designClient()
    render(<DesignProviders client={client}><Probe /></DesignProviders>)
    expect(await screen.findByText(/^net worth \d/)).toBeInTheDocument()
    await settled(client)
    expect(fetch).not.toHaveBeenCalled()
  })
})
