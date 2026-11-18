import { describe, expect, it } from 'vitest'
import { InputError, type Actor } from '../../src/server/http'
import {
  acceptInvite, createUser, deleteUser, findUser, hasSignInManager, issueInvite, readUsers, updateUser, type UserRules,
} from '../../src/server/users'
import { createTestDb, type TestDb } from '../helpers/db'

const actor: Actor = { name: 'owner@example.com', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null }
const telegram: UserRules = { mode: 'telegram' }
const NOW = new Date('2031-10-03T10:00:00Z')

function setup(): TestDb {
  const db = createTestDb()
  db.sqlite.exec("INSERT INTO members (name) VALUES ('Anna'), ('Ben')")
  return db
}
const refusal = async (p: Promise<unknown>) => { try { await p; return null } catch (e) { return e } }
const log = (db: TestDb) => db.sqlite.prepare("SELECT * FROM change_log WHERE table_name = 'users' ORDER BY id").all() as Record<string, unknown>[]

describe('createUser', () => {
  it('takes a member from members and the default rights', async () => {
    const db = setup()
    const user = await createUser(db, { member: 'Anna' }, actor)
    expect(user.rights).toEqual({ edit: true, vote: true, manage: false })
    expect(await readUsers(db)).toHaveLength(1)
  })

  it('refuses an unknown member', async () => {
    expect(await refusal(createUser(setup(), { member: 'Zed' }, actor))).toEqual(new InputError('unknown_member', 400))
  })

  it('refuses a second user for the same member', async () => {
    const db = setup()
    await createUser(db, { member: 'Anna' }, actor)
    expect(await refusal(createUser(db, { member: 'Anna' }, actor))).toMatchObject({ code: 'user_exists', status: 409 })
  })

})

describe('the last manager', () => {
  it('stays: manage cannot be removed from or the user deleted when they are the only one', async () => {
    const db = setup()
    const anna = await createUser(db, { member: 'Anna', rights: { manage: true } }, actor)
    await createUser(db, { member: 'Ben' }, actor)
    expect(await refusal(updateUser(db, anna.id, { rights: { manage: false } }, actor, { mode: 'password' }))).toMatchObject({ code: 'last_manager', status: 409 })
    expect(await refusal(deleteUser(db, anna.id, actor, { mode: 'password' }))).toMatchObject({ code: 'last_manager', status: 409 })
  })

  it('under the family password, users added without the right to manage keep editable rights while no one manages', async () => {
    const db = setup()
    const ben = await createUser(db, { member: 'Ben', rights: { manage: false } }, actor)
    const updated = await updateUser(db, ben.id, { rights: { vote: false } }, actor, { mode: 'password' })
    expect(updated.rights.vote).toBe(false)
    // once someone manages, removing the last one is refused again
    await updateUser(db, ben.id, { rights: { manage: true } }, actor, { mode: 'password' })
    expect(await refusal(updateUser(db, ben.id, { rights: { manage: false } }, actor, { mode: 'password' }))).toMatchObject({ code: 'last_manager' })
  })

  it('counts only a manager with Telegram in telegram mode', async () => {
    const db = setup()
    const anna = await createUser(db, { member: 'Anna', rights: { manage: true } }, actor)
    const ben = await createUser(db, { member: 'Ben', rights: { manage: true } }, actor)
    db.sqlite.exec("UPDATE users SET telegram_id = '1' WHERE member = 'Anna'")
    expect(await hasSignInManager(db)).toBe(true)
    expect(await refusal(deleteUser(db, anna.id, actor, telegram))).toMatchObject({ code: 'last_manager' })
    expect(await refusal(updateUser(db, anna.id, { rights: { manage: false } }, actor, telegram))).toMatchObject({ code: 'last_manager' })
    await deleteUser(db, ben.id, actor, telegram)
  })

  it('stays in telegram mode even as the only user: nobody could sign in again', async () => {
    const db = setup()
    const anna = await createUser(db, { member: 'Anna', rights: { manage: true } }, actor)
    db.sqlite.exec("UPDATE users SET telegram_id = '1' WHERE member = 'Anna'")
    expect(await refusal(deleteUser(db, anna.id, actor, telegram))).toMatchObject({ code: 'last_manager', status: 409 })
    expect(await readUsers(db)).toHaveLength(1)
  })

  it('stays when two managers are demoted or deleted at once: the second write re-reads and is refused', async () => {
    for (const [first, second] of [['update', 'update'], ['delete', 'delete'], ['update', 'delete']] as const) {
      const db = setup()
      db.sqlite.exec("INSERT INTO members (name) VALUES ('Cleo')")
      const anna = await createUser(db, { member: 'Anna', rights: { manage: true } }, actor)
      const ben = await createUser(db, { member: 'Ben', rights: { manage: true } }, actor)
      await createUser(db, { member: 'Cleo' }, actor)
      const write = (kind: 'update' | 'delete', id: number) => kind === 'update'
        ? updateUser(db, id, { rights: { manage: false } }, actor, { mode: 'password' })
        : deleteUser(db, id, actor, { mode: 'password' })
      const results = await Promise.allSettled([write(first, anna.id), write(second, ben.id)])
      expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected'])
      expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ code: 'last_manager', status: 409 })
      expect((await readUsers(db)).some(u => u.rights.manage)).toBe(true)
    }
  })

  it('may go to no users under the family password', async () => {
    const db = setup()
    const anna = await createUser(db, { member: 'Anna', rights: { manage: true } }, actor)
    await deleteUser(db, anna.id, actor, { mode: 'password' })
    expect(await readUsers(db)).toEqual([])
  })

})

