import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type Tree = { [key: string]: string | Tree }

function values(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]): [string, string][] =>
    typeof v === 'string' ? [[prefix + k, v]] : values(v, `${prefix}${k}.`))
}

const LOCALES = join(__dirname, '..', '..', 'src', 'locales')
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Tree
// the main file and every locale chunk's (src/locales/<chunk>/en-US.json)
const chunks = readdirSync(LOCALES, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(LOCALES, e.name, 'en-US.json'))
const en = [join(LOCALES, 'en-US.json'), ...chunks].map(read)

describe('English punctuation', () => {
  it('English UI strings use no spaced em dash', () => {
    // a value that is exactly "—" is the missing-value mark
    const bad = en.flatMap(tree => values(tree)).filter(([, v]) => v !== '—' && / — /.test(v)).map(([k]) => k)
    expect(bad).toEqual([])
  })
})
