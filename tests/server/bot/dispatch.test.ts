import { describe, expect, it, vi } from 'vitest'
import { createBotDispatcher } from '../../../src/server/bot/dispatch'
import type { BotUpdate } from '../../../src/server/bot/updates'
import { beginPairing } from '../../../src/modules/reminders/reminders'
import { fakeAuthRuntime } from '../../helpers/auth'
import { createTestDb, testConfig } from '../../helpers/db'

const config = testConfig({ TELEGRAM_BOT_TOKEN: 'T0KEN' })
const env = { TELEGRAM_BOT_TOKEN: 'T0KEN' }
const auth = fakeAuthRuntime({ botToken: 'T0KEN' })
const start = (code: string): BotUpdate => ({ kind: 'message', chatId: '42', chatType: 'private', from: { id: '42', name: 'Robin' }, text: `/start ${code}`, date: 1 })
const chat = (db: ReturnType<typeof createTestDb>) => (db.sqlite.prepare('SELECT chat_id FROM reminder_settings').get() as { chat_id: string | null }).chat_id

describe('the bot dispatcher', () => {
  it('hands an update to a module, with no module state to read', async () => {
    const db = createTestDb()
    const { pairingToken } = await beginPairing(db, env)
    await createBotDispatcher({ db, config, auth, token: 'T0KEN' })(start(pairingToken))
    expect(chat(db)).toBe('42')
  })

  it('the core hears first; an update it takes goes no further', async () => {
    const db = createTestDb()
    const { pairingToken } = await beginPairing(db, env)
    const seen: string[] = []
    const core = [
      vi.fn(async () => { seen.push('first'); return false }),
      vi.fn(async () => { seen.push('second'); return true }),
    ]
    await createBotDispatcher({ db, config, auth, token: 'T0KEN', core })(start(pairingToken))
    expect(seen).toEqual(['first', 'second'])
    expect(chat(db)).toBeNull()
  })

  it('a button press nobody takes is still answered, so its spinner stops; a taken one and a text are not', async () => {
    const db = createTestDb()
    const calls: { method: string; body: Record<string, unknown> }[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ method: url.slice(url.lastIndexOf('/') + 1), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      return new Response(JSON.stringify({ ok: true, result: true }))
    }) as unknown as typeof fetch
    const press = (data: string): BotUpdate => ({ kind: 'callback', id: `cb-${data}`, chatId: '42', messageId: 1, from: { id: '42', name: 'Robin' }, data })
    // a press of a kind no handler knows
    await createBotDispatcher({ db, config, auth, token: 'T0KEN', fetchImpl })(press('zz:1'))
    expect(calls).toEqual([{ method: 'answerCallbackQuery', body: { callback_query_id: 'cb-zz:1' } }])

    calls.length = 0
    await createBotDispatcher({ db, config, auth, token: 'T0KEN', fetchImpl, core: [async () => true] })(press('login:x'))
    await createBotDispatcher({ db, config, auth, token: 'T0KEN', fetchImpl })(start('nothing-pending'))
    expect(calls).toEqual([])

    // Telegram failing to take the answer is logged by its code, not thrown
    const errors = vi.spyOn(console, 'log').mockImplementation(() => {})
    const down = vi.fn(async () => { throw new Error('network') }) as unknown as typeof fetch
    await expect(createBotDispatcher({ db, config, auth, token: 'T0KEN', fetchImpl: down })(press('zz:1'))).resolves.toBeUndefined()
    expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toMatchObject({ event_name: 'monido.telegram.callback_failed', attributes: { 'error.type': 'telegram.unavailable' } })
    errors.mockRestore()
  })

  it('answers a stray button press with the token it was given, not config.telegramBotToken', async () => {
    const db = createTestDb()
    const urls: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return new Response(JSON.stringify({ ok: true, result: true }))
    }) as unknown as typeof fetch
    const press: BotUpdate = { kind: 'callback', id: 'cb-1', chatId: '42', messageId: 1, from: { id: '42', name: 'Robin' }, data: 'zz:1' }
    await createBotDispatcher({ db, config: testConfig(), auth, token: 'FROM-RUNTIME', fetchImpl })(press)
    expect(urls).toEqual(['https://api.telegram.org/botFROM-RUNTIME/answerCallbackQuery'])
  })
})
