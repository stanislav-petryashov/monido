import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TelegramError, answerCallback, editMessage, editMessageWithButtons, getMe, getUpdates, isBlocked, sendButtons, sendMessage,
} from '../../../src/server/bot/telegram'

const TOKEN = 'T0KEN'
const fake = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
const sent = (f: ReturnType<typeof fake>, i = 0) => {
  const [url, init] = f.mock.calls[i] as [string, RequestInit]
  return { method: url.split('/').pop(), url, body: JSON.parse(String(init.body)) as Record<string, unknown> }
}

describe('sendMessage', () => {
  it('posts the text to the chat, without a link preview', async () => {
    const f = fake({ ok: true, result: {} })
    await sendMessage(TOKEN, '42', 'hello', f)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.telegram.org/botT0KEN/sendMessage')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: '42', text: 'hello', disable_web_page_preview: true })
  })

  it('reports Telegram’s own reason when it refuses', async () => {
    const f = fake({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403)
    await expect(sendMessage(TOKEN, '42', 'x', f)).rejects.toMatchObject({ code: 'telegram.external', params: { status: 403, detail: 'Forbidden: bot was blocked by the user' } })
  })

  it('hides the address, which carries the token, when the request itself fails', async () => {
    const f = vi.fn(async () => { throw new Error(`fetch failed: https://api.telegram.org/bot${TOKEN}/sendMessage`) })
    const error = await sendMessage(TOKEN, '42', 'x', f).catch(e => e as Error) as Error
    expect(error).toBeInstanceOf(TelegramError)
    expect(error).toMatchObject({ code: 'telegram.unavailable' })
    expect(String(error) + String(error.stack) + JSON.stringify(error)).not.toContain(TOKEN)
  })

  it('reports the status when the answer is not JSON', async () => {
    await expect(sendMessage(TOKEN, '42', 'x', fake('<html>Bad Gateway</html>', 502))).rejects.toMatchObject({ code: 'telegram.status', params: { status: 502 } })
  })

  it('reports a refusal that comes without a description', async () => {
    await expect(sendMessage(TOKEN, '42', 'x', fake({ ok: false }, 429))).rejects.toMatchObject({ code: 'telegram.status', params: { status: 429 } })
  })

  it('names a token Telegram does not accept: revoked (401) or not a token at all (404)', async () => {
    await expect(sendMessage(TOKEN, '42', 'x', fake({ ok: false, error_code: 401, description: 'Unauthorized' }, 401)))
      .rejects.toMatchObject({ code: 'telegram.bad_token', params: { status: 401, detail: 'Unauthorized' } })
    await expect(sendMessage(TOKEN, '42', 'x', fake({ ok: false }, 404))).rejects.toMatchObject({ code: 'telegram.bad_token', params: { status: 404 } })
  })
})

describe('deadlines', () => {
  afterEach(() => { vi.useRealTimers() })
  const hanging = () => vi.fn<typeof fetch>((_, init) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
  }))

  it.each<[string, (f: typeof fetch) => Promise<unknown>]>([
    ['sendMessage', f => sendMessage(TOKEN, '42', 'x', f)],
    ['sendButtons', f => sendButtons(TOKEN, '42', 'x', [[{ text: 'Yes', data: 'y' }]], f)],
    ['editMessage', f => editMessage(TOKEN, '42', 1, 'x', f)],
    ['editMessageWithButtons', f => editMessageWithButtons(TOKEN, '42', 1, 'x', [], f)],
    ['answerCallback', f => answerCallback(TOKEN, 'cb', f)],
    ['getMe', f => getMe(TOKEN, f)],
  ])('%s gives up after 15 s', async (_, send) => {
    vi.useFakeTimers()
    const outcome = send(hanging()).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(await Promise.race([outcome, 'waiting'])).toBe('waiting')
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toMatchObject({ code: 'telegram.unavailable' })
  })

  it('a long poll gets its own timeout and 10 s more', async () => {
    vi.useFakeTimers()
    const outcome = getUpdates(TOKEN, 0, 30, hanging()).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(39_999)
    expect(await Promise.race([outcome, 'waiting'])).toBe('waiting')
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toMatchObject({ code: 'telegram.unavailable' })
  })
})

