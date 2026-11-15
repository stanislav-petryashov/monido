import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DataPage } from '../../../src/pages/admin/DataPage'
import { RealEstateScreen } from '../../../src/modules/real-estate/RealEstateScreen'
import { deferred, jsonResponse, sent, stubApi } from '../../helpers/http'
import { renderAdmin, testClient } from '../../helpers/render'
import { enterValuation, propertyMenu, typeText } from '../../helpers/adminScreens'

const property = { rowid: 1, name: 'Home', purchase_date: '2019-01-01', purchase_price: 100000, purchase_currency: 'USD', member: null, valuation_year: 2023, value: 120000, currency: 'USD', notes: 'First' }
const fixtures = () => ({ real_estate: [property, { ...property, rowid: 2, valuation_year: 2024, value: 130000, notes: 'Second' }], currencies: [{ rowid: 1, code: 'USD' }] })

describe('atomic property changes', () => {
  it('associates an empty property name with an error and keeps the draft', async () => {
    const fetchMock = stubApi(fixtures())
    renderAdmin(<DataPage screen={RealEstateScreen} />)
    await screen.findByRole('button', { name: 'Property actions' })
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Property' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '+ Property' }))
    const dialog = await screen.findByRole('dialog', { name: 'New property' })
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('Enter a property name')).toBeInTheDocument()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Enter a property name')
    expect(name).toHaveFocus()
    expect(sent(fetchMock, 'POST')).toHaveLength(0)
  })

  it('requires purchase date and price, retaining the draft until corrected', async () => {
    const api = stubApi(fixtures())
    renderAdmin(<DataPage screen={RealEstateScreen} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Property' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '+ Property' }))
    const dialog = await screen.findByRole('dialog', { name: 'New property' })
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    const date = within(dialog).getByRole('textbox', { name: 'Purchase date' })
    const price = within(dialog).getByRole('textbox', { name: 'Purchase price (USD)' })
    fireEvent.change(name, { target: { value: 'House' } })
    typeText(within(dialog).getByRole('textbox', { name: 'Value (USD)' }), '123000')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(date).toHaveAttribute('aria-invalid', 'true')
    expect(date).toHaveFocus()
    expect(price).toHaveAttribute('aria-invalid', 'true')
    expect(sent(api, 'POST')).toHaveLength(0)
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled())
    typeText(date, '01012020')
    typeText(price, '0')
    expect(date).not.toHaveAttribute('aria-invalid', 'true')
    expect(price).not.toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveValue('House')
    expect(within(dialog).getByRole('textbox', { name: 'Value (USD)' })).toHaveValue('123,000')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(api, 'POST')).toHaveLength(1))
  })

  it.each(['date', 'price', 'unreadable price'])('identifies %s before saving', async missing => {
    const api = stubApi(fixtures())
    renderAdmin(<DataPage screen={RealEstateScreen} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Property' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '+ Property' }))
    const dialog = await screen.findByRole('dialog', { name: 'New property' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'House' } })
    const date = within(dialog).getByRole('textbox', { name: 'Purchase date' })
    const price = within(dialog).getByRole('textbox', { name: 'Purchase price (USD)' })
    if (missing !== 'date') typeText(date, '01012020')
    if (missing === 'date') typeText(price, '100')
    if (missing === 'unreadable price') typeText(price, '1,')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const invalid = missing === 'date' ? date : price
    expect(invalid).toHaveAttribute('aria-invalid', 'true')
    expect(invalid).toHaveAccessibleDescription()
    expect(invalid).toHaveFocus()
    expect(sent(api, 'POST')).toHaveLength(0)
  })

  it('focuses an impossible purchase date instead of calling it incomplete', async () => {
    const api = stubApi(fixtures())
    renderAdmin(<DataPage screen={RealEstateScreen} />)
    await screen.findByRole('button', { name: 'Property actions' })
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Property' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '+ Property' }))
    const dialog = await screen.findByRole('dialog', { name: 'New property' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'House' } })
    const date = within(dialog).getByRole('textbox', { name: 'Purchase date' })
    fireEvent.change(date, { target: { value: '13/32/2026' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(date).toHaveAccessibleDescription(/no such date/i)
    expect(date).toHaveFocus()
    expect(sent(api, 'POST')).toHaveLength(0)
  })

  it('keeps the original valuation year when refetch reuses its rowid for another year', async () => {
    const tables = fixtures()
    const fetchMock = stubApi(tables, { answer: { 'PUT *': () => jsonResponse({ error: { code: 'row_changed' } }, 409) } })
    const client = testClient()
    renderAdmin(<DataPage screen={RealEstateScreen} />, { client })
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: 2024' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const input = screen.getByRole('textbox', { name: 'Value (USD)' })
    typeText(input, '145000')
    tables.real_estate[1] = { ...tables.real_estate[1], valuation_year: 2025 }
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'real_estate'] }) })
    await screen.findByText(/2025/)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
    expect(sent(fetchMock, 'PUT')).toEqual([expect.objectContaining({ url: '/api/admin/real_estate/2', body: expect.objectContaining({ expectedIdentity: { name: 'Home', valuation_year: 2024 }, value: '145000' }) })])
    expect(input).toHaveValue('145,000')
  })

  it.each(['new', 'edit'])('Enter in a %s valuation input still submits one save', async mode => {
    const fetchMock = stubApi(fixtures(), { answer: { 'POST *': () => jsonResponse({ error: 'offline' }, 500), 'PUT *': () => jsonResponse({ error: 'offline' }, 500) } })
    renderAdmin(<DataPage screen={RealEstateScreen} />)
    if (mode === 'new') await enterValuation()
    else {
      fireEvent.click(await screen.findByRole('button', { name: 'Actions: 2024' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    }
    const input = screen.getByRole('textbox', { name: 'Value (USD)' })
    typeText(input, '145000')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
    expect(sent(fetchMock, ['POST', 'PUT'])).toEqual([expect.objectContaining({
      method: mode === 'new' ? 'POST' : 'PUT',
      url: mode === 'new' ? '/api/admin/real_estate' : '/api/admin/real_estate/2',
      body: expect.objectContaining({ value: '145000' }),
    })])
  })
  it.each(['new', 'edit'])('Enter on %s valuation Cancel asks to discard and never saves', async mode => {
    const fetchMock = stubApi(fixtures())
    renderAdmin(<DataPage screen={RealEstateScreen} />)
    if (mode === 'new') await enterValuation()
    else {
      fireEvent.click(await screen.findByRole('button', { name: 'Actions: 2024' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    }
    typeText(screen.getByRole('textbox', { name: 'Value (USD)' }), '145000')
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    cancel.focus()
    // The browser activates a focused button only when keydown did not prevent its default.
    if (fireEvent.keyDown(cancel, { key: 'Enter' })) fireEvent.click(cancel)
    const question = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })
    expect(sent(fetchMock, ['POST', 'PUT'])).toHaveLength(0)
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('textbox', { name: 'Value (USD)' })).toHaveValue('145,000')
  })
  it('keeps a rejected valuation edit open and sends only one pending save', async () => {
    const gate = deferred()
    const fetchMock = stubApi(fixtures(), { answer: { 'PUT *': () => gate.promise.then(() => jsonResponse({ error: 'boom' }, 500)) } })
    renderAdmin(<DataPage screen={RealEstateScreen} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: 2024' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    typeText(screen.getByRole('textbox', { name: 'Value (USD)' }), '145000')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'PUT')).toHaveLength(1))
    expect(screen.getByRole('textbox', { name: 'Value (USD)' })).toBeDisabled()
    gate.resolve()
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Value (USD)' })).toHaveValue('145,000')
    expect(screen.getByRole('textbox', { name: 'Value (USD)' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('asks before switching away from a dirty property and keeps input when canceled', async () => {
    stubApi({ ...fixtures(), real_estate: [property, { ...property, rowid: 3, name: 'Other' }] })
    renderAdmin(<DataPage screen={RealEstateScreen} />)
    await propertyMenu('Edit property')
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Unsent' } })
    fireEvent.click(screen.getByRole('button', { name: /Other/ }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Unsent')
  })
  it('sends shared fields once and keeps selection and edits after a failed save', async () => {
    const gate = deferred()
    const fetchMock = stubApi(fixtures(), { answer: { 'POST *': () => gate.promise.then(() => jsonResponse({ error: 'boom' }, 500)), 'PUT *': () => gate.promise.then(() => jsonResponse({ error: 'boom' }, 500)) } })
    renderAdmin(<DataPage screen={RealEstateScreen} />)
    await propertyMenu('Edit property')
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, ['POST', 'PUT'])).toHaveLength(1))
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeDisabled()
    expect(sent(fetchMock, ['POST', 'PUT'])).toEqual([{ method: 'POST', url: '/api/real-estate/update', body: {
      name: 'Home', values: { name: 'Renamed', purchase_date: '2019-01-01', purchase_price: 100000, purchase_currency: 'USD', member: null },
      expected: { purchase_date: '2019-01-01', purchase_price: 100000, purchase_currency: 'USD', member: null },
    } }])
    expect(screen.getByRole('button', { name: /Home/ })).toHaveAttribute('aria-current', 'true')
    gate.resolve()
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Renamed')
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Home/ })).toHaveAttribute('aria-current', 'true')
  })

  it.each(['', '1,'])('preserves an unreadable purchase price %j without sending a mutation', async price => {
    const fetchMock = stubApi(fixtures())
    renderAdmin(<DataPage screen={RealEstateScreen} />)
    await propertyMenu('Edit property')
    typeText(screen.getByRole('textbox', { name: 'Purchase price (USD)' }), price)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
    expect(sent(fetchMock, ['POST', 'PUT'])).toHaveLength(0)
    expect(screen.getByRole('textbox', { name: 'Purchase price (USD)' })).toBeInTheDocument()
  })

  it('selects the renamed property only after a successful save', async () => {
    const gate = deferred()
    const tables = fixtures()
    const fetchMock = stubApi(tables, { answer: { 'POST /api/real-estate/update': () => gate.promise.then(() => {
      tables.real_estate = tables.real_estate.map(row => ({ ...row, name: 'Renamed' }))
      return jsonResponse({ saved: true })
    }) } })
    renderAdmin(<DataPage screen={RealEstateScreen} />)
    await propertyMenu('Edit property')
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1))
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Renamed')
    expect(screen.getByRole('button', { name: /Home/ })).toHaveAttribute('aria-current', 'true')
    gate.resolve()
    expect(await screen.findByRole('button', { name: /Renamed/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
  })

  it('sends one confirmed delete and retains the selected property on failure', async () => {
    const fetchMock = stubApi(fixtures(), { answer: { 'POST *': () => jsonResponse({ error: 'boom' }, 500), 'DELETE *': () => jsonResponse({ error: 'boom' }, 500) } })
    renderAdmin(<DataPage screen={RealEstateScreen} />)
    await propertyMenu('Delete property…')
    expect(sent(fetchMock, ['POST', 'DELETE'])).toHaveLength(0)
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Could not delete')).toBeInTheDocument()
    expect(sent(fetchMock, ['POST', 'DELETE'])).toEqual([{ method: 'POST', url: '/api/real-estate/delete', body: { name: 'Home' } }])
    expect(screen.getByRole('button', { name: /Home/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('deleting the only valuation asks to delete the property and deletes it whole', async () => {
    const fetchMock = stubApi({ ...fixtures(), real_estate: [property] }, { answer: { 'POST *': () => jsonResponse({ ok: true }) } })
    renderAdmin(<DataPage screen={RealEstateScreen} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: 2023' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(sent(fetchMock, ['POST', 'DELETE'])).toHaveLength(0)
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(sent(fetchMock, ['POST', 'DELETE'])).toEqual([{ method: 'POST', url: '/api/real-estate/delete', body: { name: 'Home' } }]))
  })
})

it.each(['new', 'edit'])('labels every %s valuation field and keeps its actions in the editor row', async mode => {
  stubApi(fixtures())
  renderAdmin(<DataPage screen={RealEstateScreen} />)
  if (mode === 'new') await enterValuation()
  else {
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: 2024' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
  }
  const row = screen.getByRole('textbox', { name: 'Value (USD)' }).closest('tr')!
  expect(row).toHaveClass('re-edrow')
  expect((within(row).getByRole('textbox', { name: 'Year' }) as HTMLInputElement).value).toMatch(mode === 'new' ? /^\d{4}$/ : /^2024$/)
  expect(within(row).getByRole('radiogroup', { name: 'Currency' })).toBeInTheDocument()
  expect(within(row).getByRole('textbox', { name: 'Note' })).toBeInTheDocument()
  expect(within(row).getByRole('button', { name: mode === 'new' ? 'Save valuation' : 'Save' })).toBeVisible()
  expect(within(row).getByRole('button', { name: 'Cancel' })).toBeVisible()
})

describe('record read recovery', () => {
  it('failed first read is not empty', async () => {
    let fail = true
    const api = stubApi(fixtures(), { answer: { 'GET /api/admin/real_estate': (_init, next) => fail ? jsonResponse({}, 503) : next() } })
    renderAdmin(<DataPage screen={RealEstateScreen} />)
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText(/add your first property/i)).not.toBeInTheDocument()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Property actions' })).toBeInTheDocument()
    expect(sent(api, ['POST', 'PUT'])).toHaveLength(0)
  })

  it('cached read failure keeps the dirty editor mounted', async () => {
    let fail = false
    const api = stubApi(fixtures(), { answer: { 'GET /api/admin/real_estate': (_init, next) => fail ? jsonResponse({}, 503) : next() } })
    const client = testClient()
    renderAdmin(<DataPage screen={RealEstateScreen} />, { client })
    fireEvent.click(await screen.findByRole('button', { name: 'Actions: 2024' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const input = screen.getByRole('textbox', { name: 'Value (USD)' })
    typeText(input, '145000')
    fail = true
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'real_estate'] }) })
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Value (USD)' })).toBe(input)
    expect(input).toHaveValue('145,000')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'Value (USD)' })).toBe(input)
    expect(input).toHaveValue('145,000')
    expect(sent(api, ['POST', 'PUT'])).toHaveLength(0)
  })
})

it('reference failure preserves current selections and blocks dependent create', async () => {
  let fail = true
  const api = stubApi(fixtures(), { answer: { 'GET /api/admin/currencies': (_init, next) => fail ? jsonResponse({}, 503) : next() } })
  renderAdmin(<DataPage screen={RealEstateScreen} />)
  await screen.findByRole('button', { name: 'Property actions' })
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '+ Property' })).toBeDisabled()
  expect(sent(api, 'POST')).toHaveLength(0)
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '+ Property' })).toBeEnabled())
})

