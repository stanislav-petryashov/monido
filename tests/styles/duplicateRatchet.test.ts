import { CSS_FILES, classesIn, classesOf } from '../helpers/css'

/**
 * The ratchet against a new look-alike: a class named like a shared primitive (an empty state, a note, a KPI, a table,
 * a delta, a label, a link, a title) may live only in the owner stylesheets. Today's duplicates are FROZEN, each to be
 * merged into its canonical class by a later PR that removes it here; names that match by accident are ALLOWED, each
 * with its reason. `__label` and `__title` are not watched: dialog titles and field labels are legitimate there.
 */
const OWNERS = [
  'src/styles/tokens.css', 'src/styles/controls.css', 'src/styles/ui-surfaces.css', 'src/styles/record-list.css',
  'src/styles/progress-track.css', 'src/styles/disclosure.css', 'src/styles/record-charts.css',
]
const BLOCK_WORDS = new Set(['empty', 'note', 'kpi', 'table', 'delta', 'label', 'link', 'title'])
const ELEMENT_WORDS = new Set(['note', 'delta', 'empty', 'table', 'link'])

/** A class name's words: split on `-` and `__`, a trailing plural `s` dropped */
const segments = (name: string): string[] => name.replace(/^\./, '').split(/__|-+/).filter(Boolean).map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))

/** Whether a class is named like a shared primitive: a block by any word, an element by its own words; modifiers never */
function watched(name: string): boolean {
  if (name.includes('--')) return false
  const [block, ...elements] = name.split('__')
  if (elements.length === 0) return segments(block).some(w => BLOCK_WORDS.has(w))
  return elements.some(e => segments(e).some(w => ELEMENT_WORDS.has(w)))
}

const owned = new Set(OWNERS.flatMap(f => [...classesOf(f)]))
/** The watched classes a stylesheet defines that no owner stylesheet does (a contextual `.setup .note` is not new) */
const violationsIn = (classes: Set<string>): string[] => [...classes].filter(c => !owned.has(c) && watched(c))

const FROZEN: Record<string, string> = {
  'acc-months__note': 'note → .note',
  'allocation-meter__note': 'note → .note',
  'avail-ed__note': 'note → .note',
  'bridge__note': 'note → .note',
  'close-bar__note': 'note → .note',
  'close-note': 'note → .note',
  'contributions__note': 'note → .note',
  'gl-form__note': 'note → .note',
  'ln-eps__note': 'note → .note',
  're-form__note': 'note → .note',
  're-vals__note': 'note → .note',
  'recap__note': 'note → .note',
  'users-note': 'note → .note',
  'acc-kpi': 'KPI cell → the canonical KPI (decided in its merge PR)',
  'acc-kpis': 'KPI cell → the canonical KPI (decided in its merge PR)',
  'cf-kpi': 'KPI cell → the canonical KPI (decided in its merge PR)',
  'cf-kpis': 'KPI cell → the canonical KPI (decided in its merge PR)',
  'gl-kpi': 'KPI cell → the canonical KPI (decided in its merge PR)',
  'gl-kpis': 'KPI cell → the canonical KPI (decided in its merge PR)',
  'admin-empty': 'empty state → .empty-note or the block variant',
  'gl-empty': 'empty state → .empty-note or the block variant',
  'journal-empty': 'empty state → .empty-note or the block variant',
  'ln-empty': 'empty state → .empty-note or the block variant',
  'recap__table': 'table → .admin-table (entry) or .page-table (reading)',
  'cf-row__delta': 'delta → .delta',
  'nw__delta': 'delta → .delta',
  'close-problems__link': 'quiet underlined link: three look-alikes, no canonical yet',
  'title-row__link': 'quiet underlined link: three look-alikes, no canonical yet',
  'comb__year-link': 'quiet underlined link: three look-alikes, no canonical yet',
  'overview-section-title': 'section title → SectionLabel',
}
const ALLOWED: Record<string, string> = {
  'close-table': 'the month-close layout on .admin-table',
  'history-import__table': 'a scroll wrapper around the import table',
  'spending-table': 'the spending layout on .admin-table',
  'record-empty': 'a layout hook: hides the empty record panel beside a list',
  'ln-payment-empty': 'a layout hook: hides an empty payment cell',
  'ln-editor__note': 'only places a .note in the loan editor grid',
  're-editor__note': 'only places a .note in the property editor grid',
  'admin-table-scroll': 'the scroll wrapper of the entry table',
  'breakdown-table': 'the categories screen layout on .admin-table',
  'gl-table-wrap': 'a scroll wrapper around a table',
  'kpi': 'the canonical KPI cell, in overview.css until its merge PR',
  'kpis': 'the row of the canonical KPI cells',
  'kpi__delta': 'the delta line of the canonical KPI cell',
  'nw__deltas': 'the row that holds the net-worth deltas (layout)',
  'nw__delta-label': 'the period word beside a delta ("over the month")',
  'nw__delta-pair': 'a delta and its period word kept together (layout)',
  'ch__note': 'an annotation inside the capital history SVG, not a text note',
  'acc-heat__note': 'only places a .note in the heatmap head',
  'family-invite-link': 'the invitation address shown as text to copy',
  'financial-links': 'a row of links (layout)',
  'result__links': 'a row of links (layout)',
  'title-row': 'the shell title row',
  'wf__link': 'a holding link inside the waterfall SVG',
}

describe('segments', () => {
  it('splits a class into its words', () => {
    expect(segments('.hl__note')).toEqual(['hl', 'note'])
    expect(segments('.title-row')).toEqual(['title', 'row'])
    expect(segments('.financial-links')).toEqual(['financial', 'link'])
  })
})

describe('the duplicate ratchet', () => {
  it('catches a new look-alike block or element, not a contextual rule, a label, a title or a modifier', () => {
    expect(violationsIn(classesIn('.foo-empty {}\n.foo__note {}'))).toEqual(['foo-empty', 'foo__note'])
    expect(violationsIn(classesIn('.setup .note {}\n.x__label {}\n.x__title {}\n.x--note {}'))).toEqual([])
  })

  it('finds exactly today\'s frozen duplicates and allowed names outside the owner stylesheets', () => {
    const found = [...new Set(CSS_FILES.filter(f => !OWNERS.includes(f)).flatMap(f => violationsIn(classesOf(f))))].sort()
    expect(found).toEqual(Object.keys({ ...FROZEN, ...ALLOWED }).sort())
    expect(Object.values(ALLOWED).every(reason => reason.length > 0)).toBe(true)
    // a merge PR removes its group here and lowers this number; it never grows
    expect(Object.keys(FROZEN)).toHaveLength(30)
  })
})
