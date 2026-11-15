import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { createApp } from '../../../src/server/app'
import { mountStatic } from '../../../src/server/static'
import { createLoginAttempts, type LoginAttempts } from '../../../src/server/loginAttempts'
import { acceptInvite, issueInvite } from '../../../src/server/users'
import { connectorStatus } from '../../../src/modules/advisor/connector'
import type { ConnectorView, ConsentRequest } from '../../../src/domain/api'
import { createTestDb, testConfig } from '../../helpers/db'
import { addUser } from '../../helpers/users'
import { authFor, fakeAuthRuntime } from '../../helpers/auth'
import { withTempDirs } from '../../helpers/tmp'

const APP_URL = 'https://family.test'
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
const TELEGRAM = { mode: 'telegram', TELEGRAM_BOT_TOKEN: '123:token', APP_URL }

const tempDir = withTempDirs('ffd-oauth-')
afterEach(() => {
  vi.useRealTimers()
})

/** A built client folder with the SPA page: a route that falls through would answer it with 200. */
function clientDir(): string {
  const dir = tempDir()
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>spa</title>')
  return dir
}

const BOT = { username: () => 'fcbot', status: () => ({ configured: true, username: 'fcbot', problem: null }) }

function setup(env: Record<string, string> = TELEGRAM) {
  const db = createTestDb()
  const logins = createLoginAttempts()
  const app = createApp({ db, config: testConfig(env, 'test-secret'), auth: authFor(testConfig(env, 'test-secret')), logins, bot: BOT, ratesOnline: false })
  mountStatic(app, clientDir())
  return { db, app, logins }
}

/** The telegram sign-in: start, the bot approves for the user, the browser takes the session; the session cookie */
async function signIn(app: Pick<Hono, 'request'>, logins: LoginAttempts, userId: number): Promise<string> {
  const start = await app.request('/api/auth/telegram', { method: 'POST' })
  const { link } = await start.json() as { link: string }
  const login = start.headers.getSetCookie().find(l => l.startsWith('login='))!.split(';')[0]
  expect(logins.approve(/login_(.+)$/.exec(link)![1], userId)).toBe(true)
  const done = await app.request('/api/auth/telegram', { headers: { Cookie: login } })
  return done.headers.getSetCookie().find(l => l.startsWith('session='))!.split(';')[0]
}

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

const jsonPost = (body: unknown, headers: Record<string, string> = {}) =>
  ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const formPost = (body: Record<string, string>, headers: Record<string, string> = {}) =>
  ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body).toString() })

async function register(app: Pick<Hono, 'request'>, redirectUris: string[] = [CALLBACK], name = 'Claude'): Promise<string> {
  const res = await app.request('/oauth/register', jsonPost({ client_name: name, redirect_uris: redirectUris }))
  expect(res.status).toBe(201)
  return (await res.json() as { client_id: string }).client_id
}

function authorizeUrl(params: Record<string, string>): string {
  return `/oauth/authorize?${new URLSearchParams(params).toString()}`
}

const validParams = (clientId: string, challenge: string, extra: Record<string, string> = {}) => ({
  response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256',
  state: 'st-1', resource: `${APP_URL}/mcp`, scope: 'advisor', ...extra,
})

/** register → authorize → the pending request id */
async function pendingRequest(app: Pick<Hono, 'request'>, challenge = pkce().challenge, extra: Record<string, string> = {}) {
  const clientId = await register(app)
  const res = await app.request(authorizeUrl(validParams(clientId, challenge, extra)))
  expect(res.status).toBe(302)
  const location = new URL(res.headers.get('Location')!, APP_URL)
  expect(location.pathname).toBe('/advisor/connect')
  return { clientId, requestId: location.searchParams.get('request')! }
}

/** The browser that started the request carries its binding cookie (set by /oauth/authorize); `bound: false` — another browser */
const consent = (app: Pick<Hono, 'request'>, id: string, cookie: string, approve?: boolean, { bound = true }: { bound?: boolean } = {}) => {
  const Cookie = bound ? `${cookie}; advisor_request=${id}` : cookie
  return approve === undefined
    ? app.request(`/api/advisor/oauth/requests/${id}`, { headers: { Cookie } })
    : app.request(`/api/advisor/oauth/requests/${id}`, jsonPost({ approve }, { Cookie }))
}

