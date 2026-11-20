// Catching up after a pause on SQLite: the grid's state, and closing every grid month in one guarded batch (balances, journal,
// the closed marks and the drafts land together or not at all). closed_by is the member who closes, as in the wizard, so the
// months reopen one by one from the newest; never the import marker, whose removal sweeps a whole range of months.
import type { Database, PreparedStatement } from './db'
import { InputError, type Actor } from './http'
import { commitMutation } from './mutations'
import { advanceDraftRevision, gridRevision, requireDraftRevision, revisionRecords } from './draftRevision'
import { nextRowid, tableColumns } from './rows'
import {
  getMonthCloseState, insertStatements, lastOf, load, loanPaymentsOf, readDraft, removalStatements, rowsOf, transfersOf, type Loaded,
} from './monthClose'
import type { CatchUpState, MonthCloseState } from '../domain/api'
import { accountKey } from '../domain/accounts'
import { catchUpMonths, catchUpProblems, catchUpRows, catchUpWrites, draftHasData, type CatchUpRow } from '../domain/catchUp'
import { monthOf } from '../domain/dates'
import { accountsFor, hintsFor, openMonths, type MonthDraft } from '../domain/monthClose'
import { moduleHasEntries } from '../modules/monthEntries'

const MAX_BALANCE = 1e12

/** The months' wizard drafts; `pending`: a draft being saved in the same plan, read instead of the stored one */
async function draftsOf(db: Database, months: readonly string[], pending: Readonly<Record<string, MonthDraft>>): Promise<Record<string, MonthDraft | null>> {
  return Object.fromEntries(await Promise.all(months.map(async month => {
    if (month in pending) return [month, pending[month]] as const
    const saved = await db.prepare('SELECT payload FROM month_drafts WHERE month = ?').bind(month).first<{ payload: string }>()
    return [month, saved ? readDraft(saved.payload) : null] as const
  })))
}

/**
 * Whether a month already has income or expense data of any kind, which leaves it to the wizard: flow and loan rows (hidden,
 * and so not counted, while flows are not tracked), transfers (never hidden), a balance of an account the grid does not ask
 * for, a draft holding more than balances, or a module's own entries.
 */
async function dataCheck(db: Database, data: Loaded, months: readonly string[], asked: ReadonlySet<string>, drafts: Readonly<Record<string, MonthDraft | null>>) {
  const entries = new Map(await Promise.all(months.map(async month => [month, await moduleHasEntries(month, { db })] as const)))
  return (month: string) => rowsOf(data, month).flows.length > 0 || loanPaymentsOf(data, month).length > 0 || transfersOf(data, month).length > 0
    || rowsOf(data, month).balances.some(b => !asked.has(accountKey(b.name, b.member)))
    || draftHasData(drafts[month] ?? null) || entries.get(month) === true
}

/** The accounts the first open month asks for (the month before's): none, and there is no grid to fill */
const askedOf = (data: Loaded, prev: string | null) => new Set(accountsFor(prev, data.assets, data.cashflow, data.closures, null).map(a => accountKey(a.name, a.member)))

async function stateOf(db: Database, data: Loaded, now: Date): Promise<CatchUpState | null> {
  const closedMonths = data.closed.map(c => c.month)
  const queue = openMonths(closedMonths, now)
  if (queue.length < 2) return null
  const prev = lastOf(closedMonths)
  const asked = askedOf(data, prev)
  if (asked.size === 0) return null
  const drafts = await draftsOf(db, queue, {})
  const { months, leftOut } = catchUpMonths(queue, await dataCheck(db, data, queue, asked, drafts))
  if (!months.length) return null
  const rows = catchUpRows(prev, months, data.assets, data.cashflow, data.closures, drafts)
  const revision = await gridRevision(db, months, {
    rows, leftOut, closed: revisionRecords(data.closed), closures: revisionRecords(data.closures),
    balances: revisionRecords(data.assets.filter(a => months.includes(monthOf(a.date)) || monthOf(a.date) === prev)),
    drafts: months.map(month => drafts[month] ?? null),
  })
  return { months, leftOut, newest: queue[queue.length - 1], rows, lastKnown: hintsFor(prev, data.assets), revision }
}

