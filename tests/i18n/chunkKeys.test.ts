import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT, srcFiles } from '../helpers/repoFiles'

// A locale chunk (src/locales/<chunk>/) loads only with the pages that await it: `lazyWithChunks(() => import(page), chunk)`
// (src/i18n/lazyWithChunks.ts). A chunk key may therefore be used only by code that every way in reaches through such a page.
// The ways in are the entry points (src/main.tsx, which loads the shell, the sidebar, toasts and errorMessage, and the server)
// and every lazily imported module (the pages); the code a way in brings is what it imports statically, transitively
// (type-only imports do not count). A file that uses a key of a chunk must be reached only from pages loaded with that chunk.
// DataPage is special: AppShell draws every Records and Settings route (section 'data' or 'settings') inside it, so a chunk
// loaded with DataPage also covers those routes' pages.

const SRC = join(ROOT, 'src')
const LOCALES = join(SRC, 'locales')
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/
const DATA_PAGE = join(SRC, 'pages', 'admin', 'DataPage.tsx')

type Tree = { [key: string]: string | Tree }
const flatten = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [prefix + k] : flatten(v, `${prefix}${k}.`)))

const FILES = srcFiles(/\.tsx?$/)
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
const TEXT = new Map(FILES.map(f => [f, stripComments(readFileSync(f, 'utf8'))]))

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec)
  const found = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]
    .find(c => existsSync(c) && statSync(c).isFile() && /\.tsx?$/.test(c))
  return found ?? null
}

const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT = /import\(\s*'([^']+)'\s*\)/g
const resolved = (file: string, specs: Iterable<RegExpMatchArray>) =>
  [...specs].map(m => resolveImport(file, m[1] ?? m[2])).filter((p): p is string => p !== null)
const imports = new Map(FILES.map(f => [f, resolved(f, TEXT.get(f)!.matchAll(STATIC_IMPORT))]))

/** Every file `roots` import statically, transitively (what loads with them, before any import()). */
function staticClosure(roots: string[]): Set<string> {
  const seen = new Set<string>()
  const visit = (f: string) => { if (seen.has(f)) return; seen.add(f); imports.get(f)?.forEach(visit) }
  roots.forEach(visit)
  return seen
}

/**
 * The keys of `keys` (one chunk's) a source text uses: a key literal; a literal prefix completed at run time
 * (`` `data.common.datePart.${p}` ``, `'data.close.' + …`); a literal naming a group of two segments or more
 * (`const P = 'data.close'`, later `` `${P}.title` ``), which counts for every key in the group. A run-time prefix of one
 * segment counts only when most keys under it (of `allKeys`: the main files' and every chunk's) are the chunk's:
 * `` `data.${screen}.title` `` names the records chunk, `` `modules.${key}` `` (the module catalog) names the main files. A
 * one-segment literal is a plain word (`section: 'data'`), not a group. Keys built in other ways are not seen.
 */
