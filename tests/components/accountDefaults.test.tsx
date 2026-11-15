import { fireEvent, screen, waitFor } from '@testing-library/react'
import { AccountForm } from '../../src/pages/admin/AccountForm'
import { EMPTY_ACCOUNT, withListDefaults } from '../../src/pages/admin/accountValues'
import { renderAdmin, testClient } from '../helpers/render'
import { deferred, jsonResponse, stubApi } from '../helpers/http'

it('uses a listed family currency for new accounts, falls back and preserves edits', () => {
  expect(withListDefaults(EMPTY_ACCOUNT, ['Robin'], ['EUR', 'USD'], 'USD').currency).toBe('USD')
  expect(withListDefaults(EMPTY_ACCOUNT, ['Robin'], ['EUR', 'USD'], 'RUB').currency).toBe('EUR')
  expect(withListDefaults({ ...EMPTY_ACCOUNT, currency: 'GBP' }, [], ['EUR', 'USD'], 'USD').currency).toBe('GBP')
})

it('applies a late family default in the shared wizard/month account form without marking it dirty', async () => {
  const gate = deferred<Response>()
  stubApi({}, { answer: { '/api/settings': () => gate.promise } })
  const onAdd = vi.fn(() => null)
  const onDirtyChange = vi.fn()
  renderAdmin(<AccountForm members={['Robin']} currencies={['EUR', 'USD']} suggestions={[]} onAdd={onAdd} onCancel={() => {}} onDirtyChange={onDirtyChange} />, { client: testClient() })
  gate.resolve(jsonResponse({ currency: 'USD', language: 'en-US' }))
  await waitFor(() => expect(screen.getByRole('radio', { name: 'USD' })).toBeChecked())
  expect(onDirtyChange).not.toHaveBeenCalledWith(true)
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Savings' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Savings', currency: 'USD' }))
})

it('keeps an explicit currency choice when family settings arrive later', async () => {
  const gate = deferred<Response>()
  stubApi({}, { answer: { '/api/settings': () => gate.promise } })
  const onAdd = vi.fn(() => null)
  const client = testClient()
  renderAdmin(<AccountForm members={['Robin']} currencies={['EUR', 'USD', 'GBP']} suggestions={[]} onAdd={onAdd} onCancel={() => {}} />, { client })
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Savings' } })
  fireEvent.click(screen.getByRole('radio', { name: 'GBP' }))
  gate.resolve(jsonResponse({ currency: 'USD', language: 'en-US' }))
  await waitFor(() => expect(client.isFetching()).toBe(0))
  expect(screen.getByRole('radio', { name: 'GBP' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ currency: 'GBP' }))
})
