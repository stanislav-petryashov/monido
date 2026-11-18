// The demo server (AUTH_MODE=demo): never opens DATA_DIR/finance.sqlite. It builds a template from the fictional
// family (rebuilt daily), serves visitors private copies of it through the demo router, and reports to the host.
import { randomBytes } from 'node:crypto'
import { existsSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isoDate } from '../../domain/dates'
import type { AppConfig } from '../config'
import { listen, type RunningServer } from '../listen'
import { mountStatic } from '../static'
import { createDemoApp } from './app'
import { createSandboxPool } from './pool'
import { buildTemplate } from './template'
import { LANGUAGES, type Language } from '../../i18n/languages'

const REBUILD_HOUR_UTC = 0
const REBUILD_MINUTE_UTC = 5

/** The next 00:05 UTC strictly after `now`: the template is rebuilt then, so its "today" follows the calendar. */
export function nextRebuild(now: Date): Date {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), REBUILD_HOUR_UTC, REBUILD_MINUTE_UTC))
  if (at.getTime() <= now.getTime()) at.setUTCDate(at.getUTCDate() + 1)
  return at
}

interface DemoServerOptions {
  /** how often the drain flag is read, expired sandboxes are swept and demo-status.json is written; tests shorten it */
  tickMs?: number
}

/**
 * DATA_DIR/demo holds the template and the sandboxes. Every tick: DATA_DIR/drain present → the pool drains
 * (the host's update script creates it); expired sandboxes go; DATA_DIR/demo-status.json gets the pool's status
 * and updatedAt (the script waits for "live":0). No hourly module run: the demo has nothing to send.
 */
export async function startDemoServer(base: AppConfig, { tickMs = 60_000 }: DemoServerOptions = {}): Promise<RunningServer> {
  // in memory only: a restart voids every cookie, as the sandboxes are gone anyway
  const secret = randomBytes(32).toString('hex')
  const config: AppConfig = { ...base, sessionSecret: secret }
  const dir = path.join(config.dataDir, 'demo')
  // one template per UI language, each with that language's family: a sandbox copies the visitor's
  const build = () => {
    const today = isoDate(new Date())
    return Object.fromEntries(LANGUAGES.map(family => [family, buildTemplate({ dir, schemaFile: config.schemaFile, today, family })])) as Record<Language, string>
  }
  let templates = build()
  const pool = createSandboxPool({ dir, templatePath: language => templates[language], config })
  const app = createDemoApp({ config, pool, secret })
  mountStatic(app, config.clientDir)

  const drainFile = path.join(config.dataDir, 'drain')
  const statusFile = path.join(config.dataDir, 'demo-status.json')
  const tick = () => {
    try {
      pool.draining = existsSync(drainFile)
      pool.sweep()
      // written beside and renamed: a reader never sees half a file
      writeFileSync(`${statusFile}.tmp`, JSON.stringify({ ...pool.status(), updatedAt: Date.now() }))
      renameSync(`${statusFile}.tmp`, statusFile)
    } catch (err) {
      console.error('[demo] tick failed', err)
    }
  }
  tick()
  const ticker = setInterval(tick, tickMs)

  let rebuildTimer: ReturnType<typeof setTimeout>
  const scheduleRebuild = () => {
    const now = new Date()
    rebuildTimer = setTimeout(() => {
      // a failed rebuild keeps yesterday's template: the sandboxes still work, one day stale
      try { templates = build(); console.log('[demo] templates rebuilt') } catch (err) { console.error('[demo] template rebuild failed', err) }
      scheduleRebuild()
    }, nextRebuild(now).getTime() - now.getTime())
  }
  scheduleRebuild()

  // a body still arriving after 30 s is cut: stalled uploads would otherwise hold their memory on the shared server
  return listen(app, config, () => {
    clearInterval(ticker)
    clearTimeout(rebuildTimer)
    pool.closeAll()
  }, { requestTimeout: 30_000, headersTimeout: 20_000 })
}
