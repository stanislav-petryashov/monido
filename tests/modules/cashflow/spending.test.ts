import { buildMoveAccountLines, saveSourceMonth } from '../../../src/modules/cashflow/spending'
import { STATEMENT_SOURCE_PREFIX } from '../../../src/domain/statements'
import type { Actor } from '../../../src/server/http'
import { createApp } from '../../../src/server/app'
import type { SpendingRecords } from '../../../src/domain/api'
import { createTestDb, testConfig, type TestDb } from '../../helpers/db'
import { ru } from '../../helpers/i18n'
import { authFor } from '../../helpers/auth'
import { FAMILY_PASSWORD, familyCookie, userCookie } from '../../helpers/session'

const HEADERS = { 'Content-Type': 'application/json' }
const MONTH = '2024-03'

function setup(db: TestDb = createTestDb(), env: Record<string, string> = { password: FAMILY_PASSWORD }) {
  const auth = authFor(testConfig(env))
  const app = createApp({ db, config: testConfig(env), auth })
  const call = async (method: string, path: string, body?: unknown, cookie?: string) =>
    app.request(path, { method, headers: { ...HEADERS, Cookie: cookie ?? await familyCookie(auth) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const records = async (method: string, path: string, body?: unknown) => {
    const res = await call(method, path, body)
    expect(res.status).toBe(200)
    return await res.json() as SpendingRecords
  }
  const failure = async (method: string, path: string, body?: unknown) => {
    const res = await call(method, path, body)
    return [res.status, ((await res.json()) as { error: { code: string } }).error.code] as const
  }
  const category = async (name: string, kind = 'optional') => {
    const after = await records('POST', '/api/spending/categories', { name, kind })
    return after.categories.find(c => c.name === name)!.id
  }
  return { db, app, auth, call, records, failure, category }
}

const totalsOf = (r: SpendingRecords, month: string, source: string) => r.sources.find(s => s.month === month && s.source === source)?.totals
const logOf = (db: TestDb, table: string) =>
  db.sqlite.prepare('SELECT actor, op, row_id FROM change_log WHERE table_name = ? ORDER BY id').all(table) as { actor: string; op: string; row_id: number }[]

describe('spending months and sources', () => {
  it('saving the same month and source again replaces its totals', async () => {
    const { records, category } = setup()
    const food = await category('Food', 'mandatory')
    const fun = await category('Fun')
    const path = `/api/spending/months/${MONTH}/Bank%20A`
    const first = await records('PUT', path, { items: [{ categoryId: food, amount: 300, currency: 'USD' }, { categoryId: fun, amount: 50, currency: 'USD' }] })
    expect(totalsOf(first, MONTH, 'Bank A')).toEqual([{ currency: 'USD', amount: 350 }])
    const second = await records('PUT', path, { items: [{ categoryId: food, amount: 120, currency: 'USD' }] })
    expect(totalsOf(second, MONTH, 'Bank A')).toEqual([{ currency: 'USD', amount: 120 }])
    expect(second.sources).toHaveLength(1)
  })

  it('a save naming the lines it started from (base) is refused with 409 row_changed when they changed meanwhile', async () => {
    const { db, records, failure, category } = setup()
    const food = await category('Food', 'mandatory')
    const path = `/api/spending/months/${MONTH}/Cash`
    const first = [{ categoryId: food, amount: 300, currency: 'USD' }]
    await records('PUT', path, { items: first, base: [] })
    // another device saved 120 meanwhile; this one still holds the 300 it read
    await records('PUT', path, { items: [{ categoryId: food, amount: 120, currency: 'USD' }], base: first })
    expect(await failure('PUT', path, { items: [{ categoryId: food, amount: 50, currency: 'USD' }], base: first })).toEqual([409, 'row_changed'])
    expect(db.sqlite.prepare('SELECT amount FROM category_spending').all()).toEqual([{ amount: 120 }])
    expect(await failure('PUT', path, { items: [], base: 'x' })).toEqual([400, 'invalid_items'])
  })

  it('GET returns the stored lines of each source and month, so the screen can edit them', async () => {
    const { records, category } = setup()
    const food = await category('Food', 'mandatory')
    const fun = await category('Fun')
    await records('PUT', `/api/spending/months/${MONTH}/Bank%20A`, {
      items: [{ categoryId: fun, amount: 50.5, currency: 'USD' }, { categoryId: food, amount: 300, currency: 'USD' }, { categoryId: food, amount: 20, currency: 'EUR' }],
    })
    await records('PUT', `/api/spending/months/${MONTH}/Card%20B`, { items: [{ categoryId: food, amount: 40, currency: 'EUR' }] })
    const got = await records('GET', '/api/spending')
    expect(got.sources.map(s => [s.source, s.items])).toEqual([
      ['Bank A', [{ categoryId: food, amount: 20, currency: 'EUR' }, { categoryId: food, amount: 300, currency: 'USD' }, { categoryId: fun, amount: 50.5, currency: 'USD' }]],
      ['Card B', [{ categoryId: food, amount: 40, currency: 'EUR' }]],
    ])
  })

  it('a second source for the month adds its own totals', async () => {
    const { db, records, category } = setup()
    const food = await category('Food')
    await records('PUT', `/api/spending/months/${MONTH}/Bank%20A`, { items: [{ categoryId: food, amount: 100, currency: 'USD' }] })
    const both = await records('PUT', `/api/spending/months/${MONTH}/Card%20B`, { items: [{ categoryId: food, amount: 40, currency: 'EUR' }] })
    expect(totalsOf(both, MONTH, 'Bank A')).toEqual([{ currency: 'USD', amount: 100 }])
    expect(totalsOf(both, MONTH, 'Card B')).toEqual([{ currency: 'EUR', amount: 40 }])
    expect(db.sqlite.prepare('SELECT date, source FROM category_spending ORDER BY source').all()).toEqual([
      { date: `${MONTH}-01`, source: 'Bank A' }, { date: `${MONTH}-01`, source: 'Card B' },
    ])
  })

  it('deleting a source removes only its rows of the month', async () => {
    const { records, category } = setup()
    const food = await category('Food')
    await records('PUT', `/api/spending/months/${MONTH}/A`, { items: [{ categoryId: food, amount: 1, currency: 'USD' }] })
    await records('PUT', `/api/spending/months/${MONTH}/B`, { items: [{ categoryId: food, amount: 2, currency: 'USD' }] })
    const after = await records('DELETE', `/api/spending/months/${MONTH}/A`)
    expect(after.sources.map(s => s.source)).toEqual(['B'])
  })

  it('every write is journaled with the actor', async () => {
    const { db, records, category } = setup()
    const food = await category('Food')
    await records('PUT', `/api/spending/months/${MONTH}/A`, { items: [{ categoryId: food, amount: 1, currency: 'USD' }] })
    await records('PUT', `/api/spending/months/${MONTH}/A`, { items: [{ categoryId: food, amount: 2, currency: 'USD' }] })
    await records('PUT', '/api/spending/manual', { amount: 900, currency: 'USD' })
    await records('PUT', '/api/spending/manual', { amount: 950, currency: 'USD' })
    await records('PATCH', `/api/spending/categories/${food}`, { name: 'Groceries' })
    await records('DELETE', `/api/spending/months/${MONTH}/A`)
    await records('DELETE', '/api/spending/manual')
    expect(logOf(db, 'spending_categories')).toEqual([
      { actor: 'family', op: 'insert', row_id: food }, { actor: 'family', op: 'update', row_id: food },
    ])
    expect(logOf(db, 'category_spending').map(e => [e.actor, e.op])).toEqual([
      ['family', 'insert'], ['family', 'delete'], ['family', 'insert'], ['family', 'delete'],
    ])
    expect(logOf(db, 'manual_mandatory_spending').map(e => e.op)).toEqual(['insert', 'update', 'delete'])
    const last = db.sqlite.prepare("SELECT before_json, after_json FROM change_log WHERE table_name = 'category_spending' AND op = 'insert' ORDER BY id").all() as { before_json: string | null; after_json: string }[]
    expect(JSON.parse(last[1].after_json)).toMatchObject({ amount: 2, currency: 'USD', source: 'A', date: `${MONTH}-01` })
  })

  it('a user without the enter-data right gets 403 no_right_edit and nothing is written', async () => {
    const db = createTestDb()
    const annaId = Number(db.sqlite.prepare("INSERT INTO users (member, telegram_id, can_edit, created_at, updated_at) VALUES ('Anna', '77', 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')").run().lastInsertRowid)
    const { call, db: same, auth } = setup(db, { mode: 'telegram', TELEGRAM_BOT_TOKEN: '1:x' })
    const anna = await userCookie(auth, annaId)
    expect((await call('GET', '/api/spending', undefined, anna)).status).toBe(200)
    for (const [method, path, body] of [
      ['POST', '/api/spending/categories', { name: 'X', kind: 'optional' }],
      ['PATCH', '/api/spending/categories/1', { name: 'X' }],
      ['DELETE', '/api/spending/categories/1'],
      ['PUT', `/api/spending/months/${MONTH}/A`, { items: [] }],
      ['DELETE', `/api/spending/months/${MONTH}/A`],
      ['PUT', '/api/spending/manual', { amount: 1, currency: 'USD' }],
      ['DELETE', '/api/spending/manual'],
    ] as const) {
      const res = await call(method, path, body, anna)
      expect([method, path, res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([method, path, 403, 'no_right_edit'])
    }
    expect(same.sqlite.prepare("SELECT COUNT(*) AS n FROM spending_categories WHERE kind <> 'loan_payment'").get()).toEqual({ n: 0 })
    expect((await call('GET', '/api/spending/nowhere', undefined, anna)).status).toBe(404)
    expect((await call('PATCH', '/api/spending', {}, anna)).status).toBe(405)
  })

  it('validates the month, the source, the items, the currency and the amount', async () => {
    const { failure, category, db } = setup()
    const food = await category('Food')
    const item = { categoryId: food, amount: 5, currency: 'USD' }
    const put = (month: string, source: string, items: unknown) => failure('PUT', `/api/spending/months/${month}/${source}`, { items })
    expect(await put('2024-13', 'A', [])).toEqual([400, 'invalid_month'])
    expect(await put('2024-3', 'A', [])).toEqual([400, 'invalid_month'])
    expect(await put('2999-01', 'A', [])).toEqual([400, 'invalid_month'])
    expect(await put('2024-03', 'A', [{ ...item, currency: 'XXX' }])).toEqual([400, 'unknown_currency'])
    expect(await put('2024-03', 'A', [{ ...item, amount: -1 }])).toEqual([400, 'invalid_amount'])
    expect(await put('2024-03', 'A', [{ ...item, amount: 'many' }])).toEqual([400, 'invalid_amount'])
    expect(await put('2024-03', 'A', [{ ...item, categoryId: 999 }])).toEqual([400, 'unknown_category'])
    expect(await put('2024-03', 'A', [item, { ...item, amount: 7 }])).toEqual([400, 'duplicate_item'])
    expect(await put('2024-03', 'A', 'nope')).toEqual([400, 'invalid_items'])
    expect(await put('2024-03', 'A', Array.from({ length: 101 }, (_, i) => ({ ...item, currency: i % 2 ? 'USD' : 'EUR', categoryId: food + i })))).toEqual([400, 'invalid_items'])
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM category_spending').get()).toEqual({ n: 0 })
  })

  it('the same category in two currencies is two items', async () => {
    const { records, category } = setup()
    const food = await category('Food')
    const saved = await records('PUT', `/api/spending/months/${MONTH}/A`, { items: [
      { categoryId: food, amount: 5, currency: 'USD' }, { categoryId: food, amount: 6, currency: 'EUR' },
    ] })
    expect(totalsOf(saved, MONTH, 'A')).toEqual([{ currency: 'EUR', amount: 6 }, { currency: 'USD', amount: 5 }])
  })

  it('an item on the reserved loan_payments category is saved and appears in the totals', async () => {
    const { records, db } = setup()
    const reserved = (db.sqlite.prepare("SELECT id FROM spending_categories WHERE kind = 'loan_payment'").get() as { id: number }).id
    const saved = await records('PUT', `/api/spending/months/${MONTH}/A`, { items: [{ categoryId: reserved, amount: 700, currency: 'USD' }] })
    expect(totalsOf(saved, MONTH, 'A')).toEqual([{ currency: 'USD', amount: 700 }])
  })

  it('the source is trimmed, 1–60 characters, without control or format characters', async () => {
    const { records, failure, category } = setup()
    const food = await category('Food')
    const items = [{ categoryId: food, amount: 1, currency: 'USD' }]
    const saved = await records('PUT', `/api/spending/months/${MONTH}/${encodeURIComponent('  Café Card  ')}`, { items })
    expect(saved.sources.map(s => s.source)).toEqual(['Café Card'])
    // trimmed: the same source again replaces it
    const again = await records('PUT', `/api/spending/months/${MONTH}/${encodeURIComponent('Café Card')}`, { items })
    expect(again.sources).toHaveLength(1)
    const put = (source: string) => failure('PUT', `/api/spending/months/${MONTH}/${source}`, { items })
    expect(await put('%20%20')).toEqual([400, 'invalid_source'])
    expect(await put('a'.repeat(61))).toEqual([400, 'invalid_source'])
    expect(await put('a%00b')).toEqual([400, 'invalid_source'])
    expect(await put('a%0Ab')).toEqual([400, 'invalid_source'])
    // format characters: a bidi override and a zero-width space
    expect(await put('a%E2%80%AEb')).toEqual([400, 'invalid_source'])
    expect(await put('a%E2%80%8Bb')).toEqual([400, 'invalid_source'])
    expect(await put('%E0%A4%A')).toEqual([400, 'invalid_source'])
    expect(await failure('DELETE', `/api/spending/months/${MONTH}/%20`)).toEqual([400, 'invalid_source'])
    expect((await records('PUT', `/api/spending/months/${MONTH}/${'a'.repeat(60)}`, { items })).sources).toHaveLength(2)
  })

  it('the legacy statement prefix is refused for a new write by any caller, and a legacy source can still be deleted', async () => {
    const { records, failure, category, db } = setup()
    const food = await category('Food')
    const items = [{ categoryId: food, amount: 1, currency: 'USD' }]
    const typed = `${STATEMENT_SOURCE_PREFIX}x`
    expect(await failure('PUT', `/api/spending/months/${MONTH}/${encodeURIComponent(typed)}`, { items })).toEqual([400, 'invalid_source'])
    expect(await failure('PUT', `/api/spending/months/${MONTH}/${encodeURIComponent(`  ${typed}`)}`, { items })).toEqual([400, 'invalid_source'])
    expect((await records('PUT', `/api/spending/months/${MONTH}/Statements`, { items })).sources.map(s => s.source)).toEqual(['Statements'])
    const actor: Actor = { name: 'tester', source: 'mcp', rights: { edit: true, vote: false, manage: false }, userId: null }
    const now = new Date('2024-06-15T00:00:00Z')
    await expect(saveSourceMonth(db, actor, MONTH, typed, { items }, now)).rejects.toMatchObject({ code: 'invalid_source' })
    // a source the statement import wrote before account lines existed stays a free source the screen can remove
    db.sqlite.prepare(`INSERT INTO category_spending (date, category_id, source, amount, currency) VALUES (?, ?, ?, 5, 'USD')`).run(`${MONTH}-01`, food, typed)
    expect((await records('GET', '/api/spending')).sources.map(s => s.source)).toContain(typed)
    expect((await records('DELETE', `/api/spending/months/${MONTH}/${encodeURIComponent(typed)}`)).sources.map(s => s.source)).not.toContain(typed)
  })
})

describe('spending categories', () => {
  it('the reserved loan_payments category cannot be renamed, re-kinded or deleted', async () => {
    const { records, failure, db } = setup()
    const reserved = (db.sqlite.prepare("SELECT id FROM spending_categories WHERE kind = 'loan_payment'").get() as { id: number }).id
    expect((await records('GET', '/api/spending')).categories.some(c => c.id === reserved)).toBe(true)
    expect(await failure('PATCH', `/api/spending/categories/${reserved}`, { name: 'Loans' })).toEqual([409, 'category_reserved'])
    expect(await failure('PATCH', `/api/spending/categories/${reserved}`, { kind: 'optional' })).toEqual([409, 'category_reserved'])
    expect(await failure('DELETE', `/api/spending/categories/${reserved}`)).toEqual([409, 'category_reserved'])
    expect(db.sqlite.prepare('SELECT name, kind FROM spending_categories WHERE id = ?').get(reserved)).toEqual({ name: 'loan_payments', kind: 'loan_payment' })
    // nobody can make a second one
    expect(await failure('POST', '/api/spending/categories', { name: 'Other', kind: 'loan_payment' })).toEqual([400, 'invalid_kind'])
    expect(await failure('POST', '/api/spending/categories', { name: 'Loan_Payments', kind: 'optional' })).toEqual([409, 'category_exists'])
  })

  it('a category in use cannot be deleted; an unused one can', async () => {
    const { records, failure, category } = setup()
    const food = await category('Food')
    const spare = await category('Spare')
    await records('PUT', `/api/spending/months/${MONTH}/A`, { items: [{ categoryId: food, amount: 1, currency: 'USD' }] })
    expect(await failure('DELETE', `/api/spending/categories/${food}`)).toEqual([409, 'category_in_use'])
    const after = await records('DELETE', `/api/spending/categories/${spare}`)
    expect(after.categories.map(c => c.name)).toEqual(['loan_payments', 'Food'])
    expect(await failure('DELETE', `/api/spending/categories/${spare}`)).toEqual([400, 'unknown_category'])
    // a deleted id is not handed out again
    expect(await category('Later')).toBeGreaterThan(spare)
  })

  it('a line entered while a category is being deleted makes it in use, not a name clash', async () => {
    const { db, failure, category } = setup()
    const food = await category('Food')
    // another tab saves a line after the in-use check has read nothing, just before the delete commits
    const enter = () => db.sqlite.prepare(`INSERT INTO category_spending (date, category_id, source, amount, currency) VALUES ('${MONTH}-01', ?, 'A', 1, 'USD')`).run(food)
    const guarded = db.guardedBatch.bind(db)
    const batch = db.batch.bind(db)
    vi.spyOn(db, 'guardedBatch').mockImplementationOnce(async (token, statements) => { enter(); return guarded(token, statements) })
    vi.spyOn(db, 'batch').mockImplementationOnce(async statements => { enter(); return batch(statements) })
    expect(await failure('DELETE', `/api/spending/categories/${food}`)).toEqual([409, 'category_in_use'])
    vi.restoreAllMocks()
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM spending_categories WHERE id = ?').get(food)).toEqual({ n: 1 })
  })

  it('deleting a source with the lines it showed (base) is refused when they changed meanwhile', async () => {
    const { db, records, failure, category } = setup()
    const food = await category('Food')
    const path = `/api/spending/months/${MONTH}/A`
    const shown = [{ categoryId: food, amount: 1, currency: 'USD' }]
    await records('PUT', path, { items: shown })
    // another tab saved newer lines; this one still shows the old ones
    await records('PUT', path, { items: [{ categoryId: food, amount: 2, currency: 'USD' }] })
    expect(await failure('DELETE', path, { base: shown })).toEqual([409, 'row_changed'])
    expect(db.sqlite.prepare('SELECT amount FROM category_spending').all()).toEqual([{ amount: 2 }])
    expect((await records('DELETE', path, { base: [{ categoryId: food, amount: 2, currency: 'USD' }] })).sources).toEqual([])
  })

  it('a duplicate name is category_exists regardless of case', async () => {
    const { failure, category } = setup()
    const food = await category('Food')
    const other = await category('Other')
    expect(await failure('POST', '/api/spending/categories', { name: 'fOOD ', kind: 'optional' })).toEqual([409, 'category_exists'])
    expect(await failure('PATCH', `/api/spending/categories/${other}`, { name: 'FOOD' })).toEqual([409, 'category_exists'])
    // renaming a category to its own name in another case is fine
    expect(food).toBeGreaterThan(0)
  })

  it('a duplicate name is category_exists regardless of case beyond ASCII too', async () => {
    const { failure, category } = setup()
    // "Groceries" in Russian: SQLite's NOCASE folds ASCII letters only
    const groceries = ru('modules.cashflow.spending.defaults.groceries')
    await category(groceries)
    const other = await category('Other')
    expect(await failure('POST', '/api/spending/categories', { name: groceries.toLowerCase(), kind: 'optional' })).toEqual([409, 'category_exists'])
    expect(await failure('PATCH', `/api/spending/categories/${other}`, { name: groceries.toUpperCase() })).toEqual([409, 'category_exists'])
  })

  it('renames and re-kinds a category; the name is trimmed and checked', async () => {
    const { records, failure, category } = setup()
    const food = await category('Food')
    const renamed = await records('PATCH', `/api/spending/categories/${food}`, { name: ' food ', kind: 'mandatory' })
    expect(renamed.categories.find(c => c.id === food)).toEqual({ id: food, name: 'food', kind: 'mandatory', flow: 'expense', oneOff: false })
    expect(await failure('PATCH', `/api/spending/categories/${food}`, {})).toEqual([400, 'no_valid_columns'])
    expect(await failure('PATCH', `/api/spending/categories/${food}`, { name: '  ' })).toEqual([400, 'invalid_name'])
    expect(await failure('PATCH', `/api/spending/categories/${food}`, { kind: 'weird' })).toEqual([400, 'invalid_kind'])
    expect(await failure('PATCH', '/api/spending/categories/999', { name: 'X' })).toEqual([400, 'unknown_category'])
    expect(await failure('POST', '/api/spending/categories', { name: 'a'.repeat(61), kind: 'optional' })).toEqual([400, 'invalid_name'])
    expect(await failure('POST', '/api/spending/categories', { name: 'Tab\there', kind: 'optional' })).toEqual([400, 'invalid_name'])
    expect(await failure('POST', '/api/spending/categories', { name: 'Zero\u200Bwidth', kind: 'optional' })).toEqual([400, 'invalid_name'])
    expect(await failure('PATCH', `/api/spending/categories/${food}`, { name: 'Flip\u202Eed' })).toEqual([400, 'invalid_name'])
  })
})

describe('the manual mandatory amount', () => {
  it('is stored with the server time and cleared by DELETE', async () => {
    const { records, failure } = setup()
    expect((await records('GET', '/api/spending')).manual).toBeNull()
    const before = Date.now()
    const saved = await records('PUT', '/api/spending/manual', { amount: 1800, currency: 'EUR' })
    expect(saved.manual).toMatchObject({ amount: 1800, currency: 'EUR' })
    expect(Date.parse(saved.manual!.updated_at)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(saved.manual!.updated_at)).toBeLessThanOrEqual(Date.now())
    const replaced = await records('PUT', '/api/spending/manual', { amount: 2000, currency: 'USD', updated_at: '1999-01-01T00:00:00.000Z' })
    expect(replaced.manual).toMatchObject({ amount: 2000, currency: 'USD' })
    expect(replaced.manual!.updated_at).not.toBe('1999-01-01T00:00:00.000Z')
    expect(await failure('PUT', '/api/spending/manual', { amount: -5, currency: 'USD' })).toEqual([400, 'invalid_amount'])
    expect(await failure('PUT', '/api/spending/manual', { amount: 5, currency: 'XXX' })).toEqual([400, 'unknown_currency'])
    expect((await records('DELETE', '/api/spending/manual')).manual).toBeNull()
    // clearing what is not there is fine and writes no journal entry
    expect((await records('DELETE', '/api/spending/manual')).manual).toBeNull()
  })
})

describe('the module switch', () => {
  it('the generic rows API still refuses these tables', async () => {
    const { call } = setup()
    const res = await call('POST', '/api/admin/spending_categories', { name: 'X', kind: 'optional' })
    expect([res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([409, 'spending_by_route'])
  })
})

describe('categories by flow', () => {
  it('adds an income category without a kind, optionally one-off; an expense one still needs its kind', async () => {
    const { db, records, failure } = setup()
    const added = await records('POST', '/api/spending/categories', { name: 'Bonus', flow: 'active', oneOff: true })
    expect(added.categories.find(c => c.name === 'Bonus')).toMatchObject({ flow: 'active', oneOff: true })
    await records('POST', '/api/spending/categories', { name: 'Dividends', flow: 'passive' })
    await records('POST', '/api/spending/categories', { name: 'Food', kind: 'mandatory' })
    // the stored kind of an income category is the column default, which nothing reads for it
    expect(db.sqlite.prepare("SELECT name, kind, flow, one_off FROM spending_categories WHERE id > 1 ORDER BY id").all()).toEqual([
      { name: 'Bonus', kind: 'optional', flow: 'active', one_off: 1 },
      { name: 'Dividends', kind: 'optional', flow: 'passive', one_off: 0 },
      { name: 'Food', kind: 'mandatory', flow: 'expense', one_off: 0 },
    ])
    expect(await failure('POST', '/api/spending/categories', { name: 'Salary', flow: 'active', kind: 'mandatory' })).toEqual([400, 'invalid_kind'])
    expect(await failure('POST', '/api/spending/categories', { name: 'Salary', flow: 'gift' })).toEqual([400, 'invalid_category_flow'])
    expect(await failure('POST', '/api/spending/categories', { name: 'Rent', kind: 'optional', oneOff: true })).toEqual([400, 'invalid_one_off'])
    // a form sends `oneOff: false` for an expense category too
    expect((await records('POST', '/api/spending/categories', { name: 'Rent', kind: 'optional', oneOff: false })).categories.find(c => c.name === 'Rent')).toMatchObject({ flow: 'expense', oneOff: false })
    expect(await failure('POST', '/api/spending/categories', { name: 'Salary', flow: 'active', oneOff: 'yes' })).toEqual([400, 'invalid_one_off'])
    expect(await failure('POST', '/api/spending/categories', { name: 'Rent' })).toEqual([400, 'invalid_kind'])
  })

  it('the flow is fixed; one-off is edited on an income category, the kind on an expense one', async () => {
    const { records, failure, category } = setup()
    const bonus = (await records('POST', '/api/spending/categories', { name: 'Bonus', flow: 'active' })).categories.find(c => c.name === 'Bonus')!.id
    const food = await category('Food')
    expect(await failure('PATCH', `/api/spending/categories/${bonus}`, { flow: 'expense' })).toEqual([409, 'flow_fixed'])
    expect(await failure('PATCH', `/api/spending/categories/${bonus}`, { kind: 'mandatory' })).toEqual([400, 'invalid_kind'])
    expect(await failure('PATCH', `/api/spending/categories/${food}`, { oneOff: true })).toEqual([400, 'invalid_one_off'])
    expect((await records('PATCH', `/api/spending/categories/${food}`, { oneOff: false })).categories.find(c => c.id === food)).toMatchObject({ oneOff: false })
    const after = await records('PATCH', `/api/spending/categories/${bonus}`, { oneOff: true })
    expect(after.categories.find(c => c.id === bonus)).toMatchObject({ flow: 'active', oneOff: true })
    expect(await failure('PATCH', '/api/spending/categories/1', { oneOff: true })).toEqual([409, 'category_reserved'])
  })
})

describe('an account’s lines by category', () => {
  const CLOSED = '2024-03'
  const OPEN = '2024-04'
  /** A closed March with one account; April open with a draft of the same account (the active total not filled in yet). */
  function withMonths() {
    const s = setup()
    s.db.sqlite.exec(`
      INSERT INTO closed_months (month, closed_at, closed_by) VALUES ('${CLOSED}', 't', 'wizard');
      INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2024-03-31', 'bank', 'Quillmark Bank', 1000, 'EUR', '');
      INSERT INTO monthly_cashflow (date, bank, member, active_income, passive_income, expense, currency) VALUES ('${CLOSED}-01', 'Quillmark Bank', '', 1500, 40, 900, 'EUR');
      INSERT INTO month_drafts (month, payload, updated_at) VALUES ('${OPEN}', '${JSON.stringify({ rows: [
        { name: 'Quillmark Bank', member: '', currency: 'EUR', class: 'bank', balance: 1200, active: null, passive: 10, expense: 700, closing: false, added: false },
      ] })}', 't');
    `)
    return s
  }
  const put = (month: string, items: unknown, account: { bank?: unknown; member?: unknown } = { bank: 'Quillmark Bank', member: '' }) =>
    [`/api/spending/months/${month}/account`, { ...account, items }] as const
  async function categories(records: ReturnType<typeof setup>['records']) {
    await records('POST', '/api/spending/categories', { name: 'Salary', flow: 'active' })
    await records('POST', '/api/spending/categories', { name: 'Interest', flow: 'passive' })
    const all = (await records('POST', '/api/spending/categories', { name: 'Food', kind: 'mandatory' })).categories
    const id = (name: string) => all.find(c => c.name === name)!.id
    return { salary: id('Salary'), interest: id('Interest'), food: id('Food') }
  }

  it('rechecks the account cap when it changes during category preflight', async () => {
    const { db, records, call } = withMonths()
    const { food } = await categories(records)
    const prepare = db.prepare.bind(db)
    let changed = false
    const read = vi.spyOn(db, 'prepare').mockImplementation(sql => {
      if (!changed && sql.startsWith('SELECT rowid, date, bank, member, category_id, amount FROM flow_lines')) {
        changed = true
        db.sqlite.exec("UPDATE monthly_cashflow SET expense = 1 WHERE bank = 'Quillmark Bank'")
      }
      return prepare(sql)
    })
    const response = await call('PUT', ...put(CLOSED, [{ categoryId: food, amount: 5 }]))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'lines_exceed_total' } })
    expect(db.sqlite.prepare('SELECT * FROM flow_lines').all()).toEqual([])
    read.mockRestore()
  })

  it('a closed month: the lines are capped by its cash-flow row, journaled, and listed with what they allocate', async () => {
    const { db, records, failure } = withMonths()
    const { salary, interest, food } = await categories(records)
    const saved = await records('PUT', ...put(CLOSED, [{ categoryId: salary, amount: 1200 }, { categoryId: food, amount: 300.5 }]))
    expect(saved.accounts.find(a => a.month === CLOSED)).toEqual({
      month: CLOSED, bank: 'Quillmark Bank', member: '', currency: 'EUR', totals: { active: 1500, passive: 40, expense: 900 },
      items: [{ categoryId: salary, amount: 1200 }, { categoryId: food, amount: 300.5 }], allocated: { active: 1200, passive: 0, expense: 300.5 }, orphaned: false,
    })
    expect(await failure('PUT', ...put(CLOSED, [{ categoryId: interest, amount: 40.01 }]))).toEqual([409, 'lines_exceed_total'])
    const res = await (await setupCall(db))('PUT', ...put(CLOSED, [{ categoryId: salary, amount: 1600 }]))
    expect(((await res.json()) as { error: { params: unknown } }).error.params).toEqual({ flow: 'active', lines: 1600, total: 1500 })
    expect(logOf(db, 'flow_lines').map(e => e.op)).toEqual(['insert', 'insert'])
    // saving again replaces; an empty list clears
    await records('PUT', ...put(CLOSED, [{ categoryId: interest, amount: 40 }]))
    const cleared = await records('PUT', ...put(CLOSED, []))
    expect(cleared.accounts.find(a => a.month === CLOSED)?.items).toEqual([])
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM flow_lines').get()).toEqual({ n: 0 })
    expect(logOf(db, 'flow_lines').map(e => e.op)).toEqual(['insert', 'insert', 'delete', 'delete', 'insert', 'delete'])
  })

  it('account lines naming the lines they started from (base) are refused with 409 row_changed when they changed meanwhile', async () => {
    const { db, records, failure } = withMonths()
    const { food } = await categories(records)
    const read = [{ categoryId: food, amount: 300 }]
    await records('PUT', ...put(CLOSED, read))
    const [path, body] = put(CLOSED, [{ categoryId: food, amount: 100 }])
    // Claude filed 250 meanwhile
    db.sqlite.exec('UPDATE flow_lines SET amount = 250')
    expect(await failure('PUT', path, { ...body, base: read })).toEqual([409, 'row_changed'])
    expect(db.sqlite.prepare('SELECT amount FROM flow_lines').all()).toEqual([{ amount: 250 }])
    await records('PUT', path, { ...body, base: [{ categoryId: food, amount: 250 }] })
    expect(db.sqlite.prepare('SELECT amount FROM flow_lines').all()).toEqual([{ amount: 100 }])
  })

  it('the open month: capped by the draft row; a total not filled in yet caps nothing', async () => {
    const { records, failure } = withMonths()
    const { salary, interest, food } = await categories(records)
    const saved = await records('PUT', ...put(OPEN, [{ categoryId: salary, amount: 99999 }, { categoryId: food, amount: 700 }]))
    expect(saved.accounts.find(a => a.month === OPEN)).toMatchObject({ totals: { active: null, passive: 10, expense: 700 }, allocated: { active: 99999, passive: 0, expense: 700 }, orphaned: false })
    expect(await failure('PUT', ...put(OPEN, [{ categoryId: food, amount: 700.01 }]))).toEqual([409, 'lines_exceed_total'])
    expect(await failure('PUT', ...put(OPEN, [{ categoryId: interest, amount: 11 }]))).toEqual([409, 'lines_exceed_total'])
    // the accounts are listed newest month first
    expect(saved.accounts.map(a => a.month)).toEqual([OPEN, CLOSED])
  })

  it('an account the month does not have, or a month that is neither closed nor being closed, is 409 account_not_in_month', async () => {
    const { db, records, failure } = withMonths()
    const { food } = await categories(records)
    expect(await failure('PUT', ...put(CLOSED, [{ categoryId: food, amount: 1 }], { bank: 'Other Bank', member: '' }))).toEqual([409, 'account_not_in_month'])
    expect(await failure('PUT', ...put(OPEN, [{ categoryId: food, amount: 1 }], { bank: 'Quillmark Bank', member: 'Robin' }))).toEqual([409, 'account_not_in_month'])
    expect(await failure('PUT', ...put('2024-02', [{ categoryId: food, amount: 1 }]))).toEqual([409, 'account_not_in_month'])
    db.sqlite.exec("INSERT INTO members (name) VALUES ('Robin'); INSERT INTO monthly_cashflow (date, bank, member, active_income, passive_income, expense, currency) VALUES ('2024-03-01', 'Quillmark Bank', 'Robin', 0, 0, 5, 'USD')")
    expect((await records('PUT', ...put(CLOSED, [{ categoryId: food, amount: 5 }], { bank: 'Quillmark Bank', member: 'Robin' }))).accounts.find(a => a.month === CLOSED && a.member === 'Robin')?.items).toEqual([{ categoryId: food, amount: 5 }])
  })

  it('validates the month, the account and the items; the reserved category and an unknown one are refused', async () => {
    const { records, failure } = withMonths()
    const { salary } = await categories(records)
    expect(await failure('PUT', ...put('2999-01', []))).toEqual([400, 'invalid_month'])
    expect(await failure('PUT', ...put(CLOSED, [], { bank: '  ', member: '' }))).toEqual([400, 'invalid_account'])
    expect(await failure('PUT', ...put(CLOSED, [], { bank: 'Quillmark Bank' }))).toEqual([400, 'invalid_account'])
    expect(await failure('PUT', ...put(CLOSED, [], { bank: 'Quillmark Bank', member: 'Zero​width' }))).toEqual([400, 'invalid_account'])
    expect(await failure('PUT', ...put(CLOSED, 'nope'))).toEqual([400, 'invalid_items'])
    expect(await failure('PUT', ...put(CLOSED, [{ categoryId: 1, amount: 5 }]))).toEqual([400, 'invalid_category_flow'])
    expect(await failure('PUT', ...put(CLOSED, [{ categoryId: 999, amount: 5 }]))).toEqual([400, 'unknown_category'])
    expect(await failure('PUT', ...put(CLOSED, [{ categoryId: salary, amount: -1 }]))).toEqual([400, 'invalid_amount'])
    expect(await failure('PUT', ...put(CLOSED, [{ categoryId: salary, amount: 1 }, { categoryId: salary, amount: 2 }]))).toEqual([400, 'duplicate_item'])
  })

  it('an income category is refused for a free source; a category with lines cannot be deleted', async () => {
    const { records, failure } = withMonths()
    const { salary } = await categories(records)
    expect(await failure('PUT', `/api/spending/months/${CLOSED}/Card`, { items: [{ categoryId: salary, amount: 5, currency: 'USD' }] })).toEqual([400, 'invalid_category_flow'])
    await records('PUT', ...put(CLOSED, [{ categoryId: salary, amount: 5 }]))
    expect(await failure('DELETE', `/api/spending/categories/${salary}`)).toEqual([409, 'category_in_use'])
  })

  it('lists lines whose account row is gone as orphaned, without totals', async () => {
    const { db, records } = withMonths()
    const { food } = await categories(records)
    await records('PUT', ...put(CLOSED, [{ categoryId: food, amount: 5 }]))
    db.sqlite.exec("DELETE FROM monthly_cashflow WHERE bank = 'Quillmark Bank'")
    const got = await records('GET', '/api/spending')
    expect(got.accounts.find(a => a.month === CLOSED)).toEqual({
      month: CLOSED, bank: 'Quillmark Bank', member: '', currency: null, totals: null, items: [{ categoryId: food, amount: 5 }], allocated: { active: 0, passive: 0, expense: 5 }, orphaned: true,
    })
  })

  it('an empty list clears lines whose account row is gone (nothing to cap); a non-empty one is still refused', async () => {
    const { db, records, failure } = withMonths()
    const { food } = await categories(records)
    await records('PUT', ...put(CLOSED, [{ categoryId: food, amount: 5 }]))
    db.sqlite.exec("DELETE FROM monthly_cashflow WHERE bank = 'Quillmark Bank'")
    expect(await failure('PUT', ...put(CLOSED, [{ categoryId: food, amount: 5 }]))).toEqual([409, 'account_not_in_month'])
    const cleared = await records('PUT', ...put(CLOSED, []))
    expect(cleared.accounts.filter(a => a.month === CLOSED)).toEqual([])
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM flow_lines').get()).toEqual({ n: 0 })
  })

  it('a user without the enter-data right cannot save lines', async () => {
    const db = createTestDb()
    const annaId = Number(db.sqlite.prepare("INSERT INTO users (member, telegram_id, can_edit, created_at, updated_at) VALUES ('Anna', '77', 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')").run().lastInsertRowid)
    const { call, auth } = setup(db, { mode: 'telegram', TELEGRAM_BOT_TOKEN: '1:x' })
    const res = await call('PUT', ...put(CLOSED, []), await userCookie(auth, annaId))
    expect([res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([403, 'no_right_edit'])
  })
})

/** A bare caller over an existing database (to read an error's params). */
async function setupCall(db: TestDb) {
  return setup(db).call
}

describe('an account rename', () => {
  it('plans account-line moves without writing before the caller commits', async () => {
    const db = createTestDb()
    try {
      const actor: Actor = { name: 'editor', source: 'admin', rights: { edit: true, vote: false, manage: false }, userId: null }
      db.sqlite.exec("INSERT INTO spending_categories (name, kind) VALUES ('Food', 'mandatory'); INSERT INTO flow_lines SELECT '2024-03-01', 'Old', '', id, 3 FROM spending_categories WHERE name = 'Food'")
      const before = db.sqlite.prepare('SELECT * FROM flow_lines').all()
      const token = db.readToken()
      const statements = await buildMoveAccountLines(db, actor, { name: 'Old', member: '' }, { name: 'New', member: '' })
      expect(db.sqlite.prepare('SELECT * FROM flow_lines').all()).toEqual(before)
      expect(logOf(db, 'flow_lines')).toEqual([])
      await db.guardedBatch(token, statements)
      expect(db.sqlite.prepare('SELECT bank, member, amount FROM flow_lines').all()).toEqual([{ bank: 'New', member: '', amount: 3 }])
      expect(logOf(db, 'flow_lines')).toEqual([{ actor: 'editor', op: 'update', row_id: 1 }])
    } finally { db.close() }
  })

  it('moves the account’s lines of every month to the new name, journaled; a taken key stays behind', async () => {
    const { db, call, records } = setup()
    const food = await category('Food')
    async function category(name: string) {
      return (await records('POST', '/api/spending/categories', { name, kind: 'mandatory' })).categories.find(c => c.name === name)!.id
    }
    db.sqlite.exec(`
      INSERT INTO flow_lines (date, bank, member, category_id, amount) VALUES
        ('2024-02-01', 'Old', 'Robin', ${food}, 1), ('2024-03-01', 'Old', 'Robin', ${food}, 2), ('2024-03-01', 'New', 'Robin', ${food}, 9),
        ('2024-03-01', 'Old', '', ${food}, 3);
      INSERT INTO assets (date, class, name, value, currency, member) VALUES ('2024-03-31', 'bank', 'Old', 1, 'USD', 'Robin');
    `)
    const res = await call('POST', '/api/accounts/update', { from: { name: 'Old', member: 'Robin' }, values: { name: 'New', member: 'Robin', currency: 'USD', class: 'bank' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ saved: true })
    expect(db.sqlite.prepare('SELECT date, bank, member, amount FROM flow_lines ORDER BY rowid').all()).toEqual([
      { date: '2024-02-01', bank: 'New', member: 'Robin', amount: 1 },
      { date: '2024-03-01', bank: 'Old', member: 'Robin', amount: 2 },
      { date: '2024-03-01', bank: 'New', member: 'Robin', amount: 9 },
      { date: '2024-03-01', bank: 'Old', member: '', amount: 3 },
    ])
    expect(logOf(db, 'flow_lines')).toEqual([{ actor: 'family', op: 'update', row_id: 1 }])
  })
})
