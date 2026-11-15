import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeChoice } from '../../src/components/layout/ThemeChoice'
import { ThemeToggle } from '../../src/components/layout/ThemeToggle'
import { ThemeProvider } from '../../src/lib/ThemeContext'
import { THEME_STORAGE_KEY } from '../../src/lib/themeState'

/** An in-memory localStorage (the global one of Node 25+ does not work in jsdom) and a device that prefers dark. */
function stubDevice(prefersDark: boolean) {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: prefersDark, addEventListener: () => {}, removeEventListener: () => {} })))
  return data
}

afterEach(() => { delete document.documentElement.dataset.theme })

describe('ThemeToggle', () => {
  it('from System on a dark device the first click stores light, the second dark', () => {
    const data = stubDevice(true)
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>)
    // the name is the theme the click gives
    fireEvent.click(screen.getByRole('button', { name: 'Light theme' }))
    expect(data.get(THEME_STORAGE_KEY)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: 'Dark theme' }))
    expect(data.get(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('from System on a light device goes to dark', () => {
    const data = stubDevice(false)
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Dark theme' }))
    expect(data.get(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('stays in step with the side menu\'s System / Light / Dark', () => {
    stubDevice(true)
    render(<ThemeProvider><ThemeToggle /><ThemeChoice /></ThemeProvider>)
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Light theme' }))
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(screen.getByRole('button', { name: 'Light theme' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'System' }))
    // back to System on a dark device: dark is on screen, the button offers light
    expect(screen.getByRole('button', { name: 'Light theme' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(screen.getByRole('button', { name: 'Dark theme' })).toBeInTheDocument()
  })
})
