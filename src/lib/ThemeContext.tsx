import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ThemeContext, ThemeModeContext, applyTheme, readStoredMode, resolveMode, storeMode, systemPrefersDark, type ThemeMode,
} from './themeState'
import { onMediaChange } from './media'

/**
 * The theme: the per-device choice (System by default, which follows the device live).
 * data-theme on <html> changes in the handlers BEFORE the state updates:
 * charts read the tokens while rendering and must already see the new theme.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode)
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)
  const resolved = resolveMode(mode, prefersDark)

  useEffect(() => onMediaChange('(prefers-color-scheme: dark)', dark => {
    if (mode === 'system') applyTheme(dark ? 'dark' : 'light')
    setPrefersDark(dark)
  }), [mode])

  // A safeguard in case of a mismatch with public/theme-init.js.
  useLayoutEffect(() => { applyTheme(resolved) }, [resolved])

  const setMode = useCallback((next: ThemeMode) => {
    storeMode(next)
    applyTheme(resolveMode(next, systemPrefersDark()))
    setModeState(next)
  }, [])
  const choice = useMemo(() => ({ mode, setMode }), [mode, setMode])

  return (
    <ThemeModeContext.Provider value={choice}>
      <ThemeContext.Provider value={resolved}>{children}</ThemeContext.Provider>
    </ThemeModeContext.Provider>
  )
}
