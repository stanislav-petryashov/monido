// The month-close wizard on SQLite: state for the screen, a draft per month, and closing a month
// as one batch — balances, flows, journal and the closed mark land together or not at all.
import type { Database, PreparedStatement } from './db'
import { str, loadAssets, loadCashflow, loadClosedMonths, loadClosures, loadEarlyPayments, loadLoanPayments, loadLoans, readTrackFlows } from './data'
import { InputError, type Actor } from './http'
import { commitMutation } from './mutations'
import { advanceDraftRevision, draftRevision, requireDraftRevision, revisionRecords } from './draftRevision'
import { insertStatement, logStatement, nextRowid, tableColumns, type Column } from './rows'
import type { AccountIdentity, DraftRevisionRequest, MonthCloseState } from '../domain/api'
import { accountKey, type AccountKey } from '../domain/accounts'
import { MONTH_RE, monthOf, shiftMonth } from '../domain/dates'
import {
  accountsFor, closingWrites, draftFromRows, draftTotals, flowHintsFor, hintsFor, incompleteMonths, loanPaymentsFor, openMonths, parseDraft, prevFinishedMonth,
  problemsIn, suggestedAccounts,
  type AccountClosure, type ClosedMonth, type MonthDraft,
} from '../domain/monthClose'
import type { LoanEarlyPayment, LoanRow } from '../domain/loans'
import type { AccountTransferInput, AssetInput, CashflowInput, LoanPaymentInput } from '../domain/types'
import { checkModuleClose } from '../modules/closeChecks'


type Stored<T> = T & { rowid: number }

interface Loaded {
  closed: ClosedMonth[]
  closures: AccountClosure[]
  assets: Stored<AssetInput>[]
  cashflow: Stored<CashflowInput>[]
  members: string[]
  currencies: string[]
  /** The family tracks income and expenses: the wizard asks for the flows and the loan payments and writes them */
  flows: boolean
  loans: LoanRow[]
  earlyPayments: LoanEarlyPayment[]
  loanPayments: Stored<LoanPaymentInput>[]
  /** Deposits and withdrawals of the investment accounts (account_transfers), written and read back whether flows are tracked or not */
  transfers: Stored<AccountTransferInput>[]
}

async function load(db: Database): Promise<Loaded> {
  const q = (sql: string) => db.prepare(sql).all().then(r => r.results)
  const [closed, closures, assets, cashflow, members, currencies, flows, transfers] = await Promise.all([
    loadClosedMonths(db),
    loadClosures(db),
    loadAssets(db),
    loadCashflow(db),
    q('SELECT name FROM members'),
    q('SELECT code FROM currencies'),
    readTrackFlows(db),
    q('SELECT rowid, date, name, member, amount, currency FROM account_transfers'),
  ])
  // hidden like the flows: while they are not tracked the wizard neither asks for nor touches loan payments
  const [loans, earlyPayments, loanPayments] = flows
    ? await Promise.all([loadLoans(db), loadEarlyPayments(db), loadLoanPayments(db)])
    : [[], [], []]
  return {
    closed,
    closures,
    assets,
    // hidden flow rows are invisible to the screen and the rules; the wizard leaves them alone
    flows, loans, earlyPayments, loanPayments,
    transfers: transfers.map(r => ({ rowid: Number(r.rowid), date: str(r.date), name: str(r.name), member: str(r.member), amount: Number(r.amount), currency: str(r.currency) })),
    cashflow: flows ? cashflow : [],
    members: members.map(r => str(r.name)).sort(),
    currencies: currencies.map(r => str(r.code)).sort(),
  }
}

/** A broken draft must not crash the screen: the month starts over. */
function readDraft(payload: string): MonthDraft | null {
  try { return parseDraft(JSON.parse(payload)) } catch { return null }
}

/** A month's balance and flow rows — by the date's month, not the exact day. */
const rowsOf = (data: Loaded, month: string) => ({
  balances: data.assets.filter(a => monthOf(a.date) === month),
  flows: data.cashflow.filter(c => monthOf(c.date) === month),
})

/** Accounts with a balance or movements in the month. */
const accountsIn = (data: Loaded, month: string | null): Set<AccountKey> => new Set(month === null ? [] : [
  ...data.assets.filter(a => monthOf(a.date) === month).map(a => accountKey(a.name, a.member)),
  ...data.cashflow.filter(c => monthOf(c.date) === month).map(c => accountKey(c.bank, c.member)),
])

