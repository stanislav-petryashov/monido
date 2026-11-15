import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { IconMenu2 } from '@tabler/icons-react'
import { Trans, useTranslation } from 'react-i18next'
import { PACKAGE_URL } from '../../lib/imageRepo'
import { consumePageFocus } from '../../lib/pageFocus'
import { isDistorting } from '../../lib/snapshotSelectors'
import { useWarnings } from '../../lib/useFinanceData'
import { useVersion } from '../../lib/version'
import { DemoPill } from '../demo/DemoPill'
import { PrivacyToggle } from './PrivacyToggle'
import { WarningsMenu } from './WarningsMenu'

interface TitleRowProps {
  title: string
  /** The line under the title: the data month and the rate (`Freshness`) */
  subtitle?: ReactNode
  /** The screen's main action (`RouteDef.primary`) */
  primary?: ReactNode
  /** The dashboard's currency pills */
  actions?: ReactNode
  drawerOpen: boolean
  onMenu: () => void
  menuButtonRef: RefObject<HTMLButtonElement | null>
}

const UPDATE_COMMAND = 'docker compose pull && docker compose up -d'

/**
 * The row at the top of every page, in place of a top bar: the hamburger (shown between 641 and 1199px, where the menu
 * is a drawer), the title (`#page-title`, the focus target on navigation) with its subtitle, and at the end the demo
 * pill, the notices, the privacy eye, the screen's primary action and the currency pills. Nothing pins.
 */
export function TitleRow({ title, subtitle, primary, actions, drawerOpen, onMenu, menuButtonRef }: TitleRowProps) {
  const { t } = useTranslation()
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (titleRef.current) consumePageFocus(titleRef.current) }, [])
  const warnings = useWarnings()
  const { data: version } = useVersion()
  const notices = version?.behind && version.latest
    ? [{
        key: 'update',
        content: (
          <Trans
            i18nKey="common.updateNotice"
            values={{ version: version.latest, command: UPDATE_COMMAND }}
            components={{ pkg: <a href={PACKAGE_URL} className="link-accent" target="_blank" rel="noopener noreferrer" />, code: <code /> }}
          />
        ),
      }]
    : []
  return (
    <div className="title-row">
      <button ref={menuButtonRef} type="button" className="icon-btn title-row__menu" aria-label={t('nav.openMenu')} aria-expanded={drawerOpen} aria-controls="app-sidebar" onClick={onMenu}>
        <IconMenu2 size={22} stroke={1.75} aria-hidden="true" />
      </button>
      <h1 ref={titleRef} id="page-title" className="title-row__title" tabIndex={-1}>{title}</h1>
      <div className="title-row__tools">
        <DemoPill />
        {/* the remarks that distort the totals are the banner under the row; a short history is no remark at all */}
        <WarningsMenu warnings={(warnings.data ?? []).filter(w => !isDistorting(w) && w.code !== 'short_history')} notices={notices} />
        <PrivacyToggle />
      </div>
      {subtitle ? <p className="title-row__subtitle">{subtitle}</p> : null}
      {(primary || actions) && <div className="title-row__end">
        {primary}
        {actions}
      </div>}
    </div>
  )
}
