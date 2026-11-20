import { expect } from 'vitest'
import type { createApp } from '../../src/server/app'
import type { LoginAttempts } from '../../src/server/loginAttempts'
import { createHmac } from 'node:crypto'
import { hashPassword, loadAuthRuntime, type AuthRuntime, type SignInMode } from '../../src/server/authSettings'
import type { TestConfig, TestDb } from './db'

/** A runtime in memory whose mode and token a test switches with `set` (the listeners hear it). */
export interface FakeAuthRuntime extends AuthRuntime { set(next: { mode?: SignInMode; botToken?: string | null }): void }

/**
 * An AuthRuntime without a database: the mode and the bot token as given (password mode, no bot by default), nothing
 * env-locked, `password` the app password if given. Writes change memory only and notify like the real one.
 */
export function fakeAuthRuntime(opts: { mode?: SignInMode; botToken?: string | null; sessionSecret?: string | null; password?: string; locked?: boolean } = {}): FakeAuthRuntime {
  let mode: SignInMode = opts.mode ?? 'password'
  let botToken = opts.botToken ?? null
  let password = opts.password ?? null
  let generation = 1
  const secret = opts.sessionSecret ?? 'test'
  const listeners = new Set<() => void>()
  const notify = () => { for (const listener of [...listeners]) listener() }
  return {
    mode: () => mode,
    storedMode: () => (mode === 'bootstrap' || mode === 'none' ? 'password' : mode),
    signInLink: () => (mode === 'telegram' ? { method: 'telegram' } : mode === 'oidc' ? { method: 'oidc', issuer: 'https://idp.test/' } : null),
    locked: () => opts.locked ?? false,
    passwordSource: () => password === null ? null : 'app',
    botTokenSource: () => botToken === null ? null : 'app',
    botToken: () => botToken,
    verifyPassword: async given => password !== null && given === password,
    async setPassword(next) { password = next; generation++; notify() },
    async setBotToken(token, _actor, verify) {
      const result = await verify(token)
      botToken = token
      notify()
      return result
    },
    async clearBotToken() { botToken = null; notify() },
    async setMode(next) { mode = next; generation++; notify() },
    generation: () => generation,
    signingKey: () => createHmac('sha256', secret).update(`${mode}:${generation}`).digest('hex'),
    bootstrapOpen: () => mode === 'bootstrap',
    async completeBootstrap(next) { password = next; mode = 'password'; generation++; notify() },
    reload: notify,
    onChange(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      if (next.mode !== undefined) mode = next.mode
      if (next.botToken !== undefined) botToken = next.botToken
      notify()
    },
  }
}

/** The explicit fixture, or fresh bootstrap when none was supplied. */
export function authFor(config: TestConfig): FakeAuthRuntime {
  return fakeAuthRuntime({
    locked: config.authMode === 'none',
    mode: config.authMode === 'none' ? 'none' : (config.testAuth?.mode as SignInMode | undefined) ?? (config.testAuth?.password || config.authMode === 'demo' ? 'password' : 'bootstrap'),
    botToken: config.telegramBotToken,
    sessionSecret: config.sessionSecret,
    password: config.testAuth?.password,
  })
}

/** Seed settings and explicitly activate the fixture mode, including Telegram before tests add users. */
export async function loadTestAuthRuntime(db: TestDb, config: TestConfig, opts: Parameters<typeof loadAuthRuntime>[2] = {}) {
  const put = db.sqlite.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
  if (config.testAuth?.mode) put.run('auth_mode', config.testAuth.mode)
  if (config.testAuth?.password) put.run('auth_password', await hashPassword(config.testAuth.password))
  const runtime = await loadAuthRuntime(db, config, opts)
  const wanted = config.testAuth?.mode
  if (config.authMode !== 'none' && (wanted === 'telegram' || wanted === 'oidc') && runtime.mode() !== wanted) {
    await runtime.setMode(wanted, { name: 'fixture', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null })
  }
  return runtime
}

export const cookieNamed = (res: Response, name: string) => res.headers.getSetCookie().find(line => line.startsWith(`${name}=`))?.split(';')[0] ?? ''

export async function signInTelegram(app: ReturnType<typeof createApp>, logins: LoginAttempts, userId: number): Promise<string> {
  const start = await app.request('/api/auth/telegram', { method: 'POST' })
  const { link } = await start.json() as { link: string }
  expect(logins.approve(/login_(.+)$/.exec(link)![1], userId)).toBe(true)
  const done = await app.request('/api/auth/telegram', { headers: { Cookie: cookieNamed(start, 'login') } })
  return cookieNamed(done, 'session')
}
