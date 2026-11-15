import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeChoice } from '../../src/components/layout/ThemeChoice'
import { ThemeProvider } from '../../src/lib/ThemeContext'
import { THEME_STORAGE_KEY } from '../../src/lib/themeState'

let stored: Map<string, string>

beforeEach(() => {
  stored = new Map<string, string>() // the global localStorage of Node 25+ does not work in jsdom
  vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => { stored.set(k, v) }, removeItem: (k: string) => { stored.delete(k) } })
})
afterEach(() => { vi.unstubAllGlobals(); delete document.documentElement.dataset.theme })

const radio = (name: string) => screen.getByRole('radio', { name })

describe('ThemeChoice', () => {
  it('offers System / Light / Dark as named icons and applies the choice to this device', () => {
    render(<ThemeProvider><ThemeChoice /></ThemeProvider>)
    const group = screen.getByRole('radiogroup', { name: 'Theme' })
    const options = within(group).getAllByRole('radio')
    expect(options.map(r => r.getAttribute('aria-label'))).toEqual(['System', 'Light', 'Dark'])
    expect(options.map(r => r.getAttribute('title'))).toEqual(['System', 'Light', 'Dark'])
    expect(options.map(r => r.textContent)).toEqual(['', '', ''])
    expect(radio('System')).toBeChecked()
    fireEvent.click(radio('Dark'))
    expect(radio('Dark')).toBeChecked()
    expect(document.documentElement.dataset.theme).toBe('dark')
    fireEvent.click(radio('Light'))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(stored.get(THEME_STORAGE_KEY)).toBe('light')
    fireEvent.click(radio('System'))
    expect(stored.has(THEME_STORAGE_KEY)).toBe(false)
  })

  it('is one Tab stop and moves with the arrows, wrapping, selecting as it goes', () => {
    render(<ThemeProvider><ThemeChoice /></ThemeProvider>)
    expect(['System', 'Light', 'Dark'].map(n => radio(n).tabIndex)).toEqual([0, -1, -1])
    radio('System').focus()
    fireEvent.keyDown(radio('System'), { key: 'ArrowRight' })
    expect(radio('Light')).toBeChecked()
    expect(radio('Light')).toHaveFocus()
    expect(['System', 'Light', 'Dark'].map(n => radio(n).tabIndex)).toEqual([-1, 0, -1])
    fireEvent.keyDown(radio('Light'), { key: 'ArrowLeft' })
    fireEvent.keyDown(radio('System'), { key: 'ArrowUp' })
    expect(radio('Dark')).toBeChecked()
    expect(radio('Dark')).toHaveFocus()
    fireEvent.keyDown(radio('Dark'), { key: 'ArrowDown' })
    expect(radio('System')).toBeChecked()
  })
})
