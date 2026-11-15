// The body of a GitHub release: node scripts/release-notes.mjs <tag> [owner/repo] > notes.md
// The text comes from the `## [x.y.z]` section of CHANGELOG.md, else from the commit subjects since the previous tag
// grouped by their conventional type. "How to update" (the image and the compose commands) and the compare link are always added.
// Plain Node, no dependencies: the release workflow runs it on a bare runner.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TAG = /^v(\d+\.\d+\.\d+)$/
const GROUPS = [['feat', 'New'], ['fix', 'Fixes']]
const OTHER = 'Other changes'

/**
 * The `## [version]` section of a changelog, without its heading; null when there is none.
 * @public
 */
export function changelogSection(changelog, version) {
  const lines = changelog.split('\n')
  const start = lines.findIndex(line => line.startsWith(`## [${version}]`))
  if (start === -1) return null
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  const body = lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim()
  return body || null
}

/**
 * Commit subjects grouped by their conventional type: `feat` → New, `fix` → Fixes, everything else → Other changes;
 * `type(scope): text` becomes `**scope:** text`. Empty groups are left out.
 * @public
 */
export function commitSections(subjects) {
  const groups = new Map([...GROUPS.map(([, title]) => [title, []]), [OTHER, []]])
  for (const subject of subjects) {
    const m = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/.exec(subject)
    const title = (m && GROUPS.find(([type]) => type === m[1])?.[1]) ?? OTHER
    groups.get(title).push(m ? `- ${m[2] ? `**${m[2]}:** ` : ''}${m[3]}` : `- ${subject}`)
  }
  return [...groups].filter(([, items]) => items.length).map(([title, items]) => `## ${title}\n\n${items.join('\n')}`).join('\n\n')
}

/**
 * The whole release body: the notes, then how to update and the compare link.
 * @public
 */
export function releaseBody({ version, previousTag, repo, notes }) {
  const image = `ghcr.io/${repo.toLowerCase()}:${version}`
  const update = [
    '## How to update',
    '',
    `The image is \`${image}\`; \`latest\` always points to the newest release. Next to your \`docker-compose.yml\`:`,
    '',
    '```bash',
    'docker compose pull && docker compose up -d',
    '```',
  ].join('\n')
  const compare = previousTag
    ? `**Full changelog:** https://github.com/${repo}/compare/${previousTag}...v${version}`
    : `**Full history:** https://github.com/${repo}/commits/v${version}`
  return `${notes.trim()}\n\n${update}\n\n${compare}\n`
}

// stderr is dropped: `git describe` on the first tag fails by design and must not clutter the notes' log
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

function previousTagOf(tag) {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v*.*.*', `${tag}^`)
  } catch {
    return null // the first tag
  }
}

function notesFor(tag, version, previousTag) {
  const changelog = join(ROOT, 'CHANGELOG.md')
  const section = existsSync(changelog) ? changelogSection(readFileSync(changelog, 'utf8'), version) : null
  if (section) return section
  const range = previousTag ? `${previousTag}..${tag}` : tag
  const subjects = git('log', '--no-merges', '--format=%s', range).split('\n').filter(Boolean)
  return commitSections(subjects)
}

function main([tag, repo = process.env.GITHUB_REPOSITORY]) {
  const version = TAG.exec(tag ?? '')?.[1]
  if (!version || !repo) {
    console.error('Usage: node scripts/release-notes.mjs vX.Y.Z [owner/repo]  (or set GITHUB_REPOSITORY)')
    process.exit(1)
  }
  const previousTag = previousTagOf(tag)
  process.stdout.write(releaseBody({ version, previousTag, repo, notes: notesFor(tag, version, previousTag) }))
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