describe('rights in a request', () => {
  it('take only the three rights, not inherited names', async () => {
    const db = setup()
    for (const rights of [{ toString: true }, { constructor: true }, { admin: true }]) {
      expect(await refusal(createUser(db, { member: 'Anna', rights }, actor))).toMatchObject({ code: 'invalid_value', params: { column: 'rights' } })
    }
  })
})

describe('the journal', () => {
  it('records user changes without the invite columns', async () => {
    const db = setup()
    const user = await createUser(db, { member: 'Anna', rights: { manage: true } }, actor)
    await issueInvite(db, user.id, 'fcbot', NOW)
    await updateUser(db, user.id, { rights: { vote: false } }, actor, { mode: 'password' })
    await deleteUser(db, user.id, actor, { mode: 'password' })
    const rows = log(db)
    expect(rows.map(r => r.op)).toEqual(['insert', 'update', 'delete'])
    for (const row of rows) {
      for (const json of [row.before_json, row.after_json]) {
        if (json) expect(Object.keys(JSON.parse(json as string))).not.toContain('invite_hash')
      }
    }
    expect(JSON.parse(String(rows[1].after_json))).toMatchObject({ can_vote: 0 })
  })
})

describe('invites', () => {
  async function invited() {
    const db = setup()
    const user = await createUser(db, { member: 'Anna' }, actor)
    const { link, expiresAt } = await issueInvite(db, user.id, 'fcbot', NOW)
    return { db, user, link, expiresAt, code: link.split('start=link_')[1] }
  }

  it('makes a 7-day single-use link', async () => {
    const { link, expiresAt } = await invited()
    expect(link).toMatch(/^https:\/\/t\.me\/fcbot\?start=link_[A-Za-z0-9_-]{22}$/)
    expect(expiresAt).toBe('2031-10-10T10:00:00.000Z')
  })

  it('replaces the old link with a new one', async () => {
    const { db, user, code } = await invited()
    await issueInvite(db, user.id, 'fcbot', NOW)
    expect(await acceptInvite(db, code, { id: '9', name: null }, NOW)).toEqual({ status: 'invalid' })
  })

  it('links the account once and not after 7 days', async () => {
    const { db, code, user } = await invited()
    expect((await findUser(db, { id: user.id }))!.invitePending).toBe(true)
    const linked = await acceptInvite(db, code, { id: '9', name: '@anna' }, NOW)
    expect(linked).toMatchObject({ status: 'linked', user: { telegramId: '9', telegramName: '@anna', invitePending: false } })
    expect(await acceptInvite(db, code, { id: '9', name: '@anna' }, NOW)).toEqual({ status: 'invalid' })
    const late = await invited()
    expect(await acceptInvite(late.db, late.code, { id: '9', name: null }, new Date(NOW.getTime() + 7 * 24 * 3600_000 + 1))).toEqual({ status: 'invalid' })
  })

  it('does not move a Telegram account linked to another user, and leaves the code unused', async () => {
    const { db, code, user } = await invited()
    await createUser(db, { member: 'Ben' }, actor)
    db.sqlite.exec("UPDATE users SET telegram_id = '9', telegram_name = 'old' WHERE member = 'Ben'")
    expect(await acceptInvite(db, code, { id: '9', name: 'new' }, NOW)).toEqual({ status: 'linked_elsewhere', member: 'Ben' })
    const users = await readUsers(db)
    expect(users.find(u => u.member === 'Ben')).toMatchObject({ telegramId: '9', telegramName: 'old' })
    expect(users.find(u => u.member === 'Anna')).toMatchObject({ telegramId: null, invitePending: true })
    expect(log(db).filter(r => r.op === 'update')).toEqual([])
    // the person it was meant for can still use it
    expect(await acceptInvite(db, code, { id: '10', name: null }, NOW)).toMatchObject({ status: 'linked', user: { id: user.id, telegramId: '10' } })
  })

  it('records when the account was linked, every time, and keeps that time out of the journal', async () => {
    const { db, code, user } = await invited()
    expect((await findUser(db, { id: user.id }))!.telegramLinkedAt).toBeNull()
    expect(await acceptInvite(db, code, { id: '9', name: null }, NOW)).toMatchObject({ status: 'linked', user: { telegramLinkedAt: NOW.toISOString() } })
    const later = new Date(NOW.getTime() + 60_000)
    const again = (await issueInvite(db, user.id, 'fcbot', later)).link.split('start=link_')[1]
    expect(await acceptInvite(db, again, { id: '10', name: null }, later)).toMatchObject({ status: 'linked', user: { telegramLinkedAt: later.toISOString() } })
    const updates = log(db).filter(r => r.op === 'update')
    expect(updates).toHaveLength(2)
    for (const row of updates) {
      for (const json of [row.before_json, row.after_json]) expect(Object.keys(JSON.parse(json as string))).not.toContain('telegram_linked_at')
    }
  })

  it('a new invite opened from the account already linked to the same user links it again', async () => {
    const { db, code, user } = await invited()
    expect(await acceptInvite(db, code, { id: '9', name: 'old' }, NOW)).toMatchObject({ status: 'linked' })
    const again = (await issueInvite(db, user.id, 'fcbot', NOW)).link.split('start=link_')[1]
    expect(await acceptInvite(db, again, { id: '9', name: 'new' }, NOW)).toMatchObject({ status: 'linked', user: { telegramId: '9', telegramName: 'new' } })
  })
})

