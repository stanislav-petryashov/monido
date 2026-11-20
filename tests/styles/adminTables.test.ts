import { readCss, rule } from '../helpers/css'

const css = readCss('src/styles/admin.css')

/** Selectors of the rules that contain the declaration `decl`. */
function selectorsWith(decl: RegExp): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => decl.test(m[2])).map(m => m[1].trim())
}

describe('admin tables', () => {
  it('the wrapping cell class is not overridden by the nowrap rule for every cell', () => {
    // `.admin-table td` (0,1,1) sets nowrap; the wrapping rule must be at least as specific
    expect(selectorsWith(/white-space:\s*nowrap/)).toContain('.admin-table td')
    expect(selectorsWith(/white-space:\s*normal/)).toContain('.admin-table td.td-wrap')
  })

  it('a table wider than its card scrolls inside the card at any width', () => {
    // the row menu is drawn over the page, so there is nothing left to clip it with a scroll container
    expect(selectorsWith(/overflow-x:\s*auto/)).toContain('.admin-table-scroll')
  })

  it('muted and empty cells outweigh the base cell colour and padding', () => {
    expect(selectorsWith(/color:\s*var\(--text-3\)/)).toContain('.admin-table td.td-muted')
    expect(selectorsWith(/text-align:\s*center/).some(sel => sel.includes('.admin-table td.empty'))).toBe(true)
  })

  it('the early-payment mark is not painted with the accent', () => {
    expect(selectorsWith(/var\(--primary/)).not.toContain('.early-mark')
  })

  it('the detail column of a split screen may shrink below its content', () => {
    expect(selectorsWith(/min-width:\s*0/)).toContain('.admin-split > *')
  })

  it('the list and the detail panel stack on a phone', () => {
    expect(css).toMatch(/@media \(max-width: 900px\)\s*\{[^@]*\.admin-split\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/)
  })
})

describe('data section follows the v2 system', () => {
  it('sums carry no verdict colour', () => {
    expect(css).not.toMatch(/\.td-(pos|neg)/)
  })

  it('has no leftovers of the old markup', () => {
    for (const cls of ['.sidebar-item', '.admin-sidebar', '.row-dropdown', '.admin-dropdown', '.prop-info', '.admin-form-panel--accent', '.admin-section-title', '.admin-count']) {
      expect(css, cls).not.toMatch(new RegExp(`\\${cls}(?![\\w-])`))
    }
  })

  it('on a touch screen icon buttons grow to a finger-sized target', () => {
    const touch = css.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(touch).toMatch(/\.row-menu__trigger[^{]*\{[^}]*width:\s*44px;[^}]*height:\s*44px/)
    expect(touch).toMatch(/\.tag__remove[^{]*\{[^}]*width:\s*44px/)
    // the ± and the calendar inside a field: 44px touch targets, and the text keeps clear of them
    expect(touch).toMatch(/\.input-btn\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/)
    expect(touch).toMatch(/\.input-unit--signed \.admin-input, \.input-unit--picker \.admin-input\s*\{\s*padding-right:\s*calc\(var\(--sp-6\) \+ var\(--sp-1\)\)/)
  })



  it('in forced colors a text button in a hint keeps the link color', () => {
    const tokens = readCss('src/styles/tokens.css')
    const forced = tokens.slice(tokens.indexOf('@media (forced-colors: active)'))
    expect(forced.slice(0, forced.indexOf('\n}'))).toMatch(/\.link-button\s*\{\s*color:\s*LinkText/)
  })
})

describe('number fields', () => {
  it('the room on the right is kept only for a suffix that is there, not for a field with a prefix alone', () => {
    const reserving = selectorsWith(/padding-right:\s*var\(--sp-6\)/)
    expect(reserving).toContain('.input-unit:has(.input-unit__suffix) .admin-input')
    expect(reserving).not.toContain('.input-unit .admin-input')
    // the ± button and a suffix together outweigh the suffix alone (:has counts its argument)
    expect(selectorsWith(/padding-right:\s*calc\(var\(--sp-6\) \+ var\(--sp-4\)\)/)).toEqual(['.input-unit--signed:has(.input-unit__suffix) .admin-input'])
  })
})

describe('control heights', () => {
  const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))

  it('there is one button size: the 36px .btn, no smaller variant', () => {
    expect(css).not.toMatch(/\.btn--sm/)
  })

  it('a touchscreen keeps 44px everywhere, also inside tables and toolbars', () => {
    const block = coarse.slice(0, coarse.indexOf('\n}'))
    const sel = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(m => /height:\s*44px/.test(m[2]) && m[1].includes('.admin-table'))
    expect(sel?.[1]).toMatch(/\.btn(?![\w-])/)
    expect(sel?.[1]).toMatch(/\.admin-input/)
    expect(sel?.[1]).toMatch(/\.admin-select/)
  })
})

describe('spending by category', () => {
  /** The rules inside the `@media (max-width: 640px)` blocks (one level of braces: a one-line block ends at its own brace) */
  const phone = [...css.matchAll(/@media \(max-width: 640px\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].map(m => m[1]).join('\n')
  const phoneRule = (selector: string) => [...phone.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(m => m[1].split(',').map(x => x.trim()).includes(selector))?.[2] ?? ''

  it('a line of the month window is one row: category, amount, currency, remove', () => {
    const line = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(m => m[1].trim() === '.spending-line')?.[2] ?? ''
    expect(line).toMatch(/display:\s*grid/)
    expect(line).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) \S+ \S+ auto/)
  })

  it('on a phone the category takes its own row and amount and currency share the next', () => {
    expect(phoneRule('.spending-line')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\) auto/)
    expect(phoneRule('.spending-line > .field:first-child')).toMatch(/grid-column:\s*1 \/ -1/)
  })

  it('on a phone the tables stack each row instead of scrolling it out of sight', () => {
    expect(phoneRule('.spending-table thead')).toMatch(/display:\s*none/)
    expect(phoneRule('.spending-table tr')).toMatch(/display:\s*grid/)
    // as specific as the wrapping cell's 200px minimum (0,2,1), and later in the file
    expect(phoneRule('.admin-table.spending-table td')).toMatch(/min-width:\s*0/)
  })

  it('on a phone the menu spans exactly the cells of its row: four in the breakdown table, three in the categories one', () => {
    expect(phoneRule('.admin-table.spending-table td.td-actions')).toMatch(/grid-row:\s*1 \/ span 4/)
    expect(phoneRule('.admin-table.spending-table--3 td.td-actions')).toMatch(/grid-row:\s*1 \/ span 3/)
  })
})

describe('ruled tables', () => {
  const tokens = readCss('src/styles/tokens.css')
  const rules = (sheet: string) => [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }))

  it('the header is no band: no fill on a header row, except the surface colour under the one sticky header', () => {
    const filled = rules(css).filter(r => /\bthead\b/.test(r.sel) && /background/.test(r.body))
    expect(filled.map(r => r.sel)).toEqual(['.admin-table-scroll--schedule thead th'])
    // the loan schedule scrolls under its header: the header is masked with the card's own --paper, not a tint
    expect(filled[0].body).toMatch(/position:\s*sticky/)
    expect(filled[0].body).toMatch(/background:\s*var\(--paper\)/)
    expect(rule(css, '.admin-table thead th')).not.toMatch(/background|border-bottom/)
    expect(rules(tokens).filter(r => /page-table/.test(r.sel) && /background/.test(r.body))).toEqual([])
  })

  it('headers are 12px grey sentence case', () => {
    for (const body of [rule(css, '.admin-table thead th'), rule(tokens, '.page-table th')]) {
      expect(body).toMatch(/font-size:\s*var\(--fs-meta\)/)
      expect(body).toMatch(/color:\s*var\(--text-3\)/)
      expect(body).not.toMatch(/text-transform/)
    }
  })

  it('rows are split by a 1px --rule hairline, the last row by none', () => {
    expect(rule(css, '.admin-table tbody tr')).toMatch(/border-bottom:\s*1px solid var\(--rule\)/)
    expect(rule(css, '.admin-table tbody tr:last-child')).toMatch(/border-bottom:\s*0/)
    expect(rule(tokens, '.page-table td')).toMatch(/border-top:\s*1px solid var\(--rule\)/)
  })

  it('no zebra stripes', () => {
    for (const sheet of [css, tokens]) expect(sheet).not.toMatch(/tr:nth-(?:child|of-type)\((?:even|odd|2n)/)
  })

  it('numbers sit on the right in tabular figures', () => {
    expect(rule(css, '.td-num')).toMatch(/text-align:\s*right;[^}]*font-variant-numeric:\s*tabular-nums/)
    expect(rule(tokens, '.page-table .num')).toMatch(/text-align:\s*right/)
    expect(rule(tokens, '.num')).toMatch(/font-variant-numeric:\s*tabular-nums/)
  })
})
