import { createElement, useRef, type KeyboardEvent } from 'react'
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { THEME_MODES, useThemeMode } from '../../lib/themeState'

const ICONS = { system: IconDeviceDesktop, light: IconSun, dark: IconMoon } as const

/** System / Light / Dark for this device: a radio group of icons at the foot of the side menu, named by title and aria-label. */
export function ThemeChoice() {
  const { t } = useTranslation()
  const { mode, setMode } = useThemeMode()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  // The APG radio pattern: one Tab stop (the checked option), arrows move and select, wrapping.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (THEME_MODES.indexOf(mode) + step + THEME_MODES.length) % THEME_MODES.length
    setMode(THEME_MODES[next])
    refs.current[next]?.focus()
  }

  return (
    <div className="pills theme-choice" role="radiogroup" aria-label={t('theme.label')} onKeyDown={onKeyDown}>
      {THEME_MODES.map((m, i) => (
        <button key={m} ref={el => { refs.current[i] = el }} type="button" role="radio" aria-checked={mode === m} aria-label={t(`theme.${m}`)} title={t(`theme.${m}`)} tabIndex={mode === m ? 0 : -1} className="pills__item theme-choice__option" onClick={() => setMode(m)}>
          {createElement(ICONS[m], { size: 18, stroke: 1.75, 'aria-hidden': true })}
        </button>
      ))}
    </div>
  )
}
