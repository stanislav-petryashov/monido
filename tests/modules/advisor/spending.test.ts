import type { SQLInputValue } from 'node:sqlite'
import { isoDate, shiftMonth } from '../../../src/domain/dates'
import { prevFinishedMonth } from '../../../src/domain/monthClose'
import { ADVISOR_TOOLS } from '../../../src/modules/advisor/tools/registry'
import type { TestDb } from '../../helpers/db'
import { advisorHarness } from './harness'
import { ru } from '../../helpers/i18n'

type Category = { id: number; name: string; flow: string; kind?: string; oneOff?: boolean }
type Listing = { categories: Category[]; savedMonths: { month: string; source: string }[]; currencies: string[] }

// the demo family has every month closed up to the one before the last finished: that one is the first open month
const OPEN = prevFinishedMonth(new Date())
const MONTH = shiftMonth(OPEN, -1)
const SOURCE = 'Test statement'
const count = (db: TestDb, sql: string, ...args: SQLInputValue[]) => (db.sqlite.prepare(sql).get(...args) as { n: number }).n

describe('the spending tools', () => {
  it('are listed: the listing is read-only, the two writers need the enter-data right', () => {
    const tools = Object.fromEntries(ADVISOR_TOOLS.map(t => [t.name, t]))
    expect(tools.list_spending_categories.right).toBeNull()
    expect(tools.add_spending_category.right).toBe('edit')
    expect(tools.save_category_spending.right).toBe('edit')
    expect(tools.save_category_spending.inputSchema).toMatchObject({ required: ['month', 'source', 'items'], additionalProperties: false })
    expect(tools.add_spending_category.inputSchema).toMatchObject({
      required: ['name'], properties: { kind: { enum: ['mandatory', 'optional'] }, flow: { enum: ['expense', 'active', 'passive'] }, oneOff: { type: 'boolean' } },
    })
    expect(tools.save_account_lines.right).toBe('edit')
    expect(tools.save_account_lines.inputSchema).toMatchObject({ required: ['month', 'account', 'items'], additionalProperties: false })
  })

  it('list_spending_categories lists the family categories with the reserved one and the saved month/source pairs', async () => {
    const { result } = advisorHarness()
    const listing = await result<Listing>('list_spending_categories')
    expect(listing.categories.length).toBeGreaterThan(1)
    expect(listing.categories).toContainEqual({ id: 1, name: 'loan_payments', flow: 'expense', kind: 'loan_payment' })
    expect(listing.categories.filter(c => c.flow === 'expense').every(c => Object.keys(c).sort().join() === 'flow,id,kind,name')).toBe(true)
    expect(listing.savedMonths.length).toBeGreaterThan(0)
    expect(listing.savedMonths[0].month).toMatch(/^\d{4}-\d{2}$/)
    expect(Object.keys(listing.savedMonths[0]).sort()).toEqual(['month', 'source'])
  })

  it('list_spending_categories also lists the project currencies, the only ones save_category_spending accepts', async () => {
    const { result, db, failure } = advisorHarness()
    const { currencies } = await result<Listing>('list_spending_categories')
    const stored = (db.sqlite.prepare('SELECT code FROM currencies ORDER BY code').all() as { code: string }[]).map(r => r.code)
    expect(currencies).toEqual(stored)
    expect(currencies.length).toBeGreaterThan(0)
    const tools = Object.fromEntries(ADVISOR_TOOLS.map(t => [t.name, t]))
    expect(tools.list_spending_categories.description).toMatch(/currencies/)
    const itemProps = (tools.save_category_spending.inputSchema as { properties: { items: { items: { properties: { currency: { description: string } } } } } }).properties.items.items.properties
    expect(itemProps.currency.description).toMatch(/list_spending_categories/)
    // a code outside the list is the refusal the list explains
    expect(currencies).not.toContain('XXX')
    expect((await failure('save_category_spending', { month: MONTH, source: SOURCE, items: [{ categoryId: 1, amount: 1, currency: 'XXX' }] }))[1]).toEqual({ error: { code: 'unknown_currency' } })
  })

  it('add_spending_category creates a category and answers it', async () => {
    const { result, db } = advisorHarness()
    const { category } = await result<{ category: Category }>('add_spending_category', { name: 'Pets', kind: 'optional' })
    expect(category).toMatchObject({ name: 'Pets', kind: 'optional' })
    expect(category.id).toBeGreaterThan(1)
    expect(count(db, `SELECT COUNT(*) AS n FROM change_log WHERE table_name = 'spending_categories' AND row_id = ?`, category.id)).toBe(1)
    expect((await result<Listing>('list_spending_categories')).categories).toContainEqual(category)
  })

  it('save_category_spending writes through the spending write path: journaled, same month+source replaces', async () => {
    const { result, db } = advisorHarness()
    const { category } = await result<{ category: Category }>('add_spending_category', { name: 'Pets', kind: 'optional' })
    const first = await result('save_category_spending', { month: MONTH, source: SOURCE, items: [{ categoryId: category.id, amount: 80, currency: 'USD' }, { categoryId: category.id, amount: 5, currency: 'EUR' }] })
    expect(first).toEqual({ month: MONTH, source: SOURCE, totals: [{ currency: 'EUR', amount: 5 }, { currency: 'USD', amount: 80 }] })
    const journaled = count(db, `SELECT COUNT(*) AS n FROM change_log WHERE table_name = 'category_spending' AND op = 'insert'`)
    expect(journaled).toBeGreaterThanOrEqual(2)
    const second = await result('save_category_spending', { month: MONTH, source: SOURCE, items: [{ categoryId: category.id, amount: 20, currency: 'USD' }] })
    expect(second).toEqual({ month: MONTH, source: SOURCE, totals: [{ currency: 'USD', amount: 20 }] })
    expect(count(db, `SELECT COUNT(*) AS n FROM category_spending WHERE source = ? AND date = ?`, SOURCE, `${MONTH}-01`)).toBe(1)
    expect(count(db, `SELECT COUNT(*) AS n FROM change_log WHERE table_name = 'category_spending' AND op = 'delete'`)).toBeGreaterThanOrEqual(2)
    expect((await result<Listing>('list_spending_categories')).savedMonths).toContainEqual({ month: MONTH, source: SOURCE })
  })

  it('save_category_spending accepts a month total on the reserved loan_payment category and returns it in the totals', async () => {
    const { result, db } = advisorHarness()
    const saved = await result('save_category_spending', { month: MONTH, source: SOURCE, items: [{ categoryId: 1, amount: 1200, currency: 'USD' }] })
    expect(saved).toEqual({ month: MONTH, source: SOURCE, totals: [{ currency: 'USD', amount: 1200 }] })
    expect(count(db, `SELECT COUNT(*) AS n FROM category_spending WHERE source = ? AND category_id = 1`, SOURCE)).toBe(1)
  })

  it('a view-only member gets 403 no_right_edit from save_category_spending and add_spending_category; nothing written', async () => {
    const { db, failure, result } = advisorHarness({ viewOnly: true })
    const categories = count(db, 'SELECT COUNT(*) AS n FROM spending_categories')
    const lines = count(db, 'SELECT COUNT(*) AS n FROM category_spending')
    const log = count(db, 'SELECT COUNT(*) AS n FROM change_log')
    expect(await failure('add_spending_category', { name: 'Pets', kind: 'optional' })).toEqual([403, { error: { code: 'no_right_edit' } }])
    expect(await failure('save_category_spending', { month: MONTH, source: SOURCE, items: [{ categoryId: 2, amount: 1, currency: 'USD' }] }))
      .toEqual([403, { error: { code: 'no_right_edit' } }])
    expect(count(db, 'SELECT COUNT(*) AS n FROM spending_categories')).toBe(categories)
    expect(count(db, 'SELECT COUNT(*) AS n FROM category_spending')).toBe(lines)
    expect(count(db, 'SELECT COUNT(*) AS n FROM change_log')).toBe(log)
    // reading stays open
    expect((await result<Listing>('list_spending_categories')).categories.length).toBeGreaterThan(1)
  })

  it('save_category_spending refuses a future month, an unknown category, a currency outside the project (the /api/spending codes)', async () => {
    const { failure, result } = advisorHarness()
    const { category } = await result<{ category: Category }>('add_spending_category', { name: 'Pets', kind: 'optional' })
    const item = { categoryId: category.id, amount: 10, currency: 'USD' }
    const thisMonth = isoDate(new Date()).slice(0, 7)
    expect(await failure('save_category_spending', { month: thisMonth, source: SOURCE, items: [item] })).toEqual([400, { error: { code: 'invalid_month' } }])
    expect(await failure('save_category_spending', { month: MONTH, source: SOURCE, items: [{ ...item, categoryId: 9999 }] })).toEqual([400, { error: { code: 'unknown_category' } }])
    expect(await failure('save_category_spending', { month: MONTH, source: 'Statement: x', items: [item] })).toEqual([400, { error: { code: 'invalid_source' } }])
    expect(await failure('save_category_spending', { month: MONTH, source: SOURCE, items: [{ ...item, currency: 'XXX' }] })).toEqual([400, { error: { code: 'unknown_currency' } }])
    expect(await failure('save_category_spending', { month: MONTH, source: SOURCE, items: [item, item] })).toEqual([400, { error: { code: 'duplicate_item' } }])
    expect(await failure('save_category_spending', { month: MONTH, source: SOURCE, items: [{ ...item, amount: -1 }] })).toEqual([400, { error: { code: 'invalid_amount' } }])
  })

  it('save_category_spending refuses the first open month and later ones: 409 use_statement_tools, nothing written', async () => {
    const { db, failure } = advisorHarness()
    const lines = count(db, 'SELECT COUNT(*) AS n FROM category_spending')
    const log = count(db, 'SELECT COUNT(*) AS n FROM change_log')
    expect(await failure('save_category_spending', { month: OPEN, source: SOURCE, items: [{ categoryId: 1, amount: 5, currency: 'USD' }] }))
      .toEqual([409, { error: { code: 'advisor.use_statement_tools', params: { month: OPEN } } }])
    expect(count(db, 'SELECT COUNT(*) AS n FROM category_spending')).toBe(lines)
    expect(count(db, 'SELECT COUNT(*) AS n FROM change_log')).toBe(log)
  })

  it('save_category_spending saves the last finished month once the queue is empty', async () => {
    const { db, result } = advisorHarness()
    db.sqlite.prepare(`INSERT INTO closed_months (month, closed_at, closed_by) VALUES (?, ?, ?)`).run(OPEN, new Date().toISOString(), 'test')
    expect(await result('save_category_spending', { month: OPEN, source: SOURCE, items: [{ categoryId: 1, amount: 5, currency: 'USD' }] }))
      .toEqual({ month: OPEN, source: SOURCE, totals: [{ currency: 'USD', amount: 5 }] })
  })

  it('save_category_spending still saves a month before the first open one', async () => {
    const { result } = advisorHarness()
    expect(await result('save_category_spending', { month: MONTH, source: SOURCE, items: [{ categoryId: 1, amount: 5, currency: 'USD' }] }))
      .toEqual({ month: MONTH, source: SOURCE, totals: [{ currency: 'USD', amount: 5 }] })
  })

  it('the descriptions point the first open month to preview_statement', () => {
    const tools = Object.fromEntries(ADVISOR_TOOLS.map(t => [t.name, t]))
    expect(tools.save_category_spending.description).toMatch(/preview_statement/)
    expect(tools.save_category_spending.description).toMatch(/commit_statement/)
    expect(tools.list_spending_categories.description).toMatch(/preview_statement/)
    expect(tools.list_spending_categories.description).toMatch(/loanPayments/)
    // the original sentence stays whole and comes before the routing sentence
    const listing = tools.list_spending_categories.description
    const at = ['categories: id, name and flow', 'An expense category has a kind', 'an income category has oneOff', 'the months that already have lines', 'and the currencies (ISO codes)', 'Loan and credit-card repayments', 'preview_statement', 'through save_category_spending', 'Call it before filing'].map(p => listing.indexOf(p))
    expect(at.every(i => i >= 0)).toBe(true)
    expect(at).toEqual([...at].sort((x, y) => x - y))
  })

  it('add_spending_category creates an income category with a flow and the one-off flag, never a kind', async () => {
    const { result, failure } = advisorHarness()
    const { category } = await result<{ category: Category }>('add_spending_category', { name: 'Windfall', flow: 'active', oneOff: true })
    expect(category).toEqual({ id: expect.any(Number), name: 'Windfall', flow: 'active', oneOff: true })
    const listing = await result<Listing>('list_spending_categories')
    expect(listing.categories).toContainEqual(category)
    expect(await failure('add_spending_category', { name: 'Rent in', flow: 'passive', kind: 'optional' })).toEqual([400, { error: { code: 'invalid_kind' } }])
    expect(await failure('add_spending_category', { name: 'Pets', kind: 'optional', oneOff: true })).toEqual([400, { error: { code: 'invalid_one_off' } }])
  })

  it('add_spending_category refuses kind loan_payment and a duplicate name in another case, Cyrillic included', async () => {
    const { failure, result } = advisorHarness()
    expect(await failure('add_spending_category', { name: 'Loans', kind: 'loan_payment' })).toEqual([400, { error: { code: 'invalid_kind' } }])
    const groceries = ru('modules.cashflow.spending.defaults.groceries')
    await result('add_spending_category', { name: groceries, kind: 'optional' })
    expect(await failure('add_spending_category', { name: groceries.toUpperCase(), kind: 'mandatory' })).toEqual([409, { error: { code: 'category_exists' } }])
    expect(await failure('add_spending_category', { name: 'LOAN_PAYMENTS', kind: 'optional' })).toEqual([409, { error: { code: 'category_exists' } }])
  })

  it('save_category_spending refuses an income category: a free source holds spending only', async () => {
    const { result, failure } = advisorHarness()
    const { category } = await result<{ category: Category }>('add_spending_category', { name: 'Wages', flow: 'active' })
    expect(await failure('save_category_spending', { month: MONTH, source: SOURCE, items: [{ categoryId: category.id, amount: 1, currency: 'USD' }] }))
      .toEqual([400, { error: { code: 'invalid_category_flow' } }])
  })
})

