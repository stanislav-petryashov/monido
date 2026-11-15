import { AreaNavigation } from '../../../src/components/layout/AreaNavigation'
import { routesFor } from '../../../src/routes'
import { useRoute } from '../../../src/lib/router'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { ParametersView } from '../../../src/pages/admin/ParametersView'
import { MembersBlock } from '../../../src/pages/admin/MembersBlock'
import { CurrenciesBlock } from '../../../src/pages/admin/CurrenciesBlock'
import { ru, withLanguage } from '../../helpers/i18n'
import { type Answer, deferred, jsonResponse, sent, stubApi, WRITES } from '../../helpers/http'
import { renderAdmin as renderPage, settled, testClient } from '../../helpers/render'


afterEach(() => { window.history.replaceState(null, '', '/') })

/** Every write answered `{ ok: true }` */
const WRITES_OK = Object.fromEntries(WRITES.map(m => [`${m} *`, () => jsonResponse({ ok: true })]))

function ParametersArea() {
  const path = useRoute()
  return <DataPage screen={ParametersView}><AreaNavigation path={path} routes={routesFor({ demo: false })} /></DataPage>
}

describe('Parameters screen', () => {
  const parameters = [
    { rowid: 1, key: 'inflation_2030', value: 10, description: 'Estimate' },
    { rowid: 2, key: 'inflation_2031', value: 7, description: null },
    { rowid: 3, key: 'inflation_rate', value: 10, description: 'Current' },
  ]

  /** The blocks of the page, top to bottom, by their headings */
  const headings = () => screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)

  it('keeps only the general forms on this tab: copies and maintenance are on Data', async () => {
    stubApi({ currencies: [{ rowid: 1, code: 'EUR' }] })
    // the area links under the title are drawn on a phone only; wider, the menu's second floor lists them
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })))
    window.history.replaceState(null, '', '/settings/general')
    renderPage(<ParametersArea />)
    await screen.findByRole('radiogroup', { name: 'Language' })
    expect(screen.getByRole('option', { name: 'Data' })).toHaveValue('/settings/data')
    expect(screen.queryByRole('heading', { name: 'Database copy' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Replace or delete data' })).toBeNull()
  })

  it('shows the blocks in order without the dead tables', async () => {
    stubApi({ parameters, currencies: [{ rowid: 1, code: 'EUR' }], members: [{ rowid: 1, name: 'Robin' }] })
    renderPage(<DataPage screen={ParametersView} />)
    await screen.findByRole('radiogroup', { name: 'Language' })
    expect(headings()).toEqual(['Language', 'Currencies', 'Income and expenses', 'Inflation'])
    expect(screen.queryByRole('table', { name: 'Inflation by year' })).toBeNull()
    expect(screen.queryByRole('table', { name: 'Other parameters' })).toBeNull()
  })

  it('Parameters puts each block in a settings row', async () => {
    stubApi({ parameters, currencies: [{ rowid: 1, code: 'EUR' }], members: [{ rowid: 1, name: 'Robin' }] })
    renderPage(<DataPage screen={ParametersView} />)
    await screen.findByRole('radiogroup', { name: 'Language' })
    for (const name of ['Language', 'Inflation', 'Currencies']) {
      expect(screen.getByRole('region', { name })).toHaveClass('settings-section')
    }
    expect(screen.getByRole('region', { name: 'Inflation' })).toHaveTextContent(/International Monetary Fund|IMF/)
  })

  it('previews the language and says whom it is for', async () => {
    stubApi({ parameters, currencies: [{ rowid: 1, code: 'EUR' }] })
    renderPage(<DataPage screen={ParametersView} />)
    const group = await screen.findByRole('radiogroup', { name: 'Language' })
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'English' })).toBeChecked())
    expect(screen.getByText('Shared by the family and Telegram.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Date format' })).toHaveValue('dmy')
  })

  it('saves the date order from General settings', async () => {
    const fetchMock = stubApi({ parameters, currencies: [{ rowid: 1, code: 'EUR' }] })
    renderPage(<DataPage screen={ParametersView} />)
    const field = await screen.findByRole('combobox', { name: 'Date format' })
    fireEvent.change(field, { target: { value: 'mdy' } })
    await waitFor(() => expect(field).toHaveValue('mdy'))
    expect(sent(fetchMock, 'PUT')).toContainEqual({ method: 'PUT', url: '/api/settings', body: { dateFormat: 'mdy' } })
  })

  it('changing the language re-renders the page in it', async () => {
    const fetchMock = stubApi({ currencies: [{ rowid: 1, code: 'EUR' }] })
    renderPage(<DataPage screen={ParametersView} />)
    const group = await screen.findByRole('radiogroup', { name: 'Language' })
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'English' })).toBeChecked())
    await withLanguage('en-US', async () => {
      fireEvent.click(within(group).getAllByRole('radio')[1]!)
      await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: ru('data.params.language') })).toBeInTheDocument())
      expect(screen.getByRole('status')).toHaveTextContent(ru('data.params.familySaved'))
    })
    expect(sent(fetchMock, 'PUT')).toEqual([{ method: 'PUT', url: '/api/settings', body: { language: 'ru-RU' } }])
  })

  it('lists a family currency the project no longer has', async () => {
    stubApi({ currencies: [{ rowid: 1, code: 'EUR' }] })
    renderPage(<DataPage screen={ParametersView} />)
    const group = await screen.findByRole('combobox', { name: 'Currency for totals' })
    await waitFor(() => expect(group).toHaveValue('USD'))
    expect(within(group).getAllByRole('option').map(r => (r as HTMLOptionElement).value)).toEqual(['USD', 'EUR'])
  })

  it('changing the family currency refreshes the snapshot', async () => {
    const fetchMock = stubApi({ currencies: [{ rowid: 1, code: 'EUR' }, { rowid: 2, code: 'USD' }] })
    const client = testClient()
    client.setQueryData(['snapshot', 'USD'], { cached: true })
    renderPage(<DataPage screen={ParametersView} />, { client })
    const group = await screen.findByRole('combobox', { name: 'Currency for totals' })
    await waitFor(() => expect(group).toHaveValue('USD'))
    expect(screen.getByText('Account currencies and balances stay unchanged.')).toBeInTheDocument()
    fireEvent.change(group, { target: { value: 'EUR' } })
    await waitFor(() => expect(client.getQueryState(['snapshot', 'USD'])?.isInvalidated).toBe(true))
    expect(sent(fetchMock, 'PUT')[0].body).toEqual({ currency: 'EUR' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'))
  })

  it('has no backup block and no danger zone: both moved to the Backup page', async () => {
    stubApi({ parameters })
    renderPage(<DataPage screen={ParametersView} />)
    await screen.findByRole('radiogroup', { name: 'Language' })
    expect(screen.queryByRole('button', { name: 'Choose backup' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Download backup' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Replace or delete data' })).toBeNull()
  })

  it('lists currencies as removable tags and leaves members to Family', async () => {
    stubApi({ parameters: [], currencies: [{ rowid: 1, code: 'EUR' }], members: [{ rowid: 7, name: 'Robin' }] })
    renderPage(<DataPage screen={ParametersView} />)
    expect(await screen.findByRole('button', { name: 'Remove: EUR' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove: Robin' })).not.toBeInTheDocument()
  })

  it('does not offer removing the family currency: the server refuses it', async () => {
    stubApi({ parameters: [], currencies: [{ rowid: 1, code: 'EUR' }, { rowid: 2, code: 'USD' }], members: [] })
    renderPage(<DataPage screen={ParametersView} />)
    expect(await screen.findByText('for totals')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove: EUR' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove: USD' })).toBeNull()
  })

  it('adding a currency names it in the toast', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      jsonResponse(init?.method === 'POST' ? { ok: true } : { rows: [], columns: [] })))
    renderPage(<DataPage screen={ParametersView} />)
    const input = await screen.findByRole('combobox', { name: 'Add a currency' })
    fireEvent.change(input, { target: { value: 'gbp' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Currency added. GBP'))
  })

  it('a failed add keeps the typed currency in the field', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse({ error: 'boom' }, 500) : jsonResponse({ rows: [], columns: [] })))
    renderPage(<DataPage screen={ParametersView} />)
    const input = await screen.findByRole('combobox', { name: 'Add a currency' })
    fireEvent.change(input, { target: { value: 'gbp' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(input).toHaveValue('gbp')
  })

  it('takes only a three-letter currency code or a found one', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      jsonResponse(init?.method === 'POST' ? { ok: true } : { rows: [], columns: [] }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage(<DataPage screen={ParametersView} />)
    const input = await screen.findByRole('combobox', { name: 'Add a currency' })
    const add = within(input.closest('.currency-combo') as HTMLElement).getByRole('button', { name: '+ Add' })
    const posts = () => sent(fetchMock, 'POST')
    for (const wrong of ['U S', 'US1']) {
      fireEvent.change(input, { target: { value: wrong } })
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(add).toBeDisabled()
      fireEvent.keyDown(input, { key: 'Enter' })
    }
    // a name or a part of a code finds currencies but is not itself a code: Enter waits for a choice
    for (const partial of ['eu', 'euro']) {
      fireEvent.change(input, { target: { value: partial } })
      expect(input).not.toHaveAttribute('aria-invalid')
      expect(add).toBeDisabled()
      fireEvent.keyDown(input, { key: 'Enter' })
    }
    expect(posts()).toHaveLength(0)
    fireEvent.change(input, { target: { value: 'chf' } })
    expect(input).not.toHaveAttribute('aria-invalid')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toEqual({ code: 'CHF' })
  })

  it('finds a currency by its name and leaves out those the family has', async () => {
    const fetchMock = stubApi({ currencies: [{ rowid: 1, code: 'EUR' }] })
    renderPage(<DataPage screen={ParametersView} />)
    await screen.findByRole('button', { name: 'Remove: EUR' })
    const input = screen.getByRole('combobox', { name: 'Add a currency' })
    fireEvent.change(input, { target: { value: 'euro' } })
    // the euro is the only currency named so, and the family has it
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.change(input, { target: { value: 'lari' } })
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /GEL/ }))
    await waitFor(() => expect(sent(fetchMock, 'POST').map(r => r.body)).toContainEqual({ code: 'GEL' }))
  })

  it('says what a currency code is once the field with a wrong one is left', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ rows: [], columns: [] })))
    renderPage(<DataPage screen={ParametersView} />)
    const input = await screen.findByRole('combobox', { name: 'Add a currency' })
    fireEvent.change(input, { target: { value: 'US1' } })
    fireEvent.blur(input)
    expect(screen.getByRole('alert')).toHaveTextContent('A code is three Latin letters, for example RUB')
  })

  describe('manual rates', () => {
    async function openRates() {
      fireEvent.click(await screen.findByText('Manual exchange rates'))
      fireEvent.click(screen.getByRole('button', { name: 'Add a rate' }))
    }

    const currencies = [{ rowid: 1, code: 'ARS' }, { rowid: 2, code: 'EUR' }, { rowid: 3, code: 'USD' }, { rowid: 4, code: 'RUB' }]
    const stubRates = (rates: Record<string, unknown>[] = [], answer: Record<string, Answer> = {}) =>
      stubApi({ currencies, fx_manual_rates: rates }, { answer: { ...WRITES_OK, ...answer } })

    it('says in words why a zero rate cannot be added, once the field is left, and ties the text to the field', async () => {
      stubRates()
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      const field = await screen.findByRole('textbox', { name: /^Rate per 1 USD/ })
      fireEvent.change(field, { target: { value: '0' } })
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(screen.queryByText('A rate is a number above zero, for example 92.5')).toBeNull() // not mid-typing
      fireEvent.blur(field)
      const error = screen.getByText('A rate is a number above zero, for example 92.5')
      expect(field.getAttribute('aria-describedby')).toContain(error.id)
      fireEvent.change(field, { target: { value: '92.5' } })
      expect(screen.queryByText('A rate is a number above zero, for example 92.5')).toBeNull()
    })

    it('adds a rate: posts it and marks the snapshot stale', async () => {
      const fetchMock = stubRates()
      const client = testClient()
      client.setQueryData(['snapshot', 'USD'], { cached: true })
      renderPage(<DataPage screen={ParametersView} />, { client })
      await openRates()
      const form = await screen.findByRole('group', { name: 'Manual rates' })
      await within(form).findByRole('option', { name: 'ARS' })
      fireEvent.change(within(form).getByLabelText('Currency'), { target: { value: 'ARS' } })
      fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-01-01' } })
      fireEvent.change(within(form).getByRole('textbox', { name: /^Rate per 1 USD/ }), { target: { value: '1500' } })
      fireEvent.click(within(form).getByRole('button', { name: 'Add a rate' }))
      await waitFor(() => expect(sent(fetchMock, WRITES)).toHaveLength(1))
      expect(sent(fetchMock, WRITES)).toEqual([{ method: 'POST', url: '/api/admin/fx_manual_rates', body: { currency: 'ARS', date: '2026-01-01', per_usd: 1500 } }])
      await waitFor(() => expect(client.getQueryState(['snapshot', 'USD'])?.isInvalidated).toBe(true))
    })

    it('a double Enter in the rate field posts one rate; Enter of a composition posts none', async () => {
      const gate = deferred()
      const fetchMock = stubRates([], { 'POST *': (_init, fallback) => gate.promise.then(fallback) })
      const client = testClient()
      renderPage(<DataPage screen={ParametersView} />, { client })
      await openRates()
      const form = await screen.findByRole('group', { name: 'Manual rates' })
      await within(form).findByRole('option', { name: 'ARS' })
      fireEvent.change(within(form).getByLabelText('Currency'), { target: { value: 'ARS' } })
      fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-01-01' } })
      const rate = within(form).getByRole('textbox', { name: /^Rate per 1 USD/ })
      fireEvent.change(rate, { target: { value: '1500' } })
      fireEvent.keyDown(rate, { key: 'Enter', isComposing: true })
      // a write started now would be held by the gate: the client would not settle
      await settled(client)
      expect(sent(fetchMock, WRITES)).toHaveLength(0)
      fireEvent.keyDown(rate, { key: 'Enter' })
      fireEvent.keyDown(rate, { key: 'Enter' })
      expect(within(form).getByRole('button', { name: 'Add a rate' })).toBeDisabled()
      gate.resolve()
      await waitFor(() => expect(screen.queryByRole('group', { name: 'Manual rates' })).toBeNull())
      expect(sent(fetchMock, WRITES)).toHaveLength(1)
    })

    it('reads a rate, marks a zero one and does not offer USD', async () => {
      const fetchMock = stubRates()
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      const form = await screen.findByRole('group', { name: 'Manual rates' })
      await within(form).findByRole('option', { name: 'ARS' })
      expect(within(form).queryByRole('option', { name: 'USD' })).toBeNull()
      fireEvent.change(within(form).getByLabelText('Currency'), { target: { value: 'ARS' } })
      fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-01-01' } })
      const rate = within(form).getByRole('textbox', { name: /^Rate per 1 USD/ })
      const addButton = within(form).getByRole('button', { name: 'Add a rate' })
      for (const wrong of ['0', '0.00']) {
        fireEvent.change(rate, { target: { value: wrong } })
        expect(rate).toHaveAttribute('aria-invalid', 'true')
        expect(addButton).toBeDisabled()
        fireEvent.keyDown(rate, { key: 'Enter' })
      }
      expect(sent(fetchMock, WRITES)).toHaveLength(0)
      fireEvent.change(rate, { target: { value: '92.5' } })
      expect(rate).not.toHaveAttribute('aria-invalid')
      fireEvent.click(addButton)
      await waitFor(() => expect(sent(fetchMock, WRITES)).toHaveLength(1))
      expect(sent(fetchMock, WRITES)[0].body).toEqual({ currency: 'ARS', date: '2026-01-01', per_usd: 92.5 })
    })

    it('writes the rate as a phrase and shows the inverse under it', async () => {
      stubRates()
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      const form = await screen.findByRole('group', { name: 'Manual rates' })
      await within(form).findByRole('option', { name: 'RUB' })
      fireEvent.change(within(form).getByLabelText('Currency'), { target: { value: 'RUB' } })
      expect(within(form).getByText('1 USD =')).toBeInTheDocument()
      const rate = within(form).getByLabelText('Rate per 1 USD (RUB)')
      fireEvent.change(rate, { target: { value: '92.41' } })
      expect(within(form).getByText('1 RUB = 0.0108 USD')).toBeInTheDocument()
      expect(within(form).queryByText(/looks inverted/)).toBeNull()
    })

    it('warns that a small rate of a currency that is not stronger than the dollar looks inverted', async () => {
      stubRates()
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      const form = await screen.findByRole('group', { name: 'Manual rates' })
      await within(form).findByRole('option', { name: 'RUB' })
      fireEvent.change(within(form).getByLabelText('Currency'), { target: { value: 'RUB' } })
      fireEvent.change(within(form).getByLabelText('Rate per 1 USD (RUB)'), { target: { value: '0.0108' } })
      expect(within(form).getByText('The rate looks inverted: how many RUB does 1 USD buy?')).toBeInTheDocument()
    })

    it('does not warn about a rate below one for a currency stronger than the dollar', async () => {
      stubRates()
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      const form = await screen.findByRole('group', { name: 'Manual rates' })
      await within(form).findByRole('option', { name: 'EUR' })
      fireEvent.change(within(form).getByLabelText('Currency'), { target: { value: 'EUR' } })
      fireEvent.change(within(form).getByLabelText('Rate per 1 USD (EUR)'), { target: { value: '0.92' } })
      expect(within(form).getByText('1 EUR = 1.09 USD')).toBeInTheDocument()
      expect(within(form).queryByText(/looks inverted/)).toBeNull()
    })

    it('reads a decimal comma as the separator', async () => {
      stubRates()
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      const form = await screen.findByRole('group', { name: 'Manual rates' })
      await within(form).findByRole('option', { name: 'RUB' })
      fireEvent.change(within(form).getByLabelText('Currency'), { target: { value: 'RUB' } })
      fireEvent.change(within(form).getByRole('textbox', { name: /^Rate per 1 USD/ }), { target: { value: '92,41' } })
      expect(within(form).getByText('1 RUB = 0.0108 USD')).toBeInTheDocument()
    })

    it('keeps the inverse of a large rate above zero and shows no hint without a currency', async () => {
      stubRates()
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      const form = await screen.findByRole('group', { name: 'Manual rates' })
      await within(form).findByRole('option', { name: 'RUB' })
      const rate = within(form).getByRole('textbox', { name: /^Rate per 1 USD/ })
      fireEvent.change(rate, { target: { value: '25000' } })
      expect(within(form).queryByText(/^1 \S+ = .* USD$/)).toBeNull()
      fireEvent.change(within(form).getByLabelText('Currency'), { target: { value: 'RUB' } })
      const hint = within(form).getByText(/^1 RUB = .* USD$/)
      expect(Number(hint.textContent?.match(/= (.*) USD/)?.[1])).toBeGreaterThan(0)
    })

    it('shows a six-decimal stored rate in its row', async () => {
      stubRates([{ rowid: 5, currency: 'RUB', date: '2026-03-01', per_usd: 0.000012 }])
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      expect(await screen.findByText('1 USD = 0.000012 RUB')).toBeInTheDocument()
    })

    it('lists rates newest first and deletes one', async () => {
      const fetchMock = stubRates([
        { rowid: 1, currency: 'ARS', date: '2026-01-01', per_usd: 1000 },
        { rowid: 2, currency: 'ARS', date: '2026-03-01', per_usd: 1200 },
      ])
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      const table = await screen.findByRole('table', { name: 'Manual rates' })
      await within(table).findByText('03/01/2026')
      expect(within(table).getAllByRole('row').slice(1).map(r => r.firstElementChild?.textContent)).toEqual(['03/01/2026', '01/01/2026'])
      expect(within(table).getByText('1 USD = 1,200 ARS')).toBeInTheDocument()
      fireEvent.click(within(table).getByRole('button', { name: 'Delete: ARS 03/01/2026' }))
      await waitFor(() => expect(sent(fetchMock, WRITES)).toHaveLength(1))
      expect(sent(fetchMock, WRITES)[0].url).toBe('/api/admin/fx_manual_rates/2')
    })

    it('a stored three-decimal rate is not flagged and saves unchanged', async () => {
      const fetchMock = stubRates([{ rowid: 2, currency: 'ARS', date: '2026-03-01', per_usd: 92.125 }])
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      fireEvent.click(await screen.findByRole('button', { name: 'Edit: ARS 03/01/2026' }))
      expect(screen.getByRole('textbox', { name: /^Rate per 1 USD: ARS 03\/01\/2026/ })).not.toHaveAttribute('aria-invalid')
      fireEvent.click(within(screen.getByRole('table', { name: 'Manual rates' })).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(sent(fetchMock, WRITES)).toHaveLength(1))
      expect(sent(fetchMock, WRITES)[0].body).toEqual({ per_usd: 92.125 })
    })

    it('adds a rate typed with three decimals and a decimal comma', async () => {
      const fetchMock = stubRates()
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      const form = await screen.findByRole('group', { name: 'Manual rates' })
      await within(form).findByRole('option', { name: 'ARS' })
      fireEvent.change(within(form).getByLabelText('Currency'), { target: { value: 'ARS' } })
      fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-01-01' } })
      const rate = within(form).getByRole('textbox', { name: /^Rate per 1 USD/ })
      fireEvent.change(rate, { target: { value: '92,415' } })
      expect(rate).not.toHaveAttribute('aria-invalid')
      fireEvent.click(within(form).getByRole('button', { name: 'Add a rate' }))
      await waitFor(() => expect(sent(fetchMock, WRITES)).toHaveLength(1))
      expect(sent(fetchMock, WRITES)[0].body).toEqual({ currency: 'ARS', date: '2026-01-01', per_usd: 92.415 })
    })

    it('a stored four-decimal rate cut to three by Backspace stays a rate', async () => {
      const fetchMock = stubRates([{ rowid: 2, currency: 'ARS', date: '2026-03-01', per_usd: 92.4151 }])
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      fireEvent.click(await screen.findByRole('button', { name: 'Edit: ARS 03/01/2026' }))
      const field = screen.getByRole('textbox', { name: /^Rate per 1 USD: ARS 03\/01\/2026/ })
      expect(field).toHaveValue('92.4151')
      fireEvent.change(field, { target: { value: '92.415' } })
      expect(field).not.toHaveAttribute('aria-invalid')
      fireEvent.click(within(screen.getByRole('table', { name: 'Manual rates' })).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(sent(fetchMock, WRITES)).toHaveLength(1))
      expect(sent(fetchMock, WRITES)[0].body).toEqual({ per_usd: 92.415 })
    })

    it('does not add a rate whose date is half-typed', async () => {
      const fetchMock = stubRates()
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      const form = await screen.findByRole('group', { name: 'Manual rates' })
      await within(form).findByRole('option', { name: 'ARS' })
      fireEvent.change(within(form).getByLabelText('Currency'), { target: { value: 'ARS' } })
      fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '01/1' } })
      fireEvent.change(within(form).getByRole('textbox', { name: /^Rate per 1 USD/ }), { target: { value: '1500' } })
      expect(within(form).getByRole('button', { name: 'Add a rate' })).toBeDisabled()
      fireEvent.keyDown(within(form).getByRole('textbox', { name: /^Rate per 1 USD/ }), { key: 'Enter' })
      expect(await screen.findByText('A date is not finished: complete it as shown under the field')).toBeInTheDocument()
      expect(sent(fetchMock, WRITES)).toHaveLength(0)
    })

    it('edits a rate with PUT', async () => {
      const fetchMock = stubRates([{ rowid: 2, currency: 'ARS', date: '2026-03-01', per_usd: 1200 }])
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      fireEvent.click(await screen.findByRole('button', { name: 'Edit: ARS 03/01/2026' }))
      const field = screen.getByRole('textbox', { name: /^Rate per 1 USD: ARS 03\/01\/2026/ })
      fireEvent.change(field, { target: { value: '0' } })
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(within(screen.getByRole('table', { name: 'Manual rates' })).getByRole('button', { name: 'Save' })).toBeDisabled()
      fireEvent.change(field, { target: { value: '1300.5' } })
      fireEvent.click(within(screen.getByRole('table', { name: 'Manual rates' })).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(sent(fetchMock, WRITES)).toHaveLength(1))
      expect(sent(fetchMock, WRITES)).toEqual([{ method: 'PUT', url: '/api/admin/fx_manual_rates/2', body: { per_usd: 1300.5 } }])
    })

    it('a double click on a rate’s trash can deletes it once; the trash cans are off meanwhile', async () => {
      const fetchMock = stubRates([{ rowid: 2, currency: 'ARS', date: '2026-03-01', per_usd: 1200 }])
      renderPage(<DataPage screen={ParametersView} />)
      await openRates()
      const trash = await screen.findByRole('button', { name: 'Delete: ARS 03/01/2026' })
      fireEvent.click(trash)
      fireEvent.click(trash)
      expect(trash).toBeDisabled()
      await waitFor(() => expect(sent(fetchMock, WRITES)).toHaveLength(1))
      await waitFor(() => expect(within(screen.getByRole('region', { name: 'Notifications' })).getByRole('status')).toHaveTextContent('Rate deleted'))
      expect(sent(fetchMock, WRITES)).toHaveLength(1)
    })

    it('a failed load of the rates says so, not just “No rates yet”', async () => {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const table = String(input).split('/').pop() ?? ''
        if (table === 'fx_manual_rates') return jsonResponse({ error: 'boom' }, 500)
        return jsonResponse({ rows: ({ currencies } as Record<string, unknown[]>)[table] ?? [], columns: [] })
      }))
      renderPage(<DataPage screen={ParametersView} />)
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Failed to load')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
      expect(screen.queryByText('No rates yet')).not.toBeInTheDocument()
    })
  })
})