describe('two accepts of one code', () => {
  it('link once and journal once', async () => {
    const db = setup()
    const user = await createUser(db, { member: 'Anna' }, actor)
    const { link } = await issueInvite(db, user.id, 'fcbot', NOW)
    const code = link.split('start=link_')[1]
    const results = await Promise.all([acceptInvite(db, code, { id: '1', name: null }, NOW), acceptInvite(db, code, { id: '2', name: null }, NOW)])
    expect(results.map(r => r.status).sort()).toEqual(['invalid', 'linked'])
    expect(log(db).filter(r => r.op === 'update')).toHaveLength(1)
  })
})

describe('two invites opened from one account at once', () => {
  it('link it to one user only, and the other code stays unused', async () => {
    const db = setup()
    const anna = await createUser(db, { member: 'Anna' }, actor)
    const ben = await createUser(db, { member: 'Ben' }, actor)
    const codes = await Promise.all([anna, ben].map(async u => (await issueInvite(db, u.id, 'fcbot', NOW)).link.split('start=link_')[1]))
    const results = await Promise.all(codes.map(code => acceptInvite(db, code, { id: '9', name: null }, NOW)))
    expect(results.map(r => r.status).sort()).toEqual(['linked', 'linked_elsewhere'])
    expect((await readUsers(db)).filter(u => u.telegramId === '9')).toHaveLength(1)
    expect((await readUsers(db)).filter(u => u.invitePending)).toHaveLength(1)
  })
})

describe('user ids', () => {
  it('are not given again after a delete', async () => {
    const db = setup()
    const a = await createUser(db, { member: 'Anna', rights: { manage: true } }, actor)
    await createUser(db, { member: 'Ben', rights: { manage: true } }, actor)
    db.sqlite.exec('UPDATE users SET telegram_id = id')
    await deleteUser(db, a.id, actor, telegram)
    const c = await createUser(db, { member: 'Anna' }, actor)
    expect(c.id).not.toBe(a.id)
    const last = log(db).at(-1)!
    expect(last).toMatchObject({ op: 'insert', row_id: c.id })
    expect(JSON.parse(String(last.after_json))).toMatchObject({ id: c.id, member: 'Anna' })
  })
})
