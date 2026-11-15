// The only write path for table rows — the Data section.
// Every write and its change_log entry go into one SQLite batch (one transaction).
// The statement builders (insertStatement, logStatement, nextRowid) also serve the month-close wizard and the family settings.
import { assertAvailabilityCleared } from './availability'
import type { Database, PreparedStatement } from './db'
import { commitMutation, type MutationPlan } from './mutations'
import { InputError, plainObject, requireRight, type Actor } from './http'
import { quoteIdent as q } from './tables'
import { assertNotFamilyCurrency } from './familyCurrency'
import { tableOwner } from '../modules/catalog'
import { checkModuleDelete, checkModuleRow } from '../modules/rowChecks'
import { DATA_TABLES, isAuthSettingEntry, isDataTable, isRevertibleTable } from '../domain/journal'
import { isDay } from '../domain/dates'
import { parseDraft } from '../domain/monthClose'

export { DATA_TABLES }
const READABLE_TABLES = [...DATA_TABLES, 'fx_rates', 'change_log'] as const
export const isReadableTable = (t: string) => (READABLE_TABLES as readonly string[]).includes(t)

export interface Column { name: string; type: string; notnull: number; pk: number }
type Values = Record<string, string | number | null>
type ChangeOp = 'insert' | 'update' | 'delete' | 'revert'

export async function tableColumns(db: Database, table: string): Promise<Column[]> {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all()
  return results.map(c => ({ name: String(c.name), type: String(c.type), notnull: Number(c.notnull) || 0, pk: Number(c.pk) || 0 }))
}

/** The row's address is the server's: `rowid` and an INTEGER PRIMARY KEY alias of it (`id`) in a body are dropped. */
export function validateRow(columns: Column[], body: unknown): Values {
  const id = idColumn(columns)
  const entries = Object.entries(plainObject(body)).filter(([key]) => key !== 'rowid' && key !== id)
  if (!entries.length) throw new InputError('no_valid_columns')
  for (const [key, value] of entries) {
    const col = columns.find(c => c.name === key)
    if (!col) throw new InputError('unknown_column', 400, { column: key })
    if (value === null) {
      if (col.notnull || col.pk) throw new InputError('required_field', 400, { column: key })
      continue
    }
    if (!['number', 'string'].includes(typeof value)) throw new InputError('invalid_value', 400, { column: key })
    // an empty date is no date: a required one would be stored as '' (a half-typed date erasing a stored one)
    if (/DATE/.test(col.type) && value === '' && (col.notnull || col.pk)) throw new InputError('required_field', 400, { column: key })
    if (/DATE/.test(col.type) && value !== '' && !isDay(String(value))) throw new InputError('invalid_value', 400, { column: key })
    if (/REAL|INTEGER/.test(col.type)) {
      if (String(value).trim() === '' || !Number.isFinite(Number(value))) throw new InputError('expected_number', 400, { column: key })
      if (col.type === 'INTEGER' && !Number.isSafeInteger(Number(value))) throw new InputError('expected_integer', 400, { column: key })
    }
  }
  return Object.fromEntries(entries) as Values
}

/**
 * A TEXT primary key names the row (a loan, a member, a currency): the screens find rows and tie others to them by it.
 * SQLite lets such a key be NULL (no NOT NULL in the schema) or blank, and a row like that cannot be opened again. An
 * insert must send it; an update may leave it out but not blank it.
 */
function assertKeyNamed(columns: Column[], data: Values, insert: boolean): void {
  for (const col of columns) {
    if (!col.pk || col.type.toUpperCase() !== 'TEXT') continue
    const value = data[col.name]
    const missing = value === undefined ? insert : value === null || String(value).trim() === ''
    if (missing) throw new InputError('required_field', 400, { column: col.name })
  }
}

/** A module's column limits (`ModuleMeta.limits`): a value over its table's limit is refused, naming the column. */
function assertWithinLimits(table: string, data: Values): void {
  for (const [column, max] of Object.entries(tableOwner(table)?.limits?.[table] ?? {})) {
    const value = data[column]
    if (value != null && Number(value) > max) throw new InputError('invalid_value', 400, { column })
  }
}

