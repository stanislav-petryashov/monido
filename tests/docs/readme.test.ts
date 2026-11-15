import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '../..')
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')

const readme = read('README.md')
const maintaining = read('docs/maintaining.md')
const pkg = JSON.parse(read('package.json'))

/** The fenced text blocks under "## Description and topics": the description, then the topics. */
const [description, topics] = [...maintaining.split(/^## Description and topics$/m)[1].split(/^## /m)[0].matchAll(/^```text\n(.+)\n```$/gm)].map(m => m[1])

describe('the README and the repository description', () => {
  it('uses one pitch everywhere, short enough for the GitHub description', () => {
    expect(description.length).toBeLessThan(120)
    const hero = readme.split(/^## /m)[0]
    expect(hero).toContain(`\n  ${description}\n`)
    expect(pkg.description).toBe(description)
    expect(read('scripts/screenshots.ts')).toContain(`const PITCH = '${description}'`)
  })

  it('lists the same topics as the package keywords', () => {
    expect(topics.split(' ')).toEqual(pkg.keywords)
  })

  it('has a centred hero with exactly three badges and the screenshot', () => {
    const hero = readme.split(/^## /m)[0]
    expect(hero).toMatch(/^<p align="center">/)
    expect(hero.match(/img\.shields\.io/g)).toHaveLength(3)
    expect(hero).toContain('src="docs/assets/screenshot.png"')
  })

  it('keeps tables out: configuration and commands live in docs/', () => {
    expect(readme).not.toMatch(/^\|/m)
  })
})
