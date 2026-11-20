import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, readRepo } from '../helpers/repoFiles'

const headings = (md: string) => md.split('\n').filter(l => /^#{2,3} /.test(l)).map(l => l.replace(/^#+ /, '').trim())

// One source for the design rules: docs/design-system.md. DESIGN.md is the impeccable skill's local summary of the visual
// world (gitignored, tokens in its frontmatter); a rule copied there drifts, as "Settings: approved task-screen pattern" did.
// It is checked where the file exists, on a developer's machine.
describe('the design documents', () => {
  it.skipIf(!existsSync(join(ROOT, 'DESIGN.md')))('DESIGN.md copies no section of docs/design-system.md and points to it for the rules', () => {
    const design = readRepo('DESIGN.md')
    const system = new Set(headings(readRepo('docs/design-system.md')))
    expect(headings(design).filter(h => system.has(h))).toEqual([])
    expect(design).toMatch(/docs\/design-system\.md/)
  })
})
