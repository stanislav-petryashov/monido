import { lazyWithChunks } from './i18n/lazyWithChunks'
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import {
  IconBuildingBank, IconCalendarCheck, IconCoins, IconDatabase, IconHistory, IconLayoutDashboard, IconSettings, IconUsers, IconWallet, IconWand,
  type TablerIcon,
} from '@tabler/icons-react'
import { clientModules } from './modules/client'
import { AccountsSubtitle } from './pages/admin/accounts/AccountsSubtitle'
import { CloseMonthAction } from './pages/overview/CloseMonthAction'

/** The frame a page is drawn in: the dashboard header, or the records and settings screen. The menu does not use it. */
export type Section = 'dashboard' | 'data' | 'settings'
/** The group of the side menu an item belongs to, by what it is about rather than by its frame. */
export type MenuGroup = 'main' | 'money' | 'planning' | 'settings'
/** A number the menu shows beside an item; the Sidebar knows where each one comes from */
export type RouteBadge = 'openMonths'
export interface RouteDef {
  section: Section
  path: string
  /** A locale key (`routes.*`, or `modules.<key>.*` for a module's page); shown through `t(title)` */
  title: string
  icon: TablerIcon
  /** The place in the menu within the group */
  order: number
  /** The place in the phone's bottom bar, lower first; the first enabled ones fill it */
  bottomBar?: number
  /** A shorter name for that bar, where the full one takes three lines at phone width (a locale key) */
  bottomBarTitle?: string
  /** The menu group; every route the menu lists has one */
  group?: MenuGroup
  page: LazyExoticComponent<ComponentType>
  /** The screen's main action, drawn in the title row's end cluster before the currency pills; none: the row has no action */
  primary?: ComponentType
  /** The title row's line under the title in place of the data month and rate (`Freshness`) */
  subtitle?: ComponentType
  badge?: RouteBadge
  /** `false`: a page the menu does not list, reached by a link from outside (the consent screen of Claude's connector) */
  menu?: false
  /** Parent task area; keeps page providers independent from navigation grouping. */
  area?: string
  /** Short label in the task area navigation. */
  navigationTitle?: string
}

const SECTIONS: Section[] = ['dashboard', 'data', 'settings']
export const MENU_GROUPS: MenuGroup[] = ['main', 'money', 'planning', 'settings']
export const GROUP_LABEL: Record<MenuGroup, string> = {
  main: 'routes.group.main', money: 'routes.group.money', planning: 'routes.group.planning', settings: 'routes.group.settings',
}

const Overview   = lazyWithChunks(() => import('./pages/Overview').then(m => ({ default: m.Overview })), 'records', 'planning', 'analysis')
const Assets     = lazyWithChunks(() => import('./pages/Assets').then(m => ({ default: m.Assets })), 'planning')
const AvailableMoney = lazyWithChunks(() => import('./pages/AvailableMoney').then(m => ({ default: m.AvailableMoney })), 'planning', 'records')
const MonthClose = lazy(() => import('./pages/admin/MonthCloseView').then(m => ({ default: m.MonthCloseView })))
const Accounts   = lazy(() => import('./pages/admin/AccountsView').then(m => ({ default: m.AccountsView })))
const Parameters = lazy(() => import('./pages/admin/ParametersView').then(m => ({ default: m.ParametersView })))
const Journal    = lazy(() => import('./pages/admin/JournalView').then(m => ({ default: m.JournalView })))
const Data       = lazy(() => import('./pages/settings/DataView').then(m => ({ default: m.DataView })))
const Users      = lazy(() => import('./pages/settings/UsersView').then(m => ({ default: m.UsersView })))
const SetupPage  = lazy(() => import('./pages/setup/SetupPage').then(m => ({ default: m.SetupPage })))

/** The core routes; module routes come from src/modules/<key>/client.tsx. */
export const CORE_ROUTES: RouteDef[] = [
  { section: 'dashboard', path: '/', group: 'main', bottomBar: 10,          title: 'routes.overview', icon: IconLayoutDashboard, order: 10, page: Overview, primary: CloseMonthAction },
  { section: 'dashboard', path: '/assets', group: 'money', bottomBar: 30, title: 'routes.assets', icon: IconBuildingBank,    order: 20, page: Assets },
  { section: 'dashboard', path: '/available-money', area: '/assets', menu: false, title: 'routes.availableMoney', icon: IconCoins, order: 45, page: AvailableMoney },
  { section: 'data', path: '/close', group: 'main', bottomBar: 20,    title: 'routes.close',    icon: IconCalendarCheck, order: 10, page: MonthClose, badge: 'openMonths' },
  { section: 'data', path: '/accounts', area: '/assets', menu: false, title: 'routes.accounts', icon: IconWallet,        order: 20, page: Accounts, subtitle: AccountsSubtitle },
  { section: 'settings', path: '/settings/general', group: 'settings', navigationTitle: 'ux.settingsGeneral', title: 'routes.settings', icon: IconSettings, order: 10, page: Parameters },
  { section: 'settings', path: '/settings/family', area: '/settings/general', menu: false, title: 'routes.familyAccess', icon: IconUsers, order: 15, page: Users },
  { section: 'settings', path: '/settings/history', area: '/settings/general', menu: false,    title: 'routes.history',    icon: IconHistory,        order: 30, page: Journal },
  { section: 'settings', path: '/settings/data', area: '/settings/general', menu: false, title: 'routes.data', icon: IconDatabase, order: 40, page: Data },
  { section: 'settings', path: '/setup',              title: 'routes.setup',      icon: IconWand,           order: 50, page: SetupPage, menu: false },
]