describe('TagList', () => {
  it('a double click on a member’s “×” deletes it once; the “×” are off meanwhile', async () => {
    // the DELETE waits for the gate; the re-reads after it answer at once
    const gate = deferred()
    const fetchMock = stubApi({}, { answer: { 'DELETE *': () => gate.promise.then(() => jsonResponse({ ok: true })) } })
    renderPage(<MembersBlock members={[{ rowid: 1, name: 'Robin' }, { rowid: 2, name: 'Noa' }]} />)
    const remove = screen.getByRole('button', { name: 'Remove: Robin' })
    fireEvent.click(remove)
    fireEvent.click(remove)
    expect(screen.getByRole('button', { name: 'Remove: Noa' })).toBeDisabled()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    gate.resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove: Noa' })).toBeEnabled())
    expect(sent(fetchMock, 'DELETE')).toHaveLength(1)
  })
})

describe('Parameters screen: inflation', () => {
  const stubInflation = (parameters: Record<string, unknown>[], currencies: Record<string, unknown>[], answer: Record<string, Answer> = {}) =>
    stubApi({ parameters, currencies }, { answer: { ...WRITES_OK, ...answer } })
  const currencies = [{ rowid: 1, code: 'EUR', inflation: 0 }, { rowid: 2, code: 'RUB', inflation: 1 }, { rowid: 3, code: 'USD', inflation: 0 }]
  const rate = { rowid: 3, key: 'inflation_rate', value: 8.7, description: null }

  const section = () => within(screen.getByRole('region', { name: 'Inflation' }))
  const save = () => section().getByRole('button', { name: 'Save' })
  const input = () => screen.findByRole('textbox', { name: 'Inflation for calculations (%)' })

  it('keeps rate and currency as a draft until Save and Cancel restores both', async () => {
    const fetchMock = stubInflation([rate], currencies)
    renderPage(<DataPage screen={ParametersView} />)
    const field = await input()
    const currency = section().getByRole('combobox', { name: 'Currency' })
    expect(save()).toBeDisabled()
    fireEvent.change(field, { target: { value: '9.5' } })
    fireEvent.blur(field)
    fireEvent.change(currency, { target: { value: 'USD' } })
    expect(sent(fetchMock, WRITES)).toEqual([])
    fireEvent.click(section().getByRole('button', { name: 'Cancel' }))
    expect(field).toHaveValue('8.7')
    expect(currency).toHaveValue('RUB')
    expect(save()).toBeDisabled()
    fireEvent.change(field, { target: { value: '8.700' } })
    expect(save()).toBeDisabled()
  })

  it('requires both values and creates the rate and currency together on Save', async () => {
    const fetchMock = stubInflation([], currencies.map(c => ({ ...c, inflation: 0 })))
    renderPage(<DataPage screen={ParametersView} />)
    fireEvent.change(await input(), { target: { value: '4,2' } })
    expect(save()).toBeDisabled()
    fireEvent.change(section().getByRole('combobox', { name: 'Currency' }), { target: { value: 'USD' } })
    fireEvent.click(save())
    await waitFor(() => expect(sent(fetchMock, WRITES)).toEqual([
      { method: 'POST', url: '/api/admin/parameters', body: { key: 'inflation_rate', value: 4.2 } },
      { method: 'PUT', url: '/api/admin/currencies/3', body: { inflation: 1 } },
    ]))
  })

  it('accepts deflation and submits only once while pending', async () => {
    const gate = deferred()
    const fetchMock = stubInflation([rate], currencies, { 'PUT *': (_init, fallback) => gate.promise.then(fallback) })
    const client = testClient()
    renderPage(<DataPage screen={ParametersView} />, { client })
    const field = await input()
    fireEvent.change(field, { target: { value: '-0,125' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Inflation' }))
    fireEvent.submit(screen.getByRole('form', { name: 'Inflation' }))
    expect(field).toBeDisabled()
    expect(save()).toBeDisabled()
    await waitFor(() => expect(sent(fetchMock, WRITES)).toHaveLength(1))
    gate.resolve()
    await settled(client)
    expect(sent(fetchMock, WRITES)).toEqual([{ method: 'PUT', url: '/api/admin/parameters/3', body: { value: -0.125 } }])
  })

  it('moves the flag on Save and refreshes the snapshot', async () => {
    const fetchMock = stubInflation([rate], currencies)
    const client = testClient()
    client.setQueryData(['snapshot', 'USD'], { cached: true })
    renderPage(<DataPage screen={ParametersView} />, { client })
    await input()
    fireEvent.change(section().getByRole('combobox', { name: 'Currency' }), { target: { value: 'USD' } })
    fireEvent.click(save())
    await waitFor(() => expect(sent(fetchMock, WRITES)).toEqual([
      { method: 'PUT', url: '/api/admin/currencies/2', body: { inflation: 0 } },
      { method: 'PUT', url: '/api/admin/currencies/3', body: { inflation: 1 } },
    ]))
    await waitFor(() => expect(client.getQueryState(['snapshot', 'USD'])?.isInvalidated).toBe(true))
  })

  it('keeps the draft after a partial failure and refetches both tables and snapshot', async () => {
    const fetchMock = stubInflation([rate], currencies, { 'PUT /api/admin/currencies/3': () => jsonResponse({ error: 'failed move' }, 500) })
    const client = testClient()
    client.setQueryData(['snapshot', 'USD'], { cached: true })
    renderPage(<DataPage screen={ParametersView} />, { client })
    const field = await input()
    fireEvent.change(field, { target: { value: '9' } })
    const currency = section().getByRole('combobox', { name: 'Currency' })
    fireEvent.change(currency, { target: { value: 'USD' } })
    fireEvent.click(save())
    await waitFor(() => expect(save()).toBeEnabled())
    expect(sent(fetchMock, WRITES)).toHaveLength(3)
    expect(field).toHaveValue('9')
    expect(currency).toHaveValue('USD')
    for (const table of ['currencies', 'parameters']) {
      expect(fetchMock.mock.calls.filter(([url, init]) => url === `/api/admin/${table}` && !init?.method).length).toBeGreaterThanOrEqual(2)
    }
    expect(client.getQueryState(['snapshot', 'USD'])?.isInvalidated).toBe(true)
  })
})

describe('MembersBlock', () => {
  it('readOnlyRemove: no remove button, the add field works, onAdded gets the trimmed name', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const onAdded = vi.fn()
    renderPage(<MembersBlock members={[{ rowid: 1, name: 'Robin' }]} readOnlyRemove onAdded={onAdded} />)
    expect(screen.getByText('Robin')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: /Members/ }), { target: { value: ' Noa ' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('Noa'))
    expect(sent(fetchMock, 'POST')[0]?.body).toEqual({ name: 'Noa' })
  })

  it('a second submit while the first POST is pending sends nothing', async () => {
    const post = deferred<Response>()
    const fetchMock = vi.fn(() => post.promise)
    vi.stubGlobal('fetch', fetchMock)
    const onAdded = vi.fn()
    renderPage(<MembersBlock members={[]} readOnlyRemove onAdded={onAdded} />)
    const field = screen.getByRole('textbox', { name: /Members/ })
    fireEvent.change(field, { target: { value: 'Noa' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    post.resolve(jsonResponse({ ok: true }))
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1))
    expect(sent(fetchMock, 'POST')).toHaveLength(1)
  })

  it('readOnlyRemove: the names and the add field are one list, the only one named "Members"', () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    renderPage(<MembersBlock members={[{ rowid: 1, name: 'Robin' }, { rowid: 2, name: 'Noa' }]} readOnlyRemove onAdded={() => {}} />)
    const field = screen.getByRole('textbox', { name: /Members/ })
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByText('Robin').parentElement).toBe(field.closest('.tag-list'))
    expect(screen.getByText('Noa').parentElement).toBe(field.closest('.tag-list'))
  })

  it('a failure other than 409 with onAdded set shows the error toast and does not call onAdded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'boom' } }, 500)))
    const onAdded = vi.fn()
    renderPage(<MembersBlock members={[]} readOnlyRemove onAdded={onAdded} />)
    const field = screen.getByRole('textbox', { name: /Members/ })
    fireEvent.change(field, { target: { value: 'Noa' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    expect(await screen.findByText(/Could not save/)).toBeInTheDocument()
    expect(onAdded).not.toHaveBeenCalled()
    expect(field).toHaveValue('Noa')
  })

  it('a 409 answer also calls onAdded and shows no error toast', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'duplicate' } }, 409)))
    const onAdded = vi.fn()
    renderPage(<MembersBlock members={[{ rowid: 1, name: 'Noa' }]} readOnlyRemove onAdded={onAdded} />)
    fireEvent.change(screen.getByRole('textbox', { name: /Members/ }), { target: { value: 'Noa' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }))
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('Noa'))
    expect(screen.queryByText('Could not save')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('CurrenciesBlock', () => {
  it('lockedCode: the locked tag has no remove button, the others have one, the explanation shows', () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    renderPage(<CurrenciesBlock currencies={[{ rowid: 1, code: 'EUR' }, { rowid: 2, code: 'USD' }]} lockedCode="USD" />)
    expect(screen.getByText('USD')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove: USD' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove: EUR' })).toBeInTheDocument()
    expect(screen.queryByText('The currency for totals is always included.')).not.toBeInTheDocument()
  })

  it('lockedCode: one list, the locked tag first, one search field', () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    renderPage(<CurrenciesBlock currencies={[{ rowid: 1, code: 'EUR' }, { rowid: 2, code: 'USD' }]} lockedCode="USD" />)
    const field = screen.getByRole('combobox', { name: /Currencies/ })
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    const list = field.closest('.tag-list')!
    expect([...list.querySelectorAll('.tag')].map(tag => tag.textContent)).toEqual(['USD', 'EUR'])
  })

  it('readOnlyRemove: no tag has a remove button, the search stays, no locked-currency note', () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    renderPage(<CurrenciesBlock currencies={[{ rowid: 1, code: 'EUR' }, { rowid: 2, code: 'USD' }]} readOnlyRemove />)
    expect(screen.queryAllByRole('button', { name: /^Remove/ })).toEqual([])
    expect(screen.getByRole('combobox', { name: /Currencies/ })).toBeInTheDocument()
    expect(screen.queryByText(/currency for totals is always included/)).toBeNull()
  })
})

