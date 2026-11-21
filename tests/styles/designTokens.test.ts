import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { DEMO_FAMILIES } from '../../src/demo/family'
import { contrast, hexRgb as hex, luminance, readCss, rule, type Rgb } from '../helpers/css'
import { srcFiles } from '../helpers/repoFiles'

const SRC = join(__dirname, '../../src')
const files = srcFiles(/\.(ts|tsx|css)$/)
const read = (f: string) => readFileSync(f, 'utf8')
const rel = (f: string) => relative(SRC, f)
const isCss = (f: string) => f.endsWith('.css')

const TOKENS_FILE = join(SRC, 'styles/tokens.css')
/** tokens.css without its comments */
const tokensCss = readCss('src/styles/tokens.css')
/** Colors live in tokens; chartColors.ts is the bridge for canvas and writes rgba() itself. */
const COLOR_EXEMPT = new Set([TOKENS_FILE, join(SRC, 'lib/chartColors.ts')])

/** Color literals in a line: hex (3/4/6/8 digits) and color functions; in CSS, also named colors in values. */
function colorLiterals(line: string, css: boolean): string[] {
  const found = [...line.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\(/g)]
    .map(m => m[0])
  if (css) {
    for (const m of line.matchAll(/:[^;{}]*\b(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|silver)\b/gi)) found.push(m[1])
  }
  return found
}

/** Custom properties declared in CSS (`--x:`) or in TSX style objects (`'--x':`). */
function definedProps(): Set<string> {
  const defs = new Set<string>()
  for (const f of files) {
    const pattern = isCss(f) ? /(--[a-z0-9-]+)\s*:/gi : /['"](--[a-z0-9-]+)['"]\s*:/gi
    for (const m of read(f).matchAll(pattern)) defs.add(m[1])
  }
  return defs
}

const SEMANTIC = ['primary', 'secondary', 'success', 'error', 'warning', 'info'] as const
/** toneStyle builds the base color from a template for Avatar icons — the only exception. */
const TONE_FILE = join(SRC, 'components/ui/types.ts')

/**
 * `color:` (and `'color':`) with a base semantic color — a literal, a template without -text or a condition branch,
 * including one split across lines; the value runs up to `,` `;` `}`. background-/border-/accent-color do not count.
 * A color passed through a variable (`const c = 'var(--success)'` … `color: c`) is invisible to the guard.
 */
const SEMANTIC_VALUE = new RegExp(`(?<![-\\w])['"]?color['"]?:[^;,}]*var\\(--(?:${SEMANTIC.join('|')})\\)`, 'g')
const TEMPLATE_VALUE = /(?<![-\w])['"]?color['"]?:[^;,}]*`var\(--\$\{[^}]+\}\)`/g

function baseColorAsText(text: string): string[] {
  return [...text.matchAll(SEMANTIC_VALUE), ...text.matchAll(TEMPLATE_VALUE)].map(m => m[0])
}

/** Numbers of the lines where text is painted with a base color; the body of toneStyle in types.ts is skipped. */
function textColorOffenders(source: string, file: string): number[] {
  const text = file === TONE_FILE
    ? source.replace(/export function toneStyle\b[\s\S]*?\n\}/, block => block.replace(/[^\n]/g, ' '))
    : source
  const lines = [...text.matchAll(SEMANTIC_VALUE), ...text.matchAll(TEMPLATE_VALUE)]
    .map(m => text.slice(0, m.index + m[0].length).split('\n').length)
  return [...new Set(lines)].sort((a, b) => a - b)
}

/** Custom property values from the `selector { … }` block in tokens.css. */
function tokenBlock(selector: string): Record<string, string> {
  const css = tokensCss
  const start = css.indexOf(`${selector} {`)
  const body = css.slice(start, css.indexOf('\n}', start))
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map(m => [m[1], m[2].trim()]))
}

const channels = (s: string): Rgb => s.split(/\s+/).map(Number) as Rgb
const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)) as Rgb

