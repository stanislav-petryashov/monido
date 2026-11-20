// /api/auth-settings: the sign-in settings of Settings → Family and access — the view, the family password, the bot token (checked
// with Telegram's getMe before it is stored) and the switch back to the family password. Mounted after sign-in and the
// rights check (writes need `manage`; the GET checks it here). Secrets never leave the server: no answer carries a token
// or a hash, and the error log cuts the token out.
import { Hono, type Context } from 'hono'
import { deleteCookie, getSignedCookie } from 'hono/cookie'
import type { AuthSettingsView } from '../domain/api'
import {
  actorOfUser, switchBotKey, clientAddress, issueSession, limiterKey, SWITCH_COOKIE, SWITCH_TTL_MS, verifyCounted, withCookies, type AuthVariables, type LoginLimiter,
} from './auth'
import { assertPassword, fallbackOf, planSharedPassword, type AuthRuntime } from './authSettings'
import { getMe, TelegramError } from './bot/telegram'
import type { BotHandle } from './bot/reader'
import type { AppConfig } from './config'
import { transaction, type SqliteDatabase } from './db'
import { errorJson, field, guard, InputError, json, notAllowed, readJson, requireRight, type Actor } from './http'
import { hasSignInManager } from './users'

type Ctx = Context<{ Variables: AuthVariables }>

/** A bot token as @BotFather gives it: the bot's id, a colon, the secret */
const BOT_TOKEN = /^\d+:[A-Za-z0-9_-]+$/
/** The getMe failures whose texts name their params: telegram.status {{status}}, telegram.external {{detail}} */
const SHOWN_PARAMS: ReadonlySet<string> = new Set(['telegram.status', 'telegram.external'])
/** At most one getMe per this many ms: Telegram's own rate limits are real */
const GET_ME_INTERVAL_MS = 5_000

/** The error text for the log with the token cut out: a failed request's address carries it. */
const masked = (token: string) => (err: unknown): string => {
  const text = err instanceof Error ? err.stack ?? err.message : String(err)
  return token ? text.split(token).join('***') : text
}

