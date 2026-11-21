import { Suspense, createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import '../../styles/shell.css'
import { ErrorBoundary } from '../ErrorBoundary'
import { WarningsBanner } from '../WarningsBanner'
import { lazyWithChunks } from '../../i18n/lazyWithChunks'
import { navigate, useRoute } from '../../lib/router'
import { matchRoute, redirectFor, routesFor } from '../../routes'
import { useAuth } from '../../lib/authState'
import { requestPageFocus } from '../../lib/pageFocus'
import { PHONE, onMediaChange, useMedia } from '../../lib/media'
import { isDistorting } from '../../lib/snapshotSelectors'
import { useWarnings } from '../../lib/useFinanceData'
import { AreaNavigation } from './AreaNavigation'
import { BottomBar } from './BottomBar'
import { CurrencySwitch } from './CurrencySwitch'
import { Freshness } from './Freshness'
import { Sidebar } from './Sidebar'
import { TitleRow } from './TitleRow'
import { Loading } from '../ui/Loading'

// every Records and Settings screen is drawn inside DataPage, so their texts (the `records` locale chunk) load with it
const DataPage = lazyWithChunks(() => import('../../pages/admin/DataPage').then(m => ({ default: m.DataPage })), 'records')


/** Under the title row of a dashboard page: the remarks that distort the totals; the rest are behind the row's icon. */
function DistortingWarnings() {
  const warnings = useWarnings()
  return <WarningsBanner warnings={(warnings.data ?? []).filter(isDistorting)} />
}

/** The shell: menu + title row + the page of the current route. */
export function AppShell() {
  const { t } = useTranslation()
  const path = useRoute()
  const actionInTitle = path === '/accounts' || path === '/real-estate' || path === '/loans' || path === '/goals/edit'
  const demo = useAuth().mode === 'demo'
  const routes = useMemo(() => routesFor({ demo }), [demo])
  const route = matchRoute(path, routes)
  // the query and the hash go along: an old bookmark keeps its month, its record or its card anchor
  const redirect = redirectFor(path + window.location.search + window.location.hash, routes)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [recordActionSlot, setRecordActionSlot] = useState<HTMLDivElement | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  /** Who opened the menu and from which page: closing it hands the focus back, unless a link in it led to another page */
  const drawerOpener = useRef<{ button: HTMLButtonElement | null; path: string } | null>(null)
  const phone = useMedia(PHONE)
  const shownPath = useRef<string | null>(null)

  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true })
  }, [redirect])

  useEffect(() => {
    if (!route) return
    document.title = `${t(route.path === '/settings/general' ? 'ux.settingsGeneral' : route.title)} · ${t('app.title')}`
    // Compare with the previous path rather than a "first time" flag: StrictMode runs the effect twice.
    const previous = shownPath.current
    shownPath.current = route.path
    if (previous === null || previous === route.path) return
    window.scrollTo(0, 0)
    requestPageFocus()
  }, [route, t])

  // The slide-out panel is for narrow screens only: close it when the window widens.
  useEffect(() => onMediaChange('(min-width: 1200px)', wide => { if (wide) setDrawerOpen(false) }), [])

  const openDrawer = useCallback(() => {
    drawerOpener.current = { button: menuButtonRef.current, path }
    setDrawerOpen(true)
  }, [path])
  const openDrawerFrom = useCallback((button: HTMLButtonElement) => {
    drawerOpener.current = { button, path }
    setDrawerOpen(true)
  }, [path])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  // after the commit, not in closeDrawer: the opener sits in the page, which is inert until then and refuses the focus
  useEffect(() => {
    if (drawerOpen) return
    const opener = drawerOpener.current
    drawerOpener.current = null
    // a link in the menu: the new page takes the focus, so that it is announced
    if (!opener || opener.path !== path) return
    // the bottom bar is gone if the window grew while the menu was open
    const target = opener.button?.isConnected ? opener.button : menuButtonRef.current
    target?.focus()
  }, [drawerOpen, path])

  if (!route) return null

  // the title names the page itself (Accounts on /accounts, not its area)
  const title = t(route.path === '/settings/general' ? 'ux.settingsGeneral' : route.title)
  const areaNavigation = <AreaNavigation path={path} routes={routes} />

  return (
    <div className="shell">
      <Sidebar path={path} routes={routes} open={drawerOpen} onClose={closeDrawer} />
      {/* inert: while the panel is open, the page behind it is unreachable by keyboard and screen reader */}
      <div className="shell__main" inert={drawerOpen}>
        <main className={(path === '/settings/general' || path === '/settings/family' || path === '/settings/reminders' || path === '/settings/history' || path === '/settings/data') ? 'shell__content shell__content--general' : path === '/' ? 'shell__content shell__content--overview' : path === '/assets' ? 'shell__content shell__content--assets' : path === '/accounts' ? 'shell__content shell__content--accounts' : path === '/real-estate' ? 'shell__content shell__content--real-estate' : path === '/available-money' ? 'shell__content shell__content--available-money' : path === '/loans' ? 'shell__content shell__content--loans' : (path === '/advisor' || path === '/advisor/ask') ? 'shell__content shell__content--advisor' : path === '/health' ? 'shell__content shell__content--health' : path === '/goals/edit' ? 'shell__content shell__content--goal-records' : path === '/goals' ? 'shell__content shell__content--goals' : path === '/cashflow/categories' ? 'shell__content shell__content--categories' : path === '/cashflow' ? 'shell__content shell__content--cashflow' : 'shell__content'}>
          {/* outside the route branch, the Suspense and the boundary: the hamburger and the title are there while a page loads or fails */}
          <TitleRow
            title={title}
            subtitle={(path === '/' || path === '/close' || path === '/settings/general' || path === '/settings/family' || path === '/settings/reminders' || path === '/settings/history' || path === '/settings/data') ? undefined : route.subtitle ? createElement(route.subtitle) : <Freshness />}
            primary={actionInTitle ? <div ref={setRecordActionSlot} className="page-action-slot" /> : route.primary ? createElement(route.primary) : null}
            actions={route.section === 'dashboard' ? <CurrencySwitch /> : null}
            drawerOpen={drawerOpen}
            onMenu={openDrawer}
            menuButtonRef={menuButtonRef}
          />
          <ErrorBoundary key={path}>
            {route.section === 'dashboard' ? (
              <>
                {areaNavigation}
                <DistortingWarnings />
                <Suspense fallback={<Loading />}>
                  <div className="page-enter">{createElement(route.page)}</div>
                </Suspense>
              </>
            ) : (
              <Suspense fallback={<Loading />}>
                <DataPage screen={route.page} actionSlot={actionInTitle ? recordActionSlot : undefined}>{areaNavigation}</DataPage>
              </Suspense>
            )}
          </ErrorBoundary>
        </main>
        {phone && <BottomBar path={path} routes={routes} moreOpen={drawerOpen} onMore={openDrawerFrom} />}
      </div>
    </div>
  )
}
