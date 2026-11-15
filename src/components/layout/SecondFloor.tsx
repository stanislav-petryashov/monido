import { createElement, type ReactNode } from 'react'
import { IconCalendarCheck } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Link } from '../ui/Link'
import { useDashboard } from '../../lib/dashboardState'
import { fmtMonth } from '../../lib/formatters'
import { useSnapshot } from '../../lib/useFinanceData'
import { useClientModules, type ClientModule, type TodoItem } from '../../modules/client'
import type { ModuleKey } from '../../modules/types'
import type { RouteDef } from '../../routes'

interface SecondFloorProps {
  path: string
  /** Menu items: the core and the modules */
  routes: RouteDef[]
  /** Called when a row is chosen: the drawer and the phone sheet close, as they do for a tile */
  onNavigate?: () => void
}

/** A row of the floor: icon and label; the current page is marked */
function Row({ to, icon, label, current, onNavigate }: Pick<TodoItem, 'to' | 'icon' | 'label'> & { current: boolean; onNavigate?: () => void }) {
  return (
    <Link to={to} className="sidebar__row" aria-current={current ? 'page' : undefined} title={label} onClick={onNavigate}>
      {createElement(icon, { size: 18, stroke: 1.75, 'aria-hidden': true })}
      <span className="sidebar__label">{label}</span>
    </Link>
  )
}

/**
 * The rows the modules read from the server, gathered in module order: one child component per module, so each one calls
 * exactly one hook, whatever the modules do (the hooks rule: a component's hook count never varies).
 */
function HookedTodos({ modules, collected, children }: { modules: ClientModule[]; collected: Partial<Record<ModuleKey, TodoItem[]>>; children: (rows: Partial<Record<ModuleKey, TodoItem[]>>) => ReactNode }) {
  if (modules.length === 0) return children(collected)
  const [m, ...rest] = modules
  return <HookedTodo key={m.key} module={m}>{items => <HookedTodos modules={rest} collected={{ ...collected, [m.key]: items }}>{children}</HookedTodos>}</HookedTodo>
}

function HookedTodo({ module, children }: { module: ClientModule; children: (items: TodoItem[]) => ReactNode }) {
  return children(module.overview!.todoHook!())
}

/** Under "To do": one row per open month (the core), then every module's rows in module order; nothing at all when there is nothing to do */
function TodoFloor({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  const { t } = useTranslation()
  const { fmt } = useDashboard()
  const snapshot = useSnapshot().data
  const all = useClientModules()
  const modules = snapshot ? all : []
  const core: TodoItem[] = (snapshot?.asOf.openMonths ?? []).map(month => ({ key: `close-${month}`, to: '/close', icon: IconCalendarCheck, label: t('nav.todoClose', { month: fmtMonth(month) }) }))
  const hooked = modules.filter(m => m.overview?.todoHook)
  return (
    <HookedTodos modules={hooked} collected={{}}>
      {fromHooks => {
        const items = [...core, ...modules.flatMap(m => [...(m.overview?.todo?.(snapshot!, t, fmt) ?? []), ...(fromHooks[m.key] ?? [])])]
        if (items.length === 0) return null
        return (
          <nav className="sidebar__floor" aria-label={t('nav.todoTitle')}>
            <p className="sidebar__floor-title" aria-hidden="true">{t('nav.todoTitle')}</p>
            {items.map(item => <Row key={item.key} to={item.to} icon={item.icon} label={item.label} current={path === item.to} onNavigate={onNavigate} />)}
          </nav>
        )
      }}
    </HookedTodos>
  )
}

/**
 * The menu's second floor, under the tiles: on Overview what needs doing (`TodoFloor`); elsewhere the pages of the current
 * area, the parent first ("Summary"), the current one marked; an area without sub-pages adds no empty placeholder.
 */
export function SecondFloor({ path, routes, onNavigate }: SecondFloorProps) {
  const { t } = useTranslation()
  const current = routes.find(route => route.path === path)
  const area = current?.area ?? path
  if (area === '/') return <TodoFloor path={path} onNavigate={onNavigate} />
  const parent = routes.find(route => route.path === area)
  const children = routes.filter(route => route.area === area).sort((a, b) => a.order - b.order)
  if (!parent || children.length === 0) return null
  const settings = parent.section === 'settings'
  const label = t(settings ? 'routes.settings' : parent.title)
  return (
    <nav className="sidebar__floor sidebar__floor--area" aria-label={label}>
      <p className="sidebar__floor-title" aria-hidden="true">{label}</p>
      {[parent, ...children].map(route => (
        <Row key={route.path} to={route.path} icon={route.icon} current={path === route.path} onNavigate={onNavigate}
          label={t(route.navigationTitle ?? (route === parent ? 'ux.summary' : route.title))} />
      ))}
    </nav>
  )
}
