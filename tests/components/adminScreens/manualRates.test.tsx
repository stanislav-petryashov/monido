import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { ManualRates } from '../../../src/pages/admin/ManualRates'
import { deferred, jsonResponse, sent, stubApi, WRITES } from '../../helpers/http'
import { renderAdmin } from '../../helpers/render'

function setup(readOnly = false) {
  const fetchMock = stubApi({ fx_manual_rates: [{ rowid: 1, currency: 'ARS', date: '2026-01-01', per_usd: 1500 }] }, {
    answer: Object.fromEntries(WRITES.map(method => [`${method} *`, () => jsonResponse({ ok: true })])),
  })
  const { container } = renderAdmin(<ManualRates embedded currencies={['USD', 'ARS', 'EUR']} readOnly={readOnly} />)
  const details = container.querySelector('details')!
  expect(details.open).toBe(false)
  fireEvent.click(details.querySelector('summary')!)
  return fetchMock
}

it('reveals an empty form and requires currency, a readable date and a positive rate; cancel resets it', async () => {
  setup()
  await screen.findByText('1 USD = 1,500 ARS')
  expect(screen.queryByRole('group', { name: 'Manual rates' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Add a rate' }))
  let form = screen.getByRole('group', { name: 'Manual rates' })
  const add = within(form).getByRole('button', { name: 'Add a rate' })
  expect(add).toBeDisabled()
  expect(within(form).queryByRole('option', { name: 'USD' })).toBeNull()
  fireEvent.change(within(form).getByLabelText('Currency'), { target: { value: 'ARS' } })
  fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-01-01' } })
  const rate = within(form).getByRole('textbox', { name: /^Rate per 1 USD/ })
  fireEvent.change(rate, { target: { value: '0' } })
  expect(add).toBeDisabled()
  fireEvent.change(rate, { target: { value: '1500' } })
  expect(add).toBeEnabled()
  fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '01/' } })
  expect(add).toBeDisabled()
  fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('group', { name: 'Manual rates' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Add a rate' }))
  form = screen.getByRole('group', { name: 'Manual rates' })
  expect(within(form).getByLabelText('Currency')).toHaveValue('')
  expect(within(form).getByLabelText('Date')).toHaveValue('')
  expect(within(form).getByRole('textbox', { name: /^Rate per 1 USD/ })).toHaveValue('')
})

it('keeps existing rate editing and saves only the new rate value', async () => {
  const fetchMock = setup()
  fireEvent.click(await screen.findByRole('button', { name: /^Edit: ARS/ }))
  fireEvent.change(screen.getByRole('textbox', { name: /^Rate.*ARS/ }), { target: { value: '1300.5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(sent(fetchMock, WRITES)).toEqual([
    { method: 'PUT', url: '/api/admin/fx_manual_rates/1', body: { per_usd: 1300.5 } },
  ]))
})

it('keeps rates readable without exposing writes to a read-only user', async () => {
  setup(true)
  await screen.findByText('1 USD = 1,500 ARS')
  expect(screen.queryByRole('button')).toBeNull()
})


it('locks the draft during a pending add, keeps it after failure, and closes it after a successful retry', async () => {
  const failed = deferred<Response>()
  const saved = deferred<Response>()
  const fetchMock = setup().answer({ 'POST *': () => failed.promise })
  await screen.findByText('1 USD = 1,500 ARS')
  fireEvent.click(screen.getByRole('button', { name: 'Add a rate' }))
  const form = screen.getByRole('group', { name: 'Manual rates' })
  const currency = within(form).getByLabelText('Currency')
  const date = within(form).getByLabelText('Date')
  const rate = within(form).getByRole('textbox', { name: /^Rate per 1 USD/ })
  fireEvent.change(currency, { target: { value: 'ARS' } })
  fireEvent.change(date, { target: { value: '2026-02-01' } })
  fireEvent.change(rate, { target: { value: '1600' } })
  const add = within(form).getByRole('button', { name: 'Add a rate' })
  const controls = [currency, date, rate, ...within(form).getAllByRole('button')]
  fireEvent.click(add)
  for (const control of controls) expect(control).toBeDisabled()
  await waitFor(() => expect(sent(fetchMock, WRITES)).toHaveLength(1))

  failed.resolve(jsonResponse({ error: 'Could not save' }, 500))
  await waitFor(() => expect(add).toBeEnabled())
  for (const control of controls) expect(control).toBeEnabled()
  expect(currency).toHaveValue('ARS')
  expect(date).toHaveValue('02/01/2026')
  expect(rate).toHaveValue('1,600')

  fetchMock.answer({ 'POST *': () => saved.promise })
  fireEvent.click(add)
  for (const control of controls) expect(control).toBeDisabled()
  saved.resolve(jsonResponse({ ok: true }))
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Manual rates' })).toBeNull())
  expect(screen.getByRole('button', { name: 'Add a rate' })).toBeEnabled()
  expect(sent(fetchMock, WRITES).map(request => request.body)).toEqual([
    { currency: 'ARS', date: '2026-02-01', per_usd: 1600 },
    { currency: 'ARS', date: '2026-02-01', per_usd: 1600 },
  ])
})
