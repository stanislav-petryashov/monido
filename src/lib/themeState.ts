import { createContext, useContext } from 'react'
import { mediaMatches } from './media'
import { readItem, writeItem } from './storage'

export type ResolvedTheme = 'light' | 'dark'
/** The per-device choice: System follows prefers-color-scheme live. */
export type ThemeMode = 'system' | 'light' | 'dark'

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']

/** The localStorage key; public/theme-init.js reads the same key. */
export const THEME_STORAGE_KEY = 'ff-theme'

export function readStoredMode(): ThemeMode {
  const value = readItem('local', THEME_STORAGE_KEY)
  return THEME_MODES.includes(value as ThemeMode) ? (value as ThemeMode) : 'system'
}

export function storeMode(mode: ThemeMode): void {
  writeItem('local', THEME_STORAGE_KEY, mode === 'system' ? null : mode)
}

export function resolveMode(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode
}

export function systemPrefersDark(): boolean {
  return mediaMatches('(prefers-color-scheme: dark)')
}

/**
 * Switches the tokens (tokens.css overrides the surfaces in :root[data-theme="dark"])
 * and the native color-scheme, which public/theme-init.js also sets before the CSS loads.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}

export const ThemeContext = createContext<ResolvedTheme>('light')

/** The theme in effect: the chosen one, or the device's (prefers-color-scheme, live) in System. */
export function useResolvedTheme(): ResolvedTheme { return useContext(ThemeContext) }

interface ThemeModeState { mode: ThemeMode; setMode: (mode: ThemeMode) => void }
export const ThemeModeContext = createContext<ThemeModeState>({ mode: 'system', setMode: () => {} })

/** The per-device choice (System / Light / Dark) and its setter. */
export function useThemeMode(): ThemeModeState { return useContext(ThemeModeContext) }
