// Whether Claude's connector can work on this server, and the addresses the outside world sees. Every identifier is
// built from APP_URL, never from the request (the server runs behind a TLS-terminating proxy or tunnel).
import type { ConnectorView } from '../../domain/api'
import { fallbackOf, type AuthRuntime } from '../../server/authSettings'
import type { LiveAuth } from './oauth/store'
import { isPersonal } from '../../server/signIn'
import type { AppConfig } from '../../server/config'

type ConnectorStatus = Pick<ConnectorView, 'available' | 'reason' | 'mcpUrl'>

/** The connector's public addresses: the issuer is APP_URL without a trailing slash. */
export interface ConnectorUrls {
  issuer: string
  /** the MCP endpoint, the `resource` of RFC 8707 */
  resource: string
  /** the protected-resource metadata (RFC 9728) that a 401 of /mcp points to */
  resourceMetadata: string
}

/**
 * APP_URL as an https origin, else null. A path is refused too: RFC 8414 would look for an issuer's metadata with a path at
 * `/.well-known/oauth-authorization-server/<path>`, which the server does not serve.
 */
function httpsBase(appUrl: string | null): string | null {
  if (!appUrl) return null
  let url: URL
  try { url = new URL(appUrl) } catch { return null }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null
  return url.origin
}

/** The sign-in modes a connection can belong to: a person (personal accounts) or the family (the family password, not the fallback). */
function connectorMode(config: AppConfig, auth: AuthRuntime): 'personal' | 'password' | 'fallback' | null {
  // the demo's runtime reads as password: its visitors are anonymous sandboxes, never a family to act for
  if (config.authMode === 'demo') return null
  const mode = auth.mode()
  if (isPersonal(mode)) return 'personal'
  if (mode !== 'password') return null
  // a personal mode stored but no manager who can sign in: leaving it bumps no generation, so a family token there would come back
  return fallbackOf(auth) === null ? 'password' : 'fallback'
}

/**
 * Available with Telegram sign-in (a token is a person's) or the family password (a token is the family's), not in the
 * Telegram fallback, and an https:// APP_URL; `reason` names the first missing condition. Every OAuth and MCP route
 * answers 404 while it is not available.
 */
export function connectorStatus(config: AppConfig, auth: AuthRuntime): ConnectorStatus {
  const mode = connectorMode(config, auth)
  if (mode === null) return { available: false, reason: 'auth_mode', mcpUrl: null }
  if (mode === 'fallback') return { available: false, reason: 'fallback', mcpUrl: null }
  const urls = connectorUrls(config, auth)
  if (!urls) return { available: false, reason: 'app_url', mcpUrl: null }
  return { available: true, reason: null, mcpUrl: urls.resource }
}

/** The sign-in a token or a code is checked against, read now. */
export function liveAuth(auth: AuthRuntime): LiveAuth {
  return { mode: auth.mode(), generation: auth.generation(), fallback: fallbackOf(auth) !== null }
}

/** The connector's addresses, null while it is not available (connectorStatus). */
export function connectorUrls(config: AppConfig, auth: AuthRuntime): ConnectorUrls | null {
  const mode = connectorMode(config, auth)
  const issuer = mode === 'personal' || mode === 'password' ? httpsBase(config.appUrl) : null
  if (issuer === null) return null
  return { issuer, resource: `${issuer}/mcp`, resourceMetadata: `${issuer}/.well-known/oauth-protected-resource` }
}
