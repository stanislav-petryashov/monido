import { screen, within } from '@testing-library/react'
import { SecondFloor } from '../../src/components/layout/SecondFloor'
import { routesFor } from '../../src/routes'
import type { FinanceSnapshot } from '../../src/domain/types'
import { makeSnapshot } from '../helpers/snapshot'
import { jsonResponse as json } from '../helpers/http'
import { renderWithClient, renderWithSnapshot } from '../helpers/render'
import { pageOf, viewOf } from '../modules/advisor/proposalViews'

const routes = routesFor({ demo: false })
const withOpen = (openMonths: string[]) => {
  const base = makeSnapshot()
  return makeSnapshot({ asOf: { ...base.asOf, openMonths } })
}
/** Every health metric in the green: nothing for the Health module to do */
const allGreen = (s: FinanceSnapshot): FinanceSnapshot => {
  const metrics = Object.fromEntries(Object.entries(s.health!.metrics).map(([k, m]) => [k, { ...m, zone: 'green' }])) as NonNullable<FinanceSnapshot['health']>['metrics']
  return { ...s, health: { ...s.health!, metrics } }
}
const links = (nav: HTMLElement) => within(nav).getAllByRole('link').map(a => a.getAttribute('href'))

// the advisor's proposals read stays pending unless a test answers it
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))))
afterEach(() => vi.unstubAllGlobals())

describe('SecondFloor: the pages of an area', () => {
  it('lists the area pages under "Assets" with the current one marked', () => {
    renderWithSnapshot(<SecondFloor path="/accounts" routes={routes} />)
    const nav = screen.getByRole('navigation', { name: 'Assets' })
    expect(links(nav)).toEqual(['/assets', '/accounts', '/real-estate', '/available-money'])
    expect(within(nav).getByRole('link', { name: 'Accounts' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Summary' })).not.toHaveAttribute('aria-current')
  })

  it('on the parent page marks the parent', () => {
    renderWithSnapshot(<SecondFloor path="/settings/general" routes={routes} />)
    const nav = screen.getByRole('navigation', { name: 'Settings' })
    expect(within(nav).getAllByRole('link').map(a => a.textContent)).toEqual(['General', 'Family and access', 'Notifications', 'Change history', 'Data'])
    expect(within(nav).getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page')
  })

  it('every row is a .sidebar__row with its icon', () => {
    renderWithSnapshot(<SecondFloor path="/accounts" routes={routes} />)
    for (const row of screen.getAllByRole('link')) {
      expect(row).toHaveClass('sidebar__row')
      expect(row.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('omits the empty section placeholder', () => {
    renderWithSnapshot(<SecondFloor path="/loans" routes={routes} />)
    expect(screen.queryByText('No sub-pages here')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})

describe('SecondFloor: what needs doing on Overview', () => {
  it('on Overview lists what needs doing: the open month first, then the modules', () => {
    renderWithSnapshot(<SecondFloor path="/" routes={routes} />, withOpen(['2031-07']))
    const nav = screen.getByRole('navigation', { name: 'To do' })
    const rows = within(nav).getAllByRole('link')
    expect(rows[0]).toHaveAttribute('href', '/close')
    expect(rows[0]).toHaveTextContent('Close July 2031')
    // the fictional family's savings rate is in the red
    expect(within(nav).getByRole('link', { name: 'Savings rate needs work' })).toHaveAttribute('href', '/health')
    expect(screen.queryByRole('navigation', { name: 'Assets' })).toBeNull()
  })

  it('one row per open month, oldest first', () => {
    renderWithSnapshot(<SecondFloor path="/" routes={routes} />, withOpen(['2031-07', '2031-08']))
    const nav = screen.getByRole('navigation', { name: 'To do' })
    expect(within(nav).getAllByRole('link').slice(0, 2).map(a => a.textContent)).toEqual(['Close July 2031', 'Close August 2031'])
  })

  it('says goals are short by the gap in the family currency', () => {
    const base = makeSnapshot()
    const allocations = [{ goal: { name: 'Trip', target_date: '2032-01-31' }, status: 'behind', progressPct: 10 }] as unknown as typeof base.goals.plan.allocations
    const plan = (surplusBase: number) => ({ ...base.goals, plan: { ...base.goals.plan, allocations, monthlySavingsBase: 100, totalRequiredBase: 100 - surplusBase, surplusBase } })
    const { unmount } = renderWithSnapshot(<SecondFloor path="/" routes={routes} />, makeSnapshot({ goals: plan(-500) }))
    expect(screen.getByRole('link', { name: 'Goals are short by $500 a month' })).toHaveAttribute('href', '/goals')
    unmount()
    renderWithSnapshot(<SecondFloor path="/" routes={routes} />, makeSnapshot({ goals: plan(500) }))
    expect(screen.queryByRole('link', { name: /Goals are short/ })).toBeNull()
  })

  it('lists a proposal waiting for the vote, read from the council', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/advisor/proposals' ? json(pageOf([viewOf()])) : json({ error: { code: 'not_found' } }, 404)))
    renderWithSnapshot(<SecondFloor path="/" routes={routes} />, withOpen([]))
    const row = await screen.findByRole('link', { name: 'Vote: A car on credit' })
    expect(row).toHaveAttribute('href', '/advisor')
    // the modules keep their order: the health row before the advisor's
    const nav = screen.getByRole('navigation', { name: 'To do' })
    expect(links(nav)).toEqual(['/health', '/advisor'])
  })

  it('shows no list at all when there is nothing to do', () => {
    renderWithSnapshot(<SecondFloor path="/" routes={routes} />, allGreen(withOpen([])))
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByText('To do')).toBeNull()
  })

  it('without a snapshot yet lists nothing of the modules', () => {
    renderWithClient(<SecondFloor path="/" routes={routes} />)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})
