import { screen, waitFor } from '@testing-library/react'
import { resetAuth, setAuth } from '../../../src/lib/authState'
import { SetupPage } from '../../../src/pages/setup/SetupPage'
import { renderAdmin } from '../../helpers/render'
import { stubSetupApi } from '../../helpers/setup'

const signedIn = (rights: { edit: boolean; manage: boolean }) =>
  setAuth({ mode: 'password', authenticated: true, me: { name: 'Noa', rights: { ...rights, vote: true } } })

describe('SetupPage', () => {
  beforeEach(() => { stubSetupApi(); sessionStorage.clear(); window.history.replaceState(null, '', '/setup') })
  afterEach(() => { resetAuth(); sessionStorage.clear() })

  it('runs the wizard for a person who may run it', async () => {
    renderAdmin(<SetupPage />)
    expect(await screen.findByRole('heading', { level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('sends the demo to the dashboard without the wizard', async () => {
    setAuth({ mode: 'demo' })
    renderAdmin(<SetupPage />)
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
  })

  it('shows the manage note and no wizard to a person who only edits', () => {
    signedIn({ edit: true, manage: false })
    renderAdmin(<SetupPage />)
    expect(screen.getByRole('note')).toHaveTextContent('Only family members who manage users and settings can change this')
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    expect(screen.queryByText(/Step \d of/)).toBeNull()
  })

  it('shows the edit note and no wizard to a manager who cannot edit', () => {
    signedIn({ edit: false, manage: true })
    renderAdmin(<SetupPage />)
    expect(screen.getByRole('note')).toHaveTextContent('View only: editing is unavailable')
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
    expect(screen.queryByText(/Step \d of/)).toBeNull()
  })
})
