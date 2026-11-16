import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LANGUAGES, languageName } from '../../src/i18n/languages'

const ROOT = join(__dirname, '../..')
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')

const readme = read('README.md')
const maintaining = read('docs/maintaining.md')
const pkg = JSON.parse(read('package.json'))

/** The first line of every README: each UI language in its own name, linking to its README. */
const LANGUAGE_BAR = `<p align="center">${LANGUAGES.map(l => `<a href="${l === 'en-US' ? 'README.md' : `README.${l}.md`}">${languageName(l)}</a>`).join(' · ')}</p>`
/** The alt texts of the hero's badges, in order. */
const badges = (text: string) => [...text.split(/^## /m)[0].matchAll(/<img src="https:\/\/img\.shields\.io[^"]*" alt="([^"]+)">/g)].map(m => m[1])

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

  it('has a centred hero with the language bar, the badges and the screenshot', () => {
    const hero = readme.split(/^## /m)[0]
    expect(hero).toMatch(/^<p align="center">/)
    expect(hero.split('\n')[0]).toBe(LANGUAGE_BAR)
    expect(badges(readme)).toEqual(['Latest release', 'CI', 'License: MIT', 'Last commit', 'Docker image', 'Live demo', 'MCP Registry'])
    expect(hero).toContain('src="docs/assets/screenshot.png"')
    expect(readme).toContain('https://hosted.weblate.org/widget/monido/svg-badge.svg')
  })

  it('has a translated README for every other UI language, with the same bar, badges and screenshot', () => {
    for (const lang of LANGUAGES.filter(l => l !== 'en-US')) {
      const file = `README.${lang}.md`
      const text = read(file)
      expect(text.split('\n')[0], file).toBe(LANGUAGE_BAR)
      expect(badges(text), file).toEqual(badges(readme))
      expect(text, file).toContain('src="docs/assets/screenshot.png"')
      expect(text, file).not.toContain('\u2014')
      expect(text, file).toContain('https://hosted.weblate.org/engage/monido/')
    }
  })

  it('keeps tables out: configuration and commands live in docs/', () => {
    expect(readme).not.toMatch(/^\|/m)
  })
})
