import { t } from '../../src/i18n/client'
import { CORE_ROUTES, GROUP_LABEL, MENU_GROUPS, inMenu, matchRoute, movedPath, redirectFor, routesFor } from '../../src/routes'
import { ru } from '../helpers/i18n'

const all = routesFor({ demo: false })
const demo = routesFor({ demo: true })

describe('routes from modules', () => {
  it('/settings/family is a core settings tab', () => {
    expect(CORE_ROUTES.find(r => r.path === '/settings/family')).toMatchObject({ section: 'settings', title: 'routes.familyAccess', order: 15, area: '/settings/general', menu: false })
  })

  it('every module page is routed; the demo has no advisor or reminders pages', () => {
    const paths = all.map(r => r.path)
    expect(paths).toEqual(expect.arrayContaining(['/cashflow', '/loans', '/real-estate', '/goals', '/health', '/advisor', '/advisor/connect', '/settings/reminders']))
    expect(paths).not.toContain('/settings/modules')
    const demoPaths = demo.map(r => r.path)
    expect(demoPaths.filter(p => p.startsWith('/advisor') || p === '/settings/reminders')).toEqual([])
    expect(demoPaths).toEqual(expect.arrayContaining(['/cashflow', '/loans', '/real-estate', '/goals', '/health']))
  })

  it('/settings/reminders is a Settings tab', () => {
    expect(matchRoute('/settings/reminders', all)).toMatchObject({ section: 'settings', area: '/settings/general', menu: false, order: 20 })
  })

  it('the menu keeps its order', () => {
    expect(inMenu(all).map(r => r.path)).toEqual([
      '/', '/assets', '/cashflow', '/goals', '/health', '/advisor',
      '/close', '/loans',
      '/settings/general',
    ])
  })

  it('/setup is routable and not in the menu', () => {
    for (const routes of [all, demo]) {
      expect(matchRoute('/setup', routes)).toMatchObject({ path: '/setup', menu: false })
      expect(redirectFor('/setup', routes)).toBeNull()
      expect(inMenu(routes).map(r => r.path)).not.toContain('/setup')
    }
  })

  it('/advisor/connect is routable but not in the menu', () => {
    const routes = all
    expect(matchRoute('/advisor/connect', routes)).toMatchObject({ path: '/advisor/connect', menu: false })
    expect(redirectFor('/advisor/connect', routes)).toBeNull()
    expect(inMenu(routes).map(r => r.path)).not.toContain('/advisor/connect')
    expect(inMenu(routes).map(r => r.path)).toContain('/advisor')
    // the demo has neither: an unknown address
    expect(matchRoute('/advisor/connect', demo)).toBeNull()
    expect(redirectFor('/advisor/connect', demo)).toBe('/')
  })

  it('core titles and section labels are locale keys with a text in every language', () => {
    expect(CORE_ROUTES.map(r => t(r.title))).toEqual([
      'Overview', 'Assets', 'Available money', 'Close month', 'Accounts', 'Settings', 'Family and access', 'Change history', 'Data', 'Setup wizard',
    ])
    expect(MENU_GROUPS.map(g => t(GROUP_LABEL[g]))).toEqual(['Main', 'Money', 'Planning', 'Settings'])
    for (const key of [...CORE_ROUTES.map(r => r.title), ...Object.values(GROUP_LABEL)]) expect(ru(key)).not.toBe(key)
  })

  it('every route the menu lists names its group, in the demo too', () => {
    for (const routes of [all, demo]) {
      for (const r of inMenu(routes)) expect(MENU_GROUPS, r.path).toContain(r.group)
    }
  })

  it('every area names a route, or AreaNavigation would silently show no tabs', () => {
    for (const r of all) if (r.area) expect(matchRoute(r.area, all), r.path).not.toBeNull()
  })

  it('only Close month carries the open-months badge', () => {
    expect(all.filter(r => r.badge).map(r => [r.path, r.badge])).toEqual([['/close', 'openMonths']])
  })

  it('a trailing slash, the old admin and an unknown address', () => {
    const routes = all
    expect(redirectFor('/loans/', routes)).toBe('/loans')
    expect(redirectFor('/admin', routes)).toBe('/accounts')
    expect(redirectFor('/nowhere', routes)).toBe('/')
  })
})

