import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

/** Lines of `src/` matching a pattern, tracked or new (`--untracked`), as `path:line:text`. No match is an empty list. */
function grepSrc(pattern: string): string[] {
  try {
    const out = execFileSync('git', ['grep', '-nE', '--untracked', '-e', pattern, '--', 'src'], { cwd: ROOT, encoding: 'utf8' })
    return out.split('\n').filter(Boolean)
  } catch (e) {
    // git grep exits with 1 when nothing matches
    if ((e as { status?: number }).status === 1) return []
    throw e
  }
}

/** The source of a file by its repo-relative path (`src/main.tsx`), or undefined when there is no such file. */
type Source = (path: string) => string | undefined

const diskSource: Source = path => {
  const file = join(ROOT, path)
  return existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : undefined
}

// `from './x'`, `import './x'`, `export … from './x'` and `import('./x')`; relative specifiers only (there are no aliases)
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]*)['"]/g
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
const CODE = /\.(ts|tsx)$/

/** The file a relative specifier points at, as the bundler resolves it; undefined — nothing there. */
function resolve(from: string, specifier: string, source: Source): string | undefined {
  const base = posix.join(posix.dirname(from), specifier)
  return EXTENSIONS.map(ext => base + ext).find(candidate => source(candidate) !== undefined)
}

/**
 * Every file the entry reaches through relative imports, the entry included. Type-only imports count: a type
 * from the server is still the browser depending on it. Files that are not code (css, json) are leaves.
 * `unresolved` lists specifiers that point at nothing, so a typo cannot hide a file from the walk.
 */
function reachable(entry: string, source: Source): { files: Set<string>; unresolved: string[] } {
  const files = new Set<string>()
  const unresolved: string[] = []
  const queue = [entry]
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (files.has(file)) continue
    files.add(file)
    if (!CODE.test(file)) continue
    for (const [, specifier] of (source(file) ?? '').matchAll(SPECIFIER)) {
      const target = resolve(file, specifier!, source)
      if (target) queue.push(target)
      else unresolved.push(`${file} -> ${specifier}`)
    }
  }
  return { files, unresolved }
}

/**
 * What must never be in the browser's graph: anything under `src/server/` (Database, Hono, config, node:sqlite)
 * and the module server halves, which are named `server.ts`.
 *
 * The rule needs no list of server files. Whatever a server half imports from `src/server/` pulls that file into
 * the walk too, so a client file that reaches `modules/server.ts`, or a service such as `reminders/reminders.ts`
 * that talks to the Database, is caught through the `src/server/` file it imports.
 */
function serverFilesIn(entry: string, source: Source): string[] {
  return [...reachable(entry, source).files].filter(file => file.startsWith('src/server/') || /(^|\/)server\.tsx?$/.test(file)).sort()
}

const virtual = (files: Record<string, string>): Source => path => files[path]

describe('the typed API boundary', () => {
  it('has no `as unknown as` cast left in src/', () => {
    expect(grepSrc('as unknown as')).toEqual([])
  })

  it('keeps the server out of everything the browser entry reaches', () => {
    expect(serverFilesIn('src/main.tsx', diskSource)).toEqual([])
  })

  it('resolves every relative import on the way (the walk has no holes)', () => {
    expect(reachable('src/main.tsx', diskSource).unresolved).toEqual([])
    // the walk really covers the app: the pages, the module client and the shared types are in it
    const { files } = reachable('src/main.tsx', diskSource)
    expect(files).toContain('src/pages/admin/useMonthClose.ts')
    expect(files).toContain('src/domain/api.ts')
  })

  it('starts from the server entry and finds the server files there (the check can see them)', () => {
    expect(serverFilesIn('src/server/main.ts', diskSource)).toEqual(expect.arrayContaining(['src/server/app.ts', 'src/modules/server.ts']))
  })
})

describe('the import walk (self-test)', () => {
  const clean = {
    'src/main.tsx': `import { App } from './pages/App'\nimport './styles.css'`,
    'src/styles.css': '.a { color: red }',
    'src/pages/App.tsx': `import type { Row } from '../domain/api'\nconst Lazy = () => import('./Lazy')`,
    'src/pages/Lazy.tsx': `export const x = 1`,
    'src/domain/api.ts': `export type Row = {}`,
  }

  it('passes a client that stays in the browser graph', () => {
    expect(serverFilesIn('src/main.tsx', virtual(clean))).toEqual([])
  })

  it.each([
    ['a path above the server folder, as ../modules/server', `import { enabledServer } from '../modules/server'`],
    ['a sibling ./server', `import { x } from './server'`],
    ['a type from src/server', `import type { Database } from '../server/db'`],
    ['a service that imports the server', `import { getReminders } from '../modules/reminders/reminders'`],
    ['a re-export', `export { enabledServer } from '../modules/server'`],
    ['a dynamic import', `const s = await import('../modules/server')`],
  ])('flags a client file importing %s', (_name, line) => {
    const tree = {
      ...clean,
      'src/pages/App.tsx': `${line}\nimport type { Row } from '../domain/api'`,
      'src/pages/server.ts': 'export const x = 1',
      'src/modules/server.ts': `import type { Database } from '../server/db'`,
      'src/modules/reminders/reminders.ts': `import type { Database } from '../../server/db'`,
      'src/server/db.ts': 'export type Database = {}',
    }
    expect(serverFilesIn('src/main.tsx', virtual(tree)).length).toBeGreaterThan(0)
  })

  it('reports the unresolved specifier instead of skipping it', () => {
    const tree = { ...clean, 'src/pages/App.tsx': `import { y } from './missing'` }
    expect(reachable('src/main.tsx', virtual(tree)).unresolved).toEqual(['src/pages/App.tsx -> ./missing'])
  })
})