describe('save_account_lines', () => {
  /** An account of the closed month MONTH with active income, and an income category */
  async function setup() {
    const h = advisorHarness()
    // the demo family already breaks its months down: start from a month without lines
    h.db.sqlite.prepare('DELETE FROM flow_lines WHERE date = ?').run(`${MONTH}-01`)
    const row = h.db.sqlite.prepare('SELECT bank, member, currency, active_income AS active, expense FROM monthly_cashflow WHERE date = ? AND active_income > 0 ORDER BY bank LIMIT 1').get(`${MONTH}-01`) as { bank: string; member: string; currency: string; active: number; expense: number }
    const { category: salary } = await h.result<{ category: Category }>('add_spending_category', { name: 'Wages', flow: 'active' })
    const account = { name: row.bank, member: row.member }
    const lines = () => h.db.sqlite.prepare('SELECT category_id, amount FROM flow_lines WHERE date = ? AND bank = ? AND member = ?').all(`${MONTH}-01`, row.bank, row.member)
    return { ...h, row, salary, account, lines }
  }

  it('saves a closed month\'s lines of an account through the cash flow write path, journaled, and answers the allocation', async () => {
    const t = await setup()
    const saved = await t.result<{ totals: { active: number }; allocated: { active: number }; currency: string }>('save_account_lines', { month: MONTH, account: t.account, items: [{ categoryId: t.salary.id, amount: t.row.active }] })
    expect(saved).toMatchObject({ month: MONTH, account: t.account, currency: t.row.currency, totals: { active: t.row.active }, allocated: { active: t.row.active, passive: 0, expense: 0 } })
    expect(t.lines()).toEqual([{ category_id: t.salary.id, amount: t.row.active }])
    expect(count(t.db, `SELECT COUNT(*) AS n FROM change_log WHERE table_name = 'flow_lines'`)).toBe(1)
    expect((await t.result<{ accountMonths: unknown[] }>('list_spending_categories')).accountMonths).toContainEqual({ month: MONTH, bank: t.row.bank, member: t.row.member })
    // an empty list clears them
    await t.result('save_account_lines', { month: MONTH, account: t.account, items: [] })
    expect(t.lines()).toEqual([])
  })

  it('refuses lines above the total, the reserved category, an account not in the month, and the open month', async () => {
    const t = await setup()
    const over = t.row.active + 1
    expect(await t.failure('save_account_lines', { month: MONTH, account: t.account, items: [{ categoryId: t.salary.id, amount: over }] }))
      .toEqual([409, { error: { code: 'lines_exceed_total', params: { flow: 'active', lines: over, total: t.row.active } } }])
    expect((await t.failure('save_account_lines', { month: MONTH, account: t.account, items: [{ categoryId: 1, amount: 1 }] }))[1]).toEqual({ error: { code: 'invalid_category_flow' } })
    expect(await t.failure('save_account_lines', { month: MONTH, account: { name: 'Nowhere', member: '' }, items: [{ categoryId: t.salary.id, amount: 1 }] }))
      .toEqual([409, { error: { code: 'account_not_in_month' } }])
    expect(await t.failure('save_account_lines', { month: OPEN, account: t.account, items: [] }))
      .toEqual([409, { error: { code: 'advisor.use_statement_tools', params: { month: OPEN } } }])
    expect(t.lines()).toEqual([])
  })
})
