import { fireEvent, screen, within } from '@testing-library/react'
import { BottomBar } from '../../src/components/layout/BottomBar'
import { bottomBarRoutes, matchRoute, routesFor } from '../../src/routes'
import { t } from '../../src/i18n/client'
import { makeSnapshot } from '../helpers/snapshot'
import { renderWithSnapshot } from '../helpers/render'

const render = (path: string, onMore = () => {}, openMonths: string[] = []) => {
  const base = makeSnapshot()
  return renderWithSnapshot(<BottomBar path={path} routes={routesFor({ demo: false })} moreOpen={false} onMore={onMore} />, makeSnapshot({ asOf: { ...base.asOf, openMonths } }))
}
const links = () => within(screen.getByRole('navigation', { name: 'Main sections' })).getAllByRole('link')

describe('bottomBarRoutes', () => {
  it('keeps the four most used places, in the demo too', () => {
    for (const demo of [false, true]) expect(bottomBarRoutes(routesFor({ demo })).map(r => r.path)).toEqual(['/', '/close', '/assets', '/cashflow'])
  })
})

describe('BottomBar', () => {
  it('shows the places and More', () => {
    render('/')
    expect(links().map(a => a.getAttribute('href'))).toEqual(['/', '/close', '/assets', '/cashflow'])
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-controls', 'app-sidebar')
  })

  it('uses the short name of a place where the full one does not fit', () => {
    render('/')
    expect(links().map(a => a.textContent)).toEqual(['Overview', 'Close month', 'Assets', 'Income'])
    expect(t(matchRoute('/health', routesFor({ demo: false }))!.bottomBarTitle!)).toBe('Health')
  })

  it('marks the current place, a tab of a place included', () => {
    render('/accounts')
    expect(links().filter(a => a.hasAttribute('aria-current')).map(a => a.getAttribute('href'))).toEqual(['/assets'])
  })

  it('marks More on a page that has no place of its own', () => {
    render('/health')
    expect(links().filter(a => a.hasAttribute('aria-current'))).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'More' })).toHaveClass('bottom-bar__item--current')
  })

  it('counts the open months beside Close month', () => {
    render('/', () => {}, ['2031-07', '2031-08'])
    const close = links().find(a => a.getAttribute('href') === '/close')!
    expect(close.querySelector('.bottom-bar__badge')).toHaveTextContent('2')
    expect(close).toHaveAccessibleName('Close month 2 months not closed')
  })

  it('opens the full menu from More', () => {
    const onMore = vi.fn()
    render('/', onMore)
    const more = screen.getByRole('button', { name: 'More' })
    fireEvent.click(more)
    expect(onMore).toHaveBeenCalledWith(more)
  })
})
