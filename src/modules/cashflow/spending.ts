// The Cash flow module's category writes: categories, an account's lines of a month, a free source's totals for a month,
// the hand-typed mandatory amount. Plain functions over the database and the actor: the /api/spending routes call them
// (and the advisor's spending tools). The generic rows API refuses these tables, so each write is one batch of its
// statements and their journal entries.
import { MONTH_RE } from '../../domain/dates'
import type { AccountIdentity, SpendingRecords } from '../../domain/api'
import { STATEMENT_SOURCE_PREFIX } from '../../domain/statements'
import { openMonths, prevFinishedMonth } from '../../domain/monthClose'
import { allocatedByFlow, allocationExcess } from '../../domain/spending'
import type { CategoryFlow, CategoryKind, ManualMandatory, MsgParams, SpendingCategory } from '../../domain/types'
import { categoryRow, loadClosedMonths } from '../../server/data'
import type { Database, PreparedStatement } from '../../server/db'
import { InputError, isConstraint, type Actor } from '../../server/http'
import { getMonthCloseState } from '../../server/monthClose'
import { commitMutation } from '../../server/mutations'
import { insertStatement, logStatement, nextRowid, tableColumns } from '../../server/rows'

/** Control and format characters (bidi overrides, zero-width): these texts reach Claude, so they stay plain */
const UNSAFE = /[\p{Cc}\p{Cf}]/u
const MAX_TEXT = 60
const MAX_ITEMS = 100
/** An account name as the month-close wizard keeps it (its own limit) */
const MAX_ACCOUNT = 100
const KINDS: readonly string[] = ['mandatory', 'optional']
const FLOWS: readonly string[] = ['expense', 'active', 'passive']

const num = (v: unknown) => Number(v)
const str = (v: unknown) => String(v ?? '')
/** A plain object: not null, not an array. */
export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

type Totals = Record<CategoryFlow, number | null>
type AccountLines = SpendingRecords['accounts'][number]

/**
 * Every account of a closed month (its monthly_cashflow row) and of the first open month (its draft row), each with its
 * lines; lines whose account is in neither are listed as orphaned. Newest month first, then bank and member.
 */
async function accountLines(db: Database, categories: SpendingCategory[], now: Date): Promise<AccountLines[]> {
  const [closed, cashflow, lines, state] = await Promise.all([
    loadClosedMonths(db),
    db.prepare('SELECT substr(date, 1, 7) AS month, bank, member, currency, active_income, passive_income, expense FROM monthly_cashflow').all().then(r => r.results),
    db.prepare('SELECT substr(date, 1, 7) AS month, bank, member, category_id, amount FROM flow_lines ORDER BY category_id').all().then(r => r.results),
    getMonthCloseState(db, now),
  ])
  const closedSet = new Set(closed.map(c => c.month))
  const accounts = new Map<string, AccountLines>()
  const keyOf = (month: string, bank: string, member: string) => JSON.stringify([month, bank, member])
  const add = (month: string, bank: string, member: string, currency: string | null, totals: Totals | null) => {
    accounts.set(keyOf(month, bank, member), { month, bank, member, currency, totals, items: [], allocated: { active: 0, passive: 0, expense: 0 }, orphaned: totals === null })
  }
  for (const r of cashflow) {
    if (!closedSet.has(str(r.month))) continue
    add(str(r.month), str(r.bank), str(r.member), str(r.currency), { active: num(r.active_income), passive: num(r.passive_income), expense: num(r.expense) })
  }
  if (state.month && state.flows) {
    for (const r of state.rows) add(state.month, r.name, r.member, r.currency || null, { active: r.active, passive: r.passive, expense: r.expense })
  }
  for (const l of lines) {
    const key = keyOf(str(l.month), str(l.bank), str(l.member))
    if (!accounts.has(key)) add(str(l.month), str(l.bank), str(l.member), null, null)
    accounts.get(key)!.items.push({ categoryId: num(l.category_id), amount: num(l.amount) })
  }
  const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  return [...accounts.values()]
    .map(a => ({ ...a, allocated: allocatedByFlow(a.items, categories) }))
    .sort((a, b) => text(b.month, a.month) || text(a.bank, b.bank) || text(a.member, b.member))
}

/**
 * The whole screen's data: the categories, every account's lines per month (with its totals to allocate), the free
 * sources' totals per month, the manual amount. `now` finds the first open month's draft.
 */
