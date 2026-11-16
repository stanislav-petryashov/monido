import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT, srcFiles } from '../helpers/repoFiles'
import { SAME_AS_ENGLISH } from './sameAsEnglish'

const LOCALES_DIR = join(ROOT, 'src', 'locales')
const SOURCE_DIR = join(ROOT, 'src')
const BASE = 'en-US'
/** Languages that every code change completes (docs/translating.md); the others may lag behind English. */
const COMPLETE = ['ru-RU']
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
      const want = baseKeys(locales[BASE])
      const have = baseKeys(keys)
      // a key no longer in English is dead text in every language
      it(`${lang} has no key that ${BASE} lacks`, () => {
        expect([...have].filter(k => !want.has(k))).toEqual([])
      })
      // Russian is written with the code; the other languages catch up on Weblate and fall back to English meanwhile
      if (COMPLETE.includes(lang)) {
        it(`${lang} has every key of ${BASE}`, () => {
          expect([...want].filter(k => !have.has(k))).toEqual([])
        })
      }
    }

    /** The markup tags of a value, sorted: `<0>`, `</0>`, `<account/>` each count. */
    const tagTokens = (text: string) => [...text.matchAll(/<\/?\w+\s*\/?>/g)].map(m => m[0].replace(/\s+/g, '')).sort()
    /** Every opened tag is closed after it, in order. */
    const balanced = (text: string) => {
      const open: string[] = []
      for (const [token, closing, name, self] of text.matchAll(/<(\/?)(\w+)\s*(\/?)>/g)) {
        if (self) continue
        if (!closing) open.push(name)
        else if (open.pop() !== name) return false
        void token
      }
      return open.length === 0
    }
    /** The placeholders of a value as `name` or `name,format`. */
    const placeholders = (text: string) =>
      [...text.matchAll(/\{\{\s*([\w.]+)\s*(?:,\s*([^}]*?))?\s*\}\}/g)].map(m => (m[2] ? `${m[1]},${m[2].trim()}` : m[1]))
    /** Per base key: the union of what `pick` finds over its plural variants. */
    const byBase = (lang: string, pick: (text: string) => string[]) => {
      const map = new Map<string, string[]>()
      for (const [key, text] of entries[lang]) map.set(baseKey(key), [...(map.get(baseKey(key)) ?? []), ...pick(text)])
      return map
    }
    const pluralBases = new Set(Object.values(locales).flatMap(keys => keys.filter(k => PLURAL_SUFFIX.test(k)).map(baseKey)))
    const english = new Map(entries[BASE])

    for (const lang of Object.keys(locales)) {
      it(`${lang}: no value is empty`, () => {
        // an empty value would show nothing in the app instead of falling back to English
        expect(entries[lang].filter(([, text]) => text.trim() === '').map(([key]) => key)).toEqual([])
      })

      it(`${lang}: every plural key has all plural categories of the language`, () => {
        const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories
        // a plural key the language has (any of its forms) needs all its categories; a key not translated yet needs none
        const present = new Set(locales[lang].map(baseKey))
        const problems = [...pluralBases].filter(base => present.has(base))
          .flatMap(base => categories.filter(c => !locales[lang].includes(`${base}_${c}`)).map(c => `${base}_${c}`))
        expect(problems).toEqual([])
      })

      if (lang === BASE) continue

      it(`${lang}: placeholders match the base locale per key`, () => {
        // without `count`, which a plural form may leave out
        const names = (text: string) => placeholders(text).map(p => p.split(',')[0]).filter(n => n !== 'count')
        const want = byBase(BASE, names)
        const have = byBase(lang, names)
        const problems = [...want].flatMap(([base, set]) => {
          const got = have.get(base)
          const a = [...new Set(set)].sort().join()
          const b = got ? [...new Set(got)].sort().join() : a
          return a === b ? [] : [`${base} has {{${b}}}, ${BASE} has {{${a}}}`]
        })
        expect(problems).toEqual([])
      })

      it(`${lang}: a placeholder English formats is formatted here too`, () => {
        // the format may differ (Russian cases: {{month, inMonth}}), but a bare {{ym}} would print the raw '2026-11'
        const formatted = byBase(BASE, text => placeholders(text).filter(p => p.includes(',')).map(p => p.split(',')[0]))
        const bare = byBase(lang, text => placeholders(text).filter(p => !p.includes(',')))
        const problems = [...bare].flatMap(([base, names]) => names.filter(n => formatted.get(base)?.includes(n)).map(n => `${base}: {{${n}}}`))
        expect(problems).toEqual([])
      })

      it(`${lang}: every value has the markup tags of its English value, each opened tag closed`, () => {
        const english = new Map(entries[BASE])
        const problems = entries[lang].flatMap(([key, text]) => {
          const source = english.get(key) ?? english.get(`${baseKey(key)}_other`)
          if (source === undefined) return []
          const tags = tagTokens(text)
          return tags.join() === tagTokens(source).join() && balanced(text) ? [] : [`${key}: ${tags.join(' ')}`]
        })
        expect(problems).toEqual([])
      })

      it(`${lang}: no value is a copy of English`, () => {
        const allowed = new Set(SAME_AS_ENGLISH[lang] ?? [])
        // a value with no words once placeholders and tags are gone ('{{label}}: {{value}}') is the same in every language
        const hasWords = (text: string) => text.split(/\{\{[^}]*\}\}|<[^>]*>/).some(part => /\p{L}/u.test(part))
        const copies = entries[lang]
          .filter(([key, text]) => english.get(key) === text && hasWords(text) && !allowed.has(key))
          .map(([key]) => key)
        expect(copies, `translate these, or list them in tests/i18n/sameAsEnglish.ts when ${lang} really says the same`).toEqual([])
      })
    }

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
