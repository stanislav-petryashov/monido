import { describe, expect, it } from 'vitest'
import { isRevertibleTable } from '../../src/domain/journal'
import {
  acceptIdentityInvite, bindIdentity, findIdentity, identityInviteTarget, issueIdentityInvite, unbindIdentity,
} from '../../src/server/identities'
import type { Actor } from '../../src/server/http'
import { createTestDb, type TestDb } from '../helpers/db'

const ISSUER = 'https://idp.test/'
const NOW = new Date('2031-10-03T10:00:00.000Z')
const MANAGER: Actor = { name: 'Anna', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: 1 }
const always = () => true

/** Anna (1, manager) and Ben (2) */
function setup(): TestDb {
  const db = createTestDb()
  db.sqlite.exec(`INSERT INTO members (name) VALUES ('Anna'), ('Ben');
    INSERT INTO users (id, member, can_manage, created_at, updated_at) VALUES (1, 'Anna', 1, 't', 't'), (2, 'Ben', 0, 't', 't')`)
  return db
}
const journal = (db: TestDb) => db.sqlite.prepare("SELECT actor, op, before_json, after_json FROM change_log WHERE table_name = 'user_identities' ORDER BY id").all() as Record<string, unknown>[]
const refusal = async (p: Promise<unknown>) => { try { await p; return null } catch (e) { return e } }

describe('binding a provider account', () => {
  it('binds once: a second account for the user is already_bound, the same account for another user is taken', async () => {
    const db = setup()
    expect(await bindIdentity(db, 1, { issuer: ISSUER, subject: 'anna' }, always, NOW)).toEqual({ status: 'bound', linkedAt: NOW.toISOString() })
    expect(await bindIdentity(db, 1, { issuer: ISSUER, subject: 'other' }, always, NOW)).toEqual({ status: 'already_bound' })
    expect(await bindIdentity(db, 2, { issuer: ISSUER, subject: 'anna' }, always, NOW)).toEqual({ status: 'taken' })
    expect(await findIdentity(db, { issuer: ISSUER, subject: 'anna' })).toMatchObject({ userId: 1, linkedAt: NOW.toISOString() })
  })

  it('a repeated binding of the same account is same and writes nothing; one under an old issuer is replaced', async () => {
    const db = setup()
    await bindIdentity(db, 1, { issuer: ISSUER, subject: 'anna' }, always, NOW)
    const later = new Date(NOW.getTime() + 60_000)
    expect(await bindIdentity(db, 1, { issuer: ISSUER, subject: 'anna' }, always, later)).toEqual({ status: 'same', linkedAt: NOW.toISOString() })
    expect(journal(db)).toHaveLength(1)
    db.sqlite.exec("UPDATE user_identities SET issuer = 'https://old.test/'")
    expect(await bindIdentity(db, 1, { issuer: ISSUER, subject: 'anna-new' }, always, later)).toEqual({ status: 'bound', linkedAt: later.toISOString() })
    expect(await findIdentity(db, { userId: 1 })).toMatchObject({ issuer: ISSUER, subject: 'anna-new' })
    expect(journal(db).map(e => e.op)).toEqual(['insert', 'delete', 'insert'])
  })

  it('binds nothing once the flow is no longer valid', async () => {
    const db = setup()
    expect(await bindIdentity(db, 1, { issuer: ISSUER, subject: 'anna' }, () => false, NOW)).toEqual({ status: 'expired' })
    expect(await findIdentity(db, { userId: 1 })).toBeNull()
  })

  it('the journal shows the binding under user_identities, and the journal never reverts it', async () => {
    const db = setup()
    await bindIdentity(db, 2, { issuer: ISSUER, subject: 'ben' }, always, NOW)
    expect(journal(db)).toEqual([{ actor: 'Ben', op: 'insert', before_json: null, after_json: expect.stringContaining('"subject":"ben"') }])
    expect(isRevertibleTable('user_identities')).toBe(false)
  })
})

