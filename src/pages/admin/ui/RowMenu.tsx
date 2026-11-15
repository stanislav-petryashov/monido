import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconDots } from '@tabler/icons-react'
import { usePopover } from '../../../components/ui/usePopover'

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; describedBy?: string }

const GAP = 4

/**
 * Row actions behind "···". The menu is drawn in body above the page: a table scrolling inside
 * a card cannot clip it. Events from the portal bubble up to the wrapper,
 * so the keys are handled in one place.
 */
/** `ariaLabel` names the trigger in place of «Actions: label» */
export function RowMenu({ label, items, ariaLabel }: { label: string; items: MenuItem[]; ariaLabel?: string }) {
  const { t } = useTranslation()
  const [place, setPlace] = useState<CSSProperties | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const open = place !== null

  // the menu is tied to the button's place on the screen: if the page or the table moves, close it
  usePopover({ open, onClose: () => setPlace(null), trigger, inside: [menu, trigger], closeOnMove: true })
  useEffect(() => { if (open) menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus() }, [open])
  // the menu is as tall as its items: measured once drawn under the button (before the paint), it opens upward when it
  // does not fit below and does above
  useLayoutEffect(() => {
    if (!place || place.bottom !== undefined || !menu.current || !trigger.current) return
    const height = menu.current.getBoundingClientRect().height
    const r = trigger.current.getBoundingClientRect()
    if (r.bottom + GAP + height > window.innerHeight && r.top - GAP > height) setPlace({ position: 'fixed', right: place.right, bottom: window.innerHeight - r.top + GAP })
  }, [place])

  function toggle() {
    if (open || !trigger.current) return setPlace(null)
    const r = trigger.current.getBoundingClientRect()
    // the page width without the scrollbar: the browser measures `right` of position: fixed from it
    const right = document.documentElement.clientWidth - r.right
    setPlace({ position: 'fixed', right, top: r.bottom + GAP })
  }

  const close = () => { setPlace(null); trigger.current?.focus() }

  /** Tab closes the menu and leaves focus on the button (Escape is usePopover's); arrows, Home and End move between items. */
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!open) return
    if (e.key === 'Tab') {
      // the menu sits at the end of body: without this Tab would take focus off the page and leave the menu open
      e.preventDefault()
      return close()
    }
    const list = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const at = list.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null
    if (next === null || list.length === 0) return
    e.preventDefault()
    list[(next + list.length) % list.length].focus()
  }

  return (
    <div className="row-menu" onKeyDown={onKeyDown}>
      <button ref={trigger} type="button" className="row-menu__trigger" aria-label={ariaLabel ?? t('data.common.actionsOf', { name: label })}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>
        <IconDots size={18} stroke={2} aria-hidden="true" />
      </button>
      {place && createPortal(
        <div id={id} ref={menu} role="menu" className="floating-surface row-menu__list" style={place}>
          {items.map(item => (
            <button key={item.label} type="button" role="menuitem" tabIndex={-1} disabled={item.disabled} aria-describedby={item.describedBy}
              className={item.danger ? 'row-menu__item row-menu__item--danger' : 'row-menu__item'}
              onClick={() => { close(); item.onSelect() }}>
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