/**
 * Whether the wizard offers the grid (monthClose.ts puts it into every MonthCloseState): two or more open months, accounts to
 * ask for, and a first open month without data. Only that month is checked, so the wizard's state stays cheap.
 */
export async function catchUpOffered(db: Database, data: Loaded, now: Date, pending: Readonly<Record<string, MonthDraft>> = {}): Promise<boolean> {
  const closedMonths = data.closed.map(c => c.month)
  const queue = openMonths(closedMonths, now)
  if (queue.length < 2) return false
  const asked = askedOf(data, lastOf(closedMonths))
  if (asked.size === 0) return false
  const first = queue.slice(0, 1)
  return !(await dataCheck(db, data, first, asked, await draftsOf(db, first, pending)))(queue[0])
}

export async function getCatchUpState(db: Database, now = new Date()): Promise<CatchUpState | null> {
  return stateOf(db, await load(db), now)
}

const isBalance = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < MAX_BALANCE && Math.round(v * 100) / 100 === v)

/** The typed cells, in the grid's own rows: the body must name exactly the grid's accounts, in order, with a cell per month. */
function typedRows(body: unknown, state: CatchUpState): CatchUpRow[] {
  const rows = body && typeof body === 'object' && 'rows' in body ? body.rows : undefined
  if (!Array.isArray(rows) || rows.length !== state.rows.length) throw new InputError('invalid_catch_up', 400)
  return state.rows.map((row, i) => {
    const sent: unknown = rows[i]
    if (!sent || typeof sent !== 'object') throw new InputError('invalid_catch_up', 400)
    const { name, member, cells } = sent as Record<string, unknown>
    if (name !== row.name || member !== row.member || !Array.isArray(cells) || cells.length !== state.months.length || !cells.every(isBalance)) {
      throw new InputError('invalid_catch_up', 400)
    }
    return { ...row, cells }
  })
}

async function buildCloseCatchUp(db: Database, body: unknown, actor: Actor, now: Date): Promise<PreparedStatement[]> {
  const data = await load(db)
  const state = await stateOf(db, data, now)
  if (!state) throw new InputError('catch_up_unavailable', 409)
  requireDraftRevision(body, state.revision)
  const rows = typedRows(body, state)
  const problems = catchUpProblems(state.months, rows)
  if (problems.length) throw new InputError('catch_up_incomplete', 422, { months: problems.map(p => p.month) })
  const [columns, firstRowid] = await Promise.all([tableColumns(db, 'assets'), nextRowid(db, 'assets')])
  const ts = now.toISOString()
  let offset = 0
  return catchUpWrites(state.months, rows).flatMap(({ month, assets }) => {
    // a balance entered for the month past the wizard is replaced, or it would double
    const statements = [
      ...removalStatements(db, actor, 'assets', rowsOf(data, month).balances, ts),
      ...insertStatements(db, actor, 'assets', columns, assets.map(r => ({ ...r })), firstRowid + offset, ts),
      // a plain insert: a month closed meanwhile from another tab hits the key and rolls back the whole batch
      db.prepare('INSERT INTO closed_months (month, closed_at, closed_by) VALUES (?, ?, ?)').bind(month, ts, actor.name),
      db.prepare('DELETE FROM month_drafts WHERE month = ?').bind(month),
      advanceDraftRevision(db, month),
    ]
    offset += assets.length
    return statements
  })
}

export async function closeCatchUp(db: Database, body: unknown, actor: Actor, now = new Date()): Promise<MonthCloseState> {
  await commitMutation(db, async () => ({ statements: await buildCloseCatchUp(db, body, actor, now), result: undefined }), 'draft_conflict')
  return getMonthCloseState(db, now)
}
