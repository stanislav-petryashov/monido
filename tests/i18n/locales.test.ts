import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT, srcFiles } from '../helpers/repoFiles'

const LOCALES_DIR = join(ROOT, 'src', 'locales')
const SOURCE_DIR = join(ROOT, 'src')
const BASE = 'en-US'
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]): [string, string][] => {
    if (typeof v === 'string') return [[prefix + k, v]]
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return flatten(v, `${prefix}${k}.`)
    throw new Error(`locale key "${prefix + k}" must be a string or an object, got ${Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v}`)
  })
}

const readLocale = (path: string) => flatten(JSON.parse(readFileSync(path, 'utf8')) as Tree)

/** The locale files of one directory, by language: the main files (src/locales/) or a chunk (src/locales/<chunk>/). */
const localesIn = (dir: string) => Object.fromEntries(
  readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.json'))
    .map(e => [e.name.replace(/\.json$/, ''), readLocale(join(dir, e.name))]),
) as Record<string, [string, string][]>

/** The key sets checked for parity: the main files, then every lazily loaded chunk (src/locales/<chunk>/<lang>.json). */
const CHUNKS = readdirSync(LOCALES_DIR, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
const SETS: Record<string, Record<string, [string, string][]>> = {
  main: localesIn(LOCALES_DIR),
  ...Object.fromEntries(CHUNKS.map(chunk => [chunk, localesIn(join(LOCALES_DIR, chunk))])),
}
const keysOf = (set: Record<string, [string, string][]>) =>
  Object.fromEntries(Object.entries(set).map(([lang, e]) => [lang, e.map(([k]) => k)])) as Record<string, string[]>

const baseKey = (key: string) => key.replace(PLURAL_SUFFIX, '')
const baseKeys = (keys: string[]) => new Set(keys.map(baseKey))

/** All src/ code with comments removed, so a key named in a comment is not a reference. */
function sourceText(): string {
  return srcFiles(/\.tsx?$/)
    .map(f => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1'))
    .join('\n')
}

for (const [name, entries] of Object.entries(SETS)) {
  const locales = keysOf(entries)

  describe(`locale files (${name})`, () => {
    it('include the base locale', () => {
      expect(Object.keys(locales)).toContain(BASE)
    })

    for (const [lang, keys] of Object.entries(locales)) {
      if (lang === BASE) continue
      it(`${lang} has exactly the keys of ${BASE}`, () => {
        const want = baseKeys(locales[BASE])
        const have = baseKeys(keys)
        const missing = [...want].filter(k => !have.has(k))
        const orphan = [...have].filter(k => !want.has(k))
        expect({ missing, orphan }).toEqual({ missing: [], orphan: [] })
      })
    }

    it('every locale has all plural categories of its language for plural keys', () => {
      const pluralBases = new Set(
        Object.values(locales).flatMap(keys => keys.filter(k => PLURAL_SUFFIX.test(k)).map(baseKey)),
      )
      const problems: string[] = []
      for (const [lang, keys] of Object.entries(locales)) {
        const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories
        for (const base of pluralBases) {
          for (const category of categories) {
            if (!keys.includes(`${base}_${category}`)) problems.push(`${lang}: ${base}_${category}`)
          }
        }
      }
      expect(problems).toEqual([])
    })

    it('placeholders match the base locale per key', () => {
      const names = (text: string) => new Set([...text.matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)].map(m => m[1]))
      // per base key: union of placeholder names over its plural variants, without `count`
      const byBase = (lang: string) => {
        const map = new Map<string, Set<string>>()
        for (const [key, text] of entries[lang]) {
          const set = map.get(baseKey(key)) ?? new Set<string>()
          for (const n of names(text)) if (n !== 'count') set.add(n)
          map.set(baseKey(key), set)
        }
        return map
      }
      const want = byBase(BASE)
      const problems: string[] = []
      for (const lang of Object.keys(entries)) {
        if (lang === BASE) continue
        const have = byBase(lang)
        for (const [base, set] of want) {
          const got = have.get(base)
          if (got && [...set].sort().join() !== [...got].sort().join()) {
            problems.push(`${lang}: ${base} has {{${[...got].join('}}, {{')}}}, ${BASE} has {{${[...set].join('}}, {{')}}}`)
          }
        }
      }
      expect(problems).toEqual([])
    })

    it('every base-locale key is referenced in src/', () => {
      const text = sourceText()
      // dynamic keys: a string literal prefix followed by `${` or `+`, e.g. `dates.month.${n}`
      const prefixes = [...text.matchAll(/['"`]([\w.]*\.)(?:\$\{|['"`]\s*\+)/g)].map(m => m[1])
      // and a constant prefix used in a template: `const P = 'modules.advisor.proposals'` … `${P}.title`
      for (const [, name, value] of text.matchAll(/\bconst (\w+) = ['"]([\w.]+)['"]/g)) if (text.includes(`\${${name}}.`)) prefixes.push(`${value}.`)
      // a one-segment prefix (`metrics.`) would excuse a whole namespace: only a deeper one counts as a prefix. A template
      // stands for the keys of its shape instead, each `${…}` one segment: `metrics.${key}.title` is every metrics.X.title
      const deep = prefixes.filter(p => p.split('.').length > 2)
      const shapes = [...text.matchAll(/`(\w+\.(?:[\w.]|\$\{[^}`]*\})*)`/g)]
        .map(m => new RegExp(`^${m[1].replace(/\./g, '\\.').replace(/\$\{[^}]*\}/g, '\\w+')}$`))
      const dead = [...baseKeys(locales[BASE])].filter(key => {
        // error codes come from the server, never as literals: errorKeys.test.ts checks them
        if (key.startsWith('errors.')) return false
        const literal = (k: string) => new RegExp(`['"\`]${k.replace(/\./g, '\\.')}['"\`]`).test(text)
        // a context variant (`key_mortgage`) is read through its base key with a `context` param
        const stem = key.replace(/_[a-z]+$/, '')
        return !literal(key) && !(stem !== key && literal(stem)) && !deep.some(p => key.startsWith(p)) && !shapes.some(s => s.test(key))
      })
      expect(dead, `keys in ${BASE}.json (${name}) that no src/ code references (delete them or use them)`).toEqual([])
    })
  })
}

/** What the Modules card and the menu render of the Advisor: the page's own texts are in its chunk (src/locales/advisor/). */
const ADVISOR_IN_MAIN = /^modules\.advisor\.(?:title|summary|tabs\.\w+|appears\.\d+|connect\.title|units\.proposals_(?:one|few|many|other)|todoProposal)$/

describe('locale chunks', () => {
  it('the advisor chunk exists', () => {
    expect(CHUNKS).toContain('advisor')
  })

  for (const chunk of CHUNKS) {
    it(`${chunk} has a file for every language of the main files, and only those`, () => {
      expect(Object.keys(SETS[chunk]).sort()).toEqual(Object.keys(SETS.main).sort())
    })

    it(`${chunk} has a loader for every language in src/i18n/chunks.ts`, () => {
      const loaders = readFileSync(join(SOURCE_DIR, 'i18n', 'chunks.ts'), 'utf8')
      const missing = Object.keys(SETS[chunk]).filter(lang => !loaders.includes(`'../locales/${chunk}/${lang}.json'`))
      expect(missing).toEqual([])
    })

    it(`no key of ${chunk} is also in the main files`, () => {
      const main = new Set(keysOf(SETS.main)[BASE])
      expect(keysOf(SETS[chunk])[BASE].filter(k => main.has(k))).toEqual([])
    })
  }

  it('the main files keep only the Modules card and menu texts of the Advisor', () => {
    const left = keysOf(SETS.main)[BASE].filter(k => k.startsWith('modules.advisor.') && !ADVISOR_IN_MAIN.test(k))
    expect(left).toEqual([])
  })
})
