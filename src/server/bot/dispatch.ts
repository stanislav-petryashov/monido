// Who hears an update: the core handlers first, then each module, until one takes it.
import { handleFamilyTelegram } from '../familyTelegramBot'
import { serverModules } from '../../modules/server'
import type { AuthRuntime } from '../authSettings'
import { moduleEnv, type AppConfig } from '../config'
import type { Database } from '../db'
import { answerCallback, TelegramError } from './telegram'
import type { BotUpdate } from './updates'

/** true: the update was this handler's and nobody else hears it */
type BotHandler = (update: BotUpdate) => Promise<boolean>

/**
 * core: the core's own handlers, in order (sign-in through the bot). A button press nobody takes is answered with nothing,
 * so Telegram stops its spinner. The bot runs only on the family server, never in the demo.
 */
export function createBotDispatcher({ db, config, auth, token, core = [], fetchImpl, botUsername = () => null }: {
  db: Database; config: AppConfig; auth: AuthRuntime; token: string; core?: readonly BotHandler[]; fetchImpl?: typeof fetch; botUsername?: () => string | null
}): (update: BotUpdate) => Promise<void> {
  return async update => {
    for (const handler of core) if (await handler(update)) return
    if (await handleFamilyTelegram(update, { db, token, username: botUsername(), fetchImpl })) return
    for (const m of serverModules({ demo: false })) {
      if (await m.onBotUpdate?.(update, { db, env: moduleEnv(config, auth), auth })) return
    }
    if (update.kind !== 'callback') return
    try {
      await answerCallback(token, update.id, fetchImpl)
    } catch (err) {
      console.error(`[bot] button answer failed: ${err instanceof TelegramError ? err.code : 'unknown error'}`)
    }
  }
}
