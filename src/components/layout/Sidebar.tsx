import { createElement, useEffect, useRef } from 'react'
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconX } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Link } from '../ui/Link'
import { LogoMark } from './LogoMark'
import { SecondFloor } from './SecondFloor'
import { ThemeChoice } from './ThemeChoice'
import { UserMenu } from './UserMenu'
import { useRouteBadges } from './useRouteBadges'
import { fmtMonth, fmtNum } from '../../lib/formatters'
import { PHONE, useMedia } from '../../lib/media'
import { useAsOf } from '../../lib/useFinanceData'
import { useVersion } from '../../lib/version'
import { useSidebarCompact } from '../../lib/sidebarState'
import { GROUP_LABEL, MENU_GROUPS, inMenu, type RouteDef } from '../../routes'

interface SidebarProps {
  path: string
  /** Menu items: the core and the modules */
  routes: RouteDef[]
  open: boolean
  onClose: () => void
}

/** The logo text: the product name, the same in every language (the tab title uses the translated `app.title`). */
const PRODUCT_NAME = 'Monido'


/**
 * The side menu. Always visible above 1200px, where it can shrink to icons (compact); below that a slide-out panel (open);
 * on a phone the panel is the More sheet: the same tiles three across, Settings among them.
 */
export function Sidebar({ path, routes, open, onClose }: SidebarProps) {
  const { t } = useTranslation()
  const { data: version } = useVersion()
  // a tag or `git describe` output starts with the release; 'dev' and a bare hash do not, and stay as they are
  const shortRelease = version && /^\d+\.\d+\.\d+/.exec(version.version)
  const panelRef = useRef<HTMLElement>(null)
  const [compact, toggleCompact] = useSidebarCompact()
  const phone = useMedia(PHONE)
  const badges = useRouteBadges()
  const openMonths = useAsOf().data?.openMonths ?? []

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>('a')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const isCurrent = (r: RouteDef) => r.path === path || routes.find(candidate => candidate.path === path)?.area === r.path

  const settings = inMenu(routes).filter(r => r.group === 'settings').sort((a, b) => a.order - b.order)

  /**
   * The places as tiles: the groups only order them (main, money, planning), their labels are not shown. On a phone
   * Settings is the last tile instead of a row at the foot; the account, the version and the theme stay there.
   */
  const groupRank = (r: RouteDef) => r.group ? MENU_GROUPS.indexOf(r.group) : MENU_GROUPS.length
  const tiles = inMenu(routes)
    .filter(r => r.group !== 'settings')
    .sort((a, b) => groupRank(a) - groupRank(b) || a.order - b.order)
    .concat(phone ? settings : [])
  const settingsRows = phone ? [] : settings

  /** The line under "Close month": the one open month by name, or how many are waiting; nothing when all is closed */
  const subLine = (r: RouteDef) => {
    if (r.badge !== 'openMonths' || openMonths.length === 0) return null
    return openMonths.length === 1 ? t('nav.openMonthSub', { month: fmtMonth(openMonths[0]) }) : t('nav.openMonthsSub', { count: openMonths.length })
  }

  return (
    <>
      {open && <div className="sidebar-backdrop" data-testid="sidebar-backdrop" onClick={onClose} />}
      <aside ref={panelRef} id="app-sidebar" className={`sidebar${open ? ' sidebar--open' : ''}${compact ? ' sidebar--compact' : ''}`} aria-label={t('nav.menu')}>
        <div className="sidebar__logo">
          <LogoMark />
          <span className="sidebar__name">{PRODUCT_NAME}</span>
          <button
            type="button"
            className="sidebar__toggle"
            aria-label={t('nav.compactMenu')}
            aria-expanded={!compact}
            aria-controls="app-sidebar"
            title={t('nav.compactMenu')}
            onClick={toggleCompact}
          >
            {createElement(compact ? IconLayoutSidebarLeftExpand : IconLayoutSidebarLeftCollapse, { size: 20, stroke: 1.75, 'aria-hidden': true })}
          </button>
          {/* the phone's full-width sheet covers the backdrop and the bottom bar, so it carries its own way out */}
          {phone && (
            <button type="button" className="sidebar__close" aria-label={t('nav.closeMenu')} onClick={onClose}>
              {createElement(IconX, { size: 22, stroke: 1.75, 'aria-hidden': true })}
            </button>
          )}
        </div>
        <div className="sidebar__scroll">
          <nav aria-label={t('nav.places')} className="sidebar__tiles">
            {tiles.map(r => (
              <Link key={r.path} to={r.path} className="tile"
                aria-current={isCurrent(r) ? 'page' : undefined}
                title={compact ? t(r.title) : undefined} onClick={onClose}>
                {createElement(r.icon, { size: 20, stroke: 1.75, 'aria-hidden': true })}
                <span className="tile__label">{t(r.title)}</span>
                {/* the sr-only count below already tells a screen reader what the sub-line shows */}
                {subLine(r) && <span className="tile__sub" aria-hidden="true">{subLine(r)}</span>}
                {r.badge && badges[r.badge] > 0 && <>
                  <span className="tile__count" aria-hidden="true">{fmtNum(badges[r.badge], 0)}</span>
                  {' '}<span className="sr-only">{t(`nav.badge.${r.badge}`, { count: badges[r.badge] })}</span>
                </>}
              </Link>
            ))}
          </nav>
          <SecondFloor path={path} routes={routes} onNavigate={onClose} />
        </div>
        <div className="sidebar__foot">
          {/* who is signed in, above Settings; empty in the demo and before sign-in (UserMenu renders nothing) */}
          <div className="sidebar__account"><UserMenu /></div>
          {settingsRows.length > 0 && (
            <nav aria-label={t(GROUP_LABEL.settings)}>
              {settingsRows.map(r => (
                <Link key={r.path} to={r.path} className="sidebar__row"
                  aria-current={isCurrent(r) ? 'page' : undefined}
                  title={compact ? t(r.title) : undefined} onClick={onClose}>
                  {createElement(r.icon, { size: 18, stroke: 1.75, 'aria-hidden': true })}
                  <span className="sidebar__label">{t(r.title)}</span>
                </Link>
              ))}
            </nav>
          )}
          <div className="sidebar__meta">
            {version && <span className="sidebar__version" title={t('common.version', { value: version.version })}>{shortRelease ? t('common.versionShort', { value: shortRelease[0] }) : version.version}</span>}
            <ThemeChoice />
          </div>
        </div>
      </aside>
    </>
  )
}
