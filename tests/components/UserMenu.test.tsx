import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { UserMenu } from '../../src/components/layout/UserMenu'
import { ThemeProvider } from '../../src/lib/ThemeContext'
import { resetAuth, setAuth } from '../../src/lib/authState'
import { jsonResponse as json } from '../helpers/http'

beforeEach(() => {
  const data = new Map<string, string>() // the global localStorage of Node 25+ does not work in jsdom
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } })
})
afterEach(() => { resetAuth(); delete document.documentElement.dataset.theme })

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /, account menu$/ }))

describe('UserMenu', () => {
  it.each([['  Anna   Smith  ', 'AS'], ['Anna Jones', 'AJ'], ['Élodie', 'É'], ['𝔘ser Name', '𝔘N']])('identifies a named account %s with initials', (name, initials) => {
    setAuth({ mode: 'telegram', authenticated: true, me: { name, rights: { edit: true, vote: true, manage: true } } })
    const { container } = render(<UserMenu />)
    expect(container.querySelector('.user-menu__avatar')).toHaveTextContent(initials)
    expect(container.querySelector('.user-menu__avatar')).toHaveAttribute('aria-hidden', 'true')
  })

  it('uses a safe icon for empty names and closes without stealing outside focus', () => {
    setAuth({ mode: 'telegram', authenticated: true, me: { name: '   ', rights: { edit: true, vote: true, manage: true } } })
    const { container } = render(<><UserMenu /><button>Outside</button></>)
    expect(container.querySelector('.user-menu__avatar svg')).not.toBeNull()
    openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('button', { name: /, account menu$/ })).toHaveFocus()
    openMenu()
    const outside = screen.getByRole('button', { name: 'Outside' })
    outside.focus()
    fireEvent.mouseDown(outside)
    expect(outside).toHaveFocus()
    expect(screen.getByRole('button', { name: /, account menu$/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('has no account menu while unauthenticated', () => {
    setAuth({ mode: 'password', authenticated: false, me: null })
    const { container } = render(<UserMenu />)
    expect(container).toBeEmptyDOMElement()
  })
  it('lists what the person can and cannot do', () => {
    setAuth({ mode: 'telegram', authenticated: true, me: { name: 'Anna', rights: { edit: true, vote: true, manage: false } } })
    render(<UserMenu />)
    // the visible name is in the accessible name, first (label in name)
    expect(screen.getByRole('button', { name: 'Anna, account menu' })).toHaveTextContent('Anna')
    openMenu()
    expect(screen.getByText('You can: view, enter data, vote.')).toBeInTheDocument()
    expect(screen.getByText('You cannot: manage users and settings.')).toBeInTheDocument()
    expect(screen.queryByText('Full access')).toBeNull()
    expect(screen.getByText(/ask a family member who manages users/)).toBeInTheDocument()
  })

  it('shows no ask-a-manager hint and no cannot-line to a manager with every right', () => {
    setAuth({ mode: 'telegram', authenticated: true, me: { name: 'Boris', rights: { edit: true, vote: true, manage: true } } })
    render(<UserMenu />)
    openMenu()
    expect(screen.getByText('Full access')).toBeInTheDocument()
    expect(screen.queryByText(/You can/)).toBeNull()
    expect(screen.queryByText(/ask a family member/)).toBeNull()
  })

  it('password mode reads Family with all rights and Sign out', () => {
    setAuth({ mode: 'password', authenticated: true, me: null })
    const fetchMock = vi.fn(async () => json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    render(<UserMenu />)
    expect(screen.getByRole('button', { name: 'Family, account menu' })).toHaveTextContent('Family')
    openMenu()
    expect(screen.getByText('Full access')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }))
  })

  it('leaves the theme to the side menu', () => {
    setAuth({ mode: 'password', authenticated: true, me: null })
    render(<UserMenu />)
    openMenu()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('is absent in the demo: no person to show', () => {
    setAuth({ mode: 'demo', authenticated: true, me: null })
    const { container } = render(<ThemeProvider><UserMenu /></ThemeProvider>)
    expect(container).toBeEmptyDOMElement()
  })
})
