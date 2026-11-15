import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../../src/server/app'
import { createTestDb, testConfig, type TestDb } from '../../helpers/db'
import { authFor } from '../../helpers/auth'
import { FAMILY_PASSWORD, familyCookie, userCookie } from '../../helpers/session'

const opened: TestDb[] = []
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.restoreAllMocks() })

function setup() {
  const db = createTestDb()
  opened.push(db)
  db.sqlite.exec(`
    INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, currency, member) VALUES
      ('Loan', '2024-01-01', 1200, 0, 12, 100, 'USD', 'Robin'),
      ('Other', '2024-01-01', 1200, 0, 12, 100, 'USD', 'Robin');
    INSERT INTO loan_early_payments (loan_name, payment_date, amount, strategy) VALUES
      ('Loan', '2024-03-15', 10, 'reduce_term'), ('Loan', '2024-04-15', 20, 'reduce_term'), ('Other', '2024-03-15', 30, 'reduce_term');
    INSERT INTO loan_payments (date, loan_name, amount, currency) VALUES ('2024-02-01', 'Loan', 100, 'USD'), ('2024-03-01', 'Loan', 90, 'USD');
  `)
  db.sqlite.prepare("INSERT INTO month_drafts VALUES ('2024-04', ?, 'before')").run(JSON.stringify({ rows: [], loans: [{ name: 'Loan', amount: 87 }, { name: 'Other', amount: 50 }] }))
  const config = testConfig({ password: FAMILY_PASSWORD })
  const auth = authFor(config)
  const app = createApp({ db, config, auth, ratesOnline: false })
  const request = async (method: string, body?: unknown, cookie?: string, path = '/api/loans/1') => app.request(path, {
    method, headers: { 'Content-Type': 'application/json', Cookie: cookie ?? await familyCookie(auth) },
    ...(body === undefined ? {} : { body: JSON.stringify(method === 'PUT' ? { expectedName: 'Loan', ...(body as Record<string, unknown>) } : body) }),
  })
  const rows = (table: string) => db.sqlite.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all()
  const snapshot = () => Object.fromEntries(['loans', 'loan_early_payments', 'loan_payments', 'month_drafts', 'month_draft_revisions', 'change_log'].map(t => [t, rows(t)]))
  /** The generic rows API, as the Records tables and any script call it */
  const admin = async (method: string, path: string, body?: unknown) => app.request(path, {
    method, headers: { 'Content-Type': 'application/json', Cookie: await familyCookie(auth) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { db, auth, request, admin, rows, snapshot }
}

describe('atomic loan operations', () => {
  it('requires the original name before updating a retained loan target', async () => {
    const { request, snapshot } = setup()
    const before = snapshot()
    expect((await request('PUT', { expectedName: undefined, description: 'Unsafe' })).status).toBe(400)
    expect(snapshot()).toEqual(before)
  })

  it.each([false, true])('refuses a reused loan rowid, including guarded retry %s', async duringCommit => {
    const { db, request, snapshot } = setup()
    const replace = () => db.sqlite.exec("DELETE FROM loans WHERE name = 'Other'; INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, currency, member) VALUES ('Replacement', '2024-01-01', 1200, 0, 12, 100, 'USD', 'Robin')")
    let before: ReturnType<typeof snapshot>
    if (duringCommit) {
      const guarded = db.guardedBatch.bind(db)
      vi.spyOn(db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
        replace()
        before = snapshot()
        return guarded(token, statements)
      })
    } else { replace(); before = snapshot() }
    const response = await request('PUT', { expectedName: 'Other', description: 'Stale edit' }, undefined, '/api/loans/2')
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'row_changed' } })
    expect(snapshot()).toEqual(before!)
  })

  it('renames the loan, all server early payments, historical payments, drafts and journal together', async () => {
    const { request, rows } = setup()
    const response = await request('PUT', { name: 'Renamed', description: 'Edited' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ saved: true })
    expect(rows('loans')[0]).toMatchObject({ name: 'Renamed', description: 'Edited' })
    expect(rows('loan_early_payments').map(r => r.loan_name)).toEqual(['Renamed', 'Renamed', 'Other'])
    expect(rows('loan_payments').map(r => r.loan_name)).toEqual(['Renamed', 'Renamed'])
    expect(JSON.parse(String(rows('month_drafts')[0].payload))).toEqual({ rows: [], loans: [{ name: 'Renamed', amount: 87 }, { name: 'Other', amount: 50 }] })
    expect(rows('change_log').map(r => r.table_name)).toEqual(['loans', 'loan_early_payments', 'loan_early_payments', 'loan_payments', 'loan_payments'])
  })

  it.each(['loan_early_payments', 'loan_payments', 'month_drafts', 'month_draft_revisions', 'change_log'])('a late %s failure restores every renamed dependency and journal', async table => {
    const { db, request, snapshot } = setup()
    const before = snapshot()
    const event = table === 'change_log' || table === 'month_draft_revisions' ? 'INSERT' : 'UPDATE'
    const condition = table === 'loan_early_payments' ? 'WHEN NEW.id = 2' : table === 'change_log' ? "WHEN NEW.table_name = 'loan_payments'" : ''
    db.sqlite.exec(`CREATE TRIGGER fail_late BEFORE ${event} ON ${table} ${condition} BEGIN SELECT RAISE(ABORT, 'injected'); END`)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await request('PUT', { name: 'Renamed' })).status).toBe(500)
    expect(snapshot()).toEqual(before)
  })

  it('rejects duplicate names without changing any dependency', async () => {
    const { request, snapshot } = setup()
    const before = snapshot()
    expect((await request('PUT', { name: 'Other' })).status).toBe(409)
    expect(snapshot()).toEqual(before)
  })

  it('deletes all early payments while retaining historical payments and draft input', async () => {
    const { request, rows } = setup()
    const historical = rows('loan_payments')
    const drafts = rows('month_drafts')
    const response = await request('DELETE')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: true })
    expect(rows('loans')).toEqual([expect.objectContaining({ name: 'Other' })])
    expect(rows('loan_early_payments')).toEqual([expect.objectContaining({ loan_name: 'Other' })])
    expect(rows('loan_payments')).toEqual(historical)
    expect(rows('month_drafts')).toEqual(drafts)
    expect(rows('change_log')).toHaveLength(3)
  })

  it.each(['loan_early_payments', 'change_log'])('a late deletion %s failure restores the loan, payments and journal', async table => {
    const { db, request, snapshot } = setup()
    const before = snapshot()
    db.sqlite.exec(`CREATE TRIGGER fail_delete BEFORE ${table === 'change_log' ? 'INSERT' : 'DELETE'} ON ${table} ${table === 'change_log' ? "WHEN NEW.table_name = 'loan_early_payments'" : 'WHEN OLD.id = 2'} BEGIN SELECT RAISE(ABORT, 'injected'); END`)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await request('DELETE')).status).toBe(500)
    expect(snapshot()).toEqual(before)
  })

  it('allows an unchanged legacy over-limit term but rejects a changed over-limit term', async () => {
    const { db, request, rows, snapshot } = setup()
    db.sqlite.exec("UPDATE loans SET term_months = 480 WHERE name = 'Loan'")
    expect((await request('PUT', { description: 'Legacy', term_months: '480' })).status).toBe(200)
    expect(rows('loans')[0]).toMatchObject({ term_months: 480, description: 'Legacy' })
    const before = snapshot()
    expect((await request('PUT', { term_months: 421 })).status).toBe(400)
    expect(snapshot()).toEqual(before)
  })

  it('accepts an unchanged legacy term on its own without adding a journal entry', async () => {
    const { db, request, snapshot } = setup()
    db.sqlite.exec("UPDATE loans SET term_months = 480 WHERE name = 'Loan'")
    const before = snapshot()
    expect((await request('PUT', { term_months: 480 })).status).toBe(200)
    expect(snapshot()).toEqual(before)
    expect((await request('PUT', {})).status).toBe(400)
  })

  it.each(['PUT', 'DELETE'])('requires edit rights for %s', async method => {
    const { db, auth, request, snapshot } = setup()
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Viewer'); INSERT INTO users (member, telegram_id, can_edit, can_vote, can_manage, created_at, updated_at) VALUES ('Viewer', '101', 0, 1, 0, '2020-01-01', '2020-01-01')")
    auth.set({ mode: 'telegram' })
    const id = Number(db.sqlite.prepare("SELECT id FROM users WHERE member = 'Viewer'").get()!.id)
    const before = snapshot()
    expect((await request(method, method === 'PUT' ? { status: 'closed' } : undefined, await userCookie(auth, id))).status).toBe(403)
    expect(snapshot()).toEqual(before)
  })

  it('rebuilds the rename when an early payment arrives during preflight', async () => {
    const { db, request, rows } = setup()
    const guarded = db.guardedBatch.bind(db)
    vi.spyOn(db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
      db.sqlite.exec("INSERT INTO loan_early_payments (loan_name, payment_date, amount, strategy) VALUES ('Loan', '2024-05-15', 40, 'reduce_term')")
      return guarded(token, statements)
    })
    expect((await request('PUT', { name: 'Renamed' })).status).toBe(200)
    expect(rows('loan_early_payments').filter(r => r.loan_name === 'Renamed')).toHaveLength(3)
    expect(rows('loan_early_payments').some(r => r.loan_name === 'Loan')).toBe(false)
  })

  it('keeps row validation and rejects missing rows', async () => {
    const { request, snapshot } = setup()
    const before = snapshot()
    for (const body of [{ name: '' }, { payment_day: 32 }, { unknown: 'field' }]) expect((await request('PUT', body)).status).toBe(400)
    for (const method of ['PUT', 'DELETE']) expect((await request(method, method === 'PUT' ? { description: 'changed' } : undefined, undefined, '/api/loans/999')).status).toBe(404)
    expect(snapshot()).toEqual(before)
  })

  it('rejects a numeric loan name rather than leaving dependencies under the old name', async () => {
    const { request, snapshot } = setup()
    const before = snapshot()
    expect((await request('PUT', { name: 123 })).status).toBe(400)
    expect(snapshot()).toEqual(before)
  })
})

describe('a loan through the rows API', () => {
  const code = async (response: Response) => [response.status, ((await response.json()) as { error: { code: string } }).error.code]

  it('refuses a rename and a delete, which would leave the payments on the old name; other edits go through', async () => {
    const { admin, snapshot, rows } = setup()
    const before = snapshot()
    expect(await code(await admin('PUT', '/api/admin/loans/1', { name: 'Renamed' }))).toEqual([409, 'loan_by_route'])
    expect(await code(await admin('DELETE', '/api/admin/loans/1'))).toEqual([409, 'loan_by_route'])
    expect(snapshot()).toEqual(before)
    expect((await admin('PUT', '/api/admin/loans/1', { name: 'Loan', rate: 1 })).status).toBe(200)
    expect(rows('loans')[0]).toMatchObject({ name: 'Loan', rate: 1 })
  })

  it('refuses an early payment for a loan that does not exist', async () => {
    const { admin, rows } = setup()
    const response = await admin('POST', '/api/admin/loan_early_payments', { loan_name: 'Gone', payment_date: '2024-05-15', amount: 5, strategy: 'reduce_term' })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_value', params: { column: 'loan_name' } } })
    expect(rows('loan_early_payments')).toHaveLength(3)
  })
})
