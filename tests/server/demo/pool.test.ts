import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxPool, type OpenResult, type Sandbox, type SandboxPool } from '../../../src/server/demo/pool'
import { buildTemplate } from '../../../src/server/demo/template'
import { SCHEMA_FILE, testConfig } from '../../helpers/db'
import { withTempDirs } from '../../helpers/tmp'

// file failures on demand: a copy that dies halfway, a delete that fails for one file
const faults = vi.hoisted(() => ({ copy: false, rm: null as null | ((file: string) => boolean) }))
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    copyFileSync: (...args: Parameters<typeof fs.copyFileSync>) => {
      if (!faults.copy) return fs.copyFileSync(...args)
      fs.writeFileSync(args[1], 'half a copy')
      throw new Error('disk full')
    },
    rmSync: (...args: Parameters<typeof fs.rmSync>) => {
      if (faults.rm?.(String(args[0]))) throw new Error('EBUSY')
      return fs.rmSync(...args)
    },
  }
})

const MINUTE = 60_000
const TTL = 15 * MINUTE

let templateDir: string
let template: string
beforeAll(() => {
  templateDir = mkdtempSync(join(tmpdir(), 'demo-pool-template-'))
  template = buildTemplate({ dir: templateDir, schemaFile: SCHEMA_FILE, today: '2026-10-21' })
})
afterAll(() => { rmSync(templateDir, { recursive: true, force: true }) })

// registered before the afterEach below, so it runs after it: the pool closes and the faults clear before the folders go
const tempDir = withTempDirs('demo-pool-')
const cleanup: (() => void)[] = []
afterEach(() => {
  faults.copy = false
  faults.rm = null
  for (const f of cleanup.splice(0)) f()
})

/** A pool on a fresh directory with a clock the test moves. */
function makePool({ before, capacity = 5 }: { before?: (dir: string) => void; capacity?: number | 'default' } = {}) {
  const dir = tempDir()
  before?.(dir)
  const clock = { t: 0 }
  const pool = createSandboxPool({
    dir, templatePath: () => template, config: testConfig({ AUTH_MODE: 'demo' }, 'demo-secret'), now: () => clock.t, ...(capacity === 'default' ? {} : { capacity }),
  })
  cleanup.push(() => { pool.closeAll() })
  return { dir, clock, pool }
}

function sandbox(result: OpenResult): Sandbox {
  if (!('sandbox' in result)) throw new Error(`expected a sandbox, got ${result.error}`)
  return result.sandbox
}

const fileOf = (dir: string, s: Sandbox) => join(dir, 'sandboxes', `${s.id}.sqlite`)

function openFive(pool: SandboxPool): Sandbox[] {
  return [1, 2, 3, 4, 5].map(i => sandbox(pool.open(`v${i}`, `10.0.0.${i}`, 'en-US')))
}

