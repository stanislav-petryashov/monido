import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { navigate, registerNavigationGuard, useRoute } from '../../src/lib/router'
import { t } from '../../src/i18n/client'
import { Link } from '../../src/components/ui/Link'
import { matchRoute, redirectFor, routesFor } from '../../src/routes'

const allRoutes = routesFor({ demo: false })

// Observe React's decision, then stop the native default at the window boundary: jsdom has no document navigation.
function browserClick(link: HTMLElement, init?: MouseEventInit): boolean {
  let leftToBrowser = false
  window.addEventListener('click', event => {
    leftToBrowser = !event.defaultPrevented
    event.preventDefault()
  }, { once: true })
  fireEvent.click(link, init)
  return leftToBrowser
}

function PathProbe() {
  return <span data-testid="path">{useRoute()}</span>
}

beforeEach(() => window.history.replaceState(null, '', '/'))

describe('router', () => {
  it('navigate() re-renders with the new path and adds a history entry', () => {
    render(<PathProbe />)
    const before = window.history.length
    act(() => navigate('/capital'))
    expect(screen.getByTestId('path')).toHaveTextContent('/capital')
    expect(window.history.length).toBe(before + 1)
  })

  it('replace: true does not add a history entry', () => {
    render(<PathProbe />)
    const before = window.history.length
    act(() => navigate('/goals', { replace: true }))
    expect(screen.getByTestId('path')).toHaveTextContent('/goals')
    expect(window.history.length).toBe(before)
  })

  it('back/forward (popstate) re-renders with the restored path', () => {
    render(<PathProbe />)
    act(() => navigate('/goals'))
    act(() => {
      window.history.replaceState(null, '', '/cashflow')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(screen.getByTestId('path')).toHaveTextContent('/cashflow')
  })

  it('Link: a plain click navigates without a page load', () => {
    render(<><Link to="/goals">Goals</Link><PathProbe /></>)
    const notPrevented = fireEvent.click(screen.getByText('Goals'))
    expect(notPrevented).toBe(false)
    expect(screen.getByTestId('path')).toHaveTextContent('/goals')
  })

  it('Link: Cmd/Ctrl-click is left to the browser (new tab)', () => {
    render(<><Link to="/goals">Goals</Link><PathProbe /></>)
    const notPrevented = browserClick(screen.getByText('Goals'), { ctrlKey: true })
    expect(notPrevented).toBe(true)
    expect(screen.getByTestId('path')).toHaveTextContent('/')
  })

  it('Link: clicking the current page does not add a history entry', () => {
    window.history.replaceState(null, '', '/goals')
    render(<><Link to="/goals">Goals</Link><PathProbe /></>)
    const before = window.history.length
    expect(fireEvent.click(screen.getByText('Goals'))).toBe(false)
    expect(window.history.length).toBe(before)
  })

  it('Link: target="_blank" and download are left to the browser', () => {
    render(<><Link to="/goals" target="_blank">Goals</Link><Link to="/report.csv" download>CSV</Link><PathProbe /></>)
    expect(browserClick(screen.getByText('Goals'))).toBe(true)
    expect(browserClick(screen.getByText('CSV'))).toBe(true)
    expect(screen.getByTestId('path')).toHaveTextContent('/')
  })
})

describe('routes', () => {
  it('8 dashboard, 6 records and 7 settings pages (subsections, consent and setup are not in the menu) with unique paths', () => {
    expect(allRoutes.filter(r => r.section === 'dashboard')).toHaveLength(8)
    expect(allRoutes.filter(r => r.section === 'data')).toHaveLength(6)
    expect(allRoutes.filter(r => r.section === 'settings')).toHaveLength(7)
    expect(new Set(allRoutes.map(r => r.path)).size).toBe(allRoutes.length)
  })

  it('matchRoute finds dashboard and settings pages', () => {
    expect(t(matchRoute('/assets', allRoutes)!.title)).toBe('Assets')
    expect(matchRoute('/settings/history', allRoutes)).toMatchObject({ section: 'settings', title: 'routes.history' })
    expect(matchRoute('/nope', allRoutes)).toBeNull()
  })

  it('settings subsections, connector consent and setup are routes the menu does not list', () => {
    expect(matchRoute('/advisor/connect', allRoutes)).toMatchObject({ menu: false })
    expect(allRoutes.filter(r => r.menu === false).map(r => r.path)).toEqual(['/available-money', '/advisor/ask', '/accounts', '/cashflow/categories', '/real-estate', '/goals/edit', '/settings/family', '/settings/reminders', '/settings/history', '/settings/data', '/setup', '/advisor/connect'])
    expect(redirectFor('/advisor/connect', allRoutes)).toBeNull()
  })

  it('known paths need no redirect', () => {
    expect(redirectFor('/', allRoutes)).toBeNull()
    expect(redirectFor('/loans', allRoutes)).toBeNull()
  })

  it('the old admin bookmark goes to accounts', () => {
    expect(redirectFor('/admin', allRoutes)).toBe('/accounts')
    expect(redirectFor('/admin/loans', allRoutes)).toBe('/accounts')
  })

  it('a trailing slash is dropped, unknown paths go to the overview', () => {
    expect(redirectFor('/net-worth/', allRoutes)).toBe('/')
    expect(redirectFor('/nope', allRoutes)).toBe('/')
  })
})


describe('navigation guards', () => {
  it('retains the route, URL and history on cancel; repeated attempts commit only the first destination', async () => {
    render(<PathProbe />)
    let answer!: (yes: boolean) => void
    const stop = registerNavigationGuard(() => new Promise(resolve => { answer = resolve }))
    const length = history.length
    act(() => { navigate('/goals'); navigate('/cashflow') })
    expect(location.pathname).toBe('/')
    expect(screen.getByTestId('path')).toHaveTextContent('/')
    await act(async () => answer(false))
    expect(history.length).toBe(length)
    act(() => { navigate('/goals'); navigate('/cashflow') })
    await act(async () => answer(true))
    expect(location.pathname).toBe('/goals')
    expect(history.length).toBe(length + 1)
    stop()
  })

  it('restores Back and Forward before asking, preserving history state and future entries on cancel', async () => {
    history.replaceState({ scroll: 42 }, '', '/')
    render(<PathProbe />)
    act(() => navigate('/goals'))
    act(() => navigate('/cashflow'))
    let answer!: (yes: boolean) => void
    let questions = 0
    const stop = registerNavigationGuard(() => { questions++; return new Promise(resolve => { answer = resolve }) })
    act(() => history.back())
    await waitFor(() => expect(questions).toBe(1))
    expect(location.pathname).toBe('/cashflow')
    expect(screen.getByTestId('path')).toHaveTextContent('/cashflow')
    act(() => history.back())
    await waitFor(() => expect(location.pathname).toBe('/cashflow'))
    await act(async () => answer(false))
    expect(questions).toBe(1)
    act(() => history.back())
    await waitFor(() => expect(questions).toBe(2))
    await act(async () => answer(true))
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/goals'))
    act(() => history.forward())
    await waitFor(() => expect(questions).toBe(3))
    expect(location.pathname).toBe('/goals')
    await act(async () => answer(false))
    stop()
    act(() => history.back())
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/))
    expect(history.state).toMatchObject({ scroll: 42 })
    act(() => history.forward())
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/goals'))
    act(() => history.forward())
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/cashflow'))
  })

  it('ignores a pending answer after its owner unregisters', async () => {
    render(<PathProbe />)
    let answer!: (yes: boolean) => void
    const stop = registerNavigationGuard(() => new Promise(resolve => { answer = resolve }))
    act(() => navigate('/goals'))
    stop()
    await act(async () => answer(true))
    expect(location.pathname).toBe('/')
    act(() => navigate('/cashflow'))
    expect(location.pathname).toBe('/cashflow')
  })
})


