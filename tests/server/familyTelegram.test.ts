import { describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../helpers/db'
import { beginGroupPairing, familyTelegramView, saveTelegramGroup, saveTelegramPreferences } from '../../src/server/familyTelegram'
import { handleFamilyTelegram } from '../../src/server/familyTelegramBot'
import { actorOfUser } from '../../src/server/auth'
import { deleteUser, updateUser } from '../../src/server/users'
import type { BotUpdate } from '../../src/server/bot/updates'
import { runScheduled } from '../../src/modules/reminders/reminders'
import { deliverGroupProposals } from '../../src/server/familyTelegramDelivery'

const actor = { name: 'family', source: 'admin' as const, userId: null, rights: { manage: true, edit: true, vote: true } }
const now = new Date('2031-10-03T11:00:00Z')
function setup() {
  const db = createTestDb()
  db.sqlite.exec(`INSERT INTO members (name) VALUES ('Anna'), ('Ben');
    INSERT INTO users (member, telegram_id, can_manage, created_at, updated_at) VALUES ('Anna', '11', 1, '2020-01-01', '2020-01-01'), ('Ben', '22', 1, '2020-01-01', '2020-01-01');`)
  return db
}
const update = (text: string, from = '11'): BotUpdate => ({ kind: 'message', chatId: '-100', chatType: 'supergroup', chatTitle: 'Family', from: { id: from, name: 'Anna' }, text, date: now.getTime() / 1000 })
const transport = () => vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }))

