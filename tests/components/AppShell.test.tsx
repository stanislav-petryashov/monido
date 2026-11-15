import { StrictMode } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { AppShell } from '../../src/components/layout/AppShell'
import { t } from '../../src/i18n/client'
import { routesFor } from '../../src/routes'
import { setAuth, resetAuth } from '../../src/lib/authState'
import { jsonResponse } from '../helpers/http'
import { renderWithSnapshot, testClient } from '../helpers/render'
import { makeSnapshot } from '../helpers/snapshot'

// route titles belong to the route table (and to the modules); the tests read them from there
const title = (path: string) => t(path === '/settings/general' ? 'ux.settingsGeneral' : routesFor({ demo: false }).find(r => r.path === path)!.title)
const APP_TITLE = 'Monido'

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/admin/')) return jsonResponse({ rows: [], columns: [] })
    return jsonResponse({ error: 'unavailable' }, 503)
  }))
}

/** The whole shell: no snapshot in the cache, dashboard and notification providers as in App.tsx. */
function renderApp({ strict = false, client = testClient() } = {}) {
  return renderWithSnapshot(<AppShell />, undefined, { client, notify: true, wrapper: strict ? StrictMode : undefined })
}

beforeEach(() => {
  stubFetch()
  vi.stubGlobal('scrollTo', vi.fn())
  window.history.replaceState(null, '', '/')
})

