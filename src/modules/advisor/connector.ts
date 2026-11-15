// Whether Claude's connector can work on this server, and the addresses the outside world sees. Every identifier is
// built from APP_URL, never from the request (the server runs behind a TLS-terminating proxy or tunnel).
import type { ConnectorView } from '../../domain/api'
import type { AuthRuntime } from '../../server/authSettings'
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

/**
 * Available only with Telegram sign-in (every token belongs to a person who signed in through the bot) and an https://
 * APP_URL; `reason` names the first missing condition. Every OAuth and MCP route answers 404 while it is not available.
 */
export function connectorStatus(config: AppConfig, auth: AuthRuntime): ConnectorStatus {
  if (auth.mode() !== 'telegram') return { available: false, reason: 'auth_mode', mcpUrl: null }
  const urls = connectorUrls(config, auth)
  if (!urls) return { available: false, reason: 'app_url', mcpUrl: null }
  return { available: true, reason: null, mcpUrl: urls.resource }
}

/** The connector's addresses, null while it is not available (connectorStatus). */
export function connectorUrls(config: AppConfig, auth: AuthRuntime): ConnectorUrls | null {
  const issuer = auth.mode() === 'telegram' ? httpsBase(config.appUrl) : null
  if (issuer === null) return null
  return { issuer, resource: `${issuer}/mcp`, resourceMetadata: `${issuer}/.well-known/oauth-protected-resource` }
}