describe('family Telegram', () => {
  it('keeps bot identity/rights while disabling sign-in and protects the remaining enabled manager', async () => {
    const db = setup()
    expect(await actorOfUser(db, 1, now.getTime())).not.toBeNull()
    await saveTelegramPreferences(db, 1, { signIn: false }, 'telegram')
    expect(await actorOfUser(db, 1, now.getTime())).toBeNull()
    expect((await familyTelegramView(db)).users[0]).toMatchObject({ signIn: false, conversation: true, proposals: true })
    await expect(saveTelegramPreferences(db, 2, { signIn: false }, 'telegram')).rejects.toMatchObject({ code: 'last_manager' })
    await expect(deleteUser(db, 2, actor, { mode: 'telegram' })).rejects.toMatchObject({ code: 'last_manager' })
    await expect(updateUser(db, 2, { rights: { manage: false } }, actor, { mode: 'telegram' })).rejects.toMatchObject({ code: 'last_manager' })
    await expect(saveTelegramPreferences(db, 1, { reminders: 'yes' }, 'password')).rejects.toMatchObject({ code: 'invalid_value' })
  })
  it('preserves independent settings when managers update a group concurrently', async () => {
    const db = setup()
    db.sqlite.exec("INSERT INTO family_telegram_groups (chat_id, title) VALUES ('-100', 'Family')")
    await Promise.all([
      saveTelegramGroup(db, '-100', { reminders: true }),
      saveTelegramGroup(db, '-100', { proposals: true }),
    ])
    expect((await familyTelegramView(db)).groups[0]).toMatchObject({ reminders: true, proposals: true, conversation: false })
  })
  it('pairs only an addressed group command from a linked manager, with a single-use unexpired code', async () => {
    const db = setup(), fetchImpl = transport()
    const ctx = { db, token: 'token', username: 'familybot', now, fetchImpl }
    const { command } = await beginGroupPairing(db, 'familybot', now)
    await handleFamilyTelegram(update(command, 'unknown'), ctx)
    await handleFamilyTelegram(update(command.replace('@familybot', '@otherbot')), ctx)
    expect((await familyTelegramView(db)).groups).toEqual([])
    await handleFamilyTelegram(update(command), ctx)
    expect((await familyTelegramView(db)).groups[0]).toMatchObject({ chatId: '-100', title: 'Family', conversation: false })
    await db.prepare('DELETE FROM family_telegram_groups').run()
    await handleFamilyTelegram(update(command), ctx)
    expect((await familyTelegramView(db)).groups).toEqual([])
    const expired = await beginGroupPairing(db, 'familybot', new Date(now.getTime() - 11 * 60_000))
    await handleFamilyTelegram(update(expired.command), ctx)
    expect((await familyTelegramView(db)).groups).toEqual([])
  })
  it('does not disclose summaries to strangers, unpaired groups, other bots or opted-out conversations', async () => {
    const db = setup(), fetchImpl = transport()
    const ctx = { db, token: 'token', username: 'familybot', now, fetchImpl }
    const { command } = await beginGroupPairing(db, 'familybot', now)
    await handleFamilyTelegram(update(command), ctx)
    fetchImpl.mockClear()
    await handleFamilyTelegram(update('/summary@familybot'), ctx)
    await saveTelegramGroup(db, '-100', { conversation: true })
    await handleFamilyTelegram(update('/summary@familybot', 'unknown'), ctx)
    await handleFamilyTelegram(update('/summary@otherbot'), ctx)
    await handleFamilyTelegram(update('/summary'), ctx)
    expect(fetchImpl).not.toHaveBeenCalled()
    await handleFamilyTelegram(update('/summary@familybot'), ctx)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await saveTelegramPreferences(db, 1, { conversation: false }, 'password')
    await handleFamilyTelegram(update('/summary@familybot'), ctx)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('rechecks a group connection after building the financial snapshot', async () => {
    const db = setup(), fetchImpl = transport()
    db.sqlite.exec("INSERT INTO family_telegram_groups (chat_id, title, conversation) VALUES ('-100', 'Family', 1)")
    const snapshots = await import('../../src/server/snapshot')
    const original = snapshots.getSnapshot
    const spy = vi.spyOn(snapshots, 'getSnapshot').mockImplementationOnce(async (...args) => {
      await db.prepare('DELETE FROM family_telegram_groups').run()
      return original(...args)
    })
    try {
      await handleFamilyTelegram(update('/summary@familybot'), { db, token: 'token', username: 'familybot', now, fetchImpl })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })
  it('/summary writes "—" for a net worth that misses a balance or a rate, as Overview does', async () => {
    const db = setup(), fetchImpl = transport()
    db.sqlite.exec("INSERT INTO family_telegram_groups (chat_id, title, conversation) VALUES ('-100', 'Family', 1)")
    const { makeSnapshot } = await import('../helpers/snapshot')
    const base = makeSnapshot()
    const capital = { ...base.capital!, loans: [{ ...base.capital!.loans[0], balanceBase: null }] }
    const partial = { ...base, capital, capitalCoverage: [{ month: capital.date.slice(0, 7), assetsKnown: true, liquidKnown: true, capitalKnown: false, missingAccounts: [] }] }
    const snapshots = await import('../../src/server/snapshot')
    const spy = vi.spyOn(snapshots, 'getSnapshot').mockResolvedValueOnce(partial)
    try {
      await handleFamilyTelegram(update('/summary@familybot'), { db, token: 'token', username: 'familybot', now, fetchImpl })
      const text = String(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).text)
      expect(text).toMatch(/Net worth: —/)
      expect(text).toMatch(/Liabilities: —/)
      expect(text).not.toMatch(/Assets: —/)
    } finally { spy.mockRestore() }
  })
  it('shares the reminder schedule across opted-in users and groups and claims each day once', async () => {
    const db = setup(), fetchImpl = transport()
    db.sqlite.exec(`UPDATE reminder_settings SET enabled = 1, start_day = 3, hour = 10;
      UPDATE users SET telegram_reminders = 1 WHERE id = 1;
      INSERT INTO family_telegram_groups (chat_id, title, reminders) VALUES ('-100', 'Family', 1);`)
    await runScheduled(db, { TELEGRAM_BOT_TOKEN: 'token' }, now, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const chats = fetchImpl.mock.calls.map(([, opts]) => JSON.parse(String(opts?.body)).chat_id)
    expect(chats).toEqual(['-100', '11'])
    await runScheduled(db, { TELEGRAM_BOT_TOKEN: 'token' }, now, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('keeps reminder pairing reachable when council conversation is disabled', async () => {
    const { createBotDispatcher } = await import('../../src/server/bot/dispatch')
    const { beginPairing } = await import('../../src/modules/reminders/reminders')
    const { authFor } = await import('../helpers/auth')
    const { testConfig } = await import('../helpers/db')
    const db = setup()
    await saveTelegramPreferences(db, 1, { conversation: false }, 'password')
    const { pairingToken } = await beginPairing(db, { TELEGRAM_BOT_TOKEN: 'token' })
    const config = testConfig({ TELEGRAM_BOT_TOKEN: 'token' })
    const dispatch = createBotDispatcher({ db, config, auth: authFor(config), token: 'token', fetchImpl: transport() })
    await dispatch({ kind: 'message', chatId: '11', chatType: 'private', from: { id: '11', name: 'Anna' }, text: `/start ${pairingToken}`, date: Date.now() / 1000 })
    expect(db.sqlite.prepare('SELECT chat_id FROM reminder_settings').get()).toEqual({ chat_id: '11' })
  })
  it('does not send group proposal events to an opted-out or disconnected chat', async () => {
    const db = setup(), fetchImpl = transport()
    db.sqlite.exec("INSERT INTO family_telegram_groups (chat_id,title) VALUES ('-100', 'Family')")
    await deliverGroupProposals(db, { TELEGRAM_BOT_TOKEN: 'token' }, fetchImpl)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('family Telegram API permissions', () => {
  it('requires manage on reads and every mutation; validates payloads through the route', async () => {
    const { Hono } = await import('hono')
    const { familyTelegramRoutes } = await import('../../src/server/familyTelegramRoutes')
    const { authFor } = await import('../helpers/auth')
    const { testConfig } = await import('../helpers/db')
    const db = setup()
    let manage = false
    const app = new Hono<{ Variables: { actor: typeof actor } }>()
    app.use('*', async (c, next) => { c.set('actor', { ...actor, rights: { ...actor.rights, manage } }); await next() })
    app.route('/', familyTelegramRoutes({ db, auth: authFor(testConfig()), botUsername: () => 'familybot' }))
    for (const [url, method] of [['', 'GET'], ['/users/1', 'PUT'], ['/pairing', 'POST'], ['/groups/-100', 'PUT'], ['/groups/-100', 'DELETE']]) {
      expect((await app.request(`/api/family-telegram${url}`, { method })).status).toBe(403)
    }
    manage = true
    expect((await app.request('/api/family-telegram')).status).toBe(200)
    expect((await app.request('/api/family-telegram/users/1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"reminders":true}' })).status).toBe(200)
    expect((await familyTelegramView(db)).users[0].reminders).toBe(true)
    expect(db.sqlite.prepare("SELECT actor, source FROM change_log WHERE table_name = 'users' ORDER BY id DESC LIMIT 1").get()).toEqual({ actor: 'family', source: 'admin' })
    expect((await app.request('/api/family-telegram/users/1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"chatId":"evil"}' })).status).toBe(400)
  })
})
