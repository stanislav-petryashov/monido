import { describe, expect, it } from 'vitest'
import { buildFamily } from '../../src/demo/family'
import { createApp } from '../../src/server/app'
import type { Actor } from '../../src/server/http'
import { writeFamily } from '../../src/server/demo/writeFamily'
import { getSnapshot } from '../../src/server/snapshot'
import { WIPE_KEEP, wipeFamilyData } from '../../src/server/wipe'
import { createTestDb, testConfig, type TestDb } from '../helpers/db'
import { authFor } from '../helpers/auth'
import { FAMILY_PASSWORD, familyCookie, withCookie } from '../helpers/session'

const NOW = new Date('2031-10-19T10:00:00Z')
const ACTOR: Actor = { name: 'owner@example.com', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null }

/** The ordinary tables of the live database, SQLite's own left out. */
const tables = (db: TestDb) => db.sqlite.prepare('PRAGMA main.table_list').all()
  .filter(r => r.type === 'table' && !/^sqlite_/.test(String(r.name))).map(r => String(r.name)).sort()

const rows = (db: TestDb, table: string) => db.sqlite.prepare(`SELECT rowid AS _rowid, * FROM "${table}" ORDER BY rowid`).all()

/** Every table's rows, to compare before and after. */
const everything = (db: TestDb) => Object.fromEntries(tables(db).map(t => [t, rows(db, t)]))

/**
 * The demo family in every family table, EUR as the family currency (and the inflation currency), a linked Telegram chat
 * and a few rows the family does not write (its spending categories and statements come with the family).
 */
function familyDb(): TestDb {
  const db = createTestDb()
  writeFamily(db.sqlite, buildFamily({ today: '2031-10-19' }))
  db.sqlite.exec(`
    INSERT INTO availability_assessments VALUES ('2031-09', 'Old bank', '', 'USD', 100, 1, 20, 0, 0);
    UPDATE app_settings SET value = 'EUR' WHERE key = 'currency';
    UPDATE currencies SET inflation = (code = 'EUR');
    UPDATE app_settings SET value = 'ru-RU' WHERE key = 'language';
    UPDATE reminder_settings SET enabled = 1, chat_id = '42', chat_title = 'Family chat';
    INSERT INTO family_telegram_groups (chat_id, title, proposal_cursor) VALUES ('-100', 'Family', 999999);
    INSERT INTO family_telegram_pairing VALUES (1, 'hash', '2099-01-01');
    INSERT INTO family_telegram_reminder_delivery VALUES ('-100', '2031-10-01');
    INSERT INTO month_draft_revisions VALUES ('2031-09', 9);
    INSERT INTO month_drafts (month, payload, updated_at) VALUES ('2031-09', '{}', 't');
    INSERT INTO account_closings (name, member, closed_month) VALUES ('Old bank', '', '2031-01');
    INSERT INTO loan_payments (date, loan_name, amount, currency) VALUES ('2031-09-01', 'Car loan', 400, 'USD');
    INSERT INTO manual_mandatory_spending (id, amount, currency, updated_at) VALUES (1, 900, 'USD', '2031-09-01');
    INSERT INTO flow_lines (date, bank, member, category_id, amount) VALUES ('2031-09-01', 'Old bank', '', (SELECT MAX(id) FROM spending_categories), 10);
    INSERT INTO account_transfers (date, name, member, amount, currency) VALUES ('2031-09-01', 'Broker', '', 500, 'USD');
    INSERT INTO fx_manual_rates (currency, date, per_usd) VALUES ('EUR', '2031-01-31', 0.9);
    INSERT INTO change_log (ts, actor, source, table_name, row_id, op) VALUES ('t', 'a', 'admin', 'assets', 1, 'insert');
    INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES ('c1', 'Claude', '[]', 't');
    INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, chain_id, expires_at, created_at) VALUES ('h', 'refresh', 'c1', 1, 'ch', '2099-01-01T00:00:00.000Z', 't');
    UPDATE advisor_settings SET decide_days = 7, remind_days = NULL;
    INSERT INTO proposals (type, author_id, status, created_at, deadline_at) VALUES ('credit', 1, 'open', 't', 't');
    INSERT INTO proposal_versions (proposal_id, number, title, question, scenario_json, evaluation_json, base_currency, verdict_json, voters_json, created_at)
      VALUES (1, 1, 'Car', 'Buy it?', '{}', '{}', 'USD', '{}', '[1]', 't');
    INSERT INTO proposal_votes (version_id, user_id, vote, voted_at) VALUES (1, 1, 'agree', 't');
    INSERT INTO proposal_messages (version_id, user_id, chat_id, kind, updated_at) VALUES (1, 1, '42', 'card', 't');
  `)
  return db
}