/** A Claude connection of the member signed in with `cookie`: register → authorize → approve → code → the token pair */
async function connect(app: Pick<Hono, 'request'>, cookie: string) {
  const { verifier, challenge } = pkce()
  const { clientId, requestId } = await pendingRequest(app, challenge)
  const { redirect } = await (await consent(app, requestId, cookie, true)).json() as { redirect: string }
  const res = await app.request('/oauth/token', formPost({
    grant_type: 'authorization_code', code: new URL(redirect).searchParams.get('code')!, code_verifier: verifier, client_id: clientId, redirect_uri: CALLBACK,
  }))
  expect(res.status).toBe(200)
  return { clientId, ...await res.json() as { access_token: string; refresh_token: string } }
}

/** An MCP initialize with `token`: 200 while the connection lives, 401 once it is ended */
const mcpInitialize = (app: Pick<Hono, 'request'>, token: string) => app.request('/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }),
})

describe('connectorStatus', () => {
  it('is available only in telegram mode with an https APP_URL', () => {
    expect(connectorStatus(testConfig(TELEGRAM), authFor(testConfig(TELEGRAM)))).toEqual({ available: true, reason: null, mcpUrl: `${APP_URL}/mcp` })
    expect(connectorStatus(testConfig({ ...TELEGRAM, APP_URL: `${APP_URL}/` }), authFor(testConfig({ ...TELEGRAM, APP_URL: `${APP_URL}/` })))).toEqual({ available: true, reason: null, mcpUrl: `${APP_URL}/mcp` })
    expect(connectorStatus(testConfig({ password: 'correct horse', APP_URL }), authFor(testConfig({ password: 'correct horse', APP_URL })))).toEqual({ available: false, reason: 'auth_mode', mcpUrl: null })
    expect(connectorStatus(testConfig({ ...TELEGRAM, APP_URL: 'http://family.test' }), authFor(testConfig({ ...TELEGRAM, APP_URL: 'http://family.test' })))).toEqual({ available: false, reason: 'app_url', mcpUrl: null })
    expect(connectorStatus(testConfig({ mode: 'telegram', TELEGRAM_BOT_TOKEN: '1:t' }), authFor(testConfig({ mode: 'telegram', TELEGRAM_BOT_TOKEN: '1:t' })))).toEqual({ available: false, reason: 'app_url', mcpUrl: null })
    expect(connectorStatus(testConfig({ AUTH_MODE: 'demo', APP_URL }), authFor(testConfig({ AUTH_MODE: 'demo', APP_URL })))).toEqual({ available: false, reason: 'auth_mode', mcpUrl: null })
    // RFC 8414 would look for the metadata of an issuer with a path at a path-suffixed well-known URL, which is not served
    for (const appUrl of [`${APP_URL}/family`, `${APP_URL}/family/`, `${APP_URL}/?x=1`, `${APP_URL}/#top`, 'https://user@family.test']) {
      expect(connectorStatus(testConfig({ ...TELEGRAM, APP_URL: appUrl }), authFor(testConfig({ ...TELEGRAM, APP_URL: appUrl }))), appUrl).toEqual({ available: false, reason: 'app_url', mcpUrl: null })
    }
  })
})