describe('colorLiterals', () => {
  it('finds every syntax a hardcoded color can take', () => {
    expect(colorLiterals("color: '#fff8'", false)).toEqual(['#fff8'])
    expect(colorLiterals('background: hsl(0 0% 100%)', true)).toEqual(['hsl('])
    expect(colorLiterals("const c = 'oklch(0.7 0.1 250)'", false)).toEqual(['oklch('])
    expect(colorLiterals('  color: white;', true)).toEqual(['white'])
  })

  it('ignores tokens, keywords and look-alike identifiers', () => {
    expect(colorLiterals('color: var(--text-1); background: transparent; transition: color .12s;', true)).toEqual([])
    expect(colorLiterals("const label = resolveColor('--primary') // #page-title", false)).toEqual([])
  })
})

describe('baseColorAsText', () => {
  it('flags a semantic color used as text color — in CSS, style objects and templates', () => {
    expect(baseColorAsText('.x { color: var(--warning); }')).toHaveLength(1)
    expect(baseColorAsText("style={{ color: 'var(--error)' }}")).toHaveLength(1)
    expect(baseColorAsText('{ color: `var(--${color})` }')).toHaveLength(1)
  })

  it('flags a semantic color picked by a condition', () => {
    expect(baseColorAsText("color: loan.status === 'closed' ? 'var(--text-3)' : 'var(--success)',")).toHaveLength(1)
    expect(baseColorAsText("color: negative ? 'var(--error)' : 'var(--text-1)', flexShrink: 0")).toHaveLength(1)
    expect(baseColorAsText('color: up ? `var(--${tone})` : undefined')).toHaveLength(1)
  })

  it('flags a quoted color key and a condition split across lines', () => {
    expect(baseColorAsText("style={{ 'color': 'var(--error)' }}")).toHaveLength(1)
    expect(baseColorAsText("color: up\n    ? 'var(--success)'\n    : 'var(--text-1)',")).toHaveLength(1)
  })

  it('does not reach past the end of the color value', () => {
    expect(baseColorAsText("{ color: 'var(--text-1)', background: 'var(--error)' }")).toEqual([])
    expect(baseColorAsText("color: ok ? 'var(--success-text)' : 'var(--text-3)'")).toEqual([])
  })

  it('lets text tokens, backgrounds, borders and accents through', () => {
    expect(baseColorAsText('.x { color: var(--warning-text); background-color: var(--warning); border-color: var(--error); accent-color: var(--primary); }')).toEqual([])
    expect(baseColorAsText('{ color: `var(--${color}-text)` }')).toEqual([])
  })
})

describe('textColorOffenders', () => {
  it('lets only toneStyle paint with a base color — the rest of its file is checked', () => {
    const source = [
      'export function toneStyle(color: ToneColor): CSSProperties {',
      "  return { background: `var(--${color}-16)`, color: `var(--${color})` }",
      '}',
      '',
      'export function toneTextStyle(color: ToneColor): CSSProperties {',
      "  return { background: `var(--${color}-16)`, color: `var(--${color})` }",
      '}',
    ].join('\n')
    expect(textColorOffenders(source, TONE_FILE)).toEqual([6])
    expect(textColorOffenders(source, join(SRC, 'pages/Other.tsx'))).toEqual([2, 6])
  })
})

