import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { CSS_FILES, readCss, selectorsOnly } from '../helpers/css'
import { readRepo, srcFiles } from '../helpers/repoFiles'

/**
 * The string literals of a TS/TSX source — plain, JSX attribute and template ones — where a class or a token can be
 * named: comments and identifiers do not count. A template keeps its literal parts around an empty `${}`, so
 * `insight--${severity}` reads as `insight--${}`; a literal concatenated with `+` gets a `${}` after it, like a template.
 */
function stringLiterals(source: string, tsx: boolean): string[] {
  const found: string[] = []
  const file = ts.createSourceFile(tsx ? 'f.tsx' : 'f.ts', source, ts.ScriptTarget.Latest, false, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node)) {
      found.push(node.head.text + node.templateSpans.map(span => '${}' + span.literal.text).join(''))
      node.templateSpans.forEach(span => visit(span.expression))
      return
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && ts.isStringLiteralLike(node.left)) {
      found.push(node.left.text + '${}')
      visit(node.right)
      return
    }
    if (ts.isStringLiteralLike(node)) found.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** All text that can refer to a class or a token: the string literals of TS/TSX and index.html without its comments. */
const code = [
  ...srcFiles(/\.(ts|tsx)$/).flatMap(f => stringLiterals(readFileSync(f, 'utf8'), f.endsWith('.tsx'))),
  readRepo('index.html').replace(/<!--[\s\S]*?-->/g, ''),
].join('\n')
const cssText = CSS_FILES.map(readCss).join('\n')

/** Classes declared in CSS, with the file of the first declaration. */
function declaredClasses(): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of CSS_FILES) {
    for (const m of selectorsOnly(readCss(file)).matchAll(/\.([a-zA-Z_][\w-]*)/g)) if (!found.has(m[1])) found.set(m[1], file)
  }
  return found
}

/** Prefixes of classes built from a template or a concatenation: `insight--${severity}`, `'btn--' + size`. */
const dynamicPrefixes = [...code.matchAll(/([\w-]+)\$\{\}/g)].map(m => m[1]).filter(p => p.length >= 4)

function classUsed(name: string): boolean {
  if (new RegExp(`(^|[^\\w-])${name}(?![\\w-])`).test(code)) return true
  return dynamicPrefixes.some(p => name.startsWith(p))
}

/** Tokens declared in tokens.css (both themes): the line starts with `--x:`; selectors like `.btn--ghost:hover` do not count. */
function declaredTokens(): string[] {
  return [...new Set([...readCss(CSS_FILES[0]).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map(m => m[1]))]
}

/** Semantic colors substituted into the template `var(--${color}…)` (SemanticColor in ui/types.ts). */
const SEMANTIC = ['primary', 'secondary', 'success', 'error', 'warning', 'info']
/** Tails of template tokens: `var(--${color}-16)` → `-16`, `var(--${color})` → ``. */
const dynamicSuffixes = [...code.matchAll(/--\$\{\}(-[\w-]+)?/g)].map(m => m[1] ?? '')

function tokenUsed(token: string): boolean {
  if (new RegExp(`var\\(${token}(?![\\w-])`).test(`${cssText}\n${code}`)) return true
  if (new RegExp(`(^|\\n)${token}(\\n|$)`).test(code)) return true
  return SEMANTIC.some(c => dynamicSuffixes.some(s => token === `--${c}${s}`))
}

describe('stringLiterals', () => {
  it('reads strings, JSX attributes and templates, not comments or identifiers', () => {
    const source = [
      "// the old-card class is gone",
      "/* 'ghost-class' */",
      "const card = 1",
      "const a = 'btn btn--ghost'",
      "const b = <div className=\"hl__note\">{/* hl__gone */}</div>",
      "const c = `insight--${severity} done`",
      "const d = 'btn--' + size",
    ].join('\n')
    expect(stringLiterals(source, true)).toEqual(['btn btn--ghost', 'hl__note', 'insight--${} done', 'btn--${}'])
  })
})

describe('dead CSS', () => {
  it('every class declared in the stylesheets is used by markup', () => {
    const unused = [...declaredClasses()].filter(([name]) => !classUsed(name)).map(([name, file]) => `.${name} (${file})`)
    expect(unused).toEqual([])
  })

  it('every custom property declared in tokens.css is read somewhere', () => {
    const unused = declaredTokens().filter(t => !tokenUsed(t))
    expect(unused).toEqual([])
  })
})