it('"Track income and expenses" saves the family parameter; off hides the baseline spending form', async () => {
  const fetchMock = stubApi({ currencies: [{ rowid: 1, code: 'USD' }] })
  renderPage(<ParametersView />)
  const toggle = await screen.findByRole('switch', { name: 'Track income and expenses when closing the month' })
  expect(toggle).toHaveAttribute('aria-checked', 'true')
  expect(await screen.findByRole('region', { name: 'Base monthly expenses' })).toBeInTheDocument()
  fireEvent.click(toggle)
  await waitFor(() => expect(sent(fetchMock, WRITES)).toEqual([{ method: 'PUT', url: '/api/settings', body: { trackFlows: false } }]))
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Track income and expenses when closing the month' })).toHaveAttribute('aria-checked', 'false'))
  expect(screen.queryByRole('region', { name: 'Base monthly expenses' })).toBeNull()
})

it('shows the baseline spending form in general parameters', async () => {
  stubApi({ currencies: [{ rowid: 1, code: 'USD' }] }, { answer: {
    'GET /api/spending': () => jsonResponse({ categories: [], accounts: [], sources: [], manual: null }),
  } })
  renderPage(<ParametersView />)
  const section = await screen.findByRole('region', { name: 'Base monthly expenses' })
  expect(await within(section).findByRole('textbox', { name: /^Amount/ })).toBeVisible()
  expect(section).toHaveTextContent('not an expense record')
})

it('failed currencies read has persistent recovery instead of an empty catalog', async () => {
  let fail = true
  stubApi({}, { answer: { 'GET /api/admin/currencies': (_init, next) => fail ? jsonResponse({}, 503) : next() } })
  renderPage(<DataPage screen={ParametersView} />)
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument())
})
