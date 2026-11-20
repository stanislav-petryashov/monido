// The parts of the Telegram stand (scripts/telegramStand.ts) that do not listen on a port: where Bot API calls go, the
// server's environment, the family with a proposal in each state, the sign-in cookie. Development only: nothing here
// is part of the built server, and the stand never reads .env, so the real bot token stays out of it.
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { serializeSigned } from 'hono/utils/cookie'
import { buildFamily } from '../src/demo/family'
import { advisorContext, type Scenario } from '../src/domain/advisor'
import { evaluate } from '../src/domain/advisorImpact'
import { isoDate } from '../src/domain/dates'
import { deliverPending } from '../src/modules/advisor/council/delivery'
import { castVote, expireDue, propose, revise, withdraw, type SendInput } from '../src/modules/advisor/council/store'
import { actorOfUser } from '../src/server/auth'
import type { AuthRuntime } from '../src/server/authSettings'
import { openDatabase } from '../src/server/db'
import { writeFamily } from '../src/server/demo/writeFamily'
import { ensureRates } from '../src/server/fx'
import { initializeSchema } from '../src/server/schema'
import { getSnapshot } from '../src/server/snapshot'

const TELEGRAM = 'https://api.telegram.org/'
const STAND_TOKEN = '123:stand'
const STAND_BOT = 'family_finance_stand_bot'
const SESSION_TTL_SEC = 60 * 60 * 24

/** The voters, the first of them the family's manager. */
export const STAND_MEMBERS = [
  { member: 'Ryan', telegramId: '4242' },
  { member: 'Annika', telegramId: '4243' },
  { member: 'Mila', telegramId: '4244' },
] as const

/** A message the stand's own bot was asked to send or change: its text, and no token. */
export interface StandSent { method: string; chatId: string; text: string }

function offlineAnswer(method: string, body: Record<string, unknown>, nextId: () => number): unknown {
  switch (method) {
    case 'getMe': return { id: 1, is_bot: true, first_name: 'Monido stand', username: STAND_BOT }
    case 'sendMessage': return { message_id: nextId(), date: Math.floor(Date.now() / 1000), chat: { id: Number(body.chat_id), type: 'private' } }
    default: return true
  }
}

/** A long poll with nobody to hear: nothing arrives, so it waits out its timeout; an abort rejects, as a real request does. */
function emptyPoll(timeoutSec: number, signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(Response.json({ ok: true, result: [] })), timeoutSec * 1000)
    timer.unref?.()
    const stop = () => {
      clearTimeout(timer)
      reject(new DOMException('The operation was aborted', 'AbortError'))
    }
    if (signal?.aborted) stop()
    else signal?.addEventListener('abort', stop, { once: true })
  })
}

/**
 * The fetch of the stand. Calls to Telegram go to a bot in this process that says yes to everything and tells `onSend`;
 * every other address goes to `real`. Nothing reaches the real Telegram.
 */
export function standFetch(real: typeof fetch, { onSend }: { onSend?: (m: StandSent) => void } = {}): typeof fetch {
  let lastId = 500
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.startsWith(TELEGRAM)) return real(input, init)
    const method = url.slice(url.lastIndexOf('/') + 1)
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
    if (method === 'getUpdates') return emptyPoll(Number(body.timeout) || 0, init?.signal)
    if (typeof body.text === 'string' && body.chat_id !== undefined) onSend?.({ method, chatId: String(body.chat_id), text: body.text })
    return Response.json({ ok: true, result: offlineAnswer(method, body, () => ++lastId) })
  }
}

/** The server's whole environment, built from nothing but `dataDir`: what the shell or .env hold does not get in. */
export const standEnv = (dataDir: string): Record<string, string> => ({
  TELEGRAM_BOT_TOKEN: STAND_TOKEN,
  DATA_DIR: dataDir,
  HOST: '127.0.0.1',
  PORT: '8080',
  UPDATE_CHECK: 'off',
})

/** A session of `userId` as the server's sign-in sets it, without a trip through the bot. */
export const standCookie = (auth: Pick<AuthRuntime, 'signingKey'>, userId: number): Promise<string> =>
  serializeSigned('session', `${userId}.${Date.now()}`, auth.signingKey(), { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: SESSION_TTL_SEC })

const CAR: Scenario = { kind: 'credit', amount: 30000, currency: 'USD', termMonths: 60, ratePct: 9, downPayment: 5000, loanType: 'consumer' }
const BOAT: Scenario = { kind: 'credit', amount: 400000, currency: 'USD', termMonths: 12, ratePct: 20, downPayment: 0, loanType: 'consumer' }
/** The second version of the boat: a smaller one, so a smaller loan */
const SMALL_BOAT: Scenario = { ...BOAT, amount: 150000 }
const SOFA: Scenario = { kind: 'buy_now', amount: 1500, currency: 'USD' }
const SCHOOL: Scenario = { kind: 'save_up', amount: 12000, currency: 'USD', targetMonth: '2030-08' }

export type StandScenarioKey = 'open' | 'partly' | 'revising' | 'second' | 'accepted' | 'withdrawn' | 'expired'
export interface StandScenario { key: StandScenarioKey; id: number; title: string }

