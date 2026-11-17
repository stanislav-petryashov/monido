import { mediaMatches } from './media'

/**
 * The bridge between CSS tokens and the ECharts charts. ECharts understands neither var(...) nor the
 * CSS Color 4 notation `rgb(r g b / a)`, so a token's value is read from :root
 * and converted to `rgba(r, g, b, a)`.
 */

/** Reads a CSS variable from :root; the fallback if it is not applied. */
export function readCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Canvas uses pixels; the shared text roles use rem so user text preferences still apply. */
export function readCssPx(name: string, fallback: number): number {
  const value = readCssVar(name, '')
  const size = parseFloat(value)
  if (!Number.isFinite(size)) return fallback
  const root = typeof document === 'undefined' ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  return value.endsWith('rem') ? size * root : size
}

/** `rgb(27 29 31 / .96)` → `rgba(27, 29, 31, 0.96)`; hex and anything else stay unchanged. */
export function toLegacyColor(value: string): string {
  const v = value.trim()
  const m = v.match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/)
  if (!m) return v
  const [, r, g, b, a] = m
  const alpha = a === undefined ? 1 : a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : Number(a)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** A token's colour in the format for ECharts; '' if the token is not set. */
export function resolveColor(token: string): string {
  return toLegacyColor(readCssVar(token, ''))
}

/**
 * true if chart animation may play. ECharts draws by itself,
 * so CSS `@media (prefers-reduced-motion)` does not cover it: gated by hand.
 */
export function chartAnimationEnabled(): boolean {
  return !mediaMatches('(prefers-reduced-motion: reduce)')
}
