import { readCss, rule } from '../helpers/css'
import { readRepo } from '../helpers/repoFiles'

const tokens = readCss('src/styles/tokens.css')
const admin = readCss('src/styles/admin.css')
const disclosure = readCss('src/styles/disclosure.css')

describe('settings pages do not scroll sideways', () => {
  it('the panel column can shrink', () => {
    expect(rule(admin, '.settings-section__panel')).toMatch(/min-width:\s*0/)
  })
  it('family settings use wrapping rows instead of a wide table', () => {
    expect(readRepo('src/pages/settings/UsersView.tsx')).not.toContain('<table')
    expect(rule(readCss('src/pages/settings/family-settings.css'), '.family-person')).toMatch(/min-width:\s*0/)
    expect(rule(readCss('src/pages/settings/family-settings.css'), '.family-row, .family-actions')).toMatch(/flex-wrap:\s*wrap/)
  })
})

describe('surfaces lean on the tone step, not an edge', () => {
  const sheets = { admin, disclosure, tokens }
  it.each([
    ['admin', '.admin-table-wrap'], ['tokens', '.card, .form-card, .settings-section, .admin-panel'], ['admin', '.side-list'],
    ['disclosure', '.disclosure-group'],
  ] as const)('a card-like panel (%s.css %s) is --paper with no border', (sheet, selector) => {
    const r = rule(sheets[sheet], selector)
    expect(r).toMatch(/background:\s*var\(--paper\)/)
    expect(r).not.toMatch(/border:/)
  })
  it('the month-close head has no edge in any of its rules', () => {
    expect(admin).not.toMatch(/\.close-head\s*\{[^}]*border:/)
  })
  it('the edge comes back when more contrast is asked or forced colours drop the fill', () => {
    const media = /@media \(prefers-contrast: more\), \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? ''
    expect(media).toMatch(/:root :is\([^)]*\.card[^)]*\.admin-panel[^)]*\)\s*\{\s*border: 1px solid var\(--rule\)/)
  })
  it('the notice is a --paper card with no border and no coloured stripe', () => {
    const r = rule(tokens, '.notice')
    expect(r).toMatch(/background:\s*var\(--paper\)/)
    expect(r).toMatch(/border-radius:\s*var\(--r-card\)/)
    expect(r).not.toMatch(/border(-left)?:/)
  })
})

describe('buttons, chips and the segmented control are round', () => {
  it('a button is at least 36px tall', () => {
    expect(rule(tokens, '.btn')).toMatch(/min-height:\s*36px/)
  })
  it('the white button is --paper and steps up to --raised on hover', () => {
    expect(rule(tokens, '.btn--ghost')).toMatch(/background:\s*var\(--ghost-bg, var\(--paper\)\)/)
    expect(rule(tokens, '.btn--ghost:hover:not(:disabled)')).toMatch(/background:\s*var\(--raised\)/)
  })
  it('the quiet button has no fill, --text-2, and takes --paper on hover', () => {
    const r = rule(tokens, '.btn--quiet')
    expect(r).toMatch(/background:\s*transparent/)
    expect(r).toMatch(/color:\s*var\(--text-2\)/)
    expect(rule(tokens, '.btn--quiet:hover:not(:disabled)')).toMatch(/background:\s*var\(--quiet-hover, var\(--paper\)\)/)
  })
  it('the icon well is a 24px round disc', () => {
    const r = rule(tokens, '.btn__well')
    expect(r).toMatch(/width:\s*24px/)
    expect(r).toMatch(/height:\s*24px/)
    expect(r).toMatch(/border-radius:\s*var\(--r-pill\)/)
  })
  it('chips and the segmented control use the pill radius; the selected item sits on --paper', () => {
    expect(rule(tokens, '.chip')).toMatch(/border-radius:\s*var\(--r-pill\)/)
    expect(rule(tokens, '.pills')).toMatch(/border-radius:\s*var\(--r-pill\)/)
    expect(rule(tokens, '.pills')).toMatch(/background:\s*var\(--track\)/)
    expect(rule(tokens, '.pills__item')).toMatch(/border-radius:\s*var\(--r-pill\)/)
    expect(rule(tokens, '.pills__item[aria-pressed="true"],\n.pills__item[aria-checked="true"]')).toMatch(/background:\s*var\(--paper\)/)
  })
})

describe('the selected side-list item', () => {
  const shell = readCss('src/styles/shell.css')
  const setup = readCss('src/styles/setup.css')
  it('is the --primary-16 tint of the Accounts row pattern', () => {
    expect(rule(readCss('src/styles/record-list.css'), '.side-list__item.record-row[aria-current="true"]')).toMatch(/background:\s*var\(--primary-16\)/)
  })
  it('a chosen setup card is a --primary-8 tint with a --primary edge, not a full fill', () => {
    expect(rule(setup, '.setup-choice:has(:checked)')).toMatch(/background:\s*var\(--primary-8\)[^}]*border-color:\s*var\(--primary\)/)
  })
  it('the title row link is underlined in --text-3, visible on the ground', () => {
    expect(rule(shell, '.title-row__link')).toMatch(/text-decoration-color:\s*var\(--text-3\)/)
  })
})
