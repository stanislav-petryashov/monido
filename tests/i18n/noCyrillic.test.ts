import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ROOT, readRepo, trackedFiles } from '../helpers/repoFiles'

/** Path prefixes that must stay Cyrillic-free: `''` is the whole repository; ALLOWED is the only exception. */
const CLEAN: readonly string[] = ['']

/** The Russian locale files (src/locales/ru-RU.json, each chunk's src/locales/<chunk>/ru-RU.json) and the demo data file src/demo/ru-RU.json. */
const ALLOWED = /^src\/(?:locales\/(?:[^/]+\/)*|demo\/)ru-RU\.json$/
const BINARY = /\.(png|jpe?g|gif|ico|woff2?|sqlite)$/
const CYRILLIC = /\p{Script=Cyrillic}/u
// U+0400–U+04FF written as an escape in source: \u04xx or \u{4xx}
const CYRILLIC_ESCAPE = /\\u(?:04[0-9a-f]{2}|\{0*4[0-9a-f]{2}\})/i
const MAX_REPORTED = 50

/** Tracked files plus new ones not yet added (so a fresh file cannot slip through), minus ignored/excluded ones. */
const listed = trackedFiles()

/** Cyrillic in a line, as letters or as escapes that a compiler turns into letters. */
function hasCyrillic(line: string): boolean {
  return CYRILLIC.test(line) || CYRILLIC_ESCAPE.test(line)
}

it('spots Cyrillic letters and their escapes, not other escapes', () => {
  // built from parts so this file does not trip its own scan
  const u = '\\' + 'u'
  for (const line of [String.fromCodePoint(0x410), `${u}0410`, `${u}04FF`, `${u}{410}`, `${u}{0400}`]) {
    expect(hasCyrillic(line), line).toBe(true)
  }
  for (const line of ['Net worth', `${u}00a0`, `${u}0500`, `${u}{1F600}`, `${u}2014`]) {
    expect(hasCyrillic(line), line).toBe(false)
  }
})

it('allows Cyrillic only in ru-RU.json under src/locales/ and the demo data file', () => {
  for (const file of ['src/locales/ru-RU.json', 'src/locales/advisor/ru-RU.json', 'src/demo/ru-RU.json']) expect(ALLOWED.test(file), file).toBe(true)
  for (const file of ['src/ru-RU.json', 'docs/ru-RU.json', 'src/locales/ru.json', 'src/locales/advisor/en-US.json', 'src/locales/ru-RU.json.bak', 'src/locales/xru-RU.json', 'src/demo/ru.json', 'src/demo/profiles/ru-RU.json']) {
    expect(ALLOWED.test(file), file).toBe(false)
  }
})

it('every CLEAN entry matches at least one file', () => {
  const dead = CLEAN.filter(prefix => !listed.some(file => file.startsWith(prefix)))
  expect(dead, 'CLEAN entries that match no file (renamed, moved or mistyped?)').toEqual([])
})

it('files under CLEAN contain no Cyrillic', () => {
  const hits: string[] = []
  for (const file of listed) {
    if (ALLOWED.test(file) || !CLEAN.some(prefix => file.startsWith(prefix))) continue
    if (CYRILLIC.test(file)) hits.push(`${file}: Cyrillic in the file name`)
    // a tracked file deleted in the working tree (mid-refactor) is not scanned
    if (BINARY.test(file) || !existsSync(join(ROOT, file))) continue
    readRepo(file).split('\n').forEach((line, i) => {
      if (hasCyrillic(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`)
    })
  }
  const shown = hits.slice(0, MAX_REPORTED).join('\n')
  const more = hits.length > MAX_REPORTED ? `\n... and ${hits.length - MAX_REPORTED} more` : ''
  expect(hits, `${hits.length} line(s) with Cyrillic in a CLEAN path (translate to English):\n${shown}${more}`).toEqual([])
})