export async function getSpending(db: Database, now = new Date()): Promise<SpendingRecords> {
  const [categoryRows, sources, lines, manual] = await Promise.all([
    db.prepare('SELECT id, name, kind, flow, one_off FROM spending_categories ORDER BY id').all().then(r => r.results),
    db.prepare('SELECT substr(date, 1, 7) AS month, source, currency, SUM(amount) AS amount FROM category_spending GROUP BY month, source, currency ORDER BY month DESC, source, currency')
      .all().then(r => r.results),
    db.prepare('SELECT substr(date, 1, 7) AS month, source, category_id, currency, SUM(amount) AS amount FROM category_spending GROUP BY month, source, category_id, currency ORDER BY category_id, currency')
      .all().then(r => r.results),
    db.prepare('SELECT amount, currency, updated_at FROM manual_mandatory_spending WHERE id = 1').first(),
  ])
  const categories = categoryRows.map(categoryRow)
  const grouped: SpendingRecords['sources'] = []
  for (const r of sources) {
    const last = grouped.at(-1)
    const total = { currency: str(r.currency), amount: num(r.amount) }
    if (last && last.month === str(r.month) && last.source === str(r.source)) last.totals.push(total)
    else grouped.push({ month: str(r.month), source: str(r.source), totals: [total], items: [] })
  }
  for (const r of lines) {
    grouped.find(g => g.month === str(r.month) && g.source === str(r.source))?.items.push({ categoryId: num(r.category_id), amount: num(r.amount), currency: str(r.currency) })
  }
  return {
    categories,
    accounts: await accountLines(db, categories, now),
    sources: grouped,
    manual: manual ? ({ amount: num(manual.amount), currency: str(manual.currency), updated_at: str(manual.updated_at) } satisfies ManualMandatory) : null,
  }
}

/** A name or a source from a request: trimmed text of 1–60 characters without control or format characters; a refusal is 400 `code` with `params`. */
export function readText(value: unknown, code: string, params?: MsgParams): string {
  if (typeof value !== 'string') throw new InputError(code, 400, params)
  const text = value.trim()
  if (!text || text.length > MAX_TEXT || UNSAFE.test(text)) throw new InputError(code, 400, params)
  return text
}

/**
 * A free source (a card, cash), as stored. The statement prefix belongs to the legacy sources the statement import
 * derived from an account before account lines existed: a new write may not use it (`fresh`), a delete may.
 */
function readSource(value: unknown, fresh = false): string {
  const source = readText(value, 'invalid_source')
  if (fresh && source.startsWith(STATEMENT_SOURCE_PREFIX)) throw new InputError('invalid_source')
  return source
}

/** YYYY-MM, not later than the last finished month. */
function readMonth(value: unknown, now: Date): string {
  if (typeof value !== 'string' || !MONTH_RE.test(value) || value > prevFinishedMonth(now)) throw new InputError('invalid_month')
  return value
}

function readAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new InputError('invalid_amount')
  return value
}

async function readCurrency(db: Database, value: unknown): Promise<string> {
  const known = typeof value === 'string' && await db.prepare('SELECT 1 FROM currencies WHERE code = ?').bind(value).first()
  if (!known) throw new InputError('unknown_currency')
  return value
}

function readKind(value: unknown): CategoryKind {
  if (typeof value !== 'string' || !KINDS.includes(value)) throw new InputError('invalid_kind')
  return value as CategoryKind
}

function readFlow(value: unknown): CategoryFlow {
  if (value === undefined) return 'expense'
  if (typeof value !== 'string' || !FLOWS.includes(value)) throw new InputError('invalid_category_flow')
  return value as CategoryFlow
}

/** The one-off flag: a boolean, and `true` only on an income category (`false` is accepted on any). */
function readOneOff(value: unknown, flow: CategoryFlow): boolean {
  if (typeof value !== 'boolean' || (flow === 'expense' && value)) throw new InputError('invalid_one_off')
  return value
}

/** The category and its stored row (column names as in the table, for the journal). */
async function findStored(db: Database, id: number): Promise<{ category: SpendingCategory; stored: Record<string, unknown> }> {
  const row = Number.isSafeInteger(id) ? await db.prepare('SELECT * FROM spending_categories WHERE id = ?').bind(id).first() : null
  if (!row) throw new InputError('unknown_category')
  return { category: categoryRow(row), stored: row }
}

