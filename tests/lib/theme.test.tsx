import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '../../src/lib/ThemeContext'
import { THEME_STORAGE_KEY, readStoredMode, useResolvedTheme, useThemeMode } from '../../src/lib/themeState'
import { stubStorage } from '../helpers/storage'

/** Replaces matchMedia; change() simulates a switch of the system theme. */
function stubMatchMedia(dark: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>()
  const mql = {
    matches: dark,
    addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.delete(l),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => mql))
  return {
    change(next: boolean) {
      mql.matches = next
      listeners.forEach(l => l({ matches: next }))
    },
  }
}

function Probe() {
  const { mode, setMode } = useThemeMode()
  return (
    <>
      <span data-testid="mode">{mode}</span>
      <span data-testid="resolved">{useResolvedTheme()}</span>
      <button onClick={() => setMode('light')}>light</button>
      <button onClick={() => setMode('system')}>system</button>
    </>
  )
}

beforeEach(() => {
  delete document.documentElement.dataset.theme
  document.documentElement.style.colorScheme = ''
})

describe('ThemeProvider', () => {
  it('follows the system scheme and its changes', () => {
    const media = stubMatchMedia(false)
    stubStorage('local')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByTestId('resolved')).toHaveTextContent('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    act(() => media.change(true))
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('restores a stored choice over the device scheme and marks <html>', () => {
    stubMatchMedia(false)
    stubStorage('local', { [THEME_STORAGE_KEY]: 'dark' })
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByTestId('mode')).toHaveTextContent('dark')
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('setMode switches the theme and remembers the choice; System forgets it', () => {
    stubMatchMedia(true)
    const data = stubStorage('local')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(data.get(THEME_STORAGE_KEY)).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: 'system' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(data.has(THEME_STORAGE_KEY)).toBe(false)
  })

  it('a chosen theme ignores device changes; System follows them again', () => {
    const media = stubMatchMedia(false)
    stubStorage('local', { [THEME_STORAGE_KEY]: 'light' })
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => media.change(true))
    expect(screen.getByTestId('resolved')).toHaveTextContent('light')
    fireEvent.click(screen.getByRole('button', { name: 'system' }))
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark')
  })

  it('ignores a garbage stored value and falls back to System with blocked storage', () => {
    stubMatchMedia(true)
    stubStorage('local', { [THEME_STORAGE_KEY]: 'blue' })
    expect(readStoredMode()).toBe('system')
    stubStorage('local', {}, { failReads: true, failWrites: true })
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByTestId('mode')).toHaveTextContent('system')
    fireEvent.click(screen.getByRole('button', { name: 'light' }))
    expect(screen.getByTestId('resolved')).toHaveTextContent('light')
  })

  it('works with Safari ≤ 13 media queries that only support addListener', () => {
    const listeners = new Set<(e: { matches: boolean }) => void>()
    const legacy = {
      matches: false,
      addListener: (l: (e: { matches: boolean }) => void) => listeners.add(l),
      removeListener: (l: (e: { matches: boolean }) => void) => listeners.delete(l),
    }
    vi.stubGlobal('matchMedia', vi.fn(() => legacy))
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => listeners.forEach(l => l({ matches: true })))
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark')
  })
})

describe('anti-flash script public/theme-init.js', () => {
  const html = readFileSync(join(__dirname, '../../index.html'), 'utf8')
  const script = readFileSync(join(__dirname, '../../public/theme-init.js'), 'utf8')
  const run = () => new Function(script)()

  it('is a blocking external script in <head>, and index.html has no inline script (CSP script-src self)', () => {
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).toMatch(/<script src="\/theme-init\.js"><\/script>/)
    expect(html).not.toMatch(/<script>/)
  })

  it('uses the same storage key as themeState', () => {
    expect(script).toContain(`'${THEME_STORAGE_KEY}'`)
  })

  it('applies a stored choice before React mounts, over the device scheme', () => {
    stubMatchMedia(true)
    stubStorage('local', { [THEME_STORAGE_KEY]: 'light' })
    run()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    stubMatchMedia(false)
    stubStorage('local', { [THEME_STORAGE_KEY]: 'dark' })
    run()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('follows the device with nothing stored, a garbage value or blocked storage', () => {
    stubMatchMedia(true)
    for (const storage of [{}, { [THEME_STORAGE_KEY]: 'blue' }] as Record<string, string>[]) {
      stubStorage('local', storage)
      run()
      expect(document.documentElement.dataset.theme).toBe('dark')
    }
    stubStorage('local', {}, { failReads: true })
    run()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('is light without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    run()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
