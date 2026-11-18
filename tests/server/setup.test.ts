import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/server/app'
import type { Database } from '../../src/server/db'
import { readSetupState, setupView } from '../../src/server/setup'
import { WIPE_KEEP, wipeFamilyData } from '../../src/server/wipe'
import { createTestDb, testConfig } from '../helpers/db'
import { authFor } from '../helpers/auth'
import { FAMILY_PASSWORD, familyCookie, userCookie, withCookie } from '../helpers/session'

const NOW = new Date('2031-10-19T10:00:00Z')

function server(db = createTestDb(), env: Record<string, string> = { password: FAMILY_PASSWORD }) {
  const config = testConfig(env)
  const auth = authFor(config)
  const raw = createApp({ db, config, auth })
  return { db, raw, app: withCookie(raw, () => familyCookie(auth)) }
}
const put = (app: Pick<ReturnType<typeof server>, 'app'>['app'], body: unknown) =>
  app.request('/api/setup', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const journal = (db: Database & { sqlite: import('node:sqlite').DatabaseSync }) =>
  db.sqlite.prepare("SELECT op, after_json FROM change_log WHERE table_name = 'app_settings'").all() as { op: string; after_json: string }[]

/** One row in each table the test-data load would replace, alone (foreign keys off, so a child row needs no parent). */
const FAMILY_ROWS: Record<string, string> = {
  availability_assessments: "INSERT INTO availability_assessments VALUES ('2031-09', 'Cash', '', 'USD', 100, 1, 20, 0, 0)",
  account_closings: "INSERT INTO account_closings (name, member, closed_month) VALUES ('A', '', '2031-01')",
  assets: "INSERT INTO assets (date, class, name, value, currency) VALUES ('2031-01-31', 'cash', 'A', 1, 'USD')",
  category_spending: "INSERT INTO category_spending (date, category_id, source, amount, currency) VALUES ('2031-01-01', 99, 'manual', 1, 'USD')",
  account_transfers: "INSERT INTO account_transfers VALUES ('2031-01-01', 'Broker', '', 1, 'USD')",
  flow_lines: "INSERT INTO flow_lines (date, bank, member, category_id, amount) VALUES ('2031-01-01', 'Bank', '', 99, 1)",
  closed_months: "INSERT INTO closed_months (month, closed_at, closed_by) VALUES ('2031-01', 't', 'x')",
  fx_manual_rates: "INSERT INTO fx_manual_rates (date, currency, per_usd) VALUES ('2031-01-31', 'EUR', 1)",
  goals: "INSERT INTO goals (id, name, target, current, target_date) VALUES ('g', 'Boat', 10, 0, '2032-12-31')",
  loan_early_payments: "INSERT INTO loan_early_payments (loan_name, payment_date, amount, strategy) VALUES ('L', '2031-01-15', 1, 'reduce_term')",
  loan_payments: "INSERT INTO loan_payments (date, loan_name, amount, currency) VALUES ('2031-01-01', 'L', 1, 'USD')",
  loans: "INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, currency, member) VALUES ('L', '2030-01-01', 1, 1, 12, 1, 'USD', '')",
  manual_mandatory_spending: "INSERT INTO manual_mandatory_spending (amount, currency, updated_at) VALUES (1, 'USD', 't')",
  month_drafts: "INSERT INTO month_drafts (month, payload, updated_at) VALUES ('2031-09', '{\"rows\":[],\"loans\":[]}', 't')",
  monthly_cashflow: "INSERT INTO monthly_cashflow (date, bank, member, expense, currency) VALUES ('2031-01-01', 'B', '', 1, 'USD')",
  proposal_messages: "INSERT INTO proposal_messages (version_id, user_id, chat_id, kind, updated_at) VALUES (99, 1, 'c', 'card', 't')",
  proposal_versions: "INSERT INTO proposal_versions (proposal_id, number, title, question, scenario_json, evaluation_json, base_currency, verdict_json, voters_json, created_at) VALUES (99, 1, 'T', 'Q', '{}', '{}', 'USD', '{}', '[]', 't')",
  proposal_votes: "INSERT INTO proposal_votes (version_id, user_id, vote, voted_at) VALUES (99, 1, 'agree', 't')",
  proposals: "INSERT INTO proposals (type, author_id, status, created_at, deadline_at) VALUES ('goal', 1, 'open', 't', 't')",
  real_estate: "INSERT INTO real_estate (name, valuation_year, purchase_date, purchase_price, purchase_currency, value, currency) VALUES ('Flat', 2031, '2030-01-01', 1, 'USD', 1, 'USD')",
  spending_categories: "INSERT INTO spending_categories (name) VALUES ('Food')",
}

/** What hasData leaves out: the tables the wipe keeps, and the reference lists, the journal and the connector's sign-ins. */
const NOT_FAMILY_DATA = [...WIPE_KEEP, 'currencies', 'members', 'parameters', 'change_log', 'oauth_clients', 'oauth_tokens', 'month_draft_revisions', 'family_telegram_pairing', 'family_telegram_reminder_delivery']

describe('setupView', () => {
  it('internal revision metadata alone is not family data', async () => {
    const db = createTestDb()
    db.sqlite.exec("INSERT INTO month_draft_revisions VALUES ('2031-09', 8)")
    expect(await setupView(db, NOW)).toMatchObject({ hasData: false, hasAccounts: false })
  })

  it('a fresh database has no data and no accounts', async () => {
    expect(await setupView(createTestDb(), NOW)).toEqual({ state: 'pending', hasData: false, hasAccounts: false })
  })

  it('checks every table the load empties but the kept and reference ones (a new table needs a case here)', () => {
    const db = createTestDb()
    const tables = (db.sqlite.prepare('PRAGMA main.table_list').all() as { name: string; type: string }[])
      .filter(r => r.type === 'table' && !r.name.startsWith('sqlite_')).map(r => r.name)
    expect(tables.filter(t => !NOT_FAMILY_DATA.includes(t)).sort()).toEqual(Object.keys(FAMILY_ROWS).sort())
  })

  it.each(Object.entries(FAMILY_ROWS))('a row in %s alone → hasData true', async (_table, sql) => {
    const db = createTestDb()
    db.sqlite.exec('PRAGMA foreign_keys = OFF')
    db.sqlite.exec(sql)
    expect(await setupView(db, NOW)).toMatchObject({ hasData: true })
  })

  it('the reserved loan_payment category, the reference lists, the rates, the users and the journal are no data', async () => {
    const db = createTestDb()
    db.sqlite.exec(`
      INSERT INTO currencies (code) VALUES ('GEL');
      INSERT INTO members (name) VALUES ('Noa');
      INSERT INTO users (member, created_at, updated_at) VALUES ('Noa', 't', 't');
      INSERT INTO parameters (key, value) VALUES ('savings_target', '0.2');
      INSERT INTO fx_rates (date, currency, per_usd, source_date) VALUES ('2031-01-31', 'EUR', 1, '2031-01-31');
      INSERT INTO change_log (ts, actor, source, table_name, row_id, op) VALUES ('t', 'x', 'site', 'members', 1, 'insert');
    `)
    expect(db.sqlite.prepare("SELECT kind FROM spending_categories").all()).toEqual([{ kind: 'loan_payment' }])
    expect(await setupView(db, NOW)).toMatchObject({ hasData: false })
  })

  it('a wiped database has no data again', async () => {
    const db = createTestDb()
    db.sqlite.exec(`${FAMILY_ROWS.assets}; ${FAMILY_ROWS.goals}; INSERT INTO members (name) VALUES ('Noa'); INSERT INTO users (member, created_at, updated_at) VALUES ('Noa', 't', 't')`)
    expect(await setupView(db, NOW)).toMatchObject({ hasData: true })
    await wipeFamilyData(db, { name: 'owner', source: 'admin', rights: { edit: true, vote: true, manage: true }, userId: null }, NOW)
    expect(await setupView(db, NOW)).toMatchObject({ hasData: false })
  })

  it('reports hasAccounts, which implies hasData', async () => {
    const asset = createTestDb()
    asset.sqlite.exec(FAMILY_ROWS.assets)
    expect(await setupView(asset, NOW)).toMatchObject({ hasData: true, hasAccounts: true })

    const closed = createTestDb()
    closed.sqlite.exec(FAMILY_ROWS.closed_months)
    expect(await setupView(closed, NOW)).toMatchObject({ hasData: true, hasAccounts: false })

    const draft = createTestDb()
    const row = { name: 'Quillmark', member: '', currency: 'USD', class: 'bank', balance: 5, active: null, passive: null, expense: null, closing: false, added: false }
    draft.sqlite.prepare("INSERT INTO month_drafts (month, payload, updated_at) VALUES ('2031-09', ?, 't')").run(JSON.stringify({ rows: [row], loans: [] }))
    expect(await setupView(draft, NOW)).toMatchObject({ hasData: true, hasAccounts: true })
  })
})

describe('/api/setup', () => {
  it('GET answers the view to any signed-in person', async () => {
    const { app } = server()
    const res = await app.request('/api/setup')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: 'pending', hasData: false, hasAccounts: false })
  })

  it('PUT writes done and skipped with one journal entry each', async () => {
    const { db, app } = server()
    expect(await (await put(app, { state: 'done' })).json()).toMatchObject({ state: 'done' })
    let log = journal(db)
    expect(log).toHaveLength(1)
    expect(log[0].op).toBe('insert')
    expect(JSON.parse(log[0].after_json)).toEqual({ key: 'setup_state', value: 'done' })
    await put(app, { state: 'done' })
    expect(journal(db)).toHaveLength(1)
    expect(await (await put(app, { state: 'skipped' })).json()).toMatchObject({ state: 'skipped' })
    log = journal(db)
    expect(log).toHaveLength(2)
    expect(log[1].op).toBe('update')
    expect(JSON.parse(log[1].after_json)).toEqual({ key: 'setup_state', value: 'skipped' })
  })

  it('PUT refuses other values and non-managers, with no journal entry', async () => {
    const { db, app } = server()
    for (const body of [{ state: 'pending' }, { state: 1 }, {}, null]) {
      const res = await put(app, body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: { code: 'invalid_value', params: { column: 'state' } } })
    }
    // a refused write leaves no journal entry
    expect(journal(db)).toEqual([])
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Noa'); INSERT INTO users (member, telegram_id, can_edit, can_vote, can_manage, created_at, updated_at) VALUES ('Noa', '7', 1, 0, 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')")
    const telegram = testConfig({ mode: 'telegram', TELEGRAM_BOT_TOKEN: '1:x' })
    const telegramAuth = authFor(telegram)
    const noa = db.sqlite.prepare("SELECT id FROM users WHERE member = 'Noa'").get() as { id: number }
    const res = await put(withCookie(createApp({ db, config: telegram, auth: telegramAuth }), () => userCookie(telegramAuth, noa.id)), { state: 'done' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: { code: 'no_right_manage' } })
    expect(await readSetupState(db)).toBe('pending')
    expect(journal(db)).toEqual([])
  })

  it('PUT answers 403 not_in_demo in the demo', async () => {
    const { db, raw } = server(createTestDb(), { AUTH_MODE: 'demo' })
    const res = await put(raw, { state: 'done' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: { code: 'not_in_demo' } })
    expect(journal(db)).toEqual([])
  })

  it('GET /api/auth carries setup when signed in and not before', async () => {
    const { app, raw } = server()
    const anon = await (await raw.request('/api/auth')).json() as Record<string, unknown>
    expect(anon.authenticated).toBe(false)
    expect('setup' in anon).toBe(false)
    expect(await (await app.request('/api/auth')).json()).toMatchObject({ authenticated: true, setup: 'pending' })
    await put(app, { state: 'done' })
    expect(await (await app.request('/api/auth')).json()).toMatchObject({ setup: 'done' })
  })

  it('GET /api/auth answers done when the flag cannot be read', async () => {
    const real = createTestDb()
    const db = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== 'prepare') return Reflect.get(target, prop, receiver)
        return (sql: string) => {
          const stmt = target.prepare(sql)
          if (!sql.includes('app_settings') || !sql.includes('WHERE key = ?')) return stmt
          return new Proxy(stmt, {
            get(s, p, r) {
              if (p !== 'bind') return Reflect.get(s, p, r)
              return (...args: unknown[]) => {
                if (args[0] === 'setup_state') throw new Error('unreadable')
                return (s.bind as (...a: unknown[]) => unknown)(...args)
              }
            },
          })
        }
      },
    }) as typeof real
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { app } = server(db)
    const res = await app.request('/api/auth')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ authenticated: true, setup: 'done' })
    expect(spy).toHaveBeenCalledWith('[auth] could not read the setup state', expect.any(Error))
    spy.mockRestore()
  })
})
