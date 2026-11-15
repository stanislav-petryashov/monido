import type { ReactElement } from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { Sidebar } from '../../src/components/layout/Sidebar'
import { t } from '../../src/i18n/client'
import { routesFor } from '../../src/routes'
import type { FinanceSnapshot } from '../../src/domain/types'
import { makeSnapshot } from '../helpers/snapshot'
import { renderWithClient, renderWithSnapshot } from '../helpers/render'
import { ru, withLanguage } from '../helpers/i18n'
import { stubStorage } from '../helpers/storage'
import { SIDEBAR_STORAGE_KEY } from '../../src/lib/sidebarState'
import { ThemeProvider } from '../../src/lib/ThemeContext'
import { THEME_STORAGE_KEY } from '../../src/lib/themeState'
import { resetAuth, setAuth } from '../../src/lib/authState'

const routes = routesFor({ demo: false })
// route titles belong to the route table, not to this component
const title = (path: string) => t(routes.find(r => r.path === path)!.title)
/** The menu reads the open months from the cached snapshot */
const render = (ui: ReactElement, snapshot: FinanceSnapshot = makeSnapshot()) => renderWithSnapshot(ui, snapshot)
const withOpen = (openMonths: string[]) => {
  const base = makeSnapshot()
  return makeSnapshot({ asOf: { ...base.asOf, openMonths } })
}
const closeLink = () => screen.getByRole('link', { name: new RegExp(`^${title('/close')}`) })

beforeEach(() => window.history.replaceState(null, '', '/'))
afterEach(() => vi.unstubAllGlobals())