type MonthlyTable = 'assets' | 'monthly_cashflow' | 'loan_payments' | 'account_transfers'

/** Inserts rows with consecutive rowids from firstRowid and a journal entry for each — for a batch, like insertRow. */
function insertStatements(db: Database, actor: Actor, table: MonthlyTable, columns: Column[], rows: Record<string, unknown>[], firstRowid: number, ts: string) {
  return rows.flatMap((row, i) => {
    const rowid = firstRowid + i
    return [
      insertStatement(db, table, columns, row, rowid),
      // after_json is read from the table in the same batch — the journal holds what was really written
      logStatement(db, actor, { table, rowid, op: 'insert', before: null, afterColumns: columns, ts }),
    ]
  })
}

/** Deletes rows, journaling what they held — for a batch, like deleteRow. */
function removalStatements(db: Database, actor: Actor, table: MonthlyTable, rows: Stored<object>[], ts: string) {
  return [...rows].sort((a, b) => a.rowid - b.rowid).flatMap(({ rowid, ...before }) => [
    db.prepare(`DELETE FROM ${table} WHERE rowid = ?`).bind(rowid),
    logStatement(db, actor, { table, rowid, op: 'delete', before, afterColumns: null, ts }),
  ])
}

const loanPaymentsOf = (data: Loaded, month: string) => data.loanPayments.filter(p => monthOf(p.date) === month)
const transfersOf = (data: Loaded, month: string) => data.transfers.filter(t => monthOf(t.date) === month)

const lastOf = (months: string[]) => (months.length ? months.reduce((a, b) => (a > b ? a : b)) : null)

/** pendingDraft projects a save's own acknowledgment from its guarded read snapshot. */
async function stateFrom(db: Database, data: Loaded, now: Date, pendingDraft?: MonthDraft): Promise<MonthCloseState> {
  const closedMonths = data.closed.map(c => c.month)
  const queue = openMonths(closedMonths, now)
  const month = queue[0] ?? null
  const prev = lastOf(closedMonths)
  const saved = pendingDraft ? { payload: JSON.stringify(pendingDraft), updated_at: now.toISOString() } : month
    ? await db.prepare('SELECT payload, updated_at FROM month_drafts WHERE month = ?').bind(month).first<{ payload: string; updated_at: string }>()
    : null
  const stray = month ? rowsOf(data, month) : { balances: [], flows: [] }
  const strayLoans = month ? loanPaymentsOf(data, month) : []
  const strayTransfers = month ? transfersOf(data, month) : []
  const strayRows = stray.balances.length + stray.flows.length + strayLoans.length
  // No draft but the month already has rows — show them, not empty fields
  const draft = saved ? readDraft(saved.payload)
    : month && strayRows ? draftFromRows(month, stray.balances, stray.flows, accountsIn(data, prev), new Set(), strayLoans, strayTransfers) : null
  const rows = month ? accountsFor(prev, data.assets, data.cashflow, data.closures, draft) : []
  const loanPayments = month ? loanPaymentsFor(month, data.loans, data.earlyPayments, draft) : []
  const hints = month ? hintsFor(prev, data.assets) : {}
  // a closed month without loan payment rows kept them inside its expenses (before they were entered apart)
  const legacyExpense = (m: string) => data.loans.length > 0 && !data.loanPayments.some(p => monthOf(p.date) === m)
  const flowHints = month && data.flows ? flowHintsFor(closedMonths, data.cashflow, legacyExpense) : {}
  const last = data.closed.find(c => c.month === prev)
  return {
    queue, month, rows, loanPayments, hints, flowHints,
    totals: draftTotals(rows, hints, data.flows, loanPayments),
    problems: month ? problemsIn(rows, data.flows, loanPayments) : [],
    draftRevision: month ? await draftRevision(db, month, {
      rows, loanPayments, typedLoans: draft?.loans ?? [], hints,
      closures: revisionRecords(data.closures), closed: revisionRecords(data.closed),
      // Current/previous source rows affect identities, hints and what close replaces, even with a stored draft.
      balances: revisionRecords(data.assets.filter(r => monthOf(r.date) === month || monthOf(r.date) === prev)),
      flows: revisionRecords(data.cashflow.filter(r => monthOf(r.date) === month || monthOf(r.date) === prev)),
      storedLoans: revisionRecords(strayLoans), storedTransfers: revisionRecords(strayTransfers), loans: revisionRecords(data.loans),
      earlyPayments: revisionRecords(data.earlyPayments.map(payment => ({ ...payment, notes: undefined }))),
      trackFlows: data.flows, members: data.members, currencies: data.currencies,
      suggested: suggestedAccounts(prev, data.assets, data.cashflow, data.closures, rows),
    }, pendingDraft !== undefined) : null,
    draftSavedAt: saved && draft ? saved.updated_at : null,
    lastClosed: last ? { month: last.month, reopenable: last.source === 'wizard' } : null,
    nextOpensOn: month ? null : `${shiftMonth(prevFinishedMonth(now), 2)}-01`,
    incomplete: incompleteMonths(data.closed, data.assets, data.cashflow, data.flows),
    suggested: month ? suggestedAccounts(prev, data.assets, data.cashflow, data.closures, rows) : [],
    strayRows,
    members: data.members,
    currencies: data.currencies,
    flows: data.flows,
    history: historyState(data, now),
  }
}

