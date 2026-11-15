import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** A form of their own: these draw a richer summary. */
const OWN_FORM = [
  'src/components/WarningsBanner.tsx',
  'src/components/cards/StatusCard.tsx',
  'src/components/ui/Disclosure.tsx',
  'src/pages/setup/Stepper.tsx',
]

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return tsxFiles(path)
    return entry.name.endsWith('.tsx') ? [path] : []
  })
}

const uses = tsxFiles('src').filter(path => /<details[\s>]/.test(readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\*.*$/gm, '')))

it('nothing folds outside Disclosure, so a ninth look cannot appear', () => {
  expect(uses.map(path => relative('.', path)).sort()).toEqual(OWN_FORM)
})

it('every exception draws the shared chevron, so no browser triangle returns unmarked', () => {
  for (const path of OWN_FORM) expect(readFileSync(path, 'utf8'), path).toContain('DisclosureChevron')
})
