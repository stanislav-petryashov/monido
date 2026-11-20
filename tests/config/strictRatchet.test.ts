import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A folder enters tsconfig.strict.json once it is clean under noUncheckedIndexedAccess and never leaves: add it here too.
const RATCHET = ['src/domain', 'src/i18n', 'src/demo']

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as { include?: string[]; references?: { path: string }[] }

describe('strict TypeScript ratchet', () => {
  it('keeps every folder that has entered it', () => {
    expect(read('tsconfig.strict.json').include).toEqual(expect.arrayContaining(RATCHET))
  })

  it('is part of tsc -b', () => {
    expect(read('tsconfig.json').references).toContainEqual({ path: './tsconfig.strict.json' })
  })
})