it('leaves external links and modified clicks to the browser even with unsaved input', () => {
  render(<><Link to="https://example.com/">External</Link><Link to="/goals">Goals</Link></>)
  const stop = registerNavigationGuard(async () => false)
  expect(browserClick(screen.getByText('External'))).toBe(true)
  for (const init of [{ metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    expect(browserClick(screen.getByText('Goals'), init)).toBe(true)
  }
  expect(location.pathname).toBe('/')
  stop()
})

it('same-page navigation skips discard and replacement preserves unrelated history state', async () => {
  history.replaceState({ scroll: 42 }, '', '/')
  render(<PathProbe />)
  let questions = 0
  const stop = registerNavigationGuard(async () => { questions++; return true })
  act(() => navigate('/'))
  expect(questions).toBe(0)
  const length = history.length
  await act(async () => navigate('/goals', { replace: true }))
  expect(history.length).toBe(length)
  expect(history.state).toMatchObject({ scroll: 42 })
  expect(location.pathname).toBe('/goals')
  stop()
})

it.each([{ restored: true, allowed: true }, { restored: false, allowed: true }, { restored: false, allowed: false }])('ignores an opposite browser traversal while the first discard question is open ($restored, $allowed)', async ({ restored, allowed }) => {
  render(<PathProbe />)
  act(() => navigate('/goals'))
  act(() => navigate('/cashflow'))
  act(() => history.back())
  await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/goals'))
  let answer!: (yes: boolean) => void
  let questions = 0
  const stop = registerNavigationGuard(() => { questions++; return new Promise(resolve => { answer = resolve }) })
  act(() => history.back())
  await waitFor(() => expect(questions).toBe(1))
  // Wait for the real Forward event, then for the router's restoration, before answering.
  await act(async () => {
    await new Promise<void>(resolve => {
      window.addEventListener('popstate', () => resolve(), { once: true })
      history.forward()
    })
    if (!restored) answer(allowed)
  })
  if (restored) {
    await waitFor(() => expect(location.pathname).toBe('/goals'))
    expect(screen.getByTestId('path')).toHaveTextContent('/goals')
    expect(questions).toBe(1)
    await act(async () => answer(allowed))
  }
  if (!allowed) {
    await waitFor(() => expect(location.pathname).toBe('/goals'))
    stop()
    act(() => history.back())
  }
  await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/))
  stop()
  act(() => history.forward())
  await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/goals'))
  act(() => history.forward())
  await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/cashflow'))
})

