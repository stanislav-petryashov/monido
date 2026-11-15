import { afterEach, describe, expect, it, vi } from 'vitest'
import { startBotReader, type BotHandle } from '../../../src/server/bot/reader'
import type { BotUpdate } from '../../../src/server/bot/updates'

const TOKEN = 'T0KEN-123'
type Answer = { status?: number; body: unknown } | 'down'
const ok = (result: unknown): Answer => ({ body: { ok: true, result } })
const text = (id: number, t: string) => ({ update_id: id, message: { message_id: id, chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Robin' }, text: t, date: 1 } })

/**
 * A scripted Telegram: getMe and getUpdates answer from their lists; once the getUpdates list is used up the
 * poll hangs, like a quiet long poll, until the reader aborts it — `idle` resolves then.
 */
function telegram(polls: Answer[], me: Answer[] = []) {
  const offsets: number[] = []
  /** offsets of the zero-timeout call `stop()` makes to confirm the last batch */
  const confirmed: number[] = []
  let park = () => {}
  const idle = new Promise<void>(resolve => { park = resolve })
  const answer = (a: Answer) => {
    if (a === 'down') throw new Error(`fetch failed: https://api.telegram.org/bot${TOKEN}/getUpdates`)
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 })
  }
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/getMe')) return answer(me.shift() ?? ok({ username: 'fcbot' }))
    const { offset, timeout } = JSON.parse(String(init?.body)) as { offset: number; timeout: number }
    if (timeout === 0) {
      confirmed.push(offset)
      return answer(ok([]))
    }
    offsets.push(offset)
    const next = polls.shift()
    if (next) return answer(next)
    park()
    return new Promise<Response>((_, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))) })
  })
  return { fetchImpl, offsets, confirmed, idle }
}

const instant = vi.fn<(ms: number) => Promise<void>>(async () => {})
let reader: BotHandle | null = null
afterEach(async () => { await reader?.stop(); reader = null; instant.mockClear() })

function start(tg: ReturnType<typeof telegram>, handle: (u: BotUpdate) => Promise<void> = async () => {}, sleep: (ms: number) => Promise<void> = instant) {
  reader = startBotReader({ token: TOKEN, handle, fetchImpl: tg.fetchImpl as typeof fetch, sleep })
  return reader
}