/** Another category with this name (names are unique regardless of case). Compared here: SQLite's NOCASE folds ASCII only. */
async function assertNameFree(db: Database, name: string, exceptId: number | null): Promise<void> {
  const rows = (await db.prepare('SELECT id, name FROM spending_categories').all()).results
  const folded = name.toLowerCase()
  if (rows.some(r => num(r.id) !== exceptId && str(r.name).toLowerCase() === folded)) throw new InputError('category_exists', 409)
}

/**
 * A new category. `flow` (default `expense`) is the total it allocates; an expense category needs a `kind` (mandatory or
 * optional), an income one takes none (it keeps the stored default) and may be `oneOff`.
 */
export async function addCategory(db: Database, actor: Actor, body: unknown, now = new Date()): Promise<SpendingRecords> {
  if (!isObject(body)) throw new InputError('expected_object')
  const name = readText(body.name, 'invalid_name')
  const flow = readFlow(body.flow)
  if (flow !== 'expense' && body.kind !== undefined) throw new InputError('invalid_kind')
  const kind = flow === 'expense' ? readKind(body.kind) : null
  const oneOff = body.oneOff === undefined ? false : readOneOff(body.oneOff, flow)
  // guarded: a category added meanwhile reruns the name check and takes the next id (two adds never clash on one)
  await commitMutation(db, async () => {
    await assertNameFree(db, name, null)
    const columns = await tableColumns(db, 'spending_categories')
    // an id that was handed out and then deleted is not handed out again (AUTOINCREMENT does the same for an implicit id)
    const seq = await db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'spending_categories'").first<{ seq: number }>()
    const id = Math.max(await nextRowid(db, 'spending_categories'), num(seq?.seq ?? 0) + 1)
    return { statements: [
      insertStatement(db, 'spending_categories', columns, { name, ...(kind ? { kind } : {}), flow, one_off: oneOff ? 1 : 0 }, id),
      logStatement(db, actor, { table: 'spending_categories', rowid: id, op: 'insert', before: null, afterColumns: columns }),
    ], result: undefined }
  })
  return getSpending(db, now)
}

/** Renames a category, changes an expense one's kind or an income one's one-off flag; the flow is fixed (lines depend on it). */
export async function updateCategory(db: Database, actor: Actor, id: number, body: unknown, now = new Date()): Promise<SpendingRecords> {
  await commitMutation(db, async () => {
    const { category: before, stored } = await findStored(db, id)
    if (before.kind === 'loan_payment') throw new InputError('category_reserved', 409)
    if (!isObject(body)) throw new InputError('expected_object')
    if (body.flow !== undefined) throw new InputError('flow_fixed', 409)
    if (body.name === undefined && body.kind === undefined && body.oneOff === undefined) throw new InputError('no_valid_columns')
    if (before.flow !== 'expense' && body.kind !== undefined) throw new InputError('invalid_kind')
    const name = body.name === undefined ? before.name : readText(body.name, 'invalid_name')
    const kind = body.kind === undefined ? before.kind : readKind(body.kind)
    const oneOff = body.oneOff === undefined ? before.oneOff : readOneOff(body.oneOff, before.flow)
    if (name === before.name && kind === before.kind && oneOff === before.oneOff) return { statements: [], result: undefined }
    await assertNameFree(db, name, id)
    const columns = await tableColumns(db, 'spending_categories')
    return { statements: [
      db.prepare('UPDATE spending_categories SET name = ?, kind = ?, one_off = ? WHERE id = ?').bind(name, kind, oneOff ? 1 : 0, id),
      logStatement(db, actor, { table: 'spending_categories', rowid: id, op: 'update', before: stored, afterColumns: columns }),
    ], result: undefined }
  })
  return getSpending(db, now)
}