describe('old bookmarks', () => {
  const routes = all

  it.each([
    ['/data/close', '/close'],
    ['/data/accounts', '/accounts'],
    ['/data/real-estate', '/real-estate'],
    ['/data/loans', '/loans'],
    ['/data/flows', '/cashflow/categories'],
    ['/data/goals', '/goals/edit'],
    ['/settings/parameters', '/settings/general'],
    ['/settings/users', '/settings/family'],
    ['/settings/backup', '/settings/data'],
    ['/settings/parameters/backup', '/settings/data'],
    ['/settings/parameters/maintenance', '/settings/data'],
    ['/settings', '/settings/general'],
    ['/capital', '/'],
    ['/net-worth', '/'],
    ['/data/parameters', '/settings/general'],
    ['/data/journal', '/settings/history'],
    ['/data/modules', '/settings/general'],
    ['/settings/modules', '/settings/general'],
    ['/data/spending', '/cashflow/categories'],
  ])('%s moves to %s, keeping the hash and dropping a trailing slash', (from, to) => {
    expect(redirectFor(from, routes)).toBe(to)
    expect(redirectFor(`${from}/`, routes)).toBe(to)
    expect(redirectFor(`${from}#loans`, routes)).toBe(`${to}#loans`)
  })

  it('the reminders card on the old Modules page opens the Reminders tab', () => {
    expect(redirectFor('/settings/modules#reminders', routes)).toBe('/settings/reminders')
  })

  it('a current page with a hash needs no redirect', () => {
    expect(redirectFor('/settings/general#loans', routes)).toBeNull()
  })

  it('a record hash on a records screen is no redirect either, even one that spells a module key', () => {
    expect(redirectFor('/accounts#Brisaluna%20Bank%7CRobin', routes)).toBeNull()
    expect(redirectFor('/loans#loans', routes)).toBeNull()
  })

  it.each([
    ['/net-worth#availability', '/available-money'],
    ['/capital#availability', '/available-money'],
    ['/net-worth#liabilities', '/loans'],
    ['/net-worth/#liabilities', '/loans'],
  ])('%s, a section that became a page, opens %s without the hash', (from, to) => {
    expect(redirectFor(from, routes)).toBe(to)
  })

  it('movedPath names the page of an old section', () => {
    expect(movedPath('/net-worth', '#liabilities')).toBe('/loans')
    expect(movedPath('/net-worth', '#history')).toBe('/assets#history')
    expect(movedPath('/', '#history')).toBe('/assets#history')
    expect(movedPath('/')).toBe('')
    expect(movedPath('/data/loans/')).toBe('/loans')
  })

  it('the history section, once on Net worth and then on Overview, opens on Assets with its hash', () => {
    expect(redirectFor('/net-worth#history', routes)).toBe('/assets#history')
    expect(redirectFor('/#history', routes)).toBe('/assets#history')
    expect(redirectFor('/assets#history', routes)).toBeNull()
    expect(redirectFor('/#other', routes)).toBeNull()
    expect(redirectFor('/', routes)).toBeNull()
  })

  it('a moved address keeps its query and hash', () => {
    expect(redirectFor('/data/flows?month=2026-09', routes)).toBe('/cashflow/categories?month=2026-09')
    expect(redirectFor('/data/goals?edit=abc', routes)).toBe('/goals/edit?edit=abc')
    expect(redirectFor('/data/flows/?month=2026-09#x', routes)).toBe('/cashflow/categories?month=2026-09#x')
    expect(redirectFor('/data/accounts#Bank%7CRobin', routes)).toBe('/accounts#Bank%7CRobin')
  })

  it('a current page with a query needs no redirect', () => {
    expect(redirectFor('/cashflow/categories?month=2026-09', routes)).toBeNull()
    expect(redirectFor('/?month=2026-09', routes)).toBeNull()
  })

  it('no page lives under /assets/, which the production server keeps for built files', () => {
    expect(routes.filter(r => r.path.startsWith('/assets/'))).toEqual([])
  })
})
