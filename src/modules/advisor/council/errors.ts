// The council's error code for the log and the delivery rows.
import { TelegramError } from '../../../server/bot/telegram'
import { InputError } from '../../../server/http'

/** The error's code: a refusal's or Telegram's own, anything else (a bug, the database) `internal`; never a text. */
export const codeOf = (err: unknown): string => (err instanceof InputError || err instanceof TelegramError ? err.code : 'internal')