/** Long enough ago that any deadline the settings can give has passed. */
const EXPIRED_AGO_MS = 120 * 24 * 60 * 60 * 1000

/**
 * Replaces `dataDir` with the demo family: every module on, three voters with linked Telegram, the reminders pointed at
 * the manager's chat, one proposal in each state made through the council's own store, and their messages delivered
 * through `fetchImpl`. `dataDir` is deleted first: pass only a directory of the stand. `userIds` follow STAND_MEMBERS.
 */
export async function prepareStand(dataDir: string, schemaFile: string, now: Date, fetchImpl: typeof fetch): Promise<{ scenarios: StandScenario[]; userIds: number[] }> {
  rmSync(dataDir, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })
  const db = openDatabase(join(dataDir, 'finance.sqlite'))
  try {
    initializeSchema(db, schemaFile)
    const today = isoDate(now)
    writeFamily(db.sqlite, buildFamily({ today }))
    db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('auth_mode', 'telegram')")
    const third = STAND_MEMBERS[2].member
    db.sqlite.prepare('INSERT INTO members (name) VALUES (?)').run(third)
    db.sqlite.prepare('INSERT INTO users (member, can_edit, can_vote, can_manage, created_at, updated_at) VALUES (?, 0, 1, 0, ?, ?)')
      .run(third, `${today}T00:00:00.000Z`, `${today}T00:00:00.000Z`)
    for (const { member, telegramId } of STAND_MEMBERS) db.sqlite.prepare('UPDATE users SET telegram_id = ? WHERE member = ?').run(telegramId, member)
    db.sqlite.prepare('UPDATE reminder_settings SET chat_id = ?, chat_title = ? WHERE id = 1').run(STAND_MEMBERS[0].telegramId, STAND_MEMBERS[0].member)

    const ids = STAND_MEMBERS.map(({ member }) => (db.sqlite.prepare('SELECT id FROM users WHERE member = ?').get(member) as { id: number }).id)
    const actors = await Promise.all(ids.map(async id => {
      const actor = await actorOfUser(db, id, now.getTime(), { method: 'telegram' }, 'mcp')
      if (!actor) throw new Error(`user ${id} is not linked`)
      return actor
    }))
    const [ryan, annika] = actors

    const snapshot = await getSnapshot(db, { now, download: false })
    const context = advisorContext(snapshot, now)
    const fx = await ensureRates(db, [today], ['USD'], today, null)
    const input = (scenario: Scenario, title: string, question: string): SendInput => {
      const evaluation = evaluate(context, scenario, fx.lookup(today))
      const risk = evaluation.impact.risk === 'unknown' ? 'risky' : evaluation.impact.risk
      return { scenario, baseCurrency: 'USD', evaluation, title, question, verdict: { risk, recommended: null, reason: 'Claude weighed the plan against the family budget.' } }
    }
    const agree = (versionId: number, who: number, comment: string | null = null) =>
      castVote(db, versionId, ids[who], 'agree', { settle: 'now', comment, by: 'button' }, actors[who], now)
    const against = (versionId: number, who: number, comment: string) =>
      castVote(db, versionId, ids[who], 'against', { settle: 'now', comment, by: 'button' }, actors[who], now)

    const scenarios: StandScenario[] = []
    const add = (key: StandScenarioKey, view: { id: number; current: { title: string } }) => scenarios.push({ key, id: view.id, title: view.current.title })

    // made in the past, so that its deadline has passed; every other proposal is made now and is not touched by expireDue
    const expired = await propose(db, input(SOFA, 'A new sofa', 'Nobody answered this one in time.'), ryan, new Date(now.getTime() - EXPIRED_AGO_MS))
    await expireDue(db, now)
    add('expired', expired)

    add('open', await propose(db, input(CAR, 'A car on credit', 'Shall we buy the family car?'), ryan, now))

    const partly = await propose(db, input(SCHOOL, 'Saving for school', 'Annika has agreed; Mila still has to answer.'), ryan, now)
    await agree(partly.current.id, 1, 'Good idea, let us start next month')
    add('partly', partly)

    const revising = await propose(db, input(BOAT, 'A boat on credit', 'Shall we buy the boat?'), ryan, now)
    await against(revising.current.id, 1, 'Too expensive for us right now')
    add('revising', revising)

    const first = await propose(db, input(BOAT, 'A bigger boat', 'The first version, sent back.'), ryan, now)
    await against(first.current.id, 2, 'Please look for something smaller')
    add('second', await revise(db, first.id, input(SMALL_BOAT, 'A smaller boat', 'The second version, with a smaller loan.'), ryan, now))

    const accepted = await propose(db, input(SOFA, 'A new armchair', 'Everybody agreed to this one.'), annika, now)
    await agree(accepted.current.id, 0)
    await agree(accepted.current.id, 2, 'Yes, please')
    add('accepted', accepted)

    add('withdrawn', await withdraw(db, (await propose(db, input(CAR, 'A second car', 'The author took this one back.'), ryan, now)).id, ryan, now))

    await deliverPending(db, { TELEGRAM_BOT_TOKEN: STAND_TOKEN }, now, fetchImpl)
    return { scenarios, userIds: ids }
  } finally {
    db.close()
  }
}
