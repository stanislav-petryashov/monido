import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CurrencySwitch } from '../../src/components/layout/CurrencySwitch'
import { QueryClientProvider } from '@tanstack/react-query'
import { CurrencyProvider } from '../../src/lib/CurrencyProvider'
import { jsonResponse } from '../helpers/http'
import { testClient } from '../helpers/render'
import { CurrencyContext } from '../../src/lib/currencyState'
import { makeSnapshot } from '../helpers/snapshot'
import { renderWithClient, snapshotClient } from '../helpers/render'
import { snapshotQueryKey } from '../../src/lib/useFinanceData'

function renderSwitch(currencies: string[], view: string | null = null, family = 'USD') {
  const setView = vi.fn()
  const snapshot = makeSnapshot({ currencies, familyCurrency: family, baseCurrency: view ?? family })
  const client = snapshotClient()
  client.setQueryData(snapshotQueryKey(view), snapshot)
  renderWithClient(
    <CurrencyContext.Provider value={{ view, setView }}><CurrencySwitch /></CurrencyContext.Provider>,
    { client },
  )
  return setView
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) })

describe('CurrencySwitch', () => {
  it("shows the project's currencies, the family one first", () => {
    const setView = renderSwitch(['GBP', 'USD'])
    const pills = within(screen.getByRole('group', { name: 'Currency' })).getAllByRole('button')
    expect(pills.map(b => b.textContent)).toEqual(['USD (family)', 'GBP'])
    fireEvent.click(screen.getByRole('button', { name: 'GBP' }))
    expect(setView).toHaveBeenCalledWith('GBP')
  })

  it('a click does not reorder the pills and the pressed pill keeps focus', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const requested = new URL(String(input), 'http://localhost').searchParams.get('currency') ?? 'USD'
      return jsonResponse({ ...makeSnapshot(), baseCurrency: requested, familyCurrency: 'USD', currencies: ['EUR', 'RUB', 'USD'] })
    }))
    render(<QueryClientProvider client={testClient()}><CurrencyProvider><CurrencySwitch /></CurrencyProvider></QueryClientProvider>)
    const names = () => within(screen.getByRole('group', { name: 'Currency' })).getAllByRole('button').map(b => b.textContent)
    await waitFor(() => expect(names()).toEqual(['USD (family)', 'EUR', 'RUB']))
    for (const code of ['RUB', 'EUR']) {
      const pill = screen.getByRole('button', { name: code })
      pill.focus()
      fireEvent.click(pill)
      expect(names()).toEqual(['USD (family)', 'EUR', 'RUB'])
      await waitFor(() => expect(screen.getByRole('button', { name: code })).toHaveAttribute('aria-pressed', 'true'))
      expect(names()).toEqual(['USD (family)', 'EUR', 'RUB'])
      expect(document.activeElement).toBe(screen.getByRole('button', { name: code }))
    }
  })

  it('more than four currencies open a menu', () => {
    const setView = renderSwitch(['CHF', 'EUR', 'GBP', 'RUB', 'USD'])
    expect(screen.queryByRole('group', { name: 'Currency' })).toBeNull()
    // the button's name carries the code it shows
    const trigger = screen.getByRole('button', { name: 'Currency: USD' })
    expect(trigger).toHaveTextContent('USD')
    fireEvent.click(trigger)
    const items = within(screen.getByRole('menu')).getAllByRole('menuitemradio')
    expect(items.map(i => i.textContent)).toEqual(['USD (family)', 'CHF', 'EUR', 'GBP', 'RUB'])
    fireEvent.click(items[3])
    expect(setView).toHaveBeenCalledWith('GBP')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows the "Show in:" caption beside the switch', () => {
    renderSwitch(['GBP', 'USD'])
    const caption = screen.getByText('Show in:')
    expect(caption.nextElementSibling).toBe(screen.getByRole('group', { name: 'Currency' }))
  })

  it('the switch marks the family currency', () => {
    const setView = renderSwitch(['EUR', 'RUB', 'USD'], 'EUR', 'RUB')
    const pills = within(screen.getByRole('group', { name: 'Currency' })).getAllByRole('button')
    expect(pills.map(b => b.textContent)).toEqual(['RUB (family)', 'EUR', 'USD'])
    expect(screen.getByRole('button', { name: 'EUR' })).toHaveAttribute('aria-pressed', 'true')
    // choosing the family currency clears the view
    fireEvent.click(screen.getByRole('button', { name: 'RUB (family)' }))
    expect(setView).toHaveBeenCalledWith(null)
  })
})