describe('wipeFamilyData', () => {
  it('deletes the family data and keeps the keep-list', async () => {
    const db = familyDb()
    db.sqlite.exec("INSERT INTO app_settings (key, value) VALUES ('auth_password', 'hash')")
    const before = everything(db)
    // every table has rows, so an emptied one shows
    expect(Object.entries(before).filter(([, r]) => r.length === 0).map(([t]) => t)).toEqual([])
    await wipeFamilyData(db, ACTOR, NOW)
    const row = (key: string) => (db.sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value
    expect(row('auth_generation')).toBe('1')
    expect(row('auth_password')).toBe('hash')
    const after = everything(db)
    for (const table of tables(db)) {
      // the wipe clears only the setup flag of app_settings (tested apart)
      if (table === 'app_settings') expect(after[table], table).toEqual(before[table].filter(r => r.key !== 'setup_state'))
      else if (table === 'family_telegram_groups') {
        const cursor = Number(db.sqlite.prepare('SELECT MAX(id) AS id FROM change_log').get()!.id)
        expect(after[table]).toEqual(before[table].map(r => ({ ...r, proposal_cursor: cursor })))
      }
      else if ((WIPE_KEEP as readonly string[]).includes(table)) expect(after[table], table).toEqual(before[table])
      else if (table === 'currencies' || table === 'change_log' || table === 'members') continue
      // the reserved loan-payments category is not family data: a fresh install has it
      else if (table === 'spending_categories') expect(after[table].map(r => r.name), table).toEqual(['loan_payments'])
      else expect(after[table], table).toEqual([])
    }
    expect(WIPE_KEEP).toEqual(['schema_migrations', 'app_settings', 'reminder_settings', 'advisor_settings', 'fx_rates', 'users', 'family_telegram_groups'])
    // the journal starts again with the wipe
    expect(db.sqlite.prepare('SELECT ts, actor, source, table_name, row_id, op, before_json, after_json, reverts_id FROM change_log').all())
      .toEqual([{ ts: NOW.toISOString(), actor: ACTOR.name, source: 'admin', table_name: '*', row_id: 0, op: 'wipe', before_json: null, after_json: null, reverts_id: null }])
  })

  it('clears the setup flag so the wizard runs again', async () => {
    const db = familyDb()
    const settings = () => db.sqlite.prepare('SELECT key, value FROM app_settings ORDER BY key').all() as { key: string; value: string }[]
    expect(settings().find(r => r.key === 'setup_state')).toEqual({ key: 'setup_state', value: 'done' })
    const others = settings().filter(r => r.key !== 'setup_state')
    await wipeFamilyData(db, ACTOR, NOW)
    expect(settings()).toEqual(others)
    expect(others.map(r => r.key)).toEqual(expect.arrayContaining(['language', 'currency', 'auth_generation']))
  })

  it('disconnects Claude: the OAuth clients and tokens are credentials, not kept', async () => {
    const db = familyDb()
    await wipeFamilyData(db, ACTOR, NOW)
    expect(rows(db, 'oauth_clients')).toEqual([])
    expect(rows(db, 'oauth_tokens')).toEqual([])
  })

  it('users and the members they point to survive', async () => {
    const db = familyDb()
    db.sqlite.exec("INSERT OR IGNORE INTO members (name) VALUES ('Ryan'), ('Other')")
    const users = rows(db, 'users')
    await wipeFamilyData(db, ACTOR, NOW)
    expect(rows(db, 'users')).toEqual(users)
    expect(db.sqlite.prepare('SELECT name FROM members ORDER BY name').all()).toEqual([{ name: 'Annika' }, { name: 'Ryan' }])
  })

  it('keeps the family currency row', async () => {
    const db = familyDb()
    const eur = db.sqlite.prepare("SELECT rowid, * FROM currencies WHERE code = 'EUR'").get()
    expect(eur).toMatchObject({ inflation: 1 })
    expect(db.sqlite.prepare('SELECT code FROM currencies ORDER BY code').all()).toEqual([{ code: 'EUR' }, { code: 'USD' }])
    await wipeFamilyData(db, ACTOR, NOW)
    // the inflation figure went with `parameters`: no flag is left, as on a fresh install
    expect(db.sqlite.prepare('SELECT rowid, * FROM currencies').all()).toEqual([{ ...eur, inflation: 0 }])
  })

  it('keeps the fallback currency when the stored family currency left the project', async () => {
    for (const [removed, kept] of [[[], 'USD'], [['USD'], 'EUR']] as const) {
      const db = familyDb()
      db.sqlite.exec("UPDATE app_settings SET value = 'GBP' WHERE key = 'currency'")
      for (const code of removed) db.sqlite.prepare('DELETE FROM currencies WHERE code = ?').run(code)
      // the family currency as the app reads it: USD if listed, else the first project currency
      await wipeFamilyData(db, ACTOR, NOW)
      expect(db.sqlite.prepare('SELECT code, inflation FROM currencies').all(), kept).toEqual([{ code: kept, inflation: 0 }])
      const snapshot = await getSnapshot(db, { now: NOW, download: false })
      expect(snapshot).toMatchObject({ capital: null, baseCurrency: kept, currencies: [kept] })
    }
  })

  it('the snapshot builds after a wipe', async () => {
    const db = familyDb()
    await wipeFamilyData(db, ACTOR, NOW)
    const snapshot = await getSnapshot(db, { now: NOW, download: false })
    // a fresh install: no numbers yet, in the family currency, which is still a project currency
    expect(snapshot.capital).toBeNull()
    expect(snapshot.baseCurrency).toBe('EUR')
    expect(snapshot.currencies).toEqual(['EUR'])
    expect(snapshot.asOf).toMatchObject({ capitalDate: null, closedMonth: null })
    // the same snapshot as a new database with that currency; only today's rate comes from the kept rate cache
    const fresh = createTestDb()
    fresh.sqlite.exec("DELETE FROM currencies WHERE code <> 'EUR'; UPDATE app_settings SET value = 'EUR' WHERE key = 'currency'; DELETE FROM members")
    for (const m of rows(db, 'members') as { name: string }[]) fresh.sqlite.prepare('INSERT INTO members (name) VALUES (?)').run(m.name)
    expect({ ...snapshot, rates: null }).toEqual(await getSnapshot(fresh, { now: NOW, download: false }))
  })

  it('a failure leaves everything as it was', async () => {
    const db = familyDb()
    // the journal entry is the last statement of the transaction: everything before it must come back
    db.sqlite.exec("CREATE TRIGGER no_wipe BEFORE INSERT ON change_log WHEN NEW.op = 'wipe' BEGIN SELECT RAISE(ABORT, 'refused'); END")
    const before = everything(db)
    await expect(wipeFamilyData(db, ACTOR, NOW)).rejects.toThrow('refused')
    expect(everything(db)).toEqual(before)
    expect(db.sqlite.isTransaction).toBe(false)
  })
})

describe('POST /api/wipe', () => {
  function setup(env: Record<string, string> = { password: FAMILY_PASSWORD }) {
    const db = familyDb()
    const config = testConfig(env)
    const auth = authFor(config)
    return { db, app: withCookie(createApp({ db, config, auth, ratesOnline: false }), () => familyCookie(auth)) }
  }
  const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

  it('wipes on confirm', async () => {
    const { db, app } = setup()
    const res = await app.request('/api/wipe', post({ confirm: true }))
    expect(res.status).toBe(200)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM assets').get()).toEqual({ n: 0 })
    const snapshot = await app.request('/api/snapshot')
    expect(snapshot.status).toBe(200)
    expect(await snapshot.json()).toMatchObject({ capital: null, baseCurrency: 'EUR' })
  })

  it('requires confirm', async () => {
    const { db, app } = setup()
    const before = everything(db)
    for (const body of [{}, { confirm: 'true' }, { confirm: 1 }, null, []]) {
      const res = await app.request('/api/wipe', post(body))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: { code: 'confirm_required' } })
    }
    expect((await app.request('/api/wipe')).status).toBe(405)
    expect(everything(db)).toEqual(before)
  })

  it('refuses in the demo', async () => {
    const { db, app } = setup({ AUTH_MODE: 'demo' })
    const before = everything(db)
    const res = await app.request('/api/wipe', post({ confirm: true }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: { code: 'not_in_demo' } })
    expect(everything(db)).toEqual(before)
  })

  it('a wipe cannot be reverted', async () => {
    const { db, app } = setup()
    expect((await app.request('/api/wipe', post({ confirm: true }))).status).toBe(200)
    const journal = db.sqlite.prepare('SELECT id, op FROM change_log').all() as { id: number; op: string }[]
    expect(journal.map(e => e.op)).toEqual(['wipe'])
    const res = await app.request(`/api/admin/change_log/${journal[0].id}/revert`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'not_revertible' } })
  })
})
