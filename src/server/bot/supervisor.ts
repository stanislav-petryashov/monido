// Keeps one bot reader alive for the runtime's current bot token: a token saved, changed or cleared in Settings
// restarts it without a server restart. Restarts run one after another on a single promise chain.
import type { BotStatus } from '../../domain/api'
import type { AuthRuntime } from '../authSettings'
import type { AppConfig } from '../config'
import type { Database } from '../db'
import type { LoginAttempts } from '../loginAttempts'
import { createBotDispatcher } from './dispatch'
import { startBotReader, type BotHandle } from './reader'
import { handleSignIn } from './signIn'

export function startBotSupervisor({ auth, db, config, logins, startReader = startBotReader, fetchImpl }: {
  auth: AuthRuntime; db: Database; config: AppConfig; logins: LoginAttempts
  startReader?: typeof startBotReader
  fetchImpl?: typeof fetch
}): BotHandle {
  let reader: BotHandle | null = null
  let running: string | null = null
  let stopped = false
  let chain: Promise<void> = Promise.resolve()

  const start = (token: string) => {
    reader = startReader({
      token,
      handle: createBotDispatcher({ db, config, auth, token, botUsername: () => reader?.username() ?? null, core: [u => handleSignIn(u, { db, token, logins, fetchImpl })], fetchImpl }),
      fetchImpl,
    })
    running = token
  }
  // the old reader is gone before the new one starts: two long polls on one token would fight (409)
  const reconcile = async () => {
    const token = auth.botToken()
    if (stopped || token === running) return
    const old = reader
    reader = null
    running = null
    await old?.stop()
    if (stopped) return
    if (token) start(token)
  }
  const queue = () => {
    chain = chain.then(reconcile).catch((err: unknown) => {
      console.error(`[bot] restart failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  const token = auth.botToken()
  if (token) start(token)
  // never throws: the work is queued, its failures are logged
  const off = auth.onChange(queue)

  return {
    username: () => reader?.username() ?? null,
    status: () => reader?.status() ?? { configured: false, username: null, problem: null } satisfies BotStatus,
    async stop() {
      stopped = true
      off()
      await chain
      const old = reader
      reader = null
      running = null
      await old?.stop()
    },
  }
}
