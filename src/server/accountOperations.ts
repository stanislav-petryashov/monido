// Compound account writes: select authoritative dependencies, then commit rows and journals together.
import { assertAvailabilityCleared, planAvailabilityRename } from './availability'
import type { AccountIdentity } from '../domain/api'
import { ACCOUNT_CLASSES, listAccounts } from '../domain/accounts'
import { MONTH_RE, monthEnd } from '../domain/dates'
import { serverModules } from '../modules/server'
import type { Database, PreparedStatement } from './db'
import { InputError, plainObject, requireRight, type Actor } from './http'
import { readTrackFlows } from './data'
import { buildRenameAccount } from './monthClose'
import { commitMutation } from './mutations'
import { buildDeleteRow, buildInsertRow, buildUpdateRow, logStatement, tableColumns } from './rows'

type StoredRow = Record<string, unknown> & { rowid: number }

/**
 * An account's transfers moved (a rename, a currency change) or deleted, journaled: own SQL, as the generic API refuses the
 * table (its member key is '' for a memberless account, which the generic key check would refuse too).
 */
async function transferStatements(db: Database, actor: Actor, rows: StoredRow[], to: { name: string; member: string; currency?: string } | null): Promise<PreparedStatement[]> {
  if (!rows.length) return []
  const columns = await tableColumns(db, 'account_transfers')
  const ts = new Date().toISOString()
  return rows.flatMap(({ rowid, ...before }) => [
    to ? db.prepare('UPDATE account_transfers SET name = ?, member = ?, currency = COALESCE(?, currency) WHERE rowid = ?').bind(to.name, to.member, to.currency ?? null, rowid)
      : db.prepare('DELETE FROM account_transfers WHERE rowid = ?').bind(rowid),
    logStatement(db, actor, { table: 'account_transfers', rowid, op: to ? 'update' : 'delete', before, afterColumns: to ? columns : null, ts }),
  ])
}

function identity(body: unknown, field: string): AccountIdentity {
  const value = plainObject(body)
  if (typeof value.name !== 'string' || !value.name.trim() || typeof value.member !== 'string') throw new InputError('invalid_account', 400, { field })
  return { name: value.name, member: value.member }
}

async function accountRows(db: Database, account: AccountIdentity) {
  const assets = (await db.prepare("SELECT rowid, * FROM assets WHERE name = ? AND COALESCE(member, '') = ? ORDER BY rowid").bind(account.name, account.member).all<StoredRow>()).results
  // Accounts are defined by balances, as on the Accounts screen; retained orphan lines do not define one.
  const current = listAccounts(assets.map(r => ({ date: String(r.date), name: String(r.name), member: r.member == null ? null : String(r.member), currency: String(r.currency), class: String(r.class) })))[0]
  if (!current) throw new InputError('row_not_found', 404)
  const flows = (await db.prepare("SELECT rowid, * FROM monthly_cashflow WHERE bank = ? AND COALESCE(member, '') = ? ORDER BY rowid").bind(account.name, account.member).all<StoredRow>()).results
  const transfers = (await db.prepare('SELECT rowid, * FROM account_transfers WHERE name = ? AND member = ? ORDER BY rowid').bind(account.name, account.member).all<StoredRow>()).results
  return { assets, flows, transfers, current }
}

async function renamePlans(db: Database, actor: Actor, from: AccountIdentity, to: AccountIdentity): Promise<PreparedStatement[]> {
  if (from.name === to.name && from.member === to.member) return []
  const statements = await buildRenameAccount(db, from, to)
  statements.push(...await planAvailabilityRename(db, actor, from, to))
  for (const module of serverModules({ demo: false })) statements.push(...(await module.planRenameAccount?.({ db, actor }, from, to) ?? []))
  return statements
}

export async function updateAccount(db: Database, actor: Actor, body: unknown): Promise<{ saved: true }> {
  requireRight(actor, 'edit')
  const request = plainObject(body)
  const from = identity(request.from, 'from')
  const values = plainObject(request.values)
  const to = identity(values, 'values')
  if (typeof values.currency !== 'string' || !values.currency.trim()) throw new InputError('invalid_account', 400, { field: 'currency' })
  if (typeof values.class !== 'string' || !(ACCOUNT_CLASSES as readonly string[]).includes(values.class)) throw new InputError('invalid_account', 400, { field: 'class' })
  return commitMutation(db, async () => {
    const { assets, flows, transfers, current } = await accountRows(db, from)
    // the currency goes onto past rows only when it changed: each row keeps its own (a class edit must not relabel 1000 EUR as USD)
    const currency = values.currency !== current.currency ? { currency: values.currency } : {}
    const metadata = { ...to, ...currency, class: values.class }
    const renamed = to.name !== from.name || to.member !== from.member
    // a rename onto another account's balances or flows would merge the two accounts' months into one
    if (renamed && await db.prepare(`SELECT 1 FROM assets WHERE name = ?1 AND COALESCE(member, '') = ?2
      UNION ALL SELECT 1 FROM monthly_cashflow WHERE bank = ?1 AND COALESCE(member, '') = ?2
      UNION ALL SELECT 1 FROM account_transfers WHERE name = ?1 AND member = ?2 LIMIT 1`).bind(to.name, to.member).first()) throw new InputError('account_exists', 409)
    if (values.currency !== current.currency) await assertAvailabilityCleared(db, 'name', from.name, from.member)
    const statements: PreparedStatement[] = []
    for (const row of assets) statements.push(...(await buildUpdateRow(db, 'assets', row.rowid, metadata, actor)).statements)
    for (const row of flows) statements.push(...(await buildUpdateRow(db, 'monthly_cashflow', row.rowid, { bank: to.name, member: to.member, ...currency }, actor)).statements)
    statements.push(...await transferStatements(db, actor, transfers, { ...to, currency: values.currency !== current.currency ? String(values.currency) : undefined }))
    statements.push(...await renamePlans(db, actor, from, to))
    return { statements, result: { saved: true } }
  })
}

