import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { AuthSettingsView, Rights, UsersView as UsersData } from '../../src/domain/api'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { SignInSettings } from '../../src/pages/settings/SignInSettings'
import { NotificationsPage } from '../../src/modules/reminders/NotificationsPage'
import { UsersView } from '../../src/pages/settings/UsersView'
import { fmtDayTime } from '../../src/lib/formatters'
import { authSettingsView, BOT_READY } from '../helpers/authSettings'
import { deferred, jsonResponse, sent, stubApi } from '../helpers/http'
import { renderAdmin, testClient } from '../helpers/render'
import { errorToasts, inlineAlerts } from '../helpers/toasts'

const MANAGER: Rights = { edit: true, vote: true, manage: true }
const VIEWER: Rights = { edit: true, vote: true, manage: false }

function view(over: Partial<UsersData> = {}): UsersData {
  return {
    mode: 'telegram', bot: { configured: true, username: 'family_bot', problem: null }, meId: 1,
    users: [
      { id: 1, member: 'Anna', telegram: '@anna', invitePending: false, rights: MANAGER, identity: false },
      { id: 2, member: 'Boris', telegram: null, invitePending: false, rights: VIEWER, identity: false },
    ],
    ...over,
  }
}

/** A telegram-mode family with its bot connected, unless `over` says otherwise */
const authView = (over: Partial<AuthSettingsView> = {}) => authSettingsView({ ...BOT_READY, mode: 'telegram', ...over })

/**
 * /api/users answers `data`; a write answers `write` (default: the same view). /api/auth-settings answers `auth`;
 * a write under it answers `authWrite` (default `{ ok: true }`).
 */
function stubUsers(data: UsersData, write?: Response, auth: AuthSettingsView | (() => AuthSettingsView) = authView({ mode: data.mode === 'password' ? 'password' : 'telegram' }), authWrite?: Response) {
  const usersWrite = () => write?.clone() ?? jsonResponse(data)
  const authSettingsWrite = () => authWrite?.clone() ?? jsonResponse({ ok: true })
  return stubApi({ members: [{ rowid: 1, name: 'Anna' }, { rowid: 2, name: 'Boris' }, { rowid: 3, name: 'Clara' }] }).answer({
    'GET /api/reminders': () => jsonResponse({ configured: true, linked: false, recipients: [], openMonths: [], next: null, settings: { enabled: false, startDay: 3, hour: 10, timezone: 'UTC', chatTitle: null, lastSentAt: null, lastError: null } }),
    'GET /api/users': () => jsonResponse(data),
    'GET /api/family-telegram': () => jsonResponse({ users: data.users.map(user => ({ userId: user.id, signIn: true, reminders: false, proposals: true, conversation: true })), groups: [] }),
    'POST /api/users': usersWrite,
    'PUT /api/users/1': usersWrite,
    'PUT /api/users/2': usersWrite,
    'DELETE /api/users/2': usersWrite,
    'POST /api/users/2/invite': () => jsonResponse({ link: 'https://t.me/family_bot?start=link_abc', expiresAt: '2026-10-29T12:00:00.000Z' }),
    'GET /api/auth-settings': () => jsonResponse(typeof auth === 'function' ? auth() : auth),
    'POST /api/auth-settings/password': authSettingsWrite,
    'POST /api/auth-settings/bot-token': authSettingsWrite,
    'DELETE /api/auth-settings/bot-token': authSettingsWrite,
    'POST /api/auth-settings/mode': authSettingsWrite,
  })
}

type FetchMock = ReturnType<typeof stubUsers>
const calls = (fetchMock: FetchMock, url: string, method = 'GET') =>
  fetchMock.mock.calls.filter(c => String(c[0]) === url && (c[1]?.method ?? 'GET') === method)
const bodyOf = (fetchMock: FetchMock, url: string, method = 'POST') => JSON.parse(String(calls(fetchMock, url, method)[0][1]!.body))

function signIn(rights: Rights, name: string | null = 'Anna') {
  setAuth({ mode: 'telegram', authenticated: true, me: { name, rights } })
}

async function expandMember(name: string) {
  const details = (await screen.findByText(name, { selector: '.family-name' })).closest('details')!
  if (!details.open) fireEvent.click(details.querySelector('summary')!)
  await waitFor(() => expect(details).toHaveAttribute('data-visited', 'true'))
  return within(details)
}