it('reference failure preserves an existing selection and blocks dependent edits', async () => {
  let fail = true
  const api = stubApi(fixtures(), { answer: { 'GET /api/admin/currencies': (_init, next) => fail ? jsonResponse({}, 503) : next() } })
  renderAdmin(<DataPage screen={RealEstateScreen} />)
  await propertyMenu('Edit property')
  const input = screen.getByRole('textbox', { name: 'Name' })
  fireEvent.change(input, { target: { value: 'Draft home' } })
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  expect(sent(api, ['POST', 'PUT'])).toHaveLength(0)
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  expect(screen.getByRole('textbox', { name: 'Name' })).toBe(input)
  expect(input).toHaveValue('Draft home')
})

it('initial read retry stays visible and disabled until its GET settles', async () => {
  const gate = deferred()
  let fail = true
  const api = stubApi(fixtures(), { answer: { 'GET /api/admin/real_estate': async (_init, next) => {
    if (fail) return jsonResponse({}, 503)
    await gate.promise
    return next()
  } } })
  renderAdmin(<DataPage screen={RealEstateScreen} />)
  const retry = await screen.findByRole('button', { name: 'Retry' })
  fail = false
  fireEvent.click(retry)
  await waitFor(() => expect(retry).toBeDisabled())
  expect(screen.getByRole('button', { name: 'Retry' })).toBe(retry)
  expect(sent(api, ['POST', 'PUT'])).toHaveLength(0)
  gate.resolve()
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument())
})
