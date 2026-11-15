import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const ROOT = join(__dirname, '../..')

/** The Markdown a reader sees on GitHub: the root documents, docs/*.md and the PR template. */
const FILES = [
  'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', '.github/pull_request_template.md',
  ...readdirSync(join(ROOT, 'docs')).filter(f => f.endsWith('.md')).map(f => `docs/${f}`),
]

/** The text without fenced blocks, where a `#` line is not a heading. */
const unfenced = (text: string) => text.replace(/^```[\s\S]*?^```/gm, '')

/** The text without fenced blocks and inline code, where a bracket or a path is not a link. */
const prose = (text: string) => unfenced(text).replace(/`[^`\n]*`/g, '')

/** Link targets: Markdown `[text](target)` and HTML `href` / `src`. */
function targets(text: string): string[] {
  const body = prose(text)
  return [
    ...[...body.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(m => m[1]),
    ...[...body.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(m => m[1]),
  ]
}

/** GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens; inline code keeps its text, not its backticks. */
function anchors(markdown: string): Set<string> {
  const headings = unfenced(markdown).match(/^#{1,6} .+$/gm) ?? []
  return new Set(headings.map(h => h.replace(/^#+ /, '').replace(/`/g, '').toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-')))
}

describe('heading anchors', () => {
  it('slug a heading as GitHub does: inline code keeps its text; a heading in a fenced block is none', () => {
    const markdown = ['### `demo`', '## Sign-in settings in the app', '## The `AUTH_MODE` line, v2.0', '```', '# not a heading', '```'].join('\n')
    expect([...anchors(markdown)]).toEqual(['demo', 'sign-in-settings-in-the-app', 'the-auth_mode-line-v20'])
  })
})

describe('relative links in the Markdown docs', () => {
  it.each(FILES)('%s: every relative link points at an existing file and heading', file => {
    const text = readFileSync(join(ROOT, file), 'utf8')
    const broken = targets(text)
      .filter(t => !/^[a-z]+:/i.test(t))
      .filter(t => {
        const [path, hash] = t.split('#')
        const target = path ? join(ROOT, dirname(file), decodeURI(path)) : join(ROOT, file)
        if (relative(ROOT, target).startsWith('..') || !existsSync(target)) return true
        if (!hash || !statSync(target).isFile() || !target.endsWith('.md')) return false
        return !anchors(readFileSync(target, 'utf8')).has(hash)
      })
    expect(broken).toEqual([])
  })
})
