import { existsSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { ROOT, srcFiles as listSrcFiles } from '../helpers/repoFiles'

const DOCS = ['CLAUDE.md', 'docs/architecture.md'].map(f => join(ROOT, f))
const read = (f: string) => readFileSync(f, 'utf8')

/** Paths from the text: `src/...`, `tests/...`, `docs/...`, `migrations/...`, `scripts/...`; templates (`<key>`, `NNNN`, `*`) are not checked. */
function mentionedPaths(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(/(?:^|[^\w/.-])((?:src|tests|docs|migrations|scripts)\/[\w./<>*-]+)/g)) {
    const p = m[1].replace(/[.,:;)]+$/, '')
    if (/[<>*]|NNNN/.test(p)) continue
    found.add(p)
  }
  return [...found]
}

/**
 * The full paths the file trees of the code blocks spell: an unindented `src/<dir>/` line opens a folder, and the
 * lines indented under it name its files (`  dates.ts` → `src/domain/dates.ts`) and subfolders (`  bot/` opens
 * `src/server/bot/` for the lines indented deeper).
 */
function treePaths(markdown: string): Set<string> {
  const found = new Set<string>()
  let folders: { indent: number; path: string }[] = []
  let inCode = false
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) { inCode = !inCode; folders = []; continue }
    const m = inCode ? /^( *)(\S+)/.exec(line) : null
    if (!m) continue
    const indent = m[1].length
    folders = folders.filter(f => f.indent < indent)
    const name = m[2].replace(/[,;]+$/, '')
    const path = name.startsWith('src/') ? name : folders.length > 0 ? folders[folders.length - 1].path + name : null
    if (path === null) continue
    if (path.endsWith('/')) folders.push({ indent, path })
    else found.add(path)
  }
  return found
}

/** A path with `<key>`-style placeholders as a pattern: `src/modules/<key>/meta.ts` matches every module's meta.ts. */
const templatePatterns = (text: string): RegExp[] =>
  [...text.matchAll(/src\/[\w./-]*<\w+>[\w./<>-]*\.(?:tsx|ts|css)(?!\w)/g)]
    .map(m => new RegExp(`^${m[0].replace(/[.]/g, '\\.').replace(/<\w+>/g, '[^/]+')}$`))

const srcFiles = listSrcFiles(/\.(ts|tsx|css)$/).map(f => relative(ROOT, f))
const stem = (path: string) => basename(path).replace(/\.(ts|tsx)$/, '')
/** File names (without .ts/.tsx) that more than one source file has: meta, client, server, types… */
const sharedStems = new Set(srcFiles.map(stem).filter((name, i, all) => all.indexOf(name) !== i))

describe('docs/architecture.md', () => {
  it('names only paths that exist', () => {
    const missing = DOCS.flatMap(doc => mentionedPaths(read(doc)).filter(p => !existsSync(join(ROOT, p))).map(p => `${basename(doc)}: ${p}`))
    expect(missing).toEqual([])
  })

  it('every file its trees list exists', () => {
    const missing = [...treePaths(read(DOCS[1]))].filter(p => /\.(ts|tsx|css|json)$/.test(p) && !p.includes('<') && !existsSync(join(ROOT, p)))
    expect(missing).toEqual([])
  })

  it('mentions every source file: by its full path (in the text, a tree or a <key> template) when another file has its name, else by name', () => {
    const text = read(DOCS[1])
    const trees = treePaths(text)
    const templates = templatePatterns(text)
    const unmentioned = srcFiles.filter(path => {
      if (text.includes(path) || trees.has(path) || templates.some(t => t.test(path))) return false
      if (sharedStems.has(stem(path))) return true
      return !new RegExp(`(^|[^\\w-])${stem(path).replace(/\./g, '\\.')}(?![\\w-])`).test(text)
    })
    expect(unmentioned).toEqual([])
  })

  it('CLAUDE.md points at the map', () => {
    expect(read(DOCS[0])).toContain('docs/architecture.md')
  })
})

describe('treePaths', () => {
  it('resolves the names indented under a folder line, folder by folder', () => {
    const doc = ['```', 'src/server/', '  main.ts         entry point', '  bot/            the bot', '    texts.ts      familyT', '  db.ts           wrapper', 'src/lib/types.ts — shapes', '```', '  stray.ts'].join('\n')
    expect([...treePaths(doc)]).toEqual(['src/server/main.ts', 'src/server/bot/texts.ts', 'src/server/db.ts', 'src/lib/types.ts'])
  })
})
