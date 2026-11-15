// The server parts of modules. Only the server imports this: it holds the database and Telegram.
import type { Hono } from 'hono'
import type { BotUpdate } from '../server/bot/updates'
import type { AuthRuntime } from '../server/authSettings'
import type { AppConfig, ModuleEnv } from '../server/config'
import type { AccountIdentity } from '../domain/api'
import type { PreparedStatement, Database } from '../server/db'
import type { Actor } from '../server/http'
import { advisorServer } from './advisor/server'
import { cashflowServer } from './cashflow/server'
import { loansServer } from './loans/server'
import { realEstateServer } from './real-estate/server'
import { remindersServer } from './reminders/server'
import { moduleMeta } from './catalog'
import type { ModuleKey } from './types'

/** `download`: whether exchange rates may be downloaded (false in the demo and in tests) */
interface ApiContext { db: Database; env: ModuleEnv; auth: AuthRuntime; actor: Actor; url: URL; download: boolean }

export interface ServerModule {
  key: ModuleKey
  /** The module's own paths under /api/; null when the path is not this module's */
  api?: (request: Request, ctx: ApiContext) => Promise<Response | null>
  /**
   * The module's own paths outside /api/ (the advisor's OAuth endpoints), built once per app. Handlers only, no `use`:
   * createApp mounts them before the SPA fallback, except a `notInDemo` module's in the demo. No sign-in, sameOrigin or
   * no-store applies there: the module does its own.
   * `download`: whether exchange rates may be downloaded, as for `api`.
   */
  routes?: (ctx: { db: Database; config: AppConfig; auth: AuthRuntime; download: boolean }) => Hono
  /** The hourly run on the timer */
  scheduled?: (ctx: { db: Database; env: ModuleEnv; auth: AuthRuntime }) => Promise<void>
  /** An update the bot heard that the core did not take; true when it was this module's */
  onBotUpdate?: (update: BotUpdate, ctx: { db: Database; env: ModuleEnv; auth: AuthRuntime }) => Promise<boolean>
  /** Read/validate only: contribute account-dependent writes to the caller's guarded transaction. */
  planRenameAccount?: (ctx: { db: Database; actor: Actor }, from: AccountIdentity, to: AccountIdentity) => Promise<PreparedStatement[]>
}

const SERVER_MODULES: readonly ServerModule[] = [cashflowServer, loansServer, realEstateServer, advisorServer, remindersServer]

/** Every module but, in the public demo, the `notInDemo` ones: their paths, tasks and bot updates do not exist there. */
export function serverModules({ demo }: { demo: boolean }): ServerModule[] {
  return SERVER_MODULES.filter(m => !(demo && moduleMeta(m.key).notInDemo))
}
