import { expect, it } from 'vitest'
import { readRepo, trackedFiles } from '../helpers/repoFiles'

/** Markdown in the repository: README and its translations, the docs, CONTRIBUTING, SECURITY, CHANGELOG, CLAUDE.md. */
const MARKDOWN = trackedFiles().filter(file => file.endsWith('.md'))
const DASH = '—'

/**
 * The prose of a Markdown file: blocks of real code (a fence with a language other than `text`) and inline code spans
 * removed (a UI glyph is written as `—`). Untagged and `text` blocks, the code maps of docs/architecture.md, are prose.
 */
const prose = (text: string) => text.replace(/^```(?!text\b)\w+[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '')

it('the docs use no em dash outside code: a colon, a comma, parentheses or two sentences instead', () => {
  const hits = MARKDOWN.flatMap(file => prose(readRepo(file)).split('\n')
    .flatMap(line => (line.includes(DASH) ? [`${file}: ${line.trim().slice(0, 100)}`] : [])))
  expect(hits.slice(0, 30), `${hits.length} line(s) with an em dash`).toEqual([])
})