function historyState(data: Loaded, now: Date): MonthCloseState['history'] {
  const first = data.closed.map(c => c.month).sort()[0]
  const imported = data.closed.filter(c => c.source === 'import').map(c => c.month).sort()
  // in date order: the latest balance names an account's class and currency
  const accounts = new Map([...data.assets].sort((a, b) => a.date.localeCompare(b.date)).map(a => [accountKey(a.name, a.member), { name: a.name, member: a.member ?? '', class: a.class, currency: a.currency }]))
  return {
    endsAt: first === undefined ? null : shiftMonth(first, -1),
    until: prevFinishedMonth(now),
    imported: imported.length ? { first: imported[0], last: imported[imported.length - 1] } : null,
    accounts: [...accounts.values()].sort((a, b) => a.name.localeCompare(b.name) || a.member.localeCompare(b.member)),
  }
}

/** pendingDraft projects a guarded save's result, including its next revision, without writing or a post-commit read. */
export async function getMonthCloseState(db: Database, now = new Date(), pendingDraft?: MonthDraft): Promise<MonthCloseState> {
  return stateFrom(db, await load(db), now, pendingDraft)
}

/** The month in the path must be first in the queue: only it is filled in and closed. */
function requireFirst(month: string, queue: string[]): void {
  if (!MONTH_RE.test(month)) throw new InputError('invalid_month')
  if (queue[0] !== month) throw new InputError('month_out_of_order', 409)
}

/** Validates the complete read snapshot; the caller commits these writes under its read token. */
export async function buildSaveDraft(db: Database, month: string, body: unknown, now = new Date()): Promise<PreparedStatement[]> {
  const data = await load(db)
  const state = await stateFrom(db, data, now)
  requireFirst(month, state.queue)
  requireDraftRevision(body, state.draftRevision)
  let draft: MonthDraft
  try { draft = parseDraft(body) } catch (e) { throw new InputError('invalid_draft', 400, { detail: e instanceof Error ? e.message : 'Invalid draft' }) }
  return [
    db.prepare('INSERT OR REPLACE INTO month_drafts (month, payload, updated_at) VALUES (?, ?, ?)')
      .bind(month, JSON.stringify(draft), now.toISOString()),
    advanceDraftRevision(db, month),
  ]
}

export async function saveDraft(db: Database, month: string, body: unknown, now = new Date()): Promise<MonthCloseState> {
  return commitMutation(db, async () => {
    const statements = await buildSaveDraft(db, month, body, now)
    // A later writer may commit before our promise resumes. Return our own planned rows and next revision,
    // never a post-commit read that could attach that writer's revision to this client's newer local input.
    const result = await stateFrom(db, await load(db), now, parseDraft(body))
    return { statements, result }
  }, 'draft_conflict')
}

export async function closeMonth(db: Database, month: string, body: DraftRevisionRequest, actor: Actor, now = new Date()): Promise<MonthCloseState> {
  await commitMutation(db, async () => ({ statements: await buildCloseMonth(db, month, body, actor, now), result: undefined }), 'draft_conflict')
  return getMonthCloseState(db, now)
}

