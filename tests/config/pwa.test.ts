import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT } from '../helpers/repoFiles'

const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')
const html = read('index.html')
const manifestFile = join(ROOT, 'public', 'manifest.webmanifest')

/** A token's value in a theme block of tokens.css: the light block (:root) or the dark one (:root[data-theme="dark"]). */
function token(name: string, dark = false): string {
  const css = read('src/styles/tokens.css')
  const start = dark ? css.indexOf(':root[data-theme="dark"]') : css.indexOf(':root')
  const m = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css.slice(start))
  if (!m) throw new Error(`${name} not found`)
  return m[1].toUpperCase()
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file)
  expect(b.subarray(1, 4).toString()).toBe('PNG')
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

describe('install as an app (PWA)', () => {
  it('index.html links the manifest, the iOS icon and the browser colours of both themes', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Monido" />')
    expect(html).toContain(`<meta name="theme-color" content="${token('--bg')}" media="(prefers-color-scheme: light)" />`)
    expect(html).toContain(`<meta name="theme-color" content="${token('--bg', true)}" media="(prefers-color-scheme: dark)" />`)
  })

  it('the manifest opens Monido standalone at the root, in the ground colour of the light theme', () => {
    const m = JSON.parse(readFileSync(manifestFile, 'utf8'))
    expect(m).toMatchObject({ name: 'Monido', short_name: 'Monido', start_url: '/', scope: '/', display: 'standalone' })
    expect(m.background_color.toUpperCase()).toBe(token('--bg'))
    expect(m.theme_color.toUpperCase()).toBe(token('--bg'))
  })

  it('every icon exists at its declared size, and one is maskable', () => {
    const m = JSON.parse(readFileSync(manifestFile, 'utf8')) as { icons: { src: string; sizes: string; type: string; purpose?: string }[] }
    for (const icon of m.icons) {
      const file = join(ROOT, 'public', icon.src)
      expect(existsSync(file), icon.src).toBe(true)
      expect(icon.type).toBe('image/png')
      expect(pngSize(file).join('x')).toBe(icon.sizes)
    }
    expect(m.icons.map(i => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(m.icons.some(i => i.purpose === 'maskable')).toBe(true)
    expect(pngSize(join(ROOT, 'public', 'apple-touch-icon.png'))).toEqual([180, 180])
  })
})
