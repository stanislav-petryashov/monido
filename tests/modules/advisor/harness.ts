import { buildFamily } from '../../../src/demo/family'
import { isoDate } from '../../../src/domain/dates'
import { createApp } from '../../../src/server/app'
import { writeFamily } from '../../../src/server/demo/writeFamily'
import { createTestDb, testConfig } from '../../helpers/db'
import { authFor } from '../../helpers/auth'
import { FAMILY_PASSWORD, familyCookie, userCookie, withCookie } from '../../helpers/session'

const HEADERS = { 'Content-Type': 'application/json' }

/**
 * The demo family with the advisor on and the HTTP tool route `POST /api/advisor/tools/:name`.
 * Default: password mode (the actor has no user id). `viewOnly` / `telegram`: Telegram mode with every user linked;
 * `viewOnly` also drops the edit right, and `callAs` sends a request as a given user.
 * @public
 */
export function advisorHarness(opts: { viewOnly?: boolean; telegram?: boolean } = {}) {
  const { viewOnly = false, telegram = false } = opts
  const tg = viewOnly || telegram
  const db = createTestDb()
  writeFamily(db.sqlite, buildFamily({ today: isoDate(new Date()) }))
  const config = tg ? testConfig({ mode: 'telegram', TELEGRAM_BOT_TOKEN: '1:x' }, 'secret') : testConfig({ password: FAMILY_PASSWORD }, 'secret')
  const auth = authFor(config)
  if (tg) db.sqlite.exec(`UPDATE users SET telegram_id = 'tg' || id${viewOnly ? ', can_edit = 0' : ''}`)
  const userId = (db.sqlite.prepare('SELECT MIN(id) AS id FROM users').get() as { id: number }).id
  const raw = createApp({ db, config, auth, ratesOnline: false })
  const app = withCookie(raw, () => tg ? userCookie(auth, userId) : familyCookie(auth))
  const post = (target: { request: typeof raw.request }, tool: string, body: unknown, headers: Record<string, string> = {}) =>
    target.request(`/api/advisor/tools/${tool}`, { method: 'POST', headers: { ...HEADERS, ...headers }, body: JSON.stringify(body) })
  const call = (tool: string, body: unknown = {}) => post(app, tool, body)
  const callAs = async (as: number, tool: string, body: unknown = {}) => post(raw, tool, body, { Cookie: await userCookie(auth, as) })
  const result = async <T>(tool: string, body?: unknown) => {
    const res = await call(tool, body)
    expect(res.status).toBe(200)
    return (await res.json() as { result: T }).result
  }
  const failure = async (tool: string, body?: unknown) => {
    const res = await call(tool, body)
    return [res.status, await res.json()] as const
  }
  return { db, call, callAs, result, failure }
}
