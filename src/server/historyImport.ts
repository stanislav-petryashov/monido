// A history import on SQLite: a dry run that writes nothing, the import in one batch (balances, closures, the closed
// months, one journal entry), and removing every imported month together. The plan itself is pure (src/domain/historyImport.ts).
import type { Database, PreparedStatement } from './db'
import { IMPORT_CLOSER, loadAssets, loadClosedMonths } from './data'
import { InputError, type Actor } from './http'
import { commitMutation } from './mutations'
import { advanceDraftRevision } from './draftRevision'
import { CHANGE_LOG_INSERT, insertStatement, logStatement, nextRowid, tableColumns } from './rows'
import { planHistoryImport, type HistoryAccount, type HistoryInput, type HistoryPlan } from '../domain/historyImport'
import { monthOf } from '../domain/dates'

/** The body as the client sends it, checked for shape only: the plan says what is wrong with the values */
function parseInput(body: unknown): HistoryInput {
  const b = body as { accounts?: unknown; months?: unknown } | null
  if (!b || !Array.isArray(b.accounts) || !Array.isArray(b.months)) throw new InputError('invalid_json', 400)
  const text = (v: unknown) => (typeof v === 'string' ? v : '')
  const accounts: HistoryAccount[] = b.accounts.map(a => {
    const x = (a ?? {}) as Record<string, unknown>
    return { name: text(x.name), member: text(x.member), class: text(x.class), currency: text(x.currency) }
  })
  const months = b.months.map(m => {
    const x = (m ?? {}) as Record<string, unknown>
    const values = Array.isArray(x.values) ? x.values.map(v => (v === null ? null : typeof v === 'number' ? v : Number.NaN)) : []
    return { month: text(x.month), values }
  })
  return { accounts, months }
}

async function planFor(db: Database, body: unknown, now: Date): Promise<HistoryPlan> {
  const input = parseInput(body)
  const q = (sql: string) => db.prepare(sql).all().then(r => r.results)
  const [closed, assets, currencies, members] = await Promise.all([
    loadClosedMonths(db), loadAssets(db), q('SELECT code FROM currencies'), q('SELECT name FROM members'),
  ])
  // the latest balance names an account's class and currency
  assets.sort((a, b) => a.date.localeCompare(b.date))
  return planHistoryImport(input, {
    closedMonths: closed.map(c => c.month),
    accounts: assets.map(a => ({ name: a.name, member: a.member ?? '', class: a.class, currency: a.currency })),
    currencies: currencies.map(r => String(r.code)),
    members: members.map(r => String(r.name)),
    today: now,
  })
}

/** What the import would write, without writing: the months, the counts and the problems */
export async function previewHistoryImport(db: Database, body: unknown, now = new Date()) {
  const plan = await planFor(db, body, now)
  return { months: plan.months, balances: plan.balances.length, closures: plan.closures.length, newAccounts: plan.newAccounts, problems: plan.problems }
}

export async function importHistory(db: Database, body: unknown, actor: Actor, now = new Date()) {
  return commitMutation(db, async () => {
    const plan = await planFor(db, body, now)
    if (plan.problems.length) throw new InputError('history_has_problems', 422, { count: plan.problems.length })
    const months = new Set(plan.months)
    // rows typed for those months outside the wizard were never on the dashboard: replaced, each deletion journaled
    const stray = (await loadAssets(db)).filter(a => months.has(monthOf(a.date)))
    const [columns, firstRowid] = await Promise.all([tableColumns(db, 'assets'), nextRowid(db, 'assets')])
    const ts = now.toISOString()
    const first = plan.months[0], last = plan.months[plan.months.length - 1]
    const statements: PreparedStatement[] = [
      ...stray.flatMap(({ rowid, ...before }) => [
        db.prepare('DELETE FROM assets WHERE rowid = ?').bind(rowid),
        logStatement(db, actor, { table: 'assets', rowid, op: 'delete', before, afterColumns: null, ts }),
      ]),
      ...plan.balances.map((b, i) => insertStatement(db, 'assets', columns, { ...b }, firstRowid + i)),
      ...plan.closures.map(c => db.prepare('INSERT OR REPLACE INTO account_closures (name, member, closed_month) VALUES (?, ?, ?)').bind(c.name, c.member, c.closedMonth)),
      // a plain insert: a month closed meanwhile hits the key and rolls the whole batch back
      ...plan.months.map(m => db.prepare('INSERT INTO closed_months (month, closed_at, closed_by) VALUES (?, ?, ?)').bind(m, ts, IMPORT_CLOSER)),
      ...plan.months.flatMap(m => [db.prepare('DELETE FROM month_drafts WHERE month = ?').bind(m), advanceDraftRevision(db, m)]),
      // one journal entry for the whole import, like a restore: its rows are removed together, not reverted one by one
      db.prepare(`${CHANGE_LOG_INSERT} VALUES (?, ?, ?, 'assets', 0, 'history_import', NULL, ?, NULL)`)
        .bind(ts, actor.name, actor.source, JSON.stringify({ first, last, balances: plan.balances.length })),
    ]
    return { statements, result: { months: plan.months, balances: plan.balances.length } }
  }, 'data_conflict')
}

/** Removes every month the imports closed: their balances, their closures and the closed marks, with one journal entry */
export async function removeImportedHistory(db: Database, actor: Actor, now = new Date()) {
  return commitMutation(db, async () => {
    const months = (await loadClosedMonths(db)).filter(c => c.source === 'import').map(c => c.month).sort()
    if (!months.length) throw new InputError('no_imported_history', 409)
    const first = months[0], last = months[months.length - 1]
    const removed = (await loadAssets(db)).filter(a => monthOf(a.date) >= first && monthOf(a.date) <= last).length
    const ts = now.toISOString()
    const statements: PreparedStatement[] = [
      db.prepare("DELETE FROM assets WHERE substr(date, 1, 7) BETWEEN ? AND ?").bind(first, last),
      db.prepare('DELETE FROM account_closures WHERE closed_month BETWEEN ? AND ?').bind(first, last),
      db.prepare('DELETE FROM closed_months WHERE closed_by = ?').bind(IMPORT_CLOSER),
      db.prepare(`${CHANGE_LOG_INSERT} VALUES (?, ?, ?, 'assets', 0, 'history_remove', NULL, ?, NULL)`)
        .bind(ts, actor.name, actor.source, JSON.stringify({ first, last, balances: removed })),
    ]
    return { statements, result: { months, balances: removed } }
  }, 'data_conflict')
}
