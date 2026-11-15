import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../../src/server/app'
import { createTestDb, testConfig, type TestDb } from '../../helpers/db'
import { authFor } from '../../helpers/auth'
import { FAMILY_PASSWORD, familyCookie, userCookie } from '../../helpers/session'

const opened: TestDb[] = []
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.restoreAllMocks() })
const values = { name: 'Renamed', purchase_date: '2020-02-03', purchase_price: 150000.5, purchase_currency: 'EUR', member: 'Robin' }

function setup() {
  const db = createTestDb()
  opened.push(db)
  db.sqlite.exec(`
    INSERT INTO real_estate (name, purchase_date, purchase_price, purchase_currency, member, valuation_year, value, currency, notes) VALUES
      ('Home', '2019-01-01', 100000, 'USD', NULL, 2023, 120000, 'USD', 'First'),
      ('Home', '2019-01-01', 100000, 'USD', NULL, 2024, 130000, 'EUR', 'Second'),
      ('Other', '2018-01-01', 80000, 'USD', NULL, 2024, 90000, 'USD', NULL);
  `)
  const config = testConfig({ password: FAMILY_PASSWORD })
  const auth = authFor(config)
  const app = createApp({ db, config, auth, ratesOnline: false })
  const request = async (operation: 'update' | 'delete', body: unknown, cookie?: string) => app.request(`/api/real-estate/${operation}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie ?? await familyCookie(auth) }, body: JSON.stringify(body),
  })
  const rows = (table: string) => db.sqlite.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all()
  const snapshot = () => ({ properties: rows('real_estate'), journal: rows('change_log') })
  /** The generic rows API, as the screen adds a valuation and the Records tables write */
  const admin = async (method: string, path: string, body: unknown) => app.request(path, {
    method, headers: { 'Content-Type': 'application/json', Cookie: await familyCookie(auth) }, body: JSON.stringify(body),
  })
  return { db, auth, request, admin, rows, snapshot }
}

const code = async (response: Response) => [response.status, ((await response.json()) as { error: { code: string } }).error.code]
/** Home's stored purchase and owner, as a valuation added to it repeats them */
const home = { name: 'Home', purchase_date: '2019-01-01', purchase_price: 100000, purchase_currency: 'USD', member: null }

describe('a property through the rows API', () => {
  it('refuses a rename of one valuation, which would split the property and leave its loans behind', async () => {
    const { admin, snapshot } = setup()
    const before = snapshot()
    expect(await code(await admin('PUT', '/api/admin/real_estate/1', { name: 'Split' }))).toEqual([409, 'property_by_route'])
    expect(snapshot()).toEqual(before)
    expect((await admin('PUT', '/api/admin/real_estate/1', { name: 'Home', value: 121000 })).status).toBe(200)
  })

  it('a row added under an existing name repeats its purchase and owner', async () => {
    const { admin, rows } = setup()
    const valuation = { valuation_year: 2025, value: 140000, currency: 'USD' }
    // a second property of the same name, or a stale tab putting an old price back
    expect(await code(await admin('POST', '/api/admin/real_estate', { ...home, purchase_price: 99000, ...valuation }))).toEqual([409, 'property_mismatch'])
    expect(await code(await admin('POST', '/api/admin/real_estate', { ...home, member: 'Robin', ...valuation }))).toEqual([409, 'property_mismatch'])
    expect(rows('real_estate')).toHaveLength(3)
    expect((await admin('POST', '/api/admin/real_estate', { ...home, ...valuation })).status).toBe(200)
    expect((await admin('POST', '/api/admin/real_estate', { ...home, name: 'New', valuation_year: 2025, value: 1, currency: 'USD' })).status).toBe(200)
  })

  it.each([1899, 2101, 20255])('refuses valuation year %i', async year => {
    const { admin } = setup()
    const response = await admin('POST', '/api/admin/real_estate', { ...home, valuation_year: year, value: 1, currency: 'USD' })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_value', params: { column: 'valuation_year' } } })
  })

  it('a shared edit opened before another tab changed the price is refused, not saved over it', async () => {
    const { request, rows } = setup()
    const opened = { purchase_date: '2019-01-01', purchase_price: 100000, purchase_currency: 'USD', member: null }
    expect((await request('update', { name: 'Home', values: { ...home, purchase_price: 110000 }, expected: opened })).status).toBe(200)
    expect(await code(await request('update', { name: 'Home', values: { ...home, member: 'Robin' }, expected: opened }))).toEqual([409, 'row_changed'])
    expect(rows('real_estate')[0]).toMatchObject({ purchase_price: 110000, member: null })
  })
})

describe('atomic property operations', () => {
  it('updates shared fields on every stored valuation and preserves valuation-specific data', async () => {
    const { request, rows } = setup()
    const other = rows('real_estate')[2]
    const response = await request('update', { name: 'Home', values })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ saved: true })
    expect(rows('real_estate')).toEqual([
      { rowid: 1, ...values, valuation_year: 2023, value: 120000, currency: 'USD', notes: 'First' },
      { rowid: 2, ...values, valuation_year: 2024, value: 130000, currency: 'EUR', notes: 'Second' },
      other,
    ])
    expect(rows('change_log').map(r => [r.table_name, r.row_id, r.op])).toEqual([['real_estate', 1, 'update'], ['real_estate', 2, 'update']])
  })

  it('rejects an overlapping-year rename and restores all rows and journals', async () => {
    const { request, snapshot } = setup()
    const before = snapshot()
    expect((await request('update', { name: 'Home', values: { ...values, name: 'Other' } })).status).toBe(409)
    expect(snapshot()).toEqual(before)
  })

  it('continues to allow a rename into a property with disjoint valuation years', async () => {
    const { db, request, rows } = setup()
    db.sqlite.exec("UPDATE real_estate SET valuation_year = 2022 WHERE name = 'Other'")
    const other = rows('real_estate')[2]
    expect((await request('update', { name: 'Home', values: { ...values, name: 'Other', member: null } })).status).toBe(200)
    expect(rows('real_estate').map(r => [r.name, r.valuation_year])).toEqual([['Other', 2023], ['Other', 2024], ['Other', 2022]])
    expect(rows('real_estate')[2]).toEqual(other)
  })

  it.each(['update', 'delete'] as const)('a late %s journal failure rolls back the whole property operation', async operation => {
    const { db, request, snapshot } = setup()
    const before = snapshot()
    db.sqlite.exec("CREATE TRIGGER fail_journal BEFORE INSERT ON change_log WHEN NEW.row_id = 2 BEGIN SELECT RAISE(ABORT, 'injected'); END")
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await request(operation, { name: 'Home', ...(operation === 'update' ? { values } : {}) })).status).toBe(500)
    expect(snapshot()).toEqual(before)
  })

  it('deletes every server valuation and its journal entries together, preserving other properties', async () => {
    const { request, rows } = setup()
    const other = rows('real_estate')[2]
    const response = await request('delete', { name: 'Home' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: true })
    expect(rows('real_estate')).toEqual([other])
    expect(rows('change_log').map(r => [r.table_name, r.row_id, r.op])).toEqual([['real_estate', 1, 'delete'], ['real_estate', 2, 'delete']])
  })

  it('a late valuation deletion failure restores every valuation and journal', async () => {
    const { db, request, snapshot } = setup()
    const before = snapshot()
    db.sqlite.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON real_estate WHEN OLD.valuation_year = 2024 BEGIN SELECT RAISE(ABORT, 'injected'); END")
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await request('delete', { name: 'Home' })).status).toBe(500)
    expect(snapshot()).toEqual(before)
  })

  it.each(['update', 'delete'] as const)('requires edit rights for %s', async operation => {
    const { db, auth, request, snapshot } = setup()
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Viewer'); INSERT INTO users (member, telegram_id, can_edit, can_vote, can_manage, created_at, updated_at) VALUES ('Viewer', '101', 0, 1, 0, '2020-01-01', '2020-01-01')")
    auth.set({ mode: 'telegram' })
    const id = Number(db.sqlite.prepare("SELECT id FROM users WHERE member = 'Viewer'").get()!.id)
    const before = snapshot()
    expect((await request(operation, { name: 'Home', ...(operation === 'update' ? { values } : {}) }, await userCookie(auth, id))).status).toBe(403)
    expect(snapshot()).toEqual(before)
  })

  it.each(['update', 'delete'] as const)('reselects all valuations for %s after a concurrent insertion', async operation => {
    const { db, request, rows } = setup()
    const guarded = db.guardedBatch.bind(db)
    vi.spyOn(db, 'guardedBatch').mockImplementationOnce(async (token, statements) => {
      db.sqlite.exec("INSERT INTO real_estate (name, purchase_date, purchase_price, purchase_currency, valuation_year, value, currency, notes) VALUES ('Home', '2019-01-01', 100000, 'USD', 2025, 140000, 'USD', 'New')")
      return guarded(token, statements)
    })
    expect((await request(operation, { name: 'Home', ...(operation === 'update' ? { values } : {}) })).status).toBe(200)
    expect(rows('real_estate').some(r => r.name === 'Home')).toBe(false)
    if (operation === 'update') expect(rows('real_estate').filter(r => r.name === 'Renamed')).toHaveLength(3)
    else expect(rows('real_estate')).toHaveLength(1)
    expect(rows('change_log')).toHaveLength(3)
  })

  it('rejects unknown fields and valuation fields in the shared update', async () => {
    const { request, snapshot } = setup()
    const before = snapshot()
    for (const extra of ['valuation_year', 'value', 'currency', 'notes', 'rowid', 'unknown']) {
      expect((await request('update', { name: 'Home', values: { ...values, [extra]: 'bad' } })).status).toBe(400)
    }
    expect((await request('update', { name: 'Home', values, unknown: true })).status).toBe(400)
    expect((await request('delete', { name: 'Home', values })).status).toBe(400)
    expect(snapshot()).toEqual(before)
  })

  it('validates the complete body and missing property without changing stored data', async () => {
    const { request, snapshot } = setup()
    const before = snapshot()
    for (const body of [null, [], {}, { name: 1, values }, { name: '', values }, { name: 'Home', values: [] },
      ...Object.keys(values).map(key => ({ name: 'Home', values: Object.fromEntries(Object.entries(values).filter(([field]) => field !== key)) })),
      { name: 'Home', values: { ...values, name: '' } }, { name: 'Home', values: { ...values, purchase_price: '123' } },
      { name: 'Home', values: { ...values, purchase_date: '' } }, { name: 'Home', values: { ...values, member: 1 } },
    ]) expect((await request('update', body)).status).toBe(400)
    for (const operation of ['update', 'delete'] as const) expect((await request(operation, { name: 'Missing', ...(operation === 'update' ? { values } : {}) })).status).toBe(404)
    expect(snapshot()).toEqual(before)
  })
})
