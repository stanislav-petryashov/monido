// Thin client for the Telegram Bot API. The request address carries the bot token, so nothing
// from a failed request is passed on or logged: callers only ever see TelegramError codes.
import type { MsgParams } from '../../domain/types'
import type { BotUpdate, BotUser } from './updates'

/**
 * A failure that may be shown to a person and stored: a code (`errors.<code>` in the locales) and its params,
 * never the token. `telegram.external` carries Telegram's own description in `detail`; `telegram.bad_token` its status and
 * description, for the log.
 */
export class TelegramError extends Error {
  readonly code: string
  readonly params?: MsgParams
  constructor(code: string, params?: MsgParams) {
    super(code)
    this.code = code
    this.params = params
  }
}

/** A request that takes longer is given up: a hung send must not stall the reader or the shutdown */
const DEADLINE_MS = 15_000
/** A long poll that outlives its own timeout by this much is taken for a dead connection */
const POLL_GRACE_MS = 10_000

interface Answer { ok?: boolean; description?: string; error_code?: number; result?: unknown }
interface CallOptions { signal?: AbortSignal; deadlineMs?: number }

async function call(token: string, method: string, body: unknown, fetchImpl: typeof fetch, { signal, deadlineMs = DEADLINE_MS }: CallOptions = {}): Promise<Answer & { status: number }> {
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), deadlineMs)
  timer.unref?.()
  const aborted = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal
  try {
    let response: Response
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: aborted,
      })
    } catch {
      // the original error is not kept: its text may hold the request address with the token
      throw new TelegramError('telegram.unavailable')
    }
    let answer: Answer
    try {
      answer = await response.json() as Answer
    } catch {
      throw aborted.aborted ? new TelegramError('telegram.unavailable') : new TelegramError('telegram.status', { status: response.status })
    }
    return { ...answer, status: response.status }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Telegram said no: its own reason when it gave one, else the status. 401 and 404 are about the token itself
 * (revoked, or not a token at all): the status and Telegram's reason go along, for the log.
 */
function refusal(answer: Answer & { status: number }): TelegramError {
  const status = answer.error_code ?? answer.status
  if (status === 401 || status === 404) return new TelegramError('telegram.bad_token', { status, ...(answer.description ? { detail: answer.description } : {}) })
  return answer.description ? new TelegramError('telegram.external', { status, detail: answer.description }) : new TelegramError('telegram.status', { status: answer.status })
}

/**
 * The person blocked the bot (403) or the chat is gone: sending there again is pointless until they come back, so a
 * delivery row stops retrying (they still have the site).
 */
export const isBlocked = (err: unknown): boolean =>
  err instanceof TelegramError && err.code === 'telegram.external'
  && (err.params?.status === 403 || /chat not found/i.test(String(err.params?.detail)))

/** The answer's result when Telegram said yes. */
async function result(token: string, method: string, body: unknown, fetchImpl: typeof fetch, options?: CallOptions): Promise<unknown> {
  const answer = await call(token, method, body, fetchImpl, options)
  if (!answer.ok) throw refusal(answer)
  return answer.result
}

const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? v as Record<string, unknown> : null)

export async function sendMessage(token: string, chatId: string, text: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await result(token, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true }, fetchImpl)
}

