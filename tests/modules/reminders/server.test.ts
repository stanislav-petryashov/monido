import { createApp } from '../../../src/server/app'
import { createBotDispatcher } from '../../../src/server/bot/dispatch'
import type { BotUpdate } from '../../../src/server/bot/updates'
import { createTestDb, testConfig } from '../../helpers/db'
import { authFor, fakeAuthRuntime } from '../../helpers/auth'
import { FAMILY_PASSWORD, familyCookie, userCookie } from '../../helpers/session'

const config = () => testConfig({ password: FAMILY_PASSWORD, TELEGRAM_BOT_TOKEN: 'secret' })
const get = async (path: string, db = createTestDb()) => {
  const auth = authFor(config())
  return createApp({ db, config: config(), auth }).request(path, { headers: { Cookie: await familyCookie(auth) } })
}

describe('reminders as a module', () => {
  it('answers on /api/reminders while on', async () => {
    const res = await get('/api/reminders')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ configured: true, linked: false })
  })

})

// Exercise the authenticated API through recipient persistence and the eventual send.
describe('pairing API', () => {
  it('requires authentication and the same origin to issue or confirm a pairing code', async () => {
    const auth = authFor(config())
    const app = createApp({ db: createTestDb(), config: config(), auth })
    const cookie = await familyCookie(auth)
    for (const path of ['/api/reminders/pairing', '/api/reminders/link']) {
      expect((await app.request(path, { method: 'POST' })).status).toBe(401)
      expect((await app.request(path, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://elsewhere.example' } })).status).toBe(403)
    }
  })

  it('links only the chat that sent the issued code to the bot, and sends only there', async () => {
    const db = createTestDb()
    const auth = authFor(config())
    const app = createApp({ db, config: config(), auth })
    const hear = createBotDispatcher({ db, config: config(), auth, token: 'secret' })
    const headers = { Cookie: await familyCookie(auth), 'Content-Type': 'application/json' }
    const issued = await app.request('/api/reminders/pairing', { method: 'POST', headers })
    expect(issued.status).toBe(200)
    expect(issued.headers.get('Cache-Control')).toBe('no-store')
    const pairing = await issued.json() as { pairingToken: string }
    const info = await app.request('/api/reminders', { headers })
    expect(JSON.stringify(await info.json())).not.toContain(pairing.pairingToken)
    const message = (chatId: string, text: string): BotUpdate => ({ kind: 'message', chatId, chatType: 'private', from: { id: chatId, name: null }, text, date: 1 })
    const confirm = () => app.request('/api/reminders/link', { method: 'POST', headers, body: JSON.stringify(pairing) })
    await hear(message('7', '/start'))
    const pending = await confirm()
    expect(pending.status).toBe(404)
    expect(await pending.json()).toEqual({ error: { code: 'reminders.no_start' } })
    expect(db.sqlite.prepare('SELECT chat_id FROM reminder_settings').get()).toMatchObject({ chat_id: null })
    await hear(message('42', `/start ${pairing.pairingToken}`))
    const linked = await confirm()
    expect(linked.status).toBe(200)
    expect(await linked.json()).toMatchObject({ linked: true })
    // the code is used up: sending it again from another chat changes nothing
    await hear(message('7', `/start ${pairing.pairingToken}`))
    const telegram = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} })))
    vi.stubGlobal('fetch', telegram)
    expect((await app.request('/api/reminders/test', { method: 'POST', headers })).status).toBe(200)
    const [, init] = telegram.mock.calls.at(-1) as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: '42' })
  })

  it('logs a test delivery failure with the Telegram error code and omits its description', async () => {
    const db = createTestDb()
    db.sqlite.exec("INSERT OR REPLACE INTO reminder_settings (id, chat_id) VALUES (1, '42')")
    const auth = authFor(config())
    const app = createApp({ db, config: config(), auth })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, description: 'private upstream text' }, { status: 401 })))
    const res = await app.request('/api/reminders/test', { method: 'POST', headers: { Cookie: await familyCookie(auth) } })
    expect(res.status).toBe(502)
    expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.parse(log.mock.calls[0][0]).attributes).toMatchObject({
      'error.type': 'telegram.bad_token', 'monido.operation': 'reminders', 'http.response.status_code': 502,
      'monido.request.id': res.headers.get('X-Request-Id'),
    })
    expect(log.mock.calls[0][0]).not.toContain('private upstream text')
  })

  it('rejects a legacy link request without a pairing code', async () => {
    const auth = authFor(config())
    const app = createApp({ db: createTestDb(), config: config(), auth })
    const telegram = vi.fn()
    vi.stubGlobal('fetch', telegram)
    const response = await app.request('/api/reminders/link', {
      method: 'POST', headers: { Cookie: await familyCookie(auth), 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'reminders.invalid_pairing' } })
    expect(telegram).not.toHaveBeenCalled()
  })
})

describe('reminders settings need manage', () => {
  it('an editor is refused the writes but reads', async () => {
    const db = createTestDb()
    const add = (member: string, telegramId: string, manage: number) => Number(db.sqlite.prepare("INSERT INTO users (member, telegram_id, can_manage, created_at, updated_at) VALUES (?, ?, ?, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')").run(member, telegramId, manage).lastInsertRowid)
    const ids = { boss: add('Boss', '1', 1), editor: add('Editor', '2', 0) }
    const telegram = testConfig({ mode: 'telegram', TELEGRAM_BOT_TOKEN: 'secret' })
    const auth = authFor(telegram)
    const app = createApp({ db, config: telegram, auth })
    const as = async (who: keyof typeof ids, method: string) => app.request('/api/reminders', { method, headers: { Cookie: await userCookie(auth, ids[who]), 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) })
    expect((await as('editor', 'GET')).status).toBe(200)
    const put = await as('editor', 'PUT')
    expect(put.status).toBe(403)
    expect(await put.json()).toEqual({ error: { code: 'no_right_manage' } })
    expect((await as('boss', 'PUT')).status).not.toBe(403)
  })
})

describe('the module env follows the runtime', () => {
  it('configured follows the env built from auth.botToken()', async () => {
    const auth = fakeAuthRuntime({ mode: 'password', botToken: null, password: FAMILY_PASSWORD })
    const app = createApp({ db: createTestDb(), config: testConfig({ password: FAMILY_PASSWORD }), auth })
    const configured = async () => ((await (await app.request('/api/reminders', { headers: { Cookie: await familyCookie(auth) } })).json()) as { configured: boolean }).configured
    expect(await configured()).toBe(false)
    auth.set({ botToken: '1:x' })
    expect(await configured()).toBe(true)
    auth.set({ botToken: null })
    expect(await configured()).toBe(false)
  })
})
