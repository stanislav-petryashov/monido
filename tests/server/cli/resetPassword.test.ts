import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { run } from '../../../src/server/cli/resetPassword'
import { createTestDb } from '../../helpers/db'
import { withTempDirs } from '../../helpers/tmp'

const setting = (db: ReturnType<typeof createTestDb>, key: string) =>
  (db.sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value
const put = (db: ReturnType<typeof createTestDb>, key: string, value: string) =>
  db.sqlite.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value)

function setup(env: Record<string, string> = {}, stored: Record<string, string> = { auth_password: 'hash' }) {
  const db = createTestDb()
  for (const [k, v] of Object.entries(stored)) put(db, k, v)
  const lines: string[] = []
  const kill = vi.fn()
  const go = () => run([], { env: { DATA_DIR: '/nonexistent', ...env }, db, kill, print: l => lines.push(l) })
  return { db, lines, kill, go }
}

describe('reset-password', () => {
  it('clears the password, bumps the generation, signals pid 1 with SIGHUP and prints the 15-minute line; exit 0', async () => {
    const { db, lines, kill, go } = setup()
    const before = Number(setting(db, 'auth_generation'))
    expect(await go()).toBe(0)
    expect(setting(db, 'auth_password')).toBeUndefined()
    expect(Number(setting(db, 'auth_generation'))).toBe(before + 1)
    expect(kill).toHaveBeenCalledWith(1, 'SIGHUP')
    expect(lines.at(-1)).toBe('Open the site within 15 minutes and set the family password.')
  })

  it('prints "restart the server" when kill throws; exit 0', async () => {
    const { lines, kill, go } = setup()
    kill.mockImplementation(() => { throw new Error('ESRCH') })
    expect(await go()).toBe(0)
    expect(lines.at(-1)).toBe('Start or restart the server; the window opens at start.')
  })

  it('APP_PASSWORD in env -> exit 1, nothing written', async () => {
    const { db, lines, kill, go } = setup({ APP_PASSWORD: 'long enough pass' })
    expect(await go()).toBe(1)
    expect(setting(db, 'auth_password')).toBe('hash')
    expect(Number(setting(db, 'auth_generation'))).toBe(1)
    expect(kill).not.toHaveBeenCalled()
    expect(lines[0]).toMatch(/APP_PASSWORD is no longer supported/)
  })

  it('rejects legacy AUTH_MODE before changing stored settings', async () => {
    const { db, lines, kill, go } = setup({ AUTH_MODE: 'telegram' }, { auth_password: 'hash', auth_mode: 'telegram' })
    expect(await go()).toBe(1)
    expect(setting(db, 'auth_password')).toBe('hash')
    expect(kill).not.toHaveBeenCalled()
    expect(lines[0]).toMatch(/AUTH_MODE only accepts "none" or "demo"/)
  })

  it('a stored telegram mode goes back to password', async () => {
    const { db, go } = setup({}, { auth_password: 'hash', auth_mode: 'telegram' })
    expect(await go()).toBe(0)
    expect(setting(db, 'auth_mode')).toBe('password')
  })

  it('refuses under AUTH_MODE=none without changing the database', async () => {
    const { db, lines, kill, go } = setup({ AUTH_MODE: 'none' })
    expect(await go()).toBe(1)
    expect(setting(db, 'auth_password')).toBe('hash')
    expect(kill).not.toHaveBeenCalled()
    expect(lines[0]).toMatch(/Remove AUTH_MODE=none/)
  })

  it('AUTH_MODE=demo -> exit 1, nothing written', async () => {
    const { db, lines, kill, go } = setup({ AUTH_MODE: 'demo' })
    expect(await go()).toBe(1)
    expect(setting(db, 'auth_password')).toBe('hash')
    expect(kill).not.toHaveBeenCalled()
    expect(lines).toEqual(['Nothing to reset in AUTH_MODE=demo.'])
  })

  describe('without a database', () => {
    const tempDir = withTempDirs('ffd-reset-')
    it('no finance.sqlite in DATA_DIR -> exit 1 and no file created', async () => {
      const dir = tempDir()
      const lines: string[] = []
      expect(await run([], { env: { DATA_DIR: dir }, print: l => lines.push(l) })).toBe(1)
      expect(lines).toEqual([`No database at ${join(dir, 'finance.sqlite')}; check DATA_DIR.`])
      expect(existsSync(join(dir, 'finance.sqlite'))).toBe(false)
      expect(readdirSync(dir)).toEqual([])
    })
  })
})
