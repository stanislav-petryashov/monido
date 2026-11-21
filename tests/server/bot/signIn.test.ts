import { describe, expect, it, vi } from 'vitest'
import { handleSignIn } from '../../../src/server/bot/signIn'
import { familyT, rightsLines } from '../../../src/server/bot/texts'
import type { BotUpdate } from '../../../src/server/bot/updates'
import { createLoginAttempts } from '../../../src/server/loginAttempts'
import { findUser, issueInvite } from '../../../src/server/users'
import { createTestDb, type TestDb } from '../../helpers/db'

const TOKEN = '123:secret-token'
const ANNA = { id: '100', name: 'Anna T' }
const BEN = { id: '200', name: 'Ben T' }

function addUser(db: TestDb, member: string, { telegramId = null as string | null, manage = false } = {}): number {
  const at = '2020-01-01T00:00:00.000Z'
  db.sqlite.prepare('INSERT OR IGNORE INTO members (name) VALUES (?)').run(member)
  return Number(db.sqlite.prepare('INSERT INTO users (member, telegram_id, can_manage, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(member, telegramId, manage ? 1 : 0, at, at).lastInsertRowid)
}

/** Telegram that says yes to everything and remembers each call: the method and its body. */
function fakeTelegram({ fail = false } = {}) {
  const calls: { method: string; body: Record<string, unknown> }[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = url.slice(url.lastIndexOf('/') + 1)
    calls.push({ method, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    if (fail) return new Response(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }), { status: 403 })
    return new Response(JSON.stringify({ ok: true, result: method === 'sendMessage' ? { message_id: 7 } : true }))
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const message = (from: { id: string; name: string }, text: string, chatType = 'private'): BotUpdate =>
  ({ kind: 'message', chatId: from.id, chatType, from, text, date: 1 })
const press = (from: { id: string; name: string }, data: string, chatId = from.id): BotUpdate =>
  ({ kind: 'callback', id: `cb-${from.id}`, chatId, messageId: 7, from, data })

function setup({ fail = false } = {}) {
  const db = createTestDb()
  const logins = createLoginAttempts()
  const tg = fakeTelegram({ fail })
  const ctx = { db, token: TOKEN, logins, fetchImpl: tg.fetchImpl }
  return { db, logins, tg, ctx }
}

describe('signing in through the bot', () => {
  it('an invite link binds the Telegram account and lists the rights', async () => {
    const { db, tg, ctx } = setup()
    const id = addUser(db, 'Anna')
    const code = /link_(.+)$/.exec((await issueInvite(db, id, 'fcbot')).link)![1]
    expect(await handleSignIn(message(ANNA, `/start link_${code}`), ctx)).toBe(true)
    const user = await findUser(db, { id })
    expect(user?.telegramId).toBe(ANNA.id)
    const { t } = await familyT(db)
    expect(tg.calls).toHaveLength(1)
    expect(tg.calls[0].method).toBe('sendMessage')
    expect(tg.calls[0].body.chat_id).toBe(ANNA.id)
    const text = String(tg.calls[0].body.text)
    expect(text).toContain('Anna')
    expect(text).toContain(rightsLines(t, user!.rights))
    // linking ends the person's other sessions and Claude connections (users.ts): the reply says so
    expect(text).toContain('If you were signed in to the site before, sign in again')
    expect(text).toContain('reconnect Claude')
    expect(text).toBe(`${t('bot.link.done', { name: 'Anna' })}\n\n${rightsLines(t, user!.rights)}`)
  })

  it('a used, unknown or expired invite gets the invalid text and links nothing', async () => {
    const { db, tg, ctx } = setup()
    const id = addUser(db, 'Anna')
    const code = /link_(.+)$/.exec((await issueInvite(db, id, 'fcbot', new Date('2020-01-01'))).link)![1]
    expect(await handleSignIn(message(ANNA, `/start link_${code}`), ctx)).toBe(true)
    expect(await handleSignIn(message(ANNA, '/start link_nope'), ctx)).toBe(true)
    expect((await findUser(db, { id }))?.telegramId).toBeNull()
    const { t } = await familyT(db)
    expect(tg.calls.map(c => c.body.text)).toEqual([t('bot.link.invalid'), t('bot.link.invalid')])
  })

  it('the replies are in the family language', async () => {
    const { db, tg, ctx } = setup()
    db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('language', 'ru-RU')")
    await handleSignIn(message(BEN, '/start login_abc'), ctx)
    const { t } = await familyT(db)
    expect(t('bot.login.notInvited')).not.toBe((await familyT(createTestDb())).t('bot.login.notInvited'))
    expect(tg.calls[0].body.text).toBe(t('bot.login.notInvited'))
  })

  it('an invite opened from an account linked to someone else names them and moves nothing', async () => {
    const { db, tg, ctx } = setup()
    addUser(db, 'Ben', { telegramId: ANNA.id, manage: true })
    const id = addUser(db, 'Anna')
    const code = /link_(.+)$/.exec((await issueInvite(db, id, 'fcbot')).link)![1]
    expect(await handleSignIn(message(ANNA, `/start link_${code}`), ctx)).toBe(true)
    expect((await findUser(db, { telegramId: ANNA.id }))?.member).toBe('Ben')
    expect(await findUser(db, { id })).toMatchObject({ telegramId: null, invitePending: true })
    const { t } = await familyT(db)
    expect(tg.calls.map(c => c.body.text)).toEqual([t('bot.link.linkedElsewhere', { member: 'Ben' })])
    expect(t('bot.link.linkedElsewhere', { member: 'Ben' })).toContain('Ben')
  })

  it('a link that was accepted stays accepted when the reply fails, and the token is not logged', async () => {
    const { db, tg, ctx } = setup({ fail: true })
    const errors = vi.spyOn(console, 'log').mockImplementation(() => {})
    const id = addUser(db, 'Anna')
    const code = /link_(.+)$/.exec((await issueInvite(db, id, 'fcbot')).link)![1]
    await expect(handleSignIn(message(ANNA, `/start link_${code}`), ctx)).resolves.toBe(true)
    expect((await findUser(db, { id }))?.telegramId).toBe(ANNA.id)
    expect(tg.calls).toHaveLength(1)
    expect(errors).toHaveBeenCalled()
    expect(JSON.stringify(errors.mock.calls)).not.toContain(TOKEN)
  })

  it('a login from a stranger is refused', async () => {
    const { db, logins, tg, ctx } = setup()
    const { code } = logins.start()
    expect(await handleSignIn(message(BEN, `/start login_${code}`), ctx)).toBe(true)
    expect(tg.calls).toHaveLength(1)
    expect(tg.calls[0].body.reply_markup).toBeUndefined()
    expect(tg.calls[0].body.text).toBe((await familyT(db)).t('bot.login.notInvited'))
  })

  it('a login asks to confirm and approves on press', async () => {
    const { db, logins, tg, ctx } = setup()
    const anna = addUser(db, 'Anna', { telegramId: ANNA.id })
    const { code, secret } = logins.start()
    const { t } = await familyT(db)

    expect(await handleSignIn(message(ANNA, `/start login_${code}`), ctx)).toBe(true)
    // the /start alone approves nothing: only the press does
    expect(logins.take(code, secret)).toEqual({ status: 'waiting' })
    expect(tg.calls).toEqual([{ method: 'sendMessage', body: expect.objectContaining({
      chat_id: ANNA.id, text: t('bot.login.ask'),
      reply_markup: { inline_keyboard: [[{ text: t('bot.login.confirm'), callback_data: `login:${code}` }]] },
    }) as unknown }])

    expect(await handleSignIn(press(ANNA, `login:${code}`), ctx)).toBe(true)
    expect(logins.take(code, secret)).toMatchObject({ status: 'done', userId: anna })
    expect(tg.calls.slice(1).map(c => c.method).sort()).toEqual(['answerCallbackQuery', 'editMessageText'])
    expect(tg.calls.find(c => c.method === 'editMessageText')?.body).toMatchObject({ chat_id: ANNA.id, message_id: 7, text: t('bot.login.done') })
  })

  it('a second or late confirm approves nothing', async () => {
    const { db, logins, tg, ctx } = setup()
    addUser(db, 'Anna', { telegramId: ANNA.id })
    const { code } = logins.start()
    const { t } = await familyT(db)
    await handleSignIn(press(ANNA, `login:${code}`), ctx)
    tg.calls.length = 0
    await expect(handleSignIn(press(ANNA, `login:${code}`), ctx)).resolves.toBe(true)
    expect(tg.calls.find(c => c.method === 'editMessageText')?.body.text).toBe(t('bot.login.expired'))
    expect(tg.calls.some(c => c.method === 'answerCallbackQuery')).toBe(true)

    // an attempt that has run out
    const late = createLoginAttempts({ ttlMs: 0 })
    const { code: old } = late.start()
    tg.calls.length = 0
    await expect(handleSignIn(press(ANNA, `login:${old}`), { ...ctx, logins: late })).resolves.toBe(true)
    expect(tg.calls.find(c => c.method === 'editMessageText')?.body.text).toBe(t('bot.login.expired'))
  })

  it('a press outside the presser\'s own chat approves nothing', async () => {
    const { db, logins, tg, ctx } = setup()
    addUser(db, 'Anna', { telegramId: ANNA.id })
    addUser(db, 'Ben', { telegramId: BEN.id })
    const { code, secret } = logins.start()
    await handleSignIn(message(ANNA, `/start login_${code}`), ctx)
    // the code was issued in Anna's chat: Ben presses it there, and a stranger who is not linked in their own chat
    expect(await handleSignIn(press(BEN, `login:${code}`, ANNA.id), ctx)).toBe(true)
    expect(await handleSignIn(press({ id: '300', name: 'Stranger' }, `login:${code}`), ctx)).toBe(true)
    expect(logins.take(code, secret)).toEqual({ status: 'waiting' })
    // a group chat never approves, even for a linked account
    expect(await handleSignIn(press(ANNA, `login:${code}`, '-1001'), ctx)).toBe(true)
    expect(logins.take(code, secret)).toEqual({ status: 'waiting' })
    expect(tg.calls.filter(c => c.method === 'answerCallbackQuery')).toHaveLength(3)
  })

  it('a confirm whose reply fails is still approved, and nothing is thrown', async () => {
    const { db, logins, ctx } = setup({ fail: true })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const anna = addUser(db, 'Anna', { telegramId: ANNA.id })
    const { code, secret } = logins.start()
    await expect(handleSignIn(press(ANNA, `login:${code}`), ctx)).resolves.toBe(true)
    expect(logins.take(code, secret)).toMatchObject({ status: 'done', userId: anna })
  })

  it('unrelated messages are left to modules', async () => {
    const { db, logins, tg, ctx } = setup()
    addUser(db, 'Anna', { telegramId: ANNA.id })
    const { code } = logins.start()
    const others: BotUpdate[] = [
      message(ANNA, 'hello'),
      message(ANNA, '/start'),
      message(ANNA, `/start ${'x'.repeat(43)}`),
      message(ANNA, `/start login_${code}`, 'group'),
      message(ANNA, `/start login_${code} extra`),
      press(ANNA, `vote:${code}`),
      press(ANNA, `login:${code}:x`),
    ]
    for (const update of others) expect(await handleSignIn(update, ctx)).toBe(false)
    expect(tg.calls).toEqual([])
  })
})

describe('the bot texts', () => {
  it('rightsLines says what the person can and cannot do', async () => {
    const { t } = await familyT(createTestDb())
    expect(rightsLines(t, { edit: true, vote: false, manage: false })).toBe(
      `${t('bot.rights.can', { list: [t('bot.rights.view'), t('bot.rights.edit')].join(', ') })}\n` +
      t('bot.rights.cannot', { list: [t('bot.rights.vote'), t('bot.rights.manage')].join(', ') }),
    )
    expect(rightsLines(t, { edit: true, vote: true, manage: true }))
      .toBe(t('bot.rights.can', { list: ['view', 'edit', 'vote', 'manage'].map(r => t(`bot.rights.${r}`)).join(', ') }))
  })
})
