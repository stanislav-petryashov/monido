import { describe, expect, it } from 'vitest'
import { loadAll } from '../../src/server/data'
import { createTestDb, type TestDb } from '../helpers/db'

describe('current schema constraints and defaults', () => {
  it('drops the manual net worth, liabilities, portfolio and trades tables', () => {
    const db = createTestDb()
    const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => (r as { name: string }).name)
    for (const legacy of ['net_worth', 'liabilities', 'portfolio', 'trades']) expect(tables).not.toContain(legacy)
    expect(tables).toEqual(expect.arrayContaining(['assets', 'monthly_cashflow', 'fx_rates']))
  })

  it('keeps one closure per account and one draft per month', () => {
    const db = createTestDb()
    db.sqlite.exec(`INSERT INTO account_closures VALUES ('Quillmark Bank', 'Robin', '2024-06')`)
    expect(() => db.sqlite.exec(`INSERT INTO account_closures VALUES ('Quillmark Bank', 'Robin', '2024-07')`)).toThrow()
    db.sqlite.exec(`INSERT INTO month_drafts VALUES ('2024-06', '{}', 't')`)
    expect(() => db.sqlite.exec(`INSERT INTO month_drafts VALUES ('2024-06', '{}', 't')`)).toThrow()
  })

  it('creates one settings row, off by default, and allows no second one', () => {
    const db = createTestDb()
    expect(db.sqlite.prepare('SELECT enabled, start_day, hour, timezone, chat_id FROM reminder_settings').all())
      .toEqual([{ enabled: 0, start_day: 3, hour: 10, timezone: 'UTC', chat_id: null }])
    expect(() => db.sqlite.exec('INSERT INTO reminder_settings (id) VALUES (2)')).toThrow()
  })

  it('keeps the start day within 1–15 and the hour within 0–23', () => {
    const db = createTestDb()
    expect(() => db.sqlite.exec('UPDATE reminder_settings SET start_day = 16')).toThrow()
    expect(() => db.sqlite.exec('UPDATE reminder_settings SET start_day = 0')).toThrow()
    expect(() => db.sqlite.exec('UPDATE reminder_settings SET hour = 24')).toThrow()
    db.sqlite.exec('UPDATE reminder_settings SET start_day = 15, hour = 23')
  })

  it('gives a recreated settings row English', () => {
    const db = createTestDb()
    db.sqlite.exec('DELETE FROM reminder_settings; INSERT INTO reminder_settings (id) VALUES (1)')
    expect(db.sqlite.prepare('SELECT language, last_error FROM reminder_settings').get()).toEqual({ language: 'en-US', last_error: null })
  })

  it('keeps one rate per date and currency, and a manual rate above zero', () => {
    const db = createTestDb()
    db.sqlite.exec("INSERT INTO fx_rates VALUES ('2026-05-31', 'RUB', 80, '2026-05-30')")
    expect(() => db.sqlite.exec("INSERT INTO fx_rates VALUES ('2026-05-31', 'RUB', 81, '2026-05-30')")).toThrow()
    db.sqlite.exec("INSERT INTO fx_manual_rates VALUES ('ARS', '2026-01-01', 1500)")
    expect(() => db.sqlite.exec("INSERT INTO fx_manual_rates VALUES ('ARS', '2026-01-01', 1600)")).toThrow()
    expect(() => db.sqlite.exec("INSERT INTO fx_manual_rates VALUES ('TRY', '2026-01-01', 0)")).toThrow()
  })

  it('loads the flagged currency, the first one if several', async () => {
    const db = createTestDb()
    expect((await loadAll(db)).inflationCurrency).toBeNull()
    db.sqlite.exec("UPDATE currencies SET inflation = 1 WHERE code IN ('USD', 'EUR')")
    expect((await loadAll(db)).inflationCurrency).toBe('EUR')
  })

  it('adds empty pairing state on a clean install', () => {
    const db = createTestDb()
    expect(db.sqlite.prepare('SELECT pairing_hash, pairing_expires_at FROM reminder_settings').get())
      .toEqual({ pairing_hash: null, pairing_expires_at: null })
  })

  it('keeps one payment per loan and month', () => {
    const db = createTestDb()
    const insert = (amount: number) =>
      db.sqlite.exec(`INSERT INTO loan_payments (date, loan_name, amount, currency) VALUES ('2031-05-01', 'Car', ${amount}, 'USD')`)
    insert(400)
    expect(() => insert(500)).toThrow(/UNIQUE|PRIMARY/)
    db.sqlite.exec(`INSERT INTO loan_payments (date, loan_name, amount, currency) VALUES ('2031-06-01', 'Car', 400, 'USD')`)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM loan_payments').get()).toEqual({ n: 2 })
  })

  it('seeds the one reserved loan_payments category', () => {
    const db = createTestDb()
    expect(db.sqlite.prepare('SELECT name, kind FROM spending_categories').all()).toEqual([{ name: 'loan_payments', kind: 'loan_payment' }])
  })

  it('keeps category names unique regardless of case and kinds within the list', () => {
    const db = createTestDb()
    db.sqlite.exec(`INSERT INTO spending_categories (name, kind) VALUES ('Groceries', 'mandatory')`)
    expect(() => db.sqlite.exec(`INSERT INTO spending_categories (name) VALUES ('GROCERIES')`)).toThrow(/UNIQUE/)
    expect(() => db.sqlite.exec(`INSERT INTO spending_categories (name, kind) VALUES ('X', 'bogus')`)).toThrow(/CHECK/)
    expect(db.sqlite.prepare(`SELECT kind FROM spending_categories WHERE name = 'Cinema'`).get()).toBeUndefined()
    db.sqlite.exec(`INSERT INTO spending_categories (name) VALUES ('Cinema')`)
    expect(db.sqlite.prepare(`SELECT kind FROM spending_categories WHERE name = 'Cinema'`).get()).toEqual({ kind: 'optional' })
  })

  it('keeps one row per month, category, source and currency, and only for a known category', () => {
    const db = createTestDb()
    const insert = (category: number, source = 'Bank A', amount = 10) =>
      db.sqlite.exec(`INSERT INTO category_spending (date, category_id, source, amount, currency) VALUES ('2031-05-01', ${category}, '${source}', ${amount}, 'USD')`)
    insert(1)
    expect(() => insert(1)).toThrow(/UNIQUE|PRIMARY/)
    insert(1, 'Bank B')
    expect(() => insert(99)).toThrow(/FOREIGN/)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM category_spending').get()).toEqual({ n: 2 })
  })

  it('holds at most one manual mandatory amount', () => {
    const db = createTestDb()
    db.sqlite.exec(`INSERT INTO manual_mandatory_spending (id, amount, currency, updated_at) VALUES (1, 900, 'USD', 't')`)
    expect(() => db.sqlite.exec(`INSERT INTO manual_mandatory_spending (id, amount, currency, updated_at) VALUES (2, 1, 'USD', 't')`)).toThrow(/CHECK/)
  })

  it('creates the council tables and the settings row with 14 / 3', () => {
    const db = createTestDb()
    expect(db.sqlite.prepare('SELECT id, decide_days, remind_days FROM advisor_settings').all()).toEqual([{ id: 1, decide_days: 14, remind_days: 3 }])
    expect(() => db.sqlite.exec('INSERT INTO advisor_settings (id) VALUES (2)')).toThrow(/CHECK/)
    expect(() => db.sqlite.exec('UPDATE advisor_settings SET decide_days = 61')).toThrow(/CHECK/)
    expect(() => db.sqlite.exec('UPDATE advisor_settings SET remind_days = 60')).toThrow(/CHECK/)
    db.sqlite.exec('UPDATE advisor_settings SET remind_days = NULL')

    db.sqlite.exec(`INSERT INTO proposals (type, author_id, status, created_at, deadline_at) VALUES ('credit', 1, 'open', 't', 't');
      INSERT INTO proposal_versions (proposal_id, number, title, question, scenario_json, evaluation_json, base_currency, verdict_json, voters_json, created_at)
        VALUES (1, 1, 'Car', 'Buy it?', '{}', '{}', 'USD', '{}', '[1,2]', 't');
      INSERT INTO proposal_votes (version_id, user_id, vote, voted_at) VALUES (1, 2, 'agree', 't');
      INSERT INTO proposal_messages (version_id, user_id, chat_id, kind, updated_at) VALUES (1, 2, '42', 'card', 't')`)
    expect(db.sqlite.prepare('SELECT version, decided_at, goal_id FROM proposals').get()).toEqual({ version: 1, decided_at: null, goal_id: null })
    expect(db.sqlite.prepare('SELECT settled, settled_by FROM proposal_votes').get()).toEqual({ settled: 0, settled_by: null })
    expect(db.sqlite.prepare('SELECT notice, state, dirty, attempts FROM proposal_messages').get()).toEqual({ notice: '', state: 'pending', dirty: 1, attempts: 0 })

    expect(() => db.sqlite.exec(`INSERT INTO proposals (type, author_id, status, created_at, deadline_at) VALUES ('windfall', 1, 'open', 't', 't')`)).toThrow(/CHECK/)
    expect(() => db.sqlite.exec(`INSERT INTO proposals (type, author_id, status, created_at, deadline_at) VALUES ('goal', 1, 'done', 't', 't')`)).toThrow(/CHECK/)
    expect(() => db.sqlite.exec(`INSERT INTO proposal_versions (proposal_id, number, title, question, scenario_json, evaluation_json, base_currency, verdict_json, voters_json, created_at)
      VALUES (1, 1, 'Car', 'Again?', '{}', '{}', 'USD', '{}', '[1]', 't')`)).toThrow(/UNIQUE/)
    expect(() => db.sqlite.exec(`INSERT INTO proposal_versions (proposal_id, number, title, question, scenario_json, evaluation_json, base_currency, verdict_json, voters_json, created_at)
      VALUES (9, 1, 'Car', 'Nobody', '{}', '{}', 'USD', '{}', '[1]', 't')`)).toThrow(/FOREIGN/)
    expect(() => db.sqlite.exec(`INSERT INTO proposal_votes (version_id, user_id, vote, voted_at) VALUES (1, 2, 'against', 't')`)).toThrow(/UNIQUE|PRIMARY/)
    expect(() => db.sqlite.exec(`INSERT INTO proposal_votes (version_id, user_id, vote, voted_at) VALUES (1, 3, 'maybe', 't')`)).toThrow(/CHECK/)
    expect(() => db.sqlite.exec(`INSERT INTO proposal_votes (version_id, user_id, vote, settled_by, voted_at) VALUES (1, 3, 'agree', 'claude', 't')`)).toThrow(/CHECK/)
    expect(() => db.sqlite.exec(`INSERT INTO proposal_messages (version_id, user_id, chat_id, kind, updated_at) VALUES (1, 2, '42', 'card', 't')`)).toThrow(/UNIQUE/)
    expect(() => db.sqlite.exec(`INSERT INTO proposal_messages (version_id, user_id, chat_id, kind, notice, updated_at) VALUES (1, 2, '42', 'notice', 'hello', 't')`)).toThrow(/CHECK/)

    // a proposal takes its versions, their votes and their messages with it
    db.sqlite.exec('DELETE FROM proposals')
    for (const table of ['proposal_versions', 'proposal_votes', 'proposal_messages']) {
      expect(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 })
    }
    for (const index of ['proposal_messages_due', 'proposal_votes_pending']) {
      expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(index)).toEqual({ name: index })
    }
  })