/** The bot's own @username, for deep links. */
export async function getMe(token: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<{ username: string }> {
  const me = record(await result(token, 'getMe', {}, fetchImpl, { signal }))
  if (typeof me?.username !== 'string') throw new TelegramError('telegram.status', { status: 200 })
  return { username: me.username }
}

/** first + last name, else @username, else null (the UI words a person without a name) */
function botUser(raw: unknown): BotUser | null {
  const from = record(raw)
  if (typeof from?.id !== 'number') return null
  const name = [from.first_name, from.last_name].filter(p => typeof p === 'string' && p).join(' ')
  return { id: String(from.id), name: name || (typeof from.username === 'string' && from.username ? `@${from.username}` : null) }
}

/** A text message or a button press under a message; anything else (photos, channel posts, edits) is null. */
function normalize(raw: Record<string, unknown>): BotUpdate | null {
  const message = record(raw.message)
  if (message) {
    const chat = record(message.chat)
    const from = botUser(message.from)
    if (typeof chat?.id !== 'number' || typeof chat.type !== 'string' || !from) return null
    if (typeof message.text !== 'string' || typeof message.date !== 'number') return null
    return { kind: 'message', chatId: String(chat.id), chatType: chat.type, ...(typeof chat.title === 'string' ? { chatTitle: chat.title } : {}), from, text: message.text, date: message.date }
  }
  const callback = record(raw.callback_query)
  if (callback) {
    const under = record(callback.message)
    const chat = record(under?.chat)
    const from = botUser(callback.from)
    if (typeof callback.id !== 'string' || typeof callback.data !== 'string' || !from) return null
    if (typeof chat?.id !== 'number' || typeof under?.message_id !== 'number') return null
    return { kind: 'callback', id: callback.id, chatId: String(chat.id), messageId: under.message_id, from, data: callback.data }
  }
  return null
}

/**
 * The updates from `offset` on, waiting up to timeoutSec for one. Each carries its id, so the caller can move past
 * an update it cannot use (null). A 409 is a webhook on the bot or another program reading its updates.
 */
export async function getUpdates(
  token: string, offset: number, timeoutSec: number, fetchImpl: typeof fetch = fetch, signal?: AbortSignal,
): Promise<{ updateId: number; update: BotUpdate | null }[]> {
  const answer = await call(token, 'getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] },
    fetchImpl, { signal, deadlineMs: timeoutSec * 1000 + POLL_GRACE_MS })
  if (!answer.ok) {
    if (answer.error_code === 409) {
      throw /webhook/i.test(answer.description ?? '') ? new TelegramError('telegram.webhook') : new TelegramError('telegram.other_reader')
    }
    throw refusal(answer)
  }
  return (Array.isArray(answer.result) ? answer.result : [])
    .map(record)
    .filter((u): u is Record<string, unknown> & { update_id: number } => typeof u?.update_id === 'number')
    .map(u => ({ updateId: u.update_id, update: normalize(u) }))
}

/** A button under a message: `data` comes back in the press (at most 64 bytes), `url` opens a link. */
export type InlineButton = { text: string; data: string } | { text: string; url: string }

const keyboard = (buttons: InlineButton[][]) =>
  ({ inline_keyboard: buttons.map(row => row.map(b => ('url' in b ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data }))) })

/** A message with rows of inline buttons (none — a plain message); its id, for later edits. */
export async function sendButtons(
  token: string, chatId: string, text: string, buttons: InlineButton[][], fetchImpl: typeof fetch = fetch,
): Promise<{ messageId: number }> {
  const sent = record(await result(token, 'sendMessage', {
    chat_id: chatId, text, disable_web_page_preview: true, ...(buttons.length ? { reply_markup: keyboard(buttons) } : {}),
  }, fetchImpl))
  if (typeof sent?.message_id !== 'number') throw new TelegramError('telegram.status', { status: 200 })
  return { messageId: sent.message_id }
}

/** Replaces a message's text; its buttons go with the old text. */
export async function editMessage(token: string, chatId: string, messageId: number, text: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await result(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true }, fetchImpl)
}

/** An edit to what the message already shows: Telegram refuses it, but the message is as wanted. */
const notModified = (err: unknown) =>
  err instanceof TelegramError && err.code === 'telegram.external' && /message is not modified/i.test(String(err.params?.detail))

async function edit(token: string, method: string, body: unknown, fetchImpl: typeof fetch): Promise<void> {
  try {
    await result(token, method, body, fetchImpl)
  } catch (err) {
    if (!notModified(err)) throw err
  }
}

/**
 * Replaces a message's text and its buttons (none — the buttons are removed);
 * an unchanged message is not an error.
 */
export async function editMessageWithButtons(
  token: string, chatId: string, messageId: number, text: string, buttons: InlineButton[][], fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await edit(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true, reply_markup: keyboard(buttons) }, fetchImpl)
}

/** Stops the button's spinner in the person's Telegram; `text` is shown to them briefly. */
export async function answerCallback(token: string, callbackId: string, fetchImpl: typeof fetch = fetch, text?: string): Promise<void> {
  await result(token, 'answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) }, fetchImpl)
}
