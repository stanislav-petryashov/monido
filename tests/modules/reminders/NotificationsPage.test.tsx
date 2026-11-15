import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { RemindersView } from '../../../src/domain/api'
import { NotificationsPage } from '../../../src/modules/reminders/NotificationsPage'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { renderAdmin } from '../../helpers/render'
import { jsonResponse, sent, stubApi } from '../../helpers/http'

const view: RemindersView = {
  configured: true, linked: true, openMonths: ['2031-09'], next: null,
  settings: { enabled: false, startDay: 3, hour: 10, timezone: 'UTC', chatTitle: null, lastSentAt: null, lastError: null },
  recipients: [{ id: 'user:1', title: 'Anna', kind: 'user', enabled: true }, { id: 'user:2', title: 'Boris', kind: 'user', enabled: false }, { id: 'group:-100', title: 'Family', kind: 'group', enabled: true }],
}
function stub() {
  return stubApi().answer({
    'GET /api/users': () => jsonResponse({ users: [], mode: 'password', meId: null, bot: { configured: true, username: 'family_bot', problem: null } }),
    'GET /api/family-telegram': () => jsonResponse({ users: [], groups: [] }),
    'GET /api/reminders': () => jsonResponse(view),
    'POST /api/reminders/test-recipient': () => jsonResponse(view),
  })
}
afterEach(resetAuth)
it('tests the selected recipient, excluding opted-out recipients, without saving schedule drafts', async () => {
  const fetchMock = stub()
  renderAdmin(<NotificationsPage />)
  const test = await screen.findByRole('button', { name: 'Check delivery' })
  await waitFor(() => expect(test).toBeEnabled())
  fireEvent.click(test)
  const recipient = screen.getByRole('combobox', { name: 'Send to' })
  expect(screen.queryByRole('option', { name: 'Boris' })).toBeNull()
  fireEvent.change(recipient, { target: { value: 'group:-100' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'From day' }), { target: { value: '8' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send test' }))
  await waitFor(() => expect(sent(fetchMock, 'POST')).toEqual([{ url: '/api/reminders/test-recipient', method: 'POST', body: { recipientId: 'group:-100' } }]))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Send test' })).toBeNull())
  expect(screen.getByRole('combobox', { name: 'From day' })).toHaveValue('8')
  expect(sent(fetchMock, 'PUT')).toEqual([])
})
it('keeps test errors actionable and reloads the stored delivery status', async () => {
  const fetchMock = stub().answer({ 'POST /api/reminders/test-recipient': () => jsonResponse({ error: { code: 'telegram.unavailable' } }, 502) })
  renderAdmin(<NotificationsPage />)
  const test = await screen.findByRole('button', { name: 'Check delivery' })
  await waitFor(() => expect(test).toBeEnabled())
  fireEvent.click(test)
  const before = sent(fetchMock, 'GET').filter(r => r.url === '/api/reminders').length
  fireEvent.click(screen.getByRole('button', { name: 'Send test' }))
  await waitFor(() => expect(sent(fetchMock, 'GET').filter(r => r.url === '/api/reminders').length).toBeGreaterThan(before))
  expect(screen.getByRole('button', { name: 'Send test' })).toBeEnabled()
})
it('does not offer delivery management without manage rights', async () => {
  setAuth({ me: { name: 'Viewer', rights: { edit: true, vote: true, manage: false } } })
  const fetchMock = stub()
  renderAdmin(<NotificationsPage />)
  await screen.findByRole('region', { name: 'Schedule' })
  expect(screen.queryByRole('button', { name: 'Check delivery' })).toBeNull()
  expect(screen.queryByRole('region', { name: 'Recipients' })).toBeNull()
  expect(sent(fetchMock).some(r => r.url === '/api/family-telegram')).toBe(false)
})
