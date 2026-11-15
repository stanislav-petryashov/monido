// Serving an app over HTTP: shared by the family server (main.ts) and the demo server (demo/start.ts).
import { serve } from '@hono/node-server'
import type { AppConfig } from './config'

export interface RunningServer { port: number; stop(): Promise<void> }

/**
 * Listens on config.host:config.port. `release` frees what the server holds (timers, the bot, databases): when listening
 * fails, and on stop once the HTTP server has closed; stop resolves after it.
 */
export async function listen(
  app: { fetch(req: Request): Response | Promise<Response> }, config: AppConfig, release: () => void | Promise<void>,
): Promise<RunningServer> {
  let listening: { server: ReturnType<typeof serve>; port: number }
  try {
    listening = await new Promise((resolve, reject) => {
      const s = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, info => resolve({ server: s, port: info.port }))
      // the port is taken or unavailable: without this the process would crash on an unhandled 'error'
      s.once('error', reject)
    })
  } catch (err) {
    await release()
    throw err
  }
  const { server, port } = listening
  // the [auth] line of the sign-in runtime names the mode
  console.log(`[server] listening on http://${config.host}:${port}`)
  let stopping: Promise<void> | null = null
  return {
    port,
    // a repeated call (SIGTERM after SIGINT) waits for the same shutdown instead of releasing twice
    stop: () => stopping ??= new Promise<void>((resolve, reject) => {
      server.close(() => { Promise.resolve().then(release).then(resolve, reject) })
    }),
  }
}
