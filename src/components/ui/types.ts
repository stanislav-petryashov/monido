import type { CSSProperties } from 'react'

/** Semantic palette colours: the --X and --X-16 tokens in tokens.css. */
export type SemanticColor = 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info'

/** A tinted background with the icon in the base colour: for Avatar (icons, not text). */
export function toneStyle(color: SemanticColor): CSSProperties {
  return { background: `var(--${color}-16)`, color: `var(--${color})` }
}

/** Like toneStyle, but the text uses the readable --X-text token: for chips and anything where text is coloured. */
export function toneTextStyle(color: SemanticColor): CSSProperties {
  return { background: `var(--${color}-16)`, color: `var(--${color}-text)` }
}
