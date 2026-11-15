import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ROOT, readRepo, trackedFiles } from '../helpers/repoFiles'

/**
 * Hashes (first 16 hex of sha256) of lowercase tokens that must not appear anywhere in the repository:
 * the owner's private identifiers (domain, host names) and the names and tickers of the real banks,
 * brokers and securities the fixtures used to carry, in Latin and Cyrillic spellings. It does not cover
 * first names or generic words (the demo family's names are kept apart by the designTokens test).
 * The list comes from the `PRIVACY_DENY` secret (comma-separated hashes), so the repository does not carry even
 * the hashes: a short unsalted hash of a guessable value gives the value away. CI fails without it, a local run
 * skips the scan.
 */
const DENY: ReadonlySet<string> = new Set(
  (process.env.PRIVACY_DENY ?? '').split(',').map(h => h.trim()).filter(Boolean),
)

const BINARY = /\.(png|jpe?g|gif|ico|woff2?|sqlite|webp|pdf)$/i
const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}._@-]*/gu
const PART = /[\p{L}\p{N}]+/gu
/** A denied value has at most this many parts (a domain has three); longer runs are not hashed. */
const MAX_RUN = 8
const MAX_REPORTED = 50

const hash = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 16)

interface Hit { hash: string; start: number; end: number }

/**
 * Denied runs in `text`. A token is a word with inner `. _ @ -` (an email, a host name, a path piece);
 * every contiguous run of its parts is hashed (a.b.c gives a, b, c, a.b, b.c, a.b.c), so a value is found
 * inside an address or a longer host name and at the end of a sentence. Offsets index the original text.
 */
function scan(text: string, deny: ReadonlySet<string> = DENY): Hit[] {
  const lower = text.toLowerCase()
  const hits: Hit[] = []
  for (const token of lower.matchAll(TOKEN)) {
    const parts = [...token[0].matchAll(PART)]
    for (let i = 0; i < parts.length; i++) {
      for (let j = i; j < Math.min(parts.length, i + MAX_RUN); j++) {
        const start = parts[i].index
        const end = parts[j].index + parts[j][0].length
        const h = hash(token[0].slice(start, end))
        if (deny.has(h)) hits.push({ hash: h, start: token.index + start, end: token.index + end })
      }
    }
  }
  return hits
}

/**
 * Hashes of the denied values in `text` (the real list unless the self-test passes its own).
 * @public
 */
export function findDenied(text: string, deny: ReadonlySet<string> = DENY): string[] {
  return scan(text, deny).map(h => h.hash)
}

/** `text` with every denied run replaced by `***`: safe to print. */
function mask(text: string, deny: ReadonlySet<string> = DENY): string {
  let out = ''
  let at = 0
  for (const h of scan(text, deny).sort((a, b) => a.start - b.start)) {
    if (h.start < at) continue
    out += text.slice(at, h.start) + '***'
    at = h.end
  }
  return out + text.slice(at)
}

/** Tracked files plus new ones not yet added, minus ignored ones: the set a commit could publish. */
const listed = trackedFiles()

// The self-test denies two fictional values of the same shapes as the real list (a bank's short name, a three-part
// domain) by their hashes, so the scanning and masking are checked without this file holding a real value.
const FAKE_BANK = 'quillmark'
const FAKE_DOMAIN = 'ledger.harborline.test'
const FAKE: ReadonlySet<string> = new Set([hash(FAKE_BANK), hash(FAKE_DOMAIN)])

// ci.yml sets it true everywhere but a fork's pull request, which never gets the secret
if (process.env.PRIVACY_REQUIRED === 'true') {
  it('CI has the PRIVACY_DENY secret', () => {
    expect(DENY.size, 'PRIVACY_DENY is missing or empty: pass the repository secret to the check job\'s env').toBeGreaterThan(0)
  })
}

// locally the list is usually absent: the scan skips (CI runs it); export PRIVACY_DENY to run it here
const withList = DENY.size > 0 ? it : it.skip

withList('the real list holds hashes only: 16 lowercase hex each', () => {
  expect([...DENY].filter(h => !/^[0-9a-f]{16}$/.test(h))).toEqual([])
})

it('finds a denied token and nothing else', () => {
  expect(findDenied('xx Quillmark yy', FAKE)).toEqual([hash(FAKE_BANK)])
  expect(findDenied(FAKE_DOMAIN, FAKE)).toEqual([hash(FAKE_DOMAIN)])
  expect(findDenied('Shared', FAKE)).toEqual([])
  // inside an address, a longer host name, at the end of a sentence, glued to a separator
  expect(findDenied(`me@${FAKE_DOMAIN}`, FAKE)).toHaveLength(1)
  expect(findDenied(`www.${FAKE_DOMAIN}/path`, FAKE)).toHaveLength(1)
  expect(findDenied(`Visit ${FAKE_DOMAIN}.`, FAKE)).toHaveLength(1)
  expect(findDenied('see quillmark.', FAKE)).toHaveLength(1)
  expect(findDenied(`x_${FAKE_DOMAIN}-`, FAKE)).toHaveLength(1)
  // a part of the domain alone, and an unrelated address, are not the denied value
  expect(findDenied('harborline.test, me@example.com, www.example.com.', FAKE)).toEqual([])
})

it('masks a denied value so a message never prints it', () => {
  const masked = mask('src/quillmark/a.ts', FAKE)
  expect(masked).toBe('src/***/a.ts')
  expect(findDenied(masked, FAKE)).toEqual([])
})

withList('no file name or content holds a denied value', () => {
  const hits: string[] = []
  listed.forEach((file, index) => {
    // the path is printed masked: a file name can hold the value itself
    const shownPath = mask(file)
    for (const h of findDenied(file)) hits.push(`file #${index} ${shownPath}: file name, hash ${h}`)
    // a tracked file deleted in the working tree (mid-refactor) is not scanned
    if (BINARY.test(file) || !existsSync(join(ROOT, file))) return
    readRepo(file).split('\n').forEach((line, i) => {
      for (const h of findDenied(line)) hits.push(`${shownPath}:${i + 1}: hash ${h}`)
    })
  })
  const shown = hits.slice(0, MAX_REPORTED).join('\n')
  const more = hits.length > MAX_REPORTED ? `\n... and ${hits.length - MAX_REPORTED} more` : ''
  expect(hits, `${hits.length} denied value(s) (replace with a neutral word or a fictional value):\n${shown}${more}`).toEqual([])
})