export async function deleteAccount(db: Database, actor: Actor, body: unknown): Promise<{ deleted: true }> {
  requireRight(actor, 'edit')
  const account = identity(body, 'account')
  return commitMutation(db, async () => {
    const { assets, flows, transfers } = await accountRows(db, account)
    await assertAvailabilityCleared(db, 'name', account.name, account.member)
    const statements: PreparedStatement[] = []
    for (const [table, rows] of [['assets', assets], ['monthly_cashflow', flows]] as const) {
      for (const row of rows) statements.push(...(await buildDeleteRow(db, table, row.rowid, actor)).statements)
    }
    statements.push(...await transferStatements(db, actor, transfers, null))
    // Historical closures, wizard input and category lines are intentionally retained on deletion.
    return { statements, result: { deleted: true } }
  })
}

function amount(value: unknown, column: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new InputError('expected_number', 400, { column })
  return value
}

export async function updateAccountMonth(db: Database, actor: Actor, body: unknown): Promise<{ saved: true }> {
  requireRight(actor, 'edit')
  const request = plainObject(body)
  const account = identity(request.account, 'account')
  if (typeof request.month !== 'string' || !MONTH_RE.test(request.month)) throw new InputError('invalid_month')
  const month = request.month
  const balance = request.balance === null ? null : amount(request.balance, 'value')
  const flows = { active_income: amount(request.active, 'active_income'), passive_income: amount(request.passive, 'passive_income'), expense: amount(request.expense, 'expense') }
  // Flow inputs use the same nonnegative amount rule as the existing month form.
  for (const [column, value] of Object.entries(flows)) if (value < 0) throw new InputError('invalid_value', 400, { column })
  const expected = request.expected === undefined ? null : plainObject(request.expected)
  return commitMutation(db, async () => {
    const [rows, trackFlows] = await Promise.all([accountRows(db, account), readTrackFlows(db)])
    const asset = rows.assets.find(r => String(r.date).slice(0, 7) === month)
    const flow = rows.flows.find(r => String(r.date).slice(0, 7) === month)
    if (!asset && !flow) throw new InputError('row_not_found', 404)
    if (asset && balance === null) throw new InputError('required_field', 400, { column: 'value' })
    // the values the form opened with (`expected`; null — no row): another device changed the month meanwhile → 409
    if (expected) {
      const stored: Record<string, number | null> = {
        balance: asset ? Number(asset.value) : null,
        active: flow ? Number(flow.active_income) : null, passive: flow ? Number(flow.passive_income) : null, expense: flow ? Number(flow.expense) : null,
      }
      if ((trackFlows ? ['balance', 'active', 'passive', 'expense'] : ['balance']).some(k => (expected[k] ?? null) !== stored[k])) throw new InputError('row_changed', 409)
    }
    const statements: PreparedStatement[] = []
    if (asset) statements.push(...(await buildUpdateRow(db, 'assets', asset.rowid, { value: balance, date: monthEnd(month) }, actor)).statements)
    else if (balance !== null) statements.push(...(await buildInsertRow(db, 'assets', { date: monthEnd(month), name: account.name, member: account.member, class: rows.current.class, currency: rows.current.currency, value: balance }, actor)).statements)
    // while income and expenses are not tracked the editor is balance-only: the stored flows stay as they are
    if (!trackFlows) return { statements, result: { saved: true } }
    if (flow) statements.push(...(await buildUpdateRow(db, 'monthly_cashflow', flow.rowid, flows, actor)).statements)
    else if (Object.values(flows).some(Boolean)) statements.push(...(await buildInsertRow(db, 'monthly_cashflow', { date: `${month}-01`, bank: account.name, member: account.member, currency: rows.current.currency, ...flows }, actor)).statements)
    return { statements, result: { saved: true } }
  })
}
