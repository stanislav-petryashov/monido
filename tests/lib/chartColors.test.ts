import { describe, it, expect, afterEach } from 'vitest'
import { readCssVar, readCssPx, resolveColor, toLegacyColor } from '../../src/lib/chartColors'

describe('chart text respects user text size', () => {
  afterEach(() => { document.documentElement.style.removeProperty('font-size'); document.documentElement.style.removeProperty('--fs-meta') })
  it('resolves a rem metadata role against enlarged root text', () => {
    document.documentElement.style.fontSize = '32px'
    document.documentElement.style.setProperty('--fs-meta', '.75rem')
    expect(readCssPx('--fs-meta', 12)).toBe(24)
  })
  it('retains pixel roles and falls back when CSS is absent', () => {
    document.documentElement.style.setProperty('--fs-meta', '18px')
    expect(readCssPx('--fs-meta', 12)).toBe(18)
    expect(readCssPx('--missing-size', 14)).toBe(14)
  })
})

describe('readCssVar', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--test-var')
  })

  it('returns the value of a CSS variable from :root (trimmed)', () => {
    document.documentElement.style.setProperty('--test-var', '#2F7D6B')
    expect(readCssVar('--test-var', '#000000')).toBe('#2F7D6B')
  })

  it('returns the fallback when the variable is not set', () => {
    expect(readCssVar('--missing-var', 'transparent')).toBe('transparent')
  })
})

describe('toLegacyColor', () => {
  it('converts a CSS Color 4 rgb() with alpha to rgba()', () => {
    expect(toLegacyColor('rgb(30 41 59 / .9)')).toBe('rgba(30, 41, 59, 0.9)')
    expect(toLegacyColor(' rgb(4 9 17 / 40%) ')).toBe('rgba(4, 9, 17, 0.4)')
  })
  it('rgb() without alpha is opaque', () => {
    expect(toLegacyColor('rgb(6 12 18)')).toBe('rgba(6, 12, 18, 1)')
  })
  it('hex and other values stay unchanged', () => {
    expect(toLegacyColor('#2F7D6B')).toBe('#2F7D6B')
    expect(toLegacyColor('transparent')).toBe('transparent')
  })
})

describe('resolveColor', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--test-color')
  })
  it('reads a token and returns a colour ECharts understands', () => {
    document.documentElement.style.setProperty('--test-color', 'rgb(34 139 120 / .31)')
    expect(resolveColor('--test-color')).toBe('rgba(34, 139, 120, 0.31)')
  })
  it('an unset token gives an empty string', () => {
    expect(resolveColor('--missing-color')).toBe('')
  })
})
