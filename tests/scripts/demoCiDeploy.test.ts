import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTempDirs } from '../helpers/tmp'

const SCRIPT = join(__dirname, '../../deploy/demo/demo-ci-deploy.sh')

const tempDir = withTempDirs('demo-ci-')

/** Runs a copy of the forced command next to a fake demo-update.sh that logs its arguments and exits with `code`. */
function run(command: string | undefined, code = 0) {
  const dir = tempDir()
  const log = join(dir, 'log')
  copyFileSync(SCRIPT, join(dir, 'demo-ci-deploy.sh'))
  chmodSync(join(dir, 'demo-ci-deploy.sh'), 0o755)
  writeFileSync(join(dir, 'demo-update.sh'), `#!/bin/sh\necho "$*" >> "${log}"\nexit ${code}\n`)
  chmodSync(join(dir, 'demo-update.sh'), 0o755)
  const env: Record<string, string> = { PATH: process.env.PATH ?? '' }
  if (command !== undefined) env.SSH_ORIGINAL_COMMAND = command
  const result = spawnSync('bash', [join(dir, 'demo-ci-deploy.sh')], { cwd: tmpdir(), env, encoding: 'utf8' })
  return { ...result, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] }
}

describe('demo-ci-deploy.sh', () => {
  it('runs demo-update.sh with the release tag of the workflow command', () => {
    const r = run("cd 'demo-rc' && ./demo-update.sh 'v1.2.3'")
    expect(r.status).toBe(0)
    expect(r.calls).toEqual(['v1.2.3'])
  })

  it('passes on the exit code (3: the pull failed, the workflow retries)', () => {
    expect(run("./demo-update.sh 'v1.2.3'", 3).status).toBe(3)
  })

  it('refuses a command without a release tag and runs nothing', () => {
    for (const command of [undefined, 'rm -rf /', "./demo-update.sh 'v1.2.3-rc.1'", "./demo-update.sh 'xv1.2.3'"]) {
      const r = run(command)
      expect(r.status).toBe(2)
      expect(r.calls).toEqual([])
    }
  })

  it('never runs the requested command itself', () => {
    const r = run("touch /tmp/demo-ci-pwned; ./demo-update.sh 'v1.2.3'")
    expect(r.calls).toEqual(['v1.2.3'])
    expect(existsSync('/tmp/demo-ci-pwned')).toBe(false)
  })
})