describe('0016 users', () => {
  const insert = (db: TestDb, member: string, extra = '') =>
    db.sqlite.exec(`INSERT INTO users (member, created_at, updated_at${extra ? ', ' + extra.split('=')[0] : ''}) VALUES ('${member}', 't', 't'${extra ? ", '" + extra.split('=')[1] + "'" : ''})`)

  it('creates users with the default rights', () => {
    const db = createTestDb()
    insert(db, 'Anna')
    expect(db.sqlite.prepare('SELECT can_edit, can_vote, can_manage FROM users').get()).toEqual({ can_edit: 1, can_vote: 1, can_manage: 0 })
  })

  it('keeps member, email (without case) and telegram_id unique', () => {
    const db = createTestDb()
    insert(db, 'Anna', 'email=a@x.io')
    expect(() => insert(db, 'Anna')).toThrow(/UNIQUE/)
    expect(() => insert(db, 'Ben', 'email=A@X.IO')).toThrow(/UNIQUE/)
    insert(db, 'Cleo', 'telegram_id=7')
    expect(() => insert(db, 'Dan', 'telegram_id=7')).toThrow(/UNIQUE/)
  })
})

describe('0020 advisor oauth', () => {
  const client = (db: TestDb, id = 'c1') =>
    db.sqlite.exec(`INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES ('${id}', NULL, '[]', 't')`)
  const token = (db: TestDb, hash: string, kind = 'access', clientId = 'c1') =>
    db.sqlite.exec(`INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, chain_id, expires_at, created_at) VALUES ('${hash}', '${kind}', '${clientId}', 1, 'ch', 't', 't')`)

  it('keeps tokens of a known client, of two kinds, deleted with their client', () => {
    const db = createTestDb()
    client(db)
    token(db, 'h1')
    token(db, 'h2', 'refresh')
    expect(() => token(db, 'h1')).toThrow(/UNIQUE|PRIMARY/)
    expect(() => token(db, 'h3', 'id_token')).toThrow(/CHECK/)
    expect(() => token(db, 'h4', 'access', 'nobody')).toThrow(/FOREIGN/)
    db.sqlite.exec(`DELETE FROM oauth_clients WHERE client_id = 'c1'`)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_tokens').get()).toEqual({ n: 0 })
    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'oauth_tokens_user'").get()).toEqual({ name: 'oauth_tokens_user' })
  })
})
  it('keeps flows and the one-off flag within their lists, and lines non-negative, unique and of a known category', () => {
    const db = createTestDb()
    expect(() => db.sqlite.exec("INSERT INTO spending_categories (name, flow) VALUES ('Gift', 'gift')")).toThrow(/CHECK/)
    expect(() => db.sqlite.exec("INSERT INTO spending_categories (name, flow, one_off) VALUES ('Bonus', 'active', 2)")).toThrow(/CHECK/)
    db.sqlite.exec("INSERT INTO spending_categories (name, flow, one_off) VALUES ('Salary', 'active', 0)")
    const line = (category: number | string, amount = 100, member = '') =>
      db.sqlite.exec(`INSERT INTO flow_lines (date, bank, member, category_id, amount) VALUES ('2031-05-01', 'Bank A', '${member}', ${category}, ${amount})`)
    line("(SELECT id FROM spending_categories WHERE name = 'Salary')")
    expect(() => line("(SELECT id FROM spending_categories WHERE name = 'Salary')")).toThrow(/UNIQUE|PRIMARY/)
    line("(SELECT id FROM spending_categories WHERE name = 'Salary')", 50, 'Robin')
    expect(() => line(99)).toThrow(/FOREIGN/)
    expect(() => line(2, -1)).toThrow(/CHECK/)
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM flow_lines').get()).toEqual({ n: 2 })
    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_flow_lines_date'").get()).toEqual({ name: 'idx_flow_lines_date' })
    expect(db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })


})