export async function deleteCategory(db: Database, actor: Actor, id: number, now = new Date()): Promise<SpendingRecords> {
  // guarded: a line entered meanwhile reruns the in-use check; the foreign key still says so if one slips past it
  await commitMutation(db, async () => {
    const { category: before, stored } = await findStored(db, id)
    if (before.kind === 'loan_payment') throw new InputError('category_reserved', 409)
    const used = await db.prepare('SELECT 1 FROM category_spending WHERE category_id = ? UNION ALL SELECT 1 FROM flow_lines WHERE category_id = ? LIMIT 1').bind(id, id).first()
    if (used) throw new InputError('category_in_use', 409)
    return { statements: [
      db.prepare('DELETE FROM spending_categories WHERE id = ?').bind(id),
      logStatement(db, actor, { table: 'spending_categories', rowid: id, op: 'delete', before: stored, afterColumns: null }),
    ], result: undefined }
  }).catch(err => { throw isConstraint(err) ? new InputError('category_in_use', 409) : err })
  return getSpending(db, now)
}

interface Item { categoryId: number; amount: number; currency: string }

/** A free source's items: expense categories only (income is allocated on an account), one per category and currency. */
async function readItems(db: Database, body: unknown): Promise<Item[]> {
  const items = isObject(body) ? body.items : undefined
  if (!Array.isArray(items) || items.length > MAX_ITEMS) throw new InputError('invalid_items')
  const seen = new Set<string>()
  const read: Item[] = []
  for (const item of items) {
    if (!isObject(item)) throw new InputError('invalid_items')
    const category = (await findStored(db, item.categoryId as number)).category
    if (category.flow !== 'expense') throw new InputError('invalid_category_flow')
    const amount = readAmount(item.amount)
    const currency = await readCurrency(db, item.currency)
    const key = `${category.id}|${currency}`
    if (seen.has(key)) throw new InputError('duplicate_item', 400)
    seen.add(key)
    read.push({ categoryId: category.id, amount, currency })
  }
  return read
}

/**
 * 409 `row_changed` when the stored lines are not the ones the person started from (`body.base`, the items as read):
 * another device or Claude changed them meanwhile, and a whole-month replace would erase that unseen. A body without
 * `base` asks for no check — the advisor's tools, which write under their own guard.
 */
function assertBase(body: unknown, stored: Record<string, unknown>[], withCurrency: boolean): void {
  if (!isObject(body) || !('base' in body)) return
  const base = body.base
  if (!Array.isArray(base) || !base.every(isObject)) throw new InputError('invalid_items')
  const keyOf = (categoryId: unknown, amount: unknown, currency: unknown) => `${Number(categoryId)}|${Number(amount)}${withCurrency ? `|${String(currency)}` : ''}`
  const was = base.map(i => keyOf(i.categoryId, i.amount, i.currency)).sort()
  const now = stored.map(r => keyOf(r.category_id, r.amount, r.currency)).sort()
  if (was.length !== now.length || was.some((k, i) => k !== now[i])) throw new InputError('row_changed', 409)
}

/** The statements that remove a source's rows of a month, journaling what they held. */
async function removeSource(db: Database, actor: Actor, date: string, source: string, ts: string, body?: unknown): Promise<PreparedStatement[]> {
  const rows = (await db.prepare('SELECT rowid, date, category_id, source, amount, currency FROM category_spending WHERE date = ? AND source = ? ORDER BY rowid')
    .bind(date, source).all()).results
  assertBase(body, rows, true)
  return rows.flatMap(({ rowid, ...before }) => [
    db.prepare('DELETE FROM category_spending WHERE rowid = ?').bind(rowid),
    logStatement(db, actor, { table: 'category_spending', rowid: num(rowid), op: 'delete', before, afterColumns: null, ts }),
  ])
}

/** Saves a source's totals for a month: the rows it had for that month are replaced by the items (none — removed). Other sources stay. The legacy statement prefix is refused. */
export async function saveSourceMonth(db: Database, actor: Actor, month: string, source: string, body: unknown, now = new Date()): Promise<SpendingRecords> {
  const date = `${readMonth(month, now)}-01`
  const name = readSource(source, true)
  // the base check reads the stored lines: it and the replace commit together
  await commitMutation(db, async () => {
    const items = await readItems(db, body)
    const [columns, first] = await Promise.all([tableColumns(db, 'category_spending'), nextRowid(db, 'category_spending')])
    const ts = now.toISOString()
    const statements = [
      ...await removeSource(db, actor, date, name, ts, body),
      ...items.flatMap((item, i) => [
        insertStatement(db, 'category_spending', columns, { date, category_id: item.categoryId, source: name, amount: item.amount, currency: item.currency }, first + i),
        logStatement(db, actor, { table: 'category_spending', rowid: first + i, op: 'insert', before: null, afterColumns: columns, ts }),
      ]),
    ]
    return { statements, result: undefined }
  })
  return getSpending(db, now)
}

