import { createHash } from 'node:crypto'
import { createCodeStore, createPendingStore, type AuthorizationRequest, type CodeGrant } from '../../../src/modules/advisor/oauth/pending'
import { isAllowedRedirect, redirectMatches } from '../../../src/modules/advisor/oauth/redirects'
import {
  createRegistrationLimiter, exchangeCode, findClient, issueTokens, listConnections, OAuthError, refreshTokens, registerClient, revokeToken, revokeUser,
  verifyAccessToken,
} from '../../../src/modules/advisor/oauth/store'
import { createTestDb, type TestDb } from '../../helpers/db'

const RESOURCE = 'https://family.example.com/mcp'
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback'
const T0 = new Date('2031-10-19T10:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const VERIFIER = 'a'.repeat(20) + '-._~' + 'Z9'.repeat(10)
const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** A registration with a limiter of its own (the limits have their own tests) and no client held by a request or a code. */
const register = (db: TestDb, body: unknown, now: Date) =>
  registerClient(db, body, now, { clientKey: 'test', limiter: createRegistrationLimiter(), referenced: [] })

/** The OAuthError a call throws (or rejects with). */
async function oauthError(fn: () => unknown): Promise<OAuthError> {
  try { await fn() } catch (err) {
    expect(err).toBeInstanceOf(OAuthError)
    return err as OAuthError
  }
  throw new Error('expected an OAuthError')
}

/** Users 7–10 with a linked Telegram account `tg-<id>`: a token is live only while its user's account is the one it was issued to. */
function addUsers(db: TestDb): void {
  const insert = db.sqlite.prepare("INSERT INTO users (id, member, telegram_id, created_at, updated_at) VALUES (?, ?, ?, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')")
  for (const id of [7, 8, 9, 10]) insert.run(id, `Member ${id}`, `tg-${id}`)
}

async function setup(redirectUris = [CLAUDE]) {
  const db = createTestDb()
  addUsers(db)
  const client = await register(db, { client_name: 'Claude', redirect_uris: redirectUris }, T0)
  return { db, clientId: client.client_id }
}

function request(clientId: string, extra: Partial<AuthorizationRequest> = {}): AuthorizationRequest {
  return { clientId, clientName: 'Claude', redirectUri: CLAUDE, codeChallenge: challengeOf(VERIFIER), state: 'xyz', scope: 'advisor', ...extra }
}

function grant(clientId: string, extra: Partial<CodeGrant> = {}): CodeGrant {
  return { ...request(clientId), userId: 7, telegramId: 'tg-7', chainId: 'chain-1', ...extra }
}

function codeBody(code: string, clientId: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: CLAUDE, ...extra })
}

const refreshBody = (token: string, clientId: string) => new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token, client_id: clientId })

const count = (db: TestDb, sql: string, ...args: (string | number)[]) => Number((db.sqlite.prepare(sql).get(...args) as { n: number }).n)

