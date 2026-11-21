// The connector's OAuth endpoints outside /api/ (ServerModule.routes): the two metadata documents, Dynamic Client
// Registration, the authorization request, the token and revocation endpoints. Claude calls register, token and revoke
// server to server (no Origin, no cookies), so the app's sameOrigin and sign-in do not apply here; the person signs in
// on the consent page (/advisor/connect), whose API is in ../server.ts. All of it answers 404 while the connector is not
// available (connectorStatus), and createApp does not mount them in the demo.
import { randomId, sameSecret } from '../../../server/secrets'
import { Hono, type Context } from 'hono'
import { setCookie } from 'hono/cookie'
import type { ConsentRequest } from '../../../domain/api'
import { clientAddress, createLoginLimiter, limiterKey, type LoginLimiter } from '../../../server/auth'
import type { AuthRuntime } from '../../../server/authSettings'
import type { AppConfig } from '../../../server/config'
import type { Database } from '../../../server/db'
import { errorJson, InputError, json, noteRequestError, mediaType, readBytes, readJson } from '../../../server/http'
import { connectorUrls, liveAuth, type ConnectorUrls } from '../connector'
import { createCodeStore, createPendingStore, type CodeStore, type PendingStore } from './pending'
import { redirectMatches } from './redirects'
import {
  createRegistrationLimiter, exchangeCode, findClient, GRANT_TYPES, OAuthError, refreshTokens, registerClient, RESPONSE_TYPES, revokeToken, SCOPE,
  type RegistrationLimiter,
} from './store'

/** The in-memory state of one app's connector: one of each per createApp, shared by these routes and the consent API. */
export interface Connector {
  config: AppConfig
  auth: AuthRuntime
  pending: PendingStore
  codes: CodeStore
  registrations: RegistrationLimiter
  /** failed token requests per client address */
  tokenFailures: LoginLimiter
  /** authorization requests kept per client address: a flood cannot push the family's own out of the pending store */
  authorizations: LoginLimiter
}

/**
 * Failed token requests: 10 a minute per client address (the login limiter's default) and no ceiling in all: tokens are
 * random 256-bit values nobody guesses, so a shared ceiling would only let junk from many addresses lock every family
 * refresh out.
 */
const TOKEN_FAILURES = { globalLimit: Infinity }
/** Per client address: 10 kept requests in 10 minutes; in all 90 (below the pending store's 200 over its 10-minute life). */
const AUTHORIZATIONS = { limit: 10, windowMs: 10 * 60_000, globalLimit: 90 }
/** The longest `state` kept for the client */
const STATE_MAX = 1024
/** PKCE S256: base64url of a SHA-256 digest */
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/
/** A token or revocation form is small */
const FORM_MAX_BYTES = 16 * 1024
const CONNECT_PAGE = '/advisor/connect'
/**
 * The id of the request this browser started, set by /oauth/authorize for the consent API only: someone who starts an
 * authorization in their own Claude and sends the consent link to a family member gets a request that member's browser
 * cannot answer.
 */
const BINDING_COOKIE = 'advisor_request'
const BINDING_PATH = '/api/advisor/oauth'
const PENDING_TTL_S = 10 * 60

// one connector per database: createApp builds the routes once for its database, and the consent API finds them by it
const connectors = new WeakMap<Database, Connector>()

/** The connector createApp built for this database; null when no app mounted the advisor's routes on it. */
export function connectorOf(db: Database): Connector | null {
  return connectors.get(db) ?? null
}

/** An RFC 6749 / RFC 7591 JSON answer; never cached. */
function oauthJson(data: unknown, status: number): Response {
  const res = json(data, status)
  res.headers.set('Pragma', 'no-cache')
  return res
}

const oauthError = (err: OAuthError) =>
  oauthJson({ error: err.code, ...(err.description === undefined ? {} : { error_description: err.description }) }, err.status)

/** An OAuthError as its JSON answer; anything else is logged and becomes `server_error` (500), without its text. */
function failure(c: Context, err: unknown): Response {
  if (err instanceof OAuthError) return oauthError(err)
  noteRequestError(c.req.raw, 'advisor-oauth', err)
  return oauthError(new OAuthError('server_error', 500))
}

/** The same 404 as any unknown page outside /api/: nothing tells that the connector exists. */
const notFound = (c: Context) => c.text('Not found', 404)

/** One value of a query or form: absent or empty is null, a repeated parameter is undefined (RFC 6749 §3.1). */
function single(params: URLSearchParams, name: string): string | null | undefined {
  const values = params.getAll(name)
  if (values.length > 1) return undefined
  return values.length === 1 && values[0] !== '' ? values[0] : null
}