describe('design tokens', () => {
  it('semantic colors are not used as text colors — text takes --X-text', () => {
    const offenders: string[] = []
    for (const f of files) {
      for (const line of textColorOffenders(read(f), f)) offenders.push(`${rel(f)}:${line}`)
    }
    expect(offenders).toEqual([])
  })

  it('every var(--token) used in src is defined', () => {
    const defs = definedProps()
    const missing: string[] = []
    for (const f of files) {
      for (const m of read(f).matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
        if (!defs.has(m[1])) missing.push(`${rel(f)}: ${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('token names read from JS (resolveColor, readCssVar, chart palette) exist in tokens.css', () => {
    const tokens = new Set([...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(m => m[1]))
    const missing: string[] = []
    for (const f of files.filter(f => !isCss(f))) {
      for (const m of read(f).matchAll(/(?:resolveColor|readCssVar)\(\s*'(--[a-z0-9-]+)'/g)) {
        if (!tokens.has(m[1])) missing.push(`${rel(f)}: ${m[1]}`)
      }
    }
    const palette = read(join(SRC, 'components/charts/theme.ts')).match(/CHART_PALETTE_TOKENS = \[(.*?)\]/s)?.[1] ?? ''
    for (const m of palette.matchAll(/'(--[a-z0-9-]+)'/g)) {
      if (!tokens.has(m[1])) missing.push(`charts/theme.ts palette: ${m[1]}`)
    }
    expect(missing).toEqual([])
  })

  it('colors live only in tokens.css (no hex, color functions or named colors elsewhere)', () => {
    const offenders: string[] = []
    for (const f of files) {
      if (COLOR_EXEMPT.has(f)) continue
      read(f).split('\n').forEach((line, i) => {
        const found = colorLiterals(line, isCss(f))
        if (found.length) offenders.push(`${rel(f)}:${i + 1} ${found.join(' ')}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('no leftovers of the removed font and icon set', () => {
    expect(files.filter(f => /Geist Mono|@phosphor-icons/.test(read(f))).map(rel)).toEqual([])
  })
})

describe('text contrast', () => {
  const light = tokenBlock(':root')
  const themes = { light, dark: { ...light, ...tokenBlock(':root[data-theme="dark"]') } }

  it.each(Object.entries(themes))('every --X-text reads at 4.5:1 on cards, the page and its own tints (%s)', (_, t) => {
    const weak: string[] = []
    for (const name of SEMANTIC) {
      const text = hex(t[`--${name}-text`])
      const tone = channels(t[`--${name}-ch`])
      for (const surface of [hex(t['--paper']), hex(t['--bg'])]) {
        for (const bg of [surface, ...[0.08, 0.16, 0.24].map(a => over(tone, surface, a))]) {
          const ratio = contrast(text, bg)
          if (ratio < 4.5) weak.push(`--${name}-text ${ratio.toFixed(2)}`)
        }
      }
    }
    expect(weak).toEqual([])
  })

  it.each(Object.entries(themes))('OwnerAvatar ink (--text-1) reads at 4.5:1 on every member tint (%s)', (_, t) => {
    const pct = Number(tokensCss.match(/\.lane__avatar--tinted\s*\{[^}]*color-mix\(in srgb, var\(--tag\) (\d+)%/)?.[1])
    expect(pct).toBeGreaterThan(0)
    const ink = channels(t['--ink-ch'])
    const alpha = Number(t['--text-1'].match(/\/\s*([.\d]+)\)/)?.[1])
    const paper = hex(t['--paper'])
    const text = over(ink, paper, alpha)
    for (const n of [1, 2, 3, 4]) {
      const tint = over(hex(t[`--member-${n}`]), paper, pct / 100)
      expect(contrast(text, tint)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(Object.entries(themes))('each asset tone reads its own ink at 4.5:1 (%s)', (_, t) => {
    const value = (token: string): string => {
      const ref = t[token].match(/^var\((--[a-z0-9-]+)\)$/)?.[1]
      return ref ? value(ref) : t[token]
    }
    for (const tone of ['re', 're-2', 'br', 'br-2', 'br-3', 'bk', 'bk-2', 'bk-3', 'ot']) {
      expect(contrast(hex(value(`--asset-${tone}-ink`)), hex(value(`--asset-${tone}`))), tone).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(Object.entries(themes))('neighbouring member tints are at least 60° of hue apart, so two people never look alike (%s)', (_, t) => {
    /** Hue in degrees, or null for a grey (no hue to tell it by — it differs from any colour by being grey) */
    const hue = ([r, g, b]: Rgb): number | null => {
      const [R, G, B] = [r / 255, g / 255, b / 255]
      const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min
      if (d < 0.08) return null
      const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
      return (h * 60 + 360) % 360
    }
    const tints = [1, 2, 3, 4].map(n => hue(hex(t[`--member-${n}`])))
    // the tags cycle: the fifth person takes the first tint, so the last and the first are neighbours too
    for (let i = 0; i < tints.length; i++) {
      const a = tints[i], b = tints[(i + 1) % tints.length]
      if (a === null || b === null) continue
      const gap = Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
      expect(gap, `--member-${i + 1} → --member-${(i + 1) % tints.length + 1}`).toBeGreaterThanOrEqual(60)
    }
  })

  it.each(Object.entries(themes))('caption text (--text-3) reads at 4.5:1 on cards and the page (%s)', (_, t) => {
    const ink = channels(t['--ink-ch'])
    const alpha = Number(t['--text-3'].match(/\/\s*([.\d]+)\)/)?.[1])
    for (const surface of [hex(t['--paper']), hex(t['--bg'])]) {
      expect(contrast(over(ink, surface, alpha), surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(Object.entries(themes))('the ground, the tile and the raised step are three distinct luminances in the right order (%s)', (_, t) => {
    const lum = (k: string) => luminance(hex(t[k]))
    expect(lum('--bg')).toBeLessThan(lum('--paper'))
    expect(lum('--paper')).toBeLessThan(lum('--raised'))
  })

  it.each(Object.entries(themes))('menus and dialogs (--raised) keep every text readable at 4.5:1 (%s)', (_, t) => {
    const ink = channels(t['--ink-ch'])
    const raised = hex(t['--raised'])
    const alphaOf = (token: string) => Number(t[token].match(/\/\s*([.\d]+)\)/)?.[1])
    for (const token of ['--text-1', '--text-2', '--text-3']) {
      expect(contrast(over(ink, raised, alphaOf(token)), raised), token).toBeGreaterThanOrEqual(4.5)
    }
    for (const name of SEMANTIC) expect(contrast(hex(t[`--${name}-text`]), raised), name).toBeGreaterThanOrEqual(4.5)
    expect(contrast(over(ink, raised, alphaOf('--input-border')), raised)).toBeGreaterThanOrEqual(3)
  })

  it('the dark theme is a deep violet-grey, not black: ground < cards < menus, and a line stays visible on cards', () => {
    const t = themes.dark
    const lum = (token: string) => luminance(hex(t[token]))
    expect(lum('--bg')).toBeGreaterThan(luminance([14, 14, 14])) // visibly lifted from #000 / #111
    expect(contrast(hex(t['--raised']), hex(t['--paper']))).toBeGreaterThanOrEqual(1.1)
    expect(contrast(hex(t['--track']), hex(t['--paper']))).toBeGreaterThanOrEqual(1.2)
    // the primary ink is slightly off-white, not #FFF
    expect(channels(t['--ink-ch']).every(v => v < 255)).toBe(true)
  })

  describe('prefers-contrast: more', () => {
    const css = tokensCss
    const mediaStart = css.indexOf('@media (prefers-contrast: more)')
    const block = css.slice(mediaStart, css.indexOf('\n}\n', mediaStart))

    it('targets the dark theme too and comes after it', () => {
      expect(block).toMatch(/:root\[data-theme="dark"\]/)
      expect(mediaStart).toBeGreaterThan(css.indexOf(':root[data-theme="dark"] {'))
    })

    it.each(Object.entries(themes))('keeps --text-3 at 4.5:1 and --input-border at 3:1 (%s)', (_, t) => {
      const alpha = (name: string) => Number(block.match(new RegExp(`${name}:\\s*rgb\\(var\\(--ink-ch\\) / ([.\\d]+)\\)`))?.[1])
      const ink = channels(t['--ink-ch'])
      for (const surface of [hex(t['--paper']), hex(t['--bg'])]) {
        expect(contrast(over(ink, surface, alpha('--text-3')), surface)).toBeGreaterThanOrEqual(4.5)
      }
      const edge = over(ink, hex(t['--paper']), alpha('--input-border'))
      for (const surface of [hex(t['--paper']), hex(t['--bg'])]) {
        expect(contrast(edge, surface)).toBeGreaterThanOrEqual(3)
      }
    })

    it('raises the rule and the chart lines so they do not fade (--rule, --bar, --bar-soft)', () => {
      const alpha = (name: string) => Number(block.match(new RegExp(`${name}:\\s*rgb\\(var\\(--ink-ch\\) / ([.\\d]+)\\)`))?.[1])
      expect(alpha('--rule')).toBeGreaterThanOrEqual(.3)
      expect(alpha('--bar')).toBeGreaterThanOrEqual(.5)
      expect(alpha('--bar-soft')).toBeGreaterThanOrEqual(.3)
    })
  })

  it.each(Object.entries(themes))('a field edge (--input-border) stands out at 3:1 on cards and the page (%s)', (_, t) => {
    const ink = channels(t['--ink-ch'])
    const alpha = Number(t['--input-border'].match(/\/\s*([.\d]+)\)/)?.[1])
    const paper = hex(t['--paper'])
    // the field is filled with --paper, so its edge is the border over --paper, seen against a card or the page
    for (const surface of [paper, hex(t['--bg']), hex(t['--raised'])]) {
      const edge = over(ink, surface, alpha)
      expect(contrast(edge, surface)).toBeGreaterThanOrEqual(3)
    }
  })

  it.each(['--error-fill', '--error-fill-hover'])('white text on %s reads at 4.5:1', token => {
    expect(contrast(hex(light[token]), [255, 255, 255])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(Object.entries(themes))('the label on --primary reads at 4.5:1 (%s)', (_, t) => {
    expect(contrast(hex(t['--primary']), hex(t['--on-primary']))).toBeGreaterThanOrEqual(4.5)
  })

  it('white on the fills reads at 4.5:1 (--on-fill)', () => {
    expect(light['--on-fill'].toUpperCase()).toBe('#FFFFFF')
    expect(themes.dark['--on-fill'].toUpperCase()).toBe('#FFFFFF')
    for (const token of ['--error-fill', '--error-fill-hover', '--brand']) {
      expect(contrast(hex(light[token]), hex(light['--on-fill'])), token).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('color roles', () => {
  const css = (name: string) => readCss(`src/styles/${name}`)

  it('money columns are neutral: red and green are for verdicts only', () => {
    const admin = css('admin.css')
    for (const cls of ['.td-pos', '.td-neg']) {
      const rule = admin.match(new RegExp(`\\${cls}\\s*\\{[^}]*\\}`))?.[0] ?? ''
      expect(rule).not.toMatch(/--(success|error)/)
    }
    expect(css('tokens.css')).not.toMatch(/\.text-(pos|neg)\b/)
  })

  it('a member name is never painted by a hard-coded person', () => {
    for (const name of DEMO_FAMILIES['en-US'].members) {
      expect(files.filter(f => new RegExp(`=== '${name}' \\?`).test(read(f))).map(rel), name).toEqual([])
    }
  })

  it('charts have their own palette, separate from verdict colors', () => {
    const tokens = css('tokens.css')
    const values = [1, 2, 3, 4, 5, 6].map(n => tokens.match(new RegExp(`--chart-${n}:\\s*(#[0-9A-Fa-f]{6})`))?.[1])
    expect(values.every(Boolean)).toBe(true)
    // neighboring chart segments must not merge
    expect(new Set(values).size).toBe(6)
    const palette = read(join(SRC, 'components/charts/theme.ts')).match(/CHART_PALETTE_TOKENS = \[(.*?)\]/s)?.[1] ?? ''
    expect([...palette.matchAll(/'(--[a-z0-9-]+)'/g)].map(m => m[1])).toEqual([1, 2, 3, 4, 5, 6].map(n => `--chart-${n}`))
  })

  it('"Excellent" is a shade of good, not the accent', () => {
    expect(read(join(SRC, 'components/cards/StatusCard.tsx'))).toMatch(/excellent:\s*'success'/)
  })
})

describe('type scale', () => {
  const tokens = tokensCss

  it('defines the shared type scale, including task-form help and headings', () => {
    const sizes = [...tokens.matchAll(/(--fs-[a-z0-9]+)\s*:/g)].map(m => m[1])
    expect([...new Set(sizes)]).toEqual(['--fs-meta', '--fs-help', '--fs-sm', '--fs-md', '--fs-field', '--fs-section', '--fs-lg', '--fs-xl', '--fs-2xl'])
  })

  it('--fs-field is read only by the fields', () => {
    const readers = files.filter(f => read(f).includes('var(--fs-field)')).map(rel)
    expect(readers).toEqual(['styles/admin.css', 'styles/controls.css'])
  })

  it('fields are at least 16px: below that iOS zooms into a focused field', () => {
    expect(tokens).toMatch(/--fs-field:\s*1rem;/)
    expect(readCss('src/styles/controls.css')).toMatch(/\.admin-input, \.admin-select \{[^}]*font-size: var\(--fs-field\)/)
  })

  it('a field has a visible edge and a focus ring', () => {
    const admin = readCss('src/styles/controls.css')
    const rest = rule(admin, '.admin-input, .admin-select')
    expect(rest).toMatch(/border:\s*1px solid var\(--input-border\)/)
    expect(rest).toMatch(/background:\s*var\(--raised\)/)
    expect(rest).toMatch(/min-height:\s*max\(40px, 2\.5em\)/)
    const focus = rule(admin, '.admin-input:focus-visible, .admin-select:focus-visible')
    expect(focus).not.toMatch(/background:/)
    expect(focus).toMatch(/outline:\s*2px solid var\(--primary\)/)
    expect(focus).toMatch(/outline-offset:\s*-2px/)
    // the placeholder keeps sufficient contrast on the enabled field surface
    expect(rule(admin, '.admin-input::placeholder')).toMatch(/color:\s*var\(--text-2\)/)
    // an error is a ring in --error, not a red frame
    expect(rule(admin, '.admin-input[aria-invalid="true"]')).toMatch(/outline:\s*2px solid var\(--error\)/)
    expect(rule(admin, '.admin-input[aria-invalid="true"]')).toMatch(/outline-offset:\s*-2px/)
    const edge = admin.match(/@media \(prefers-contrast: more\), \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(edge).toMatch(/\.admin-input, \.admin-select\s*\{[^}]*border:\s*1px solid var\(--input-border\)/)
  })

  it('uses three weights: 400, 500 and 600', () => {
    const heavy: string[] = []
    for (const f of files) {
      read(f).split('\n').forEach((line, i) => {
        if (/font-?[wW]eight:\s*['"]?(700|800|900|bold)/.test(line)) heavy.push(`${rel(f)}:${i + 1}`)
      })
    }
    expect(heavy).toEqual([])
  })

  it('tabular figures are opt-in (.num), not global', () => {
    const body = tokens.match(/\nbody\s*\{[^}]*\}/)?.[0] ?? ''
    expect(body).not.toMatch(/tabular-nums/)
    expect(tokens).toMatch(/\.num\s*\{[^}]*tabular-nums/)
  })
})

describe('spacing, radii and shadows', () => {
  const tokens = tokensCss
  const names = (prefix: string) => [...new Set([...tokens.matchAll(new RegExp(`(--${prefix}[a-z0-9-]*)\\s*:`, 'g'))].map(m => m[1]))]

  it('the spacing scale is 4-8-12-16-24-32-48', () => {
    expect(names('sp-')).toEqual(['--sp-05', '--sp-1', '--sp-15', '--sp-2', '--sp-3', '--sp-4', '--sp-6'])
  })

  it('radii are named by what they round', () => {
    expect(names('r-')).toEqual(['--r-mark', '--r-control', '--r-tile', '--r-card', '--r-dialog', '--r-pill'])
    expect(tokens).not.toMatch(/--r\s*:/)
  })

  it('three elevations: menus, dialogs and what floats over the page', () => {
    expect(names('shadow-').filter(n => !n.includes('primary') && n !== '--shadow-ch')).toEqual(['--shadow-md', '--shadow-lg', '--shadow-float'])
  })

  it('a card has neither border nor shadow: the --paper step on the ground is its edge', () => {
    const rule = tokens.match(/\n\.card, \.form-card, \.settings-section, \.admin-panel\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/background:\s*var\(--paper\)/)
    expect(rule).not.toMatch(/border:/)
    expect(rule).not.toMatch(/box-shadow/)
    expect(tokens).not.toMatch(/--shadow-sm/)
    expect(tokens).not.toMatch(/\.card--flat/)
  })

  it('buttons are round', () => expect(tokens).toMatch(/\.btn\s*\{[^}]*border-radius: var\(--r-pill\)/))

  it('padding, margin and gap take tokens, not raw pixels', () => {
    const raw: string[] = []
    const cssDecl = /(?:^|[;{\s])(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?\s*:\s*([^;}]+)/g
    const jsDecl = /\b(padding|margin|gap|rowGap|columnGap)([A-Z][a-z]+)?:\s*(['"`][^'"`]*['"`]|\d+)/g
    for (const f of files) {
      read(f).split('\n').forEach((line, i) => {
        for (const m of line.matchAll(isCss(f) ? cssDecl : jsDecl)) {
          const value = m[3].replace(/['"`]/g, '')
          // multipliers and divisors inside calc() are not pixels
          const px = [...value.replace(/[*/]\s*[\d.]+/g, '').matchAll(/(?<![\w.-])(\d+)(px)?(?![\w%.])/g)].map(n => Number(n[1])).filter(n => n > 1)
          if (px.length) raw.push(`${rel(f)}:${i + 1} ${m[1]}: ${value.trim()}`)
        }
      })
    }
    expect(raw).toEqual([])
  })
})

describe('form controls', () => {
  /** The opening tags of <input>, <select> and <textarea>: up to the first `>` outside `{…}`, so arrow functions in props do not end the tag. */
  function controlTags(source: string): { tag: string, line: number }[] {
    const found: { tag: string, line: number }[] = []
    for (const m of source.matchAll(/<(input|select|textarea)\b/g)) {
      let depth = 0
      let end = m.index
      for (; end < source.length; end++) {
        const ch = source[end]
        if (ch === '{') depth++
        else if (ch === '}') depth--
        else if (ch === '>' && depth === 0) break
      }
      found.push({ tag: source.slice(m.index, end + 1), line: source.slice(0, m.index).split('\n').length })
    }
    return found
  }

  it('every field carries a class: the reset strips the border and background of a bare one', () => {
    const bare: string[] = []
    for (const f of files.filter(f => f.endsWith('.tsx'))) {
      for (const { tag, line } of controlTags(read(f))) {
        if (!/\bclassName=/.test(tag) && !/type="hidden"/.test(tag)) bare.push(`${rel(f)}:${line}`)
      }
    }
    expect(bare).toEqual([])
  })
})

describe('lengths', () => {
  it('calc() never divides a length by a length', () => {
    const broken: string[] = []
    for (const f of files.filter(isCss)) {
      read(f).split('\n').forEach((line, i) => { if (/calc\(.*\/\s*var\(/.test(line)) broken.push(`${rel(f)}:${i + 1}`) })
    }
    expect(broken).toEqual([])
  })
})

describe('brand violet', () => {
  it('no earlier accent is left: the retired violets and the cobalt', () => {
    const root = join(__dirname, '../..')
    const dirs = ['src', 'public', 'docs/assets']
    const hits: string[] = []
    for (const d of dirs) {
      for (const f of readdirSync(join(root, d), { recursive: true }) as string[]) {
        const full = join(root, d, f)
        let text: string
        try { text = readFileSync(full, 'utf8') } catch { continue }
        if (/6C5FEF|7367F0|4C3DEC|1D5FD6|5B8DEF/i.test(text)) hits.push(`${d}/${f}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('the brand is one violet: the logo square, the first chart series and the first member take --primary', () => {
    const light = tokensCss.match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? ''
    const value = (name: string) => light.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1]
    expect(value('--primary')).toBe('#5B4BE0')
    for (const token of ['--brand', '--chart-1', '--member-1']) expect(value(token), token).toBe(value('--primary'))
    const root = join(__dirname, '../..')
    for (const f of ['public/favicon.svg', 'docs/assets/logo.svg']) expect(readFileSync(join(root, f), 'utf8'), f).toContain('fill="#5B4BE0"')
  })

  it('every copy of the logo draws the R2 mark', () => {
    const root = join(__dirname, '../..')
    const readRoot = (f: string) => readFileSync(join(root, f), 'utf8')
    const TILE = 'M14 0 H34 C43.2 0 48 4.8 48 14 V34 C48 43.2 43.2 48 34 48 H14 C4.8 48 0 43.2 0 34 V14 C0 4.8 4.8 0 14 0 Z'
    const GLYPH = 'M13 39 V20.5 C14.5 27.5 18.5 29.5 23 29.5 C28.5 29.5 34 23 35 11.5 V39'
    const GLYPH_16 = 'M13.5 39 V21 C15 28 19 30.5 23.5 30.5 C29 30.5 34 23 34.5 12 V39'
    for (const f of ['src/components/layout/LogoMark.tsx', 'docs/assets/logo.svg', 'scripts/screenshots.ts']) {
      expect(readRoot(f), f).toContain(TILE)
      expect(readRoot(f), f).toContain(GLYPH)
    }
    expect(readRoot('public/favicon.svg')).toContain(TILE)
    expect(readRoot('public/favicon.svg')).toContain(GLYPH_16)
  })

  it('--on-primary is painted only on a --primary fill', () => {
    const offenders: string[] = []
    for (const f of files.filter(isCss)) {
      for (const m of read(f).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!m[2].includes('var(--on-primary)')) continue
        if (!/background(-color)?:\s*var\(--primary\)/.test(m[2])) offenders.push(`${rel(f)}: ${m[1].trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
