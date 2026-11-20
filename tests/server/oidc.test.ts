import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/server/app'
import { hashPassword, loadAuthRuntime } from '../../src/server/authSettings'
import { safeReturn } from '../../src/server/oidc'
import { createTestDb, testConfig, type TestDb } from '../helpers/db'
import { cookieNamed } from '../helpers/auth'
import { fakeOidc } from '../helpers/fakeOidc'

const APP = 'https://money.test'
const OIDC_ENV = { OIDC_ISSUER: 'https://idp.test/', OIDC_CLIENT_ID: 'monido', OIDC_CLIENT_SECRET: 's3cret', APP_URL: APP }

/** A family in the provider mode: Anna, a manager bound long ago as `anna`; the family password set */
async function setup({ mode = 'oidc', env = {}, idp: given }: { mode?: 'oidc' | 'password'; env?: Record<string, string>; idp?: Awaited<ReturnType<typeof fakeOidc>> } = {}) {
  const idp = given ?? await fakeOidc()
  const db: TestDb = createTestDb()
  db.sqlite.exec(`INSERT INTO members (name) VALUES ('Anna');
    INSERT INTO users (id, member, can_manage, created_at, updated_at) VALUES (1, 'Anna', 1, '2020-01-01T00:00:00.000Z', 't');
    INSERT INTO user_identities (user_id, issuer, subject, linked_at) VALUES (1, 'https://idp.test/', 'anna', '2020-01-01T00:00:00.000Z')`)
  db.sqlite.prepare("INSERT INTO app_settings (key, value) VALUES ('auth_password', ?), ('auth_mode', ?)").run(await hashPassword('a family password'), mode)
  const config = testConfig({ ...OIDC_ENV, ...env }, 'test-secret')
  const auth = await loadAuthRuntime(db, config, { log: () => {} })
  const app = createApp({ db, config, auth, ratesOnline: false, oidcFetch: idp.fetch })
  return { app, auth, db, idp }
}

type Setup = Awaited<ReturnType<typeof setup>>

/** Start → the provider approves `sub` → the callback with the state cookie; `tamper` may change the callback URL */
async function signIn({ app, idp }: Setup, { sub = 'anna', returnTo = '/goals', nonce, tamper = (u: string) => u }: { sub?: string; returnTo?: string; nonce?: string; tamper?: (u: string) => string } = {}) {
  const start = await app.request(`${APP}/api/auth/oidc/start?return=${encodeURIComponent(returnTo)}`)
  expect(start.status).toBe(302)
  const stateCookie = cookieNamed(start, 'oidc')
  const callback = tamper(idp.approve(start.headers.get('Location')!, { sub, ...(nonce ? { nonce } : {}) }))
  const done = await app.request(callback, { headers: { Cookie: stateCookie } })
  return { start, stateCookie, callback, done }
}

const whoami = async ({ app }: Setup, done: Response) =>
  (await app.request(`${APP}/api/auth`, { headers: { Cookie: cookieNamed(done, 'session') } })).json() as Promise<{ authenticated: boolean; me: { name: string } | null }>

