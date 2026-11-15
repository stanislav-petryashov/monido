import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { AuthSettingsView, UserView } from '../../src/domain/api'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { SignInSwitch } from '../../src/pages/settings/SignInSwitch'
import { authSettingsView, BOT_READY } from '../helpers/authSettings'
import { jsonResponse } from '../helpers/http'
import { renderAdmin, testClient } from '../helpers/render'

const anna: UserView = { id: 1, member: 'Anna', telegram: '@anna', invitePending: false, rights: { manage: true, edit: true, vote: true } }
function render({ bot = true, user = anna, proof = null, signIn = true, empty = false, wrongPassword = false }: { bot?: boolean; user?: UserView; proof?: AuthSettingsView['switchToTelegram']['proof']; signIn?: boolean; empty?: boolean; wrongPassword?: boolean } = {}) {
  let view = authSettingsView({ ...BOT_READY, ...(bot ? {} : { bot: { source: null, username: null, problem: null } }), switchToTelegram: { bot, linkedManager: true, proof } })
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET'
    if (url === '/api/auth-settings') return jsonResponse(view)
    if (url === '/api/users') return jsonResponse({ users: empty ? [] : [user], mode: 'password', meId: null, bot: { configured: bot, username: 'family_bot', problem: null } })
    if (url === '/api/admin/members') return jsonResponse({ rows: empty ? [] : [{ name: 'Anna', rowid: 1 }, { name: 'Boris', rowid: 2 }], columns: [] })
    if (url === '/api/family-telegram') return jsonResponse({ users: [{ userId: 1, signIn }], groups: [] })
    if (url === '/api/family-telegram/users/1' && method === 'PUT') { signIn = true; return jsonResponse({}) }
    if (url === '/api/users/1' && method === 'PUT') { user = { ...user, rights: { ...user.rights, manage: true } }; return jsonResponse({}) }
    if (url === '/api/auth/telegram' && method === 'POST') return jsonResponse({ link: 'https://t.me/family_bot?start=login_test' })
    if (url === '/api/auth/telegram') return jsonResponse({ status: 'waiting' })
    if (url === '/api/auth-settings/mode') return wrongPassword ? jsonResponse({ error: { code: 'wrong_current_password' } }, 401) : jsonResponse({ ok: true })
    if (url === '/api/auth') return jsonResponse({ mode: 'telegram', authenticated: true, me: { name: 'Anna', rights: anna.rights } })
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
  const client = testClient()
  const rendered = renderAdmin(<SignInSwitch />, { client })
  return { ...rendered, fetchMock, expire: async () => { view = { ...view, switchToTelegram: { ...view.switchToTelegram, proof: null } }; await act(() => client.invalidateQueries({ queryKey: ['admin', 'auth-settings'] })) } }
}

beforeEach(() => { setAuth({ mode: 'password', authenticated: true, me: null }); vi.stubGlobal('open', vi.fn()) })
afterEach(resetAuth)

it('shows only the bot task when the token is missing', async () => {
  render({ bot: false })
  expect(await screen.findByRole('heading', { name: 'Connect the bot' })).toBeInTheDocument()
  expect(screen.getByLabelText('Bot token')).toHaveValue('')
  expect(screen.queryByLabelText('Who are you in the family?')).toBeNull()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
})

it('skips a configured bot and reuses the linked manager account for fresh proof', async () => {
  const { fetchMock } = render()
  expect(await screen.findByText('Connected: @anna')).toBeInTheDocument()
  expect(screen.queryByLabelText('Bot token')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm in Telegram' }))
  await waitFor(() => expect(fetchMock.mock.calls.find(([url, init]) => url === '/api/auth/telegram' && init?.method === 'POST')).toBeTruthy())
  const post = fetchMock.mock.calls.find(([url, init]) => url === '/api/auth/telegram' && init?.method === 'POST')!
  expect(JSON.parse(String(post[1]?.body))).toEqual({ userId: 1 })
  expect(screen.queryByLabelText('Current family password')).toBeNull()
})

it('requires explicit management permission before preparing an unlinked account', async () => {
  const { fetchMock } = render({ user: { ...anna, telegram: null, rights: { ...anna.rights, manage: false } } })
  const next = await screen.findByRole('button', { name: 'Continue' })
  expect(next).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Confirm in Telegram' })).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: /Allow managing/ }))
  fireEvent.click(next)
  expect(await screen.findByRole('button', { name: 'Confirm in Telegram' })).toBeEnabled()
  expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/users/1' && init?.body === JSON.stringify({ rights: { manage: true } }))).toBe(true)
})

it('offers inline member creation for an empty family', async () => {
  render({ empty: true })
  expect(await screen.findByRole('textbox')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add member' })).toBeDisabled()
})

it('uses inline password confirmation and warns about relatives without access', async () => {
  const { fetchMock } = render({ proof: { member: 'Anna', manage: true } })
  const password = await screen.findByLabelText('Current family password')
  const submit = screen.getByRole('button', { name: 'Switch to Telegram sign-in' })
  expect(submit).toBeDisabled()
  expect(screen.getByText('Cannot sign in yet: Boris')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.change(password, { target: { value: 'family password' } })
  fireEvent.click(submit)
  await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/auth-settings/mode' && init?.body === JSON.stringify({ mode: 'telegram', current: 'family password' }))).toBe(true))
})

it.each([{ member: 'Boris', manage: true }, { member: 'Anna', manage: false }])('rejects a proof that does not authorize the selected manager: %j', async proof => {
  render({ proof })
  await screen.findByRole('heading', { name: 'Confirm your Telegram account' })
  expect(screen.queryByLabelText('Current family password')).toBeNull()
})

it('invalidates readiness when the server proof expires', async () => {
  const { expire } = render({ proof: { member: 'Anna', manage: true } })
  await screen.findByLabelText('Current family password')
  await expire()
  expect(await screen.findByRole('heading', { name: 'Confirm your Telegram account' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Current family password')).toBeNull()
})

it('keeps a wrong password inline', async () => {
  render({ proof: { member: 'Anna', manage: true }, wrongPassword: true })
  fireEvent.change(await screen.findByLabelText('Current family password'), { target: { value: 'wrong' } })
  fireEvent.click(screen.getByRole('button', { name: 'Switch to Telegram sign-in' }))
  expect(await screen.findByText('The current password is wrong')).toBeInTheDocument()
  expect(screen.getByLabelText('Current family password')).toHaveAttribute('aria-invalid', 'true')
})

it('enables a disabled sign-in preference before proving an unlinked account', async () => {
  const { fetchMock } = render({ user: { ...anna, telegram: null }, signIn: false })
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
  expect(await screen.findByRole('button', { name: 'Confirm in Telegram' })).toBeEnabled()
  expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/family-telegram/users/1' && init?.body === JSON.stringify({ signIn: true }))).toBe(true)
})
