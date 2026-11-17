// The demo's sandboxes: each visitor gets a private file copy of the template with its own app instance, for 15 minutes
// from sign-in. The pool limits how many live at once and per client IP, expires them and deletes their files.
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createApp } from '../app'
import { demoAuthRuntime } from '../authSettings'
import type { AppConfig } from '../config'
import { openDatabase, type SqliteDatabase } from '../db'
import { FALLBACK_LANGUAGE, languageOr, type Language } from '../../i18n/languages'
import { removeDatabaseFile } from './template'

export interface Sandbox {
  /** random and unguessable: the demo router keeps it in a signed cookie */
  id: string
  visitor: string
  ip: string
  /** absolute, from sign-in; activity does not extend it */
  expiresAt: number
  app: { fetch(req: Request): Response | Promise<Response> }
}

/** A sandbox's database stops growing here (the template is about 0.2 MB): a write past it fails with SQLITE_FULL. */
const MAX_SANDBOX_BYTES = 16 * 1024 * 1024

type Refusal = 'demo_busy' | 'demo_ip_limit' | 'demo_updating'

/** retryAfter: whole seconds until the expiry that would let the request through (for draining: the last one). */
export type OpenResult = { sandbox: Sandbox } | { error: Refusal; retryAfter: number }

export interface SandboxPool {
  /**
   * The visitor's live sandbox when it holds `language`'s family, else a new one with it (replacing the old one once it
   * exists) if the drain, the per-IP cap and the capacity allow it; a refusal keeps the old one.
   */
  open(visitor: string, ip: string, language: Language): OpenResult
  /** The language whose family the visitor's live sandbox holds; null — no live sandbox */
  familyOf(visitor: string): Language | null
  /** The family language stored in a live sandbox (what the visitor chose at sign-in); English if it is gone. */
  language(id: string): Language
  /** A live sandbox; an expired one is closed here and is null even before the sweep. */
  get(id: string): Sandbox | null
  close(id: string): void
  /**
   * "Start over": the visitor's sandbox is replaced by a fresh one with the same family — a live sandbox's own, else
   * `language` (the browser's, once the old one expired); a refusal (draining, caps) keeps the old one.
   */
  restart(visitor: string, ip: string, language: Language): OpenResult
  /** How many sign-ins opened a sandbox since the demo was first started (kept in the pool's directory across restarts) */
  launches(): number
  /** Closes every expired sandbox; the server runs it every minute. */
  sweep(): void
  /** The pool's clock (epoch ms): the router sends it with expiresAt, so the browser can count on its own clock. */
  now(): number
  /** While true, new sandboxes are refused with demo_updating; live ones keep working until they expire. */
  draining: boolean
  status(): { live: number; draining: boolean; lastExpiresAt: number | null }
  closeAll(): void
}

/** A sandbox with what the pool needs to close it. */
interface Entry {
  sandbox: Sandbox
  db: SqliteDatabase
  file: string
  /** The language whose family the sandbox was copied from (the visitor may switch the UI language inside it later) */
  family: Language
}

interface PoolOptions {
  /** the pool's directory; sandboxes live in dir/sandboxes */
  dir: string
  /** The template database of a language's family; read at every open, so a rebuilt template is picked up by the next sandbox */
  templatePath: (language: Language) => string
  /** the demo config, sessionSecret already set */
  config: AppConfig
  capacity?: number
  perIp?: number
  ttlMs?: number
  /** the size cap of a sandbox's database file; tests lower it */
  maxBytes?: number
  now?: () => number
}

