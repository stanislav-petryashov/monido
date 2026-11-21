// Serves the built client: hashed assets cached forever, index.html always fresh, SPA fallback, dot paths hidden.
import type { Env, Hono, MiddlewareHandler } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'node:fs'
import { logEvent } from './log'
import { join } from 'node:path'
import { isApiPath } from './http'

const IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * Sets Cache-Control on the serveStatic answer. The onFound hook does not work for this: it runs
 * after the answer is built, and the header never reaches the client.
 */
function withCache(serve: MiddlewareHandler, cacheControl: (path: string) => string): MiddlewareHandler {
  return async (c, next) => {
    let passed = false
    const served = await serve(c, async () => { passed = true; await next() })
    if (passed || !served) return served
    // the handler built the answer, but Hono has not taken it as c.res yet
    c.res = served
    c.header('Cache-Control', cacheControl(c.req.path))
    return c.res
  }
}

/** A path segment starting with a dot (.vite/manifest.json, .env, ..), also percent-encoded: never served. */
function hasDotSegment(path: string): boolean {
  return path.split('/').some(segment => {
    try { return decodeURIComponent(segment).startsWith('.') } catch { return segment.startsWith('.') }
  })
}

/** root is the dist/client folder relative to the process working directory. */
export function mountStatic<E extends Env>(app: Hono<E>, root: string): void {
  if (!existsSync(root)) logEvent('WARN', 'monido.server.client_missing', 'CLIENT_DIR is missing. Build the client or check CLIENT_DIR.')
  // Resolve the root per request so a later build is served and the adapter does not print the raw directory at startup.
  const files = withCache(serveStatic({ rewriteRequestPath: path => join(root, path) }), path => (path.startsWith('/assets/') ? IMMUTABLE : 'no-cache'))
  const fallback = withCache(serveStatic({ path: join(root, 'index.html') }), () => 'no-cache')
  // a dot segment is a 404 from the app, neither the file nor the SPA page
  app.use('*', (c, next) => (hasDotSegment(c.req.path) ? next() : files(c, next)))
  // an unknown /api (and /api/*) stays the app's JSON 404, and a missing asset is a 404, not the SPA page
  // (an old tab after an update would request a script and get HTML)
  app.get('*', (c, next) => {
    const path = c.req.path
    return isApiPath(path) || path.startsWith('/assets/') || hasDotSegment(path) ? next() : fallback(c, next)
  })
}
