import { fireEvent, screen, waitFor } from '@testing-library/react'
import { deferred, jsonResponse } from '../../helpers/http'
import { calls, readyButton, renderWizard, stubSetupApi } from '../../helpers/setup'

const open = () => screen.findByRole('heading', { name: 'Which currencies do you use?' })
const finish = () => screen.getByRole('button', { name: 'Finish setup' })
const search = () => screen.findByRole<HTMLInputElement>('combobox', { name: 'Add a currency' })
beforeEach(() => { sessionStorage.clear(); window.history.replaceState(null, '', '/setup') })
afterEach(() => sessionStorage.clear())

it('lists seeded currencies, names the base and protects it from removal', async () => {
  stubSetupApi({ currencies: ['USD', 'EUR', 'RUB'] })
  renderWizard({ step: 'currencies' })
  await open()
  expect(await screen.findByRole('combobox', { name: 'Currency for totals' })).toHaveValue('USD')
  expect(screen.getByRole('option', { name: /USD · US Dollar/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remove: USD' })).toBeNull()
  expect(screen.getAllByRole('button', { name: /Remove:/ })).toHaveLength(2)
})

it('Enter with a code adds it without finishing', async () => {
  const mock = stubSetupApi()
  renderWizard({ step: 'currencies' })
  const input = await search()
  fireEvent.change(input, { target: { value: 'EUR' } })
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)
  await waitFor(() => expect(calls(mock, 'POST')).toEqual([['POST', '/api/admin/currencies', { code: 'EUR' }]]))
  expect(calls(mock, 'PUT')).toEqual([])
  expect(await open()).toBeInTheDocument()
})

it('completes on empty-field Enter without rewriting the currency', async () => {
  const mock = stubSetupApi()
  renderWizard({ step: 'currencies' })
  const input = await search()
  await readyButton('Finish setup')
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true)
  input.form!.requestSubmit()
  await waitFor(() => expect(window.location.pathname).toBe('/'))
  expect(calls(mock, 'PUT')).toEqual([['PUT', '/api/setup', { state: 'done' }]])
})

it('a failed currency save keeps the old selection and its removal protection', async () => {
  const mock = stubSetupApi({ currencies: ['USD', 'EUR'], answer: { 'PUT /api/settings': () => jsonResponse({ error: { code: 'save_failed' } }, 500) } })
  renderWizard({ step: 'currencies' })
  const select = await screen.findByRole('combobox', { name: 'Currency for totals' })
  fireEvent.change(select, { target: { value: 'EUR' } })
  await screen.findByRole('alert')
  expect(select).toHaveValue('USD')
  expect(screen.queryByRole('button', { name: 'Remove: USD' })).toBeNull()
  expect(calls(mock, 'PUT').filter(([, url]) => url === '/api/setup')).toEqual([])
})

it('does not finish or allow removal during a base-currency save', async () => {
  const pending = deferred<Response>()
  const mock = stubSetupApi({ currencies: ['USD', 'EUR'], answer: { 'PUT /api/settings': () => pending.promise } })
  renderWizard({ step: 'currencies' })
  fireEvent.change(await screen.findByRole('combobox', { name: 'Currency for totals' }), { target: { value: 'EUR' } })
  await waitFor(() => expect(finish()).toBeDisabled())
  expect(screen.getByRole('button', { name: 'Remove: EUR' })).toBeDisabled()
  fireEvent.click(finish())
  expect(calls(mock, 'PUT').filter(([, url]) => url === '/api/setup')).toEqual([])
  pending.resolve(jsonResponse({ language: 'en-US', currency: 'EUR' }))
  await readyButton('Finish setup')
})

it.each(['/api/settings', '/api/admin/currencies'])('blocks completion when %s cannot be loaded and recovers on retry', async url => {
  let fail = true
  stubSetupApi({ answer: { [`GET ${url}`]: (_init, next) => fail ? jsonResponse({ error: { code: 'load_failed' } }, 500) : next() } })
  renderWizard({ step: 'currencies' })
  await screen.findByText('Failed to load')
  expect(finish()).toBeDisabled()
  expect(screen.queryAllByRole('button', { name: /Remove:/ })).toEqual([])
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await readyButton('Finish setup')
})

it('waits for an added currency before allowing completion', async () => {
  const pending = deferred<Response>()
  const mock = stubSetupApi({ answer: { 'POST /api/admin/currencies': () => pending.promise } })
  renderWizard({ step: 'currencies' })
  const input = await search()
  fireEvent.change(input, { target: { value: 'EUR' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(finish()).toBeDisabled())
  fireEvent.click(finish())
  expect(calls(mock, 'PUT')).toEqual([])
  pending.resolve(jsonResponse({ rowid: 2, code: 'EUR' }))
  await readyButton('Finish setup')
})
