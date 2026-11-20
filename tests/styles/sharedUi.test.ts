import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { CSS_FILES, readCss } from '../helpers/css'
import { ROOT, srcFiles } from '../helpers/repoFiles'

// Keep presentation in its owner. Layout selectors may refer to shared elements,
// but cannot introduce a second implementation of their appearance.
const owners = [
  { selector: /\.(?:acc-flows__key|cfband__key|cfband__swatch)(?![\w-])/, file: 'src/styles/record-charts.css', properties: /(?:^|;)\s*(?:display|gap|width|height|font-size|border-radius)\s*:/ },
  { selector: /\.(?:acc-flows__(?:label|x)|cfband__(?:tick|x|end|value)|wchart__(?:tickLabel|x|ghostLabel|chgLabel|lane|event))(?![\w-])/, file: 'src/styles/record-charts.css', properties: /(?:^|;)\s*(?:font-family)\s*:/ },
  { selector: /\.(?:form-dialog__title|prompt-dialog__title|confirm-dialog__title|form-dialog__text|confirm-dialog__text)(?![\w-])/, file: 'src/styles/ui-surfaces.css', properties: /(?:^|;)\s*(?:font-size|font-weight|line-height|color)\s*:/ },
  { selector: /\.kpi__value(?![\w-])/, file: 'src/styles/tokens.css', properties: /(?:^|;)\s*(?:font-size|font-weight|line-height)\s*:/ },
  { selector: /\.field--(?:inset|comfortable)\b/, file: 'src/styles/controls.css', properties: /(?:^|;)\s*(?:height|background|font-size|padding(?:-top|-bottom)?|color)\s*:/ },
  { selector: /\.progress-track\b/, file: 'src/styles/progress-track.css', properties: /(?:^|;)\s*(?:height|background|border-radius)\s*:/ },
  { selector: /\.chart-key\b/, file: 'src/styles/record-charts.css', properties: /(?:^|;)\s*(?:display|width|height|border-radius)\s*:/ },
  { selector: /\.record-row(?:__\w+)?\b/, file: 'src/styles/record-list.css', properties: /(?:^|;)\s*(?:grid-template-columns|grid-column|grid-row|font-size|padding|border-radius)\s*:/ },
  // the link look (merged 2026-11-20: .gl-link, .re-link, .assets-more): a link's colour and a link-styled button live in tokens.css
  { selector: /\.(?:link-accent|link-button)(?![\w-])/, file: 'src/styles/tokens.css', properties: /(?:^|;)\s*(?:color|background|border|padding|font)\s*:/ },
  { selector: /\.(?:dialog|floating-surface|form-dialog|prompt-dialog|confirm-dialog|user-menu__panel|radio-menu__list|row-menu__list)\b/, file: 'src/styles/ui-surfaces.css', properties: /(?:^|;)\s*(?:background|border-radius|box-shadow)\s*:/ },
]

describe('shared UI ownership', () => {
  /** The .tsx files that draw a native `tag` element */
  const filesWith = (tag: string) => srcFiles(/\.tsx$/).filter(file => {
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let found = false
    const visit = (node: ts.Node): void => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === tag) found = true
      ts.forEachChild(node, visit)
    }
    visit(ast)
    return found
  }).map(file => relative(ROOT, file))

  it('uses Select for native dropdowns and Dialog for native modal windows', () => {
    for (const [tag, owner] of [['select', 'src/pages/admin/ui/Select.tsx'], ['dialog', 'src/components/ui/Dialog.tsx']]) {
      expect(filesWith(tag).filter(file => file !== owner), `Use the shared ${tag} component`).toEqual([])
    }
  })

  // A ratchet: today's tables, frozen until each moves to the entry (.admin-table) or reading (.page-table) table. The
  // list only shrinks; a new <table> elsewhere fails.
  const TABLE_FILES = [
    'src/components/finance/MonthRecapTable.tsx',
    'src/components/finance/availability/FlowBar.tsx',
    'src/modules/advisor/ProposalCard.tsx',
    'src/modules/cashflow/BreakdownBlock.tsx',
    'src/modules/goals/GoalsScreen.tsx',
    'src/modules/real-estate/view/ValuationsTable.tsx',
    'src/pages/admin/ManualRates.tsx',
    'src/pages/admin/MonthCloseView.tsx',
    'src/pages/admin/accounts/MonthTable.tsx',
    'src/pages/admin/loans/EarlyPaymentsTable.tsx',
    'src/pages/admin/loans/ScheduleTable.tsx',
    'src/pages/cashflow/CapitalHistory.tsx',
    'src/pages/cashflow/IncomeCard.tsx',
    'src/pages/goals/SharesCard.tsx',
    'src/pages/settings/HistoryImport.tsx',
  ]

  it('draws a native table only in the files that already do', () => {
    expect(filesWith('table').sort()).toEqual([...TABLE_FILES].sort())
  })

  it('keeps migrated appearance rules in their shared stylesheet', () => {
    const violations: string[] = []
    for (const file of CSS_FILES) {
      for (const [, selector, body] of readCss(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        for (const owner of owners) {
          if (file !== owner.file && owner.selector.test(selector) && owner.properties.test(body)) {
            violations.push(`${file}: ${selector.trim()} (owner: ${owner.file})`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps migrated fields and progress bars on the shared components', () => {
    const table = readFileSync(`${ROOT}/src/modules/goals/GoalsScreen.tsx`, 'utf8')
    expect(table).toContain('<Field ')
    expect(table).toContain('<GoalInput ')
    expect(table).toContain('rowOf(goalFields(data), id)')
    expect(table).not.toContain('goal-edit-label')
    const allocation = readFileSync(`${ROOT}/src/components/finance/AllocationMeter.tsx`, 'utf8')
    expect(allocation).toContain('<ProgressTrack ')
    expect(allocation).not.toContain('role="progressbar"')
    const admin = readCss('src/styles/admin.css')
    expect(admin.match(/\.close-table tr\s*\{[^}]*display:\s*grid/g)).toHaveLength(1)
    const shell = readCss('src/styles/shell.css')
    // every page's action cluster follows the title on its line (order 2, before the tools); the title row has no per-page layout
    expect(shell).toMatch(/\.title-row__end\s*\{[^}]*order:\s*2/)
  })

  it('does not recolor primary buttons or neutral notices from a page ancestor', () => {
    const violations: string[] = []
    for (const file of CSS_FILES.filter(file => file !== 'src/styles/tokens.css')) {
      for (const [, selector, body] of readCss(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (/\.(?:btn--primary|notice--neutral)\b/.test(selector) && /(?:^|;)\s*(?:background|color|border-color)\s*:/.test(body)) {
          violations.push(`${file}: ${selector.trim()}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})