describe('OAuth clients', () => {
  it('registers a client with the claude.ai callback and refuses any other redirect URI', async () => {
    const db = createTestDb()
    const client = await register(db, { client_name: 'Claude', redirect_uris: [CLAUDE] }, T0)
    expect(client).toEqual({
      client_id: expect.any(String), client_name: 'Claude', redirect_uris: [CLAUDE],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    })
    expect(await findClient(db, client.client_id)).toEqual({ clientId: client.client_id, clientName: 'Claude', redirectUris: [CLAUDE] })
    expect(await findClient(db, 'nobody')).toBeNull()
    // claude.com and loopback are allowed; without a name the field is absent
    const other = await register(db, { redirect_uris: ['https://claude.com/api/mcp/auth_callback', 'http://localhost:33418/callback'] }, T0)
    expect(other).not.toHaveProperty('client_name')
    expect(other.client_id).not.toBe(client.client_id)

    for (const uri of [
      'https://evil.example.com/callback', 'https://claude.ai/api/mcp/auth_callback/x', 'http://claude.ai/api/mcp/auth_callback',
      'https://claude.ai.evil.com/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback?x=1', 'https://claude.ai/api/mcp/auth_callback#f',
    ]) {
      const err = await oauthError(() => register(db, { redirect_uris: [CLAUDE, uri] }, T0))
      expect([err.code, err.status], uri).toEqual(['invalid_redirect_uri', 400])
    }
    for (const body of [null, 'x', [], {}, { redirect_uris: [] }, { redirect_uris: CLAUDE }, { redirect_uris: [1] }]) {
      const err = await oauthError(() => register(db, body, T0))
      expect(err.status, JSON.stringify(body)).toBe(400)
      expect(['invalid_redirect_uri', 'invalid_client_metadata']).toContain(err.code)
    }
    // public clients only, the code flow only; a name is plain text of a sane length
    for (const extra of [
      { token_endpoint_auth_method: 'client_secret_basic' }, { grant_types: ['client_credentials'] }, { grant_types: 'authorization_code' },
      { response_types: ['token'] }, { client_name: 'x'.repeat(201) }, { client_name: 'Claude‮' }, { client_name: 5 },
    ]) {
      const err = await oauthError(() => register(db, { redirect_uris: [CLAUDE], ...extra }, T0))
      expect([err.code, err.status], JSON.stringify(extra)).toEqual(['invalid_client_metadata', 400])
    }
    expect(count(db, 'SELECT COUNT(*) AS n FROM oauth_clients')).toBe(2)
  })

  it('loopback callbacks match with any port; http://localhost.evil.com/callback does not', () => {
    expect(isAllowedRedirect(CLAUDE)).toBe(true)
    expect(isAllowedRedirect('https://claude.com/api/mcp/auth_callback')).toBe(true)
    expect(isAllowedRedirect('http://localhost:1234/callback')).toBe(true)
    expect(isAllowedRedirect('http://127.0.0.1:65000/callback')).toBe(true)
    expect(isAllowedRedirect('http://localhost/callback')).toBe(true)
    for (const uri of [
      'http://localhost.evil.com/callback', 'http://localhost:1234/other', 'http://localhost:1234/callback/x', 'https://localhost:1234/callback',
      'http://user@localhost:1234/callback', 'http://localhost:1234/callback?x=1', 'http://127.0.0.2:1234/callback', 'http://[::1]:1234/callback',
      'http://localhost:1234/a/../callback', 'not a url', '', 'javascript:alert(1)',
      // an empty query or fragment survives URL.href: refused by its character
      'http://localhost:1/callback#', 'http://localhost:1/callback?', 'http://127.0.0.1:1/callback?#', 'https://claude.ai/api/mcp/auth_callback?',
    ]) expect(isAllowedRedirect(uri), uri).toBe(false)

    const registered = [CLAUDE, 'http://localhost:1111/callback']
    expect(redirectMatches(registered, CLAUDE)).toBe(true)
    expect(redirectMatches(registered, 'http://localhost:2222/callback')).toBe(true)
    expect(redirectMatches(registered, 'http://localhost/callback')).toBe(true)
    expect(redirectMatches(registered, 'http://127.0.0.1:1111/callback')).toBe(false)
    expect(redirectMatches(registered, 'http://localhost.evil.com/callback')).toBe(false)
    expect(redirectMatches(registered, 'https://claude.com/api/mcp/auth_callback')).toBe(false)
    expect(redirectMatches([CLAUDE], 'http://localhost:2222/callback')).toBe(false)
    expect(redirectMatches(registered, 'http://localhost:2222/callback#')).toBe(false)
    expect(redirectMatches(registered, 'http://localhost:1111/callback?')).toBe(false)
  })

  it('limits registrations to 5 an hour per client address, with no server-wide ceiling', async () => {
    const db = createTestDb()
    const limiter = createRegistrationLimiter()
    const reg = (key: string, now: Date) => registerClient(db, { redirect_uris: [CLAUDE] }, now, { clientKey: key, limiter, referenced: [] })
    for (let i = 0; i < 5; i++) await reg('a', at(i * MINUTE))
    const limited = await oauthError(() => reg('a', at(30 * MINUTE)))
    expect([limited.code, limited.status]).toEqual(['temporarily_unavailable', 429])
    // another address is not held back; an invalid body takes no slot
    await reg('b', at(30 * MINUTE))
    await oauthError(() => registerClient(db, { redirect_uris: ['https://evil.example.com/cb'] }, at(30 * MINUTE), { clientKey: 'c', limiter, referenced: [] }))
    // an hour after the first, one more fits for `a`, and a second only after the second's hour
    await reg('a', at(HOUR))
    expect((await oauthError(() => reg('a', at(HOUR)))).status).toBe(429)
    await reg('a', at(HOUR + MINUTE))

    // strangers from many addresses cannot block the family's connector for the hour: MAX_CLIENTS and eviction bound storage
    const fresh = createTestDb()
    const many = createRegistrationLimiter()
    for (let i = 0; i < 40; i++) {
      await registerClient(fresh, { redirect_uris: [CLAUDE] }, at(2 * HOUR), { clientKey: `k${i}`, limiter: many, referenced: [] })
    }
    await registerClient(fresh, { redirect_uris: [CLAUDE] }, at(2 * HOUR), { clientKey: 'family', limiter: many, referenced: [] })
  })

  it('at 50 clients evicts the oldest idle one older than 10 minutes, never one with a live token, a pending request or a code', async () => {
    const db = createTestDb()
    const insert = (id: string, createdAt: Date) =>
      db.sqlite.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, NULL, '[]', ?)").run(id, createdAt.toISOString())
    insert('live', at(-2 * DAY))
    await issueTokens(db, { clientId: 'live', userId: 1, telegramId: 'tg-1', chainId: 'c' }, T0)
    insert('pending', at(-2 * DAY))
    insert('coded', at(-2 * DAY))
    // revoked tokens do not keep a client
    insert('revoked', at(-DAY - 1))
    const revoked = await issueTokens(db, { clientId: 'revoked', userId: 1, telegramId: 'tg-1', chainId: 'r' }, at(-DAY))
    await revokeToken(db, revoked.refresh_token, at(-DAY))
    insert('idle', at(-DAY))
    for (let i = 0; i < 45; i++) insert(`young-${i}`, at(-9 * MINUTE))
    expect(count(db, 'SELECT COUNT(*) AS n FROM oauth_clients')).toBe(50)

    let clock = T0.getTime()
    const pending = createPendingStore({ now: () => clock })
    const codes = createCodeStore({ now: () => clock })
    pending.put(request('pending'))
    codes.issue(grant('coded'))
    const limiter = createRegistrationLimiter()
    const reg = (key: string) => registerClient(db, { redirect_uris: [CLAUDE] }, new Date(clock), {
      clientKey: key, limiter, referenced: [...pending.clientIds(), ...codes.clientIds()],
    })
    const ids = () => (db.sqlite.prepare('SELECT client_id FROM oauth_clients').all() as { client_id: string }[]).map(r => r.client_id)

    // the oldest evictable goes first: 'revoked', then 'idle'
    const first = await reg('a')
    expect(ids()).not.toContain('revoked')
    expect(ids()).toContain(first.client_id)
    const second = await reg('b')
    expect(ids()).not.toContain('idle')
    expect(ids()).toContain(second.client_id)
    expect(count(db, 'SELECT COUNT(*) AS n FROM oauth_clients')).toBe(50)
    // the rest has a live token, a pending request, a code, or is younger than 10 minutes
    const full = await oauthError(() => reg('c'))
    expect([full.code, full.status]).toEqual(['temporarily_unavailable', 429])
    expect(ids()).toEqual(expect.arrayContaining(['live', 'pending', 'coded', 'young-0']))

    // two minutes later the code has expired: its client goes first; then the young ones, now past 10 minutes
    clock += 2 * MINUTE
    await reg('d')
    expect(ids()).not.toContain('coded')
    await reg('e')
    expect(ids()).not.toContain('young-0')
    expect(ids()).toEqual(expect.arrayContaining(['live', 'pending', 'young-1']))
    expect(count(db, 'SELECT COUNT(*) AS n FROM oauth_clients')).toBe(50)
  })

  it('two registrations at once at 49 clients do not pass 50', async () => {
    const db = createTestDb()
    for (let i = 0; i < 49; i++) {
      db.sqlite.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, NULL, '[]', ?)").run(`young-${i}`, T0.toISOString())
    }
    const limiter = createRegistrationLimiter()
    const reg = (key: string) => registerClient(db, { redirect_uris: [CLAUDE] }, T0, { clientKey: key, limiter, referenced: [] })
    const results = await Promise.allSettled([reg('a'), reg('b')])
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(count(db, 'SELECT COUNT(*) AS n FROM oauth_clients')).toBe(50)
  })
})