export async function buildCloseMonth(db: Database, month: string, body: DraftRevisionRequest, actor: Actor, now = new Date()): Promise<PreparedStatement[]> {
  const data = await load(db)
  const state = await stateFrom(db, data, now)
  requireFirst(month, state.queue)
  requireDraftRevision(body, state.draftRevision)
  if (state.problems.length) {
    throw new InputError('month_has_problems', 422, { problems: state.problems.map(({ name, member, problem }) => ({ name, member, problem })) })
  }
  // what a module keeps about the month (an account's lines over its total) is the module's to check; a balance-only close
  // (income and expenses not tracked) writes no flows for the lines to exceed
  if (data.flows) await checkModuleClose(month, state.rows, { db })
  const writes = closingWrites(month, state.rows, data.flows, state.loanPayments)
  // Rows of this month entered past the wizard are replaced: otherwise the balance doubles and the flows hit the key
  const stray = rowsOf(data, month)
  const strayLoans = loanPaymentsOf(data, month)
  const strayTransfers = transfersOf(data, month)
  const [assetColumns, flowColumns, loanColumns, transferColumns, assetId, flowId, loanId, transferId] = await Promise.all([
    tableColumns(db, 'assets'), tableColumns(db, 'monthly_cashflow'), tableColumns(db, 'loan_payments'), tableColumns(db, 'account_transfers'),
    nextRowid(db, 'assets'), data.flows ? nextRowid(db, 'monthly_cashflow') : 0, data.flows ? nextRowid(db, 'loan_payments') : 0, nextRowid(db, 'account_transfers'),
  ])
  const ts = now.toISOString()
  return [
    ...removalStatements(db, actor, 'assets', stray.balances, ts),
    ...(data.flows ? removalStatements(db, actor, 'monthly_cashflow', stray.flows, ts) : []),
    ...removalStatements(db, actor, 'loan_payments', strayLoans, ts),
    ...removalStatements(db, actor, 'account_transfers', strayTransfers, ts),
    ...insertStatements(db, actor, 'assets', assetColumns, writes.assets.map(r => ({ ...r })), assetId, ts),
    ...insertStatements(db, actor, 'account_transfers', transferColumns, writes.transfers.map(r => ({ ...r })), transferId, ts),
    ...(data.flows ? insertStatements(db, actor, 'monthly_cashflow', flowColumns, writes.cashflow.map(r => ({ ...r })), flowId, ts) : []),
    ...(data.flows ? insertStatements(db, actor, 'loan_payments', loanColumns, writes.loanPayments.map(r => ({ ...r })), loanId, ts) : []),
    ...writes.closures.map(c => db.prepare('INSERT OR IGNORE INTO account_closings (name, member, closed_month) VALUES (?, ?, ?)').bind(c.name, c.member, c.closedMonth)),
    // a plain insert: closing the same month again from another tab hits the key and rolls back the whole batch
    db.prepare('INSERT INTO closed_months (month, closed_at, closed_by) VALUES (?, ?, ?)').bind(month, ts, actor.name),
    db.prepare('DELETE FROM month_drafts WHERE month = ?').bind(month),
    advanceDraftRevision(db, month),
  ]
}

/** Undoing a close: the month's rows are deleted, the values go back to the draft. Only the last month closed by the wizard. */
export async function reopenMonth(db: Database, month: string, actor: Actor, now = new Date()): Promise<MonthCloseState> {
  await commitMutation(db, async () => ({ statements: await buildReopenMonth(db, month, actor, now), result: undefined }), 'draft_conflict')
  return getMonthCloseState(db, now)
}

