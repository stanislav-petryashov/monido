import { createElement, useEffect, useEffectEvent, useRef, type KeyboardEvent } from 'react'
import type { TablerIcon } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useDisclosure } from './usePopover'

export interface RadioOption<T extends string> {
  value: T
  label: string
  icon?: TablerIcon
}

interface RadioMenuProps<T extends string> {
  value: T
  options: readonly RadioOption<T>[]
  onChange: (value: T) => void
  /** Accessible name of the button and of the list */
  label: string
  /** Icon of the button; by default the icon of the current option */
  triggerIcon?: TablerIcon
  /** Text of the button instead of an icon (a short code, e.g. a currency); the button's name then carries it too */
  triggerText?: string
  /** The list has just opened (lazy loading of option labels) */
  onOpen?: () => void
  /** Focus the button right after mounting: the owner is remounted by the choice itself */
  focusOnMount?: boolean
}

/** Key → index of the item to move focus to; null — not our key. */
function nextIndex(key: string, current: number, count: number): number | null {
  const last = count - 1
  if (key === 'ArrowDown') return current >= last ? 0 : current + 1
  if (key === 'ArrowUp') return current <= 0 ? last : current - 1
  if (key === 'Home') return 0
  if (key === 'End') return last
  return null
}

/** Menu of mutually exclusive options (a radio group in a popover): theme, language. */
export function RadioMenu<T extends string>({
  value, options, onChange, label, triggerIcon, triggerText, onOpen, focusOnMount = false,
}: RadioMenuProps<T>) {
  const { t } = useTranslation()
  const { open, setOpen, rootRef, triggerRef } = useDisclosure()
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Open on the current option, like a radio group; later re-renders (labels arriving) must not steal the focus back.
  const focusCurrent = useEffectEvent(() => {
    itemRefs.current[options.findIndex(o => o.value === value)]?.focus()
  })
  useEffect(() => {
    if (open) focusCurrent()
  }, [open])
  useEffect(() => {
    if (focusOnMount) triggerRef.current?.focus()
  }, [focusOnMount, triggerRef])

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = nextIndex(e.key, itemRefs.current.indexOf(document.activeElement as HTMLButtonElement), options.length)
    if (next === null) return
    e.preventDefault()
    itemRefs.current[next]?.focus()
  }

  function toggle() {
    if (!open) onOpen?.()
    setOpen(o => !o)
  }

  function choose(next: T) {
    onChange(next)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const icon = triggerIcon ?? options.find(o => o.value === value)?.icon

  return (
    <div className="radio-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerText ? 'radio-menu__text' : 'icon-btn'}
        aria-label={triggerText ? t('common.labelValue', { label, value: triggerText }) : label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        {triggerText ?? (icon && createElement(icon, { size: 20, stroke: 1.75, 'aria-hidden': true }))}
      </button>
      {open && (
        <div className="floating-surface radio-menu__list" role="menu" aria-label={label} onKeyDown={onListKeyDown}>
          {options.map((o, i) => (
            <button
              key={o.value}
              ref={el => { itemRefs.current[i] = el }}
              type="button"
              role="menuitemradio"
              aria-checked={value === o.value}
              className="radio-menu__item"
              onClick={() => choose(o.value)}
            >
              {o.icon && createElement(o.icon, { size: 18, stroke: 1.75, 'aria-hidden': true })}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
