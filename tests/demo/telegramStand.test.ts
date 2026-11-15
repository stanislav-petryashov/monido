import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AuthRuntime } from '../../src/server/authSettings'
import { openDatabase } from '../../src/server/db'
import { startServer } from '../../src/server/main'
import type { RunningServer } from '../../src/server/listen'
import { prepareStand, standCookie, standEnv, standFetch, STAND_MEMBERS, type StandSent } from '../../scripts/telegramStandLib'
import { SCHEMA_FILE } from '../helpers/db'

const TOKEN_URL = 'https://api.telegram.org/bot123:stand'
const post = (body: unknown = {}, signal?: AbortSignal): RequestInit =>
  ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })

const dirs: string[] = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'telegram-stand-'))
  dirs.push(dir)
  return dir
}
let server: RunningServer | null = null
afterEach(async () => {
  await server?.stop()
  server = null
  vi.unstubAllGlobals()
  noNetwork.mockClear()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** No real fetch is expected: a call that reaches it fails the test. */
const noNetwork = vi.fn<typeof fetch>(() => { throw new Error('reached the network') })
const bot = (sent: StandSent[] = []) => standFetch(noNetwork, { onSend: m => sent.push(m) })

describe('standFetch', () => {
  it('leaves every other address alone', async () => {
    const real = vi.fn<typeof fetch>(async () => new Response('rates'))
    await standFetch(real)('https://example.com/rates')
    expect(real.mock.calls.map(c => c[0])).toEqual(['https://example.com/rates'])
  })

  it('answers the bot itself and never reaches Telegram', async () => {
    const sent: StandSent[] = []
    const fake = bot(sent)
    const me = await (await fake(`${TOKEN_URL}/getMe`, post())).json() as { result: { username: string } }
    expect(me.result.username).toBe('family_finance_stand_bot')
    const ids: number[] = []
    for (const text of ['one', 'two']) {
      const answer = await (await fake(`${TOKEN_URL}/sendMessage`, post({ chat_id: '4243', text }))).json() as { result: { message_id: number } }
      ids.push(answer.result.message_id)
    }
    expect(ids[1]).toBeGreaterThan(ids[0])
    expect(sent).toEqual([{ method: 'sendMessage', chatId: '4243', text: 'one' }, { method: 'sendMessage', chatId: '4243', text: 'two' }])
    // a popup over the button goes to no chat: it is not a message of anybody's
    expect(await (await fake(`${TOKEN_URL}/answerCallbackQuery`, post({ callback_query_id: '1', text: 'Saved' }))).json()).toEqual({ ok: true, result: true })
    expect(sent).toHaveLength(2)
    expect(noNetwork).not.toHaveBeenCalled()
  })

  it('lets a long poll wait for its timeout, then answers no updates', async () => {
    vi.useFakeTimers()
    try {
      let answered = false
      const poll = bot()(`${TOKEN_URL}/getUpdates`, post({ timeout: 25 })).then(r => { answered = true; return r.json() })
      await vi.advanceTimersByTimeAsync(24_000)
      expect(answered).toBe(false)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(await poll).toEqual({ ok: true, result: [] })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects an aborted long poll, as a real request does', async () => {
    const abort = new AbortController()
    const poll = bot()(`${TOKEN_URL}/getUpdates`, post({ timeout: 25 }, abort.signal))
    abort.abort()
    await expect(poll).rejects.toThrow()
  })
})

describe('standEnv', () => {
  it('is built from nothing but its arguments: the real token of the environment stays out', () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'real-token')
    vi.stubEnv('SESSION_SECRET', 'a real secret that must not be taken over')
    try {
      const env = standEnv('/some/dir')
      expect(env.TELEGRAM_BOT_TOKEN).toBe('123:stand')
      expect(env.AUTH_MODE).toBeUndefined()
      expect(env.DATA_DIR).toBe('/some/dir')
      expect(env.HOST).toBe('127.0.0.1')
      expect(env.SESSION_SECRET).toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('prepareStand', () => {
  const NOW = new Date()
  const prepare = (dir: string, sent: StandSent[] = []) => prepareStand(dir, SCHEMA_FILE, NOW, bot(sent))

  it('starts from an empty directory: what an earlier run left is gone', async () => {
    const dir = scratch()
    await prepare(dir)
    writeFileSync(join(dir, 'left-over'), 'x')
    await prepare(dir)
    expect(existsSync(join(dir, 'left-over'))).toBe(false)
  })

  it('links the three voters and leaves one proposal in each state', async () => {
    const dir = scratch()
    const { scenarios } = await prepare(dir)
    const db = openDatabase(join(dir, 'finance.sqlite'))
    try {
      const users = db.sqlite.prepare('SELECT member, telegram_id, can_vote, can_edit, can_manage FROM users ORDER BY id').all()
      expect(users).toEqual([
        { member: STAND_MEMBERS[0].member, telegram_id: STAND_MEMBERS[0].telegramId, can_vote: 1, can_edit: 1, can_manage: 1 },
        { member: STAND_MEMBERS[1].member, telegram_id: STAND_MEMBERS[1].telegramId, can_vote: 1, can_edit: 1, can_manage: 0 },
        { member: STAND_MEMBERS[2].member, telegram_id: STAND_MEMBERS[2].telegramId, can_vote: 1, can_edit: 0, can_manage: 0 },
      ])
      const rows = db.sqlite.prepare('SELECT id, status, version FROM proposals').all() as { id: number; status: string; version: number }[]
      const row = (key: string) => rows.find(r => r.id === scenarios.find(s => s.key === key)?.id)
      expect(row('open')).toMatchObject({ status: 'open', version: 1 })
      expect(row('partly')).toMatchObject({ status: 'open', version: 1 })
      expect(row('revising')).toMatchObject({ status: 'revising', version: 1 })
      expect(row('second')).toMatchObject({ status: 'open', version: 2 })
      expect(row('accepted')).toMatchObject({ status: 'accepted' })
      expect(row('withdrawn')).toMatchObject({ status: 'withdrawn' })
      expect(row('expired')).toMatchObject({ status: 'expired' })
      expect(rows).toHaveLength(scenarios.length)
    } finally {
      db.close()
    }
  })

  it('delivers the cards to every voter through the given fetch', async () => {
    const sent: StandSent[] = []
    const dir = scratch()
    await prepare(dir, sent)
    for (const { telegramId } of STAND_MEMBERS) expect(sent.filter(m => m.chatId === telegramId).length).toBeGreaterThan(0)
    const db = openDatabase(join(dir, 'finance.sqlite'))
    try {
      expect(db.sqlite.prepare("SELECT count(*) AS n FROM proposal_messages WHERE state = 'failed'").get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })
})

describe('the stand server', () => {
  it('signs a member in with standCookie and shows them the proposals', async () => {
    const dir = scratch()
    const toServer = globalThis.fetch
    // stays in place while the server runs: its bot must never find the real Telegram
    vi.stubGlobal('fetch', bot())
    const { userIds } = await prepareStand(dir, SCHEMA_FILE, new Date(), fetch)
    let auth: AuthRuntime | undefined
    server = await startServer({ ...standEnv(dir), PORT: '0', SCHEMA_FILE }, a => { auth = a })
    const url = `http://127.0.0.1:${server.port}`
    expect((await toServer(`${url}/api/advisor/proposals`)).status).toBe(401)
    const cookie = await standCookie(auth as AuthRuntime, userIds[1])
    const headers = { Cookie: cookie.split(';')[0] }
    const me = await toServer(`${url}/api/auth`, { headers })
    expect(await me.json()).toMatchObject({ mode: 'telegram', authenticated: true, me: { name: STAND_MEMBERS[1].member } })
    expect((await toServer(`${url}/api/advisor/proposals`, { headers })).status).toBe(200)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).not.toContain('Secure')
  }, 60_000)
})