describe('AppShell', () => {
  it('redirects the old /admin bookmark to accounts', async () => {
    window.history.replaceState(null, '', '/admin')
    renderApp()
    await waitFor(() => expect(window.location.pathname).toBe('/accounts'))
    await waitFor(() => expect(document.title).toBe(`${title('/accounts')} · ${APP_TITLE}`))
  })

  it.each([
    ['/capital', '/'],
    ['/data/parameters', '/settings/general'],
    ['/data/journal', '/settings/history'],
  ])('an old bookmark %s opens %s', async (from, to) => {
    window.history.replaceState(null, '', from)
    renderApp()
    await waitFor(() => expect(window.location.pathname).toBe(to))
    expect(await screen.findByRole('heading', { level: 1, name: title(to) })).toBeInTheDocument()
  })

  it.each([
    ['/settings/modules#loans', '/settings/general'],
    ['/data/modules', '/settings/general'],
    ['/settings/modules#reminders', '/settings/reminders'],
  ])('the old Modules page %s opens %s', async (from, to) => {
    window.history.replaceState(null, '', from)
    renderApp()
    await waitFor(() => expect(window.location.pathname).toBe(to))
    expect(await screen.findByRole('heading', { level: 1, name: title(to) })).toBeInTheDocument()
  })

  it('in the demo a reminders or advisor address is unknown and opens Overview', async () => {
    setAuth({ mode: 'demo' })
    try {
      window.history.replaceState(null, '', '/settings/reminders')
      renderApp()
      await waitFor(() => expect(window.location.pathname).toBe('/'))
    } finally {
      resetAuth()
    }
  })

  it('sidebar navigation switches the page header and the tab title', async () => {
    renderApp()
    expect(await screen.findByRole('heading', { level: 1, name: title('/') })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: title('/assets') }))
    expect(await screen.findByRole('heading', { level: 1, name: title('/assets') })).toBeInTheDocument()
    expect(document.title).toBe(`${title('/assets')} · ${APP_TITLE}`)
  })

  it('the first visit to a lazily loaded data page focuses its heading', async () => {
    renderApp()
    await screen.findByRole('heading', { level: 1, name: title('/') })
    fireEvent.click(screen.getByRole('link', { name: title('/assets') }))
    fireEvent.click(await screen.findByRole('link', { name: title('/accounts') }))
    const h1 = await screen.findByRole('heading', { level: 1, name: title('/accounts') })
    await waitFor(() => expect(document.activeElement).toBe(h1))
  })

  it.each(routesFor({ demo: false }).filter(r => r.area).map(r => r.path))('the title row names the sub-page %s itself, not its area', async path => {
    window.history.replaceState(null, '', path)
    renderApp()
    expect(await screen.findByRole('heading', { level: 1, name: title(path) })).toBeInTheDocument()
  })

  it('on Accounts the title row reads «Accounts» with the count, the total, its month and its share of assets', async () => {
    window.history.replaceState(null, '', '/accounts')
    renderWithSnapshot(<AppShell />, makeSnapshot(), { notify: true })
    expect(await screen.findByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument()
    expect(document.querySelector('.title-row__subtitle')).toHaveTextContent('2 accounts · $19,268 on June 2031 · 10.4% of assets')
    const add = await screen.findByRole('button', { name: '+ Account' })
    expect(add.closest('.title-row')).not.toBeNull()
    expect(document.querySelectorAll('.page-action-slot')).toHaveLength(1)
    fireEvent.click(add)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('the Accounts subtitle names the accounts without a rate instead of counting them as 0', async () => {
    window.history.replaceState(null, '', '/accounts')
    const snapshot = makeSnapshot()
    snapshot.capital!.accounts[1] = { ...snapshot.capital!.accounts[1], valueBase: null }
    renderWithSnapshot(<AppShell />, snapshot, { notify: true })
    await screen.findByRole('heading', { level: 1, name: 'Accounts' })
    await waitFor(() => expect(document.querySelector('.title-row__subtitle')).toHaveTextContent('2 accounts · $15,748 on June 2031 · 8.5% of assets · without a rate: 1'))
  })

  it('does not steal focus on the initial load, even in StrictMode', async () => {
    renderApp({ strict: true })
    await screen.findByRole('heading', { level: 1, name: title('/') })
    expect(document.activeElement).toBe(document.body)
  })

  it('scrolls to the top when switching pages', async () => {
    renderApp()
    await screen.findByRole('heading', { level: 1, name: title('/') })
    fireEvent.click(screen.getByRole('link', { name: title('/assets') }))
    await screen.findByRole('heading', { level: 1, name: title('/assets') })
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  describe('on a phone', () => {
    const phone = (matches: boolean) => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches, addEventListener() {}, removeEventListener() {} })))
    afterEach(() => vi.unstubAllGlobals())

    it('has the bottom bar, whose More opens the menu and takes the focus back', async () => {
      phone(true)
      renderApp()
      await screen.findByRole('heading', { level: 1, name: title('/') })
      const more = screen.getByRole('button', { name: 'More' })
      fireEvent.click(more)
      expect(more).toHaveAttribute('aria-expanded', 'true')
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(more).toHaveAttribute('aria-expanded', 'false')
      expect(more).toHaveFocus()
    })

    it('gives the focus back only once the page is no longer inert: a browser refuses it before that', async () => {
      phone(true)
      const { container } = renderApp()
      await screen.findByRole('heading', { level: 1, name: title('/') })
      const more = screen.getByRole('button', { name: 'More' })
      fireEvent.click(more)
      const inertAtFocus: boolean[] = []
      const focus = more.focus.bind(more)
      more.focus = () => { inertAtFocus.push(container.querySelector('.shell__main')!.hasAttribute('inert')); focus() }
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(inertAtFocus).toEqual([false])
    })

    it('leaves the focus on the new page after a link in the menu, not on the button that opened it', async () => {
      phone(true)
      renderApp()
      await screen.findByRole('heading', { level: 1, name: title('/') })
      fireEvent.click(screen.getByRole('button', { name: 'More' }))
      const assets = within(document.getElementById('app-sidebar')!).getByRole('link', { name: title('/assets') })
      fireEvent.click(assets)
      const heading = await screen.findByRole('heading', { level: 1, name: title('/assets') })
      await waitFor(() => expect(heading).toHaveFocus())
    })

    it('gives the focus to the menu button when the bar is gone: the window grew while the menu was open', async () => {
      const media = { matches: true, listeners: [] as ((e: { matches: boolean }) => void)[] }
      vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
        matches: query.includes('max-width') ? media.matches : false,
        addEventListener: (_: string, listener: (e: { matches: boolean }) => void) => { if (query.includes('max-width')) media.listeners.push(listener) },
        removeEventListener() {},
      })))
      renderApp()
      await screen.findByRole('heading', { level: 1, name: title('/') })
      fireEvent.click(screen.getByRole('button', { name: 'More' }))
      act(() => { media.matches = false; media.listeners.forEach(l => l({ matches: false })) })
      expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus()
    })

    it('has no bottom bar on a wide screen', async () => {
      phone(false)
      renderApp()
      await screen.findByRole('heading', { level: 1, name: title('/') })
      expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
    })
  })

  describe('between the phone and the wide screen', () => {
    /** matchMedia answering `(max-width: N)` and `(min-width: N)` queries for a window `width` pixels wide */
    const viewport = (width: number) => vi.stubGlobal('matchMedia', vi.fn((query: string) => {
      const max = /max-width:\s*(\d+)px/.exec(query)
      const min = /min-width:\s*(\d+)px/.exec(query)
      const matches = max ? width <= Number(max[1]) : min ? width >= Number(min[1]) : false
      return { matches, media: query, addEventListener() {}, removeEventListener() {} }
    }))
    afterEach(() => vi.unstubAllGlobals())

    it('at 900px the hamburger sits in the title row: opening it focuses the first tile, Escape gives the focus back', async () => {
      viewport(900)
      renderApp()
      await screen.findByRole('heading', { level: 1, name: title('/') })
      const hamburger = screen.getByRole('button', { name: 'Open menu' })
      expect(hamburger).toHaveClass('title-row__menu')
      expect(hamburger.closest('.title-row')).not.toBeNull()
      expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
      fireEvent.click(hamburger)
      const tiles = within(document.getElementById('app-sidebar')!).getAllByRole('link').filter(a => a.classList.contains('tile'))
      expect(tiles[0]).toHaveFocus()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(hamburger).toHaveFocus()
    })
  })

  it('the open drawer is announced by the hamburger and makes the page inert', async () => {
    const { container } = renderApp()
    await screen.findByRole('heading', { level: 1, name: title('/') })
    const hamburger = screen.getByRole('button', { name: 'Open menu' })
    expect(hamburger).toHaveAttribute('aria-expanded', 'false')
    expect(hamburger).toHaveAttribute('aria-controls', 'app-sidebar')
    fireEvent.click(hamburger)
    expect(hamburger).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelector('.shell__main')).toHaveAttribute('inert')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(container.querySelector('.shell__main')).not.toHaveAttribute('inert')
  })

  it('a save that fails after leaving the data page is still shown, and can be dismissed', async () => {
    let failDelete: () => void = () => {}
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/settings') return Promise.resolve(jsonResponse({ language: 'en-US', currency: 'USD' }))
      if (init?.method === 'DELETE') return new Promise<Response>(resolve => { failDelete = () => resolve(jsonResponse({ error: 'boom' }, 500)) })
      if (url === '/api/admin/goals') return Promise.resolve(jsonResponse({ rows: [{ rowid: 1, id: 'fire', name: 'FIRE' }], columns: ['id', 'name'] }))
      if (url.startsWith('/api/admin/')) return Promise.resolve(jsonResponse({ rows: [], columns: [] }))
      return Promise.resolve(jsonResponse({ error: 'unavailable' }, 503))
    }))
    window.history.replaceState(null, '', '/goals/edit')
    renderApp()
    await screen.findByText('FIRE')
    // the row menu and its wording belong to the data screens: found by structure (the danger item is the delete)
    fireEvent.click(document.querySelector('.row-menu__trigger')!)
    fireEvent.click(document.querySelector('.row-menu__item--danger')!)
    fireEvent.click(screen.getByRole('link', { name: title('/') }))
    await screen.findByRole('heading', { level: 1, name: title('/') })
    failDelete()
    // the Overview has its own load error in this test (also role="alert"): look for the toast card
    const alert = await waitFor(() => {
      const card = document.querySelector<HTMLElement>('.toast[role="alert"]')
      expect(card).not.toBeNull()
      return card!
    })
    expect(alert).toHaveTextContent('boom')
    expect(document.querySelector('.toast:not([role="alert"])')).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText(/boom/)).toBeNull()
  })
})
