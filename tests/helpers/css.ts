import { relative } from 'node:path'
import { readRepo, ROOT, srcFiles } from './repoFiles'

const TOKENS = 'src/styles/tokens.css'

/** Every stylesheet under src, tokens.css first (declaredTokens reads it): what the class and token guards read (deadCss.test.ts, shell.test.ts). */
export const CSS_FILES = [TOKENS, ...srcFiles(/\.css$/).map(f => relative(ROOT, f)).filter(f => f !== TOKENS).sort()]

/** The stylesheet without its comments: a guard reads only the rules, never a commented-out one. */
const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** A stylesheet by its path from the repository root (`src/styles/admin.css`), comments stripped. */
export const readCss = (path: string): string => stripCssComments(readRepo(path))

/** The body of the first rule whose selector is exactly `selector`, at the top of `css` or after another rule; throws when there is none. */
export function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')
  const m = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^{}]*)\\}`).exec(css)
  if (!m) throw new Error(`no rule ${selector}`)
  return m[1]
}

export type Rgb = [number, number, number]

/** `#RRGGBB` → [r, g, b] */
export const hexRgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb

/** WCAG relative luminance of an sRGB color */
export function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG contrast ratio of two colors, 1 to 21 */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
