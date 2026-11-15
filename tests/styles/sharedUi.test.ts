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
  { selector: /\.(?:kpi__value|cf-kpi__value)(?![\w-])/, file: 'src/styles/tokens.css', properties: /(?:^|;)\s*(?:font-size|font-weight|line-height)\s*:/ },
  { selector: /\.field--(?:inset|comfortable)\b/, file: 'src/styles/controls.css', properties: /(?:^|;)\s*(?:height|background|font-size|padding(?:-top|-bottom)?|color)\s*:/ },
  { selector: /\.progress-track\b/, file: 'src/styles/progress-track.css', properties: /(?:^|;)\s*(?:height|background|border-radius)\s*:/ },
  { selector: /\.chart-key\b/, file: 'src/styles/record-charts.css', properties: /(?:^|;)\s*(?:display|width|height|border-radius)\s*:/ },
  { selector: /\.record-row(?:__\w+)?\b/, file: 'src/styles/record-list.css', properties: /(?:^|;)\s*(?:grid-template-columns|grid-column|grid-row|font-size|padding|border-radius)\s*:/ },
  { selector: /\.(?:dialog|floating-surface|form-dialog|prompt-dialog|confirm-dialog|user-menu__panel|radio-menu__list|row-menu__list)\b/, file: 'src/styles/ui-surfaces.css', properties: /(?:^|;)\s*(?:background|border-radius|box-shadow)\s*:/ },
]

describe('shared UI ownership', () => {
  it('uses Select for native dropdowns and Dialog for native modal windows', () => {
    for (const [tag, owner] of [['select', 'src/pages/admin/ui/Select.tsx'], ['dialog', 'src/components/ui/Dialog.tsx']]) {
      const violations = srcFiles(/\.tsx$/).filter(file => {
        const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        let found = false
        const visit = (node: ts.Node): void => {
          if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === tag) found = true
          ts.forEachChild(node, visit)
        }
        visit(ast)
        return found
      })
        .map(file => relative(ROOT, file)).filter(file => file !== owner)
      expect(violations, `Use the shared ${tag} component`).toEqual([])
    }
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
    expect(shell.slice(shell.indexOf('.shell__content--real-estate .title-row,')).match(/grid-template-areas:\s*"title actions tools" "meta meta meta"/g)).toHaveLength(1)
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
