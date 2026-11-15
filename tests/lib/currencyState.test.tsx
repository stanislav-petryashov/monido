import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { CurrencyProvider } from '../../src/lib/CurrencyProvider'
import { VIEW_STORAGE_KEY, useDisplayCurrency } from '../../src/lib/currencyState'
import { jsonResponse } from '../helpers/http'
import { appClient, testClient } from '../helpers/render'
import { makeSnapshot } from '../helpers/snapshot'
import { stubStorage } from '../helpers/storage'

function Probe() {
  const { view, setView } = useDisplayCurrency()
  return (
    <>
      <output>{view ?? 'family'}</output>
      <button onClick={() => setView('EUR')}>EUR</button>
      <button onClick={() => setView('RUB')}>family</button>
    </>
  )
}
const chooseEur = () => fireEvent.click(screen.getByRole('button', { name: 'EUR' }))

/** The server answers in the requested currency, or in the family one (RUB) when none is requested or it is not in the project. */
function serve(projectCurrencies: string[], family = 'RUB') {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const requested = new URL(String(input), 'http://localhost').searchParams.get('currency')
    const base = requested && projectCurrencies.includes(requested) ? requested : family
    return jsonResponse({ ...makeSnapshot(), baseCurrency: base, familyCurrency: family, currencies: projectCurrencies })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const mount = (client = testClient()) =>
  render(<QueryClientProvider client={client}><CurrencyProvider><Probe /></CurrencyProvider></QueryClientProvider>)

describe('useDisplayCurrency', () => {
  it('opens in the family currency', async () => {
    const stored = stubStorage('session')
    const fetchMock = serve(['EUR', 'RUB', 'USD'])
    mount()
    expect(screen.getByRole('status')).toHaveTextContent('family')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // no currency in the request: the server answers in the family currency
    expect(fetchMock).toHaveBeenCalledWith('/api/snapshot', expect.anything())
    expect(stored.size).toBe(0)
  })

  it('a quick view lasts for the tab only', async () => {
    const stored = stubStorage('session')
    const fetchMock = serve(['EUR', 'RUB', 'USD'])
    const first = mount()
    chooseEur()
    expect(screen.getByRole('status')).toHaveTextContent('EUR')
    expect(stored.get(VIEW_STORAGE_KEY)).toBe('EUR')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/snapshot?currency=EUR', expect.anything()))
    // a reload of the tab keeps it ...
    first.unmount()
    mount()
    expect(screen.getByRole('status')).toHaveTextContent('EUR')
    // ... a new tab (empty sessionStorage) opens in the family currency
    cleanup()
    stubStorage('session')
    mount()
    expect(screen.getByRole('status')).toHaveTextContent('family')
  })

  it('choosing the family currency clears the view', async () => {
    const stored = stubStorage('session', { [VIEW_STORAGE_KEY]: 'EUR' })
    serve(['EUR', 'RUB', 'USD'])
    mount()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('EUR'))
    fireEvent.click(screen.getByRole('button', { name: 'family' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('family'))
    expect(stored.has(VIEW_STORAGE_KEY)).toBe(false)
  })

  it('clears a view that becomes the family currency', async () => {
    const stored = stubStorage('session', { [VIEW_STORAGE_KEY]: 'EUR' })
    // the server answers in EUR as asked, and EUR is also the family currency now
    serve(['EUR', 'RUB', 'USD'], 'EUR')
    mount()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('family'))
    expect(stored.has(VIEW_STORAGE_KEY)).toBe(false)
  })

  it('drops a quick view the project no longer has', async () => {
    const stored = stubStorage('session', { [VIEW_STORAGE_KEY]: 'GBP' })
    serve(['EUR', 'RUB', 'USD'])
    mount(appClient())
    expect(screen.getByRole('status')).toHaveTextContent('GBP')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('family'))
    expect(stored.has(VIEW_STORAGE_KEY)).toBe(false)
  })

  it('works when storage is blocked: the family currency, and the view lives until a reload', () => {
    stubStorage('session', {}, { failReads: true, failWrites: true })
    serve(['EUR', 'RUB', 'USD'])
    mount()
    expect(screen.getByRole('status')).toHaveTextContent('family')
    chooseEur()
    expect(screen.getByRole('status')).toHaveTextContent('EUR')
  })
})