describe('getMe', () => {
  it('learns the bot’s username', async () => {
    const f = fake({ ok: true, result: { id: 1, is_bot: true, username: 'fcbot' } })
    expect(await getMe(TOKEN, f)).toEqual({ username: 'fcbot' })
    expect(sent(f).method).toBe('getMe')
  })

  it('refuses an answer without one', async () => {
    await expect(getMe(TOKEN, fake({ ok: true, result: {} }))).rejects.toBeInstanceOf(TelegramError)
  })
})

describe('getUpdates', () => {
  const from = { id: 42, first_name: 'Robin', last_name: 'Q.' }
  const message = (id: number, extra: object = {}) => ({ update_id: id, message: { message_id: id, chat: { id: 42, type: 'private' }, from, text: 'hi', date: 100, ...extra } })

  it('long-polls from the offset for messages and button presses', async () => {
    const f = fake({ ok: true, result: [] })
    await getUpdates(TOKEN, 7, 30, f)
    expect(sent(f)).toMatchObject({ method: 'getUpdates', body: { offset: 7, timeout: 30, allowed_updates: ['message', 'callback_query'] } })
  })

  it('normalizes a text message and names its sender', async () => {
    const f = fake({ ok: true, result: [message(5)] })
    expect(await getUpdates(TOKEN, 0, 30, f)).toEqual([{
      updateId: 5,
      update: { kind: 'message', chatId: '42', chatType: 'private', from: { id: '42', name: 'Robin Q.' }, text: 'hi', date: 100 },
    }])
  })

  it('falls back to the username, then to no name', async () => {
    const f = fake({ ok: true, result: [
      message(1, { from: { id: 42, username: 'robin_q' } }),
      message(2, { from: { id: 42 } }),
    ] })
    const [a, b] = await getUpdates(TOKEN, 0, 30, f)
    expect(a.update).toMatchObject({ from: { name: '@robin_q' } })
    expect(b.update).toMatchObject({ from: { name: null } })
  })

  it('normalizes a button press under a message', async () => {
    const f = fake({ ok: true, result: [{ update_id: 9, callback_query: { id: 'cb1', from, data: 'approve:x', message: { message_id: 3, chat: { id: 42, type: 'private' } } } }] })
    expect(await getUpdates(TOKEN, 0, 30, f)).toEqual([{
      updateId: 9, update: { kind: 'callback', id: 'cb1', chatId: '42', messageId: 3, from: { id: '42', name: 'Robin Q.' }, data: 'approve:x' },
    }])
  })

  it('keeps the id of an update it cannot use, so the reader moves past it', async () => {
    const f = fake({ ok: true, result: [
      message(1, { text: undefined, photo: [] }),
      { update_id: 2, edited_message: {} },
      message(3, { from: undefined }),
      { update_id: 4, callback_query: { id: 'cb', from, data: 'x' } },
      { message: {} },
    ] })
    expect(await getUpdates(TOKEN, 0, 30, f)).toEqual([1, 2, 3, 4].map(updateId => ({ updateId, update: null })))
  })

  it('tells a second reader of the bot apart from a webhook', async () => {
    const other = fake({ ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' }, 409)
    await expect(getUpdates(TOKEN, 0, 30, other)).rejects.toMatchObject({ code: 'telegram.other_reader' })
    const webhook = fake({ ok: false, error_code: 409, description: 'Conflict: can\'t use getUpdates method while webhook is active' }, 409)
    await expect(getUpdates(TOKEN, 0, 30, webhook)).rejects.toMatchObject({ code: 'telegram.webhook' })
  })

  it('gives up on the request when the caller aborts', async () => {
    const abort = new AbortController()
    const f = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const pending = getUpdates(TOKEN, 0, 30, f, abort.signal)
    abort.abort()
    await expect(pending).rejects.toMatchObject({ code: 'telegram.unavailable' })
  })
})

describe('buttons', () => {
  it('sends rows of buttons and returns the message id', async () => {
    const f = fake({ ok: true, result: { message_id: 77 } })
    expect(await sendButtons(TOKEN, '42', 'Sign in?', [[{ text: 'Yes', data: 'y' }, { text: 'No', data: 'n' }]], f)).toEqual({ messageId: 77 })
    expect(sent(f)).toMatchObject({ method: 'sendMessage', body: {
      chat_id: '42', text: 'Sign in?', reply_markup: { inline_keyboard: [[{ text: 'Yes', callback_data: 'y' }, { text: 'No', callback_data: 'n' }]] },
    } })
  })

  it('edits a message and answers a press', async () => {
    const f = fake({ ok: true, result: true })
    await editMessage(TOKEN, '42', 77, 'Signed in', f)
    await answerCallback(TOKEN, 'cb1', f)
    expect(sent(f, 0)).toMatchObject({ method: 'editMessageText', body: { chat_id: '42', message_id: 77, text: 'Signed in' } })
    expect(sent(f, 1)).toMatchObject({ method: 'answerCallbackQuery', body: { callback_query_id: 'cb1' } })
  })

  it('sendButtons sends url buttons as url and data buttons as callback_data', async () => {
    const f = fake({ ok: true, result: { message_id: 5 } })
    await sendButtons(TOKEN, '42', 'Card', [[{ text: 'Agree', data: 'v:1:a' }], [{ text: 'Details', url: 'https://fc.example/advisor#proposal-1' }]], f)
    expect(sent(f).body.reply_markup).toEqual({ inline_keyboard: [
      [{ text: 'Agree', callback_data: 'v:1:a' }],
      [{ text: 'Details', url: 'https://fc.example/advisor#proposal-1' }],
    ] })
    // no buttons: a plain message, without an empty keyboard
    await sendButtons(TOKEN, '42', 'Notice', [], f)
    expect(sent(f, 1).body).toEqual({ chat_id: '42', text: 'Notice', disable_web_page_preview: true })
  })

  it('editMessageWithButtons resolves on "message is not modified"; other refusals throw with the status kept', async () => {
    const same = fake({ ok: false, error_code: 400, description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same' }, 400)
    await expect(editMessageWithButtons(TOKEN, '42', 77, 'Card', [], same)).resolves.toBeUndefined()
    expect(sent(same)).toMatchObject({ method: 'editMessageText', body: { chat_id: '42', message_id: 77, text: 'Card', reply_markup: { inline_keyboard: [] } } })

    const gone = fake({ ok: false, error_code: 400, description: 'Bad Request: message to edit not found' }, 400)
    await expect(editMessageWithButtons(TOKEN, '42', 77, 'Card', [], gone))
      .rejects.toMatchObject({ code: 'telegram.external', params: { status: 400, detail: 'Bad Request: message to edit not found' } })
  })

  it('answerCallback passes the text; isBlocked is true for 403 and for "chat not found"', async () => {
    const f = fake({ ok: true, result: true })
    await answerCallback(TOKEN, 'cb1', f, 'Replaced by version 2')
    expect(sent(f).body).toEqual({ callback_query_id: 'cb1', text: 'Replaced by version 2' })

    const refused = async (status: number, description: string) =>
      sendMessage(TOKEN, '42', 'x', fake({ ok: false, error_code: status, description }, status)).catch((e: unknown) => e)
    expect(isBlocked(await refused(403, 'Forbidden: bot was blocked by the user'))).toBe(true)
    expect(isBlocked(await refused(400, 'Bad Request: chat not found'))).toBe(true)
    expect(isBlocked(await refused(400, 'Bad Request: message to edit not found'))).toBe(false)
    expect(isBlocked(await refused(429, 'Too Many Requests: retry after 5'))).toBe(false)
    expect(isBlocked(new TelegramError('telegram.unavailable'))).toBe(false)
    expect(isBlocked(new Error('Forbidden'))).toBe(false)
  })
})
