import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '../../../src/server/config'
import { nextRebuild, startDemoServer } from '../../../src/server/demo/start'
import { withTempDirs } from '../../helpers/tmp'

// registered before the afterEach below, so it runs after it: the server stops before its folder goes
const tempDir = withTempDirs('ffd-demo-start-')
let stop: (() => Promise<void>) | null = null

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}) })
afterEach(async () => {
  await stop?.()
  stop = null
})

function demoConfig() {
  return loadConfig({ AUTH_MODE: 'demo', DATA_DIR: tempDir(), PORT: '0', HOST: '127.0.0.1', CLIENT_DIR: 'does-not-exist' })
}

const readStatus = (dataDir: string) =>
  JSON.parse(readFileSync(join(dataDir, 'demo-status.json'), 'utf8')) as { live: number; draining: boolean; lastExpiresAt: number | null; updatedAt: number }

describe('startDemoServer', () => {
  it('serves sandboxes, never creates finance.sqlite, writes demo-status.json and drains on DATA_DIR/drain', async () => {
    const config = demoConfig()
    const server = await startDemoServer(config, { tickMs: 20 })
    stop = server.stop
    const base = `http://127.0.0.1:${server.port}`
    const login = () => fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'demo-family' }),
    })

    expect(readStatus(config.dataDir)).toMatchObject({ live: 0, draining: false, lastExpiresAt: null })
    const first = await login()
    expect(first.status).toBe(200)
    const cookie = first.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    const snapshot = await fetch(`${base}/api/snapshot`, { headers: { Cookie: cookie } })
    expect(snapshot.status).toBe(200)
    expect(await snapshot.json()).toMatchObject({ baseCurrency: 'USD' })
    await vi.waitFor(() => expect(readStatus(config.dataDir).live).toBe(1))

    writeFileSync(join(config.dataDir, 'drain'), '')
    await vi.waitFor(() => expect(readStatus(config.dataDir).draining).toBe(true))
    const refused = await login()
    expect(refused.status).toBe(503)
    expect(await refused.json()).toMatchObject({ error: { code: 'demo_updating' } })

    expect(existsSync(join(config.dataDir, 'finance.sqlite'))).toBe(false)
    expect(existsSync(join(config.dataDir, 'session.key'))).toBe(false)
    expect(readdirSync(join(config.dataDir, 'demo')).sort()).toEqual(['sandboxes', 'template.sqlite'])
  })

  it('deletes the sandboxes on stop', async () => {
    const config = demoConfig()
    const server = await startDemoServer(config, { tickMs: 20 })
    const res = await fetch(`http://127.0.0.1:${server.port}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'demo-family' }),
    })
    expect(res.status).toBe(200)
    expect(readdirSync(join(config.dataDir, 'demo', 'sandboxes'))).not.toEqual([])
    await server.stop()
    expect(readdirSync(join(config.dataDir, 'demo', 'sandboxes'))).toEqual([])
  })
})

describe('nextRebuild', () => {
  it('is the next 00:05 UTC', () => {
    expect(nextRebuild(new Date('2026-10-21T12:00:00Z')).toISOString()).toBe('2026-10-22T00:05:00.000Z')
    expect(nextRebuild(new Date('2026-10-21T00:04:59Z')).toISOString()).toBe('2026-10-21T00:05:00.000Z')
    expect(nextRebuild(new Date('2026-10-21T00:05:00Z')).toISOString()).toBe('2026-10-22T00:05:00.000Z')
    expect(nextRebuild(new Date('2026-12-31T23:59:00Z')).toISOString()).toBe('2027-01-01T00:05:00.000Z')
  })
})
