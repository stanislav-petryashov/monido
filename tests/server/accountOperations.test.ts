import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/server/app'
import { createTestDb, testConfig, type TestDb } from '../helpers/db'
import { authFor } from '../helpers/auth'
import { FAMILY_PASSWORD, familyCookie, userCookie } from '../helpers/session'

const from = { name: 'Bank', member: 'Robin' }
const values = { name: 'Renamed', member: 'Sam', currency: 'EUR', class: 'broker' }
const opened: TestDb[] = []
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.restoreAllMocks() })
function setup() {
  const db = createTestDb()
  opened.push(db)
  db.sqlite.exec(`
    INSERT INTO assets VALUES ('2024-03-31', 'bank', 'Bank', 100, 'USD', 'Robin'), ('2024-02-29', 'bank', 'Bank', 90, 'USD', 'Robin'), ('2024-03-31', 'bank', 'Other', 80, 'USD', 'Robin');
    INSERT INTO monthly_cashflow (date, bank, member, active_income, passive_income, expense, currency) VALUES ('2024-03-01', 'Bank', 'Robin', 20, 10, 5, 'USD');
    INSERT INTO account_closures VALUES ('Bank', 'Robin', '2024-03');
    INSERT INTO spending_categories (name, kind) VALUES ('Food', 'mandatory'), ('Fun', 'optional');
    INSERT INTO flow_lines VALUES ('2024-03-01', 'Bank', 'Robin', (SELECT id FROM spending_categories WHERE name = 'Food'), 3);
    INSERT INTO account_transfers VALUES ('2024-03-01', 'Bank', 'Robin', 50, 'USD');
  `)
  db.sqlite.prepare("INSERT INTO month_drafts VALUES ('2024-04', ?, 'before')").run(JSON.stringify({ rows: [{ name: 'Bank', member: 'Robin', currency: 'USD', class: 'bank', balance: 7, active: 8, passive: 9, expense: 10, closing: false, added: false }], loans: [{ name: 'Loan', amount: 42 }] }))
  const config = testConfig({ password: FAMILY_PASSWORD })
  const auth = authFor(config)
  const app = createApp({ db, config, auth, ratesOnline: false })
  const post = async (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: await familyCookie(auth) }, body: JSON.stringify(body) })
  const rows = (table: string) => db.sqlite.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all()
  const snapshot = () => Object.fromEntries(['assets', 'monthly_cashflow', 'account_closures', 'month_drafts', 'month_draft_revisions', 'flow_lines', 'change_log'].map(t => [t, rows(t)]))
  return { db, post, rows, snapshot }
}
const month = { account: from, month: '2024-03', balance: 200, active: 30, passive: 20, expense: 10 }

