import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { isListed } from '../../scripts/set-repo.mjs'
import { withTempDirs } from '../helpers/tmp'

const ROOT = join(__dirname, '../..')
const SCRIPT = 'scripts/set-repo.mjs'
// Built from parts, so this file carries neither slug and the coverage check below need not skip it
const PLACEHOLDER = ['OWNER', 'REPO'].join('/')
const CURRENT = ['stanislav-petryashov', 'family-finance-dashboard'].join('/')

const tempDir = withTempDirs('set-repo-')

/** A temp copy of the repo root: the script plus `files` (path → content). */
function fixture(files: Record<string, string>): string {
  const dir = tempDir()
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  copyFileSync(join(ROOT, SCRIPT), join(dir, SCRIPT))
  return dir
}

function run(dir: string, ...args: string[]) {
  const out = spawnSync(process.execPath, [join(dir, SCRIPT), ...args], { cwd: tmpdir(), encoding: 'utf8' })
  return { status: out.status, stdout: out.stdout, stderr: out.stderr }
}

const read = (dir: string, path: string) => readFileSync(join(dir, path), 'utf8')

describe('scripts/set-repo.mjs', () => {
  it('replaces both slugs in the listed files and prints each file it changed', () => {
    const dir = fixture({
      'CONTRIBUTING.md': `https://github.com/${CURRENT}/issues/new/choose\n`,
      'README.md': `[CI](https://github.com/${PLACEHOLDER}/actions) and ${PLACEHOLDER} again\n`,
      'CHANGELOG.md': `[1.0.0]: https://github.com/${PLACEHOLDER}/releases/tag/v1.0.0\n`,
      'package.json': `{ "homepage": "https://github.com/${PLACEHOLDER}#readme" }\n`,
      'docker-compose.yml': `    image: ghcr.io/${CURRENT}:latest\n`,
      '.github/ISSUE_TEMPLATE/config.yml': `url: https://github.com/${PLACEHOLDER}/security/advisories/new\n`,
      'docs/maintaining.md': `https://github.com/${PLACEHOLDER}/settings and https://github.com/${CURRENT}\n`,
      'src/pages/settings/BackupView.tsx': `export const RESTORE_DOCS_URL = 'https://github.com/${CURRENT}/blob/master/docs/deploy-docker.md#backup-and-restore'\n`,
      'docs/plain.md': 'nothing to replace\n',
    })
    const result = run(dir, 'Acme-Family/Family-Finance')
    expect(result.status).toBe(0)
    expect(read(dir, 'README.md')).toBe('[CI](https://github.com/Acme-Family/Family-Finance/actions) and Acme-Family/Family-Finance again\n')
    expect(read(dir, 'CONTRIBUTING.md')).toBe('https://github.com/Acme-Family/Family-Finance/issues/new/choose\n')
    expect(read(dir, 'CHANGELOG.md')).toContain('github.com/Acme-Family/Family-Finance/releases/tag/v1.0.0')
    expect(read(dir, 'package.json')).toContain('github.com/Acme-Family/Family-Finance#readme')
    // Container image names are lowercase
    expect(read(dir, 'docker-compose.yml')).toBe('    image: ghcr.io/acme-family/family-finance:latest\n')
    expect(read(dir, '.github/ISSUE_TEMPLATE/config.yml')).toContain('github.com/Acme-Family/Family-Finance/security/advisories/new')
    expect(read(dir, 'docs/maintaining.md')).toBe('https://github.com/Acme-Family/Family-Finance/settings and https://github.com/Acme-Family/Family-Finance\n')
    // The restore link of the Backup page
    expect(read(dir, 'src/pages/settings/BackupView.tsx')).toBe(
      "export const RESTORE_DOCS_URL = 'https://github.com/Acme-Family/Family-Finance/blob/master/docs/deploy-docker.md#backup-and-restore'\n",
    )
    expect(read(dir, 'docs/plain.md')).toBe('nothing to replace\n')
    expect(result.stdout.trim().split('\n').sort()).toEqual([
      '.github/ISSUE_TEMPLATE/config.yml', 'CHANGELOG.md', 'CONTRIBUTING.md', 'README.md', 'docker-compose.yml', 'docs/maintaining.md', 'package.json', 'src/pages/settings/BackupView.tsx',
    ])
  })

  it('touches only the listed files', () => {
    const text = `see ${PLACEHOLDER}\n`
    const dir = fixture({ 'SECURITY.md': text, 'docs/nested/deep.md': text, 'src/app.ts': text })
    const result = run(dir, 'acme/finance')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    for (const path of ['SECURITY.md', 'docs/nested/deep.md', 'src/app.ts']) expect(read(dir, path)).toBe(text)
  })

  it.each([[[]], [['']], [['acme']], [['acme/finance/extra']], [['acme/my capital']], [['acme/finance', 'more']], [['https://github.com/acme/finance']]])(
    'refuses %j and changes nothing',
    args => {
      const text = `see ${PLACEHOLDER}\n`
      const dir = fixture({ 'README.md': text })
      const result = run(dir, ...args)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/owner\/repo/)
      expect(read(dir, 'README.md')).toBe(text)
    },
  )

  it('is one-shot: a second run changes nothing and says so', () => {
    const dir = fixture({ 'README.md': `see ${PLACEHOLDER}\n` })
    expect(run(dir, 'acme/finance').stdout).toBe('README.md\n')
    const again = run(dir, 'other/name')
    expect(again.status).toBe(0)
    expect(again.stdout).toBe('')
    expect(again.stderr).toMatch(/Nothing to replace/)
    expect(read(dir, 'README.md')).toBe('see acme/finance\n')
  })

  it('lists exactly the documented files', () => {
    for (const path of ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'package.json', 'docker-compose.yml', 'deploy/demo/docker-compose.demo.yml', '.github/ISSUE_TEMPLATE/config.yml', 'docs/maintaining.md', 'src/pages/settings/BackupView.tsx']) {
      expect(isListed(path), path).toBe(true)
    }
    for (const path of ['SECURITY.md', 'docs/nested/deep.md', 'docs/assets/logo.svg', 'src/app.ts', 'src/pages/settings/OtherView.tsx']) {
      expect(isListed(path), path).toBe(false)
    }
  })

  // Holds before and after the rename: once the slugs are replaced no file carries one and the list is trivially enough
  it('covers every file that carries a slug', () => {
    const files = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    expect(files.status).toBe(0)
    const unlisted = files.stdout.split('\n').filter(path => {
      if (!path || path === SCRIPT || isListed(path) || !existsSync(join(ROOT, path))) return false
      if (/\.(png|jpe?g|gif|ico|woff2?|sqlite|webp|pdf)$/i.test(path)) return false
      const text = readFileSync(join(ROOT, path), 'utf8')
      return text.includes(PLACEHOLDER) || text.includes(CURRENT)
    })
    expect(unlisted).toEqual([])
  })
})
