// The app itself: /api/* on Hono and the hourly run of module tasks. main.ts mounts the static files.
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { allowedHost, authRoutes, createLoginLimiter, requireAuth, sameOrigin, withCookies, type AuthVariables, type LoginLimiter } from './auth'
import { createLoginAttempts, type LoginAttempts } from './loginAttempts'
import type { BotHandle } from './bot/reader'
import { issueSession } from './auth'
import { planSharedPassword, type AuthRuntime } from './authSettings'
import { familyTelegramRoutes } from './familyTelegramRoutes'
import { renameMember } from './memberRename'
import { authSettingsRoutes } from './authSettingsRoutes'
import { moduleEnv, secureCookies, type AppConfig } from './config'
import type { Database, SqliteDatabase } from './db'
import { exportBackup } from './backup'
import { exportCsv } from './exportCsv'
import { RESTORE_MAX_BYTES, restoreBackup, previewBackup, restoreResult, downloadKeptBackup } from './restore'
import { wipeFamilyData } from './wipe'
import { loadDemoData } from './demoData'
import { isLanguage } from '../i18n/languages'
import { deleteRow, insertRow, isReadableTable, revertChange, tableColumns, updateRow } from './rows'
import { errorJson, failureJson, guard, InputError, isApiPath, json, logRequestError, mediaType, notAllowed, readBytes, readJson, requireRight } from './http'
import { routeRight } from './rights'
import { createUser, deleteUser, issueInvite, readUsers, updateUser, type UserRow, type UserRules } from './users'
import { updateAccount, deleteAccount, updateAccountMonth } from './accountOperations'
import { closeMonth, getMonthCloseState, reopenMonth, saveDraft } from './monthClose'
import { closeCatchUp, getCatchUpState } from './catchUp'
import { importHistory, previewHistoryImport, removeImportedHistory } from './historyImport'
import type { AdminRows, DraftRevisionRequest, FamilySettings, SetupRequest, UsersView } from '../domain/api'
import { serverModules, type ServerModule } from '../modules/server'
import { readFamilySettings, saveFamilySetting } from './familySettings'
import { readSetupState, saveSetupState, setupView } from './setup'
import { readAvailability, saveAvailability, removeAvailability } from './availability'
import { getSnapshot } from './snapshot'
import { createUpdateChecker, isBehind } from './updates'

interface AppDeps {
  db: Database
  config: AppConfig
  /** the live sign-in state: mode, password, bot token */
  auth: AuthRuntime
  /** false: the snapshot never downloads rates (a demo sandbox); default true */
  ratesOnline?: boolean
  /** the fetch the update check uses (tests); default the global one */
  updateFetch?: typeof fetch
  /** the login limiter shared by every sign-in route (wrong passwords, bootstrap calls, Telegram starts); default a new one */
  limiter?: LoginLimiter
  /** sign-in attempts through the bot, shared with the bot that approves them; default a new store */
  logins?: LoginAttempts
  /** the bot's reader: its username for deep links and its status for Settings; none — sign-in through Telegram answers bot_not_configured */
  bot?: Pick<BotHandle, 'username' | 'status'>
  /** the fetch the bot token check (getMe) uses (tests); default the global one */
  telegramFetch?: typeof fetch
}

/** actor comes from sign-in */
type Variables = AuthVariables
type App = Hono<{ Variables: Variables }>
type Ctx = Context<{ Variables: Variables }>


/** A module's paths outside /api/ (ServerModule.routes), mounted as they are; a path under /api/ is a programming error. */
function mountModuleRoutes(app: App, m: ServerModule, { db, config, auth, download }: { db: Database; config: AppConfig; auth: AuthRuntime; download: boolean }): void {
  const routes = m.routes?.({ db, config, auth, download })
  if (!routes) return
  for (const path of new Set(routes.routes.map(r => r.path))) {
    if (isApiPath(path)) throw new Error(`module ${m.key}: routes are for paths outside /api/, got ${path}`)
  }
  app.route('/', routes)
}

/** An ISO 4217 code as the snapshot query takes it */
const CURRENCY_CODE = /^[A-Z]{3}$/