/** Pages that moved: an old bookmark opens the new address, with its hash */
/**
 * Sections of the old Net worth page that became pages of their own, and sections that moved to another page: here the
 * hash names the target. A target with its own hash is a section on the new page (the history on Assets); one without a
 * hash is a page (the hash is dropped).
 */
const MOVED_SECTION: Record<string, string> = {
  '/net-worth#availability': '/available-money',
  '/capital#availability': '/available-money',
  '/net-worth#liabilities': '/loans',
  '/capital#liabilities': '/loans',
  '/net-worth#history': '/assets#history',
  '/capital#history': '/assets#history',
  '/#history': '/assets#history',
  '/settings/modules#reminders': '/settings/reminders',
}

const MOVED: Record<string, string> = {
  '/settings': '/settings/general',
  '/settings/backup': '/settings/data',
  '/settings/parameters/backup': '/settings/data',
  '/settings/parameters/maintenance': '/settings/data',
  '/capital': '/',
  '/net-worth': '/',
  '/data/parameters': '/settings/general',
  '/data/journal': '/settings/history',
  '/data/modules': '/settings/general',
  '/settings/modules': '/settings/general',
  '/data/spending': '/cashflow/categories',
  '/data/close': '/close',
  '/data/accounts': '/accounts',
  '/data/real-estate': '/real-estate',
  '/data/loans': '/loans',
  '/data/flows': '/cashflow/categories',
  '/data/goals': '/goals/edit',
  '/settings/parameters': '/settings/general',
  '/settings/users': '/settings/family',
}

/** The menu, the router and the tab title: the core and the modules (in the demo, without those absent there), by section and order. */
export function routesFor({ demo }: { demo: boolean }): RouteDef[] {
  const all = [...CORE_ROUTES, ...clientModules({ demo }).flatMap(m => m.routes ?? [])]
  return SECTIONS.flatMap(s => all.filter(r => r.section === s).sort((a, b) => a.order - b.order))
}

/** How many places the phone's bottom bar holds, beside More. */
const BOTTOM_BAR_PLACES = 4

/** The routes of the phone's bottom bar. */
export function bottomBarRoutes(routes: RouteDef[]): RouteDef[] {
  return routes.filter(r => r.bottomBar !== undefined).sort((a, b) => a.bottomBar! - b.bottomBar!).slice(0, BOTTOM_BAR_PLACES)
}

/** The routes the menu lists: all but those marked `menu: false`. */
export function inMenu(routes: RouteDef[]): RouteDef[] {
  return routes.filter(r => r.menu !== false)
}

export function matchRoute(path: string, routes: RouteDef[]): RouteDef | null {
  return routes.find(r => r.path === path) ?? null
}

/**
 * A path without its trailing slash, at its current address if the page moved; `hash` can name a section that became a
 * page or moved to another one (the result then carries that page's hash). The root stays `/` for the section lookup.
 */
export function movedPath(path: string, hash = ''): string {
  const trimmed = path.replace(/\/+$/, '')
  return MOVED_SECTION[(trimmed || '/') + hash] ?? MOVED[trimmed] ?? trimmed
}

/**
 * Where to send an address with no page: a trailing "/", a moved page (the query and the hash stay), a section that moved
 * to another page (`/#history` → `/assets#history`), the old admin, an unknown address (also a page absent in the demo). The address may carry a `?query` and a `#hash`.
 */
export function redirectFor(address: string, routes: RouteDef[]): string | null {
  const [beforeHash, hash] = splitAt(address, '#')
  const [path, query] = splitAt(beforeHash, '?')
  const target = movedPath(path, hash)
  // a page that exists stays, unless the hash names a section that moved elsewhere
  if (matchRoute(path, routes) && target === movedPath(path)) return null
  const [targetPath, targetHash] = splitAt(target, '#')
  const hashKept = targetHash || (target === movedPath(path) ? hash : '')
  if (targetPath && matchRoute(targetPath, routes)) return targetPath + query + hashKept
  if (path === '/admin' || path.startsWith('/admin/')) return '/accounts'
  return '/'
}

/** The text before the first `mark`, and the rest starting with `mark` ('' when there is none). */
function splitAt(text: string, mark: string): [string, string] {
  const at = text.indexOf(mark)
  return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at)]
}
