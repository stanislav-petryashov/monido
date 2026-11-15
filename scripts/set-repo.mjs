// Points the repository at its final GitHub slug: node scripts/set-repo.mjs <owner/repo>
// Replaces the placeholder slug and the slug the project was first published under (so the compose image follows)
// in the files below, and prints every file it changed. Container image names are lowercase, so the
// ghcr.io/… references get the slug in lowercase. Plain Node, no dependencies: run it right after cloning.
// One-shot: once the slugs are replaced there is nothing left for a second run to find.
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SLUGS = ['OWNER/REPO', 'stanislav-petryashov/family-finance-dashboard']
const FILES = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'package.json', 'docker-compose.yml', 'deploy/demo/docker-compose.demo.yml', '.github/ISSUE_TEMPLATE/config.yml', 'src/pages/settings/BackupView.tsx', 'src/lib/imageRepo.ts']
const DOCS_DIR = 'docs'
const SLUG = /^[\w.-]+\/[\w.-]+$/

/**
 * Whether the script rewrites this repository-relative path: one of FILES or a top-level docs/*.md.
 * @public
 */
export function isListed(path) {
  return FILES.includes(path) || new RegExp(`^${DOCS_DIR}/[^/]+\\.md$`).test(path)
}

/** Replaces both slugs with `slug` in the listed files under `root`; returns the paths it changed. */
function setRepo(root, slug) {
  const docs = existsSync(join(root, DOCS_DIR))
    ? readdirSync(join(root, DOCS_DIR), { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => `${DOCS_DIR}/${entry.name}`)
      .sort()
    : []
  const changed = []
  for (const path of [...FILES, ...docs]) {
    const file = join(root, path)
    if (!existsSync(file)) continue
    const before = readFileSync(file, 'utf8')
    let after = before
    for (const old of SLUGS) {
      after = after.replaceAll(`ghcr.io/${old}`, `ghcr.io/${slug.toLowerCase()}`).replaceAll(old, slug)
    }
    if (after === before) continue
    writeFileSync(file, after)
    changed.push(path)
  }
  return changed
}

/** The CLI runs only when this file is the entry point (real paths: tmp dirs and checkouts may sit behind a symlink). */
function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  const args = process.argv.slice(2)
  if (args.length !== 1 || !SLUG.test(args[0])) {
    console.error('Usage: node scripts/set-repo.mjs <owner/repo>  (for example: node scripts/set-repo.mjs acme/family-finance)')
    process.exit(1)
  }
  const changed = setRepo(resolve(dirname(fileURLToPath(import.meta.url)), '..'), args[0])
  for (const path of changed) console.log(path)
  if (!changed.length) console.error('Nothing to replace: no listed file carries the placeholder or the first published slug (the script is one-shot).')
}
