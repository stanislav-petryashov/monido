import { IconMoon, IconSun } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useResolvedTheme, useThemeMode } from '../../lib/themeState'

/**
 * Compact sun/moon for the setup screen, which has no side menu and a one-row header on a phone.
 * From System it goes to the opposite of the theme on screen, then Light ↔ Dark; the choice is stored for
 * this device like the side menu's System / Light / Dark (ThemeChoice), which is the way back to System.
 * The icon and the name are the theme the click gives: a moon in light, a sun in dark.
 */
export function ThemeToggle() {
  const { t } = useTranslation()
  const shown = useResolvedTheme()
  const { setMode } = useThemeMode()
  const next = shown === 'dark' ? 'light' : 'dark'
  const label = t(next === 'dark' ? 'theme.toDark' : 'theme.toLight')
  const Icon = next === 'dark' ? IconMoon : IconSun
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={() => setMode(next)}>
      <Icon size={22} stroke={1.75} aria-hidden="true" />
    </button>
  )
}
