import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { changelogSection, commitSections, releaseBody } from '../../scripts/release-notes.mjs'

describe('scripts/release-notes.mjs', () => {
  it('takes the version section of the changelog, without its heading', () => {
    const changelog = '# Changelog\n\n## [Unreleased]\n\n- soon\n\n## [1.1.0] - 2027-01-02\n\n### Added\n\n- a thing\n\n## [1.0.0] - 2026-12-01\n\n- first\n'
    expect(changelogSection(changelog, '1.1.0')).toBe('### Added\n\n- a thing')
    expect(changelogSection(changelog, '1.0.0')).toBe('- first')
    expect(changelogSection(changelog, '2.0.0')).toBeNull()
  })

  it('groups commit subjects by type, keeps the scope and puts the rest under Other changes', () => {
    expect(commitSections([
      'feat(settings): family language on the server',
      'fix: a stable order',
      'docs: drift',
      'Merge something odd',
    ])).toBe([
      '## New', '', '- **settings:** family language on the server', '',
      '## Fixes', '', '- a stable order', '',
      '## Other changes', '', '- drift', '- Merge something odd',
    ].join('\n'))
  })

  it('leaves out empty groups', () => {
    expect(commitSections(['fix(ui): one'])).toBe('## Fixes\n\n- **ui:** one')
  })

  it('adds how to update with the lowercase image and the compare link', () => {
    const body = releaseBody({ version: '0.10.0', previousTag: 'v0.9.0', repo: 'Owner/Repo', notes: '## New\n\n- x\n' })
    expect(body).toContain('`ghcr.io/owner/repo:0.10.0`')
    expect(body).toContain('docker compose pull && docker compose up -d')
    expect(body.trimEnd().endsWith('https://github.com/Owner/Repo/compare/v0.9.0...v0.10.0')).toBe(true)
    expect(body.startsWith('## New\n\n- x\n\n## How to update')).toBe(true)
  })

  it('links the history when there is no previous tag', () => {
    expect(releaseBody({ version: '0.9.0', previousTag: null, repo: 'o/r', notes: 'n' })).toContain('https://github.com/o/r/commits/v0.9.0')
  })

  it('refuses a tag that is not vX.Y.Z', () => {
    const out = spawnSync(process.execPath, [join(__dirname, '../../scripts/release-notes.mjs'), 'latest', 'o/r'], { encoding: 'utf8' })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain('Usage')
  })
})
