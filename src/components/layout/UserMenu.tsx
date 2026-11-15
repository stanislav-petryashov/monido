import { IconChevronDown, IconLogout, IconUser } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { Right } from '../../domain/api'
import { logout, useAuth } from '../../lib/authState'
import { RIGHTS } from '../../lib/rights'
import { useDisclosure } from '../ui/usePopover'

function userInitials(name: string): string {
  return name.normalize('NFC').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => [...word][0]).join('').toLocaleUpperCase()
}

/**
 * Who is signed in and what they may do, then the way out. Not in the demo: it has no person and its own pill.
 */
export function UserMenu() {
  const { t } = useTranslation()
  const { mode, authenticated, me } = useAuth()
  const { open, rootRef, triggerRef, panelId, triggerProps } = useDisclosure()

  if (!authenticated || mode === 'demo' || mode === 'none') return null
  // the family password is no one in particular, and it opens everything
  const all = !me
  const has = (right: Right) => all || !!me.rights[right]
  const list = (rights: readonly (Right | 'view')[]) => rights.map(r => t(`rights.${r}`)).join(', ')
  const can = ['view' as const, ...RIGHTS.filter(has)]
  const cannot = RIGHTS.filter(r => !has(r))
  // the visible name starts the button's name (WCAG 2.5.3, label in name)
  const shownName = me?.name ?? t('nav.user.family')
  const initials = me ? userInitials(me.name ?? '') : ''
  const avatar = <span className="user-menu__avatar" aria-hidden="true">{initials || <IconUser size={18} stroke={1.75} />}</span>
  return (
    <div className="user-menu" ref={rootRef}>
      <button ref={triggerRef} type="button" className="user-menu__trigger" aria-label={t('nav.user.label', { name: shownName })} {...triggerProps}>
        {avatar}
        <span className="user-menu__name">{shownName}</span>
        <IconChevronDown size={16} stroke={1.75} aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} className="floating-surface user-menu__panel">
          <div className="user-menu__who">
            {avatar}
            <div className="user-menu__identity">
              <div className="user-menu__who-name">{shownName}</div>
              <p>{cannot.length > 0 ? t('nav.user.can', { list: list(can) }) : t('nav.user.fullAccess')}</p>
            </div>
          </div>
          {cannot.length > 0 && (
            <div className="user-menu__limits">
              <p>{t('nav.user.cannot', { list: list(cannot) })}</p>
              {cannot.includes('manage') && <p>{t('nav.user.askManager')}</p>}
            </div>
          )}
          <button type="button" className="user-menu__item" onClick={() => { void logout() }}>
            <IconLogout size={18} stroke={1.75} aria-hidden="true" />
            {t('nav.logout')}
          </button>
        </div>
      )}
    </div>
  )
}
