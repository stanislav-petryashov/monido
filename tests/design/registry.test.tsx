import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { render } from '@testing-library/react'
import ts from 'typescript'
import { ENTRIES, FOLDERS, NOT_SHOWN, REGISTRY_FILES, SHARED_CSS } from '../../design/registry'
import { DesignProviders } from '../../design/providers'
import { designClient } from '../../design/setup'
import { tokenNames } from '../../design/tokens'
import { CSS_FILES, classesOf, readCss } from '../helpers/css'
import { ROOT, readRepo, srcFiles } from '../helpers/repoFiles'
import { settled } from '../helpers/render'

vi.mock('../../src/components/charts/echarts', () => import('../helpers/echartsStub'))

/** The names a module exports: functions, constants, classes, `export default function X`, `export { x }`; not types */
function exportsOf(source: string): string[] {
  const file = ts.createSourceFile('f.tsx', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  const names: string[] = []
  for (const node of file.statements) {
    const exported = ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    if (exported && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) names.push(node.name.text)
    if (exported && ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text)
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) if (!el.isTypeOnly) names.push(el.name.text)
    }
  }
  return names
}

const shown = new Set(ENTRIES.map(e => e.name))
const covered = (name: string) => shown.has(name) || name in NOT_SHOWN
const isBlock = (name: string) => !name.includes('__') && !name.includes('--')

describe('exportsOf', () => {
  it('reads functions, constants, default functions and export lists, not types', () => {
    const source = `export function A() {}\nexport default function B() {}\nexport const c = 1\nconst d = 2\nexport { d }\nexport type E = 1\nexport interface F {}`
    expect(exportsOf(source)).toEqual(['A', 'B', 'c', 'd'])
  })
})

describe('tokenNames', () => {
  it('lists the custom properties tokens.css declares, once each', () => {
    expect(tokenNames(':root {\n  --bg: #fff;\n  --sp-1: 8px;\n}\n.dark {\n  --bg: #000;\n}\n.btn--ghost:hover { color: red }')).toEqual(['--bg', '--sp-1'])
    expect(tokenNames(readCss('src/styles/tokens.css'))).toContain('--primary')
  })
})

describe('the design registry', () => {
  it('has an entry, or a reason not to show it, for every export of its folders', () => {
    const missing = FOLDERS.flatMap(dir => srcFiles(/\.tsx?$/, join(ROOT, dir)).flatMap(f => exportsOf(readFileSync(f, 'utf8')).filter(n => !covered(n)).map(n => `${relative(ROOT, f)}: ${n}`)))
    expect(missing).toEqual([])
  })

  it('has an entry, or a reason, for every block class of the shared style files, and every CSS entry exists', () => {
    const missing = SHARED_CSS.flatMap(f => [...classesOf(f)].filter(isBlock).filter(c => !covered(`.${c}`)).map(c => `${f}: .${c}`))
    expect(missing).toEqual([])
    const defined = new Set(CSS_FILES.flatMap(f => [...classesOf(f)]))
    expect(ENTRIES.filter(e => e.kind === 'css' && !defined.has(e.name.slice(1))).map(e => e.name)).toEqual([])
  })

  it('points every duplicate at a canonical entry', () => {
    const byName = new Map(ENTRIES.map(e => [e.name, e]))
    expect(ENTRIES.filter(e => e.duplicateOf && (!byName.has(e.duplicateOf) || byName.get(e.duplicateOf)!.duplicateOf)).map(e => e.name)).toEqual([])
  })

  it('keeps each entry\'s name and use on one line, so a grep finds both', () => {
    const lines = REGISTRY_FILES.flatMap(f => readRepo(f).split('\n').map(line => ({ f, line })))
    expect(lines.filter(({ line }) => /^\s*\{ name: '/.test(line) && !/\buse: '/.test(line)).map(({ f, line }) => `${f}: ${line.trim()}`)).toEqual([])
  })

  it('is linked from the design system document', () => {
    expect(readRepo('docs/design-system.md')).toMatch(/\/design\/[\s\S]*design\/registry\.tsx|design\/registry\.tsx[\s\S]*\/design\//)
  })

  it('draws every variant of every entry with no request to the server', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const client = designClient()
    const failures: string[] = []
    for (const e of ENTRIES) for (const v of e.variants) {
      try {
        render(<DesignProviders client={client}>{v.render()}</DesignProviders>).unmount()
      } catch (err) { failures.push(`${e.name} / ${v.label}: ${String(err)}`) }
    }
    expect(failures).toEqual([])
    await settled(client)
    expect(fetch).not.toHaveBeenCalled()
  })
})
