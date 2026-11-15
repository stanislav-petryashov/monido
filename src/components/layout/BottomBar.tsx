import { createElement } from 'react'
import { IconDots } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../lib/formatters'
import { bottomBarRoutes, type RouteDef } from '../../routes'
import { Link } from '../ui/Link'
import { useRouteBadges } from './useRouteBadges'

interface BottomBarProps {
  path: string
  routes: RouteDef[]
  moreOpen: boolean
  /** Opens the full menu; takes the button, so the focus can come back to it */
  onMore: (button: HTMLButtonElement) => void
}

/** The phone's menu: the most used places one tap away, and More for the full menu. */
export function BottomBar({ path, routes, moreOpen, onMore }: BottomBarProps) {
  const { t } = useTranslation()
  const badges = useRouteBadges()
  const area = routes.find(route => route.path === path)?.area
  const places = bottomBarRoutes(routes)
  const placeShown = places.some(route => route.path === path || route.path === area)
  return (
    <nav className="bottom-bar" aria-label={t('nav.bottomBar')}>
      {places.map(route => {
        const count = route.badge ? badges[route.badge] : 0
        return (
          <Link key={route.path} to={route.path} className="bottom-bar__item" aria-current={route.path === path || route.path === area ? 'page' : undefined}>
            {createElement(route.icon, { size: 22, stroke: 1.75, 'aria-hidden': true })}
            <span className="bottom-bar__label">{t(route.bottomBarTitle ?? route.title)}</span>
            {route.badge && count > 0 && <>
              <span className="bottom-bar__badge" aria-hidden="true">{fmtNum(count, 0)}</span>
              {' '}<span className="sr-only">{t(`nav.badge.${route.badge}`, { count })}</span>
            </>}
          </Link>
        )
      })}
      <button
        type="button"
        className={`bottom-bar__item${placeShown ? '' : ' bottom-bar__item--current'}`}
        aria-expanded={moreOpen}
        aria-controls="app-sidebar"
        onClick={event => onMore(event.currentTarget)}
      >
        <IconDots size={22} stroke={1.75} aria-hidden="true" />
        <span className="bottom-bar__label">{t('nav.more')}</span>
      </button>
    </nav>
  )
}
