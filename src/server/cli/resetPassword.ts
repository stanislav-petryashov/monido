// The reset-password command (docker compose exec app reset-password): clears the family password, signs everyone out and
// tells the running server to reopen its set-up window. Writes only app_settings; never touches the data.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resetPasswordRows } from '../authSettings'
import { ConfigError, loadConfig } from '../config'
import { openDatabase, type SqliteDatabase } from '../db'
import { InputError, type Actor } from '../http'

const ACTOR: Actor = { name: 'reset-password', source: 'config', rights: { edit: false, vote: false, manage: false }, userId: null }

interface ResetDeps {
  env: Record<string, string | undefined>
  /** Tests: an in-memory database; otherwise DATA_DIR/finance.sqlite, which must exist. */
  db?: SqliteDatabase
  kill?: (pid: number, signal: NodeJS.Signals) => void
  print?: (line: string) => void
}

/** Runs the command; the result is the exit code. */
export async function run(_argv: string[], deps: ResetDeps): Promise<number> {
  const print = deps.print ?? ((line: string) => console.log(line))
  const kill = deps.kill ?? ((pid: number, signal: NodeJS.Signals) => { process.kill(pid, signal) })
  let config
  try {
    config = loadConfig(deps.env)
  } catch (err) {
    if (err instanceof ConfigError) { print(`[config] ${err.message}`); return 1 }
    throw err
  }
  if (config.authMode === 'none') {
    print('Remove AUTH_MODE=none from .env and restart before resetting the family password.')
    return 1
  }
  if (config.authMode === 'demo') {
    print(`Nothing to reset in AUTH_MODE=${config.authMode}.`)
    return 1
  }
  let db = deps.db
  const opened = !db
  if (!db) {
    const file = join(config.dataDir, 'finance.sqlite')
    if (!existsSync(file)) { print(`No database at ${file}; check DATA_DIR.`); return 1 }
    db = openDatabase(file)
  }
  try {
    resetPasswordRows(db.sqlite, config, ACTOR)
  } catch (err) {
    if (err instanceof InputError) { print(`Nothing to reset in AUTH_MODE=${config.authMode}.`); return 1 }
    throw err
  } finally {
    if (opened) db.close()
  }
  print('The family password is cleared.')
  try {
    kill(1, 'SIGHUP')
    print('Everyone is signed out.')
    print('Open the site within 15 minutes and set the family password.')
  } catch {
    print('Start or restart the server; the window opens at start.')
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run(process.argv.slice(2), { env: process.env }).then(code => { process.exitCode = code })
}