function usedKeysIn(text: string, keys: string[], allKeys: string[]): string[] {
  const prefixes = [...text.matchAll(/['"`]([\w.]+\.)(?:\$\{|['"`]\s*\+)/g)].map(m => m[1])
  const literals = [...text.matchAll(/['"`](\w+(?:\.\w+)+)['"`]/g)].map(m => m[1])
  const groups = literals.map(l => `${l}.`)
  const mostlyChunk = (p: string) => keys.filter(k => k.startsWith(p)).length * 2 > allKeys.filter(k => k.startsWith(p)).length
  const named = [...prefixes, ...groups].filter(p => p.split('.').length > 2 || (prefixes.includes(p) && mostlyChunk(p)))
  return keys.filter(key => literals.includes(key) || named.some(p => key.startsWith(p)))
}

const CHUNKS = readdirSync(LOCALES, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
const keysIn = (path: string) => [...new Set(flatten(JSON.parse(readFileSync(path, 'utf8')) as Tree).map(k => k.replace(PLURAL_SUFFIX, '')))]
const chunkKeys = (chunk: string) => keysIn(join(LOCALES, chunk, 'en-US.json'))
const ALL_KEYS = [...keysIn(join(LOCALES, 'en-US.json')), ...CHUNKS.flatMap(chunkKeys)]

/** The pages of the routes in src/routes.ts and the modules' client.tsx, with their section. */
function routePages(): { section: string; page: string }[] {
  const routeFiles = [join(SRC, 'routes.ts'), ...FILES.filter(f => /src\/modules\/[^/]+\/client\.tsx$/.test(f))]
  return routeFiles.flatMap(file => {
    const text = TEXT.get(file)!
    const lazyConst = (name: string) => new RegExp(`const ${name}\\s*=\\s*lazy\\w*\\(\\(\\) => import\\('([^']+)'\\)`).exec(text)?.[1]
    return [...text.matchAll(/section: '(\w+)'[^{}]*?page: (?:(\w+)\s*[,}]|lazy\w*\(\(\) => import\('([^']+)'\))/g)].flatMap(m => {
      const spec = m[3] ?? lazyConst(m[2])
      const page = spec ? resolveImport(file, spec) : null
      return page ? [{ section: m[1], page }] : []
    })
  })
}

/** The pages loaded through `lazyWithChunks(() => import(page)…, chunk…)` (one call per line), by chunk. */
function chunkPages(): Map<string, Set<string>> {
  const pages = new Map(CHUNKS.map(c => [c, new Set<string>()]))
  for (const file of FILES) {
    for (const m of TEXT.get(file)!.matchAll(/lazyWithChunks\(\s*\(\) => import\('([^']+)'\)([^\n]*)/g)) {
      const page = resolveImport(file, m[1])
      const named = [...m[2].matchAll(/'([\w-]+)'/g)].map(c => c[1]).filter(c => CHUNKS.includes(c))
      if (page) named.forEach(c => pages.get(c)!.add(page))
    }
  }
  // what DataPage frames comes with its chunks too (AppShell)
  const framed = routePages().filter(r => r.section !== 'dashboard').map(r => r.page)
  for (const set of pages.values()) if (set.has(DATA_PAGE)) framed.forEach(p => set.add(p))
  return pages
}

/** Every way in: the two entry points and every module imported lazily anywhere in src/, each with what it brings. */
const SERVER = join(SRC, 'server', 'main.ts')
const ENTRIES = [join(SRC, 'main.tsx'), SERVER]
const LAZY = [...new Set(FILES.flatMap(f => resolved(f, TEXT.get(f)!.matchAll(DYNAMIC_IMPORT))))]
const REACH = new Map([...ENTRIES, ...LAZY].map(root => [root, staticClosure([root])]))

/**
 * `file: key (from root)` for each use of a chunk key in a file that some way in, not loaded with the chunk, reaches. The
 * server counts as loaded with every chunk: its one `t`, familyT (src/server/bot/texts.ts), merges them all
 * (LOCALE_CHUNKS), so the bot may word texts kept in a chunk (the advisor's cards).
 */
function offenders(chunk: string): string[] {
  const keys = chunkKeys(chunk)
  const allowed = new Set([...chunkPages().get(chunk)!, SERVER])
  return FILES.flatMap(file => {
    const used = usedKeysIn(TEXT.get(file)!, keys, ALL_KEYS)
    if (used.length === 0) return []
    const strangers = [...REACH].filter(([root, files]) => files.has(file) && !allowed.has(root)).map(([root]) => relative(ROOT, root))
    return strangers.length ? used.map(k => `${relative(ROOT, file)}: ${k} (reached from ${strangers.join(', ')})`) : []
  })
}

describe('locale chunk keys', () => {
  it('finds the chunks, the ways in, the routes and the pages loaded with each chunk', () => {
    expect(CHUNKS).toEqual(expect.arrayContaining(['advisor', 'records']))
    expect(REACH.get(ENTRIES[0])!.size).toBeGreaterThan(50)
    const rel = (paths: Iterable<string>) => [...paths].map(p => relative(ROOT, p))
    expect(rel(routePages().filter(r => r.section === 'dashboard').map(r => r.page))).toEqual(expect.arrayContaining([
      'src/pages/Overview.tsx', 'src/pages/Assets.tsx', 'src/pages/AvailableMoney.tsx', 'src/pages/CashFlow.tsx', 'src/pages/Goals.tsx', 'src/modules/health/HealthPage.tsx',
      'src/modules/advisor/AdvisorPage.tsx',
    ]))
    const pages = chunkPages()
    expect(rel(pages.get('advisor')!).sort()).toEqual(['src/modules/advisor/AdvisorPage.tsx', 'src/modules/advisor/AskClaudePage.tsx', 'src/modules/advisor/ConnectPage.tsx', 'src/modules/advisor/SwitchNotice.tsx'])
    expect(rel(pages.get('records')!)).toEqual(expect.arrayContaining([
      'src/pages/admin/DataPage.tsx', 'src/pages/admin/AccountsView.tsx', 'src/pages/admin/LoansView.tsx', 'src/modules/cashflow/FlowsScreen.tsx',
    ]))
    expect(rel(pages.get('records')!)).toContain('src/pages/Overview.tsx')
    expect(rel(pages.get('records')!)).not.toContain('src/pages/NetWorth.tsx')
  })

  it('the usage scan sees literals, run-time prefixes and group literals', () => {
    const keys = ['data.close.title', 'data.close.next', 'data.common.datePart.d']
    const all = [...keys, 'data.common.save']
    expect(usedKeysIn(`t('data.close.title')`, keys, all)).toEqual(['data.close.title'])
    expect(usedKeysIn('t(`data.common.datePart.${p}`)', keys, all)).toEqual(['data.common.datePart.d'])
    expect(usedKeysIn(`t('data.close.' + part)`, keys, all)).toEqual(['data.close.title', 'data.close.next'])
    expect(usedKeysIn("const P = 'data.close'\nt(`${P}.title`)", keys, all)).toEqual(['data.close.title', 'data.close.next'])
    expect(usedKeysIn("const section = 'data'", keys, all)).toEqual([])
  })

  it('a one-segment prefix counts only when most keys under it are the chunk\'s', () => {
    const advisor = ['modules.advisor.use.title', 'modules.advisor.copied']
    const records = ['data.close.title', 'data.accounts.empty', 'data.common.datePart.d']
    const all = [...advisor, ...records, 'data.common.save', 'modules.cashflow.title', 'modules.goals.title', 'modules.health.title']
    expect(usedKeysIn('t(`data.${screen}.title`)', records, all)).toEqual(records)
    expect(usedKeysIn('t(`modules.${key}.title`)', advisor, all)).toEqual([])
    // the real files: `data.` is the records chunk's, `modules.` the main files'
    expect(usedKeysIn('t(`data.${screen}.title`)', chunkKeys('records'), ALL_KEYS)).toContain('data.accounts.empty')
    expect(usedKeysIn('t(`modules.${key}.title`)', chunkKeys('advisor'), ALL_KEYS)).toEqual([])
  })

  for (const chunk of CHUNKS) {
    it(`the keys of ${chunk} are used only by code that loads with that chunk`, () => {
      expect(offenders(chunk)).toEqual([])
    })
  }
})
