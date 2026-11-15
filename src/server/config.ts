// Server settings from environment variables: one check at startup, a typed object afterwards.
import path from 'node:path'
import type { AuthRuntime } from './authSettings'

/** Variables the modules see (reminders): names as in .env. */
export interface ModuleEnv { TELEGRAM_BOT_TOKEN?: string; APP_URL?: string }

/** AUTH_MODE as .env may set it; the live mode (with 'bootstrap') is AuthRuntime.mode(). */
export type EnvAuthMode = 'none' | 'demo'

export interface AppConfig {
  /** AUTH_MODE from .env; null: not there, the mode is the app's (app_settings) */
  authMode: EnvAuthMode | null
  /** Demo mode only: the password shown on the sign-in screen (DEMO_PASSWORD) */
  demoPassword: string | null
  /** Demo mode only: where "Install it yourself" leads (DEMO_INSTALL_URL), an http(s) address */
  demoInstallUrl: string | null
  /** null: main.ts reads or creates DATA_DIR/session.key */
  sessionSecret: string | null
  dataDir: string
  schemaFile: string
  clientDir: string
  host: string
  port: number
  appUrl: string | null
  telegramBotToken: string | null
  /** CLIENT_IP_HEADER: the header the reverse proxy puts the client address in (X-Forwarded-For…); unset — the socket address */
  clientIpHeader: string | undefined
  /** APP_VERSION, embedded by the image build (git describe); 'dev' outside an image */
  appVersion: string
  /** UPDATE_CHECK not off/false/0, and never in demo: ask the registry for a newer image */
  updateCheck: boolean
}

export class ConfigError extends Error {}

/** The demo's shared password, shown on its sign-in screen: shorter than a family password may be */
const MIN_DEMO_PASSWORD = 8
const DEFAULT_DEMO_PASSWORD = 'demo-family'
const MIN_SESSION_SECRET = 32

function nonEmpty(value: string | undefined): string | null {
  const v = value?.trim()
  return v ? v : null
}

/** The page opens the address as a link: only http(s), never javascript: or data:. */
function isHttpUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

/** DATA_DIR when unset: the built server (npm start, dist/server/main.js) keeps ./data, the sources under tsx (npm run dev) use ./data-dev. */
const DEFAULT_DATA_DIR = typeof __SERVER_BUILD__ !== 'undefined' ? 'data' : 'data-dev'

/** defaultDataDir: the DATA_DIR default (DEFAULT_DATA_DIR); tests pin either value. */
export function loadConfig(env: Record<string, string | undefined>, { defaultDataDir = DEFAULT_DATA_DIR }: { defaultDataDir?: string } = {}): AppConfig {
  const given = nonEmpty(env.AUTH_MODE)
  if (given !== null && given !== 'demo' && given !== 'none') throw new ConfigError(`AUTH_MODE only accepts "none" or "demo". Remove AUTH_MODE=${given} and choose password or telegram in Settings → Family and access.`)
  if (nonEmpty(env.APP_PASSWORD)) throw new ConfigError('APP_PASSWORD is no longer supported. Remove it from .env and manage the family password in Settings → Family and access. Existing saved passwords are retained.')
  const mode = given
  const demoPassword = mode === 'demo' ? (nonEmpty(env.DEMO_PASSWORD) ?? DEFAULT_DEMO_PASSWORD) : null
  if (demoPassword !== null && demoPassword.length < MIN_DEMO_PASSWORD) throw new ConfigError(`DEMO_PASSWORD must be at least ${MIN_DEMO_PASSWORD} characters`)
  const demoInstallUrl = mode === 'demo' ? nonEmpty(env.DEMO_INSTALL_URL) : null
  if (demoInstallUrl !== null && !isHttpUrl(demoInstallUrl)) throw new ConfigError(`DEMO_INSTALL_URL must be an http:// or https:// address, got "${demoInstallUrl}"`)
  const sessionSecret = nonEmpty(env.SESSION_SECRET)
  if (sessionSecret && sessionSecret.length < MIN_SESSION_SECRET) {
    throw new ConfigError(`SESSION_SECRET must be at least ${MIN_SESSION_SECRET} characters (or unset it to generate DATA_DIR/session.key)`)
  }
  const portRaw = nonEmpty(env.PORT) ?? '8080'
  // decimal digits only: Number() would also accept 0x50, 1e3, 8080.0
  const port = /^\d+$/.test(portRaw) ? Number(portRaw) : NaN // 0 is any free port (tests)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError(`PORT must be a port number, got "${portRaw}"`)
  const cwd = process.cwd()
  return {
    authMode: mode,
    demoPassword,
    demoInstallUrl,
    sessionSecret,
    dataDir: path.resolve(cwd, nonEmpty(env.DATA_DIR) ?? defaultDataDir),
    schemaFile: path.resolve(cwd, nonEmpty(env.SCHEMA_FILE) ?? 'schema.sql'),
    clientDir: path.resolve(cwd, nonEmpty(env.CLIENT_DIR) ?? 'dist/client'),
    host: nonEmpty(env.HOST) ?? '0.0.0.0',
    port,
    appUrl: nonEmpty(env.APP_URL),
    telegramBotToken: nonEmpty(env.TELEGRAM_BOT_TOKEN),
    clientIpHeader: nonEmpty(env.CLIENT_IP_HEADER) ?? undefined,
    appVersion: nonEmpty(env.APP_VERSION) ?? 'dev',
    updateCheck: mode !== 'demo' && !['off', 'false', '0'].includes((nonEmpty(env.UPDATE_CHECK) ?? '').toLowerCase()),
  }
}

/**
 * One startup warning: a mode that signs people in itself (password or telegram, managed in the app) on an https
 * APP_URL — so behind a TLS-terminating proxy or tunnel — with no CLIENT_IP_HEADER. The server then sees one address for
 * everyone, and the sign-in and token limits count per address. The demo has its own server.
 */
export function warnIfClientIpShared(config: AppConfig): void {
  if (config.authMode === 'demo' || !secureCookies(config) || config.clientIpHeader) return
  console.warn(
    '[config] APP_URL is on https but CLIENT_IP_HEADER is unset: behind a proxy or tunnel every client comes with the address of the proxy, so the whole family shares one sign-in and token limit. ' +
    'Set CLIENT_IP_HEADER to the header the proxy puts the client address in (CF-Connecting-IP behind Cloudflare, X-Forwarded-For behind Caddy or nginx).',
  )
}

/** Variables for the modules: the same names as in .env. */
export function moduleEnv(config: AppConfig, auth: AuthRuntime): ModuleEnv {
  const botToken = auth.botToken()
  return {
    ...(botToken ? { TELEGRAM_BOT_TOKEN: botToken } : {}),
    ...(config.appUrl ? { APP_URL: config.appUrl } : {}),
  }
}

/** Cookies get the Secure flag when the site is behind HTTPS. */
export function secureCookies(config: AppConfig): boolean {
  return config.appUrl?.toLowerCase().startsWith('https://') ?? false
}