/** An `application/x-www-form-urlencoded` body; anything else is invalid_request. */
async function formBody(request: Request): Promise<URLSearchParams> {
  if (mediaType(request) !== 'application/x-www-form-urlencoded') throw new OAuthError('invalid_request', 400, 'the body must be application/x-www-form-urlencoded')
  try {
    return new URLSearchParams(new TextDecoder().decode(await readBytes(request, FORM_MAX_BYTES)))
  } catch (err) {
    if (err instanceof InputError) throw new OAuthError('invalid_request', 400, 'the body is missing or too large')
    throw err
  }
}

/** The redirect URI with the answer's parameters (a registered URI has no query of its own). */
function withParams(redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) if (v !== null) url.searchParams.set(k, v)
  return url.href
}

const redirect = (c: Context, location: string) => {
  c.header('Cache-Control', 'no-store')
  return c.redirect(location, 302)
}

/**
 * GET /oauth/authorize. Until the client and its redirect URI are known, an error goes to the consent page
 * (`/advisor/connect?error=advisor.<code>`), never to a URI from the request; after that, to the redirect URI with `error`
 * and `state`. A valid request is kept in the pending store (once a slot of the address's limit is taken) and the browser
 * goes to `/advisor/connect?request=<id>`.
 */
async function authorize(c: Context, db: Database, connector: Connector, urls: ConnectorUrls): Promise<Response> {
  const query = new URL(c.req.url).searchParams
  const connectError = (code: string) => redirect(c, `${CONNECT_PAGE}?error=advisor.${code}`)
  const clientId = single(query, 'client_id')
  const redirectUri = single(query, 'redirect_uri')
  if (!clientId || !redirectUri) return connectError('invalid_request')
  const client = await findClient(db, clientId)
  if (!client) return connectError('unknown_client')
  if (!redirectMatches(client.redirectUris, redirectUri)) return connectError('invalid_redirect_uri')

  // from here the redirect URI is one the client registered: errors go back to it
  const rawState = single(query, 'state')
  const state = rawState === undefined || (rawState !== null && rawState.length > STATE_MAX) ? undefined : rawState
  const back = (error: string) => redirect(c, withParams(redirectUri, { error, state: state ?? null }))
  if (state === undefined) return back('invalid_request')
  const responseType = single(query, 'response_type')
  if (!responseType) return back('invalid_request')
  if (responseType !== 'code') return back('unsupported_response_type')
  const challenge = single(query, 'code_challenge')
  if (single(query, 'code_challenge_method') !== 'S256' || !challenge || !CODE_CHALLENGE.test(challenge)) return back('invalid_request')
  const resource = single(query, 'resource')
  if (resource === undefined) return back('invalid_request')
  if (resource !== null && resource !== urls.resource) return back('invalid_target')
  // `scope` is not checked: the grant is always `advisor`, and the token answer says so

  const key = limiterKey(clientAddress(c, connector.config))
  if (connector.authorizations.blocked(key)) return back('temporarily_unavailable')
  connector.authorizations.fail(key)
  const id = connector.pending.put({ clientId, clientName: client.clientName, redirectUri, codeChallenge: challenge, state, scope: SCOPE })
  // the connector runs only on https: the cookie is always Secure
  setCookie(c, BINDING_COOKIE, id, { httpOnly: true, sameSite: 'Lax', secure: true, path: BINDING_PATH, maxAge: PENDING_TTL_S })
  return redirect(c, `${CONNECT_PAGE}?request=${id}`)
}

/** POST /oauth/token: the code and refresh grants; every failure counts against the client address. */
async function token(c: Context, db: Database, connector: Connector, urls: ConnectorUrls): Promise<Response> {
  const key = limiterKey(clientAddress(c, connector.config))
  const limited = () => oauthError(new OAuthError('temporarily_unavailable', 429, 'too many failed token requests'))
  if (connector.tokenFailures.blocked(key)) return limited()
  try {
    const body = await formBody(c.req.raw)
    // reading the body yields: check again
    if (connector.tokenFailures.blocked(key)) return limited()
    const now = new Date()
    const tokens = body.get('grant_type') === 'refresh_token'
      ? await refreshTokens(db, body, now, urls.resource, liveAuth(connector.auth))
      : await exchangeCode(db, connector.codes, body, now, urls.resource, liveAuth(connector.auth))
    return oauthJson(tokens, 200)
  } catch (err) {
    if (err instanceof OAuthError) connector.tokenFailures.fail(key)
    return failure(c, err)
  }
}

/** POST /oauth/register (RFC 7591): a JSON body; 201 with the client. */
async function register(c: Context, db: Database, connector: Connector): Promise<Response> {
  try {
    let body: unknown
    try { body = await readJson(c.req.raw) } catch (err) {
      if (err instanceof InputError) throw new OAuthError('invalid_client_metadata', 400, 'the body must be a JSON object')
      throw err
    }
    // by /48: with no server-wide ceiling, one cheap IPv6 allocation must not get 65536 per-/64 quotas
    const clientKey = limiterKey(clientAddress(c, connector.config), 48)
    // built right before the call, with no await in between: a client a pending request or a code refers to is never evicted
    const referenced = [...connector.pending.clientIds(), ...connector.codes.clientIds()]
    const client = await registerClient(db, body, new Date(), { clientKey, limiter: connector.registrations, referenced })
    return oauthJson(client, 201)
  } catch (err) {
    return failure(c, err)
  }
}

