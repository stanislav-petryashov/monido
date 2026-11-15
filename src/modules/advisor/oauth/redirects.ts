// The redirect URIs the connector accepts: only Claude can be a client. Claude's web callback exactly, and the loopback
// callback of Claude Code on any port (RFC 8252: the port of a native app's loopback listener changes from run to run).

/** Claude's web callbacks, compared as exact strings. */
const CLAUDE_REDIRECT_URIS: readonly string[] = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback']
const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1']
const LOOPBACK_PATH = '/callback'

/**
 * The host of a loopback callback (`http://localhost:<port>/callback`, `http://127.0.0.1:<port>/callback`), else null.
 * The string must be the URL's canonical form (`href`): no user info, query, fragment, dot segments or default port
 * written out, so what is checked is exactly what the browser will open.
 */
function loopbackHost(uri: string): string | null {
  // an empty query or fragment (`…/callback?`, `…/callback#`) survives `href`: any `?` or `#` is refused outright
  if (/[?#]/.test(uri)) return null
  let url: URL
  try { url = new URL(uri) } catch { return null }
  if (url.href !== uri || url.protocol !== 'http:' || url.username || url.password || url.search || url.hash) return null
  if (!LOOPBACK_HOSTS.includes(url.hostname) || url.pathname !== LOOPBACK_PATH) return null
  return url.hostname
}

/** Whether a client may register this redirect URI. */
export function isAllowedRedirect(uri: string): boolean {
  return CLAUDE_REDIRECT_URIS.includes(uri) || loopbackHost(uri) !== null
}

/** Whether `given` (from an authorization request) is one of the client's registered URIs: exact, or a loopback one on the same host with any port. */
export function redirectMatches(registered: string[], given: string): boolean {
  if (registered.includes(given)) return isAllowedRedirect(given)
  const host = loopbackHost(given)
  return host !== null && registered.some(r => loopbackHost(r) === host)
}
