import { describe, expect, it } from 'vitest'
import type { AuthSettingsView, InviteLink, UsersView } from '../../src/domain/api'
import { createApp } from '../../src/server/app'
import { hashPassword, loadAuthRuntime } from '../../src/server/authSettings'
import { issueIdentityInvite } from '../../src/server/identities'
import { createTestDb, testConfig, type TestDb } from '../helpers/db'
import { cookieNamed } from '../helpers/auth'
import { fakeOidc } from '../helpers/fakeOidc'
import { userCookie } from '../helpers/session'

const APP = 'https://money.test'
const PASSWORD = 'a family password'
const OIDC_ENV = { OIDC_ISSUER: 'https://idp.test/', OIDC_CLIENT_ID: 'monido', OIDC_CLIENT_SECRET: 's3cret', APP_URL: APP }

/** Anna (1, manager) and Ben (2); `bound` binds Anna as `anna` long ago; the mode as given (oidc needs Anna bound) */
async function setup({ mode = 'password', bound = false, env = {} }: { mode?: 'password' | 'oidc' | 'telegram'; bound?: boolean; env?: Record<string, string> } = {}) {
  const idp = await fakeOidc()
  const db: TestDb = createTestDb()
  db.sqlite.exec(`INSERT INTO members (name) VALUES ('Anna'), ('Ben');
    INSERT INTO users (id, member, can_manage, telegram_id, created_at, updated_at) VALUES (1, 'Anna', 1, '100', '2020-01-01T00:00:00.000Z', 't'), (2, 'Ben', 0, NULL, '2020-01-01T00:00:00.000Z', 't')`)
  if (bound) db.sqlite.exec("INSERT INTO user_identities (user_id, issuer, subject, linked_at) VALUES (1, 'https://idp.test/', 'anna', '2020-01-01T00:00:00.000Z')")
  db.sqlite.prepare("INSERT INTO app_settings (key, value) VALUES ('auth_password', ?), ('auth_mode', ?), ('auth_bot_token', '123:token')").run(await hashPassword(PASSWORD), mode)
  const config = testConfig({ ...OIDC_ENV, ...env }, 'test-secret')
  const auth = await loadAuthRuntime(db, config, { log: () => {} })
  const bot = { username: () => 'fcbot', status: () => ({ configured: true, username: 'fcbot', problem: null }) }
  const app = createApp({ db, config, auth, ratesOnline: false, oidcFetch: idp.fetch, bot })
  return { app, auth, db, idp }
}
type Setup = Awaited<ReturnType<typeof setup>>

const post = (body: unknown, cookie = '') => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) })

async function familySession({ app }: Setup): Promise<string> {
  const res = await app.request(`${APP}/api/auth/login`, post({ password: PASSWORD }))
  expect(res.status).toBe(200)
  return cookieNamed(res, 'session')
}

/** A manager's test sign-in from the family password: start (POST) → the provider → the callback; the callback's answer */
async function testSignIn(s: Setup, family: string, { userId = 1, sub = 'anna', callbackCookie }: { userId?: number; sub?: string; callbackCookie?: string } = {}) {
  const start = await s.app.request(`${APP}/api/auth/oidc/test`, post({ userId, return: '/settings/access' }, family))
  expect(start.status).toBe(200)
  const { url } = await start.json() as { url: string }
  const stateCookie = cookieNamed(start, 'oidc')
  const done = await s.app.request(s.idp.approve(url, { sub, name: 'Anna at the provider' }), { headers: { Cookie: `${stateCookie}; ${callbackCookie ?? family}` } })
  return { url, done, ticket: cookieNamed(done, 'switch') }
}

const settingsView = async ({ app }: Setup, cookie: string) =>
  (await app.request(`${APP}/api/auth-settings`, { headers: { Cookie: cookie } })).json() as Promise<AuthSettingsView>

