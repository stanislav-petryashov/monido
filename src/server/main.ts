// Server entry point: config → database → schema validation → session key → bot supervisor → app → HTTP → timer. AUTH_MODE=demo → the demo server.
import { accessSync, constants, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createApp, nudgeModules, runScheduledModules } from './app'
import { loadSessionSecret } from './auth'
import { loadAuthRuntime, type AuthRuntime } from './authSettings'
import { startBotSupervisor } from './bot/supervisor'
import { ConfigError, loadConfig, warnIfClientIpShared, type AppConfig } from './config'
import { openDatabase } from './db'
import { startDemoServer } from './demo/start'
import { listen, type RunningServer } from './listen'
import { createLoginAttempts } from './loginAttempts'
import { initializeSchema } from './schema'
import { startHourly } from './schedule'
import { mountStatic } from './static'

/** onAuth: told of the sign-in runtime once it exists and of how to nudge the modules (main() hooks SIGHUP to both); the demo has none. */
export async function startServer(env: NodeJS.ProcessEnv, onAuth?: (auth: AuthRuntime, nudge: () => void) => void): Promise<RunningServer> {
  const base = loadConfig(env)
  // the demo never opens DATA_DIR/finance.sqlite: it serves copies of a generated template
  if (base.authMode === 'demo') return startDemoServer(base)
  return startFamilyServer(base, onAuth)
}

/** The family's own database behind password or Telegram sign-in. */
async function startFamilyServer(base: AppConfig, onAuth?: (auth: AuthRuntime, nudge: () => void) => void): Promise<RunningServer> {
  warnIfClientIpShared(base)
  const db = openDataDir(base.dataDir)
  try { initializeSchema(db, base.schemaFile) } catch (error) { db.close(); throw error }
  const config = { ...base, sessionSecret: loadSessionSecret(base) }
  const auth = await loadAuthRuntime(db, config)
  onAuth?.(auth, () => { void nudgeModules({ db, config, auth }) })
  // one store of sign-in attempts: the browser starts and polls them through the app, the bot's Confirm approves them
  const logins = createLoginAttempts()
  // one supervisor: a reader while the runtime has a bot token (.env's, else the stored one), restarted when it changes
  const bot = startBotSupervisor({ auth, db, config, logins })
  const app = createApp({ db, config, auth, bot, logins })
  mountStatic(app, config.clientDir)
  const stopHourly = startHourly(() => runScheduledModules({ db, config, auth }))
  // the reader stops before the database closes: an update being handled finishes its writes
  return listen(app, config, async () => { stopHourly(); await bot.stop(); db.close() })
}

/** Errors that mean this process may not write DATA_DIR or its database: file-system refusals and SQLite's CANTOPEN (14) and READONLY (8). */
function cannotWrite(err: unknown): boolean {
  const e = err as { code?: unknown; errcode?: unknown }
  return ['EACCES', 'EPERM', 'EROFS'].includes(String(e?.code)) || (e?.code === 'ERR_SQLITE_ERROR' && (e.errcode === 14 || e.errcode === 8))
}

/**
 * DATA_DIR (created if missing) and its database. A folder this process may not write is a ConfigError that says how to
 * fix it: an older docker-compose.yml mounts ./data, which Docker creates as root, while the container runs as the node user (uid 1000).
 */
function openDataDir(dir: string) {
  try {
    mkdirSync(dir, { recursive: true })
    accessSync(dir, constants.W_OK)
    return openDatabase(join(dir, 'finance.sqlite'))
  } catch (err) {
    if (!cannotWrite(err)) throw err
    const uid = process.getuid?.()
    throw new ConfigError(`cannot write to DATA_DIR (${dir})${uid === undefined ? '' : ` as uid ${uid}`}. If docker-compose.yml mounts a folder (./data:/data), Docker created it as root: run "sudo chown -R 1000:1000 data" next to docker-compose.yml and "docker compose up -d", or move to the data volume of the current docker-compose.yml (docs/deploy-docker.md, "Moving from the ./data folder"). Outside Docker, give this user write access to the folder or set DATA_DIR to another one.`)
  }
}

/**
 * SIGHUP re-reads the sign-in rows and nudges the modules: reset-password signals the server after it clears the password,
 * the stdio advisor (monido-mcp) after a write the server should act on now (proposal cards).
 * @public a test seam: main() is the only caller
 */
export function onReloadSignal(auth: AuthRuntime, nudge: () => void = () => {}, on: typeof process.on = process.on.bind(process)): void {
  on('SIGHUP', () => { auth.reload(); nudge() })
}

async function main(): Promise<void> {
  let running: RunningServer
  try {
    running = await startServer(process.env, (auth, nudge) => onReloadSignal(auth, nudge))
  } catch (err) {
    if (err instanceof ConfigError) { console.error(`[config] ${err.message}`); process.exit(1) }
    throw err
  }
  const shutdown = (signal: string) => {
    console.log(`[server] ${signal}, stopping`)
    void running.stop().then(() => process.exit(0))
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