describe('createSandboxPool', () => {
  it('caps a sandbox at 16 MB: a write past it answers 507 storage_full, the sandbox keeps reading', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool } = makePool()
    const { app } = sandbox(pool.open('v1', '10.0.0.1', 'en-US'))
    const post = (name: string) => app.fetch(new Request('http://localhost/api/admin/members', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    }))
    let saved = 0
    let res = await post('0'.padEnd(60_000, 'x'))
    while (res.status === 200 && saved < 1000) res = await post(`${++saved}`.padEnd(60_000, 'x'))
    expect(res.status).toBe(507)
    expect(await res.json()).toEqual({ error: { code: 'storage_full' } })
    // each name is stored three times (the row, its primary-key index, its change_log entry): 16 MB hold about 90
    expect(saved).toBeGreaterThan(80)
    expect(saved).toBeLessThan(100)
    expect((await app.fetch(new Request('http://localhost/api/admin/currencies'))).status).toBe(200)
  })

  it('a visitor may add 10 accounts to the family: the 11th answers 409 demo_account_limit, a known account still gets balances', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool } = makePool()
    const { app } = sandbox(pool.open('v1', '10.0.0.1', 'en-US'))
    const balance = (name: string, date = '2026-09-30') => app.fetch(new Request('http://localhost/api/admin/assets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, class: 'bank', name, value: 100, currency: 'USD', member: null }),
    }))
    for (let i = 1; i <= 10; i++) expect((await balance(`Extra ${i}`)).status).toBe(200)
    const refused = await balance('Extra 11')
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: { code: 'demo_account_limit' } })
    expect((await balance('Extra 1', '2026-08-31')).status).toBe(200)
  })

  it('a sandbox copies the template of the language the visitor chose: each language has its family', () => {
    const asked: string[] = []
    const pool = createSandboxPool({ dir: tempDir(), templatePath: language => { asked.push(language); return template }, config: testConfig({ AUTH_MODE: 'demo' }, 'demo-secret') })
    cleanup.push(() => { pool.closeAll() })
    sandbox(pool.open('v1', '10.0.0.1', 'ru-RU'))
    sandbox(pool.open('v2', '10.0.0.2', 'zh-CN'))
    expect(asked).toEqual(['ru-RU', 'zh-CN'])
  })

  it('signing in again with another language brings that language’s family; the same language keeps the sandbox', () => {
    const { pool } = makePool()
    const first = sandbox(pool.open('v1', '10.0.0.1', 'de-DE'))
    expect(sandbox(pool.open('v1', '10.0.0.1', 'de-DE'))).toBe(first)
    const second = sandbox(pool.open('v1', '10.0.0.1', 'zh-CN'))
    expect(second.id).not.toBe(first.id)
    expect(pool.get(first.id)).toBeNull()
    // "Start over" keeps the family, whatever the language sent
    const third = sandbox(pool.restart('v1', '10.0.0.1', 'en-US'))
    expect(pool.language(third.id)).toBe('zh-CN')
  })

  it('now is the pool clock', () => {
    const { pool, clock } = makePool()
    clock.t = 1234
    expect(pool.now()).toBe(1234)
  })

  it('holds 15 visitors by default', () => {
    const { pool } = makePool({ capacity: 'default' })
    for (let i = 1; i <= 15; i++) sandbox(pool.open(`v${i}`, `10.0.1.${i}`, 'en-US'))
    expect(pool.open('v16', '10.0.1.16', 'en-US')).toMatchObject({ error: 'demo_busy' })
  })

  it('capacity frees after expiry', () => {
    const { pool, clock } = makePool()
    openFive(pool)
    expect(pool.open('v6', '10.0.0.6', 'en-US')).toEqual({ error: 'demo_busy', retryAfter: 900 })
    clock.t = 2 * MINUTE + 500
    expect(pool.open('v6', '10.0.0.6', 'en-US')).toEqual({ error: 'demo_busy', retryAfter: 780 })
    clock.t = TTL + 1000
    pool.sweep()
    expect(pool.status().live).toBe(0)
    expect(sandbox(pool.open('v6', '10.0.0.6', 'en-US')).visitor).toBe('v6')
  })

  it('two per IP', () => {
    const { pool, clock } = makePool()
    sandbox(pool.open('A', '10.0.0.1', 'en-US'))
    clock.t = MINUTE
    sandbox(pool.open('B', '10.0.0.1', 'en-US'))
    expect(pool.open('C', '10.0.0.1', 'en-US')).toEqual({ error: 'demo_ip_limit', retryAfter: 840 })
    expect(sandbox(pool.open('D', '10.0.0.2', 'en-US')).ip).toBe('10.0.0.2')
  })

  it('same visitor reuses', () => {
    const { pool, clock } = makePool()
    const first = sandbox(pool.open('v', 'ip', 'en-US'))
    clock.t = MINUTE
    const again = sandbox(pool.open('v', 'ip', 'en-US'))
    expect(again.id).toBe(first.id)
    expect(again.expiresAt).toBe(TTL)
    expect(pool.status().live).toBe(1)
  })

  it('gives each sandbox an unguessable id and a 15-minute absolute expiry', () => {
    const { pool, clock } = makePool()
    clock.t = 1234
    const s = sandbox(pool.open('v', 'ip', 'en-US'))
    expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(s.expiresAt).toBe(1234 + TTL)
    expect(pool.get(s.id)).toBe(s)
    expect(pool.get('not-an-id')).toBeNull()
  })

  it('draining refuses new', () => {
    const { pool, clock } = makePool()
    const a = sandbox(pool.open('A', '10.0.0.1', 'en-US'))
    clock.t = 5 * MINUTE
    const b = sandbox(pool.open('B', '10.0.0.2', 'en-US'))
    pool.draining = true
    expect(pool.status()).toEqual({ live: 2, draining: true, lastExpiresAt: 5 * MINUTE + TTL })
    expect(pool.open('C', '10.0.0.3', 'en-US')).toEqual({ error: 'demo_updating', retryAfter: 900 })
    expect(pool.restart('A', '10.0.0.1', 'en-US')).toEqual({ error: 'demo_updating', retryAfter: 900 })
    expect(pool.get(a.id)).toBe(a)
    expect(pool.get(b.id)).toBe(b)
    expect(sandbox(pool.open('A', '10.0.0.1', 'en-US')).id).toBe(a.id)
    pool.draining = false
    expect(sandbox(pool.open('C', '10.0.0.3', 'en-US')).visitor).toBe('C')
  })

  it('never asks to retry in 0 seconds: draining with nothing live is 1', () => {
    const { pool } = makePool()
    pool.draining = true
    expect(pool.open('A', '10.0.0.1', 'en-US')).toEqual({ error: 'demo_updating', retryAfter: 1 })
    expect(pool.restart('A', '10.0.0.1', 'en-US')).toEqual({ error: 'demo_updating', retryAfter: 1 })
  })

  it('reports no last expiry when nothing is live', () => {
    const { pool } = makePool()
    expect(pool.status()).toEqual({ live: 0, draining: false, lastExpiresAt: null })
  })

  it('get after expiry is null', () => {
    const { pool, clock } = makePool()
    const s = sandbox(pool.open('v', 'ip', 'en-US'))
    clock.t = TTL - 1
    expect(pool.get(s.id)).toBe(s)
    clock.t = TTL
    expect(pool.get(s.id)).toBeNull()
  })

  it('restart replaces the visitor sandbox with a fresh one', () => {
    const { dir, pool, clock } = makePool()
    const old = sandbox(pool.open('v', 'ip', 'en-US'))
    clock.t = MINUTE
    const fresh = sandbox(pool.restart('v', 'ip', 'en-US'))
    expect(fresh.id).not.toBe(old.id)
    expect(fresh.expiresAt).toBe(MINUTE + TTL)
    expect(pool.get(old.id)).toBeNull()
    expect(existsSync(fileOf(dir, old))).toBe(false)
    expect(pool.status().live).toBe(1)
  })

  it('a demo sandbox opens in the language chosen at sign-in', () => {
    const { pool } = makePool()
    const ru = sandbox(pool.open('a', '10.0.0.1', 'ru-RU'))
    const en = sandbox(pool.open('b', '10.0.0.2', 'en-US'))
    expect(pool.language(ru.id)).toBe('ru-RU')
    expect(pool.language(en.id)).toBe('en-US')
  })

  it('start over keeps the sandbox language', () => {
    const { pool } = makePool()
    const old = sandbox(pool.open('v', 'ip', 'ru-RU'))
    const fresh = sandbox(pool.restart('v', 'ip', 'en-US'))
    expect(fresh.id).not.toBe(old.id)
    expect(pool.language(fresh.id)).toBe('ru-RU')
  })

  it('start over after expiry opens in the language the visitor sends', () => {
    const { pool, clock } = makePool()
    sandbox(pool.open('v', 'ip', 'ru-RU'))
    clock.t = TTL + MINUTE
    const fresh = sandbox(pool.restart('v', 'ip', 'ru-RU'))
    expect(pool.language(fresh.id)).toBe('ru-RU')
  })

  it('start over of a live sandbox keeps its language over the one sent', () => {
    const { pool } = makePool()
    sandbox(pool.open('v', 'ip', 'ru-RU'))
    const fresh = sandbox(pool.restart('v', 'ip', 'en-US'))
    expect(pool.language(fresh.id)).toBe('ru-RU')
  })

  it('restart is still subject to the capacity limit', () => {
    const { pool } = makePool()
    openFive(pool)
    expect(pool.restart('v6', '10.0.0.6', 'en-US')).toMatchObject({ error: 'demo_busy' })
    expect(sandbox(pool.restart('v1', '10.0.0.1', 'en-US')).visitor).toBe('v1')
  })

  it('restart does not count the visitor own sandbox against the per-IP cap', () => {
    const { pool } = makePool()
    const own = sandbox(pool.open('v', '10.0.0.1', 'en-US'))
    sandbox(pool.open('w', '10.0.0.1', 'en-US'))
    const fresh = sandbox(pool.restart('v', '10.0.0.1', 'en-US'))
    expect(fresh.id).not.toBe(own.id)
    expect(pool.get(own.id)).toBeNull()
  })

  it('restart refused on a full IP keeps the old sandbox', () => {
    const { pool } = makePool()
    const own = sandbox(pool.open('v', '10.0.0.1', 'en-US'))
    sandbox(pool.open('a', '10.0.0.2', 'en-US'))
    sandbox(pool.open('b', '10.0.0.2', 'en-US'))
    expect(pool.restart('v', '10.0.0.2', 'en-US')).toEqual({ error: 'demo_ip_limit', retryAfter: 900 })
    expect(pool.get(own.id)).toBe(own)
    expect(pool.status().live).toBe(3)
  })

  it('restart whose copy fails keeps the old sandbox', () => {
    const { pool } = makePool()
    const own = sandbox(pool.open('v', '10.0.0.1', 'en-US'))
    faults.copy = true
    expect(() => pool.restart('v', '10.0.0.1', 'en-US')).toThrow('disk full')
    expect(pool.get(own.id)).toBe(own)
  })

  describe('files are removed', () => {
    it('after a copy that fails halfway', () => {
      const { dir, pool } = makePool()
      faults.copy = true
      expect(() => pool.open('v', 'ip', 'en-US')).toThrow('disk full')
      expect(readdirSync(join(dir, 'sandboxes'))).toEqual([])
      expect(pool.status().live).toBe(0)
    })

    it('by a sweep that goes on past a file it cannot delete', () => {
      const { dir, pool, clock } = makePool()
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      const [first, second] = [sandbox(pool.open('a', '10.0.0.1', 'en-US')), sandbox(pool.open('b', '10.0.0.2', 'en-US'))]
      faults.rm = file => file === fileOf(dir, first)
      clock.t = TTL
      expect(() => pool.sweep()).not.toThrow()
      expect(pool.status().live).toBe(0)
      expect(existsSync(fileOf(dir, second))).toBe(false)
      expect(log).toHaveBeenCalled()
    })

    it('after expiry and a sweep', () => {
      const { dir, pool, clock } = makePool()
      const s = sandbox(pool.open('v', 'ip', 'en-US'))
      expect(existsSync(fileOf(dir, s))).toBe(true)
      clock.t = TTL + 1000
      pool.sweep()
      expect(readdirSync(join(dir, 'sandboxes'))).toEqual([])
    })

    it('on close', () => {
      const { dir, pool } = makePool()
      const s = sandbox(pool.open('v', 'ip', 'en-US'))
      pool.close(s.id)
      expect(pool.get(s.id)).toBeNull()
      expect(readdirSync(join(dir, 'sandboxes'))).toEqual([])
      pool.close(s.id)
    })

    it('on restart', () => {
      const { dir, pool } = makePool()
      const old = sandbox(pool.open('v', 'ip', 'en-US'))
      const fresh = sandbox(pool.restart('v', 'ip', 'en-US'))
      expect(readdirSync(join(dir, 'sandboxes'))).toEqual(readdirSync(join(dir, 'sandboxes')).filter(f => f.startsWith(fresh.id)))
      expect(existsSync(fileOf(dir, old))).toBe(false)
    })

    it('on closeAll', () => {
      const { dir, pool } = makePool()
      openFive(pool)
      pool.closeAll()
      expect(pool.status().live).toBe(0)
      expect(readdirSync(join(dir, 'sandboxes'))).toEqual([])
    })

    it('left over from a previous run, at construction', () => {
      const { dir } = makePool({
        before: d => {
          mkdirSync(join(d, 'sandboxes'))
          writeFileSync(join(d, 'sandboxes', 'stray.sqlite'), 'x')
          writeFileSync(join(d, 'sandboxes', 'stray.sqlite-wal'), 'x')
        },
      })
      expect(readdirSync(join(dir, 'sandboxes'))).toEqual([])
    })
  })

  it("serves the template's family from a private copy", async () => {
    const { pool } = makePool()
    const a = sandbox(pool.open('A', '10.0.0.1', 'en-US'))
    const b = sandbox(pool.open('B', '10.0.0.2', 'en-US'))
    const goals = async (s: Sandbox) => {
      const res = await s.app.fetch(new Request('http://demo.test/api/admin/goals'))
      expect(res.status).toBe(200)
      return (await res.json() as { rows: { rowid: number }[] }).rows
    }
    const [first] = await goals(a)
    expect(await goals(a)).toHaveLength(3)
    const del = await a.app.fetch(new Request(`http://demo.test/api/admin/goals/${first.rowid}`, { method: 'DELETE', headers: { Origin: 'http://demo.test' } }))
    expect(del.status).toBe(200)
    expect(await goals(a)).toHaveLength(2)
    expect(await goals(b)).toHaveLength(3)
  })
})