describe('unbinding', () => {
  it('the last manager bound under the issuer keeps the binding; anyone else can be unbound', async () => {
    const db = setup()
    await bindIdentity(db, 1, { issuer: ISSUER, subject: 'anna' }, always, NOW)
    await bindIdentity(db, 2, { issuer: ISSUER, subject: 'ben' }, always, NOW)
    expect(await refusal(unbindIdentity(db, 1, MANAGER, { lastManagerIssuer: ISSUER }))).toMatchObject({ code: 'last_manager', status: 409 })
    await unbindIdentity(db, 2, MANAGER, { lastManagerIssuer: ISSUER })
    expect(await findIdentity(db, { userId: 2 })).toBeNull()
    // outside the provider mode nobody signs in through it: no rule
    await unbindIdentity(db, 1, MANAGER, { lastManagerIssuer: null })
    expect(await findIdentity(db, { userId: 1 })).toBeNull()
    expect(journal(db).filter(e => e.op === 'delete').map(e => e.actor)).toEqual(['Anna', 'Anna'])
  })

  it('a user without a binding is identity_not_found', async () => {
    expect(await refusal(unbindIdentity(setup(), 2, MANAGER, { lastManagerIssuer: null }))).toMatchObject({ code: 'identity_not_found', status: 404 })
  })
})

describe('invitations', () => {
  it('names its member while valid; a new one voids the old code; the hash is never journaled', async () => {
    const db = setup()
    const first = await issueIdentityInvite(db, 2, NOW)
    expect(await identityInviteTarget(db, first.code, NOW)).toEqual({ userId: 2, member: 'Ben' })
    const second = await issueIdentityInvite(db, 2, NOW)
    expect(await identityInviteTarget(db, first.code, NOW)).toBeNull()
    expect(await identityInviteTarget(db, second.code, NOW)).toEqual({ userId: 2, member: 'Ben' })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM change_log WHERE after_json LIKE '%hash%' OR table_name = 'identity_invites'").get()).toEqual({ n: 0 })
  })

  it('an expired invite is invalid', async () => {
    const db = setup()
    const { code, expiresAt } = await issueIdentityInvite(db, 2, NOW)
    expect(await identityInviteTarget(db, code, new Date(expiresAt))).toBeNull()
    expect(await acceptIdentityInvite(db, code, { issuer: ISSUER, subject: 'ben' }, new Date(expiresAt))).toEqual({ status: 'invalid' })
  })

  it('accepting binds and uses the code; using it again is invalid', async () => {
    const db = setup()
    const { code } = await issueIdentityInvite(db, 2, NOW)
    expect(await acceptIdentityInvite(db, code, { issuer: ISSUER, subject: 'ben' }, NOW)).toEqual({ status: 'bound', userId: 2, linkedAt: NOW.toISOString() })
    expect(await acceptIdentityInvite(db, code, { issuer: ISSUER, subject: 'ben' }, NOW)).toEqual({ status: 'invalid' })
  })

  it('an account bound to someone else is taken and the code stays; a user already bound is already_bound', async () => {
    const db = setup()
    await bindIdentity(db, 1, { issuer: ISSUER, subject: 'anna' }, always, NOW)
    const { code } = await issueIdentityInvite(db, 2, NOW)
    expect(await acceptIdentityInvite(db, code, { issuer: ISSUER, subject: 'anna' }, NOW)).toEqual({ status: 'taken', member: 'Anna' })
    expect(await identityInviteTarget(db, code, NOW)).not.toBeNull()
    await bindIdentity(db, 2, { issuer: ISSUER, subject: 'ben' }, always, NOW)
    expect(await acceptIdentityInvite(db, code, { issuer: ISSUER, subject: 'ben-2' }, NOW)).toEqual({ status: 'already_bound' })
  })

  it('two accepts of one invite at once bind once', async () => {
    const db = setup()
    const { code } = await issueIdentityInvite(db, 2, NOW)
    const results = await Promise.all([
      acceptIdentityInvite(db, code, { issuer: ISSUER, subject: 'ben' }, NOW),
      acceptIdentityInvite(db, code, { issuer: ISSUER, subject: 'mallory' }, NOW),
    ])
    expect(results.filter(r => r.status === 'bound')).toHaveLength(1)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM user_identities').get()).toEqual({ n: 1 })
  })
})
