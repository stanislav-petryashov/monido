import { useTranslation } from 'react-i18next'
import type { RouteDef } from '../../routes'
import { useMedia } from '../../lib/media'
import { navigate } from '../../lib/router'
import { Select } from '../../pages/admin/ui/Select'

/** The drawer width of shell.css: while the menu is a closed drawer (or the phone sheet) the area's pages are drawn under its title; wider, the always-visible menu's second floor lists them */
const DRAWER = '(max-width: 1199px)'

/** Task areas use enabled route metadata; pages retain their own providers and leave guards. */
export function AreaNavigation({ path, routes }: { path: string; routes: RouteDef[] }) {
  const { t } = useTranslation()
  const drawer = useMedia(DRAWER)
  const current = routes.find(route => route.path === path)
  const area = current?.area ?? path
  const parent = routes.find(route => route.path === area)
  const children = routes.filter(route => route.area === area).sort((a, b) => a.order - b.order)
  if (!drawer || !parent || !children.length) return null
  return <nav className="general-navigation" aria-label={t('ux.areaNavigation')}>
    <Select className="admin-select--navigation" aria-label={t('ux.areaNavigation')} value={path} onChange={e => navigate(e.target.value)}>
      {[parent, ...children].map(route => <option key={route.path} value={route.path}>{t(route.navigationTitle ?? (route === parent ? 'ux.summary' : route.title))}</option>)}
    </Select>
  </nav>
}
