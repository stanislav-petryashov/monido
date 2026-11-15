import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { calls, readyButton, renderWizard, stubSetupApi } from '../../helpers/setup'
import { jsonResponse } from '../../helpers/http'

beforeEach(() => { sessionStorage.clear(); window.history.replaceState(null, '', '/setup') })
afterEach(() => sessionStorage.clear())

it('always has four steps and recovers obsolete stored steps', async () => {
  stubSetupApi()
  renderWizard({ step: 'finish' as never })
  const list = await screen.findByRole('list', { name: 'Setup steps' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(4)
  expect(await screen.findByRole('heading', { name: 'Set up your finances' })).toBeInTheDocument()
})

it('saves the base currency on selection and unlocks the previous base before finishing', async () => {
  const fetchMock = stubSetupApi({ currencies: ['USD', 'EUR'] })
  renderWizard({ step: 'currencies' })
  const select = await screen.findByRole('combobox', { name: 'Currency for totals' })
  fireEvent.change(select, { target: { value: 'EUR' } })
  await waitFor(() => expect(select).toHaveValue('EUR'))
  expect(calls(fetchMock, 'PUT')).toContainEqual(['PUT', '/api/settings', { currency: 'EUR' }])
  expect(await screen.findByRole('button', { name: 'Remove: USD' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Remove: EUR' })).toBeNull()
  fireEvent.click(await readyButton('Finish setup'))
  await waitFor(() => expect(calls(fetchMock, 'PUT')).toContainEqual(['PUT', '/api/setup', { state: 'done' }]))
  await waitFor(() => expect(window.location.pathname).toBe('/'))
})

it('keeps the currencies step available when finishing fails and retries', async () => {
  let fail = true
  const fetchMock = stubSetupApi({ answer: { 'PUT /api/setup': () => fail ? jsonResponse({ error: { code: 'save_failed' } }, 500) : jsonResponse({ state: 'done', hasData: false, hasAccounts: false }) } })
  renderWizard({ step: 'currencies' })
  fireEvent.click(await readyButton('Finish setup'))
  await screen.findByRole('alert')
  expect(window.location.pathname).toBe('/setup')
  fail = false
  fireEvent.click(await readyButton('Finish setup'))
  await waitFor(() => expect(window.location.pathname).toBe('/'))
  expect(calls(fetchMock, 'PUT').filter(([, url]) => url === '/api/setup')).toHaveLength(2)
})