async function buildReopenMonth(db: Database, month: string, actor: Actor, now: Date): Promise<PreparedStatement[]> {
  if (!MONTH_RE.test(month)) throw new InputError('invalid_month')
  const data = await load(db)
  const last = data.closed.find(c => c.month === lastOf(data.closed.map(x => x.month)))
  if (!last || last.month !== month) throw new InputError('reopen_not_last', 409)
  if (last.source === 'migration') throw new InputError('reopen_before_wizard', 409)
  if (last.source === 'import') throw new InputError('reopen_imported', 409)

  const prev = lastOf(data.closed.map(c => c.month).filter(m => m < month))
  const closing = new Set(data.closures.filter(c => c.closedMonth === month).map(c => accountKey(c.name, c.member)))
  const stored = rowsOf(data, month)
  const storedLoans = loanPaymentsOf(data, month)
  const storedTransfers = transfersOf(data, month)
  const draft = draftFromRows(month, stored.balances, stored.flows, accountsIn(data, prev), closing, storedLoans, storedTransfers)
  // A month closed before loan payments were stored has none, and its account expenses already hold what was paid:
  // the loan lines go back as typed zeros, or closing again would add the schedule on top (a double count). A month with
  // no flows at all (caught up with balances only) held no payment anywhere: its lines come from the schedule
  if (data.flows && storedLoans.length === 0 && stored.flows.length > 0) {
    const legacy = loanPaymentsFor(month, data.loans, data.earlyPayments, null).map(l => ({ name: l.name, amount: 0 }))
    if (legacy.length) draft.loans = legacy
  }
  const ts = now.toISOString()
  return [
    ...removalStatements(db, actor, 'assets', stored.balances, ts),
    ...(data.flows ? removalStatements(db, actor, 'monthly_cashflow', stored.flows, ts) : []),
    ...removalStatements(db, actor, 'loan_payments', storedLoans, ts),
    ...removalStatements(db, actor, 'account_transfers', storedTransfers, ts),
    db.prepare('DELETE FROM account_closings WHERE closed_month = ?').bind(month),
    db.prepare('DELETE FROM closed_months WHERE month = ?').bind(month),
    db.prepare('INSERT OR REPLACE INTO month_drafts (month, payload, updated_at) VALUES (?, ?, ?)').bind(month, JSON.stringify(draft), ts),
    advanceDraftRevision(db, month),
  ]
}

/**
 * An account was renamed on the «Accounts» screen: its closing mark and what was typed in the draft move
 * to the new name — otherwise a closed account would come back to the wizard and the draft would lose values.
 */
export async function buildRenameAccount(db: Database, source: AccountIdentity, target: AccountIdentity): Promise<PreparedStatement[]> {
  const drafts = (await db.prepare('SELECT month, payload FROM month_drafts').all()).results
  return [
    // a closure left by a deleted account under the new name is not this account's: it would hide it from the wizard
    db.prepare('DELETE FROM account_closings WHERE name = ? AND member = ?').bind(target.name, target.member),
    db.prepare('UPDATE account_closings SET name = ?, member = ? WHERE name = ? AND member = ?')
      .bind(target.name, target.member, source.name, source.member),
    ...drafts.flatMap(d => {
      const draft = readDraft(str(d.payload))
      if (!draft?.rows.some(r => r.name === source.name && (r.member ?? '') === source.member)) return []
      const rows = draft.rows.map(r => (r.name === source.name && (r.member ?? '') === source.member ? { ...r, ...target } : r))
      return [db.prepare('UPDATE month_drafts SET payload = ? WHERE month = ?').bind(JSON.stringify({ ...draft, rows }), str(d.month)), advanceDraftRevision(db, str(d.month))]
    }),
  ]
}

/** A loan name from a request: text of a sensible length, as stored. */
function readLoanName(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new InputError('invalid_loan', 400, { field })
  return value
}

/**
 * A loan was renamed on the «Loans» screen: its stored payments (`loan_payments`, which the generic API does not write) and what was
 * typed for it in the wizard's drafts move to the new name — otherwise the typed amount would fall back to the schedule and the
 * payments would lose their loan. One batch; each moved row is journaled.
 */
export async function buildRenameLoan(db: Database, actor: Actor, from: unknown, to: unknown): Promise<PreparedStatement[]> {
  const source = readLoanName(from, 'from')
  const target = readLoanName(to, 'to')
  if (source === target) return []
  const [payments, columns, drafts] = await Promise.all([
    loadLoanPayments(db), tableColumns(db, 'loan_payments'), db.prepare('SELECT month, payload FROM month_drafts').all().then(r => r.results),
  ])
  const ts = new Date().toISOString()
  return [
    ...payments.filter(p => p.loan_name === source).flatMap(({ rowid, ...before }) => [
      db.prepare('UPDATE loan_payments SET loan_name = ? WHERE rowid = ?').bind(target, rowid),
      logStatement(db, actor, { table: 'loan_payments', rowid, op: 'update', before, afterColumns: columns, ts }),
    ]),
    ...drafts.flatMap(d => {
      const draft = readDraft(str(d.payload))
      if (!draft?.loans?.some(l => l.name === source)) return []
      const loans = draft.loans.map(l => (l.name === source ? { ...l, name: target } : l))
      return [db.prepare('UPDATE month_drafts SET payload = ? WHERE month = ?').bind(JSON.stringify({ ...draft, loans }), str(d.month)), advanceDraftRevision(db, str(d.month))]
    }),
  ]
}