describe('the bot reader', () => {
  it('updates are handed over in order and the offset advances', async () => {
    const heard: string[] = []
    const tg = telegram([ok([text(1, 'a'), text(2, 'b')]), ok([text(5, 'c')])])
    const bot = start(tg, async u => { if (u.kind === 'message') heard.push(u.text) })
    await tg.idle
    expect(heard).toEqual(['a', 'b', 'c'])
    expect(tg.offsets).toEqual([0, 3, 6])
    expect(bot.username()).toBe('fcbot')
    expect(bot.status()).toEqual({ configured: true, username: 'fcbot', problem: null })
    // polls that brought updates are not slowed down
    expect(instant).not.toHaveBeenCalled()
  })

  it('stop confirms the last batch, so a restart does not get it again', async () => {
    const tg = telegram([ok([text(1, 'a'), text(2, 'b')])])
    const bot = start(tg)
    await tg.idle
    await bot.stop()
    expect(tg.confirmed).toEqual([3])
  })

  it('stop before any update confirms nothing', async () => {
    const tg = telegram([])
    const bot = start(tg)
    await tg.idle
    await bot.stop()
    expect(tg.confirmed).toEqual([])
  })

  it('waits a second after a poll that came back at once with nothing', async () => {
    const tg = telegram([ok([]), ok([])])
    start(tg)
    await tg.idle
    expect(instant.mock.calls.map(c => c[0])).toEqual([1_000, 1_000])
    expect(tg.offsets).toEqual([0, 0, 0])
  })

  it('moves past an update it cannot use without handing it over', async () => {
    const handle = vi.fn(async () => {})
    const tg = telegram([ok([{ update_id: 4, edited_message: {} }])])
    start(tg, handle)
    await tg.idle
    expect(handle).not.toHaveBeenCalled()
    expect(tg.offsets).toEqual([0, 5])
  })

  it('a failing handler does not stall the reader', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const heard: string[] = []
    const tg = telegram([ok([text(1, 'a'), text(2, 'b')])])
    start(tg, async u => {
      if (u.kind === 'message' && u.text === 'a') throw new Error(`request to https://api.telegram.org/bot${TOKEN}/sendMessage failed`)
      if (u.kind === 'message') heard.push(u.text)
    })
    await tg.idle
    expect(heard).toEqual(['b'])
    expect(tg.offsets).toEqual([0, 3])
    const logged = errors.mock.calls.map(c => c.join(' ')).join('\n')
    expect(logged).toContain('update 1 failed')
    expect(logged).not.toContain(TOKEN)
  })

  it('a webhook is reported as a problem', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const tg = telegram([{ status: 409, body: { ok: false, error_code: 409, description: 'Conflict: can\'t use getUpdates method while webhook is active' } }])
    const bot = start(tg)
    await tg.idle
    expect(bot.status().problem).toBe('telegram.webhook')
    // asked again once a minute
    expect(instant).toHaveBeenCalledWith(60_000)
  })

  it('another reader is a problem until a poll goes through', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const conflict: Answer = { status: 409, body: { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' } }
    const problems: (string | null)[] = []
    let bot: BotHandle | null = null
    const sleep = vi.fn(async () => { problems.push(bot?.status().problem ?? null) })
    const tg = telegram([conflict, ok([])])
    bot = start(tg, undefined, sleep)
    await tg.idle
    expect(problems).toEqual(['telegram.other_reader', null])
    expect(bot.status().problem).toBeNull()
  })

  it('backs off from 5 s, doubling up to a minute, while Telegram is unreachable, and logs it once', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tg = telegram(['down', 'down', 'down', 'down', 'down', 'down', ok([]), 'down'])
    start(tg)
    await tg.idle
    expect(instant.mock.calls.map(c => c[0])).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 1_000, 5_000])
    expect(errors).toHaveBeenCalledTimes(2)
    expect(errors.mock.calls.map(c => c.join(' ')).join('\n')).not.toContain(TOKEN)
  })

  it('learns its username at start, retrying until Telegram answers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const tg = telegram([], ['down', 'down'])
    const bot = start(tg)
    expect(bot.username()).toBeNull()
    await tg.idle
    expect(bot.username()).toBe('fcbot')
    expect(instant.mock.calls.map(c => c[0])).toEqual([5_000, 10_000])
    expect(bot.status().problem).toBeNull()
  })

  it('a token Telegram refuses is a problem, logged with Telegram\'s reason and without the token', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const refused: Answer = { status: 401, body: { ok: false, error_code: 401, description: 'Unauthorized' } }
    const problems: (string | null)[] = []
    let bot: BotHandle | null = null
    const sleep = vi.fn(async () => { problems.push(bot?.status().problem ?? null) })
    const tg = telegram([], [refused, { status: 404, body: { ok: false, error_code: 404, description: 'Not Found' } }])
    bot = start(tg, undefined, sleep)
    await tg.idle
    expect(problems).toEqual(['telegram.bad_token', 'telegram.bad_token'])
    // once getMe answers, the token is fine
    expect(bot.status()).toEqual({ configured: true, username: 'fcbot', problem: null })
    const logged = errors.mock.calls.map(c => c.join(' ')).join('\n')
    expect(logged).toContain('getMe: telegram.bad_token status 401 Unauthorized')
    expect(logged).toContain('getMe: telegram.bad_token status 404 Not Found')
    expect(logged).not.toContain(TOKEN)
  })

  it('a token revoked while running is a problem too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const tg = telegram([{ status: 401, body: { ok: false, error_code: 401, description: 'Unauthorized' } }])
    const bot = start(tg)
    await tg.idle
    expect(bot.status().problem).toBe('telegram.bad_token')
    expect(instant).toHaveBeenCalledWith(5_000)
  })

  it('stop ends the loop', async () => {
    const tg = telegram([ok([text(1, 'a')])])
    const bot = start(tg)
    await tg.idle
    const polls = tg.offsets.length
    // stop() resolves once the loop has returned, so nothing polls after it (only the one confirming call)
    await bot.stop()
    expect(tg.offsets).toHaveLength(polls)
    expect(tg.confirmed).toEqual([2])
  })

  it('stop does not wait out a back-off', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const tg = telegram(['down'])
    let paused = () => {}
    const inPause = new Promise<void>(resolve => { paused = resolve })
    const bot = start(tg, undefined, () => { paused(); return new Promise<void>(() => {}) })
    await inPause
    await bot.stop()
    expect(tg.fetchImpl).toHaveBeenCalledTimes(2)
  })
})