/**
 * The security headers of every answer; the demo router uses them too.
 * HSTS only when the site is behind HTTPS (APP_URL https://): over http:// the browser drops the header, and on
 * a local network it is pointless; no includeSubDomains, so sibling sites on subdomains are not affected.
 * CSP: scripts only from the own origin (the theme script is public/theme-init.js, not inline); styles allow
 * 'unsafe-inline' because ECharts tooltips write style attributes into their HTML.
 */
export function appSecureHeaders(config: AppConfig): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    xFrameOptions: 'DENY',
    strictTransportSecurity: secureCookies(config) ? 'max-age=15552000' : false,
  })
}

/** /api/* answers are never cached; the demo router uses it too. */
export const noStore: MiddlewareHandler = async (c, next) => { await next(); c.header('Cache-Control', 'no-store') }

export function createApp({ db, config, auth, ratesOnline = true, updateFetch, limiter = createLoginLimiter(), logins = createLoginAttempts(), bot, telegramFetch }: AppDeps): App {
  const app: App = new Hono()
  const updates = createUpdateChecker({ enabled: config.updateCheck, fetchImpl: updateFetch })
  const demo = config.authMode === 'demo'
  /** the first check of every route that never runs in the public demo */
  const refuseInDemo = () => { if (demo) throw new InputError('not_in_demo', 403) }
  app.use(appSecureHeaders(config))
  // before anything else, the module routes and the static files included
  app.use(allowedHost(config, auth))
  // the modules of this installation: in the demo, without those that would reach outside the sandbox
  const modules = serverModules({ demo })
  // module paths outside /api/ (no sign-in: Claude calls them server to server), ahead of the SPA fallback main.ts mounts
  for (const m of modules) mountModuleRoutes(app, m, { db, config, auth, download: ratesOnline })
  app.use('/api/*', noStore)

  app.get('/api/health', async c => {
    try { await db.prepare('SELECT 1').first(); return c.json({ ok: true }) } catch { return c.json({ ok: false }, 503) }
  })
  // the Origin check runs before sign-in: it also covers /api/auth/login and /api/auth/logout
  app.use('/api/*', sameOrigin())
  app.route('/', authRoutes(config, {
    db, auth, limiter, logins, botUsername: () => bot?.username() ?? null, familyLanguage: async () => (await readFamilySettings(db)).language, familySetup: () => readSetupState(db),
  }))
  // everything registered below this line is behind sign-in (and, for writes, behind routeRight)
  app.use('/api/*', requireAuth(config, db, auth))
  // the right the route needs; a module's own writes are checked by the module
  app.use('/api/*', async (c, next) => {
    const right = routeRight(c.req.method, c.req.path)
    if (right && !c.get('actor').rights[right]) return errorJson(`no_right_${right}`, 403)
    await next()
  })
  // the sign-in settings (Settings → Family and access) need a node:sqlite database: the switch writes in one transaction
  if ('sqlite' in db) app.route('/', authSettingsRoutes({ db: db as SqliteDatabase, config, auth, bot, limiter, telegramFetch }))

  if (!demo) app.route('/', familyTelegramRoutes({ db, auth, botUsername: () => bot?.username() ?? null }))
  app.post('/api/members/:rowid/rename', c => guard(c.req, { tag: 'member-rename', conflict: 'data_conflict' }, async () => json(await renameMember(db, Number(c.req.param('rowid')), await readJson(c.req.raw), c.get('actor')))))

  // the modules' own paths under /api/; one that is not here answers 404 below
  app.use('/api/*', async (c, next) => {
    const url = new URL(c.req.url)
    for (const m of modules) {
      const response = await m.api?.(c.req.raw, { db, env: moduleEnv(config, auth), auth, actor: c.get('actor'), url, download: ratesOnline })
      if (response) return response
    }
    await next()
  })

  // the running version and the latest published one (null when the check is off or the registry did not answer)
  app.get('/api/version', async c => {
    const latest = await updates.latest()
    return c.json({ version: config.appVersion, latest, behind: isBehind(config.appVersion, latest) })
  })
  app.all('/api/version', notAllowed)

  app.get('/api/snapshot', c => {
    // a malformed code is ignored: the snapshot falls back as for a currency outside the project
    const requested = c.req.query('currency')
    const currency = requested !== undefined && CURRENCY_CODE.test(requested) ? requested : undefined
    return guard(c.req, { tag: 'snapshot', failure: 'load_failed' }, () => getSnapshot(db, { currency, download: ratesOnline }))
  })
  app.all('/api/snapshot', notAllowed)

  app.get('/api/availability', c => guard(c.req, { tag: 'availability', failure: 'load_failed' }, async () => ({ assessments: await readAvailability(db) })))
  app.put('/api/availability', c => guard(c.req, { tag: 'availability' }, async () => saveAvailability(db, c.get('actor'), await readJson(c.req.raw))))
  app.delete('/api/availability', c => guard(c.req, { tag: 'availability' }, async () => removeAvailability(db, c.get('actor'), await readJson(c.req.raw))))
  app.all('/api/availability', notAllowed)

  // the database copy as one file; test stubs without node:sqlite cannot make it, which is a server error, not a request error
  // the file holds the sign-in secrets (bot token, password hash, token hashes): managers only. routeRight() lets every
  // GET through, so the right is checked here. Hono dispatches HEAD to the GET handler and drops the body, which would
  // leave the streamed copy's temp folder behind: HEAD is refused before a copy is made
  app.get('/api/backup', c => c.req.method === 'HEAD' ? notAllowed() : guard(c.req, { tag: 'backup', failure: 'backup_failed' }, () => {
    requireRight(c.get('actor'), 'manage')
    // each copy is a whole database file in /tmp: in the demo, anyone could fill it
    refuseInDemo()
    if (!('sqlite' in db)) throw new Error('backup needs a node:sqlite database')
    return exportBackup(db as SqliteDatabase)
  }))
  app.all('/api/backup', notAllowed)

  app.post('/api/backup/preview', c => guard(c.req, { tag: 'restore-preview', failure: 'restore_failed' }, async () => {
    requireRight(c.get('actor'), 'manage')
    refuseInDemo()
    if (!('sqlite' in db)) throw new Error('preview needs a node:sqlite database')
    if (mediaType(c.req.raw) !== 'application/octet-stream') throw new InputError('backup_media_type', 415)
    const bytes = await readBytes(c.req.raw, RESTORE_MAX_BYTES, 'backup_too_large')
    return previewBackup(db as SqliteDatabase, bytes, config.schemaFile)
  }))
  app.all('/api/backup/preview', notAllowed)
  app.get('/api/backup/result', c => guard(c.req, { tag: 'restore-result', failure: 'load_failed' }, async () => {
    requireRight(c.get('actor'), 'manage')
    refuseInDemo()
    return restoreResult(db as SqliteDatabase)
  }))
  app.all('/api/backup/result', notAllowed)
  app.get('/api/backup/kept/:name', c => c.req.method === 'HEAD' ? notAllowed() : guard(c.req, { tag: 'restore-download', failure: 'backup_failed' }, () => {
    requireRight(c.get('actor'), 'manage')
    refuseInDemo()
    return downloadKeptBackup(config.dataDir, c.req.param('name'))
  }))
  app.all('/api/backup/kept/:name', notAllowed)

  // replaces all the family's data with an uploaded backup file; never inside the public demo
  app.post('/api/backup/restore', c => guard(c.req, { tag: 'restore', failure: 'restore_failed' }, async () => {
    refuseInDemo()
    if (!('sqlite' in db)) throw new Error('restore needs a node:sqlite database')
    if (mediaType(c.req.raw) !== 'application/octet-stream') throw new InputError('backup_media_type', 415)
    const bytes = await readBytes(c.req.raw, RESTORE_MAX_BYTES, 'backup_too_large')
    return restoreBackup(db as SqliteDatabase, bytes, { schemaFile: config.schemaFile, dataDir: config.dataDir, actor: c.get('actor'), now: new Date() })
  }))
  app.all('/api/backup/restore', notAllowed)

  // deletes all the family's data (Backup → Danger zone); the body must say { confirm: true }; never inside the public demo
  app.post('/api/wipe', c => guard(c.req, { tag: 'wipe' }, async () => {
    refuseInDemo()
    if (!('sqlite' in db)) throw new Error('wipe needs a node:sqlite database')
    const body = await readJson(c.req.raw) as { confirm?: unknown } | null
    if (body?.confirm !== true) throw new InputError('confirm_required', 400)
    await wipeFamilyData(db as SqliteDatabase, c.get('actor'), new Date())
    return { wiped: true }
  }))
  app.all('/api/wipe', notAllowed)

  // replaces the family with the fictional one (Danger zone, the first-run wizard) and switches to the shared family
  // password; every refusal of the password plan comes before anything is deleted; never inside the public demo
  app.post('/api/demo-data', c => guard(c.req, { tag: 'demo-data' }, async () => {
    refuseInDemo()
    if (!('sqlite' in db)) throw new Error('demo data needs a node:sqlite database')
    // the session was checked on arrival; a password change or a switch committed while this request awaited (a held
    // body, the scrypt) revoked it, so the load is refused rather than run on a dead session
    const generation = auth.generation()
    const mode = auth.mode()
    const body = await readJson(c.req.raw) as { confirm?: unknown; language?: unknown; password?: unknown } | null
    if (body?.confirm !== true) throw new InputError('confirm_required', 400)
    if (body.language !== undefined && !isLanguage(body.language)) throw new InputError('invalid_language', 400)
    const password = body.password ?? undefined
    if (password !== undefined && typeof password !== 'string') throw new InputError('invalid_value', 400, { column: 'password' })
    const language = body.language ?? (await readFamilySettings(db)).language
    const actor = c.get('actor')
    // a password already stored in the app is kept: replacing it takes the current one (Settings → Family and access), so a body
    // password is dropped here.
    const given = typeof password === 'string' && auth.passwordSource() !== 'app' ? { password } : {}
    const plan = mode === 'none' ? null : await planSharedPassword(auth, actor, given)
    // from here to COMMIT nothing awaits
    if (auth.generation() !== generation || auth.mode() !== mode) throw new InputError('unauthorized', 401)
    const result = loadDemoData(db as SqliteDatabase, { language, actor, now: new Date(), plan })
    plan?.committed()
    // the data is committed before the cookie is issued; issueSession throws only without a session secret
    if (mode !== 'none') await issueSession(c, auth, config, null)
    return withCookies(c, json(result))
  }))
  app.all('/api/demo-data', notAllowed)

  app.get('/api/export/csv', c => guard(c.req, { tag: 'export', failure: 'export_failed' }, () => exportCsv(db)))
  app.all('/api/export/csv', notAllowed)

  app.get('/api/settings', c => guard(c.req, { tag: 'settings', failure: 'load_failed' }, () => readFamilySettings(db)))
  app.put('/api/settings', c => guard(c.req, { tag: 'settings' }, async () => saveFamilySetting(db, await readJson(c.req.raw) as Partial<FamilySettings>, c.get('actor'))))
  app.all('/api/settings', notAllowed)
  // the first-run wizard flag: any signed-in person reads it, a manager writes it; never inside the public demo
  app.get('/api/setup', c => guard(c.req, { tag: 'setup', failure: 'load_failed' }, () => setupView(db, new Date())))
  app.put('/api/setup', c => guard(c.req, { tag: 'setup' }, async () => {
    refuseInDemo()
    return saveSetupState(db, (await readJson(c.req.raw) as SetupRequest | null)?.state, c.get('actor'))
  }))
  app.all('/api/setup', notAllowed)


  const userView = (u: UserRow) => ({
    id: u.id, member: u.member, telegram: u.telegramName ?? u.telegramId, invitePending: u.invitePending, rights: u.rights,
    // bound to the configured provider: an identity of an older OIDC_ISSUER does not sign in
    identity: !!config.oidc && u.identity?.issuer === config.oidc.issuer,
  })
  const usersView = async (c: Ctx): Promise<UsersView> => ({
    mode: demo ? 'demo' : auth.mode(),
    // no reader (no token, or the demo): the token alone says "configured"
    bot: bot?.status() ?? { configured: !!auth.botToken(), username: null, problem: null },
    users: (await readUsers(db)).map(userView),
    meId: c.get('actor').userId,
  })
  const userRules = (): UserRules => ({ mode: demo ? 'demo' : auth.mode(), link: demo ? null : auth.signInLink() })
  const userId = (c: Ctx) => Number(c.req.param('id'))
  app.get('/api/users', c => guard(c.req, { tag: 'users', failure: 'load_failed' }, () => usersView(c)))
  app.post('/api/users', c => guard(c.req, { tag: 'users' }, async () => {
    await createUser(db, await readJson(c.req.raw), c.get('actor'))
    return usersView(c)
  }))
  app.all('/api/users', notAllowed)
  app.put('/api/users/:id{[0-9]+}', c => guard(c.req, { tag: 'users' }, async () => {
    await updateUser(db, userId(c), await readJson(c.req.raw), c.get('actor'), userRules())
    return usersView(c)
  }))
  app.delete('/api/users/:id{[0-9]+}', c => guard(c.req, { tag: 'users' }, async () => {
    await deleteUser(db, userId(c), c.get('actor'), userRules())
    return usersView(c)
  }))
  app.all('/api/users/:id{[0-9]+}', notAllowed)
  app.post('/api/users/:id{[0-9]+}/invite', c => guard(c.req, { tag: 'users' }, async () => {
    const username = bot?.username()
    if (!username) throw new InputError('bot_not_configured', 409)
    return issueInvite(db, userId(c), username)
  }))
  app.all('/api/users/:id{[0-9]+}/invite', notAllowed)

  app.post('/api/admin/change_log/:id{[0-9]+}/revert', c =>
    guard(c.req, { tag: 'admin', conflict: 'data_conflict' }, () => revertChange(db, Number(c.req.param('id')), c.get('actor'))))
  app.all('/api/admin/change_log/:id{[0-9]+}/revert', notAllowed)

  app.post('/api/accounts/update', c => guard(c.req, { tag: 'accounts', conflict: 'data_conflict' }, async () => updateAccount(db, c.get('actor'), await readJson(c.req.raw))))
  app.all('/api/accounts/update', notAllowed)
  app.post('/api/accounts/delete', c => guard(c.req, { tag: 'accounts', conflict: 'data_conflict' }, async () => deleteAccount(db, c.get('actor'), await readJson(c.req.raw))))
  app.all('/api/accounts/delete', notAllowed)
  app.post('/api/accounts/month', c => guard(c.req, { tag: 'accounts', conflict: 'data_conflict' }, async () => updateAccountMonth(db, c.get('actor'), await readJson(c.req.raw))))
  app.all('/api/accounts/month', notAllowed)

  const monthClose = (c: Ctx, run: () => Promise<unknown>) => guard(c.req, { tag: 'month-close', conflict: 'month_conflict' }, run)
  app.get('/api/month-close', c => monthClose(c, () => getMonthCloseState(db, new Date())))
  app.all('/api/month-close', notAllowed)
  // wrapped: a bare null body reads as a failed load on the client
  app.get('/api/month-close/catch-up', c => monthClose(c, async () => ({ grid: await getCatchUpState(db, new Date()) })))
  app.post('/api/month-close/catch-up', c => monthClose(c, async () => closeCatchUp(db, await readJson(c.req.raw, 512 * 1024), c.get('actor'), new Date())))
  app.all('/api/month-close/catch-up', notAllowed)
  app.put('/api/month-close/:month/draft', c => monthClose(c, async () => saveDraft(db, c.req.param('month'), await readJson(c.req.raw, 512 * 1024), new Date())))
  app.post('/api/month-close/:month/close', c => monthClose(c, async () => closeMonth(db, c.req.param('month'), await readJson(c.req.raw) as DraftRevisionRequest, c.get('actor'), new Date())))
  // the months before the wizard from a spreadsheet: a dry run, the import, and removing every imported month; never inside the public demo
  const HISTORY_MAX_BYTES = 2 * 1024 * 1024
  app.post('/api/month-close/history/preview', c => monthClose(c, async () => {
    // refused before the 2 MB body is read: stalled uploads of it could fill the shared demo server's memory
    refuseInDemo()
    return previewHistoryImport(db, await readJson(c.req.raw, HISTORY_MAX_BYTES), new Date())
  }))
  app.post('/api/month-close/history', c => monthClose(c, async () => {
    refuseInDemo()
    return importHistory(db, await readJson(c.req.raw, HISTORY_MAX_BYTES), c.get('actor'), new Date())
  }))
  app.delete('/api/month-close/history', c => monthClose(c, async () => {
    refuseInDemo()
    return removeImportedHistory(db, c.get('actor'), new Date())
  }))
  app.all('/api/month-close/history/preview', notAllowed)
  app.all('/api/month-close/history', notAllowed)
  app.post('/api/month-close/:month/reopen', c => monthClose(c, () => reopenMonth(db, c.req.param('month'), c.get('actor'), new Date())))
  app.all('/api/month-close/:month/:action{(?:draft|close|reopen)}', notAllowed)

  app.all('/api/admin/:table/:rowid?', async c => {
    const table = c.req.param('table')
    const rowidParam = c.req.param('rowid')
    const rowid = rowidParam === undefined ? null : Number(rowidParam)
    if (rowid !== null && (!/^\d+$/.test(rowidParam ?? '') || !Number.isSafeInteger(rowid) || rowid <= 0)) return errorJson('invalid_row_id', 400)
    if (!isReadableTable(table)) return errorJson('table_not_found', 400)
    const method = c.req.method
    const actor = c.get('actor')
    return guard(c.req, { tag: 'admin', conflict: 'data_conflict', failure: method === 'GET' ? 'load_failed' : 'save_failed' }, async () => {
      if (method === 'GET' && rowid === null) {
        const limit = table === 'change_log' ? ' LIMIT 100' : ''
        const [dataResult, columns] = await Promise.all([
          db.prepare(`SELECT *, rowid FROM ${table} ORDER BY rowid DESC${limit}`).all(),
          tableColumns(db, table),
        ])
        const page: AdminRows<Record<string, unknown>> = { rows: dataResult.results, columns: columns.map(col => col.name) }
        return json(page)
      }
      // a read-only table gets its 403 from rows.ts
      if (method === 'POST' && rowid === null) return insertRow(db, table, await readJson(c.req.raw), actor)
      if (method === 'PUT' && rowid !== null) return updateRow(db, table, rowid, await readJson(c.req.raw), actor)
      if (method === 'DELETE' && rowid !== null) { await deleteRow(db, table, rowid, actor); return { deleted: true } }
      return notAllowed()
    })
  })

  // safety net: an exception no route caught becomes JSON without the error text, not Hono's plain 500
  app.onError((err, c) => {
    logRequestError(c.req, 'app', err)
    return failureJson(err, 'load_failed')
  })
  app.notFound(c => (isApiPath(c.req.path) ? errorJson('not_found', 404) : c.text('Not found', 404)))
  return app
}

/** SIGHUP: every module's onNudge (the family server only); one failing does not stop the others. */
export async function nudgeModules({ db, config, auth }: { db: Database; config: AppConfig; auth: AuthRuntime }): Promise<void> {
  const modules = serverModules({ demo: false })
  const results = await Promise.allSettled(modules.map(async m => m.onNudge?.({ db, env: moduleEnv(config, auth), auth })))
  // only the module key: a Telegram error may carry the bot token in its URL
  results.forEach((r, i) => { if (r.status === 'rejected') console.error('[nudge]', modules[i].key, 'failed') })
}

/** Hourly: the modules' tasks (the family server only: the demo has no timer); one failing does not stop the others. */
export async function runScheduledModules({ db, config, auth }: { db: Database; config: AppConfig; auth: AuthRuntime }): Promise<void> {
  const modules = serverModules({ demo: false })
  const results = await Promise.allSettled(modules.map(async m => m.scheduled?.({ db, env: moduleEnv(config, auth), auth })))
  // only the module key: a Telegram error may carry the bot token in its URL
  results.forEach((r, i) => { if (r.status === 'rejected') console.error('[scheduled]', modules[i].key, 'failed') })
}