/** `body.base`, when sent: the lines the person saw (assertBase) — a delete never removes lines saved meanwhile unseen. */
export async function deleteSourceMonth(db: Database, actor: Actor, month: string, source: string, body?: unknown, now = new Date()): Promise<SpendingRecords> {
  const date = `${readMonth(month, now)}-01`
  const name = readSource(source)
  await commitMutation(db, async () => ({ statements: await removeSource(db, actor, date, name, now.toISOString(), body), result: undefined }))
  return getSpending(db, now)
}

/** An account's name or member as the month-close wizard stores it (untrimmed); a refusal is 400 `invalid_account` { field }. */
function readAccountText(value: unknown, field: string, optional: boolean): string {
  if (optional && value === '') return ''
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_ACCOUNT || UNSAFE.test(value)) throw new InputError('invalid_account', 400, { field })
  return value
}

/** An account's lines: categories that allocate a total (not the reserved loan one), each once, amounts ≥ 0. */
async function readAccountItems(db: Database, items: unknown): Promise<{ items: { categoryId: number; amount: number }[]; categories: SpendingCategory[] }> {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) throw new InputError('invalid_items')
  const seen = new Set<number>()
  const read: { categoryId: number; amount: number }[] = []
  const categories: SpendingCategory[] = []
  for (const item of items) {
    if (!isObject(item)) throw new InputError('invalid_items')
    const category = (await findStored(db, item.categoryId as number)).category
    // loan payments have their own lines in the wizard; they allocate no account total
    if (category.kind === 'loan_payment') throw new InputError('invalid_category_flow')
    const amount = readAmount(item.amount)
    if (seen.has(category.id)) throw new InputError('duplicate_item', 400)
    seen.add(category.id)
    read.push({ categoryId: category.id, amount })
    categories.push(category)
  }
  return { items: read, categories }
}

/**
 * The totals an account's lines of a month may allocate: a closed month's monthly_cashflow row, the first open month's
 * draft row (a field not filled in yet caps nothing); 409 `account_not_in_month` when the account has no row there.
 */
async function capOf(db: Database, month: string, bank: string, member: string, now: Date): Promise<Totals> {
  const closed = (await loadClosedMonths(db)).map(c => c.month)
  if (closed.includes(month)) {
    const row = await db.prepare('SELECT active_income, passive_income, expense FROM monthly_cashflow WHERE substr(date, 1, 7) = ? AND bank = ? AND member = ?')
      .bind(month, bank, member).first()
    if (!row) throw new InputError('account_not_in_month', 409)
    return { active: num(row.active_income), passive: num(row.passive_income), expense: num(row.expense) }
  }
  if (openMonths(closed, now)[0] === month) {
    const state = await getMonthCloseState(db, now)
    const row = state.flows ? state.rows.find(r => r.name === bank && r.member === member) : undefined
    if (!row) throw new InputError('account_not_in_month', 409)
    return { active: row.active, passive: row.passive, expense: row.expense }
  }
  throw new InputError('account_not_in_month', 409)
}

/**
 * Builds an account's line replacement without committing; a trusted statement import may supply its merged draft cap.
 * Saves an account's lines of a month: the lines it had are replaced by the items (none — cleared). Their sum per flow
 * may not exceed the account's total (409 `lines_exceed_total` { flow, lines, total }). No currency: the account's.
 */