export function authSettingsRoutes({ db, config, auth, bot, limiter, telegramFetch, now = Date.now }: {
  db: SqliteDatabase
  config: AppConfig
  auth: AuthRuntime
  bot?: Pick<BotHandle, 'username' | 'status'>
  limiter: LoginLimiter
  telegramFetch?: typeof fetch
  now?: () => number
}): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>()
  const demo = config.authMode === 'demo'
  // one router per process: this is the process-wide getMe clock
  let lastGetMe = -Infinity

  /** Every route: the demo has no sign-in settings of its own. */
  const route = (c: Ctx, run: () => Promise<unknown>, describe?: (err: unknown) => unknown) =>
    guard(c.req, { tag: 'auth-settings', describe }, async () => {
      if (demo) throw new InputError('not_in_demo', 403)
      return run()
    })

  /**
   * The family password the caller types to prove it is them: counted before the verification (scrypt, slow), so
   * concurrent guesses cannot queue more work than the limiter allows; a right one clears the client's count.
   */
  const checkCurrent = async (c: Ctx, current: unknown): Promise<Response | null> => {
    const client = limiterKey(clientAddress(c, config))
    if (limiter.blocked(client)) return errorJson('too_many_attempts', 429)
    return verifyCounted(auth, limiter, client, current, 'wrong_current_password')
  }

  const botStatus = () => bot?.status() ?? { configured: false, username: null, problem: null }
  /** The bot is connected: a token, and the reader has introduced itself without a problem */
  const botReady = () => {
    const status = botStatus()
    return !!auth.botToken() && status.problem === null && status.username !== null
  }

  /**
   * The switch ticket of this browser (signed with the live key: a password change or a switch since voids it), with the
   * actor re-read now: null without one, or when the confirming account has gone or re-linked since.
   */
  const readTicket = async (c: Ctx): Promise<{ actor: Actor; approvedAt: number } | null> => {
    if (auth.mode() !== 'password') return null
    const value = await getSignedCookie(c, auth.signingKey(), SWITCH_COOKIE)
    const parts = value ? /^(\d+)\.(\d+)\.([a-f0-9]+)$/.exec(value) : null
    if (!parts || parts[3] !== switchBotKey(auth)) return null
    const approvedAt = Number(parts[2])
    const actor = await actorOfUser(db, Number(parts[1]), approvedAt)
    return actor ? { actor, approvedAt } : null
  }

  app.get('/api/auth-settings', c => route(c, async () => {
    requireRight(c.get('actor'), 'manage')
    const mode = auth.mode()
    const status = botStatus()
    const passwordSource = auth.passwordSource()
    const view: AuthSettingsView = {
      // nobody is signed in in bootstrap state, so it never reaches here
      mode: mode === 'bootstrap' ? 'password' : mode,
      stored: auth.storedMode(),
      locked: auth.locked(),
      password: { set: passwordSource !== null, source: passwordSource },
      bot: { source: auth.botTokenSource(), username: status.username, problem: status.problem },
      switchToTelegram: {
        bot: botReady(),
        linkedManager: await hasSignInManager(db),
        proof: await readTicket(c).then(t => t && { member: t.actor.name, manage: t.actor.rights.manage }),
      },
      fallback: fallbackOf(auth),
    }
    return view
  }))
  app.all('/api/auth-settings', notAllowed)

  // { current?, password }: current is the family password in password mode (a stolen session must not rotate it);
  // in telegram mode the caller is a named manager preparing the fallback, and no current is asked
  app.post('/api/auth-settings/password', c => route(c, async () => {
    const mode = auth.mode()
    if (mode !== 'password' && mode !== 'telegram') throw new InputError('wrong_mode', 409)
    const body = await readJson(c.req.raw)
    const password = field(body, 'password')
    // the shape before the current password: a too-short one costs no attempt
    assertPassword(password)
    if (mode === 'password') {
      const refused = await checkCurrent(c, field(body, 'current'))
      if (refused) return refused
    }
    const actor = c.get('actor')
    await auth.setPassword(password, actor)
    // a switch committed while the password hashed: the saved password stands, the caller signs in again
    if (auth.mode() !== mode) throw new InputError('wrong_mode', 409)
    // the family in password mode, the named manager in telegram mode
    await issueSession(c, auth, config, actor.userId === null ? null : { userId: actor.userId })
    return withCookies(c, json({ ok: true }))
  }))
  app.all('/api/auth-settings/password', notAllowed)

  // { token }: trimmed (a token copied from Telegram may carry a newline), checked with getMe, stored only when Telegram
  // says yes; a failure keeps the old token and the running reader
  app.post('/api/auth-settings/bot-token', c => {
    let token = ''
    return route(c, async () => {
      if (auth.botTokenSource() === 'env') throw new InputError('bot_token_locked', 409)
      const raw = field(await readJson(c.req.raw), 'token')
      token = typeof raw === 'string' ? raw.trim() : ''
      if (!BOT_TOKEN.test(token)) throw new InputError('invalid_value', 400, { column: 'token' })
      if (now() - lastGetMe < GET_ME_INTERVAL_MS) throw new InputError('too_many_attempts', 429)
      lastGetMe = now()
      const verify = async (t: string) => {
        try {
          return await getMe(t, telegramFetch)
        } catch (err) {
          // the status and Telegram's own reason go along for the texts that name them; neither carries the token
          if (err instanceof TelegramError) throw new InputError(err.code, 409, SHOWN_PARAMS.has(err.code) ? err.params : undefined)
          console.error(`[auth-settings] getMe failed: ${masked(t)(err)}`)
          throw new InputError('telegram.unavailable', 409)
        }
      }
      return auth.setBotToken(token, c.get('actor'), verify)
    }, err => masked(token)(err))
  })
  // the bot is how people sign in in telegram mode: it cannot be disconnected there
  app.delete('/api/auth-settings/bot-token', c => route(c, async () => {
    if (auth.botTokenSource() === 'env') throw new InputError('bot_token_locked', 409)
    // also while Telegram is stored but fell back at start: the next start would come up in Telegram mode with no bot
    if (auth.mode() === 'telegram' || fallbackOf(auth) !== null) throw new InputError('wrong_mode', 409)
    await auth.clearBotToken(c.get('actor'))
    return { ok: true }
  }))
  app.all('/api/auth-settings/bot-token', notAllowed)

  // { mode: 'password', password? }: the switch to the shared family password, the same plan a demo-data load runs;
  // { mode: 'telegram', current }: the family password first (a stolen session is not enough), then the bot, a linked
  // manager and a test sign-in ticket of a manager younger than 10 minutes; the switcher gets that user's session
  app.post('/api/auth-settings/mode', c => route(c, async () => {
    // the session was checked on arrival; a password change or a switch committed while this request awaited (a held
    // body, the scrypt) revoked it, so the switch to the family password is refused rather than run on a dead session
    const generation = auth.generation()
    const botToken = auth.botToken()
    const mode = auth.mode()
    const body = await readJson(c.req.raw)
    const next = field(body, 'mode')
    if (next !== 'password' && next !== 'telegram') throw new InputError('invalid_value', 400, { column: 'mode' })
    if (auth.locked()) throw new InputError('auth_mode_locked', 409)
    // Telegram stored but fallen back at start runs on the password: "password" then cancels the stored Telegram mode,
    // which a restart would otherwise bring back as soon as a manager links Telegram
    const keepPassword = next === 'password' && fallbackOf(auth) !== null
    // it only cancels the stored mode: a new password would skip the current-password check, which the password card asks
    if (keepPassword && field(body, 'password') !== undefined) throw new InputError('invalid_value', 400, { column: 'password' })
    if (auth.mode() === next && !keepPassword) throw new InputError('same_mode', 409)
    if (mode === 'password' && !keepPassword) {
      const refused = await checkCurrent(c, field(body, 'current'))
      if (refused) return refused
    }
    const assertFresh = () => {
      if (auth.generation() !== generation || auth.mode() !== mode || auth.botToken() !== botToken) throw new InputError('unauthorized', 401)
    }
    if (next === 'telegram') {
      if (!botReady()) throw new InputError('no_bot', 409)
      if (!await hasSignInManager(db)) throw new InputError('no_linked_manager', 409)
      const ticket = await readTicket(c)
      if (!ticket) throw new InputError('no_proof', 409)
      if (now() - ticket.approvedAt >= SWITCH_TTL_MS) throw new InputError('proof_expired', 409)
      const { actor } = ticket
      if (!actor.rights.manage) throw new InputError('proof_not_manager', 409, { member: actor.name })
      assertFresh()
      await auth.setMode('telegram', actor)
      deleteCookie(c, SWITCH_COOKIE, { path: '/api/auth-settings' })
      await issueSession(c, auth, config, { userId: actor.userId! })
      return withCookies(c, json({ ok: true }))
    }
    const password = field(body, 'password')
    if (password !== undefined && password !== null && typeof password !== 'string') throw new InputError('invalid_value', 400, { column: 'password' })
    const plan = await planSharedPassword(auth, c.get('actor'), typeof password === 'string' ? { password } : {})
    // from here to COMMIT nothing awaits
    if (auth.generation() !== generation || auth.mode() !== mode) throw new InputError('unauthorized', 401)
    transaction(db.sqlite, () => plan.apply(db.sqlite))
    plan.committed()
    await issueSession(c, auth, config, null)
    return withCookies(c, json({ ok: true }))
  }))
  app.all('/api/auth-settings/mode', notAllowed)

  return app
}