describe('Sidebar', () => {
  it('switches the theme from its footer and can return to the device theme', () => {
    const store = stubStorage('local')
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })))
    render(<ThemeProvider><Sidebar routes={routes} path="/" open={false} onClose={() => {}} /></ThemeProvider>)
    const group = screen.getByRole('radiogroup', { name: 'Theme' })
    expect(group.closest('.sidebar__foot')).not.toBeNull()
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked()
    expect(store.get(THEME_STORAGE_KEY)).toBe('light')
    fireEvent.click(screen.getByRole('radio', { name: 'System' }))
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
    expect(store.has(THEME_STORAGE_KEY)).toBe(false)
  })

  it('keeps settings in the footer and collapse beside the product name', () => {
    render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />)
    expect(screen.getByRole('navigation', { name: 'Settings' }).closest('.sidebar__foot')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Compact menu' }).closest('.sidebar__logo')).not.toBeNull()
  })
  it.each([['0.10.0', 'v0.10.0'], ['0.10.0-3-gabc1234', 'v0.10.0'], ['dev', 'dev'], ['1a2b3c4', '1a2b3c4']])('shows version %s at the bottom, shortened to %s, with the full label as its title', async (version, shown) => {
    // only the version answers; the snapshot and the advisor's proposals stay pending
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => (String(input) === '/api/version'
      ? Promise.resolve(new Response(JSON.stringify({ version, latest: null, behind: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      : new Promise<Response>(() => {}))))
    render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />)
    const label = await screen.findByText(shown)
    expect(label).toHaveClass('sidebar__version')
    expect(label).toHaveAttribute('title', `Version ${version}`)
  })

  it('draws every menu route as a tile, in one grid, in the group-then-order sequence', () => {
    render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />)
    const tiles = screen.getAllByRole('link', { name: /./ }).filter(a => a.classList.contains('tile'))
    expect(tiles.map(a => a.getAttribute('href'))).toEqual(['/', '/close', '/assets', '/loans', '/cashflow', '/goals', '/health', '/advisor'])
    expect(screen.queryByRole('navigation', { name: 'Money' })).toBeNull()
  })
  it('on a phone the sheet adds Settings as a tile', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(max-width: 640px)', addEventListener() {}, removeEventListener() {} })))
    render(<Sidebar routes={routes} path="/settings/data" open onClose={() => {}} />)
    const tiles = screen.getAllByRole('link', { name: /./ }).filter(a => a.classList.contains('tile'))
    expect(tiles.map(a => a.getAttribute('href'))).toEqual(['/', '/close', '/assets', '/loans', '/cashflow', '/goals', '/health', '/advisor', '/settings/general'])
    // the ninth tile is the Settings row's place: no row at the foot, and the tile is current on every settings page
    expect(screen.getByRole('navigation', { name: 'Settings' }).closest('.sidebar__foot')).toBeNull()
    expect(tiles[8]).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('radiogroup', { name: 'Theme' }).closest('.sidebar__foot')).not.toBeNull()
  })
  it('names the open month under Close month', () => {
    render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />, withOpen(['2031-07']))
    expect(closeLink()).toHaveTextContent(/July 2031/)
  })
  it('has the account button in the footer above Settings in password mode', () => {
    setAuth({ mode: 'password', authenticated: true, me: null })
    try {
      render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />)
      const account = screen.getByRole('button', { name: 'Family, account menu' })
      expect(account.closest('.sidebar__account')).not.toBeNull()
      expect(account.closest('.sidebar__foot')).not.toBeNull()
      expect(account.compareDocumentPosition(screen.getByRole('link', { name: 'Settings' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    } finally {
      resetAuth()
    }
  })

  it('keeps Settings as a row in the footer, not a tile', () => {
    render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />)
    const settings = screen.getByRole('link', { name: 'Settings' })
    expect(settings.classList.contains('tile')).toBe(false)
    expect(settings.closest('.sidebar__foot')).not.toBeNull()
  })

  it('counts the open months beside Close month', () => {
    render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />, withOpen(['2031-07', '2031-08']))
    const badge = closeLink().querySelector('.tile__count')
    expect(badge).toHaveTextContent('2')
    expect(closeLink()).toHaveAccessibleName('Close month 2 months not closed')
    // the other items have no badge
    expect(document.querySelectorAll('.tile__count')).toHaveLength(1)
  })

  it('hides the badge when every month is closed or the snapshot is not there yet', () => {
    const { unmount } = render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />, withOpen([]))
    expect(closeLink()).toHaveAccessibleName(title('/close'))
    expect(document.querySelector('.tile__count')).toBeNull()
    unmount()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderWithClient(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />)
    expect(document.querySelector('.tile__count')).toBeNull()
  })

  it('names the badge in Russian', async () => {
    await withLanguage('ru-RU', () => {
      render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />, withOpen(['2031-07', '2031-08', '2031-09', '2031-10', '2031-11']))
      const link = screen.getByRole('link', { name: new RegExp(`^${ru('routes.close')}`) })
      expect(link).toHaveAccessibleName(`${ru('routes.close')} ${ru('nav.badge.openMonths', { count: 5 })}`)
      // the Russian plural for five, not the English fallback
      expect(ru('nav.badge.openMonths', { count: 5 })).not.toBe(ru('nav.badge.openMonths', { count: 2 }).replace('2', '5'))
    })
  })

  it('draws the Monido mark in the logo, not an icon', () => {
    const { container } = render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />)
    const mark = container.querySelector('.sidebar__logo svg')!
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark).toHaveAttribute('viewBox', '0 0 48 48')
    expect(mark).toHaveAttribute('width', '30')
    // The tile and the stroked M-nest, nothing else.
    const paths = mark.querySelectorAll('path')
    expect(paths).toHaveLength(2)
    expect(paths[1]).toHaveAttribute('fill', 'none')
    expect(mark.querySelectorAll('rect, circle')).toHaveLength(0)
  })

  it('is labelled as the menu', () => {
    render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />)
    expect(screen.getByRole('complementary', { name: 'Menu' })).toBeInTheDocument()
  })

  it.each(['/settings/data', '/settings/family'])('keeps Settings current at %s', path => {
    render(<Sidebar routes={routes} path={path} open={false} onClose={() => {}} />)
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    // the second floor marks the settings page itself; no tile is current
    expect(screen.getAllByRole('link').filter(link => link.hasAttribute('aria-current') && link.classList.contains('tile'))).toHaveLength(0)
  })

  it('has the second floor under the tiles: the area pages, or what needs doing on Overview', () => {
    const { unmount } = render(<Sidebar routes={routes} path="/accounts" open={false} onClose={() => {}} />)
    const section = screen.getByRole('navigation', { name: 'Assets' })
    expect(section.closest('.sidebar__scroll')).not.toBeNull()
    expect(section.compareDocumentPosition(screen.getByRole('navigation', { name: 'Places' })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(section.compareDocumentPosition(screen.getByRole('navigation', { name: 'Settings' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    unmount()
    render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />, withOpen(['2031-07']))
    expect(screen.getByRole('navigation', { name: 'To do' }).closest('.sidebar__scroll')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Close July 2031' })).toHaveClass('sidebar__row')
  })

  it('marks only the current page', () => {
    render(<Sidebar routes={routes} path="/accounts" open={false} onClose={() => {}} />)
    expect(screen.getByRole('link', { name: title('/assets') })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: title('/') })).not.toHaveAttribute('aria-current')
  })

  it('open drawer takes focus; Escape and the backdrop close it', () => {
    const onClose = vi.fn()
    render(<Sidebar routes={routes} path="/" open onClose={onClose} />)
    expect(document.activeElement).toBe(screen.getByRole('link', { name: title('/') }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('sidebar-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('on a phone the full-width sheet has a close button; at desktop width it has none', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(max-width: 640px)', addEventListener() {}, removeEventListener() {} })))
    const onClose = vi.fn()
    const { unmount } = render(<Sidebar routes={routes} path="/" open onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
    render(<Sidebar routes={routes} path="/" open onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Close menu' })).toBeNull()
  })

  it('choosing a second-floor row closes the drawer, like a tile', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(max-width: 1199px)', addEventListener() {}, removeEventListener() {} })))
    const onClose = vi.fn()
    render(<Sidebar routes={routes} path="/accounts" open onClose={onClose} />)
    const section = screen.getByRole('navigation', { name: 'Assets' })
    fireEvent.click(within(section).getByRole('link', { name: 'Real estate' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(window.location.pathname).toBe('/real-estate')
  })

  it('the menu and its tiles are two landmarks with their own names', () => {
    render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />)
    expect(screen.getByRole('complementary', { name: 'Menu' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Places' })).toHaveClass('sidebar__tiles')
    expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull()
  })

  it('choosing a page closes the drawer', () => {
    const onClose = vi.fn()
    render(<Sidebar routes={routes} path="/" open onClose={onClose} />)
    fireEvent.click(screen.getByRole('link', { name: title('/assets') }))
    expect(onClose).toHaveBeenCalled()
    expect(window.location.pathname).toBe('/assets')
  })

  describe('compact mode', () => {
    const toggle = () => screen.getByRole('button', { name: 'Compact menu' })
    const menu = () => screen.getByRole('complementary', { name: 'Menu' })

    it('starts expanded and shrinks to icons on the toggle, keeping every accessible name', () => {
      stubStorage('local')
      render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />, withOpen(['2031-07', '2031-08']))
      expect(toggle()).toHaveAttribute('aria-expanded', 'true')
      expect(toggle()).toHaveAttribute('aria-controls', 'app-sidebar')
      expect(menu()).not.toHaveClass('sidebar--compact')
      fireEvent.click(toggle())
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
      expect(menu()).toHaveClass('sidebar--compact')
      // the words are still the link's name (no aria-label replaces them), the mouse gets a title
      expect(closeLink()).toHaveAccessibleName('Close month 2 months not closed')
      expect(closeLink()).toHaveAttribute('title', title('/close'))
      fireEvent.click(toggle())
      expect(menu()).not.toHaveClass('sidebar--compact')
      expect(closeLink()).not.toHaveAttribute('title')
    })

    it('remembers the choice for this browser', () => {
      const store = stubStorage('local')
      const { unmount } = render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />)
      fireEvent.click(toggle())
      expect(store.get(SIDEBAR_STORAGE_KEY)).toBe('compact')
      unmount()
      render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />)
      expect(menu()).toHaveClass('sidebar--compact')
      fireEvent.click(toggle())
      expect(store.has(SIDEBAR_STORAGE_KEY)).toBe(false)
    })

    it('works with a blocked storage', () => {
      stubStorage('local', {}, { failReads: true, failWrites: true })
      render(<Sidebar routes={routes} path="/" open={false} onClose={() => {}} />)
      fireEvent.click(toggle())
      expect(menu()).toHaveClass('sidebar--compact')
    })
  })
})