describe('users', () => {
  afterEach(() => { resetAuth(); window.history.replaceState(null, '', '/') })

  it('keeps each member in one expandable row before sign-in', async () => {
    signIn(MANAGER)
    stubUsers(view())
    renderAdmin(<UsersView />)
    const family = await screen.findByRole('region', { name: 'Members' })
    expect(within(family).getAllByText('Anna')).toHaveLength(1)
    expect(within(family).getByText('Anna').closest('summary')).not.toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(family.compareDocumentPosition(screen.getByRole('region', { name: 'Sign-in' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps personal settings collapsed and explains shared website access', async () => {
    signIn(MANAGER)
    stubUsers(view({ mode: 'password' }), undefined, authView({ mode: 'password' }))
    renderAdmin(<UsersView />)
    expect(await screen.findByText(/Everyone signs in with the family password/)).toBeInTheDocument()
    const anna = screen.getByText('Anna', { selector: '.family-name' }).closest('details')
    expect(anna).not.toHaveAttribute('open')
    expect(screen.queryByRole('switch', { name: /vote: Anna/ })).toBeNull()
    await expandMember('Anna')
    expect(screen.getByRole('switch', { name: /vote: Anna/ })).toBeInTheDocument()
  })
  it.each([
    ['telegram', /signs in with their own Telegram account/],
    ['password', /the switches below apply in the Telegram bot/],
  ] as const)('the %s mode line; nothing locked, so no .env note and no fallback chip', async (mode, line) => {
    signIn(MANAGER)
    stubUsers(view({ mode }), undefined, authView({ mode }))
    renderAdmin(<UsersView />)
    expect(await screen.findByText(line)).toBeInTheDocument()
    expect(screen.queryByText(/checkboxes/)).toBeNull()
    expect(screen.queryByText('AUTH_MODE')).toBeNull()
    expect(screen.queryByText(/switched off at start/)).toBeNull()
  })

  it('a locked mode explains that sign-in settings are read-only', async () => {
    signIn(MANAGER)
    stubUsers(view({ mode: 'password' }), undefined, authView({ mode: 'password', locked: true }))
    renderAdmin(<UsersView />)
    expect(await screen.findByText('Changes only through .env')).toBeInTheDocument()
    expect(screen.queryByText('AUTH_MODE')).toBeNull()
  })

  it('a Telegram sign-in switched off at start is a warning chip', async () => {
    signIn(MANAGER)
    stubUsers(view({ mode: 'password' }), undefined, authView({ mode: 'password', fallback: 'password' }))
    renderAdmin(<UsersView />)
    const chip = await screen.findByText(/Telegram sign-in was switched off at start/)
    expect(chip).toHaveClass('chip')
    expect(chip).toHaveAttribute('data-color', 'warning')
  })

  it('while Telegram fell back at start: "Stay on the family password" is offered and the bot cannot be disconnected', async () => {
    signIn(MANAGER)
    const fetchMock = stubUsers(view({ mode: 'password' }), undefined, authView({ mode: 'password', fallback: 'password' }))
    renderAdmin(<UsersView />)
    const keep = await screen.findByRole('button', { name: 'Stay on the family password' })
    fireEvent.click(keep)
    await waitFor(() => expect(sent(fetchMock, 'POST').filter(r => r.url === '/api/auth-settings/mode')).toEqual([{ method: 'POST', url: '/api/auth-settings/mode', body: { mode: 'password' } }]))
  })

  it.each([[null, true], ['password', false]] as const)('the bot card with fallback %s offers to disconnect the bot: %s', async (fallback, offered) => {
    signIn(MANAGER)
    stubUsers(view({ mode: 'password' }), undefined, authView({ mode: 'password', fallback }))
    renderAdmin(<SignInSettings users={view({ mode: 'password' })} />)
    await screen.findByRole('button', { name: 'Replace token…' })
    expect(!!screen.queryByRole('button', { name: 'Disconnect the bot' })).toBe(offered)
  })

  it('a person without manage sees the mode line, the bot name and the view-only note, and no auth-settings request', async () => {
    signIn(VIEWER, 'Boris')
    const fetchMock = stubUsers(view({ meId: 2 }))
    renderAdmin(<UsersView />)
    expect((await screen.findAllByText(/signs in with their own Telegram account/)).length).toBeGreaterThan(0)
    expect(screen.queryByText('Telegram bot: @family_bot')).not.toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Only family members who manage users and settings can change this')
    expect(screen.queryByRole('button', { name: /Disconnect|Replace|Change password/ })).toBeNull()
    expect(fetchMock.mock.calls.some(c => String(c[0]).startsWith('/api/auth-settings'))).toBe(false)
    expect(calls(fetchMock, '/api/family-telegram')).toHaveLength(0)
  })

  it('change password: current, new and repeat; too short and mismatch block the submit; success posts { current, password } and reloads auth', async () => {
    signIn(MANAGER, null)
    const fetchMock = stubUsers(view({ mode: 'password' }), undefined, authView({ mode: 'password' }))
    renderAdmin(<UsersView />)
    expect(await screen.findByText('Set')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change password…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Family password' })
    const current = within(dialog).getByLabelText('Current password')
    const next = within(dialog).getByLabelText('New password')
    const repeat = within(dialog).getByLabelText('Repeat the new password')
    expect(next).toHaveAttribute('autocomplete', 'new-password')
    expect(repeat).toHaveAttribute('autocomplete', 'new-password')
    expect(current).toHaveAttribute('autocomplete', 'current-password')
    expect(within(dialog).getByText(/At least 12 characters/)).toBeInTheDocument()
    fireEvent.change(current, { target: { value: 'old family password' } })
    fireEvent.change(next, { target: { value: 'short' } })
    fireEvent.change(repeat, { target: { value: 'short' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The password must be at least 12 characters')
    fireEvent.change(next, { target: { value: 'a new long family password' } })
    fireEvent.change(repeat, { target: { value: 'a new long family passwort' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('The two passwords do not match'))
    expect(calls(fetchMock, '/api/auth-settings/password', 'POST')).toHaveLength(0)
    fireEvent.change(repeat, { target: { value: 'a new long family password' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Password changed. Everyone signs in again with the new one.'))
    expect(bodyOf(fetchMock, '/api/auth-settings/password')).toEqual({ current: 'old family password', password: 'a new long family password' })
    await waitFor(() => expect(calls(fetchMock, '/api/auth')).not.toHaveLength(0))
    await waitFor(() => expect(calls(fetchMock, '/api/auth-settings').length).toBeGreaterThan(1))
  })

  it('a wrong current password is worded under its field; the dialog stays open and the page stays signed in', async () => {
    signIn(MANAGER, null)
    const fetchMock = stubUsers(view({ mode: 'password' }), undefined, authView({ mode: 'password' }), jsonResponse({ error: { code: 'wrong_current_password' } }, 401))
    renderAdmin(<UsersView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Change password…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Family password' })
    fireEvent.change(within(dialog).getByLabelText('Current password'), { target: { value: 'mistyped password' } })
    fireEvent.change(within(dialog).getByLabelText('New password'), { target: { value: 'a new long family password' } })
    fireEvent.change(within(dialog).getByLabelText('Repeat the new password'), { target: { value: 'a new long family password' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The current password is wrong')
    expect(within(dialog).getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true')
    expect(calls(fetchMock, '/api/auth-settings/password', 'POST')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Family password' })).toBeInTheDocument()
    expect(screen.queryByText(/Could not save/)).toBeNull()
    // still signed in: the section is drawn, not the sign-in screen
    expect(screen.getByRole('button', { name: 'Change password…' })).toBeInTheDocument()
  })

  it('in the demo the section says so and asks nothing of /api/auth-settings', async () => {
    signIn(MANAGER, null)
    const fetchMock = stubUsers(view({ mode: 'demo' }))
    renderAdmin(<UsersView />)
    expect(await screen.findByText('This is a demo: sign-in and rights are not used.')).toBeInTheDocument()
    expect(screen.queryByText(/Could not load/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Change password|Disconnect|Replace/ })).toBeNull()
    expect(fetchMock.mock.calls.some(c => String(c[0]).startsWith('/api/auth-settings'))).toBe(false)
    expect(calls(fetchMock, '/api/family-telegram')).toHaveLength(0)
  })

  it('a failed auth-settings load is told once and keeps the mode line', async () => {
    signIn(MANAGER, null)
    stubUsers(view({ mode: 'password' })).answer({ 'GET /api/auth-settings': () => jsonResponse({ error: { code: 'save_failed' } }, 500) })
    renderAdmin(<UsersView />)
    await waitFor(() => expect(errorToasts('Could not load data')).toHaveLength(1))
    // the notification, no alert line of the section's own
    expect(inlineAlerts('Could not load data')).toEqual([])
    expect(screen.getByText(/the switches below apply in the Telegram bot/)).toBeInTheDocument()
  })

  it('a failed re-read of the view is told by one notification, not one per block that reads it', async () => {
    signIn(MANAGER, null)
    const fetchMock = stubUsers(view({ mode: 'password' }), undefined, authView({ mode: 'password' }))
    const client = testClient()
    renderAdmin(<UsersView />, { client })
    fireEvent.change(await screen.findByRole('combobox', { name: 'Sign-in method' }), { target: { value: 'telegram' } })
    // The selected Telegram flow also reads the same view.
    expect(await screen.findByRole('heading', { name: 'Switch to Telegram sign-in' })).toBeInTheDocument()
    fetchMock.answer({ 'GET /api/auth-settings': () => jsonResponse({ error: { code: 'save_failed' } }, 500) })
    await act(async () => { await client.invalidateQueries({ queryKey: ['admin', 'auth-settings'] }) })
    await waitFor(() => expect(errorToasts('Could not load data')).not.toEqual([]))
    // nothing left to read: a second block's notification would be on the screen by now
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(errorToasts('Could not load data')).toHaveLength(1)
  })

  it('the app password can be changed in settings', async () => {
    signIn(MANAGER, null)
    stubUsers(view({ mode: 'password' }), undefined, authView({ mode: 'password', password: { set: true, source: 'app' } }))
    renderAdmin(<UsersView />)
    expect(await screen.findByRole('button', { name: 'Change password…' })).toBeInTheDocument()
    expect(screen.queryByText('APP_PASSWORD')).toBeNull()
  })

  it('bot token: check and save posts the token; a telegram.bad_token answer is worded; the field is never prefilled', async () => {
    signIn(MANAGER, null)
    const fetchMock = stubUsers(view({ mode: 'password', bot: { configured: false, username: null, problem: null } }), undefined,
      authView({ mode: 'password', bot: { source: null, username: null, problem: null } }),
      jsonResponse({ error: { code: 'telegram.bad_token' } }, 409))
    renderAdmin(<SignInSettings users={view()} />)
    expect(await screen.findByText(/Not connected\. The bot sends reminders/)).toBeInTheDocument()
    const field = screen.getByLabelText('Bot token')
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(screen.getByText(/@BotFather/)).toBeInTheDocument()
    fireEvent.change(field, { target: { value: '123456:secret-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check and save' }))
    expect(await screen.findByText(/Telegram does not accept the bot token/)).toBeInTheDocument()
    expect(bodyOf(fetchMock, '/api/auth-settings/bot-token')).toEqual({ token: '123456:secret-token' })
  })

  it('bot token: a second click while the check is out sends nothing', async () => {
    signIn(MANAGER, null)
    const gate = deferred<Response>()
    const fetchMock = stubUsers(view({ mode: 'password', bot: { configured: false, username: null, problem: null } }), undefined,
      authView({ mode: 'password', bot: { source: null, username: null, problem: null } }))
    fetchMock.answer({ 'POST /api/auth-settings/bot-token': () => gate.promise })
    renderAdmin(<SignInSettings users={view()} />)
    fireEvent.change(await screen.findByLabelText('Bot token'), { target: { value: '123456:secret-token' } })
    const check = screen.getByRole('button', { name: 'Check and save' })
    fireEvent.click(check)
    fireEvent.click(check)
    await waitFor(() => expect(check).toBeDisabled())
    expect(sent(fetchMock, 'POST').filter(r => r.url === '/api/auth-settings/bot-token')).toHaveLength(1)
    gate.resolve(jsonResponse({ username: 'new_bot' }))
  })

  it('a saved bot token is announced by its name; replace opens a dialog with the note', async () => {
    signIn(MANAGER, null)
    const fetchMock = stubUsers(view({ mode: 'password' }), undefined, authView({ mode: 'password' }), jsonResponse({ username: 'new_bot' }))
    renderAdmin(<SignInSettings users={view()} />)
    expect(await screen.findByText('Telegram bot: @family_bot')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Replace token…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Telegram bot' })
    expect(dialog).toHaveTextContent(/each member opens the new bot in Telegram and presses Start/)
    const field = within(dialog).getByLabelText('Bot token')
    expect(field).toHaveValue('')
    fireEvent.change(field, { target: { value: '654321:other' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check and save' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Bot connected: @new_bot'))
    expect(bodyOf(fetchMock, '/api/auth-settings/bot-token')).toEqual({ token: '654321:other' })
  })

  it('a token whose bot has no name yet (just saved): the view is read again until it has one; the card names it and the flow advances to the profile', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      signIn(MANAGER, null)
      // the reader's own getMe runs after the save: the first reads answer a token without a name
      let reads = 0
      const waiting = authView({ mode: 'password', bot: { source: 'app', username: null, problem: null }, switchToTelegram: { bot: false, linkedManager: true, proof: null } })
      const named = authView({ mode: 'password', bot: { source: 'app', username: 'new_bot', problem: null } })
      const fetchMock = stubUsers(view({ mode: 'password' }), undefined, () => (++reads <= 2 ? waiting : named))
      renderAdmin(<SignInSettings users={view()} />)
      expect(await screen.findByText('Telegram bot: connected')).toBeInTheDocument()
      fireEvent.change(await screen.findByRole('combobox', { name: 'Sign-in method' }), { target: { value: 'telegram' } })
      expect(await screen.findByRole('heading', { name: 'Connect the bot' })).toBeInTheDocument()
      for (let i = 0; i < 3 && reads < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(await screen.findByText('Telegram bot: @new_bot')).toBeInTheDocument()
      expect(await screen.findByRole('heading', { name: 'Confirm your Telegram account' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Connect the bot' })).toBeNull()
      // The active switch continues checking that bot/account readiness has not changed.
      const settled = calls(fetchMock, '/api/auth-settings').length
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
      expect(calls(fetchMock, '/api/auth-settings').length).toBeGreaterThan(settled)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a bot problem is worded with the error assessment; an env token shows the note', async () => {
    signIn(MANAGER, null)
    stubUsers(view({ mode: 'password' }), undefined, authView({ mode: 'password', bot: { source: 'env', username: null, problem: 'telegram.bad_token' } }))
    renderAdmin(<SignInSettings users={view()} />)
    const problem = await screen.findByText(/Telegram does not accept the bot token/)
    expect(problem).toHaveClass('note--error')
    expect(screen.getByText('TELEGRAM_BOT_TOKEN')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Replace token|Disconnect the bot/ })).toBeNull()
  })

  it('disconnecting the bot asks first', async () => {
    signIn(MANAGER, null)
    const fetchMock = stubUsers(view({ mode: 'password' }), undefined, authView({ mode: 'password' }))
    renderAdmin(<SignInSettings users={view()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect the bot' }))
    const ask = await screen.findByRole('dialog', { name: 'Disconnect the Telegram bot?' })
    expect(ask).toHaveTextContent(/Reminders stop/)
    expect(calls(fetchMock, '/api/auth-settings/bot-token', 'DELETE')).toHaveLength(0)
    fireEvent.click(within(ask).getByRole('button', { name: 'Disconnect the bot' }))
    await waitFor(() => expect(calls(fetchMock, '/api/auth-settings/bot-token', 'DELETE')).toHaveLength(1))
  })

  it('no disconnecting the bot in telegram mode', async () => {
    signIn(MANAGER)
    stubUsers(view(), undefined, authView())
    renderAdmin(<SignInSettings users={view()} />)
    expect(await screen.findByText('Telegram bot: @family_bot')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disconnect the bot' })).toBeNull()
  })

  describe('back to the password', () => {
    /** Telegram mode, a manager signed in; `password` is the stored one's state. Opens the dialog. */
    async function openSwitchBack(password: AuthSettingsView['password'] = { set: true, source: 'app' }) {
      signIn(MANAGER)
      const fetchMock = stubUsers(view(), undefined, authView({ password }))
      renderAdmin(<UsersView />)
      fireEvent.change(await screen.findByRole('combobox', { name: 'Sign-in method' }), { target: { value: 'password' } })
      return { fetchMock, dialog: await screen.findByRole('dialog', { name: 'Switch to the family password' }) }
    }

    it('keeping the saved password posts { mode: password } and reads /api/auth again', async () => {
      const { fetchMock, dialog } = await openSwitchBack()
      expect(dialog).toHaveTextContent(/Everyone else is signed out and signs in with the password from now on/)
      expect(within(dialog).getByRole('radio', { name: 'Keep the saved password' })).toBeChecked()
      expect(within(dialog).queryByLabelText('New password')).toBeNull()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Switch to the family password' }))
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Everyone signs in with the family password now'))
      expect(bodyOf(fetchMock, '/api/auth-settings/mode')).toEqual({ mode: 'password' })
      await waitFor(() => expect(calls(fetchMock, '/api/auth')).not.toHaveLength(0))
    })

    it('setting a new password posts it with the mode', async () => {
      const { fetchMock, dialog } = await openSwitchBack()
      fireEvent.click(within(dialog).getByRole('radio', { name: 'Set a new password' }))
      fireEvent.change(within(dialog).getByLabelText('New password'), { target: { value: 'a new long family password' } })
      fireEvent.change(within(dialog).getByLabelText('Repeat the new password'), { target: { value: 'a new long family password' } })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Switch to the family password' }))
      await waitFor(() => expect(calls(fetchMock, '/api/auth-settings/mode', 'POST')).toHaveLength(1))
      expect(bodyOf(fetchMock, '/api/auth-settings/mode')).toEqual({ mode: 'password', password: 'a new long family password' })
    })

    it('without a stored password the new one is required: no choice, an empty submit is refused', async () => {
      const { fetchMock, dialog } = await openSwitchBack({ set: false, source: null })
      expect(within(dialog).queryByRole('radio')).toBeNull()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Switch to the family password' }))
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('The password must be at least 12 characters')
      expect(calls(fetchMock, '/api/auth-settings/mode', 'POST')).toHaveLength(0)
    })
  })

  it.each([
    // [case, mode, locked, a text that shows the view has loaded, the switch offered]
    ['password mode (offered)', 'password', false, /the switches below apply in the Telegram bot/, true],
    ['a locked password mode (not offered)', 'password', true, 'Changes only through .env', false],
    ['telegram mode (not offered)', 'telegram', false, /signs in with their own Telegram account/, false],
  ] as const)('the switch to Telegram sign-in in %s', async (_, mode, locked, loaded, offered) => {
    signIn(MANAGER, null)
    stubUsers(view({ mode }), undefined, authView({ mode, locked }))
    renderAdmin(<UsersView />)
    expect(await screen.findByText(loaded)).toBeInTheDocument()
    const select = await screen.findByRole('combobox', { name: 'Sign-in method' })
    expect(select).toHaveProperty('disabled', locked)
    if (offered) fireEvent.change(select, { target: { value: 'telegram' } })
    if (offered) expect(await screen.findByRole('button', { name: 'Confirm in Telegram' })).toBeInTheDocument()
    else expect(screen.queryByRole('button', { name: 'Confirm in Telegram' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Switch to Telegram sign-in' }) !== null).toBe(offered)
  })

  it('no way back to the password while the mode is locked', async () => {
    signIn(MANAGER)
    stubUsers(view(), undefined, authView({ locked: true }))
    renderAdmin(<UsersView />)
    expect(await screen.findByText('Changes only through .env')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Switch to the family password…' })).toBeNull()
  })

  it('a Users write refreshes the auth-settings view', async () => {
    signIn(MANAGER)
    const fetchMock = stubUsers(view(), undefined, authView())
    renderAdmin(<UsersView />)
    await expandMember('Boris')
    fireEvent.click(await screen.findByRole('switch', { name: /vote: Boris/ }))
    await waitFor(() => expect(calls(fetchMock, '/api/users/2', 'PUT')).toHaveLength(1))
    await waitFor(() => expect(calls(fetchMock, '/api/auth-settings').length).toBeGreaterThan(1))
  })

  it('keeps member creation here when every existing member has access', async () => {
    signIn(MANAGER)
    stubUsers(view({ users: [
      { id: 1, member: 'Anna', telegram: '@anna', invitePending: false, rights: MANAGER, identity: false },
      { id: 2, member: 'Boris', telegram: null, invitePending: false, rights: VIEWER, identity: false },
      { id: 3, member: 'Clara', telegram: null, invitePending: false, rights: VIEWER, identity: false },
    ] }))
    renderAdmin(<UsersView />)
    expect(await screen.findByRole('button', { name: 'Add member' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Set up access' })).toBeNull()
  })

  it('enables access on the existing member row without creating another member', async () => {
    signIn(MANAGER)
    const connected = view({ users: [...view().users, { id: 3, member: 'Clara', telegram: null, invitePending: true, rights: VIEWER, identity: false }] })
    const fetchMock = stubUsers(view(), jsonResponse(connected)).answer({
      'POST /api/users/3/invite': () => jsonResponse({ link: 'https://t.me/family_bot?start=link_clara', expiresAt: '2026-10-29T12:00:00.000Z' }),
    })
    renderAdmin(<UsersView />)
    const clara = await expandMember('Clara')
    const enable = clara.getByRole('button', { name: 'Connect' })
    fireEvent.click(enable)
    await waitFor(() => expect(calls(fetchMock, '/api/users', 'POST')).toHaveLength(1))
    expect(bodyOf(fetchMock, '/api/users')).toEqual({ member: 'Clara', rights: { edit: true, vote: true, manage: false } })
    expect(calls(fetchMock, '/api/admin/members', 'POST')).toHaveLength(0)
    expect(await screen.findByText('https://t.me/family_bot?start=link_clara')).toBeInTheDocument()
  })

  it('keeps member editing separate from access management', async () => {
    signIn({ edit: true, vote: false, manage: false })
    stubUsers(view())
    renderAdmin(<UsersView />)
    expect(await screen.findByRole('button', { name: 'Add member' })).toBeInTheDocument()
    const clara = await expandMember('Clara')
    expect(clara.getByRole('button', { name: 'Delete member' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enable access' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Set up access' })).toBeNull()
  })

  it('its blocks are settings rows', async () => {
    signIn(MANAGER)
    stubUsers(view())
    renderAdmin(<UsersView />)
    await screen.findByText(/signs in with their own Telegram account/)
    for (const name of ['Members', 'Sign-in']) expect(screen.getByRole('region', { name })).toHaveClass('settings-section')
  })

  it('a viewer sees everyone\'s rights read-only', async () => {
    signIn(VIEWER, 'Boris')
    stubUsers(view({ meId: 2 }))
    renderAdmin(<UsersView />)
    await expandMember('Anna')
    const anna = await screen.findByRole('switch', { name: /manage users and settings: Anna/ })
    expect(anna).toHaveAttribute('aria-checked', 'true')
    for (const sw of screen.getAllByRole('switch')) expect(sw).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(/You/, { selector: '.family-you' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Invite to Telegram' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull()
  })

  // Boris has { edit: true, vote: true, manage: false }: each switch sends only its own right, flipped
  it.each([
    ['enter data', { edit: false }],
    ['vote', { vote: false }],
    ['manage users and settings', { manage: true }],
  ] as const)('a manager toggles another person\'s right "%s": PUT sends only that right', async (right, rights) => {
    signIn(MANAGER)
    const fetchMock = stubUsers(view())
    renderAdmin(<UsersView />)
    await expandMember('Boris')
    fireEvent.click(await screen.findByRole('switch', { name: `${right}: Boris` }))
    await waitFor(() => expect(calls(fetchMock, '/api/users/2', 'PUT')).toHaveLength(1))
    expect(bodyOf(fetchMock, '/api/users/2', 'PUT')).toEqual({ rights })
  })

  it('a viewer\'s click on a right switch sends nothing', async () => {
    signIn(VIEWER, 'Boris')
    const fetchMock = stubUsers(view({ meId: 2 }))
    renderAdmin(<UsersView />)
    await expandMember('Anna')
    await expandMember('Boris')
    for (const name of ['vote: Anna', 'manage users and settings: Boris']) fireEvent.click(await screen.findByRole('switch', { name }))
    // a write starts in the click's own task: let its promise chain run before looking
    await act(async () => { await Promise.resolve() })
    expect(fetchMock.mock.calls.filter(c => c[1]?.method && c[1].method !== 'GET')).toEqual([])
    expect(screen.getByRole('switch', { name: 'vote: Anna' })).toHaveAttribute('aria-checked', 'true')
  })

  it('deleting an account asks first; Cancel sends nothing, the confirmation sends DELETE and says so', async () => {
    signIn(MANAGER)
    const fetchMock = stubUsers(view())
    renderAdmin(<UsersView />)
    await expandMember('Boris')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete the account of Boris?' }))
    let ask = await screen.findByRole('dialog', { name: 'Delete the account of Boris?' })
    expect(ask).toHaveTextContent('The member stays in the family; only the sign-in and the rights are removed.')
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls(fetchMock, '/api/users/2', 'DELETE')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Delete the account of Boris?' }))
    ask = await screen.findByRole('dialog', { name: 'Delete the account of Boris?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Disable personal access' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Account deleted'))
    expect(calls(fetchMock, '/api/users/2', 'DELETE')).toHaveLength(1)
  })

  it('adding a member uses the member dialog and creates no access account', async () => {
    signIn(MANAGER)
    const fetchMock = stubUsers(view())
    renderAdmin(<UsersView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add member' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add member' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Dora' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add member' }))
    await waitFor(() => expect(calls(fetchMock, '/api/admin/members', 'POST')).toHaveLength(1))
    expect(bodyOf(fetchMock, '/api/admin/members')).toEqual({ name: 'Dora' })
    expect(calls(fetchMock, '/api/users', 'POST')).toHaveLength(0)
  })
  it('after a write the signed-in person\'s own rights are read again', async () => {
    signIn(MANAGER)
    const fetchMock = stubUsers(view()).answer({
      'GET /api/auth': () => jsonResponse({ mode: 'telegram', authenticated: true, me: { name: 'Anna', rights: VIEWER } }),
    })
    renderAdmin(<UsersView />)
    await expandMember('Anna')
    expect(await screen.findAllByRole('button', { name: /^Delete/ })).not.toHaveLength(0)
    fireEvent.click(await screen.findByRole('switch', { name: /manage users and settings: Anna/ }))
    // Anna took manage from herself: the page turns read-only without a reload
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull())
    expect(fetchMock.mock.calls.some(c => String(c[0]) === '/api/auth')).toBe(true)
  })

  it('a failed write is worded (last_manager) and reads nothing again', async () => {
    signIn(MANAGER)
    const fetchMock = stubUsers(view(), jsonResponse({ error: { code: 'last_manager' } }, 409))
    renderAdmin(<UsersView />)
    await expandMember('Boris')
    fireEvent.click(await screen.findByRole('switch', { name: /vote: Boris/ }))
    expect(await screen.findByText(/At least one account that can sign in must keep the right to manage/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(c => String(c[0]) === '/api/auth')).toBe(false)
  })

  it('invite shows the link with copy', async () => {
    signIn(MANAGER)
    stubUsers(view())
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderAdmin(<UsersView />)
    const boris = await expandMember('Boris')
    fireEvent.click(boris.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('https://t.me/family_bot?start=link_abc')).toBeInTheDocument()
    expect(screen.getByText(/works once and expires on/)).toHaveTextContent(`expires on ${fmtDayTime('2026-10-29T12:00:00.000Z')}.`)
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://t.me/family_bot?start=link_abc'))
  })

  it('a double Enter in the add member dialog creates one member', async () => {
    signIn(MANAGER)
    const gate = deferred<Response>()
    const fetchMock = stubUsers(view()).answer({ 'POST /api/admin/members': () => gate.promise })
    renderAdmin(<UsersView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add member' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add member' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Dora' } })
    const submit = within(dialog).getByRole('button', { name: 'Add member' })
    fireEvent.submit(submit.closest('form')!)
    fireEvent.submit(submit.closest('form')!)
    await waitFor(() => expect(submit).toBeDisabled())
    expect(calls(fetchMock, '/api/admin/members', 'POST')).toHaveLength(1)
    await act(async () => { gate.resolve(jsonResponse({ ok: true })) })
  })
  it('a double click on “Invite” makes one link; the buttons are off meanwhile', async () => {
    signIn(MANAGER)
    const fetchMock = stubUsers(view())
    renderAdmin(<UsersView />)
    const boris = await expandMember('Boris')
    const invite = boris.getByRole('button', { name: 'Connect' })
    fireEvent.click(invite)
    fireEvent.click(invite)
    await waitFor(() => expect(invite).toBeDisabled())
    expect(await screen.findByText('https://t.me/family_bot?start=link_abc')).toBeInTheDocument()
    expect(calls(fetchMock, '/api/users/2/invite', 'POST')).toHaveLength(1)
  })

  it('updates one personal Telegram preference without changing rights', async () => {
    signIn(MANAGER)
    const fetchMock = stubUsers(view()).answer({
      'PUT /api/family-telegram/users/1': () => jsonResponse({ ok: true }),
    })
    renderAdmin(<NotificationsPage />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Reminders: Anna' }))
    await waitFor(() => expect(calls(fetchMock, '/api/family-telegram/users/1', 'PUT')).toHaveLength(1))
    expect(bodyOf(fetchMock, '/api/family-telegram/users/1', 'PUT')).toEqual({ reminders: true })
    expect(calls(fetchMock, '/api/users/1', 'PUT')).toHaveLength(0)
  })

  it('changes a shared chat preference and displays the pairing command', async () => {
    signIn(MANAGER)
    const fetchMock = stubUsers(view()).answer({
      'GET /api/family-telegram': () => jsonResponse({ users: [], groups: [{ chatId: '-100', title: 'Family room', reminders: false, proposals: true, conversation: true }] }),
      'PUT /api/family-telegram/groups/-100': () => jsonResponse({ ok: true }),
      'POST /api/family-telegram/pairing': () => jsonResponse({ command: '/pair@family_bot abc', expiresAt: '2030-01-01T12:00:00Z' }),
    })
    renderAdmin(<NotificationsPage />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Reminders: Family room' }))
    await waitFor(() => expect(calls(fetchMock, '/api/family-telegram/groups/-100', 'PUT')).toHaveLength(1))
    expect(bodyOf(fetchMock, '/api/family-telegram/groups/-100', 'PUT')).toEqual({ reminders: true })
    fireEvent.click(screen.getByRole('button', { name: 'Connect chat' }))
    expect(await screen.findByText('/pair@family_bot abc')).toBeInTheDocument()
    expect(calls(fetchMock, '/api/family-telegram/pairing', 'POST')).toHaveLength(1)
  })

  it('shows a bot problem in words', async () => {
    signIn(VIEWER)
    stubUsers(view({ bot: { configured: true, username: null, problem: 'telegram.bad_token' } }))
    renderAdmin(<SignInSettings users={view({ bot: { configured: true, username: null, problem: 'telegram.bad_token' } })} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/token/i)
  })
})

it('failed members read offers recovery instead of an empty member editor', async () => {
  let fail = true
  stubUsers(view()).answer({ 'GET /api/admin/members': (_init, next) => fail ? jsonResponse({}, 503) : next() })
  renderAdmin(<UsersView />)
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument())
})
