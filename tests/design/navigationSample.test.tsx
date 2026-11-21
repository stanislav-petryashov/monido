import { act, fireEvent, render, screen } from '@testing-library/react'
import { DesignProviders } from '../../design/providers'
import { NavigationSample } from '../../design/samples'
import { designClient } from '../../design/setup'

/** A window whose width the test sets: below 1200 the menu is a drawer, at 1200 and above a sidebar */
function windowOfWidth(initial: number) {
  let width = initial
  const listeners = new Map<string, Set<(e: { matches: boolean }) => void>>()
  const matches = (query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query), min = /min-width:\s*(\d+)px/.exec(query)
    return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
  }
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return matches(query) },
    addEventListener: (_: string, l: (e: { matches: boolean }) => void) => { (listeners.get(query) ?? listeners.set(query, new Set()).get(query)!).add(l) },
    removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => { listeners.get(query)?.delete(l) },
  }))
  return (next: number) => act(() => {
    width = next
    for (const [query, set] of listeners) for (const l of set) l({ matches: matches(query) })
  })
}

const menu = () => screen.getByRole('button', { name: 'Open menu' })

describe('the navigation sample of the catalog', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('closing the drawer with Escape gives the focus back to the button that opened it', () => {
    windowOfWidth(900)
    render(<DesignProviders client={designClient()}><NavigationSample /></DesignProviders>)
    fireEvent.click(menu())
    expect(menu()).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menu()).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(menu())
  })

  it('widening the preview to desktop closes the drawer, so narrowing it again does not reopen it', () => {
    const resize = windowOfWidth(900)
    render(<DesignProviders client={designClient()}><NavigationSample /></DesignProviders>)
    fireEvent.click(menu())
    resize(1300)
    resize(900)
    expect(menu()).toHaveAttribute('aria-expanded', 'false')
  })
})
