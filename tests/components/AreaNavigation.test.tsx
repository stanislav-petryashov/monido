import { fireEvent, screen } from '@testing-library/react'
import { AreaNavigation } from '../../src/components/layout/AreaNavigation'
import { routesFor } from '../../src/routes'
import { renderWithClient } from '../helpers/render'

/** The window width: the links of an area are drawn under its title only below the drawer breakpoint; wider, the menu's second floor lists them */
const width = (px: number) => vi.stubGlobal('matchMedia', vi.fn((query: string) => {
  const max = /max-width:\s*(\d+)px/.exec(query)
  return { matches: max ? px <= Number(max[1]) : false, addEventListener() {}, removeEventListener() {} }
}))

beforeEach(() => width(390))
afterEach(() => vi.unstubAllGlobals())

it('groups capital records and marks the current subview', () => {
  renderWithClient(<AreaNavigation path="/accounts" routes={routesFor({ demo: false })} />)
  expect(screen.getByRole('option', { name: 'Summary' })).toHaveValue('/assets')
  expect(screen.getByRole('combobox')).toHaveValue('/accounts')
  expect(screen.getByRole('option', { name: 'Real estate' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'Loans' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'Goals' })).toBeNull()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '/real-estate' } })
  expect(window.location.pathname).toBe('/real-estate')
})
it('does not add navigation to Overview', () => {
  renderWithClient(<AreaNavigation path="/" routes={routesFor({ demo: false })} />)
  expect(screen.queryByRole('navigation')).toBeNull()
})
it('offers the settings selector on the Data page', () => {
  renderWithClient(<AreaNavigation path="/settings/data" routes={routesFor({ demo: false })} />)
  expect(screen.getAllByRole('option').map(a => a.textContent)).toEqual(['General', 'Family and access', 'Notifications', 'Change history', 'Data'])
  expect(screen.getByRole('combobox')).toHaveValue('/settings/data')
})
it('renders only below the drawer breakpoint', () => {
  width(900)
  const { unmount } = renderWithClient(<AreaNavigation path="/accounts" routes={routesFor({ demo: false })} />)
  expect(screen.getByRole('navigation')).toBeInTheDocument()
  unmount()
  width(1440)
  const { container } = renderWithClient(<AreaNavigation path="/accounts" routes={routesFor({ demo: false })} />)
  expect(container).toBeEmptyDOMElement()
})