describe('the count of demo launches', () => {
  it('counts each sign-in that opens a sandbox, not a return to one or a start over, and keeps it across restarts', () => {
    const { dir, pool } = makePool()
    expect(pool.launches()).toBe(0)
    sandbox(pool.open('visitor-a', '10.0.0.1', 'en-US'))
    sandbox(pool.open('visitor-a', '10.0.0.1', 'en-US')) // back to the same sandbox
    sandbox(pool.restart('visitor-a', '10.0.0.1', 'en-US')) // start over: the same visit
    sandbox(pool.open('visitor-b', '10.0.0.2', 'de-DE'))
    expect(pool.launches()).toBe(2)
    pool.closeAll()
    // the next start of the server (a release) reads it back from the pool's directory
    const again = createSandboxPool({ dir, templatePath: () => template, config: testConfig({ AUTH_MODE: 'demo' }, 'demo-secret') })
    cleanup.push(() => { again.closeAll() })
    expect(again.launches()).toBe(2)
  })

  it('starts from zero when the file is missing or unreadable, never failing the demo', () => {
    const { pool } = makePool({ before: dir => { writeFileSync(join(dir, 'launches.json'), 'not json') } })
    expect(pool.launches()).toBe(0)
    sandbox(pool.open('visitor-a', '10.0.0.1', 'en-US'))
    expect(pool.launches()).toBe(1)
  })
})

describe('the launch count file', () => {
  it('is replaced whole: no temporary file is left beside it', () => {
    const { dir, pool } = makePool()
    sandbox(pool.open('visitor-a', '10.0.0.1', 'en-US'))
    expect(readdirSync(dir).filter(f => f.startsWith('launches'))).toEqual(['launches.json'])
  })
})
