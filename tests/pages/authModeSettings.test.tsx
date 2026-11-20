import { screen } from '@testing-library/react'
import type { AuthSettingsView, UsersView } from '../../src/domain/api'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { SignInSettings } from '../../src/pages/settings/SignInSettings'
import { authSettingsView } from '../helpers/authSettings'
import { jsonResponse, stubApi } from '../helpers/http'
import { renderAdmin } from '../helpers/render'

function render(mode: AuthSettingsView['mode'], locked = false) {
  const users: UsersView = { mode, bot: { configured: false, username: null, problem: null }, meId: null, users: [], provider: null }
  stubApi().answer({ 'GET /api/auth-settings': () => jsonResponse(authSettingsView({ mode, locked })) })
  return renderAdmin(<SignInSettings users={users} hideBot />)
}

beforeEach(() => setAuth({ mode: 'password', authenticated: true, me: { name: null, rights: { edit: true, vote: true, manage: true } } }))
afterEach(() => resetAuth())

it.each(['password', 'telegram'] as const)('offers the password, Telegram and the identity provider in %s mode', async mode => {
  render(mode)
  expect(await screen.findByRole('combobox', { name: 'Sign-in method' })).toBeEnabled()
  expect(screen.getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['password', 'telegram', 'oidc'])
  expect(screen.queryByRole('option', { name: 'No authentication' })).toBeNull()
})

it('shows env-only no authentication as frozen with an explanatory badge', async () => {
  render('none', true)
  const select = await screen.findByRole('combobox', { name: 'Sign-in method' })
  expect(select).toBeDisabled()
  expect(select).toHaveValue('none')
  expect(screen.getByRole('option', { name: 'No authentication' })).toBeInTheDocument()
  expect(screen.getByText('Changes only through .env')).toHaveClass('chip')
  expect(screen.queryByRole('dialog')).toBeNull()
})
