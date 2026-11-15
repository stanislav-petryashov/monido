import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { withTempDirs } from '../helpers/tmp'

const SCRIPT = join(__dirname, '../../deploy/demo/demo-update.sh')

const tempDir = withTempDirs('demo-update-')

/**
 * Runs the real script with a fake `docker` first on PATH: it appends its arguments (and the DEMO_TAG it sees) to a log,
 * answers `cat` with the next status, and fails `pull`, `up --wait` or `rm` when asked.
 */
function run(args: string[], { statuses, failPull = false, failUp = false, failRm = false, health = 'healthy', env = {} }: {
  statuses: string[]; failPull?: boolean; failUp?: boolean; failRm?: boolean; health?: string; env?: Record<string, string>
}) {
  const dir = tempDir()
  const log = join(dir, 'log')
  const seq = join(dir, 'seq')
  writeFileSync(log, '')
  writeFileSync(seq, statuses.join('\n') + '\n')
  writeFileSync(join(dir, 'docker'), `#!/bin/sh
echo "$DEMO_TAG|$*" >> "${log}"
case "$*" in
  *" pull"*) ${failPull ? 'exit 1' : 'exit 0'} ;;
  *" up -d"*) ${failUp || health !== 'healthy' ? 'exit 1' : 'exit 0'} ;;
  *" rm -f "*) ${failRm ? 'exit 1' : 'exit 0'} ;;
  *" cat "*) head -n 1 "${seq}"; sed -i.bak '1d' "${seq}" 2>/dev/null || { tail -n +2 "${seq}" > "${seq}.new"; mv "${seq}.new" "${seq}"; } ;;
esac
exit 0
`)
  chmodSync(join(dir, 'docker'), 0o755)
  const result = spawnSync('bash', [SCRIPT, ...args], {
    env: { PATH: `${dir}:${process.env.PATH}`, DEMO_POLL_SECONDS: '0', ...env },
    encoding: 'utf8',
    timeout: 10_000,
  })
  const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
  return { ...result, calls }
}

const STATUS = (live: number) => `{"live":${live},"draining":true,"lastExpiresAt":null,"updatedAt":1}`

describe('deploy/demo/demo-update.sh', () => {
  it('pulls, drains, waits for live 0, recreates and clears the flag, in order', () => {
    const r = run(['v9.9.9'], { statuses: [STATUS(1), STATUS(0)] })
    expect(r.status).toBe(0)
    const cmds = r.calls.map(c => c.split('|')[1])
    expect(cmds).toEqual([
      'compose -f docker-compose.demo.yml pull demo',
      'compose -f docker-compose.demo.yml exec -T demo touch /data/drain',
      'compose -f docker-compose.demo.yml exec -T demo cat /data/demo-status.json',
      'compose -f docker-compose.demo.yml exec -T demo cat /data/demo-status.json',
      'compose -f docker-compose.demo.yml up -d --no-deps --wait --wait-timeout 180 demo',
      'compose -f docker-compose.demo.yml exec -T demo rm -f /data/drain',
    ])
    // the tag is the image tag without the leading v (the workflow publishes 9.9.9)
    expect(r.calls.every(c => c.startsWith('9.9.9|'))).toBe(true)
  })

  it('accepts a status with spaces around the colons', () => {
    const r = run(['1.2.3'], { statuses: ['{ "live": 0, "draining": true }'] })
    expect(r.status).toBe(0)
    expect(r.calls.filter(c => c.includes(' cat '))).toHaveLength(1)
  })

  it('does not trust a live 0 written before draining began', () => {
    const r = run(['v9.9.9'], { statuses: [STATUS(0).replace('true', 'false'), '{ "live": 0 }', STATUS(0)] })
    expect(r.status).toBe(0)
    expect(r.calls.filter(c => c.includes(' cat '))).toHaveLength(3)
  })

  it('clears the drain flag and fails when up -d fails', () => {
    const r = run(['v9.9.9'], { statuses: [STATUS(0)], failUp: true })
    expect(r.status).toBe(1)
    expect(r.calls[r.calls.length - 1]).toContain('rm -f /data/drain')
    expect(r.calls.some(c => c.includes(' up -d --no-deps --wait '))).toBe(true)
  })

  it('fails when the new container does not become healthy in time', () => {
    const r = run(['v9.9.9'], { statuses: [STATUS(0)], health: 'unhealthy', env: { DEMO_HEALTH_SECONDS: '17' } })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/failed|healthy/)
    expect(r.calls.some(c => c.endsWith('--wait-timeout 17 demo'))).toBe(true)
    expect(r.calls.at(-1)).toContain('rm -f /data/drain')
    expect(r.stdout).not.toMatch(/Done/)
  })

  it('fails when the drain flag cannot be cleared after the recreate', () => {
    const r = run(['v9.9.9'], { statuses: [STATUS(0)], failRm: true })
    expect(r.status).toBe(1)
    expect(r.calls.filter(c => c.includes('rm -f /data/drain'))).toHaveLength(10)
    expect(r.calls.some(c => c.includes('inspect'))).toBe(false)
  })

  it('stops on a failed pull without touching the running container, with exit code 3 (the one the workflow retries)', () => {
    const r = run(['v9.9.9'], { statuses: [STATUS(0)], failPull: true })
    expect(r.status).toBe(3)
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]).toContain(' pull')
  })

  it('proceeds with a warning when sessions outlast the limit', () => {
    const r = run(['v9.9.9'], { statuses: Array(50).fill(STATUS(1)), env: { DEMO_WAIT_SECONDS: '0' } })
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(/warning/i)
    expect(r.calls.some(c => c.includes(' up -d --no-deps --wait '))).toBe(true)
  })

  it.each(['0', '-1', 'invalid'])('rejects health timeout %s before touching the demo', timeout => {
    const r = run(['v9.9.9'], { statuses: [STATUS(0)], env: { DEMO_HEALTH_SECONDS: timeout } })
    expect(r.status).toBe(2)
    expect(r.calls).toHaveLength(0)
  })

  it('needs a tag', () => {
    const r = run([], { statuses: [] })
    expect(r.status).not.toBe(0)
    expect(r.calls).toHaveLength(0)
  })
})
