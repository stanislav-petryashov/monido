// A loan secured by a property (loans.secured_by): the write check, and the link following a property rename or delete.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../../src/server/app'
import { createTestDb, testConfig, type TestDb } from '../../helpers/db'
import { authFor } from '../../helpers/auth'
import { FAMILY_PASSWORD, familyCookie } from '../../helpers/session'

const opened: TestDb[] = []
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.restoreAllMocks() })

function setup() {
  const db = createTestDb()
  opened.push(db)
  db.sqlite.exec(`
    INSERT INTO real_estate (name, purchase_date, purchase_price, purchase_currency, member, valuation_year, value, currency) VALUES
      ('House', '2022-09-15', 520000, 'USD', NULL, 2022, 520000, 'USD'),
      ('House', '2022-09-15', 520000, 'USD', NULL, 2023, 535500, 'USD'),
      ('Flat', '2016-04-01', 216000, 'EUR', NULL, 2025, 299500, 'EUR');
    INSERT INTO loans (name, issue_date, principal, rate, term_months, monthly_payment, currency, member, secured_by) VALUES
      ('Mortgage', '2022-09-15', 416000, 6.5, 360, 2629, 'USD', 'Robin', 'House'),
      ('Car', '2024-01-01', 12000, 5, 36, 360, 'USD', 'Robin', NULL);
  `)
  const config = testConfig({ password: FAMILY_PASSWORD })
  const auth = authFor(config)
  const app = createApp({ db, config, auth, ratesOnline: false })
  const send = async (path: string, method: string, body: unknown) => app.request(path, {
    method, headers: { 'Content-Type': 'application/json', Cookie: await familyCookie(auth) }, body: JSON.stringify(body),
  })
  const links = () => db.sqlite.prepare('SELECT name, secured_by FROM loans ORDER BY rowid').all()
  const journal = () => db.sqlite.prepare('SELECT id, table_name, row_id, op FROM change_log ORDER BY id').all() as { id: number; table_name: string; row_id: number; op: string }[]
  return { db, send, links, journal }
}

const newLoan = { name: 'Home equity', issue_date: '2025-01-01', principal: 50000, rate: 7, term_months: 120, monthly_payment: 580, currency: 'USD', member: 'Robin' }

