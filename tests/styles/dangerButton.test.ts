import { contrast, hexRgb, readCss } from '../helpers/css'

const admin = readCss('src/styles/admin.css')
const tokens = readCss('src/styles/tokens.css')

/** The token's value in the first block (light) or the dark `[data-theme="dark"]` block that defines it */
const token = (name: string, nth: number) => hexRgb([...tokens.matchAll(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`, 'g'))][nth][1])

describe('the secondary danger button (.btn--danger)', () => {
  it('beats the transparent border of .btn whichever stylesheet loads first', () => {
    // equal specificity with `.btn { border: 1px solid transparent }` (tokens.css) would be decided by load order
    expect(admin).toMatch(/^\.btn\.btn--danger:not\(:disabled\) \{[^}]*border-color: var\(--error\);/m)
  })

  it('leaves a disabled one to .btn:disabled: no danger rule styles it without excluding :disabled', () => {
    // `.btn.btn--danger` alone has the specificity of `.btn:disabled` and, loaded later, would make a disabled button look enabled
    const rules = [...admin.matchAll(/([^{}]*\.btn--danger\b[^{}]*)\{([^}]*)\}/g)]
    expect(rules.length).toBeGreaterThan(0)
    for (const [, selector, body] of rules) {
      if (!/\b(color|background|border-color)\s*:/.test(body)) continue
      for (const part of selector.split(',').filter(s => /\.btn--danger\b/.test(s))) expect(part).toMatch(/:not\(:disabled\)/)
    }
    expect(tokens).toMatch(/\.btn:disabled \{[^}]*border-color: var\(--track\);/)
  })

  it('its border reaches 3:1 against the button fill in both themes', () => {
    expect(contrast(token('error', 0), token('paper', 0))).toBeGreaterThanOrEqual(3)
    expect(contrast(token('error', 1), token('paper', 1))).toBeGreaterThanOrEqual(3)
  })
})