export async function buildAccountLines(
  db: Database, actor: Actor, month: unknown, account: { bank: unknown; member: unknown }, body: unknown, now: Date,
  options: { cap?: Totals } = {},
): Promise<PreparedStatement[]> {
  const date = `${readMonth(month, now)}-01`
  const bank = readAccountText(account.bank, 'bank', false)
  const member = readAccountText(account.member, 'member', true)
  const { items, categories } = await readAccountItems(db, isObject(body) ? body.items : undefined)
  // clearing needs no cap, so lines whose account row is gone (orphaned) can still be removed
  if (items.length > 0) {
    const totals = options.cap ?? await capOf(db, date.slice(0, 7), bank, member, now)
    const [excess] = allocationExcess(items, categories, totals)
    if (excess) throw new InputError('lines_exceed_total', 409, { ...excess })
  }
  const [columns, first, stored] = await Promise.all([
    tableColumns(db, 'flow_lines'), nextRowid(db, 'flow_lines'),
    db.prepare('SELECT rowid, date, bank, member, category_id, amount FROM flow_lines WHERE date = ? AND bank = ? AND member = ? ORDER BY rowid')
      .bind(date, bank, member).all().then(r => r.results),
  ])
  assertBase(body, stored, false)
  const ts = now.toISOString()
  return [
    ...stored.flatMap(({ rowid, ...before }) => [
      db.prepare('DELETE FROM flow_lines WHERE rowid = ?').bind(rowid),
      logStatement(db, actor, { table: 'flow_lines', rowid: num(rowid), op: 'delete', before, afterColumns: null, ts }),
    ]),
    ...items.flatMap((item, i) => [
      insertStatement(db, 'flow_lines', columns, { date, bank, member, category_id: item.categoryId, amount: item.amount }, first + i),
      logStatement(db, actor, { table: 'flow_lines', rowid: first + i, op: 'insert', before: null, afterColumns: columns, ts }),
    ]),
  ]
}

/** Standalone writes guard the category definitions, existing lines and authoritative account cap together. */
export async function saveAccountLines(
  db: Database, actor: Actor, month: unknown, account: { bank: unknown; member: unknown }, body: unknown, now = new Date(),
): Promise<SpendingRecords> {
  await commitMutation(db, async () => ({ statements: await buildAccountLines(db, actor, month, account, body, now), result: undefined }))
  return getSpending(db, now)
}

/**
 * An account was renamed: its lines of every month move to the new name, each move journaled. A line whose new key is
 * taken already (the account was renamed into one that has lines that month) stays where it was: the snapshot lists it
 * as orphaned.
 */
export async function buildMoveAccountLines(db: Database, actor: Actor, from: AccountIdentity, to: AccountIdentity, now = new Date()): Promise<PreparedStatement[]> {
  if (from.name === to.name && from.member === to.member) return []
  const [columns, all] = await Promise.all([
    tableColumns(db, 'flow_lines'),
    db.prepare('SELECT rowid, date, bank, member, category_id, amount FROM flow_lines').all().then(r => r.results),
  ])
  const taken = new Set(all.filter(l => str(l.bank) === to.name && str(l.member) === to.member).map(l => `${str(l.date)}|${num(l.category_id)}`))
  const moving = all.filter(l => str(l.bank) === from.name && str(l.member) === from.member && !taken.has(`${str(l.date)}|${num(l.category_id)}`))
  if (!moving.length) return []
  const ts = now.toISOString()
  return moving.flatMap(({ rowid, ...before }) => [
    db.prepare('UPDATE flow_lines SET bank = ?, member = ? WHERE rowid = ?').bind(to.name, to.member, rowid),
    logStatement(db, actor, { table: 'flow_lines', rowid: num(rowid), op: 'update', before, afterColumns: columns, ts }),
  ])
}

/** Sets the hand-typed mandatory monthly spending; the time is the server's. */
export async function saveManual(db: Database, actor: Actor, body: unknown, now = new Date()): Promise<SpendingRecords> {
  if (!isObject(body)) throw new InputError('expected_object')
  const amount = readAmount(body.amount)
  const currency = await readCurrency(db, body.currency)
  const [columns, before] = await Promise.all([
    tableColumns(db, 'manual_mandatory_spending'),
    db.prepare('SELECT * FROM manual_mandatory_spending WHERE id = 1').first(),
  ])
  const ts = now.toISOString()
  await db.batch([
    insertStatement(db, 'manual_mandatory_spending', columns, { amount, currency, updated_at: ts }, 1, true),
    logStatement(db, actor, { table: 'manual_mandatory_spending', rowid: 1, op: before ? 'update' : 'insert', before, afterColumns: columns, ts }),
  ])
  return getSpending(db, now)
}

export async function clearManual(db: Database, actor: Actor, now = new Date()): Promise<SpendingRecords> {
  const before = await db.prepare('SELECT * FROM manual_mandatory_spending WHERE id = 1').first()
  if (before) {
    await db.batch([
      db.prepare('DELETE FROM manual_mandatory_spending WHERE id = 1'),
      logStatement(db, actor, { table: 'manual_mandatory_spending', rowid: 1, op: 'delete', before, afterColumns: null }),
    ])
  }
  return getSpending(db, now)
}