describe('atomic account operations', () => {
  it('renames all server rows, closures, drafts, module lines and journal together', async () => {
    const { post, rows } = setup()
    const res = await post('/api/accounts/update', { from, values })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ saved: true })
    expect(rows('assets').filter(r => r.name === values.name)).toHaveLength(2)
    expect(rows('assets').find(r => r.name === 'Other')).toMatchObject({ value: 80 })
    expect(rows('monthly_cashflow')[0]).toMatchObject({ bank: values.name, member: values.member, currency: 'EUR' })
    expect(rows('account_closures')[0]).toMatchObject({ name: values.name, member: values.member, closed_month: '2024-03' })
    expect(JSON.parse(String(rows('month_drafts')[0].payload)).rows[0]).toMatchObject({ name: values.name, member: values.member, balance: 7 })
    expect(JSON.parse(String(rows('month_drafts')[0].payload)).loans).toEqual([{ name: 'Loan', amount: 42 }])
    expect(rows('flow_lines')[0]).toMatchObject({ bank: values.name, member: values.member, amount: 3 })
    expect(rows('account_transfers')[0]).toMatchObject({ name: values.name, member: values.member, amount: 50, currency: 'EUR' })
    expect(rows('change_log').map(r => r.table_name)).toEqual(['assets', 'assets', 'monthly_cashflow', 'account_transfers', 'flow_lines'])
  })
  it.each(['flow_lines', 'change_log'])('a late %s failure restores the exact rename snapshot', async table => {
    const { db, post, snapshot } = setup()
    const before = snapshot()
    const event = table === 'flow_lines' ? 'UPDATE' : 'INSERT'
    const condition = table === 'flow_lines' ? '' : "WHEN NEW.table_name = 'flow_lines'"
    db.sqlite.exec(`CREATE TRIGGER fail_late BEFORE ${event} ON ${table} ${condition} BEGIN SELECT RAISE(ABORT, 'injected'); END`)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await post('/api/accounts/update', { from, values })).status).toBe(500)
    expect(snapshot()).toEqual(before)
  })
  it('a class-only edit keeps each past row\'s own currency', async () => {
    const { db, post, rows } = setup()
    db.sqlite.exec("UPDATE assets SET currency = 'EUR' WHERE date = '2024-02-29' AND name = 'Bank'")
    expect((await post('/api/accounts/update', { from, values: { ...from, currency: 'USD', class: 'broker' } })).status).toBe(200)
    expect(rows('assets').filter(r => r.name === 'Bank').map(r => [r.class, r.currency])).toEqual([['broker', 'USD'], ['broker', 'EUR']])
    expect(rows('monthly_cashflow')[0]).toMatchObject({ currency: 'USD' })
  })

  it('preserves closure replacement and occupied category-line destinations', async () => {
    const { db, post, rows } = setup()
    db.sqlite.exec("INSERT INTO account_closures VALUES ('Renamed', 'Sam', '2024-01'); INSERT INTO flow_lines SELECT date, 'Renamed', 'Sam', category_id, 2 FROM flow_lines; INSERT INTO flow_lines SELECT date, bank, member, (SELECT id FROM spending_categories WHERE name = 'Fun'), 1 FROM flow_lines WHERE bank = 'Bank'")
    expect((await post('/api/accounts/update', { from, values })).status).toBe(200)
    expect(rows('account_closures')).toHaveLength(1)
    expect(rows('account_closures')[0]).toMatchObject({ closed_month: '2024-03' })
    expect(rows('flow_lines').filter(r => r.bank === 'Bank')).toEqual([expect.objectContaining({ amount: 3 })])
    expect(rows('flow_lines').filter(r => r.bank === 'Renamed')).toHaveLength(2)
  })
  it('an occupied monthly destination rolls all metadata and dependencies back', async () => {
    const { db, post, snapshot } = setup()
    db.sqlite.exec("INSERT INTO monthly_cashflow SELECT date, 'Renamed', 'Sam', active_income, passive_income, expense, currency FROM monthly_cashflow")
    const before = snapshot()
    expect((await post('/api/accounts/update', { from, values })).status).toBe(409)
    expect(snapshot()).toEqual(before)
  })
  it('a rename onto another account\'s name and owner is refused with 409 account_exists, nothing written', async () => {
    const { post, snapshot } = setup()
    const before = snapshot()
    const res = await post('/api/accounts/update', { from, values: { ...values, name: 'Other', member: 'Robin' } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'account_exists' } })
    expect(snapshot()).toEqual(before)
  })
  it('an account with flows but no balances counts as existing: a rename onto it is refused too', async () => {
    const { db, post, snapshot } = setup()
    db.sqlite.exec("INSERT INTO monthly_cashflow (date, bank, member, active_income, passive_income, expense, currency) VALUES ('2024-01-01', 'Flows only', 'Robin', 1, 0, 0, 'USD')")
    const before = snapshot()
    const res = await post('/api/accounts/update', { from, values: { ...values, name: 'Flows only', member: 'Robin' } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'account_exists' } })
    expect(snapshot()).toEqual(before)
  })
  it('a rename onto an account added only in the wizard draft is refused: its typed figures would be lost', async () => {
    const { db, post, snapshot } = setup()
    const draft = JSON.parse(String(db.sqlite.prepare("SELECT payload FROM month_drafts WHERE month = '2024-04'").get()!.payload))
    draft.rows.push({ name: 'Savings', member: 'Robin', currency: 'USD', class: 'bank', balance: 5000, active: 0, passive: 0, expense: 0, closing: false, added: true })
    db.sqlite.prepare("UPDATE month_drafts SET payload = ? WHERE month = '2024-04'").run(JSON.stringify(draft))
    const before = snapshot()
    const res = await post('/api/accounts/update', { from, values: { ...values, name: 'Savings', member: 'Robin' } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'account_exists' } })
    expect(snapshot()).toEqual(before)
  })
  it('a rename onto a deleted account\'s name drops that account\'s leftover closure: the renamed one stays in the wizard', async () => {
    const { db, post, rows } = setup()
    db.sqlite.exec("DELETE FROM account_closures; INSERT INTO account_closures VALUES ('Gone', 'Robin', '2024-03')")
    expect((await post('/api/accounts/update', { from, values: { ...values, name: 'Gone', member: 'Robin' } })).status).toBe(200)
    expect(rows('account_closures')).toEqual([])
  })
  it('delete selects uncached rows and retains closures, drafts and category lines', async () => {
    const { db, post, rows, snapshot } = setup()
    db.sqlite.exec("INSERT INTO assets VALUES ('2024-01-31', 'bank', 'Bank', 70, 'USD', 'Robin')")
    const before = snapshot()
    expect((await post('/api/accounts/delete', from)).status).toBe(200)
    expect(rows('assets')).toEqual([expect.objectContaining({ name: 'Other' })])
    expect(rows('monthly_cashflow')).toEqual([])
    expect(rows('account_transfers')).toEqual([])
    const after = snapshot()
    for (const table of ['account_closures', 'month_drafts', 'flow_lines']) expect(after[table]).toEqual(before[table])
    expect(rows('change_log')).toHaveLength(5)
  })
  it('a late deletion failure restores all rows and journal', async () => {
    const { db, post, snapshot } = setup()
    const before = snapshot()
    db.sqlite.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON monthly_cashflow BEGIN SELECT RAISE(ABORT, 'injected'); END")
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await post('/api/accounts/delete', from)).status).toBe(500)
    expect(snapshot()).toEqual(before)
  })
  it.each(['update', 'delete'])('selects null asset members under the empty identity for %s', async operation => {
    const { db, post, rows } = setup()
    db.sqlite.exec("UPDATE assets SET member = NULL WHERE name = 'Bank'; UPDATE monthly_cashflow SET member = '' WHERE bank = 'Bank'; UPDATE account_closures SET member = ''; UPDATE flow_lines SET member = ''; UPDATE account_transfers SET member = ''")
    const identity = { name: 'Bank', member: '' }
    expect((await post(`/api/accounts/${operation}`, operation === 'update' ? { from: identity, values } : identity)).status).toBe(200)
    expect(rows('assets').filter(r => r.name === 'Bank')).toEqual([])
    expect(rows('monthly_cashflow').filter(r => r.bank === 'Bank')).toEqual([])
    expect(rows('account_transfers').filter(r => r.name === 'Bank')).toEqual([])
  })
  it('a memberless account with flows and transfers is renamed: its flows and transfers moved and journaled', async () => {
    const { db, post, rows } = setup()
    db.sqlite.exec("UPDATE assets SET member = NULL WHERE name = 'Bank'; UPDATE monthly_cashflow SET member = ''; UPDATE account_closures SET member = ''; UPDATE flow_lines SET member = ''; UPDATE account_transfers SET member = ''")
    expect((await post('/api/accounts/update', { from: { name: 'Bank', member: '' }, values: { ...values, member: '' } })).status).toBe(200)
    expect(rows('monthly_cashflow')).toEqual([expect.objectContaining({ bank: 'Renamed', member: '', currency: 'EUR' })])
    expect(rows('account_transfers')).toEqual([expect.objectContaining({ name: 'Renamed', member: '', currency: 'EUR', amount: 50 })])
    expect(rows('change_log').filter(r => r.table_name === 'account_transfers')).toHaveLength(1)
  })
  it('a broker account’s month edit sets, changes and clears its deposits, journaled; a bank account ignores them', async () => {
    const { db, post, rows } = setup()
    db.sqlite.exec("UPDATE assets SET class = 'broker' WHERE name = 'Bank'; DELETE FROM account_transfers")
    const amounts = () => rows('account_transfers').map(r => [r.date, r.amount])
    expect((await post('/api/accounts/month', { ...month, deposited: 300 })).status).toBe(200)
    expect(amounts()).toEqual([['2024-03-01', 300]])
    expect((await post('/api/accounts/month', { ...month, deposited: -5, expected: { ...month, deposited: 300 } })).status).toBe(200)
    expect(amounts()).toEqual([['2024-03-01', -5]])
    expect((await post('/api/accounts/month', { ...month, deposited: null, expected: { ...month, deposited: 0 } })).status).toBe(409)
    expect((await post('/api/accounts/month', { ...month, deposited: null })).status).toBe(200)
    expect(amounts()).toEqual([])
    expect(rows('change_log').filter(r => r.table_name === 'account_transfers').map(r => r.op)).toEqual(['insert', 'update', 'delete'])
    db.sqlite.exec("UPDATE assets SET class = 'bank' WHERE name = 'Bank'")
    expect((await post('/api/accounts/month', { ...month, deposited: 7 })).status).toBe(200)
    expect(amounts()).toEqual([])
  })
  it('monthly balance and flows update together', async () => {
    const { post, rows } = setup()
    expect((await post('/api/accounts/month', month)).status).toBe(200)
    expect(rows('assets')[0]).toMatchObject({ value: 200 })
    expect(rows('monthly_cashflow')[0]).toMatchObject({ active_income: 30, passive_income: 20, expense: 10 })
    expect(rows('change_log')).toHaveLength(2)
  })
  it.each(['monthly_cashflow', 'change_log'])('a late monthly %s failure restores both halves and journal', async table => {
    const { db, post, snapshot } = setup()
    const before = snapshot()
    const event = table === 'change_log' ? 'INSERT' : 'UPDATE'
    const condition = table === 'change_log' ? "WHEN NEW.table_name = 'monthly_cashflow'" : ''
    db.sqlite.exec(`CREATE TRIGGER fail_month BEFORE ${event} ON ${table} ${condition} BEGIN SELECT RAISE(ABORT, 'injected'); END`)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await post('/api/accounts/month', month)).status).toBe(500)
    expect(snapshot()).toEqual(before)
  })
  it('fills missing flow halves only for nonzero input in an existing month', async () => {
    const { post, rows } = setup()
    expect((await post('/api/accounts/month', { ...month, month: '2024-02', active: 0, passive: 0, expense: 0 })).status).toBe(200)
    expect(rows('monthly_cashflow')).toHaveLength(1)
    expect((await post('/api/accounts/month', { ...month, month: '2024-02' })).status).toBe(200)
    expect(rows('monthly_cashflow')).toHaveLength(2)
  })
  it('fills a missing balance half for any typed balance, zero included, in an existing flow month', async () => {
    const { db, post, rows } = setup()
    db.sqlite.exec("DELETE FROM assets WHERE name = 'Bank' AND date = '2024-03-31'")
    expect((await post('/api/accounts/month', { ...month, balance: null })).status).toBe(200)
    expect(rows('assets').filter(r => r.name === 'Bank')).toHaveLength(1)
    expect((await post('/api/accounts/month', { ...month, balance: 0 })).status).toBe(200)
    expect(rows('assets').find(r => r.name === 'Bank' && r.date === '2024-03-31')).toMatchObject({ value: 0 })
    expect((await post('/api/accounts/month', { ...month, balance: -10 })).status).toBe(200)
    expect(rows('assets').find(r => r.name === 'Bank' && r.date === '2024-03-31')).toMatchObject({ value: -10, currency: 'USD', class: 'bank' })
  })
  it('a correction naming the month as it opened is refused with 409 row_changed when the month changed meanwhile', async () => {
    const { db, post, snapshot } = setup()
    const opened = { balance: 100, active: 20, passive: 10, expense: 5 }
    db.sqlite.exec("UPDATE assets SET value = 150 WHERE name = 'Bank' AND date = '2024-03-31'")
    const before = snapshot()
    const res = await post('/api/accounts/month', { ...month, expected: opened })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'row_changed' } })
    expect(snapshot()).toEqual(before)
    expect((await post('/api/accounts/month', { ...month, expected: { ...opened, balance: 150 } })).status).toBe(200)
  })
  it.each([null, 'bad', '', '100'])('rejects cleared or invalid existing balance %s without writes', async balance => {
    const { post, snapshot } = setup()
    const before = snapshot()
    expect((await post('/api/accounts/month', { ...month, balance })).status).toBe(400)
    expect(snapshot()).toEqual(before)
  })
  it('cannot add months or mutate nonexistent accounts', async () => {
    const { post, snapshot } = setup()
    const before = snapshot()
    expect((await post('/api/accounts/month', { ...month, month: '2024-01' })).status).toBe(404)
    expect((await post('/api/accounts/month', { ...month, month: '2024-13' })).status).toBe(400)
    expect((await post('/api/accounts/update', { from: { ...from, name: 'missing' }, values })).status).toBe(404)
    expect((await post('/api/accounts/delete', { ...from, name: 'missing' })).status).toBe(404)
    expect(snapshot()).toEqual(before)
  })
  it('a month edit writes the balance and the flows; while income and expenses are not tracked, the balance only', async () => {
    const tracked = setup()
    expect((await tracked.post('/api/accounts/month', month)).status).toBe(200)
    expect(tracked.rows('monthly_cashflow').find(r => String(r.date).startsWith('2024-03'))).toMatchObject({ active_income: 30, passive_income: 20, expense: 10 })
    const { db, post, rows } = setup()
    db.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('track_flows', '0')")
    const flows = rows('monthly_cashflow')
    expect((await post('/api/accounts/month', month)).status).toBe(200)
    expect(rows('assets')[0]).toMatchObject({ value: 200 })
    expect(rows('monthly_cashflow')).toEqual(flows)
  })

  it.each([
    ['/api/accounts/update', { from: { ...from, member: null }, values }, 'from'],
    ['/api/accounts/update', { from, values: { ...values, currency: '' } }, 'currency'],
    ['/api/accounts/update', { from, values: { ...values, class: 'invalid' } }, 'class'],
    ['/api/accounts/delete', { ...from, name: '' }, 'account'],
    ['/api/accounts/month', { ...month, account: { ...from, member: null } }, 'account'],
  ])('validates unknown input with a renderable account error at %s (%s)', async (path, body, field) => {
    const { post, snapshot } = setup()
    const before = snapshot()
    const response = await post(path, body)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: { code: 'invalid_account', params: { field } } })
    expect(snapshot()).toEqual(before)
  })

  it('viewers cannot mutate any account endpoint', async () => {
    const { db, snapshot } = setup()
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Viewer'); INSERT INTO users (member, telegram_id, can_edit, can_vote, can_manage, created_at, updated_at) VALUES ('Viewer', '101', 0, 0, 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')")
    const config = testConfig({ mode: 'telegram', TELEGRAM_BOT_TOKEN: '1:x' })
    const auth = authFor(config)
    const app = createApp({ db, config, auth, ratesOnline: false })
    const before = snapshot()
    for (const [operation, body] of [['update', { from, values }], ['delete', from], ['month', month]] as const) {
      const res = await app.request(`/api/accounts/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: await userCookie(auth, 1) }, body: JSON.stringify(body) })
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: { code: 'no_right_edit' } })
    }
    expect(snapshot()).toEqual(before)
  })
})