/** A single INTEGER PRIMARY KEY is SQLite's rowid alias; otherwise the hidden rowid. */
function idColumn(columns: Column[]): string {
  const pks = columns.filter(c => c.pk > 0)
  return pks.length === 1 && pks[0].type.toUpperCase() === 'INTEGER' ? pks[0].name : 'rowid'
}

/** The table's next free rowid: batch rows are numbered in advance so the journal knows their address. */
export async function nextRowid(db: Database, table: string): Promise<number> {
  const row = await db.prepare(`SELECT COALESCE(MAX(rowid), 0) + 1 AS next FROM ${table}`).first<{ next: number }>()
  return Number(row?.next ?? 1)
}

async function selectRow(db: Database, table: string, rowid: number): Promise<Record<string, unknown> | null> {
  return db.prepare(`SELECT * FROM ${table} WHERE rowid = ?`).bind(rowid).first()
}

/** Inserts a row under a given rowid, for a batch. Columns the table lacks are skipped. */
export function insertStatement(db: Database, table: string, columns: Column[], values: Record<string, unknown>, rowid: number, replace = false): PreparedStatement {
  const id = idColumn(columns)
  const cols = Object.keys(values).filter(c => c !== id && columns.some(x => x.name === c))
  const names = [id, ...cols]
  return db.prepare(`${replace ? 'INSERT OR REPLACE' : 'INSERT'} INTO ${table} (${names.map(q).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .bind(rowid, ...cols.map(c => values[c] ?? null))
}

/** The row as SQL json_object over the table's columns, for a journal entry that reads the row in the same batch. */
export const rowJson = (columns: Column[]) => `json_object(${columns.map(c => `'${c.name}', ${q(c.name)}`).join(', ')})`

/** The start of a journal INSERT: one column list for every entry. */
export const CHANGE_LOG_INSERT = 'INSERT INTO change_log (ts, actor, source, table_name, row_id, op, before_json, after_json, reverts_id)'

interface LogEntry {
  table: string
  rowid: number
  op: ChangeOp
  before: Record<string, unknown> | null
  /** The table's columns: after_json is read from it in the same batch; null leaves after_json empty */
  afterColumns: Column[] | null
  revertsId?: number | null
  /** Time of the write; one for every entry of a batch */
  ts?: string
}

/** Journal entry; after_json is read back from the table inside the same batch. */
export function logStatement(db: Database, actor: Actor, { table, rowid, op, before, afterColumns, revertsId = null, ts = new Date().toISOString() }: LogEntry): PreparedStatement {
  const after = afterColumns ? `(SELECT ${rowJson(afterColumns)} FROM ${table} WHERE rowid = ?)` : 'NULL'
  const binds: unknown[] = [ts, actor.name, actor.source, table, rowid, op, before ? JSON.stringify(before) : null]
  if (afterColumns) binds.push(rowid)
  binds.push(revertsId)
  return db.prepare(`${CHANGE_LOG_INSERT} VALUES (?, ?, ?, ?, ?, ?, ?, ${after}, ?)`).bind(...binds)
}

/** The tables that name a member in `member`: links without foreign keys, moved together by memberRename.ts. */
export const MEMBER_TABLES = ['assets', 'loans', 'real_estate', 'monthly_cashflow', 'flow_lines', 'account_closures', 'availability_assessments', 'users'] as const

/** A member a user points to keeps its name and stays: the link is by name, without a foreign key. */
async function assertNoUser(db: Database, member: unknown): Promise<void> {
  if (await db.prepare('SELECT 1 FROM users WHERE member = ?').bind(member).first()) throw new InputError('member_has_user', 409)
}

/**
 * A member still named by a record, or by a row of a saved month draft (closing it would write that row), stays: the
 * record would pass to the next member given that name. Drafts are read as memberRename.ts reads them.
 */
async function assertMemberUnused(db: Database, member: unknown): Promise<void> {
  await assertNoUser(db, member)
  await assertAvailabilityCleared(db, 'member', member)
  for (const table of MEMBER_TABLES) {
    if (await db.prepare(`SELECT 1 FROM ${table} WHERE member = ? LIMIT 1`).bind(member).first()) throw new InputError('member_in_use', 409)
  }
  const { results: drafts } = await db.prepare('SELECT payload FROM month_drafts').all<{ payload: string }>()
  for (const stored of drafts) {
    let draft
    try { draft = parseDraft(JSON.parse(stored.payload)) } catch { throw new InputError('draft_conflict', 409) }
    if (draft.rows.some(row => row.member === member)) throw new InputError('member_in_use', 409)
  }
}

/** A rename moves every record of the member at once: only POST /api/members/:rowid/rename (memberRename.ts) does it. */
const refuseMemberRename = () => { throw new InputError('member_rename_by_route', 409) }

/**
 * `assets` has no key, yet holds one balance per account (name + member) a month: a second one would silently replace
 * the first (the domain keeps the higher rowid). `exceptRowid`: the row being moved.
 */
async function assertAccountMonthFree(db: Database, row: Record<string, unknown>, exceptRowid: number | null = null): Promise<void> {
  const taken = await db.prepare("SELECT 1 FROM assets WHERE substr(date, 1, 7) = ? AND name = ? AND COALESCE(member, '') = COALESCE(?, '') AND rowid IS NOT ?")
    .bind(String(row.date ?? '').slice(0, 7), row.name ?? null, row.member ?? null, exceptRowid).first()
  if (taken) throw new InputError('account_exists', 409)
}
const ACCOUNT_MONTH_KEY = ['date', 'name', 'member']
const ACCOUNT_KEY = ['name', 'member', 'currency']
const differs = (keys: string[], a: Record<string, unknown> | null, b: Record<string, unknown> | null) => keys.some(k => (a?.[k] ?? null) !== (b?.[k] ?? null))

/** monthly_cashflow keeps one row per (date, bank, member): saving a month again replaces it. */
const REPLACE_TABLES = new Set(['monthly_cashflow'])

/**
 * Tables written only through a route of their own, with the error a generic write answers. loan_payments: the month-close
 * wizard (a payment typed into a month closed before the table existed would be counted twice, that month's account expenses
 * already hold it). The spending tables: /api/spending (the reserved category is never renamed, re-kinded or deleted; a
 * month's rows of a source are replaced together on the month's first day). Reading, the journal, the module purge and revert stay open.
 */
const ROUTE_ONLY_TABLES: Record<string, string> = {
  loan_payments: 'loan_payments_by_wizard',
  spending_categories: 'spending_by_route',
  category_spending: 'spending_by_route',
  flow_lines: 'spending_by_route',
  manual_mandatory_spending: 'spending_by_route',
}
const assertNotRouteOnlyTable = (table: string) => {
  if (ROUTE_ONLY_TABLES[table]) throw new InputError(ROUTE_ONLY_TABLES[table], 409)
}

async function findByPrimaryKey(db: Database, table: string, columns: Column[], data: Values): Promise<Record<string, unknown> | null> {
  const pks = columns.filter(c => c.pk > 0)
  if (!pks.length || pks.some(c => data[c.name] == null)) return null
  return db.prepare(`SELECT * FROM ${table} WHERE ${pks.map(c => `${q(c.name)} = ?`).join(' AND ')}`)
    .bind(...pks.map(c => data[c.name])).first()
}

/**
 * Read/validate only. For several inserts in one table, reserve nextRowid once and pass consecutive explicit rowids.
 */
export async function buildInsertRow(db: Database, table: string, body: unknown, actor: Actor, rowid?: number): Promise<MutationPlan<number>> {
  if (!isDataTable(table)) throw new InputError('read_only_table', 403)
  assertNotRouteOnlyTable(table)
  const columns = await tableColumns(db, table)
  const data = validateRow(columns, body)
  assertKeyNamed(columns, data, true)
  assertWithinLimits(table, data)
  await checkModuleRow(table, { data, row: data }, { db, rowid: null })
  if (table === 'assets') await assertAccountMonthFree(db, data)
  const replace = REPLACE_TABLES.has(table)
  const before = replace ? await findByPrimaryKey(db, table, columns, data) : null
  rowid ??= await nextRowid(db, table)
  return {
    statements: [
      insertStatement(db, table, columns, data, rowid, replace),
      logStatement(db, actor, { table, rowid, op: 'insert', before, afterColumns: columns }),
    ],
    result: rowid,
  }
}

/**
 * The row an editor opened (`expectedIdentity`): compared with the stored row, not validated against the columns, so a
 * legacy row with a malformed value (a date before the date check) can still be corrected. Only its shape is checked.
 */
function identityOf(value: unknown): Values {
  const entries = Object.entries(plainObject(value)).filter(([key]) => key !== 'rowid')
  if (!entries.length || entries.some(([, v]) => v !== null && typeof v !== 'string' && typeof v !== 'number')) {
    throw new InputError('invalid_value', 400, { column: 'expectedIdentity' })
  }
  return Object.fromEntries(entries) as Values
}

/** Read/validate only; compose the statements into one guarded mutation. */
/** `ts`: the journal time, shared by every entry of a compound mutation (a revert finds the entries written with it) */
export async function buildUpdateRow(db: Database, table: string, rowid: number, body: unknown, actor: Actor, ts?: string): Promise<MutationPlan<Record<string, unknown>>> {
  if (!isDataTable(table)) throw new InputError('read_only_table', 403)
  assertNotRouteOnlyTable(table)
  const columns = await tableColumns(db, table)
  // Retained editors may pin their original target without changing other generic row callers.
  const { expectedIdentity, ...values } = plainObject(body)
  const expected = expectedIdentity === undefined ? null : identityOf(expectedIdentity)
  const data = validateRow(columns, values)
  assertKeyNamed(columns, data, false)
  assertWithinLimits(table, data)
  const before = await selectRow(db, table, rowid)
  if (!before) throw new InputError('row_not_found', 404)
  if (expected && !sameRow(before, expected)) throw new InputError('row_changed', 409)
  await checkModuleRow(table, { data, row: { ...before, ...data } }, { db, rowid })
  if (table === 'assets' && differs(ACCOUNT_MONTH_KEY, before, { ...before, ...data })) await assertAccountMonthFree(db, { ...before, ...data }, rowid)
  if (table === 'currencies' && 'code' in data && data.code !== before.code) { await assertNotFamilyCurrency(db, before.code); await assertAvailabilityCleared(db, 'currency', before.code) }
  if (table === 'members' && 'name' in data && data.name !== before.name) refuseMemberRename()
  const cols = Object.keys(data)
  return {
    statements: [
      db.prepare(`UPDATE ${table} SET ${cols.map(c => `${q(c)} = ?`).join(', ')} WHERE rowid = ?`).bind(...cols.map(c => data[c]), rowid),
      logStatement(db, actor, { table, rowid, op: 'update', before, afterColumns: columns, ts }),
    ],
    result: { rowid, ...data },
  }
}

/** Read/validate only; compose the statements into one guarded mutation. */
export async function buildDeleteRow(db: Database, table: string, rowid: number, actor: Actor, ts?: string): Promise<MutationPlan<void>> {
  if (!isDataTable(table)) throw new InputError('read_only_table', 403)
  assertNotRouteOnlyTable(table)
  const before = await selectRow(db, table, rowid)
  if (!before) throw new InputError('row_not_found', 404)
  if (table === 'currencies') { await assertNotFamilyCurrency(db, before.code); await assertAvailabilityCleared(db, 'currency', before.code) }
  if (table === 'members') await assertMemberUnused(db, before.name)
  return {
    statements: [
      db.prepare(`DELETE FROM ${table} WHERE rowid = ?`).bind(rowid),
      logStatement(db, actor, { table, rowid, op: 'delete', before, afterColumns: null, ts }),
    ],
    result: undefined,
  }
}

export async function insertRow(db: Database, table: string, body: unknown, actor: Actor): Promise<Record<string, unknown>> {
  const rowid = await commitMutation(db, () => buildInsertRow(db, table, body, actor))
  return (await db.prepare(`SELECT *, rowid FROM ${table} WHERE rowid = ?`).bind(rowid).first())
    ?? { rowid, ...Object.fromEntries(Object.entries(plainObject(body)).filter(([key]) => key !== 'rowid')) }
}

export async function updateRow(db: Database, table: string, rowid: number, body: unknown, actor: Actor): Promise<Record<string, unknown>> {
  return commitMutation(db, async () => {
    if (table === 'assets') {
      const before = await selectRow(db, table, rowid)
      const values = plainObject(body)
      if (before && ['name', 'member', 'currency'].some(key => key in values && values[key] !== before[key])) await assertAvailabilityCleared(db, 'name', before.name, String(before.member ?? ''))
    }
    return buildUpdateRow(db, table, rowid, body, actor)
  })
}

export async function deleteRow(db: Database, table: string, rowid: number, actor: Actor): Promise<void> {
  return commitMutation(db, async () => {
    if (table === 'assets') {
      const before = await selectRow(db, table, rowid)
      if (before) await assertAvailabilityCleared(db, 'name', before.name, String(before.member ?? ''))
    }
    const stored = await selectRow(db, table, rowid)
    if (stored) await checkModuleDelete(table, stored, { db, rowid })
    return buildDeleteRow(db, table, rowid, actor)
  })
}

interface ChangeLogRow {
  id: number; table_name: string; row_id: number; op: ChangeOp | 'restore' | 'wipe' | 'demo_data'
  before_json: string | null; after_json: string | null
  ts: string; actor: string; source: string
}

/** Tables whose rows add up to closed months. */
const MONTHLY_TABLES = new Set(['assets', 'monthly_cashflow', 'loan_payments'])

async function isClosedMonth(db: Database, month: string): Promise<boolean> {
  return !!(await db.prepare('SELECT month FROM closed_months WHERE month = ?').bind(month).first())
}

const sameRow = (current: Record<string, unknown>, expected: Record<string, unknown>) =>
  Object.keys(expected).every(k => String(current[k] ?? null) === String(expected[k] ?? null))

/** Undoes one journaled change, if the row still looks exactly as that change left it. */
/**
 * The loans' `secured_by` rewrites journaled with a property change (same time, actor and source; before: the property's
 * name), put back where the loan still holds what the change left. Each gets its own revert entry; one already reverted,
 * or changed since, is left alone.
 */
async function revertCollateral(db: Database, actor: Actor, entry: ChangeLogRow, name: string): Promise<PreparedStatement[]> {
  const { results } = await db.prepare(`SELECT * FROM change_log WHERE ts = ? AND actor = ? AND source = ? AND table_name = 'loans' AND op = 'update'
    AND id NOT IN (SELECT reverts_id FROM change_log WHERE reverts_id IS NOT NULL)`).bind(entry.ts, entry.actor, entry.source).all<ChangeLogRow>()
  const columns = await tableColumns(db, 'loans')
  const statements: PreparedStatement[] = []
  for (const link of results) {
    const was = link.before_json ? JSON.parse(link.before_json) as Record<string, unknown> : null
    const left = link.after_json ? JSON.parse(link.after_json) as Record<string, unknown> : null
    if (!was || !left || was.secured_by !== name) continue
    const current = await selectRow(db, 'loans', link.row_id)
    if (!current || current.secured_by !== left.secured_by) continue
    statements.push(
      db.prepare('UPDATE loans SET secured_by = ? WHERE rowid = ?').bind(name, link.row_id),
      logStatement(db, actor, { table: 'loans', rowid: link.row_id, op: 'revert', before: current, afterColumns: columns, revertsId: link.id }),
    )
  }
  return statements
}

export async function revertChange(db: Database, id: number, actor: Actor): Promise<{ reverted: number }> {
  // guarded: a write landing between the checks and the batch reruns them (a later edit is never overwritten)
  return commitMutation(db, async () => {
    const entry = await db.prepare('SELECT * FROM change_log WHERE id = ?').bind(id).first<ChangeLogRow>()
    if (!entry) throw new InputError('change_not_found', 404)
    if (entry.op === 'revert') throw new InputError('revert_of_revert')
    // a restore, a wipe or a test-data load replaced whole tables: there is no single row to put back (a restore keeps a copy of the old file)
    if (entry.op === 'restore' || entry.op === 'wipe' || entry.op === 'demo_data') throw new InputError('not_revertible', 409)
    const table = entry.table_name
    // only the Data-section tables and the family settings are put back: not the users (rights and sign-in links are changed
    // on the Users tab), the council's record (what the family decided) or a module's own settings
    if (!isRevertibleTable(table)) throw new InputError('not_revertible', 409)
    // the sign-in settings are changed on the Sign-in tab; putting an old password, mode or token back would be a takeover
    if (isAuthSettingEntry(entry)) throw new InputError('not_revertible', 409)
    // the family language and currency are a manager's to change, back as well as forth
    if (entry.table_name === 'app_settings') requireRight(actor, 'manage')
    if (await db.prepare('SELECT id FROM change_log WHERE reverts_id = ?').bind(id).first()) {
      throw new InputError('already_reverted', 409)
    }
    const columns = await tableColumns(db, table)
    const before = entry.before_json ? JSON.parse(entry.before_json) as Record<string, unknown> : null
    const after = entry.after_json ? JSON.parse(entry.after_json) as Record<string, unknown> : null
    const current = await selectRow(db, table, entry.row_id)
    if (entry.op !== 'delete' && (!current || !after || !sameRow(current, after))) {
      throw new InputError('row_changed', 409)
    }

    // Reverting an insert removes the member, as a delete does; reverting a rename is a rename.
    if (table === 'members' && entry.op === 'insert' && after) await assertMemberUnused(db, after.name)
    if (table === 'members' && entry.op === 'update' && after && after.name !== before?.name) refuseMemberRename()

    // Reverting an insert or an update takes the code the change left away from the row.
    if (table === 'currencies' && entry.op !== 'delete' && after && after.code !== before?.code) {
      await assertNotFamilyCurrency(db, after.code)
      await assertAvailabilityCleared(db, 'currency', after.code)
    }

    // Reverting takes the balance's account or currency away: a confirmed availability would no longer match it.
    if (table === 'assets' && entry.op !== 'delete' && current && differs(ACCOUNT_KEY, current, before)) await assertAvailabilityCleared(db, 'name', current.name, String(current.member ?? ''))
    // Putting a balance back (or moving it back) must not give its account a second one that month.
    if (table === 'assets' && before && (entry.op === 'delete' || differs(ACCOUNT_MONTH_KEY, current, before))) {
      await assertAccountMonthFree(db, before, entry.op === 'delete' ? null : entry.row_id)
    }

    // Reverting an insert deletes the row. In a closed month that leaves a hole: the dashboard already shows the month as complete.
    if (entry.op === 'insert' && !before && MONTHLY_TABLES.has(table) && await isClosedMonth(db, String(after?.date ?? '').slice(0, 7))) {
      throw new InputError('closed_month_row', 409)
    }

    const statements: PreparedStatement[] = []
    let affected = entry.row_id
    let restored = true
    if (entry.op === 'insert') {
      statements.push(db.prepare(`DELETE FROM ${table} WHERE rowid = ?`).bind(entry.row_id))
      if (before) {
        affected = await nextRowid(db, table)
        statements.push(insertStatement(db, table, columns, before, affected))
      } else {
        restored = false
      }
    } else if (entry.op === 'update') {
      const cols = Object.keys(before ?? {}).filter(c => columns.some(x => x.name === c))
      statements.push(db.prepare(`UPDATE ${table} SET ${cols.map(c => `${q(c)} = ?`).join(', ')} WHERE rowid = ?`)
        .bind(...cols.map(c => before![c] ?? null), entry.row_id))
    } else {
      affected = await nextRowid(db, table)
      statements.push(insertStatement(db, table, columns, before ?? {}, affected))
    }
    // Known exception: a property's delete or rename cleared or moved loans' `secured_by` in the same mutation; its revert puts them back
    if (table === 'real_estate' && entry.op !== 'insert' && typeof before?.name === 'string') statements.push(...await revertCollateral(db, actor, entry, before.name))
    // A deleted row has no current state: whatever sits at its old rowid now is unrelated.
    const revertedFrom = entry.op === 'delete' ? null : current
    statements.push(logStatement(db, actor, { table, rowid: affected, op: 'revert', before: revertedFrom, afterColumns: restored ? columns : null, revertsId: id }))
    return { statements, result: { reverted: id } }
  })
}