describe('a loan secured by a property', () => {
  it('links a loan to an existing property and unlinks it, through the loan edit', async () => {
    const { send, links } = setup()
    expect((await send('/api/loans/2', 'PUT', { expectedName: 'Car', secured_by: 'Flat' })).status).toBe(200)
    expect((await send('/api/loans/1', 'PUT', { expectedName: 'Mortgage', secured_by: null })).status).toBe(200)
    expect(links()).toEqual([{ name: 'Mortgage', secured_by: null }, { name: 'Car', secured_by: 'Flat' }])
  })

  it('refuses an unknown property on insert and on update', async () => {
    const { send, links } = setup()
    const insert = await send('/api/admin/loans', 'POST', { ...newLoan, secured_by: 'Castle' })
    expect(insert.status).toBe(400)
    expect(await insert.json()).toMatchObject({ error: { code: 'invalid_value', params: { column: 'secured_by' } } })
    expect((await send('/api/loans/2', 'PUT', { expectedName: 'Car', secured_by: 'Castle' })).status).toBe(400)
    expect((await send('/api/admin/loans', 'POST', { ...newLoan, secured_by: 'House' })).status).toBe(200)
    expect(links()).toEqual([{ name: 'Mortgage', secured_by: 'House' }, { name: 'Car', secured_by: null }, { name: 'Home equity', secured_by: 'House' }])
  })

  it.each(['update', 'delete'])('rolls back %s when the second collateral rewrite fails', async operation => {
    const { db, send, links, journal } = setup()
    db.sqlite.exec("UPDATE loans SET secured_by = 'House' WHERE name = 'Car'")
    const beforeLinks = links()
    const beforeProperties = db.sqlite.prepare('SELECT * FROM real_estate ORDER BY rowid').all()
    db.sqlite.exec("CREATE TRIGGER fail_collateral BEFORE UPDATE OF secured_by ON loans WHEN OLD.name = 'Car' BEGIN SELECT RAISE(ABORT, 'injected'); END")
    const values = { name: 'Renamed', purchase_date: '2022-09-15', purchase_price: 520000, purchase_currency: 'USD', member: null }
    expect((await send(`/api/real-estate/${operation}`, 'POST', { name: 'House', ...(operation === 'update' ? { values } : {}) })).status).toBeGreaterThanOrEqual(400)
    expect(links()).toEqual(beforeLinks)
    expect(db.sqlite.prepare('SELECT * FROM real_estate ORDER BY rowid').all()).toEqual(beforeProperties)
    expect(journal()).toEqual([])
  })

  it('a property rename moves the link in the same journaled mutation', async () => {
    const { send, links, journal } = setup()
    const values = { name: 'Maple House', purchase_date: '2022-09-15', purchase_price: 520000, purchase_currency: 'USD', member: null }
    expect((await send('/api/real-estate/update', 'POST', { name: 'House', values })).status).toBe(200)
    expect(links()).toEqual([{ name: 'Mortgage', secured_by: 'Maple House' }, { name: 'Car', secured_by: null }])
    expect(journal().map(e => [e.table_name, e.row_id, e.op])).toEqual([['real_estate', 1, 'update'], ['real_estate', 2, 'update'], ['loans', 1, 'update']])
  })

  it('deleting a property clears the link, keeps the loan, and one undo restores both', async () => {
    const { db, send, links, journal } = setup()
    expect((await send('/api/real-estate/delete', 'POST', { name: 'House' })).status).toBe(200)
    expect(links()).toEqual([{ name: 'Mortgage', secured_by: null }, { name: 'Car', secured_by: null }])
    const entries = journal()
    expect(entries.map(e => [e.table_name, e.op])).toEqual([['real_estate', 'delete'], ['real_estate', 'delete'], ['loans', 'update']])
    expect((await send(`/api/admin/change_log/${entries[0].id}/revert`, 'POST', {})).status).toBe(200)
    expect(links()[0]).toEqual({ name: 'Mortgage', secured_by: 'House' })
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM real_estate WHERE name = 'House'").get()).toEqual({ n: 1 })
    // the link's own entry is reverted with it
    expect((await send(`/api/admin/change_log/${entries[2].id}/revert`, 'POST', {})).status).toBe(409)
    expect((await send(`/api/admin/change_log/${entries[1].id}/revert`, 'POST', {})).status).toBe(200)
    expect(links()[0]).toEqual({ name: 'Mortgage', secured_by: 'House' })
  })

  it('one undo of a rename moves the link back', async () => {
    const { send, links, journal } = setup()
    const values = { name: 'Maple House', purchase_date: '2022-09-15', purchase_price: 520000, purchase_currency: 'USD', member: null }
    expect((await send('/api/real-estate/update', 'POST', { name: 'House', values })).status).toBe(200)
    expect((await send(`/api/admin/change_log/${journal()[0].id}/revert`, 'POST', {})).status).toBe(200)
    expect(links()[0]).toEqual({ name: 'Mortgage', secured_by: 'House' })
  })

  it('the rows API refuses deleting a property\'s last valuation (409 last_valuation), not an earlier one', async () => {
    const { send, links } = setup()
    expect((await send('/api/admin/real_estate/3', 'DELETE', {})).status).toBe(409)
    expect((await send('/api/admin/real_estate/1', 'DELETE', {})).status).toBe(200)
    expect((await send('/api/admin/real_estate/2', 'DELETE', {})).status).toBe(409)
    expect(links()[0]).toEqual({ name: 'Mortgage', secured_by: 'House' })
  })

  it('a property deleted while a loan edit is prepared refuses the link (checked inside the guarded transaction)', async () => {
    const { db, send, links } = setup()
    const guarded = db.guardedBatch.bind(db)
    vi.spyOn(db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
      db.sqlite.exec("DELETE FROM real_estate WHERE name = 'Flat'")
      return guarded(token, statements)
    })
    expect((await send('/api/loans/2', 'PUT', { expectedName: 'Car', secured_by: 'Flat' })).status).toBe(400)
    expect(links()[1]).toEqual({ name: 'Car', secured_by: null })
  })
})