it.each([true, false])('preserves history when an internal navigation is answered during Back restoration (allow: %s)', async allowed => {
  render(<PathProbe />)
  act(() => navigate('/editor'))
  const length = history.length
  let answer!: (yes: boolean) => void
  let questions = 0
  const stop = registerNavigationGuard(() => { questions++; return new Promise(resolve => { answer = resolve }) })
  try {
    act(() => navigate('/goals'))
    expect(questions).toBe(1)
    await act(async () => {
      await new Promise<void>(resolve => {
        window.addEventListener('popstate', () => resolve(), { once: true })
        history.back()
      })
      // The Back event has happened, but its restoring Forward event has not.
      expect(location.pathname).toBe('/')
      answer(allowed)
    })
    await waitFor(() => expect(location.pathname).toBe(allowed ? '/goals' : '/editor'))
    expect(history.length).toBe(length + (allowed ? 1 : 0))
    expect(questions).toBe(1)
    expect(screen.getByTestId('path')).toHaveTextContent(allowed ? '/goals' : '/editor')

    act(() => history.back())
    await waitFor(() => expect(questions).toBe(2))
    await act(async () => answer(true))
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(allowed ? '/editor' : /^\/$/))
    stop()
    act(() => history.forward())
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(allowed ? '/goals' : '/editor'))
  } finally { stop(); await act(async () => answer?.(false)) }
})