describe('sign-in through the provider', () => {
  it('a bound member signs in and lands on the saved path', async () => {
    const s = await setup()
    const { start, done } = await signIn(s)
    const sent = new URL(start.headers.get('Location')!)
    expect(sent.origin).toBe('https://idp.test')
    expect(Object.fromEntries(sent.searchParams)).toMatchObject({
      client_id: 'monido', redirect_uri: `${APP}/api/auth/oidc/callback`, response_type: 'code', scope: 'openid profile', code_challenge_method: 'S256',
    })
    expect(start.headers.getSetCookie().find(l => l.startsWith('oidc='))).toMatch(/Path=\/api\/auth\/oidc.*HttpOnly.*Secure.*SameSite=Lax/i)
    expect(done.status).toBe(302)
    expect(done.headers.get('Location')).toBe('/goals')
    expect(await whoami(s, done)).toMatchObject({ authenticated: true, me: { name: 'Anna' } })
  })

  it('an unknown account gets oidc_not_linked and no session', async () => {
    const s = await setup()
    const { done } = await signIn(s, { sub: 'stranger' })
    expect(done.headers.get('Location')).toBe('/?sign_in_error=oidc_not_linked')
    expect(cookieNamed(done, 'session')).toBe('')
  })

  it('a callback without the state cookie never calls the provider', async () => {
    const s = await setup()
    const start = await s.app.request(`${APP}/api/auth/oidc/start`)
    const callback = s.idp.approve(start.headers.get('Location')!, { sub: 'anna' })
    const done = await s.app.request(callback)
    expect(done.headers.get('Location')).toBe('/?sign_in_error=oidc_expired')
    expect(s.idp.state.tokenCalls).toBe(0)
  })

  it('a forged state, a wrong nonce and a replayed code are refused', async () => {
    const s = await setup()
    const forged = await signIn(s, { tamper: u => u.replace(/state=[^&]+/, 'state=forged') })
    expect(forged.done.headers.get('Location')).toBe('/?sign_in_error=oidc_failed')
    const nonce = await signIn(s, { nonce: 'not-the-one' })
    expect(nonce.done.headers.get('Location')).toBe('/?sign_in_error=oidc_failed')
    // the callback deletes the state cookie: the replay sends the saved one again by hand
    const first = await signIn(s)
    expect(first.done.headers.get('Location')).toBe('/goals')
    const replay = await s.app.request(first.callback, { headers: { Cookie: first.stateCookie } })
    expect(replay.headers.get('Location')).toBe('/?sign_in_error=oidc_failed')
    expect(cookieNamed(replay, 'session')).toBe('')
  })

  it('an ID token from an issuer differing by a trailing slash is refused', async () => {
    const s = await setup()
    s.idp.state.idTokenIssuer = 'https://idp.test'
    expect((await signIn(s)).done.headers.get('Location')).toBe('/?sign_in_error=oidc_failed')
  })

  it('discovery stating the issuer without its slash is refused as a misconfiguration', async () => {
    const s = await setup()
    s.idp.state.discoveredIssuer = 'https://idp.test'
    const start = await s.app.request(`${APP}/api/auth/oidc/start`)
    expect(start.headers.get('Location')).toBe('/?sign_in_error=oidc_failed')
  })

  it('a provider that does not answer gives oidc_unavailable, and discovery is not retried at once', async () => {
    const s = await setup()
    s.idp.state.down = true
    const first = await s.app.request(`${APP}/api/auth/oidc/start`)
    expect(first.headers.get('Location')).toBe('/?sign_in_error=oidc_unavailable')
    s.idp.state.down = false
    const second = await s.app.request(`${APP}/api/auth/oidc/start`)
    expect(second.headers.get('Location')).toBe('/?sign_in_error=oidc_unavailable')
  })

  it('a start on a host other than APP_URL\'s moves to APP_URL first, and gives up on a second mismatch', async () => {
    const s = await setup()
    const moved = await s.app.request('http://192.168.1.5:8080/api/auth/oidc/start?return=%2Fgoals')
    expect(moved.status).toBe(302)
    expect(moved.headers.get('Location')).toBe(`${APP}/api/auth/oidc/start?return=%2Fgoals&moved=1`)
    const looped = await s.app.request('http://192.168.1.5:8080/api/auth/oidc/start?return=%2Fgoals&moved=1')
    expect(looped.headers.get('Location')).toBe('/?sign_in_error=oidc_wrong_host')
  })

  it('takes the name from userinfo when the ID token has none', async () => {
    const s = await setup()
    s.idp.state.nameOnlyInUserinfo = true
    const { done } = await signIn(s)
    expect(done.headers.get('Location')).toBe('/goals')
  })

  it('answers wrong_mode for a sign-in outside the provider mode, and nothing in the demo', async () => {
    const s = await setup({ mode: 'password' })
    expect((await s.app.request(`${APP}/api/auth/oidc/start`)).status).toBe(409)
    const demo = createApp({ db: createTestDb(), config: testConfig({ AUTH_MODE: 'demo' }, 'test-secret'), auth: (await setup()).auth, ratesOnline: false })
    expect((await demo.request(`${APP}/api/auth/oidc/start`)).status).not.toBe(302)
  })
})

describe('the callback against hammering', () => {
  it('a state cookie older than ten minutes is refused without asking the provider', async () => {
    const s = await setup()
    const start = await s.app.request(`${APP}/api/auth/oidc/start`)
    const callback = s.idp.approve(start.headers.get('Location')!, { sub: 'anna' })
    const later = Date.now() + 11 * 60_000
    const now = vi.spyOn(Date, 'now').mockReturnValue(later)
    try {
      const done = await s.app.request(callback, { headers: { Cookie: cookieNamed(start, 'oidc') } })
      expect(done.headers.get('Location')).toBe('/?sign_in_error=oidc_expired')
    } finally { now.mockRestore() }
    expect(s.idp.state.tokenCalls).toBe(0)
  })

  it('a start another site triggers is not started and not counted; our own button and a typed address start', async () => {
    const s = await setup()
    const start = (site: string) => s.app.request(`${APP}/api/auth/oidc/start?return=%2Fgoals`, { headers: { 'Sec-Fetch-Site': site } })
    for (let i = 0; i < 15; i++) {
      const foreign = await start('cross-site')
      expect(foreign.headers.get('Location')).toBe('/goals')
      expect(cookieNamed(foreign, 'oidc')).toBe('')
    }
    for (const site of ['same-origin', 'none']) expect(new URL((await start(site)).headers.get('Location')!, APP).origin).toBe('https://idp.test')
  })

  it('callbacks count against the address: one saved state cookie cannot make Monido hammer the provider', async () => {
    const s = await setup()
    const start = await s.app.request(`${APP}/api/auth/oidc/start`)
    const cookie = cookieNamed(start, 'oidc')
    const answers: string[] = []
    for (let i = 0; i < 15; i++) {
      const res = await s.app.request(`${APP}/api/auth/oidc/callback?code=x${i}&state=forged`, { headers: { Cookie: cookie } })
      answers.push(res.headers.get('Location')!)
    }
    expect(answers.at(-1)).toBe('/?sign_in_error=too_many_attempts')
    expect(s.idp.state.tokenCalls).toBeLessThan(10)
  })
})

describe('safeReturn', () => {
  it.each([
    ['/goals', '/goals'],
    ['/advisor/connect?request=abc', '/advisor/connect?request=abc'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/.//evil.example', '/'],
    ['/a/..//evil.example', '/'],
    ['/%2e//evil.example', '/'],
    ['/.\\/evil.example', '/'],
    ['https://evil.example/', '/'],
    ['/a\nb', '/'],
    ['goals', '/'],
    [42, '/'],
    ['/' + 'é'.repeat(600), '/'],
  ])('%j → %s', (given, expected) => {
    expect(safeReturn(given, APP)).toBe(expected)
  })
})