describe('the switch to the provider', () => {
  it('a manager\'s test sign-in binds them and earns the ticket; the switch then signs them in', async () => {
    const s = await setup()
    const family = await familySession(s)
    const before = await settingsView(s, family)
    expect(before.switchToOidc).toEqual({
      configured: true, problem: null, provider: 'idp.test', redirectUri: `${APP}/api/auth/oidc/callback`, linkedManager: false, proof: null,
    })
    const { url, done, ticket } = await testSignIn(s, family)
    expect(new URL(url).searchParams.get('prompt')).toBe('login')
    expect(done.headers.get('Location')).toBe('/settings/access?oidc_test=done')
    expect(ticket).not.toBe('')
    const after = await settingsView(s, `${family}; ${ticket}`)
    expect(after.switchToOidc).toMatchObject({ linkedManager: true, proof: { member: 'Anna', manage: true, provider: 'Anna at the provider' } })
    const switched = await s.app.request(`${APP}/api/auth-settings/mode`, post({ mode: 'oidc', current: PASSWORD }, `${family}; ${ticket}`))
    expect(switched.status).toBe(200)
    expect(s.auth.mode()).toBe('oidc')
    const me = await (await s.app.request(`${APP}/api/auth`, { headers: { Cookie: cookieNamed(switched, 'session') } })).json() as { me: { name: string } }
    expect(me.me.name).toBe('Anna')
  })

  it('a manager already bound runs the test sign-in again and gets a new ticket', async () => {
    const s = await setup({ bound: true })
    const family = await familySession(s)
    const { done, ticket } = await testSignIn(s, family)
    expect(done.headers.get('Location')).toBe('/settings/access?oidc_test=done')
    expect(ticket).not.toBe('')
  })

  it('a test sign-in needs the family session at start and at the callback', async () => {
    const s = await setup()
    expect((await s.app.request(`${APP}/api/auth/oidc/test`, post({ userId: 1 }))).status).toBe(401)
    const family = await familySession(s)
    const { done } = await testSignIn(s, family, { callbackCookie: '' })
    expect(done.headers.get('Location')).toBe('/settings/access?sign_in_error=unauthorized')
    expect(s.db.sqlite.prepare('SELECT COUNT(*) AS n FROM user_identities').get()).toEqual({ n: 0 })
  })

  it('an account bound to someone else is oidc_taken', async () => {
    const s = await setup({ bound: true })
    const family = await familySession(s)
    const { done } = await testSignIn(s, family, { userId: 2, sub: 'anna' })
    expect(done.headers.get('Location')).toBe('/settings/access?sign_in_error=oidc_taken')
  })

  it('the switch needs a provider ticket: none, or one from Telegram, is no_proof; from Telegram the switch is wrong_mode', async () => {
    const s = await setup({ bound: true })
    const family = await familySession(s)
    const refused = await s.app.request(`${APP}/api/auth-settings/mode`, post({ mode: 'oidc', current: PASSWORD }, family))
    expect(await refused.json()).toEqual({ error: { code: 'no_proof' } })
    const t = await setup({ mode: 'telegram', bound: true })
    const anna = await userCookie(t.auth, 1)
    const wrong = await t.app.request(`${APP}/api/auth-settings/mode`, post({ mode: 'oidc', current: PASSWORD }, anna))
    expect(await wrong.json()).toEqual({ error: { code: 'wrong_mode' } })
  })

  it('the view names the configuration problem', async () => {
    const s = await setup({ env: { OIDC_CLIENT_SECRET: '' } })
    const view = await settingsView(s, await familySession(s))
    expect(view.switchToOidc).toMatchObject({ configured: true, problem: 'secret_missing', provider: null })
  })

  it('a POST from another host than APP_URL\'s is oidc_wrong_host', async () => {
    const s = await setup()
    const family = await familySession(s)
    const res = await s.app.request('http://192.168.1.5:8080/api/auth/oidc/test', post({ userId: 1 }, family))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'oidc_wrong_host', params: { appUrl: APP } } })
  })
})

describe('invitations', () => {
  /** Ben's invitation: issued by Anna through the API in the provider mode */
  async function invited(s: Setup) {
    const res = await s.app.request(`${APP}/api/users/2/identity-invite`, post({}, await userCookie(s.auth, 1)))
    expect(res.status).toBe(200)
    const { link } = await res.json() as InviteLink
    expect(link).toMatch(new RegExp(`^${APP}/invite/oidc/`))
    return link.split('/').pop()!
  }

  it('the link names its member; only the POST starts the provider; the return binds and signs in', async () => {
    const s = await setup({ mode: 'oidc', bound: true })
    const code = await invited(s)
    expect(await (await s.app.request(`${APP}/api/auth/oidc/invite/${code}`)).json()).toEqual({ member: 'Ben' })
    expect(s.db.sqlite.prepare('SELECT COUNT(*) AS n FROM user_identities WHERE user_id = 2').get()).toEqual({ n: 0 })
    const start = await s.app.request(`${APP}/api/auth/oidc/invite/${code}`, post({}))
    const { url } = await start.json() as { url: string }
    expect(new URL(url).searchParams.get('prompt')).toBe('login')
    const done = await s.app.request(s.idp.approve(url, { sub: 'ben' }), { headers: { Cookie: cookieNamed(start, 'oidc') } })
    expect(done.headers.get('Location')).toBe('/')
    const me = await (await s.app.request(`${APP}/api/auth`, { headers: { Cookie: cookieNamed(done, 'session') } })).json() as { me: { name: string } }
    expect(me.me.name).toBe('Ben')
  })

  it('an unknown, used or expired code binds nothing; an account bound to someone else is oidc_taken', async () => {
    const s = await setup({ mode: 'oidc', bound: true })
    expect((await s.app.request(`${APP}/api/auth/oidc/invite/nope`)).status).toBe(404)
    expect((await s.app.request(`${APP}/api/auth/oidc/invite/nope`, post({}))).status).toBe(404)
    const code = await invited(s)
    const start = await s.app.request(`${APP}/api/auth/oidc/invite/${code}`, post({}))
    const { url } = await start.json() as { url: string }
    const taken = await s.app.request(s.idp.approve(url, { sub: 'anna' }), { headers: { Cookie: cookieNamed(start, 'oidc') } })
    expect(taken.headers.get('Location')).toBe('/?sign_in_error=oidc_taken')
    const expired = await issueIdentityInvite(s.db, 2, new Date('2020-01-01T00:00:00Z'))
    expect((await s.app.request(`${APP}/api/auth/oidc/invite/${expired.code}`)).status).toBe(404)
  })
})

describe('unbinding', () => {
  it('the last manager bound to the provider keeps the binding; another member is unbound', async () => {
    const s = await setup({ mode: 'oidc', bound: true })
    s.db.sqlite.exec("INSERT INTO user_identities (user_id, issuer, subject, linked_at) VALUES (2, 'https://idp.test/', 'ben', '2020-01-01T00:00:00.000Z')")
    const anna = await userCookie(s.auth, 1)
    const refused = await s.app.request(`${APP}/api/users/1/identity`, { method: 'DELETE', headers: { Cookie: anna } })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: { code: 'last_manager' } })
    const done = await s.app.request(`${APP}/api/users/2/identity`, { method: 'DELETE', headers: { Cookie: anna } })
    expect(done.status).toBe(200)
    expect((await done.json() as UsersView).users.find(u => u.member === 'Ben')?.identity).toBe(false)
  })
})
