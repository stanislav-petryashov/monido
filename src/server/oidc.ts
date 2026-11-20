// The OpenID Connect protocol, through openid-client: discovery, the authorization URL with PKCE, state and nonce, and the
// code exchange with the ID token's checks. Sessions, users and rights stay Monido's; this file only says who the provider
// vouched for.
import * as client from 'openid-client'
import type { OidcConfig } from './config'

/** Why a provider step failed: it did not answer (or answered nonsense to discovery), or the answer was refused */
export type OidcFailureCode = 'oidc_unavailable' | 'oidc_failed'

export class OidcFailure extends Error {
  readonly code: OidcFailureCode
  constructor(code: OidcFailureCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.name = 'OidcFailure'
  }
}

/** The per-attempt secrets the browser keeps in the signed state cookie until the provider sends it back */
export interface OidcChecks { state: string; nonce: string; verifier: string }

export const newChecks = (): OidcChecks => ({ state: client.randomState(), nonce: client.randomNonce(), verifier: client.randomPKCECodeVerifier() })

/** Who the provider vouched for: the configured issuer and the account's `sub`, and a display name when it gave one */
export interface ProviderAnswer { issuer: string; subject: string; name: string | null }

export interface OidcClient {
  /** The provider's host, for the button: "Sign in with idp.example.com" */
  provider(): string
  authorizationUrl(checks: OidcChecks, prompt?: 'login'): Promise<URL>
  /** The code exchange for the callback URL (the redirect URI plus the query the provider sent) */
  finish(callbackUrl: URL, checks: OidcChecks): Promise<ProviderAnswer>
}

const DISCOVERY_TIMEOUT_S = 5
const RETRY_AFTER_MS = 30_000
const CLOCK_TOLERANCE_S = 60

/** What replaces the network for the provider's requests (tests) */
export type OidcFetch = client.CustomFetch

/** A network failure or a timeout, anywhere in the error's causes */
function unreachable(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if (e instanceof TypeError || e.name === 'TimeoutError' || e.name === 'AbortError') return true
  }
  return false
}

const nameOf = (claims: Record<string, unknown> | undefined): string | null => {
  const name = claims?.name ?? claims?.preferred_username
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

/**
 * The client of a usable `config` (no problem). Discovery is lazy and shared: a provider that starts after Monido is no
 * error until someone signs in; after a failure no new attempt is made for RETRY_AFTER_MS, so an anonymous visitor cannot
 * make Monido hammer the provider. `fetch` replaces the network (tests).
 */
export function createOidcClient(config: OidcConfig, { fetch, now = Date.now, log = (line: string) => console.warn(line) }: { fetch?: OidcFetch; now?: () => number; log?: (line: string) => void } = {}): OidcClient {
  if (config.problem !== null || config.secret === null || config.redirectUri === null) throw new Error(`the provider is not usable: ${config.problem}`)
  const { issuer, clientId, secret, redirectUri } = config
  let pending: Promise<client.Configuration> | null = null
  let failedAt: number | null = null

  const discover = (): Promise<client.Configuration> => {
    if (pending) return pending
    if (failedAt !== null && now() - failedAt < RETRY_AFTER_MS) return Promise.reject(new OidcFailure('oidc_unavailable', 'the provider failed a moment ago'))
    const options = { timeout: DISCOVERY_TIMEOUT_S, ...(fetch ? { [client.customFetch]: fetch } : {}) }
    pending = client.discovery(new URL(issuer), clientId, { client_secret: secret, [client.clockTolerance]: CLOCK_TOLERANCE_S }, undefined, options)
      .then(found => {
        const stated = found.serverMetadata().issuer
        // compared as written: the ID token's iss is checked against the stated issuer, identities against the configured one
        if (stated !== issuer) {
          log(`[oidc] the provider states its issuer as "${stated}", OIDC_ISSUER is "${issuer}": copy it exactly, trailing slash included`)
          throw new OidcFailure('oidc_failed', 'issuer mismatch')
        }
        if (fetch) found[client.customFetch] = fetch
        found.timeout = DISCOVERY_TIMEOUT_S
        return found
      })
      .catch((error: unknown) => {
        pending = null
        failedAt = now()
        if (error instanceof OidcFailure) throw error
        log(`[oidc] discovery at ${issuer} failed: ${error instanceof Error ? error.message : String(error)}`)
        throw new OidcFailure('oidc_unavailable', 'discovery failed', { cause: error })
      })
    return pending
  }

  return {
    provider: () => new URL(issuer).host,
    async authorizationUrl(checks, prompt) {
      const found = await discover()
      return client.buildAuthorizationUrl(found, {
        redirect_uri: redirectUri,
        scope: 'openid profile',
        state: checks.state,
        nonce: checks.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(checks.verifier),
        code_challenge_method: 'S256',
        ...(prompt ? { prompt } : {}),
      })
    },
    async finish(callbackUrl, checks) {
      const found = await discover()
      try {
        const tokens = await client.authorizationCodeGrant(found, callbackUrl, {
          pkceCodeVerifier: checks.verifier, expectedState: checks.state, expectedNonce: checks.nonce, idTokenExpected: true,
        })
        const claims = tokens.claims()
        if (!claims || claims.iss !== issuer || typeof claims.sub !== 'string') throw new OidcFailure('oidc_failed', 'no usable ID token')
        let name = nameOf(claims)
        if (name === null) {
          // Authelia 4.39+ keeps claims out of the ID token; a failing userinfo only costs the name
          name = await client.fetchUserInfo(found, tokens.access_token, claims.sub).then(info => nameOf(info), () => null)
        }
        return { issuer, subject: claims.sub, name }
      } catch (error) {
        if (error instanceof OidcFailure) throw error
        throw new OidcFailure(unreachable(error) ? 'oidc_unavailable' : 'oidc_failed', error instanceof Error ? error.message : String(error), { cause: error })
      }
    },
  }
}

const MAX_RETURN_BYTES = 1024

/**
 * Where to go after signing in: a path of this site only (`origin` is APP_URL's), else `/`. Never `//host`, `/\host`, an
 * absolute URL or control characters; short enough for the state cookie.
 */
export function safeReturn(path: unknown, origin: string): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return '/'
  // eslint-disable-next-line no-control-regex -- the point is to refuse control characters
  if (/[\u0000-\u001f\u007f]/.test(path) || Buffer.byteLength(path, 'utf8') > MAX_RETURN_BYTES) return '/'
  try {
    return new URL(path, origin).origin === origin ? path : '/'
  } catch { return '/' }
}
