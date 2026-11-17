import { CSS_FILES, readCss, rule } from '../helpers/css'
import { readRepo } from '../helpers/repoFiles'

const shell = readCss('src/styles/shell.css')
const tokens = readCss('src/styles/tokens.css')

describe('touch targets', () => {
  it('the desktop compact-menu toggle is also 44px for a coarse pointer', () => {
    const coarseShell = shell.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const toggle = rule(coarseShell, '.sidebar__toggle')
    expect(toggle).toMatch(/min-width:\s*44px/)
    expect(toggle).toMatch(/min-height:\s*44px/)
  })
  const coarse = [...tokens.matchAll(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n')

  it('a button is 44px on a touchscreen', () => {
    expect(coarse).toMatch(/(^|[\s,}])\.btn\s*\{[^}]*height:\s*44px/)
  })

  it('the «How it is calculated» button is 44px on a touchscreen and does not make the title row taller', () => {
    const btn = coarse.match(/(?:^|[\s,}])\.explain__btn\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(btn).toMatch(/width:\s*44px/)
    expect(btn).toMatch(/height:\s*44px/)
    // 6px on every side taken back from the spacing scale: the 32px box keeps its place in the row
    expect(btn).toMatch(/margin:\s*calc\(var\(--sp-15\) \/ -2\)/)
  })
})

describe('chrome styles are neutral', () => {
  it('the current tile and the current row are a --primary fill with --on-primary text, with no shadow', () => {
    for (const selector of ['.sidebar__row[aria-current="page"]', '.tile[aria-current="page"]']) {
      const r = rule(shell, selector)
      expect(r).toMatch(/background:\s*var\(--primary\)/)
      expect(r).toMatch(/color:\s*var\(--on-primary\)/)
      expect(r).not.toMatch(/box-shadow/)
    }
    // the old menu row is gone with its paper step
    expect(shell).not.toContain('.sidebar__item')
  })
  it('the metric card link is its own rule, not a selector left dangling before the next one', () => {
    const r = rule(tokens, '.status__link')
    expect(r).toMatch(/align-self:\s*flex-start/)
    expect(r).toMatch(/font-size:\s*var\(--fs-sm\)/)
  })
  it('a disabled button is a flat --track, not a faded fill, so its label keeps its contrast', () => {
    const d = rule(tokens, '.btn:disabled')
    expect(d).not.toMatch(/opacity/)
    expect(d).toMatch(/background:\s*var\(--track\)/)
  })
})

describe('the title row wraps on a phone instead of truncating', () => {
  const phone = /@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/g
  const phoneCss = [...shell.matchAll(phone)].map(m => m[1]).join('\n')
  it('the phone overrides come after the base rules, so they win', () => {
    const base = (sel: string) => shell.search(new RegExp(`(?:^|\\})\\s*${sel.replace(/[.]/g, '\\.')}\\s*\\{`))
    for (const sel of ['.title-row__end']) {
      const baseAt = base(sel)
      const overrideAt = [...shell.matchAll(new RegExp(`\\n  ${sel.replace(/[.]/g, '\\.')}\\s*\\{`, 'g'))].map(m => m.index)
      expect(baseAt).toBeGreaterThan(-1)
      expect(overrideAt.length).toBeGreaterThan(0)
      for (const at of overrideAt) expect(at).toBeGreaterThan(baseAt)
    }
    // the base row wraps by its content: the clusters go to the next line instead of shrinking the title
    expect(rule(shell, '.title-row')).toMatch(/display:\s*flex/)
    expect(rule(shell, '.title-row')).toMatch(/flex-wrap:\s*wrap/)
    expect(rule(shell, '.title-row__end')).toMatch(/flex-wrap:\s*wrap/)
    expect(rule(shell, '.title-row__tools')).toMatch(/margin-left:\s*auto/)
    // on a phone the action cluster drops under the data line
    expect(phoneCss).toMatch(/\.title-row__end\s*\{[^}]*flex-basis:\s*100%/)
  })
  it('the title is never squeezed to a letter a line (the 2026-11-17 bug: a grid column of minmax(0, 1fr) beside the demo pill)', () => {
    // anywhere lowers the title's min-content to one letter; break-word breaks only a word longer than the line
    expect(rule(shell, '.title-row__title')).not.toMatch(/overflow-wrap:\s*anywhere/)
    // no stylesheet lays the row out as a grid or per page: one content-driven rule for every page
    for (const css of [shell, ...Object.values(import.meta.glob('../../src/styles/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)]) {
      expect(css).not.toMatch(/\.title-row[^{]*\{[^}]*grid-template/)
      expect(css).not.toMatch(/\.shell__content--[\w-]+ \.title-row/)
    }
  })
  it('the hamburger shows only between the phone (bottom bar) and the wide screen (sidebar)', () => {
    expect(rule(shell, '.title-row__menu')).toMatch(/display:\s*none/)
    const drawer = shell.match(/@media \(max-width: 1199px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(drawer).toMatch(/\.title-row__menu\s*\{[^}]*display:\s*inline-flex/)
    expect(phoneCss).toMatch(/\.title-row__menu\s*\{[^}]*display:\s*none/)
  })
  it('nothing of the top bar or the old page header is left, and the sheet is the ground', () => {
    expect(shell).not.toMatch(/\.navbar|\.page-header/)
    expect(rule(shell, '.shell__main')).not.toMatch(/border|background/)
  })
})

describe('the account at the sidebar foot', () => {
  it('its menu opens upward, so it stays on screen', () => {
    const panel = rule(shell, '.sidebar__account .user-menu__panel')
    expect(panel).toMatch(/bottom:\s*100%/)
    expect(panel).toMatch(/top:\s*auto/)
  })
})

describe('windows float', () => {
  const admin = readCss('src/styles/admin.css')
  const surfaces = readCss('src/styles/ui-surfaces.css')
  const sheets = { tokens, shell, admin, surfaces }
  it.each([
    ['surfaces', '.dialog'], ['surfaces', '.floating-surface'], ['tokens', '.explain__panel'],
    ['shell', '.warnings-list'], ['shell', '.demo-panel'],
    ['admin', '.currency-combo__list'],
  ] as const)('every window floats on --raised with --shadow-float and no border (%s.css %s)', (sheet, selector) => {
    const r = rule(sheets[sheet], selector)
    expect(r).toMatch(/background:\s*var\(--raised\)/)
    expect(r).toMatch(/box-shadow:\s*var\(--shadow-float\)/)
    expect(r).toMatch(/(?:^|[;\s])border:\s*0/)
    expect(r).toMatch(/border-radius:\s*var\(--r-(card|dialog)\)/)
  })
  it('no shared edge is left on the dialogs, and a dialog is as round as a card', () => {
    expect(tokens).not.toMatch(/\.form-dialog, \.confirm-dialog, \.prompt-dialog\s*\{[^}]*border:\s*1px/)
    const radius = (name: string) => tokens.match(new RegExp(`${name}:\\s*(\\d+)px`))?.[1]
    expect(radius('--r-dialog')).toBe(radius('--r-card'))
  })
  it('the edge comes back where forced colours drop the shadow', () => {
    const media = /@media \(prefers-contrast: more\), \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? ''
    expect(media).toMatch(/\.form-dialog/)
    expect(media).toMatch(/\.user-menu__panel/)
    expect(media).toMatch(/\.toast\b/)
  })
  it('the toast is ink with no border and a violet dot', () => {
    const toast = rule(tokens, '.toast')
    expect(toast).toMatch(/background:\s*var\(--tooltip-bg\)/)
    expect(toast).toMatch(/color:\s*var\(--tooltip-text\)/)
    expect(toast).toMatch(/box-shadow:\s*var\(--shadow-float\)/)
    expect(toast).not.toMatch(/border:\s*1px/)
    expect(rule(tokens, '.toast__dot')).toMatch(/background:\s*var\(--primary\)/)
    expect(readRepo('src/components/ui/Toaster.tsx')).toMatch(/toast__dot/)
    // nothing inside the ink is painted with the page's text colours, which would vanish on it
    for (const sel of ['.toast__title', '.toast__text', '.toast__close']) expect(rule(tokens, sel)).not.toMatch(/--text-/)
    expect(rule(tokens, '.toast__close:hover')).not.toMatch(/--text-|--hover/)
  })
  it('the month-close bar floats at the foot of the page: sticky, --raised with --shadow-float, no edge; the old foot is gone', () => {
    const bar = rule(admin, '.close-bar')
    expect(bar).toMatch(/position:\s*sticky/)
    expect(bar).toMatch(/bottom:\s*var\(--sp-2\)/)
    expect(bar).toMatch(/background:\s*var\(--raised\)/)
    expect(bar).toMatch(/box-shadow:\s*var\(--shadow-float\)/)
    expect(bar).toMatch(/border-radius:\s*var\(--r-card\)/)
    expect(bar).not.toMatch(/border:\s*1px/)
    expect(admin).not.toMatch(/\.close-foot\s*\{/)
    // on a phone it rides above the menu bar
    expect(admin).toMatch(/\.close-view \.close-bar\s*\{[^}]*bottom:\s*calc\(var\(--bottom-bar-height\) \+ var\(--sp-1\)\)/)
  })
  it('the warning alert is the warning ground with the warning ink', () => {
    const r = rule(tokens, '.alert--warning')
    expect(r).toMatch(/background:\s*var\(--warning-16\)/)
    expect(r).toMatch(/color:\s*var\(--warning-text\)/)
  })

  it('the empty state is a dashed --bar-soft frame', () => {
    const r = rule(tokens, '.empty-note')
    expect(r).toMatch(/border:\s*1px dashed var\(--bar-soft\)/)
    expect(r).toMatch(/border-radius:\s*var\(--r-tile\)/)
    expect(r).toMatch(/text-align:\s*center/)
  })
})

describe('header actions', () => {
  it('the slot of a Data screen keeps its actions in one wrapping row, also on a phone', () => {
    expect(shell).toMatch(/\.page-action-slot\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap/)
  })
})

describe('the phone sheet and the bottom bar', () => {
  const phoneCss = [...shell.matchAll(/@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n')
  it('the More sheet shows the tiles three across', () => {
    expect(phoneCss).toMatch(/\.sidebar__tiles\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/)
  })
  it('the More sheet takes the full width, so three tiles do not share the 248px drawer', () => {
    const sheet = rule(phoneCss, '.sidebar')
    expect(sheet).toMatch(/(?:^|[;\s])width:\s*100%/)
    expect(sheet).toMatch(/--sidebar-w:\s*100%/)
  })
  it('a to-do row wraps its label to two lines instead of an ellipsis, with the icon on the first line', () => {
    expect(rule(shell, '.sidebar__row')).toMatch(/align-items:\s*flex-start/)
    const label = rule(shell, '.sidebar__label')
    expect(label).toMatch(/white-space:\s*normal/)
    expect(label).toMatch(/overflow-wrap:\s*anywhere/)
    expect(label).not.toMatch(/text-overflow:\s*ellipsis/)
  })
  it('the bottom bar is a --paper strip with no border; the current item is --primary-text at 500', () => {
    const bar = phoneCss.match(/\.bottom-bar\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(bar).toMatch(/background:\s*var\(--paper\)/)
    expect(bar).not.toMatch(/border/)
    expect(bar).not.toMatch(/border-top:\s*1px/)
    const current = phoneCss.match(/\.bottom-bar__item\[aria-current="page"\], \.bottom-bar__item--current\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(current).toMatch(/color:\s*var\(--primary-text\)/)
    expect(current).toMatch(/font-weight:\s*500/)
  })
  it('the demo panel and the notices hang from the title row, not from a top computed for the old bar', () => {
    expect(rule(shell, '.title-row')).toMatch(/position:\s*relative/)
    // the demo panel at every width: under the row, at its right end above the phone, across it on a phone
    const demoPanel = rule(shell, '.demo-panel')
    expect(demoPanel).toMatch(/position:\s*absolute/)
    expect(demoPanel).toMatch(/top:\s*calc\(100% \+ var\(--sp-1\)\)/)
    expect(rule(shell, '.demo-menu')).toMatch(/position:\s*static/)
    // the notices keep hanging from their button above the phone; on a phone the list spans the row
    expect(rule(shell, '.warnings-list')).toMatch(/position:\s*absolute/)
    expect(phoneCss).toMatch(/\.warnings\s*\{[^}]*position:\s*static/)
    expect(phoneCss).toMatch(/\.warnings-list\s*\{[^}]*position:\s*absolute/)
    // nothing of either is fixed to the window at a height taken from the navbar
    for (const block of shell.match(/\.(?:demo-panel|warnings-list)\s*\{[^}]*\}/g) ?? []) {
      expect(block).not.toMatch(/position:\s*fixed/)
      expect(block).not.toMatch(/var\(--sp-6\)/)
    }
  })
})

describe('compact side menu', () => {
  const wide = shell.match(/@media \(min-width: 1200px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  it('the compact rules and the toggle live only on a wide screen, so a saved choice never shrinks the phone drawer', () => {
    expect(wide).toMatch(/\.sidebar--compact\s*\{[^}]*--sidebar-w:\s*calc\(72px \+ env\(safe-area-inset-left, 0px\) \+ env\(safe-area-inset-right, 0px\)\)/)
    expect(wide).toMatch(/\.sidebar__toggle\s*\{[^}]*display:\s*inline-flex/)
    expect(shell.replace(wide, '')).not.toContain('.sidebar--compact')
    expect(rule(shell, '.sidebar__toggle')).toMatch(/display:\s*none/)
  })
})

describe('selector lists', () => {
  // a rule removed from the middle of a list leaves its selector glued onto the next rule (as once .close-foot__title onto .close-bar)
  it('no selector list is broken by a removed rule: no trailing comma before a comment or a blank line', () => {
    const broken: string[] = []
    for (const file of CSS_FILES) {
      const text = readRepo(file)
      for (const m of text.matchAll(/,[ \t]*\n\s*\/\*|,[ \t]*\n[ \t]*\n/g)) broken.push(`${file}:${text.slice(0, m.index).split('\n').length}`)
    }
    expect(broken).toEqual([])
  })
})
