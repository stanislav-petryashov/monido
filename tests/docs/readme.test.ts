import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LANGUAGES, languageName } from '../../src/i18n/languages'

const ROOT = join(__dirname, '../..')
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')

const readme = read('README.md')
const maintaining = read('docs/maintaining.md')
const pkg = JSON.parse(read('package.json'))

/** The first line of every README: each UI language in its own name, linking to its README. */
const LANGUAGE_BAR = LANGUAGES.map(l => `[${languageName(l)}](${l === 'en-US' ? 'README.md' : `README.${l}.md`})`).join(' · ')
/** Every image source of a README, in order. */
/** The link reference definitions of a README, by label folded to lower case as CommonMark matches them; the first one wins. */
const definitions = (text: string) => {
  const map = new Map<string, string>()
  for (const m of text.matchAll(/^\[([^\]]+)\]: (\S+)$/gm)) if (!map.has(m[1].toLowerCase())) map.set(m[1].toLowerCase(), m[2])
  return map
}
/** The images of a README in order, inline or by reference (the README images of every language are references: see docs/translating.md) */
const images = (text: string, whole = text) => {
  const defs = definitions(whole)
  return [...text.matchAll(/!\[[^\]]*\](?:\(([^)]+)\)|\[([^\]]+)\])/g)].map(m => m[1] ?? defs.get(m[2].toLowerCase()) ?? `unresolved: ${m[2]}`)
}
/** The alt texts of the hero's badges, in order. */
const badges = (text: string) => [...text.split(/^## /m)[0].matchAll(/\[!\[([^\]]+)\]\(https:\/\/img\.shields\.io[^)]*\)\]/g)].map(m => m[1])

/** The fenced text blocks under "## Description and topics": the description, then the topics. */
const [description, topics] = [...maintaining.split(/^## Description and topics$/m)[1].split(/^## /m)[0].matchAll(/^```text\n(.+)\n```$/gm)].map(m => m[1])

describe('the README and the repository description', () => {
  it('uses one pitch everywhere, short enough for the GitHub description', () => {
    expect(description.length).toBeLessThan(120)
    const hero = readme.split(/^## /m)[0]
    expect(hero).toContain(`\n${description}\n`)
    expect(pkg.description).toBe(description)
    expect(read('scripts/screenshots.ts')).toContain(`const PITCH = '${description}'`)
  })

  it('lists the same topics as the package keywords', () => {
    expect(topics.split(' ')).toEqual(pkg.keywords)
  })

  it('has a hero with the language bar, the badges and the screenshot, in Markdown only (Weblate translates no HTML)', () => {
    const hero = readme.split(/^## /m)[0]
    expect(hero.split('\n')[0]).toBe(LANGUAGE_BAR)
    expect(badges(readme)).toEqual(['Latest release', 'License: MIT', 'Live demo'])
    expect(images(hero, readme)).toContain('docs/assets/screens/en-US/hero.webp')
    expect(readme).toContain('https://hosted.weblate.org/widget/monido/svg-badge.svg')
  })

  it('has a translated README for every other UI language, with the same bar, badges and screenshot', () => {
    for (const lang of LANGUAGES.filter(l => l !== 'en-US')) {
      const file = `README.${lang}.md`
      const text = read(file)
      expect(text.split('\n')[0], file).toBe(LANGUAGE_BAR)
      expect(badges(text), file).toEqual(badges(readme))
      expect(images(text), file).toContain(`docs/assets/screens/${lang}/hero.webp`)
      expect(text, file).not.toContain('\u2014')
      expect(text, file).toContain('https://hosted.weblate.org/engage/monido/')
      // Weblate pairs the Markdown segments by position: the same sections and images in the same order
      expect(text.match(/^## /gm)?.length, `${file}: ## sections`).toBe(readme.match(/^## /gm)?.length)
      // each README shows its own language's images (docs/assets/screens/<lang>/), in the English order
      expect(images(text), `${file}: images`).toEqual(images(readme).map(src => src.replace('screens/en-US/', `screens/${lang}/`)))
    }
  })

  it('every README lists the same image definitions: the images of every language, each a file that exists', () => {
    const block = (text: string) => text.match(/^\[screens\/.+$/gm) ?? []
    const english = block(readme)
    expect(english.length).toBe(LANGUAGES.length * 7)
    for (const line of english) expect(existsSync(join(ROOT, line.split(': ')[1])), line).toBe(true)
    for (const lang of LANGUAGES.filter(l => l !== 'en-US')) expect(block(read(`README.${lang}.md`)), lang).toEqual(english)
  })

  it('keeps tables out: configuration and commands live in docs/', () => {
    expect(readme).not.toMatch(/^\|/m)
  })

  it('has no HTML and no in-page anchor links in any README: the Weblate Markdown format keeps neither translated', () => {
    for (const lang of LANGUAGES) {
      const file = lang === 'en-US' ? 'README.md' : `README.${lang}.md`
      const prose = read(file).replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
      expect(prose, file).not.toMatch(/<\/?(?:p|a|img|table|tr|td|sub|b|br|h1|div)\b/)
      expect(prose, file).not.toMatch(/\]\(#/)
      // Weblate escapes &, < and > inside inline code (`a &amp;&amp; b` would show as written) and wraps lines over 1000
      expect(read(file).match(/`[^`\n]*[&<>][^`\n]*`/g) ?? [], file).toEqual([])
      expect(read(file).split('\n').filter(l => l.length >= 1000), file).toEqual([])
    }
  })
})
