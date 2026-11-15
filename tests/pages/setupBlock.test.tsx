import { fireEvent, screen } from '@testing-library/react'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { SetupBlock } from '../../src/pages/settings/SetupBlock'
import { stubApi } from '../helpers/http'
import { renderAdmin } from '../helpers/render'

describe('SetupBlock', () => {
  beforeEach(() => { stubApi(); window.history.replaceState(null, '', '/settings/backup') })
  afterEach(() => { resetAuth() })

  it('describes the wizard and opens /setup', () => {
    renderAdmin(<SetupBlock />)
    expect(screen.getByRole('heading', { name: 'Setup wizard' })).toBeInTheDocument()
    expect(screen.getByText(/Language, family members and currencies/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open wizard' }))
    expect(window.location.pathname).toBe('/setup')
  })

  it('shows nothing without the manage right: the Data page says once that it is view only', () => {
    setAuth({ mode: 'telegram', me: { name: 'Robin', rights: { edit: true, vote: true, manage: false } } })
    const { container } = renderAdmin(<SetupBlock />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names the edit right for a manager who cannot edit', () => {
    setAuth({ mode: 'password', authenticated: true, me: { name: 'Noa', rights: { edit: false, vote: true, manage: true } } })
    renderAdmin(<SetupBlock />)
    expect(screen.queryByRole('button', { name: 'Open wizard' })).toBeNull()
    expect(screen.getByRole('note')).toHaveTextContent('View only: editing is unavailable')
    expect(screen.getByRole('note')).not.toHaveTextContent('manage users and settings')
  })

  it('renders nothing in the demo', () => {
    setAuth({ mode: 'demo' })
    renderAdmin(<SetupBlock />)
    expect(screen.queryByRole('heading', { name: 'Setup wizard' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open wizard' })).toBeNull()
  })
})
