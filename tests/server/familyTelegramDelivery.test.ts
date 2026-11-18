// Family chats Telegram changes or leaves: a group upgraded to a supergroup (a new chat id) is followed, a group the bot
// was removed from stops getting notices, and a proposal's notices come one per delivery run, not one per journal row.
import { describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../helpers/db'
import { fakeTelegram } from '../helpers/telegram'
import { runScheduled } from '../../src/modules/reminders/reminders'
import { deliverGroupProposals } from '../../src/server/familyTelegramDelivery'

const env = { TELEGRAM_BOT_TOKEN: 'token' }
const OLD = '-100'
const NEW = '-1001234'

/** fakeTelegram, except the old group answers as Telegram does for a group upgraded to a supergroup */
function upgraded() {
  const tg = fakeTelegram()
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { chat_id: string }
    if (String(body.chat_id) === OLD) {
      tg.calls.push({ method: 'sendMessage', chat: OLD, body })
      return new Response(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: group chat was upgraded to a supergroup chat', parameters: { migrate_to_chat_id: Number(NEW) } }), { status: 400 })
    }
    return tg.fetchImpl(input, init)
  }) as unknown as typeof fetch
  return { ...tg, fetchImpl }
}

const proposal = (db: ReturnType<typeof createTestDb>, journalRows = 1) => {
  db.sqlite.exec(`INSERT INTO proposals (id, type, author_id, status, created_at, deadline_at) VALUES (1, 'goal', 1, 'open', 't', 't');
    INSERT INTO proposal_versions (proposal_id, number, title, question, scenario_json, evaluation_json, base_currency, verdict_json, voters_json, created_at) VALUES (1, 1, 'Car', 'q', '{}', '{}', 'USD', '{}', '[]', 't')`)
  for (let i = 0; i < journalRows; i++) db.sqlite.exec(`INSERT INTO change_log (ts, actor, source, table_name, row_id, op) VALUES ('t', 'a', 'admin', 'proposals', 1, '${i ? 'update' : 'insert'}')`)
}

describe('family chats Telegram changed', () => {
  it('a reminder to a group upgraded to a supergroup moves the group to its new id and is sent there, once', async () => {
    const db = createTestDb(), tg = upgraded()
    db.sqlite.exec(`UPDATE reminder_settings SET enabled = 1, start_day = 3, hour = 10;
      INSERT INTO family_telegram_groups (chat_id, title, reminders) VALUES ('${OLD}', 'Family', 1)`)
    for (const hour of ['11', '12', '13']) await runScheduled(db, env, new Date(`2031-10-03T${hour}:00:00Z`), tg.fetchImpl)
    expect(tg.to(OLD)).toHaveLength(1)
    expect(tg.to(NEW)).toHaveLength(1)
    expect(db.sqlite.prepare('SELECT chat_id, reminders FROM family_telegram_groups').all()).toEqual([{ chat_id: NEW, reminders: 1 }])
  })

  it('the reminders\' own linked group follows its upgrade too', async () => {
    const db = createTestDb(), tg = upgraded()
    db.sqlite.exec(`UPDATE reminder_settings SET enabled = 1, start_day = 3, hour = 10, chat_id = '${OLD}'`)
    expect(await runScheduled(db, env, new Date('2031-10-03T11:00:00Z'), tg.fetchImpl)).toBe('sent')
    expect(tg.to(NEW)).toHaveLength(1)
    expect(db.sqlite.prepare('SELECT chat_id, last_error FROM reminder_settings').get()).toEqual({ chat_id: NEW, last_error: null })
  })

  it('a proposal notice to an upgraded group goes to its new id and moves the cursor', async () => {
    const db = createTestDb(), tg = upgraded()
    db.sqlite.exec(`INSERT INTO family_telegram_groups (chat_id, title, proposals) VALUES ('${OLD}', 'Family', 1)`)
    proposal(db)
    for (let i = 0; i < 3; i++) await deliverGroupProposals(db, env, tg.fetchImpl)
    expect(tg.to(OLD)).toHaveLength(1)
    expect(tg.to(NEW)).toHaveLength(1)
    expect(db.sqlite.prepare('SELECT chat_id, proposal_cursor FROM family_telegram_groups').all()).toEqual([{ chat_id: NEW, proposal_cursor: 1 }])
  })

  it('a group the bot was removed from stops getting proposal notices instead of being retried every run', async () => {
    const db = createTestDb(), tg = fakeTelegram()
    tg.chats['-200'] = 'blocked'
    db.sqlite.exec(`INSERT INTO family_telegram_groups (chat_id, title, proposals) VALUES ('-200', 'Old', 1)`)
    proposal(db)
    for (let i = 0; i < 3; i++) await deliverGroupProposals(db, env, tg.fetchImpl)
    expect(tg.to('-200')).toHaveLength(1)
    expect(db.sqlite.prepare('SELECT proposals FROM family_telegram_groups').get()).toEqual({ proposals: 0 })
  })

  it('several journal rows of one proposal give one notice with its status now', async () => {
    const db = createTestDb(), tg = fakeTelegram()
    db.sqlite.exec(`INSERT INTO family_telegram_groups (chat_id, title, proposals) VALUES ('-300', 'Family', 1)`)
    proposal(db, 3)
    await deliverGroupProposals(db, env, tg.fetchImpl)
    expect(tg.to('-300')).toHaveLength(1)
    expect(db.sqlite.prepare('SELECT proposal_cursor FROM family_telegram_groups').get()).toEqual({ proposal_cursor: 3 })
  })
})