/** Removes any sandbox files left by a previous run, then starts empty. */
export function createSandboxPool({
  dir, templatePath, config, capacity = 15, perIp = 2, ttlMs = 15 * 60_000, maxBytes = MAX_SANDBOX_BYTES, now = Date.now,
}: PoolOptions): SandboxPool {
  const sandboxDir = path.join(dir, 'sandboxes')
  rmSync(sandboxDir, { recursive: true, force: true })
  mkdirSync(sandboxDir, { recursive: true })
  const entries = new Map<string, Entry>()
  // the count of launches lives beside the sandboxes, outside the folder a start clears; a missing or broken file is 0
  const launchesFile = path.join(dir, 'launches.json')
  let launches = 0
  try {
    const stored = (JSON.parse(readFileSync(launchesFile, 'utf8')) as { count?: unknown }).count
    if (typeof stored === 'number' && Number.isSafeInteger(stored) && stored > 0) launches = stored
  } catch { /* first start, or an unreadable file: count from 0 */ }
  const countLaunch = () => {
    launches++
    // a write that fails loses one count, never a visitor's sandbox
    try { writeFileSync(launchesFile, JSON.stringify({ count: launches })) } catch (error) { console.error('[demo] could not save the launch count', error) }
  }

  /** every sandbox the pool holds, expired ones too until a sweep */
  const held = () => [...entries.values()].map(e => e.sandbox)
  const expired = (s: Sandbox) => now() >= s.expiresAt
  // at least 1: a client told to retry in 0 seconds would retry at once (draining with nothing live)
  const secondsUntil = (expiresAt: number) => Math.max(1, Math.ceil((expiresAt - now()) / 1000))
  const lastExpiry = (list: Sandbox[]) => (list.length ? Math.max(...list.map(s => s.expiresAt)) : null)

  function close(id: string): void {
    const entry = entries.get(id)
    if (!entry) return
    entries.delete(id)
    try { entry.db.close() } catch { /* already closed: the file still goes */ }
    // a file that cannot go now is logged and left: the next start clears dir/sandboxes, and the sweep goes on
    try { removeDatabaseFile(entry.file) } catch (error) { console.error('[demo] could not delete', entry.file, error) }
  }

  function sweep(): void {
    for (const s of held()) if (expired(s)) close(s.id)
  }

  function create(visitor: string, ip: string, language: Language): Sandbox {
    const id = randomUUID()
    const file = path.join(sandboxDir, `${id}.sqlite`)
    let db: SqliteDatabase
    try {
      // a copy that fails halfway leaves its part behind: it is deleted like a database that will not open
      copyFileSync(templatePath(language), file)
      db = openDatabase(file)
    } catch (error) {
      removeDatabaseFile(file)
      throw error
    }
    try {
      // per connection, not stored in the file: every sandbox sets it on open. Past it a write fails with SQLITE_FULL,
      // which the sandbox answers as storage_full and the router as demo_full
      const { page_size: pageSize } = db.sqlite.prepare('PRAGMA page_size').get() as { page_size: number }
      db.sqlite.exec(`PRAGMA max_page_count = ${Math.max(1, Math.floor(maxBytes / pageSize))}`)
      db.sqlite.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('language', language)
    } catch (error) {
      db.close()
      removeDatabaseFile(file)
      throw error
    }
    const sandbox: Sandbox = { id, visitor, ip, expiresAt: now() + ttlMs, app: createApp({ db, config, auth: demoAuthRuntime(config), ratesOnline: false }) }
    entries.set(id, { sandbox, db, file, family: language })
    return sandbox
  }

  /**
   * After a sweep: the refusal for a new sandbox from ip, or a new one. `replacing` (restart) is the visitor's own
   * sandbox: it does not count against the caps, as it goes once the new one exists; the drain still waits for it.
   */
  function openNew(visitor: string, ip: string, language: Language, replacing?: Sandbox): OpenResult {
    if (pool.draining) return { error: 'demo_updating', retryAfter: secondsUntil(lastExpiry(held()) ?? now()) }
    const all = held().filter(s => s !== replacing)
    const fromIp = all.filter(s => s.ip === ip)
    const earliest = (list: Sandbox[]) => secondsUntil(Math.min(...list.map(s => s.expiresAt)))
    if (fromIp.length >= perIp) return { error: 'demo_ip_limit', retryAfter: earliest(fromIp) }
    if (all.length >= capacity) return { error: 'demo_busy', retryAfter: earliest(all) }
    return { sandbox: create(visitor, ip, language) }
  }

  const visitorSandbox = (visitor: string) => held().find(s => s.visitor === visitor)

  const pool: SandboxPool = {
    draining: false,
    open(visitor, ip, language) {
      sweep()
      const own = visitorSandbox(visitor)
      if (own && entries.get(own.id)?.family === language) return { sandbox: own }
      // signed in again with another language: that language's family replaces the old sandbox, once the new one exists
      const result = openNew(visitor, ip, language, own)
      if ('sandbox' in result) countLaunch()
      if (own && 'sandbox' in result) close(own.id)
      return result
    },
    launches: () => launches,
    familyOf(visitor) {
      const own = visitorSandbox(visitor)
      return own ? entries.get(own.id)!.family : null
    },
    language(id) {
      const entry = entries.get(id)
      if (!entry) return FALLBACK_LANGUAGE
      try {
        const row = entry.db.sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get('language') as { value: string } | undefined
        return languageOr(row?.value)
      } catch {
        return FALLBACK_LANGUAGE // closed by the sweep meanwhile
      }
    },
    get(id) {
      const entry = entries.get(id)
      if (!entry) return null
      if (expired(entry.sandbox)) { close(id); return null }
      return entry.sandbox
    },
    close,
    restart(visitor, ip, language) {
      sweep()
      // the old sandbox goes only once the new one exists: a refusal or a failed copy leaves the visitor with it
      const own = visitorSandbox(visitor)
      const result = openNew(visitor, ip, own ? entries.get(own.id)!.family : language, own)
      if (own && 'sandbox' in result) close(own.id)
      return result
    },
    sweep,
    now,
    status() {
      sweep()
      const all = held()
      return { live: all.length, draining: pool.draining, lastExpiresAt: lastExpiry(all) }
    },
    closeAll() {
      for (const id of [...entries.keys()]) close(id)
    },
  }
  return pool
}