describe('codes and tokens', () => {
  it('exchanges a code with the right S256 verifier for an access and a refresh token stored only as hashes', async () => {
    const { db, clientId } = await setup()
    const codes = createCodeStore({ now: () => T0.getTime() })
    const code = codes.issue(grant(clientId))
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const tokens = await exchangeCode(db, codes, codeBody(code, clientId, { resource: RESOURCE }), T0, RESOURCE)
    expect(tokens).toEqual({ access_token: expect.any(String), refresh_token: expect.any(String), token_type: 'Bearer', expires_in: 3600, scope: 'advisor' })
    expect(tokens.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(tokens.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const rows = db.sqlite.prepare('SELECT * FROM oauth_tokens ORDER BY kind').all()
    expect(rows).toEqual([
      { token_hash: sha256(tokens.access_token), kind: 'access', client_id: clientId, user_id: 7, chain_id: 'chain-1', expires_at: at(HOUR).toISOString(), created_at: T0.toISOString(), revoked_at: null, telegram_id: 'tg-7' },
      { token_hash: sha256(tokens.refresh_token), kind: 'refresh', client_id: clientId, user_id: 7, chain_id: 'chain-1', expires_at: at(30 * DAY).toISOString(), created_at: T0.toISOString(), revoked_at: null, telegram_id: 'tg-7' },
    ])
    // the plain token is nowhere in the database
    expect(JSON.stringify(rows)).not.toContain(tokens.access_token)
    expect(JSON.stringify(rows)).not.toContain(tokens.refresh_token)
    expect(await verifyAccessToken(db, tokens.access_token, T0)).toEqual({ userId: 7, clientId, createdAt: T0.toISOString() })
    // a refresh token is not an access token
    expect(await verifyAccessToken(db, tokens.refresh_token, T0)).toBeNull()
    // without a resource the exchange works too
    const second = codes.issue(grant(clientId, { chainId: 'chain-2' }))
    await expect(exchangeCode(db, codes, codeBody(second, clientId), T0, RESOURCE)).resolves.toMatchObject({ token_type: 'Bearer' })
  })

  it('a wrong verifier, client, redirect URI or resource is invalid_grant', async () => {
    const { db, clientId } = await setup([CLAUDE, 'http://localhost:1111/callback'])
    const other = (await register(db, { redirect_uris: [CLAUDE] }, T0)).client_id
    const codes = createCodeStore({ now: () => T0.getTime() })
    const wrong: Record<string, string>[] = [
      { code_verifier: 'b'.repeat(43) },
      { client_id: other },
      { redirect_uri: 'http://localhost:1111/callback' },
      { resource: 'https://other.example.com/mcp' },
      { code: 'unknown-code' },
    ]
    for (const extra of wrong) {
      const code = codes.issue(grant(clientId))
      const err = await oauthError(() => exchangeCode(db, codes, codeBody(code, clientId, extra), T0, RESOURCE))
      expect([err.code, err.status], JSON.stringify(extra)).toEqual(['invalid_grant', 400])
      // a failed attempt spends the code: the right verifier does not save it afterwards
      if (!extra.code) {
        const again = await oauthError(() => exchangeCode(db, codes, codeBody(code, clientId), T0, RESOURCE))
        expect(again.code).toBe('invalid_grant')
      }
    }
    expect(count(db, 'SELECT COUNT(*) AS n FROM oauth_tokens')).toBe(0)

    // a malformed request is invalid_request; another grant type is unsupported_grant_type; an unknown client is invalid_client
    const code = codes.issue(grant(clientId))
    for (const [extra, expected] of [
      [{ code_verifier: 'short' }, 'invalid_request'],
      [{ code_verifier: 'a'.repeat(129) }, 'invalid_request'],
      [{ code_verifier: 'a'.repeat(42) + '!' }, 'invalid_request'],
      [{ redirect_uri: '' }, 'invalid_request'],
      [{ grant_type: 'password' }, 'unsupported_grant_type'],
      [{ client_id: 'nobody' }, 'invalid_client'],
    ] as const) {
      const err = await oauthError(() => exchangeCode(db, codes, codeBody(code, clientId, extra), T0, RESOURCE))
      expect(err.code, JSON.stringify(extra)).toBe(expected)
    }
    const twice = codeBody(code, clientId)
    twice.append('code_verifier', VERIFIER)
    expect((await oauthError(() => exchangeCode(db, codes, twice, T0, RESOURCE))).code).toBe('invalid_request')
    // none of those spent the code
    await expect(exchangeCode(db, codes, codeBody(code, clientId), T0, RESOURCE)).resolves.toMatchObject({ token_type: 'Bearer' })
  })

  it('a replayed code is invalid_grant and revokes the tokens issued from it', async () => {
    const { db, clientId } = await setup()
    const codes = createCodeStore({ now: () => T0.getTime() })
    const code = codes.issue(grant(clientId))
    const first = await exchangeCode(db, codes, codeBody(code, clientId), T0, RESOURCE)
    // the chain has grown by a refresh before the replay
    const rotated = await refreshTokens(db, refreshBody(first.refresh_token, clientId), at(MINUTE), RESOURCE)
    // another authorization of the same user is not touched
    const otherCode = codes.issue(grant(clientId, { chainId: 'chain-2' }))
    const other = await exchangeCode(db, codes, codeBody(otherCode, clientId), T0, RESOURCE)

    const err = await oauthError(() => exchangeCode(db, codes, codeBody(code, clientId), at(2 * MINUTE), RESOURCE))
    expect([err.code, err.status]).toEqual(['invalid_grant', 400])
    const now = at(2 * MINUTE)
    expect(await verifyAccessToken(db, first.access_token, now)).toBeNull()
    expect(await verifyAccessToken(db, rotated.access_token, now)).toBeNull()
    expect((await oauthError(() => refreshTokens(db, refreshBody(rotated.refresh_token, clientId), now, RESOURCE))).code).toBe('invalid_grant')
    expect(await verifyAccessToken(db, other.access_token, now)).toMatchObject({ userId: 7 })
  })

  it('a code expires after 60 seconds; a pending request after 10 minutes', async () => {
    const { db, clientId } = await setup()
    let clock = T0.getTime()
    const codes = createCodeStore({ now: () => clock })
    const late = codes.issue(grant(clientId))
    const inTime = codes.issue(grant(clientId, { chainId: 'chain-2' }))
    clock += 59_999
    await expect(exchangeCode(db, codes, codeBody(inTime, clientId), new Date(clock), RESOURCE)).resolves.toMatchObject({ token_type: 'Bearer' })
    clock += 1
    expect((await oauthError(() => exchangeCode(db, codes, codeBody(late, clientId), new Date(clock), RESOURCE))).code).toBe('invalid_grant')
    expect(codes.take(late)).toBeNull()

    const pending = createPendingStore({ now: () => clock })
    const id = pending.put(request(clientId))
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    clock += 10 * MINUTE - 1
    // get leaves it, take removes it
    expect(pending.get(id)).toEqual(request(clientId))
    const kept = pending.put(request(clientId, { state: null }))
    expect(pending.take(id)).toEqual(request(clientId))
    expect(pending.take(id)).toBeNull()
    expect(pending.get('unknown')).toBeNull()
    clock += 10 * MINUTE
    expect(pending.get(kept)).toBeNull()

    // at most `max` pending requests: the oldest goes first
    const small = createPendingStore({ now: () => clock, max: 2 })
    const [a, b, c] = [small.put(request('a')), small.put(request('b')), small.put(request('c'))]
    expect([small.get(a), small.get(b)?.clientId, small.get(c)?.clientId]).toEqual([null, 'b', 'c'])
  })

  it('refreshing rotates: the old refresh token dies, the new pair works', async () => {
    const { db, clientId } = await setup()
    const first = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'chain-1' }, T0)
    const now = at(DAY)
    const next = await refreshTokens(db, refreshBody(first.refresh_token, clientId), now, RESOURCE)
    expect(next).toEqual({ access_token: expect.any(String), refresh_token: expect.any(String), token_type: 'Bearer', expires_in: 3600, scope: 'advisor' })
    expect(next.refresh_token).not.toBe(first.refresh_token)
    expect(await verifyAccessToken(db, next.access_token, now)).toEqual({ userId: 7, clientId, createdAt: now.toISOString() })
    // the new refresh token lives 30 days from its own issue and keeps the chain
    expect(db.sqlite.prepare('SELECT chain_id, expires_at, revoked_at FROM oauth_tokens WHERE token_hash = ?').get(sha256(next.refresh_token)))
      .toEqual({ chain_id: 'chain-1', expires_at: at(31 * DAY).toISOString(), revoked_at: null })
    expect(db.sqlite.prepare('SELECT revoked_at FROM oauth_tokens WHERE token_hash = ?').get(sha256(first.refresh_token)))
      .toEqual({ revoked_at: now.toISOString() })
    // and refreshes again; a resource, when given, must be ours
    await expect(refreshTokens(db, refreshBody(next.refresh_token, clientId), now, RESOURCE)).resolves.toMatchObject({ token_type: 'Bearer' })

    const fresh = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'chain-3' }, now)
    const wrongResource = refreshBody(fresh.refresh_token, clientId)
    wrongResource.set('resource', 'https://other.example.com/mcp')
    expect((await oauthError(() => refreshTokens(db, wrongResource, now, RESOURCE))).code).toBe('invalid_grant')
    // an expired refresh token, an access token, an unknown one: invalid_grant; without the token: invalid_request
    const old = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'chain-4' }, T0)
    expect((await oauthError(() => refreshTokens(db, refreshBody(old.refresh_token, clientId), at(30 * DAY), RESOURCE))).code).toBe('invalid_grant')
    expect((await oauthError(() => refreshTokens(db, refreshBody(old.access_token, clientId), T0, RESOURCE))).code).toBe('invalid_grant')
    expect((await oauthError(() => refreshTokens(db, refreshBody('nope', clientId), T0, RESOURCE))).code).toBe('invalid_grant')
    expect((await oauthError(() => refreshTokens(db, new URLSearchParams({ grant_type: 'refresh_token' }), T0, RESOURCE))).code).toBe('invalid_request')
    expect((await oauthError(() => refreshTokens(db, new URLSearchParams({ grant_type: 'authorization_code', refresh_token: 'x' }), T0, RESOURCE))).code)
      .toBe('unsupported_grant_type')
  })

  it('reusing a rotated refresh token is invalid_grant and kills the whole chain', async () => {
    const { db, clientId } = await setup()
    const first = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'chain-1' }, T0)
    const other = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'chain-2' }, T0)
    const second = await refreshTokens(db, refreshBody(first.refresh_token, clientId), at(MINUTE), RESOURCE)
    const third = await refreshTokens(db, refreshBody(second.refresh_token, clientId), at(2 * MINUTE), RESOURCE)
    const now = at(3 * MINUTE)
    // a stolen copy of the first refresh token comes back
    const err = await oauthError(() => refreshTokens(db, refreshBody(first.refresh_token, clientId), now, RESOURCE))
    expect([err.code, err.status]).toEqual(['invalid_grant', 400])
    for (const token of [first.access_token, second.access_token, third.access_token]) expect(await verifyAccessToken(db, token, now)).toBeNull()
    // the newest refresh token, held by the legitimate client, is dead too
    expect((await oauthError(() => refreshTokens(db, refreshBody(third.refresh_token, clientId), now, RESOURCE))).code).toBe('invalid_grant')
    expect(count(db, 'SELECT COUNT(*) AS n FROM oauth_tokens WHERE chain_id = ? AND revoked_at IS NULL', 'chain-1')).toBe(0)
    // another chain is untouched
    expect(await verifyAccessToken(db, other.access_token, now)).toMatchObject({ userId: 7 })
    await expect(refreshTokens(db, refreshBody(other.refresh_token, clientId), now, RESOURCE)).resolves.toMatchObject({ token_type: 'Bearer' })

    // two refreshes with the same token at once: one wins, the other kills the chain, the winner's pair included
    const race = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'chain-race' }, now)
    const results = await Promise.allSettled([
      refreshTokens(db, refreshBody(race.refresh_token, clientId), now, RESOURCE),
      refreshTokens(db, refreshBody(race.refresh_token, clientId), now, RESOURCE),
    ])
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(count(db, 'SELECT COUNT(*) AS n FROM oauth_tokens WHERE chain_id = ? AND revoked_at IS NULL', 'chain-race')).toBe(0)

    // a refresh token presented by another client is invalid_grant and kills its chain
    const stranger = (await register(db, { redirect_uris: [CLAUDE] }, now)).client_id
    const bound = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'chain-bound' }, now)
    expect((await oauthError(() => refreshTokens(db, refreshBody(bound.refresh_token, stranger), now, RESOURCE))).code).toBe('invalid_grant')
    expect(await verifyAccessToken(db, bound.access_token, now)).toBeNull()
  })

  it('an access token expires after an hour; verifyAccessToken returns null for expired or revoked', async () => {
    const { db, clientId } = await setup()
    const tokens = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'chain-1' }, T0)
    expect(await verifyAccessToken(db, tokens.access_token, at(HOUR - 1))).toMatchObject({ userId: 7, clientId })
    expect(await verifyAccessToken(db, tokens.access_token, at(HOUR))).toBeNull()
    for (const junk of ['', 'x', 'a'.repeat(5000), tokens.access_token + 'a']) expect(await verifyAccessToken(db, junk, T0)).toBeNull()

    // revoking either token of a pair ends the authorization
    await revokeToken(db, tokens.access_token, at(MINUTE))
    expect(await verifyAccessToken(db, tokens.access_token, at(MINUTE))).toBeNull()
    expect((await oauthError(() => refreshTokens(db, refreshBody(tokens.refresh_token, clientId), at(MINUTE), RESOURCE))).code).toBe('invalid_grant')
    const more = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'chain-2' }, T0)
    await revokeToken(db, more.refresh_token, at(MINUTE))
    expect(await verifyAccessToken(db, more.access_token, at(MINUTE))).toBeNull()
    // an unknown token is not an error (RFC 7009)
    await expect(revokeToken(db, 'unknown', T0)).resolves.toBeUndefined()
    // a revocation keeps the first time it happened
    await revokeToken(db, more.refresh_token, at(HOUR))
    expect(db.sqlite.prepare('SELECT revoked_at FROM oauth_tokens WHERE token_hash = ?').get(sha256(more.refresh_token))).toEqual({ revoked_at: at(MINUTE).toISOString() })
  })

  it('revokeUser kills every chain of that user; listConnections shows only live ones', async () => {
    const { db, clientId } = await setup()
    const second = (await register(db, { redirect_uris: [CLAUDE] }, T0)).client_id
    const a1 = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'a1' }, T0)
    const a2 = await issueTokens(db, { clientId: second, userId: 7, telegramId: 'tg-7', chainId: 'a2' }, at(MINUTE))
    const b = await issueTokens(db, { clientId, userId: 8, telegramId: 'tg-8', chainId: 'b' }, at(2 * MINUTE))
    await issueTokens(db, { clientId, userId: 9, telegramId: 'tg-9', chainId: 'c' }, T0)
    const d = await issueTokens(db, { clientId, userId: 10, telegramId: 'tg-10', chainId: 'd' }, T0)
    await revokeToken(db, d.refresh_token, at(3 * MINUTE))

    const now = at(10 * MINUTE)
    // user 9's refresh token is past 30 days only later; user 10 revoked
    expect(await listConnections(db, now)).toEqual([
      { userId: 7, clients: 2, lastIssuedAt: at(MINUTE).toISOString() },
      { userId: 8, clients: 1, lastIssuedAt: at(2 * MINUTE).toISOString() },
      { userId: 9, clients: 1, lastIssuedAt: T0.toISOString() },
    ])
    expect(await listConnections(db, at(30 * DAY))).toEqual([
      { userId: 7, clients: 1, lastIssuedAt: at(MINUTE).toISOString() },
      { userId: 8, clients: 1, lastIssuedAt: at(2 * MINUTE).toISOString() },
    ])

    await revokeUser(db, 7, now)
    for (const token of [a1.access_token, a2.access_token]) expect(await verifyAccessToken(db, token, now)).toBeNull()
    expect((await oauthError(() => refreshTokens(db, refreshBody(a2.refresh_token, second), now, RESOURCE))).code).toBe('invalid_grant')
    expect(await verifyAccessToken(db, b.access_token, now)).toMatchObject({ userId: 8 })
    expect((await listConnections(db, now)).map(c => c.userId)).toEqual([8, 9])
  })

  it('a token of another Telegram account than the user\'s current one is dead: not verified, not refreshed, not listed', async () => {
    const { db, clientId } = await setup()
    const codes = createCodeStore({ now: () => T0.getTime() })
    // the code carries the account the member consented with; every token row of the chain keeps it, rotation included
    const first = await exchangeCode(db, codes, codeBody(codes.issue(grant(clientId, { chainId: 'old' })), clientId), T0, RESOURCE)
    const next = await refreshTokens(db, refreshBody(first.refresh_token, clientId), at(MINUTE), RESOURCE)
    expect(db.sqlite.prepare('SELECT DISTINCT telegram_id FROM oauth_tokens').all()).toEqual([{ telegram_id: 'tg-7' }])
    expect(await verifyAccessToken(db, next.access_token, at(MINUTE))).toMatchObject({ userId: 7 })
    expect((await listConnections(db, at(MINUTE))).map(c => c.userId)).toEqual([7])

    // user 7 is linked to another Telegram account
    db.sqlite.exec("UPDATE users SET telegram_id = 'tg-new' WHERE id = 7")
    const now = at(2 * MINUTE)
    expect(await verifyAccessToken(db, next.access_token, now)).toBeNull()
    expect(await listConnections(db, now)).toEqual([])
    const err = await oauthError(() => refreshTokens(db, refreshBody(next.refresh_token, clientId), now, RESOURCE))
    expect([err.code, err.status]).toEqual(['invalid_grant', 400])
    expect(count(db, 'SELECT COUNT(*) AS n FROM oauth_tokens WHERE chain_id = ? AND revoked_at IS NULL', 'old')).toBe(0)
    // linking the old account back does not bring the chain back
    db.sqlite.exec("UPDATE users SET telegram_id = 'tg-7' WHERE id = 7")
    expect(await verifyAccessToken(db, next.access_token, now)).toBeNull()
    db.sqlite.exec("UPDATE users SET telegram_id = 'tg-new' WHERE id = 7")

    // a connection made with the new account works
    const fresh = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-new', chainId: 'fresh' }, now)
    expect(await verifyAccessToken(db, fresh.access_token, now)).toMatchObject({ userId: 7 })
    expect((await listConnections(db, now)).map(c => c.userId)).toEqual([7])
    await expect(refreshTokens(db, refreshBody(fresh.refresh_token, clientId), now, RESOURCE)).resolves.toMatchObject({ token_type: 'Bearer' })
    // an unlinked or deleted user has no live token either
    db.sqlite.exec('UPDATE users SET telegram_id = NULL WHERE id = 7')
    expect(await listConnections(db, now)).toEqual([])
  })

  it('linking the account again ends the tokens issued before it: linked to another account and back, the old chain stays dead', async () => {
    const { db, clientId } = await setup()
    const old = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'old' }, T0)
    // linked to another account and back to tg-7 with no use of the old tokens in between
    db.sqlite.prepare("UPDATE users SET telegram_id = 'tg-new', telegram_linked_at = ? WHERE id = 7").run(at(MINUTE).toISOString())
    db.sqlite.prepare("UPDATE users SET telegram_id = 'tg-7', telegram_linked_at = ? WHERE id = 7").run(at(2 * MINUTE).toISOString())
    const now = at(3 * MINUTE)
    expect(await verifyAccessToken(db, old.access_token, now)).toBeNull()
    expect(await listConnections(db, now)).toEqual([])
    const err = await oauthError(() => refreshTokens(db, refreshBody(old.refresh_token, clientId), now, RESOURCE))
    expect([err.code, err.status]).toEqual(['invalid_grant', 400])
    expect(count(db, 'SELECT COUNT(*) AS n FROM oauth_tokens WHERE chain_id = ? AND revoked_at IS NULL', 'old')).toBe(0)

    // a token issued after the link is live; a user linked before the column existed (NULL) keeps working
    const fresh = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'fresh' }, at(2 * MINUTE + 1))
    expect(await verifyAccessToken(db, fresh.access_token, now)).toMatchObject({ userId: 7 })
    await expect(refreshTokens(db, refreshBody(fresh.refresh_token, clientId), now, RESOURCE)).resolves.toMatchObject({ token_type: 'Bearer' })
    const legacy = await issueTokens(db, { clientId, userId: 8, telegramId: 'tg-8', chainId: 'legacy' }, T0)
    expect(await verifyAccessToken(db, legacy.access_token, now)).toMatchObject({ userId: 8 })
    expect((await listConnections(db, now)).map(c => c.userId)).toEqual([7, 8])
  })

  it('a token is live only when issued strictly after the link, and an unreadable link time ends it', async () => {
    const { db, clientId } = await setup()
    const linkedAt = (value: string | null) => db.sqlite.prepare('UPDATE users SET telegram_linked_at = ? WHERE id = 7').run(value)
    const same = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'same' }, T0)
    const later = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'later' }, at(1))
    linkedAt(T0.toISOString())
    const now = at(MINUTE)
    expect(await verifyAccessToken(db, same.access_token, now)).toBeNull()
    expect(await verifyAccessToken(db, later.access_token, now)).toMatchObject({ userId: 7 })
    for (const bad of ['garbage', '2031-10-19', '']) {
      linkedAt(bad)
      expect(await verifyAccessToken(db, later.access_token, now), bad).toBeNull()
      expect(await listConnections(db, now), bad).toEqual([])
    }
    const err = await oauthError(() => refreshTokens(db, refreshBody(later.refresh_token, clientId), now, RESOURCE))
    expect(err.code).toBe('invalid_grant')
    expect(count(db, 'SELECT COUNT(*) AS n FROM oauth_tokens WHERE chain_id = ? AND revoked_at IS NULL', 'later')).toBe(0)
  })

  it('a client removed before the tokens are written is invalid_client, not a server error', async () => {
    const { db, clientId } = await setup()
    const real = createCodeStore({ now: () => T0.getTime() })
    // the client disappears between the check of the request and the insert of the tokens
    const codes = { ...real, take: (code: string) => { db.sqlite.exec('DELETE FROM oauth_clients'); return real.take(code) } }
    const code = codes.issue(grant(clientId))
    const err = await oauthError(() => exchangeCode(db, codes, codeBody(code, clientId), T0, RESOURCE))
    expect([err.code, err.status]).toEqual(['invalid_client', 400])
    expect(count(db, 'SELECT COUNT(*) AS n FROM oauth_tokens')).toBe(0)
    expect((await oauthError(() => issueTokens(db, { clientId: 'gone', userId: 7, telegramId: 'tg-7', chainId: 'x' }, T0))).code).toBe('invalid_client')
  })

  it('rows expired 30 days ago are deleted, by a refresh as well as by a new authorization', async () => {
    const { db, clientId } = await setup()
    const rows = (chain: string) => count(db, 'SELECT COUNT(*) AS n FROM oauth_tokens WHERE chain_id = ?', chain)
    const old = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'old' }, T0)
    // rotated once: the old pair stays as revoked rows, for reuse detection
    await refreshTokens(db, refreshBody(old.refresh_token, clientId), at(DAY), RESOURCE)
    expect(rows('old')).toBe(4)
    const live = await issueTokens(db, { clientId, userId: 7, telegramId: 'tg-7', chainId: 'live' }, at(40 * DAY))
    // at day 40 the access tokens (expired at hour 1 and day 1 + 1 h) are 30 days past expiry; the refresh tokens are not
    expect(rows('old')).toBe(2)
    // a refresh at day 62 prunes the refresh tokens that expired at day 30 and day 31
    await refreshTokens(db, refreshBody(live.refresh_token, clientId), at(62 * DAY), RESOURCE)
    expect(rows('old')).toBe(0)
    expect(rows('live')).toBe(4)
  })
})