/**
 * POST /oauth/revoke (RFC 7009): 200 whatever the token, even without one or with a malformed body; a body that cannot
 * be read or a failing database is a 503 `temporarily_unavailable` (logged), never the app's own error answer.
 */
async function revoke(c: Context, db: Database): Promise<Response> {
  try {
    const value = single(await formBody(c.req.raw), 'token')
    if (value) await revokeToken(db, value, new Date())
  } catch (err) {
    if (!(err instanceof OAuthError)) {
      noteRequestError(c.req.raw, 'advisor-oauth', err)
      return oauthError(new OAuthError('temporarily_unavailable', 503))
    }
  }
  return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}

/** Whether this request comes from the browser that started the authorization `id` (its binding cookie); compared without a timing leak. */
export function startedHere(request: Request, id: string): boolean {
  const cookies = (request.headers.get('Cookie') ?? '').split(';').map(part => part.trim())
  const value = cookies.find(part => part.startsWith(`${BINDING_COOKIE}=`))?.slice(BINDING_COOKIE.length + 1)
  if (value === undefined) return false
  return sameSecret(value, id)
}

/** The consent screen's view of a pending request; null when it is unknown or expired. */
export function consentRequest(connector: Connector, id: string, member: string | null): ConsentRequest | null {
  const request = connector.pending.get(id)
  if (!request) return null
  return { clientName: request.clientName, redirectHost: new URL(request.redirectUri).host, member }
}

/**
 * The person's answer: the pending request is taken (single use) and, when approved, a code is issued for this user and
 * their current Telegram account at once (no await in between); the redirect URI with `code` and `state`, or
 * `error=access_denied` and `state`. Null when the request is unknown or expired.
 */
export function answerConsent(connector: Connector, id: string, user: { userId: number; telegramId: string; generation: number }, approve: boolean): string | null {
  const request = connector.pending.take(id)
  if (!request) return null
  if (!approve) return withParams(request.redirectUri, { error: 'access_denied', state: request.state })
  const code = connector.codes.issue({ ...request, ...user, chainId: randomId(16) })
  return withParams(request.redirectUri, { code, state: request.state })
}

/** The routes; every path answers 404 while the connector is not available. Paths only, no `use`: createApp gates each path. */
export function oauthRoutes({ db, config, auth }: { db: Database; config: AppConfig; auth: AuthRuntime }): Hono {
  const connector: Connector = {
    config,
    auth,
    pending: createPendingStore(),
    codes: createCodeStore(),
    registrations: createRegistrationLimiter(),
    tokenFailures: createLoginLimiter(TOKEN_FAILURES),
    authorizations: createLoginLimiter(AUTHORIZATIONS),
  }
  connectors.set(db, connector)
  const app = new Hono()
  const open = (handler: (c: Context, urls: ConnectorUrls) => Response | Promise<Response>) =>
    (c: Context) => {
      // read per request: the sign-in mode can change while the server runs
      const urls = connectorUrls(config, auth)
      return urls ? handler(c, urls) : notFound(c)
    }
  const notAllowed = open(() => errorJson('method_not_allowed', 405))

  const protectedResource = open((c, u) =>
    c.json({ resource: u.resource, authorization_servers: [u.issuer], scopes_supported: [SCOPE], bearer_methods_supported: ['header'] }))
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    app.get(path, protectedResource)
    app.all(path, notAllowed)
  }
  app.get('/.well-known/oauth-authorization-server', open((c, u) => c.json({
    issuer: u.issuer,
    authorization_endpoint: `${u.issuer}/oauth/authorize`,
    token_endpoint: `${u.issuer}/oauth/token`,
    registration_endpoint: `${u.issuer}/oauth/register`,
    revocation_endpoint: `${u.issuer}/oauth/revoke`,
    response_types_supported: RESPONSE_TYPES,
    grant_types_supported: GRANT_TYPES,
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
  })))
  app.all('/.well-known/oauth-authorization-server', notAllowed)
  app.post('/oauth/register', open(c => register(c, db, connector)))
  app.all('/oauth/register', notAllowed)
  app.get('/oauth/authorize', open((c, u) => authorize(c, db, connector, u)))
  app.all('/oauth/authorize', notAllowed)
  app.post('/oauth/token', open((c, u) => token(c, db, connector, u)))
  app.all('/oauth/token', notAllowed)
  app.post('/oauth/revoke', open(c => revoke(c, db)))
  app.all('/oauth/revoke', notAllowed)
  return app
}
