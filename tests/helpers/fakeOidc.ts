import { createHash, randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import type { CustomFetchOptions } from 'openid-client'

/** What the next sign-in at the provider returns, as the test sets it */
interface Approval { sub: string; name?: string | null; nonce?: string }

/**
 * An OpenID Connect provider in memory at `issuer` (https, so Monido's https-only rule holds): discovery, JWKS, the
 * authorization step (approved by the test, not a person), the token endpoint with PKCE and client_secret_post, userinfo.
 * `fetch` is what Monido's client is given instead of the network.
 */
export async function fakeOidc({ issuer = 'https://idp.test/', clientId = 'monido', secret = 's3cret' } = {}) {
  const base = issuer.replace(/\/$/, '')
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(publicKey), kid: 'k1', alg: 'RS256', use: 'sig' }
  const codes = new Map<string, { challenge: string; redirectUri: string; nonce: string; sub: string; name: string | null }>()
  const tokens = new Map<string, { sub: string; name: string | null }>()
  const state = {
    /** every request fails as a network error would */
    down: false,
    /** the `iss` the ID token carries; default the issuer */
    idTokenIssuer: issuer,
    /** the issuer discovery states; default the issuer */
    discoveredIssuer: issuer,
    /** name and preferred_username left out of the ID token (Authelia 4.39+ keeps claims for userinfo) */
    nameOnlyInUserinfo: false,
    /** the ID token's auth_time (seconds): null leaves it out; default the moment of the token */
    authTime: undefined as number | null | undefined,
    tokenCalls: 0,
    authorizeQueries: [] as URLSearchParams[],
  }

  const app = new Hono()
  app.get('/.well-known/openid-configuration', c => c.json({
    issuer: state.discoveredIssuer,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    jwks_uri: `${base}/jwks`,
    userinfo_endpoint: `${base}/userinfo`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
  }))
  app.get('/jwks', c => c.json({ keys: [jwk] }))
  app.post('/token', async c => {
    state.tokenCalls++
    const body = new URLSearchParams(await c.req.text())
    const grant = codes.get(body.get('code') ?? '')
    codes.delete(body.get('code') ?? '')
    const verifier = body.get('code_verifier') ?? ''
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    if (!grant || body.get('client_id') !== clientId || body.get('client_secret') !== secret || grant.challenge !== challenge
      || body.get('redirect_uri') !== grant.redirectUri) return c.json({ error: 'invalid_grant' }, 400)
    const now = Math.floor(Date.now() / 1000)
    const named = grant.name !== null && !state.nameOnlyInUserinfo ? { name: grant.name } : {}
    const authTime = state.authTime === undefined ? { auth_time: now } : state.authTime === null ? {} : { auth_time: state.authTime }
    const idToken = await new SignJWT({ nonce: grant.nonce, ...named, ...authTime })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(state.idTokenIssuer).setSubject(grant.sub).setAudience(clientId)
      .setIssuedAt(now).setExpirationTime(now + 300).sign(privateKey)
    const access = randomBytes(16).toString('hex')
    tokens.set(access, { sub: grant.sub, name: grant.name })
    return c.json({ access_token: access, token_type: 'Bearer', expires_in: 300, id_token: idToken })
  })
  app.get('/userinfo', c => {
    const who = tokens.get((c.req.header('Authorization') ?? '').replace(/^Bearer /, ''))
    if (!who) return c.json({ error: 'invalid_token' }, 401)
    return c.json({ sub: who.sub, ...(who.name === null ? {} : { name: who.name }) })
  })

  const fetch = async (url: string, init: CustomFetchOptions): Promise<Response> => {
    if (state.down) throw new TypeError('fetch failed')
    return app.fetch(new Request(url, init as RequestInit))
  }

  return {
    state,
    fetch,
    /**
     * The person signs in at the provider: from Monido's redirect to the authorization endpoint, the callback URL the
     * browser is sent back to (`nonce` replaces the one Monido asked for, to forge it).
     */
    approve(authorizeUrl: string, who: Approval): string {
      const url = new URL(authorizeUrl)
      state.authorizeQueries.push(url.searchParams)
      const code = randomBytes(16).toString('hex')
      codes.set(code, {
        challenge: url.searchParams.get('code_challenge') ?? '', redirectUri: url.searchParams.get('redirect_uri') ?? '',
        nonce: who.nonce ?? url.searchParams.get('nonce') ?? '', sub: who.sub, name: who.name === undefined ? 'Anna Example' : who.name,
      })
      const back = new URL(url.searchParams.get('redirect_uri')!)
      back.searchParams.set('code', code)
      back.searchParams.set('state', url.searchParams.get('state') ?? '')
      return back.href
    },
  }
}