describe('the OAuth endpoints', () => {
  it('serves both metadata documents built from APP_URL, not the request host', async () => {
    const { app } = setup()
    const resource = {
      resource: `${APP_URL}/mcp`, authorization_servers: [APP_URL], scopes_supported: ['advisor'], bearer_methods_supported: ['header'],
    }
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await app.request(`http://evil.example${path}`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(resource)
    }
    const res = await app.request('http://evil.example/.well-known/oauth-authorization-server')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      issuer: APP_URL,
      authorization_endpoint: `${APP_URL}/oauth/authorize`,
      token_endpoint: `${APP_URL}/oauth/token`,
      registration_endpoint: `${APP_URL}/oauth/register`,
      revocation_endpoint: `${APP_URL}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['advisor'],
    })
  })

  it('the full flow: register → authorize redirects to /advisor/connect → the signed-in member approves → code → token', async () => {
    const { app, db, logins } = setup()
    const anna = addUser(db, 'Anna', { telegramId: '100' })
    const cookie = await signIn(app, logins, anna)

    const reg = await app.request('/oauth/register', jsonPost({ client_name: 'Claude', redirect_uris: [CALLBACK] }))
    expect(reg.status).toBe(201)
    expect(reg.headers.get('Cache-Control')).toBe('no-store')
    const client = await reg.json() as { client_id: string }
    expect(client).toMatchObject({ client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' })

    const { verifier, challenge } = pkce()
    const auth = await app.request(authorizeUrl(validParams(client.client_id, challenge)))
    expect(auth.status).toBe(302)
    const location = auth.headers.get('Location')!
    expect(location).toMatch(/^\/advisor\/connect\?request=[A-Za-z0-9_-]{43}$/)
    const requestId = new URL(location, APP_URL).searchParams.get('request')!
    // the request is bound to this browser: only it can answer
    const binding = auth.headers.getSetCookie().find(l => l.startsWith('advisor_request='))!
    expect(binding.split(';')[0]).toBe(`advisor_request=${requestId}`)
    expect(binding).toMatch(/HttpOnly/)
    expect(binding).toMatch(/SameSite=Lax/)
    expect(binding).toMatch(/Secure/)
    expect(binding).toMatch(/Path=\/api\/advisor\/oauth(;|$)/)
    expect(binding).toMatch(/Max-Age=600/)

    const shown = await consent(app, requestId, cookie)
    expect(shown.status).toBe(200)
    expect(await shown.json()).toEqual({ clientName: 'Claude', redirectHost: 'claude.ai', member: 'Anna' } satisfies ConsentRequest)

    const approved = await consent(app, requestId, cookie, true)
    expect(approved.status).toBe(200)
    const redirect = new URL((await approved.json() as { redirect: string }).redirect)
    expect(`${redirect.origin}${redirect.pathname}`).toBe(CALLBACK)
    expect(redirect.searchParams.get('state')).toBe('st-1')
    const code = redirect.searchParams.get('code')!
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const token = await app.request('/oauth/token', formPost({
      grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: CALLBACK, resource: `${APP_URL}/mcp`,
    }))
    expect(token.status).toBe(200)
    expect(token.headers.get('Cache-Control')).toBe('no-store')
    const pair = await token.json() as { access_token: string; refresh_token: string }
    expect(pair).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'advisor' })
    const row = db.sqlite.prepare("SELECT user_id, client_id FROM oauth_tokens WHERE kind = 'access'").get() as { user_id: number; client_id: string }
    expect(row).toEqual({ user_id: anna, client_id: client.client_id })

    // the refresh grant through the same endpoint
    const refreshed = await app.request('/oauth/token', formPost({ grant_type: 'refresh_token', refresh_token: pair.refresh_token, client_id: client.client_id }))
    expect(refreshed.status).toBe(200)
    expect(await refreshed.json()).toMatchObject({ token_type: 'Bearer' })
  })

  it('a Claude Code loopback callback on another port than registered is accepted', async () => {
    const { app } = setup()
    const clientId = await register(app, ['http://127.0.0.1:3000/callback'])
    const res = await app.request(authorizeUrl({ ...validParams(clientId, pkce().challenge), redirect_uri: 'http://127.0.0.1:41234/callback' }))
    expect(res.headers.get('Location')).toMatch(/^\/advisor\/connect\?request=/)
  })

  it('denying answers the redirect URI with error=access_denied and the state', async () => {
    const { app, db, logins } = setup()
    const cookie = await signIn(app, logins, addUser(db, 'Anna', { telegramId: '100' }))
    const { requestId } = await pendingRequest(app)
    const denied = await consent(app, requestId, cookie, false)
    expect(denied.status).toBe(200)
    const redirect = new URL((await denied.json() as { redirect: string }).redirect)
    expect(`${redirect.origin}${redirect.pathname}`).toBe(CALLBACK)
    expect(Object.fromEntries(redirect.searchParams)).toEqual({ error: 'access_denied', state: 'st-1' })
    // the request is gone with the answer
    expect((await consent(app, requestId, cookie, true)).status).toBe(404)
  })

  it('an unknown client or an unregistered redirect URI never redirects to that URI', async () => {
    const { app } = setup()
    const clientId = await register(app)
    const { challenge } = pkce()
    const cases: [Record<string, string>, string][] = [
      [{ client_id: 'unknown-client' }, 'advisor.unknown_client'],
      [{ redirect_uri: 'https://claude.com/api/mcp/auth_callback' }, 'advisor.invalid_redirect_uri'],
      [{ redirect_uri: 'https://evil.example/callback' }, 'advisor.invalid_redirect_uri'],
      [{ client_id: '' }, 'advisor.invalid_request'],
      [{ redirect_uri: '' }, 'advisor.invalid_request'],
    ]
    for (const [override, error] of cases) {
      const res = await app.request(authorizeUrl({ ...validParams(clientId, challenge), ...override }))
      expect(res.status, error).toBe(302)
      expect(res.headers.get('Location'), error).toBe(`/advisor/connect?error=${error}`)
    }
    // a repeated client_id or redirect_uri is not trusted either
    const repeated = `${authorizeUrl(validParams(clientId, challenge))}&redirect_uri=${encodeURIComponent('https://evil.example/callback')}`
    expect((await app.request(repeated)).headers.get('Location')).toBe('/advisor/connect?error=advisor.invalid_request')

    // once the redirect URI is the client's own, errors go back to it with the state; nothing is pending
    const back: [Record<string, string>, string][] = [
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ code_challenge: 'short' }, 'invalid_request'],
      [{ code_challenge: `${challenge.slice(0, 42)}=` }, 'invalid_request'],
      [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
    ]
    for (const [override, error] of back) {
      const res = await app.request(authorizeUrl({ ...validParams(clientId, challenge), ...override }))
      expect(res.status, error).toBe(302)
      const location = new URL(res.headers.get('Location')!)
      expect(`${location.origin}${location.pathname}`, error).toBe(CALLBACK)
      expect(Object.fromEntries(location.searchParams), error).toEqual({ error, state: 'st-1' })
    }
    const noPkce: Record<string, string> = validParams(clientId, challenge)
    delete noPkce.code_challenge
    delete noPkce.code_challenge_method
    const missing = new URL((await app.request(authorizeUrl(noPkce))).headers.get('Location')!)
    expect(missing.searchParams.get('error')).toBe('invalid_request')
  })

  it('authorize: a flood from one address cannot fill the pending requests', async () => {
    const { app } = setup({ ...TELEGRAM, CLIENT_IP_HEADER: 'X-Forwarded-For' })
    const clientId = await register(app)
    const url = authorizeUrl(validParams(clientId, pkce().challenge))
    const from = (ip: string) => app.request(url, { headers: { 'X-Forwarded-For': ip } })
    for (let i = 0; i < 10; i++) expect((await from('203.0.113.9')).headers.get('Location')).toMatch(/^\/advisor\/connect\?request=/)
    const refused = new URL((await from('203.0.113.9')).headers.get('Location')!)
    expect(Object.fromEntries(refused.searchParams)).toEqual({ error: 'temporarily_unavailable', state: 'st-1' })
    expect((await from('198.51.100.1')).headers.get('Location')).toMatch(/^\/advisor\/connect\?request=/)
  })

  it('the consent API needs a session; a request id is single use and expires', async () => {
    const t0 = new Date('2026-10-24T10:00:00.000Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(t0)
    const { app, db, logins } = setup()
    const cookie = await signIn(app, logins, addUser(db, 'Anna', { telegramId: '100' }))
    const { requestId } = await pendingRequest(app)

    expect((await app.request(`/api/advisor/oauth/requests/${requestId}`)).status).toBe(401)
    expect((await app.request(`/api/advisor/oauth/requests/${requestId}`, jsonPost({ approve: true }))).status).toBe(401)
    expect((await consent(app, requestId, cookie, true)).status).toBe(200)
    const { requestId: second } = await pendingRequest(app)
    // a write from another site is refused before anything else
    const crossSite = await app.request(`/api/advisor/oauth/requests/${second}`, jsonPost({ approve: true }, { Cookie: cookie, Origin: 'https://evil.example' }))
    expect(crossSite.status).toBe(403)
    const bad = await app.request(`/api/advisor/oauth/requests/${second}`, jsonPost({ approve: 'yes' }, { Cookie: `${cookie}; advisor_request=${second}` }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: { code: 'invalid_param', params: { param: 'approve' } } })

    // single use: the first answer took the request
    const gone = await consent(app, requestId, cookie)
    expect(gone.status).toBe(404)
    expect(await gone.json()).toEqual({ error: { code: 'advisor.request_expired' } })
    expect((await consent(app, requestId, cookie, true)).status).toBe(404)
    expect((await consent(app, 'no-such-request', cookie)).status).toBe(404)

    // a pending request lives 10 minutes
    expect((await consent(app, second, cookie)).status).toBe(200)
    vi.setSystemTime(new Date(t0.getTime() + 10 * 60_000 + 1))
    expect((await consent(app, second, cookie)).status).toBe(404)
    expect((await consent(app, second, cookie, true)).status).toBe(404)
  })

  it('a request started in another browser cannot be seen or answered there', async () => {
    const { app, db, logins } = setup()
    const cookie = await signIn(app, logins, addUser(db, 'Anna', { telegramId: '100' }))
    const { requestId } = await pendingRequest(app)
    const { requestId: other } = await pendingRequest(app)
    for (const res of [
      await consent(app, requestId, cookie, undefined, { bound: false }),
      await consent(app, requestId, cookie, true, { bound: false }),
      await app.request(`/api/advisor/oauth/requests/${requestId}`, jsonPost({ approve: true }, { Cookie: `${cookie}; advisor_request=${other}` })),
    ]) {
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: { code: 'advisor.request_elsewhere' } })
    }
    // the refusals took nothing: the browser that started it still can answer
    expect((await consent(app, requestId, cookie, true)).status).toBe(200)
  })

  it('token answers are RFC 6749 JSON with Cache-Control no-store; a form body is required', async () => {
    const { app } = setup()
    const clientId = await register(app)
    const asJson = await app.request('/oauth/token', jsonPost({ grant_type: 'authorization_code' }))
    expect(asJson.status).toBe(400)
    expect(asJson.headers.get('Cache-Control')).toBe('no-store')
    expect(asJson.headers.get('Content-Type')).toMatch(/^application\/json/)
    expect(await asJson.json()).toMatchObject({ error: 'invalid_request' })

    const cases: [Record<string, string>, string][] = [
      [{}, 'invalid_request'],
      [{ grant_type: 'password' }, 'unsupported_grant_type'],
      [{ grant_type: 'authorization_code', code: 'x', code_verifier: pkce().verifier, client_id: 'nobody', redirect_uri: CALLBACK }, 'invalid_client'],
      [{ grant_type: 'authorization_code', code: 'x', code_verifier: pkce().verifier, client_id: clientId, redirect_uri: CALLBACK }, 'invalid_grant'],
      [{ grant_type: 'refresh_token', refresh_token: randomBytes(32).toString('base64url') }, 'invalid_grant'],
    ]
    for (const [body, error] of cases) {
      const res = await app.request('/oauth/token', formPost(body))
      expect(res.status, error).toBe(400)
      expect(res.headers.get('Cache-Control'), error).toBe('no-store')
      const answer = await res.json() as { error: string }
      expect(answer.error, error).toBe(error)
      expect(Object.keys(answer).every(k => k === 'error' || k === 'error_description'), error).toBe(true)
    }
    expect((await app.request('/oauth/token')).status).toBe(405)
  })

  it('registrations are limited per IPv6 /48: one allocation\'s many /64s share five an hour', async () => {
    const { app } = setup({ ...TELEGRAM, CLIENT_IP_HEADER: 'X-Forwarded-For' })
    const from = (ip: string) => app.request('/oauth/register', jsonPost({ redirect_uris: [CALLBACK] }, { 'X-Forwarded-For': ip }))
    for (let i = 0; i < 5; i++) expect((await from(`2001:db8:1:${i}::1`)).status).toBe(201)
    expect((await from('2001:db8:1:ff::1')).status).toBe(429)
    expect((await from('2001:db8:2::1')).status).toBe(201)
  })

  it('token failures are rate limited per client address', async () => {
    const { app } = setup({ ...TELEGRAM, CLIENT_IP_HEADER: 'X-Forwarded-For' })
    const bad = (ip: string) => app.request('/oauth/token', formPost({ grant_type: 'refresh_token', refresh_token: 'nope' }, { 'X-Forwarded-For': ip }))
    for (let i = 0; i < 10; i++) expect((await bad('203.0.113.9')).status).toBe(400)
    const limited = await bad('203.0.113.9')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Cache-Control')).toBe('no-store')
    expect(await limited.json()).toMatchObject({ error: 'temporarily_unavailable' })
    expect((await bad('198.51.100.1')).status).toBe(400)
  })

  it('junk token requests from many addresses do not lock out a family refresh', async () => {
    const { app, db, logins } = setup({ ...TELEGRAM, CLIENT_IP_HEADER: 'X-Forwarded-For' })
    const cookie = await signIn(app, logins, addUser(db, 'Anna', { telegramId: '100' }))
    const { verifier, challenge } = pkce()
    const { clientId, requestId } = await pendingRequest(app, challenge)
    const { redirect } = await (await consent(app, requestId, cookie, true)).json() as { redirect: string }
    const pair = await (await app.request('/oauth/token', formPost({
      grant_type: 'authorization_code', code: new URL(redirect).searchParams.get('code')!, code_verifier: verifier, client_id: clientId, redirect_uri: CALLBACK,
    }))).json() as { refresh_token: string }
    // past any shared ceiling (the login limiter's default is 100): there is none for tokens
    for (let i = 0; i < 1001; i++) {
      const res = await app.request('/oauth/token', formPost({ grant_type: 'refresh_token', refresh_token: 'nope' }, { 'X-Forwarded-For': `10.0.${i >> 8}.${i & 255}` }))
      expect(res.status).toBe(400)
    }
    const refreshed = await app.request('/oauth/token', formPost({ grant_type: 'refresh_token', refresh_token: pair.refresh_token }, { 'X-Forwarded-For': '198.51.100.7' }))
    expect(refreshed.status).toBe(200)
  })

  it('the form media type is compared case-insensitively', async () => {
    const { app } = setup()
    const res = await app.request('/oauth/token', formPost({ grant_type: 'password' }, { 'Content-Type': 'Application/X-WWW-Form-Urlencoded; charset=UTF-8' }))
    expect(await res.json()).toMatchObject({ error: 'unsupported_grant_type' })
  })

  it('/oauth/revoke: a body that cannot be read is an RFC 7009 503, not the app error', async () => {
    const { app } = setup()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = new Request(`${APP_URL}/oauth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new ReadableStream({ pull(controller) { controller.error(new Error('socket reset')) } }),
      duplex: 'half',
    } as RequestInit)
    const res = await app.request(broken)
    expect(res.status).toBe(503)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'temporarily_unavailable' })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('/oauth/revoke always answers 200', async () => {
    const { app, db, logins } = setup()
    const cookie = await signIn(app, logins, addUser(db, 'Anna', { telegramId: '100' }))
    const { verifier, challenge } = pkce()
    const { clientId, requestId } = await pendingRequest(app, challenge)
    const { redirect } = await (await consent(app, requestId, cookie, true)).json() as { redirect: string }
    const code = new URL(redirect).searchParams.get('code')!
    const pair = await (await app.request('/oauth/token', formPost({
      grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: CALLBACK,
    }))).json() as { refresh_token: string }

    for (const init of [
      formPost({ token: 'unknown' }),
      formPost({ token: randomBytes(32).toString('base64url'), token_type_hint: 'refresh_token' }),
      formPost({}),
      jsonPost({ token: pair.refresh_token }),
      { method: 'POST' },
    ]) {
      expect((await app.request('/oauth/revoke', init)).status).toBe(200)
    }
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_tokens WHERE revoked_at IS NOT NULL').get()).toEqual({ n: 0 })
    expect((await app.request('/oauth/revoke', formPost({ token: pair.refresh_token }))).status).toBe(200)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_tokens WHERE revoked_at IS NULL').get()).toEqual({ n: 0 })
    const after = await app.request('/oauth/token', formPost({ grant_type: 'refresh_token', refresh_token: pair.refresh_token }))
    expect(await after.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it.each([
    ['stored password mode', { password: 'correct horse battery', APP_URL }],
    ['APP_URL http://', { ...TELEGRAM, APP_URL: 'http://family.test' }],
  ] as const)('%s: every OAuth route and both metadata documents answer 404', async (_name, env) => {
    const { app } = setup({ ...env })
    const requests: [string, RequestInit?][] = [
      ['/.well-known/oauth-protected-resource'],
      ['/.well-known/oauth-protected-resource/mcp'],
      ['/.well-known/oauth-authorization-server'],
      ['/oauth/register', jsonPost({ redirect_uris: [CALLBACK] })],
      [authorizeUrl(validParams('any', pkce().challenge))],
      ['/oauth/token', formPost({ grant_type: 'refresh_token', refresh_token: 'x' })],
      ['/oauth/revoke', formPost({ token: 'x' })],
      ['/oauth/token'],
    ]
    for (const [path, init] of requests) {
      const res = await app.request(path, init)
      expect(res.status, path).toBe(404)
      expect(await res.text(), path).not.toContain('spa')
    }
    // the rest of the app is unaffected
    expect((await app.request('/api/health')).status).toBe(200)
    const page = await app.request('/advisor/connect')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('spa')
  })

  it('GET /api/advisor/connector lists connected members and marks you; DELETE …/mine disconnects you only', async () => {
    const { app, db, logins } = setup()
    const anna = addUser(db, 'Anna', { telegramId: '100' })
    const boris = addUser(db, 'Boris', { telegramId: '200' })
    const annaCookie = await signIn(app, logins, anna)
    const borisCookie = await signIn(app, logins, boris)

    const view = async (cookie: string) => {
      const res = await app.request('/api/advisor/connector', { headers: { Cookie: cookie } })
      expect(res.status).toBe(200)
      return res.json() as Promise<ConnectorView>
    }

    expect(await view(annaCookie)).toEqual({ available: true, reason: null, mcpUrl: `${APP_URL}/mcp`, connected: [] })
    await connect(app, annaCookie)
    await connect(app, borisCookie)
    expect((await view(annaCookie)).connected).toEqual([{ member: 'Anna', you: true }, { member: 'Boris', you: false }])
    expect((await view(borisCookie)).connected).toEqual([{ member: 'Anna', you: false }, { member: 'Boris', you: true }])

    expect((await app.request('/api/advisor/connector/mine', { method: 'DELETE' })).status).toBe(401)
    const crossSite = await app.request('/api/advisor/connector/mine', { method: 'DELETE', headers: { Cookie: annaCookie, Origin: 'https://evil.example' } })
    expect(crossSite.status).toBe(403)
    const disconnected = await app.request('/api/advisor/connector/mine', { method: 'DELETE', headers: { Cookie: annaCookie } })
    expect(disconnected.status).toBe(200)
    expect((await disconnected.json() as ConnectorView).connected).toEqual([{ member: 'Boris', you: false }])
    const live = db.sqlite.prepare('SELECT DISTINCT user_id FROM oauth_tokens WHERE revoked_at IS NULL').all()
    expect(live).toEqual([{ user_id: boris }])
    expect((await app.request('/api/advisor/connector', { method: 'POST', headers: { Cookie: annaCookie } })).status).toBe(405)
  })

  it('linking a member to another Telegram account ends the old account\'s connection; a new one works', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2031-10-01T10:00:00Z'))
    const { app, db, logins } = setup()
    const ryan = addUser(db, 'Ryan', { telegramId: '100' })
    const signedInConnection = async () => {
      const cookie = await signIn(app, logins, ryan)
      return { cookie, ...await connect(app, cookie) }
    }
    const mcp = (token: string) => mcpInitialize(app, token)
    const connected = async (cookie: string) =>
      (await (await app.request('/api/advisor/connector', { headers: { Cookie: cookie } })).json() as ConnectorView).connected

    const old = await signedInConnection()
    expect((await mcp(old.access_token)).status).toBe(200)
    expect(await connected(old.cookie)).toEqual([{ member: 'Ryan', you: true }])

    // a manager re-invites Ryan a minute later and the link is opened from another Telegram account
    vi.setSystemTime(new Date('2031-10-01T10:01:00Z'))
    const { link } = await issueInvite(db, ryan, 'fcbot')
    expect(await acceptInvite(db, /link_(.+)$/.exec(link)![1], { id: '200', name: null })).toMatchObject({ status: 'linked' })
    // a session counts only when issued strictly after the link time: the next sign-in comes a minute later
    vi.setSystemTime(new Date('2031-10-01T10:02:00Z'))

    expect((await mcp(old.access_token)).status).toBe(401)
    expect(await connected(await signIn(app, logins, ryan))).toEqual([])
    const refresh = await app.request('/oauth/token', formPost({ grant_type: 'refresh_token', refresh_token: old.refresh_token, client_id: old.clientId }))
    expect(refresh.status).toBe(400)
    expect(await refresh.json()).toMatchObject({ error: 'invalid_grant' })
    const fresh = await signedInConnection()
    expect(await connected(fresh.cookie)).toEqual([{ member: 'Ryan', you: true }])
    expect((await mcp(fresh.access_token)).status).toBe(200)
    expect((await mcp(old.access_token)).status).toBe(401)
    // the old chain was revoked by its refresh: only the new connection's rows are live
    expect(db.sqlite.prepare('SELECT DISTINCT telegram_id FROM oauth_tokens WHERE revoked_at IS NULL').all()).toEqual([{ telegram_id: '200' }])
  })

  it('linked to another Telegram account and back, the member\'s old Claude connection stays ended', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2031-10-01T10:00:00Z'))
    const { app, db, logins } = setup()
    const ryan = addUser(db, 'Ryan', { telegramId: '100' })
    const cookie = await signIn(app, logins, ryan)
    const old = await connect(app, cookie)
    const { clientId } = old
    const mcp = (token: string) => mcpInitialize(app, token)
    expect((await mcp(old.access_token)).status).toBe(200)

    // re-invited to account 200, then back to 100, with no refresh in between
    const relink = async (minute: number, telegramId: string) => {
      vi.setSystemTime(new Date(`2031-10-01T10:0${minute}:00Z`))
      const { link } = await issueInvite(db, ryan, 'fcbot')
      expect(await acceptInvite(db, /link_(.+)$/.exec(link)![1], { id: telegramId, name: null })).toMatchObject({ status: 'linked' })
    }
    await relink(1, '200')
    await relink(2, '100')
    vi.setSystemTime(new Date('2031-10-01T10:03:00Z'))

    expect((await mcp(old.access_token)).status).toBe(401)
    const refresh = await app.request('/oauth/token', formPost({ grant_type: 'refresh_token', refresh_token: old.refresh_token, client_id: clientId }))
    expect(refresh.status).toBe(400)
    expect(await refresh.json()).toMatchObject({ error: 'invalid_grant' })
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_tokens WHERE revoked_at IS NULL').get()).toEqual({ n: 0 })
    const view = await app.request('/api/advisor/connector', { headers: { Cookie: await signIn(app, logins, ryan) } })
    expect((await view.json() as ConnectorView).connected).toEqual([])
    // the session from before the links is over too
    expect((await app.request('/api/advisor/connector', { headers: { Cookie: cookie } })).status).toBe(401)
  })

  // the two checks of a live token, each alone: the case above ends the connection by the link time only (the account is
  // the same again); here only the account differs (no link time recorded, as for a link made before it was kept)
  it('a member now on another Telegram account than the connection\'s, with no link time to end it, has the old connection ended', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2031-10-01T10:00:00Z'))
    const { app, db, logins } = setup()
    const ryan = addUser(db, 'Ryan', { telegramId: '100' })
    const old = await connect(app, await signIn(app, logins, ryan))
    expect((await mcpInitialize(app, old.access_token)).status).toBe(200)

    db.sqlite.prepare("UPDATE users SET telegram_id = '200' WHERE id = ?").run(ryan)
    expect(db.sqlite.prepare('SELECT telegram_linked_at FROM users WHERE id = ?').get(ryan)).toEqual({ telegram_linked_at: null })
    vi.setSystemTime(new Date('2031-10-01T10:01:00Z'))

    expect((await mcpInitialize(app, old.access_token)).status).toBe(401)
    const refresh = await app.request('/oauth/token', formPost({ grant_type: 'refresh_token', refresh_token: old.refresh_token, client_id: old.clientId }))
    expect(refresh.status).toBe(400)
    expect(await refresh.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it('GET /api/advisor/connector names the missing condition', async () => {
    const { app, db, logins } = setup({ ...TELEGRAM, APP_URL: 'http://family.test' })
    const cookie = await signIn(app, logins, addUser(db, 'Anna', { telegramId: '100' }))
    const res = await app.request('/api/advisor/connector', { headers: { Cookie: cookie } })
    expect(await res.json()).toEqual({ available: false, reason: 'app_url', mcpUrl: null, connected: [] })
    const consentRes = await app.request('/api/advisor/oauth/requests/whatever', { headers: { Cookie: cookie } })
    expect(consentRes.status).toBe(404)
    expect(await consentRes.json()).toEqual({ error: { code: 'advisor.connector_unavailable' } })
  })
})

describe('connectorStatus with a live runtime', () => {
  it('follows a mode switched at runtime', () => {
    const auth = fakeAuthRuntime({ mode: 'password' })
    const config = testConfig(TELEGRAM)
    expect(connectorStatus(config, auth)).toEqual({ available: false, reason: 'auth_mode', mcpUrl: null })
    auth.set({ mode: 'telegram' })
    expect(connectorStatus(config, auth)).toEqual({ available: true, reason: null, mcpUrl: `${APP_URL}/mcp` })
    auth.set({ mode: 'bootstrap' })
    expect(connectorStatus(config, auth).available).toBe(false)
  })
})
