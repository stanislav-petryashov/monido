import { describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createApp } from '../../src/server/app'
import { exportBackup } from '../../src/server/backup'
import { createTestDb, testConfig } from '../helpers/db'
import { authFor } from '../helpers/auth'
import { FAMILY_PASSWORD, familyCookie, userCookie } from '../helpers/session'
import { withTempDirs } from '../helpers/tmp'

const NOW = new Date('2031-10-19T10:00:00Z')

describe('exportBackup', () => {
  const copyDir = withTempDirs('backup-test-')

  it('makes one copy at a time: a second download while one is still read is refused, the next after it works', async () => {
    const db = createTestDb()
    const first = await exportBackup(db, NOW)
    await expect(exportBackup(db, NOW)).rejects.toMatchObject({ code: 'backup_in_progress', status: 409 })
    await first.arrayBuffer()
    await vi.waitFor(async () => { const next = await exportBackup(db, NOW); await next.arrayBuffer() })
  })

  it('returns a consistent SQLite copy of the live database as an attachment', async () => {
    const db = createTestDb()
    db.sqlite.exec("INSERT INTO parameters (key, value, description) VALUES ('inflation_rate', 9.5, 'test')")

    const response = await exportBackup(db, NOW)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/vnd.sqlite3')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="finance-2031-10-19.sqlite"')
    expect(response.headers.get('Cache-Control')).toBe('no-store')

    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 15))).toBe('SQLite format 3')
    expect(response.headers.get('Content-Length')).toBe(String(bytes.length))

    const file = join(copyDir(), 'copy.sqlite')
    writeFileSync(file, bytes)
    const copy = new DatabaseSync(file)
    try {
      expect(copy.prepare("SELECT value FROM parameters WHERE key = 'inflation_rate'").get()).toEqual({ value: 9.5 })
      expect(copy.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('assets', 'app_settings', 'change_log')").get()).toEqual({ n: 3 })
    } finally {
      copy.close()
    }
  })
})

describe('GET /api/backup', () => {
  const config = testConfig({ password: FAMILY_PASSWORD })
  const auth = authFor(config)
  const app = () => createApp({ db: createTestDb(), config, auth })

  it('is closed without identity', async () => {
    expect((await app().request('/api/backup')).status).toBe(401)
  })

  it('sends the database file to a signed-in user and refuses other methods', async () => {
    const AUTH = { Cookie: await familyCookie(auth) }
    const response = await app().request('/api/backup', { headers: AUTH })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; filename="finance-\d{4}-\d{2}-\d{2}\.sqlite"$/)
    expect(new TextDecoder().decode((await response.bytes()).slice(0, 15))).toBe('SQLite format 3')
    expect((await app().request('/api/backup', { method: 'POST', headers: AUTH })).status).toBe(405)
  })

  it('is for managers: the file carries the bot token and the password hash', async () => {
    const telegram = testConfig({ mode: 'telegram', TELEGRAM_BOT_TOKEN: '1:x' })
    const runtime = authFor(telegram)
    const db = createTestDb()
    const at = '2020-01-01T00:00:00.000Z'
    const add = db.sqlite.prepare('INSERT INTO users (member, telegram_id, can_manage, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    const manager = Number(add.run('Anna', '100', 1, at, at).lastInsertRowid)
    const member = Number(add.run('Ryan', '200', 0, at, at).lastInsertRowid)
    const server = createApp({ db, config: telegram, auth: runtime })
    const get = async (id: number) => server.request('/api/backup', { headers: { Cookie: await userCookie(runtime, id) } })
    const refused = await get(member)
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: { code: 'no_right_manage' } })
    const allowed = await get(manager)
    expect(allowed.status).toBe(200)
    await allowed.bytes() // reading the body closes the stream, which removes the temp copy
  })
})

describe('backup temp copy', () => {
  const tempDir = withTempDirs('backup-tmpdir-')

  it('is removed after a GET; HEAD is refused with 405 and makes no copy', async () => {
    const config = testConfig({ password: FAMILY_PASSWORD })
    const auth = authFor(config)
    const server = createApp({ db: createTestDb(), config, auth })
    const headers = { Cookie: await familyCookie(auth) }
    const dir = tempDir()
    const saved = process.env.TMPDIR
    process.env.TMPDIR = dir // os.tmpdir() reads it on every call
    try {
      const got = await server.request('/api/backup', { headers })
      expect(got.status).toBe(200)
      expect(new TextDecoder().decode((await got.bytes()).slice(0, 15))).toBe('SQLite format 3')
      const copies = () => readdirSync(dir).filter(name => name.startsWith('finance-backup-'))
      // the folder goes when the read stream closes, a moment after the body is read
      await vi.waitFor(() => expect(copies()).toEqual([]))
      const head = await server.request('/api/backup', { method: 'HEAD', headers })
      expect(head.status).toBe(405)
      expect(copies()).toEqual([])
    } finally {
      if (saved === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = saved
    }
  })
})
