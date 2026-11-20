import { describe, expect, it } from 'vitest'
import { isPersonal, signInLinkOf, signInManagerSql } from '../../src/server/signIn'
import { createTestDb, testConfig } from '../helpers/db'

const OIDC = { OIDC_ISSUER: 'https://idp.test/', OIDC_CLIENT_ID: 'monido', OIDC_CLIENT_SECRET: 's', APP_URL: 'https://money.test' }

describe('personal accounts', () => {
  it('telegram and oidc are the modes with personal accounts', () => {
    expect(['password', 'telegram', 'oidc', 'bootstrap', 'none', 'demo'].filter(isPersonal)).toEqual(['telegram', 'oidc'])
  })

  it('the link that counts for signing in follows the mode', () => {
    expect(signInLinkOf('telegram', testConfig())).toEqual({ method: 'telegram' })
    expect(signInLinkOf('oidc', testConfig(OIDC))).toEqual({ method: 'oidc', issuer: 'https://idp.test/' })
    expect(signInLinkOf('oidc', testConfig())).toBeNull()
    expect(signInLinkOf('password', testConfig(OIDC))).toBeNull()
  })

  it('a manager counts in the provider mode only with an identity of the configured issuer', () => {
    const db = createTestDb()
    db.sqlite.exec(`INSERT INTO members (name) VALUES ('Ann'), ('Bob');
      INSERT INTO users (member, can_manage, telegram_id, created_at, updated_at) VALUES ('Ann', 1, '100', 't', 't'), ('Bob', 0, NULL, 't', 't')`)
    const has = (link: Parameters<typeof signInManagerSql>[0]) => {
      const { sql, params } = signInManagerSql(link)
      return !!db.sqlite.prepare(sql).get(...params)
    }
    const oidc = { method: 'oidc', issuer: 'https://idp.test/' } as const
    expect(has({ method: 'telegram' })).toBe(true)
    expect(has(oidc)).toBe(false)
    // bound under another issuer (an old OIDC_ISSUER, or the same one without its slash): not this provider's manager
    db.sqlite.exec("INSERT INTO user_identities (user_id, issuer, subject, linked_at) VALUES (1, 'https://idp.test', 'ann', 't')")
    expect(has(oidc)).toBe(false)
    db.sqlite.exec("UPDATE user_identities SET issuer = 'https://idp.test/'")
    expect(has(oidc)).toBe(true)
    // a bound member without the manage right does not count
    db.sqlite.exec("UPDATE users SET can_manage = 0 WHERE member = 'Ann'")
    expect(has(oidc)).toBe(false)
  })
})
