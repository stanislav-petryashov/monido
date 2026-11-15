// The council's writes: propose, revise, withdraw, the votes and their settling, expiry, reminders, the goal link and the
// settings. Every write is one db.batch whose statements are conditional in SQL, so the state read before the batch
// decides nothing: two last votes cannot both accept, a press on a replaced or frozen version changes nothing. A journal
// entry is written right before the statement it records, under the same condition, with the row as it is and as it will
// be; `proposal_messages` (the delivery rows) are never journaled. The texts come in cleaned by the caller (`cleanText`)
// and only ever go into bound parameters.
import { ScenarioError, type Scenario } from '../../../domain/advisor'
import type { Evaluation } from '../../../domain/advisorImpact'
import type { AdvisorSettings, ProposalView } from '../../../domain/api'
import {
  COMMENT_WINDOW_MS, LATE_COMMENT_MS, deadlineAfter, parseSettings, remindAt,
  type ProposalStatus, type Verdict, type VoteValue,
} from '../../../domain/proposals'
import type { Database, PreparedStatement } from '../../../server/db'
import { InputError, SCHEDULER_ACTOR, type Actor } from '../../../server/http'
import { CHANGE_LOG_INSERT, rowJson, tableColumns } from '../../../server/rows'
import { councilUser } from './available'
import { currentVoters, readProposal, readSettings, versionBlock, type ProposalRow as StoredProposal } from './read'

/**
 * What is sent to the family: the scenario, the server's evaluation of it and Claude's verdict; the texts already cleaned.
 * `deadlineAt` — the deadline the preview showed (ISO); absent — the settings' days from now.
 */
export interface SendInput {
  scenario: Scenario; baseCurrency: string; evaluation: Evaluation; title: string; question: string; verdict: Verdict; deadlineAt?: string
}

export type VoteResult =
  | { outcome: 'recorded' | 'unchanged' }
  | { outcome: 'replaced'; version: number }
  | { outcome: 'closed'; status: ProposalStatus }
  | { outcome: 'not_voter' }
  /** the version no longer exists (the proposal is gone: a wipe or a restore) */
  | { outcome: 'gone' }

type Notice = 'against' | 'accepted' | 'withdrawn' | 'expired' | 'reminder'

// --- SQL fragments: text plus its bound values ------------------------------------------------------------------

/** A piece of SQL and the values bound to its `?`s, in order. */
class Sql {
  readonly text: string
  readonly args: readonly unknown[]
  constructor(text: string, args: readonly unknown[]) {
    this.text = text
    this.args = args
  }
}

/** SQL from a template: an interpolated Sql is inlined with its values, any other value becomes a bound `?`. */
function sql(strings: TemplateStringsArray, ...values: unknown[]): Sql {
  let text = strings[0]
  const args: unknown[] = []
  values.forEach((value, i) => {
    if (value instanceof Sql) {
      text += value.text
      args.push(...value.args)
    } else {
      text += '?'
      args.push(value)
    }
    text += strings[i + 1]
  })
  return new Sql(text, args)
}

/** SQL text of the code's own (a table name, a column list from the schema), never a value from outside. */
const raw = (text: string) => new Sql(text, [])
const statement = (db: Database, s: Sql): PreparedStatement => db.prepare(s.text).bind(...s.args)

// A version is addressed by an expression: a bound id, or the version just inserted in this batch (AUTOINCREMENT: the
// newest id is the one this transaction wrote).
const NEWEST_VERSION = raw('(SELECT MAX(id) FROM proposal_versions)')
const proposalOf = (version: Sql) => sql`(SELECT proposal_id FROM proposal_versions WHERE id = ${version})`
const numberOf = (version: Sql) => sql`(SELECT number FROM proposal_versions WHERE id = ${version})`
const currentVersionOf = (proposalId: number) =>
  sql`(SELECT v.id FROM proposal_versions v JOIN proposals p ON p.id = v.proposal_id AND v.number = p.version WHERE p.id = ${proposalId})`

// --- the journal ------------------------------------------------------------------------------------------------

type Columns = Awaited<ReturnType<typeof tableColumns>>
interface Ctx { db: Database; actor: Actor; ts: string; cols: Record<'proposals' | 'proposal_versions' | 'proposal_votes', Columns> }

async function context(db: Database, actor: Actor, now: Date): Promise<Ctx> {
  const [proposals, versions, votes] = await Promise.all(['proposals', 'proposal_versions', 'proposal_votes'].map(t => tableColumns(db, t)))
  return { db, actor, ts: now.toISOString(), cols: { proposals, proposal_versions: versions, proposal_votes: votes } }
}

/**
 * The journal entries of the rows of `table` that `where` selects now, put right before the statement that changes them
 * under the same `where`: the row as it is and `after` (an SQL expression over the row: json_set of the changed columns;
 * null for a delete). Both statements see the same state inside the transaction, so they hold or fail together.
 */
function journalChange(c: Ctx, table: keyof Ctx['cols'] | 'advisor_settings', cols: Columns, op: 'update' | 'delete', where: Sql, after: Sql | null): PreparedStatement {
  const row = raw(rowJson(cols))
  return statement(c.db, sql`${raw(CHANGE_LOG_INSERT)} SELECT ${c.ts}, ${c.actor.name}, ${c.actor.source}, ${table}, rowid, ${op}, ${row}, ${after ?? raw('NULL')}, NULL
    FROM ${raw(table)} WHERE ${where}`)
}

/** The journal entries of the rows of `table` that `where` selects right after they were inserted. */
function journalInsert(c: Ctx, table: keyof Ctx['cols'], where: Sql): PreparedStatement {
  return statement(c.db, sql`${raw(CHANGE_LOG_INSERT)} SELECT ${c.ts}, ${c.actor.name}, ${c.actor.source}, ${table}, rowid, 'insert', NULL, ${raw(rowJson(c.cols[table]))}, NULL
    FROM ${raw(table)} WHERE ${where}`)
}

/** The UPDATE statements of `updateProposals`: their changes say whether a write fired (`changesOf`). */
const PROPOSAL_UPDATES = new WeakSet<PreparedStatement>()

/** How many proposal rows the `updateProposals` statements among `statements` changed, given the batch's `results`. */
function changesOf(statements: PreparedStatement[], results: { meta: { changes: number } }[]): number {
  return statements.reduce((n, statement, i) => n + (PROPOSAL_UPDATES.has(statement) ? results[i].meta.changes : 0), 0)
}

/** An update of the proposal rows `where` selects, journaled: `set` names each changed column and its new value. */
function updateProposals(c: Ctx, set: Record<string, unknown>, where: Sql): PreparedStatement[] {
  const entries = Object.entries(set)
  const json = entries.reduce((acc, [column, value]) => sql`${acc}, ${`$.${column}`}, ${value}`, raw(''))
  const assign = entries.map(([column, value], i) => (i ? sql`, ${raw(column)} = ${value}` : sql`${raw(column)} = ${value}`))
    .reduce((acc, part) => sql`${acc}${part}`, raw(''))
  const update = statement(c.db, sql`UPDATE proposals SET ${assign} WHERE ${where}`)
  PROPOSAL_UPDATES.add(update)
  return [
    journalChange(c, 'proposals', c.cols.proposals, 'update', where, sql`json_set(${raw(rowJson(c.cols.proposals))}${json})`),
    update,
  ]
}

// --- delivery rows ----------------------------------------------------------------------------------------------

/** The version's voters who still have a users row, `u` (a deleted user drops out), from `proposal_versions v`. */
const VOTERS = raw('proposal_versions v, json_each(v.voters_json) j JOIN users u ON u.id = j.value')
/** The proposal's author as `u`, from the version `v`. */
const AUTHOR = raw('proposal_versions v JOIN proposals p ON p.id = v.proposal_id JOIN users u ON u.id = p.author_id')

/**
 * Delivery rows of `kind` for the version's recipients (`from` gives `v` and `u`, `where` narrows them); a user with no
 * linked Telegram gets none (no chat to send to: they still have the site). Once per (version, user, kind, notice).
 */
function messages(c: Ctx, version: Sql, kind: 'card' | 'status' | 'notice', notice: Notice | '', from: Sql, where: Sql = raw('1')): PreparedStatement {
  return statement(c.db, sql`INSERT INTO proposal_messages (version_id, user_id, chat_id, kind, notice, updated_at)
    SELECT v.id, u.id, u.telegram_id, ${kind}, ${notice}, ${c.ts} FROM ${from}
    WHERE v.id = ${version} AND u.telegram_id IS NOT NULL AND u.telegram_proposals = 1 AND ${where}
    ON CONFLICT DO NOTHING`)
}

/** A notice that goes only if the statement right before it changed a row (the transition it tells of happened). */
const noticeIfChanged = (c: Ctx, version: Sql, notice: Notice, from: Sql, where: Sql = raw('1')) =>
  messages(c, version, 'notice', notice, from, sql`${where} AND changes() > 0`)

/**
 * Marks a delivery row to be rendered again: `dirty` counts the changes since the last delivery, so a delivery that read
 * one count clears only that one (a change during the send stays). A failed row gets its attempts back: a later state is
 * worth trying again even after the earlier one ran out. `updated_at` is the delivery's own (its last attempt).
 */
const MARK_DIRTY = "dirty = dirty + 1, attempts = CASE WHEN state = 'failed' THEN 0 ELSE attempts END"

/** A delivery row's recipient's linked Telegram chat now (NULL — none), and whether it is another than the row's */
const AUTHOR_CHAT = raw('(SELECT telegram_id FROM users WHERE id = proposal_messages.user_id)')
const CHAT_MOVED = sql`(${AUTHOR_CHAT} IS NOT NULL AND ${AUTHOR_CHAT} != chat_id)`

/**
 * `u`, the proposal's author, has a status message that can show the outcome: in the chat they have now and not blocked.
 * Only then do they get no separate notice of it; a re-linked or blocked author gets one (their status row cannot show it).
 */
const STATUS_SHOWS = raw(`u.id NOT IN (SELECT m.user_id FROM proposal_messages m
  WHERE m.kind = 'status' AND m.chat_id = u.telegram_id AND m.state <> 'blocked'
    AND m.version_id IN (SELECT id FROM proposal_versions WHERE proposal_id = v.proposal_id))`)

/** The version's card and status messages are to be rendered again: the votes line or the status changed. */
const dirtyCards = (c: Ctx, version: Sql) => dirtyWhen(c, version, raw('1'))

/**
 * dirtyCards only if `condition` holds now; put right before the write it announces, under that write's own condition
 * (like a journal entry), so a refused press re-renders nothing.
 */
const dirtyWhen = (c: Ctx, version: Sql, condition: Sql) =>
  statement(c.db, sql`UPDATE proposal_messages SET ${raw(MARK_DIRTY)}
    WHERE version_id = ${version} AND kind IN ('card', 'status') AND (${condition})`)

/** The proposal rows `where` selects exist now: the condition of a proposals update, for dirtyWhen. */
const proposalsWhere = (where: Sql) => sql`EXISTS (SELECT 1 FROM proposals WHERE ${where})`

/** The version is the current one of an open proposal: the only version votes are written, settled or cancelled on. */
const openVersion = (version: Sql) => sql`EXISTS (SELECT 1 FROM proposals p JOIN proposal_versions v ON v.proposal_id = p.id
  WHERE v.id = ${version} AND p.status = 'open' AND p.version = v.number)`

// --- transitions --------------------------------------------------------------------------------------------------

/**
 * What the votes of the version decide, after every write of a vote and in the same batch: a settled `against` sends an
 * open current version back to the author (`revising`, a fresh deadline, an `against` notice to the author); a settled
 * `agree` of every voter who still has a users row accepts it (an `accepted` notice per voter, but not to an author whose
 * status message can show it: STATUS_SHOWS, one message each). An unlinked voter still
 * is one (they may vote on the site). Each update is conditional on the proposal still being open on this version, so
 * of two votes racing to be the last only one finds it open.
 */
function transitions(c: Ctx, version: Sql, decideDays: number): PreparedStatement[] {
  const current = sql`id = ${proposalOf(version)} AND status = 'open' AND version = ${numberOf(version)}`
  const against = sql`${current} AND EXISTS (SELECT 1 FROM proposal_votes WHERE version_id = ${version} AND settled = 1 AND vote = 'against')`
  const everyone = sql`${current} AND NOT EXISTS (
    SELECT 1 FROM proposal_versions v, json_each(v.voters_json) jv JOIN users u ON u.id = jv.value
    WHERE v.id = ${version} AND NOT EXISTS (
      SELECT 1 FROM proposal_votes pv WHERE pv.version_id = v.id AND pv.user_id = jv.value AND pv.settled = 1 AND pv.vote = 'agree'))`
  // the cards are marked first, under each update's own condition
  return [
    dirtyWhen(c, version, proposalsWhere(against)),
    ...updateProposals(c, { status: 'revising', deadline_at: deadlineAfter(new Date(c.ts), decideDays) }, against),
    noticeIfChanged(c, version, 'against', AUTHOR),
    dirtyWhen(c, version, proposalsWhere(everyone)),
    ...updateProposals(c, { status: 'accepted', decided_at: c.ts }, everyone),
    // the author's status message, when it can show the outcome, shows it itself: no second message to them
    noticeIfChanged(c, version, 'accepted', VOTERS, STATUS_SHOWS),
  ]
}

// --- reading what a write needs -----------------------------------------------------------------------------------

/** The `proposals` row as far as a write needs it. */
type ProposalRow = Omit<StoredProposal, 'created_at' | 'decided_at'>

async function proposalRow(db: Database, proposalId: number): Promise<ProposalRow> {
  const row = await db.prepare('SELECT * FROM proposals WHERE id = ?').bind(proposalId).first<ProposalRow>()
  if (!row) throw new InputError('advisor.proposal_not_found', 404)
  return row
}

const view = async (db: Database, proposalId: number, actor: Actor) => (await readProposal(db, proposalId, actor))!

// --- propose, revise, withdraw ------------------------------------------------------------------------------------

/**
 * The statements of a new version: the row, the author's settled agree, the cards and the author's status, the outcome.
 * `before` comes right before the transitions (revise moves the existing status row to the new version there, so that an
 * outcome at once sees it in the chat it will be shown in).
 */
function versionStatements(
  c: Ctx, proposal: Sql, number: number, input: SendInput, voters: number[], author: number, decideDays: number, before: PreparedStatement[] = [],
): PreparedStatement[] {
  return [
    statement(c.db, sql`INSERT INTO proposal_versions (proposal_id, number, title, question, scenario_json, evaluation_json, base_currency, verdict_json, voters_json, created_at)
      VALUES (${proposal}, ${number}, ${input.title}, ${input.question}, ${JSON.stringify(input.scenario)}, ${JSON.stringify(input.evaluation)},
        ${input.baseCurrency}, ${JSON.stringify(input.verdict)}, ${JSON.stringify(voters)}, ${c.ts})`),
    journalInsert(c, 'proposal_versions', sql`id = ${NEWEST_VERSION}`),
    statement(c.db, sql`INSERT INTO proposal_votes (version_id, user_id, vote, settled, settled_by, voted_at, settled_at)
      VALUES (${NEWEST_VERSION}, ${author}, 'agree', 1, 'author', ${c.ts}, ${c.ts})`),
    journalInsert(c, 'proposal_votes', sql`version_id = ${NEWEST_VERSION} AND user_id = ${author}`),
    messages(c, NEWEST_VERSION, 'card', '', VOTERS, sql`u.id != ${author}`),
    ...before,
    ...transitions(c, NEWEST_VERSION, decideDays),
    // the author's status message: a new proposal accepted at once (the author the only voter) gets none, the accepted
    // notice tells it; a revision has moved the existing one here (`before`), and it shows the outcome, accepted at once too
    messages(c, NEWEST_VERSION, 'status', '', AUTHOR, raw(`(SELECT status FROM proposals WHERE id = v.proposal_id) = 'open'`)),
  ]
}

/** Proposals one author may have waiting on the family (open or revising) at once. */
const MAX_OPEN = 5
const openOf = (author: number) => sql`(SELECT COUNT(*) FROM proposals WHERE author_id = ${author} AND status IN ('open', 'revising'))`

/**
 * Sends a new proposal to the family as version 1; the author must be a voter (409 `advisor.not_a_voter`) with fewer than
 * MAX_OPEN waiting (409 `advisor.too_many_open`).
 */
export async function propose(db: Database, input: SendInput, actor: Actor, now: Date): Promise<ProposalView> {
  const author = councilUser(actor)
  const [voters, settings, c] = await Promise.all([currentVoters(db), readSettings(db), context(db, actor, now)])
  if (!voters.includes(author)) throw new InputError('advisor.not_a_voter', 409)
  const newest = raw('(SELECT MAX(id) FROM proposals)')
  const tooMany = async () => (await statement(db, sql`SELECT ${openOf(author)} AS n`).first<{ n: number }>())!.n >= MAX_OPEN
  if (await tooMany()) throw new InputError('advisor.too_many_open', 409, { max: MAX_OPEN })
  let inserted
  try {
    // counted in the insert itself: past the cap author_id is NULL and the NOT NULL constraint rolls the batch back
    ;[inserted] = await db.batch([
      statement(db, sql`INSERT INTO proposals (type, author_id, status, version, created_at, deadline_at)
        VALUES (${input.scenario.kind}, CASE WHEN ${openOf(author)} < ${MAX_OPEN} THEN ${author} END, 'open', 1, ${c.ts}, ${input.deadlineAt ?? deadlineAfter(now, settings.decideDays)})`),
      journalInsert(c, 'proposals', sql`id = ${newest}`),
      ...versionStatements(c, newest, 1, input, voters, author, settings.decideDays),
    ])
  } catch (err) {
    // only the cap's NULL author: any other failure is not the cap's
    if (String(err).includes('NOT NULL constraint failed: proposals.author_id') && await tooMany()) throw new InputError('advisor.too_many_open', 409, { max: MAX_OPEN })
    throw err
  }
  return view(db, inserted.meta.last_row_id, actor)
}

/**
 * The author's next version of a proposal sent back to them (`revising` only, 409 `advisor.not_revising`; 403
 * `advisor.not_author`): the voters read again, the votes reset (the author agreed), a fresh deadline, the old cards
 * rendered again as replaced, the author's status message moved to the new version.
 */
export async function revise(db: Database, proposalId: number, input: SendInput, actor: Actor, now: Date): Promise<ProposalView> {
  const row = await proposalRow(db, proposalId)
  if (actor.userId === null || row.author_id !== actor.userId) throw new InputError('advisor.not_author', 403)
  if (row.status !== 'revising') throw new InputError('advisor.not_revising', 409)
  const [voters, settings, c] = await Promise.all([currentVoters(db), readSettings(db), context(db, actor, now)])
  if (!voters.includes(row.author_id)) throw new InputError('advisor.not_a_voter', 409)
  const old = currentVersionOf(proposalId)
  const number = row.version + 1
  const where = sql`id = ${proposalId} AND status = 'revising' AND version = ${row.version}`
  try {
    await db.batch([
      dirtyCards(c, old),
      ...updateProposals(c, { status: 'open', version: number, deadline_at: input.deadlineAt ?? deadlineAfter(now, settings.decideDays) }, where),
      // the new version's proposal is the one this batch reopened: if another write got there first, proposal_id is NULL
      // and the NOT NULL constraint rolls the whole batch back
      ...versionStatements(c, sql`(SELECT id FROM proposals WHERE id = ${proposalId} AND changes() > 0)`, number, input, voters, row.author_id, settings.decideDays, [
        // one status message per proposal: the author's moves to the new version and is edited (the cards are new per
        // version); if the author's Telegram is another account now, it starts over as a new message in that chat (with no
        // account, it keeps the old chat and the delivery blocks it as unlinked)
        statement(db, sql`UPDATE proposal_messages SET version_id = ${NEWEST_VERSION}, dirty = dirty + 1,
            chat_id = COALESCE(${AUTHOR_CHAT}, chat_id),
            message_id = CASE WHEN ${CHAT_MOVED} THEN NULL ELSE message_id END,
            sent_hash = CASE WHEN ${CHAT_MOVED} THEN NULL ELSE sent_hash END,
            state = CASE WHEN ${CHAT_MOVED} THEN 'pending' ELSE state END,
            last_error = CASE WHEN ${CHAT_MOVED} THEN NULL ELSE last_error END,
            attempts = CASE WHEN ${CHAT_MOVED} OR state = 'failed' THEN 0 ELSE attempts END
          WHERE kind = 'status' AND version_id = (SELECT id FROM proposal_versions WHERE proposal_id = ${proposalId} AND number = ${row.version})`),
      ]),
    ])
  } catch (err) {
    const fresh = await proposalRow(db, proposalId)
    if (fresh.status !== 'revising' || fresh.version !== row.version) throw new InputError('advisor.not_revising', 409)
    throw err
  }
  return view(db, proposalId, actor)
}

/** The author withdraws an open or revising proposal (403 `advisor.not_author`, 409 `advisor.proposal_closed`); the other voters are told. */
export async function withdraw(db: Database, proposalId: number, actor: Actor, now: Date): Promise<ProposalView> {
  const row = await proposalRow(db, proposalId)
  if (actor.userId === null || row.author_id !== actor.userId) throw new InputError('advisor.not_author', 403)
  if (row.status !== 'open' && row.status !== 'revising') throw new InputError('advisor.proposal_closed', 409)
  const c = await context(db, actor, now)
  const current = currentVersionOf(proposalId)
  const where = sql`id = ${proposalId} AND status IN ('open', 'revising')`
  const results = await db.batch([
    dirtyWhen(c, current, proposalsWhere(where)),
    ...updateProposals(c, { status: 'withdrawn', decided_at: c.ts }, where),
    noticeIfChanged(c, current, 'withdrawn', VOTERS, sql`u.id != ${row.author_id}`),
  ])
  if (results[2].meta.changes === 0) throw new InputError('advisor.proposal_closed', 409)
  return view(db, proposalId, actor)
}

// --- votes --------------------------------------------------------------------------------------------------------

/** Why a vote changed nothing: read after the batch, it only words the answer. */
async function classify(db: Database, versionId: number, userId: number, vote: VoteValue, ts: string): Promise<VoteResult> {
  const row = await db.prepare(`SELECT p.status, p.version, p.author_id, p.deadline_at, v.number, v.voters_json, pv.vote, pv.settled
      FROM proposal_versions v JOIN proposals p ON p.id = v.proposal_id
      LEFT JOIN proposal_votes pv ON pv.version_id = v.id AND pv.user_id = ?
      WHERE v.id = ?`)
    .bind(userId, versionId)
    .first<{
      status: ProposalStatus; version: number; author_id: number; deadline_at: string; number: number; voters_json: string
      vote: VoteValue | null; settled: number | null
    }>()
  if (!row) return { outcome: 'gone' }
  if (row.number !== row.version) return { outcome: 'replaced', version: row.version }
  if (!(JSON.parse(row.voters_json) as number[]).includes(userId)) return { outcome: 'not_voter' }
  // the author's agree came with the proposal and stays
  if (row.author_id === userId) return { outcome: 'unchanged' }
  if (row.settled === 1 && (row.vote === vote || (row.vote === 'against' && vote === 'agree'))) return { outcome: 'unchanged' }
  if (row.status !== 'open') return { outcome: 'closed', status: row.status }
  // past the deadline the vote stops, though the hourly run has not closed the proposal yet
  if (row.deadline_at <= ts) return { outcome: 'closed', status: 'expired' }
  return { outcome: 'unchanged' }
}

/**
 * A voter's press or site vote on a version. Written only while the proposal is open on that version and the user is
 * one of its voters; a settled vote is not written again with the same value, and a settled `against` is final (an
 * `agree` after it is `unchanged`), while a settled `agree` may become `against`; the author's own agree is fixed (their
 * press is `unchanged`). Nothing is written once the deadline has passed (`closed` as `expired`, before the hourly run
 * closes the proposal; a provisional vote cast in time still settles after it). `provisional` opens the comment window (COMMENT_WINDOW_MS) and counts for nothing until settled;
 * pressing the same provisional vote again is `unchanged` (no write, the window runs on). A provisional change over a settled vote keeps that
 * vote's settled_by, settled_at and comment, so that Cancel vote can restore it; `now` settles at once. The transitions
 * follow in the batch.
 */
export async function castVote(
  db: Database, versionId: number, userId: number, vote: VoteValue,
  options: { settle: 'now' | 'provisional'; comment?: string | null; by: 'button' | 'site' }, actor: Actor, now: Date,
): Promise<VoteResult> {
  const [settings, c] = await Promise.all([readSettings(db), context(db, actor, now)])
  const settled = options.settle === 'now'
  const row = {
    version_id: versionId, user_id: userId, vote, settled: settled ? 1 : 0, settled_by: settled ? options.by : null,
    pending_until: settled ? null : new Date(now.getTime() + COMMENT_WINDOW_MS).toISOString(),
    comment: settled ? options.comment ?? null : null, voted_at: c.ts, settled_at: settled ? c.ts : null,
  }
  const version = sql`${versionId}`
  const allowed = sql`${openVersion(version)}
    AND EXISTS (SELECT 1 FROM proposal_versions v JOIN proposals p ON p.id = v.proposal_id WHERE v.id = ${versionId} AND p.deadline_at > ${c.ts})
    AND NOT EXISTS (SELECT 1 FROM proposal_versions v JOIN proposals p ON p.id = v.proposal_id WHERE v.id = ${versionId} AND p.author_id = ${userId})
    AND EXISTS (SELECT 1 FROM proposal_versions v, json_each(v.voters_json) j WHERE v.id = ${versionId} AND j.value = ${userId})
    AND NOT EXISTS (SELECT 1 FROM proposal_votes WHERE version_id = ${versionId} AND user_id = ${userId} AND settled = 1
      AND (vote = ${vote} OR (vote = 'against' AND ${vote} = 'agree')))${settled ? raw('') : sql`
    AND NOT EXISTS (SELECT 1 FROM proposal_votes WHERE version_id = ${versionId} AND user_id = ${userId} AND settled = 0 AND vote = ${vote})`}`
  const existing = sql`(SELECT rowid FROM proposal_votes WHERE version_id = ${versionId} AND user_id = ${userId})`
  const nextRowid = raw('(SELECT COALESCE(MAX(rowid), 0) + 1 FROM proposal_votes)')
  const own = sql`FROM proposal_votes WHERE version_id = ${versionId} AND user_id = ${userId}`
  const voteJson = raw(rowJson(c.cols.proposal_votes))
  // the row as the upsert's update leaves it: a provisional vote keeps the settled columns of the vote it changes
  const updated = settled
    ? sql`json_set(${voteJson}, '$.vote', ${vote}, '$.settled', 1, '$.settled_by', ${row.settled_by}, '$.pending_until', NULL,
        '$.comment', ${row.comment}, '$.voted_at', ${c.ts}, '$.settled_at', ${c.ts})`
    : sql`json_set(${voteJson}, '$.vote', ${vote}, '$.settled', 0, '$.pending_until', ${row.pending_until}, '$.voted_at', ${c.ts})`
  const results = await db.batch([
    // the entry first, while the row is as it was; its after is the row as the upsert writes it
    statement(db, sql`${raw(CHANGE_LOG_INSERT)} SELECT ${c.ts}, ${actor.name}, ${actor.source}, 'proposal_votes', COALESCE(${existing}, ${nextRowid}),
        CASE WHEN ${existing} IS NULL THEN 'insert' ELSE 'update' END,
        (SELECT ${voteJson} ${own}), COALESCE((SELECT ${updated} ${own}), ${JSON.stringify(row)}), NULL
      WHERE ${allowed}`),
    dirtyWhen(c, version, allowed),
    statement(db, sql`INSERT INTO proposal_votes (rowid, version_id, user_id, vote, settled, settled_by, pending_until, comment, voted_at, settled_at)
      SELECT ${nextRowid}, ${row.version_id}, ${row.user_id}, ${row.vote}, ${row.settled}, ${row.settled_by}, ${row.pending_until}, ${row.comment}, ${row.voted_at}, ${row.settled_at}
      WHERE ${allowed}
      ON CONFLICT (version_id, user_id) DO UPDATE SET vote = excluded.vote, settled = excluded.settled,
        settled_by = CASE WHEN excluded.settled = 1 THEN excluded.settled_by ELSE proposal_votes.settled_by END,
        pending_until = excluded.pending_until,
        comment = CASE WHEN excluded.settled = 1 THEN excluded.comment ELSE proposal_votes.comment END,
        voted_at = excluded.voted_at,
        settled_at = CASE WHEN excluded.settled = 1 THEN excluded.settled_at ELSE proposal_votes.settled_at END
      WHERE NOT (proposal_votes.settled = 1 AND proposal_votes.vote = excluded.vote)`),
    ...transitions(c, version, settings.decideDays),
  ])
  return results[2].meta.changes > 0 ? { outcome: 'recorded' } : classify(db, versionId, userId, vote, c.ts)
}

/**
 * Settles a provisional vote — with the comment, by No comment, or when the window ran out (`timeout`) — and runs the
 * transitions; only on an open proposal's current version (a provisional vote left on a closed or replaced one stays as
 * it is, inert, and the answer is `closed` / `replaced`); `nothing` — no provisional vote of the user on that version.
 */
export async function settleVote(
  db: Database, versionId: number, userId: number, comment: string | null, by: 'comment' | 'button' | 'timeout', actor: Actor, now: Date,
): Promise<VoteResult | { outcome: 'nothing' }> {
  const [settings, c] = await Promise.all([readSettings(db), context(db, actor, now)])
  const version = sql`${versionId}`
  const where = sql`version_id = ${versionId} AND user_id = ${userId} AND settled = 0 AND ${openVersion(version)}`
  const results = await db.batch([
    journalChange(c, 'proposal_votes', c.cols.proposal_votes, 'update', where,
      sql`json_set(${raw(rowJson(c.cols.proposal_votes))}, '$.settled', 1, '$.settled_by', ${by}, '$.settled_at', ${c.ts}, '$.comment', ${comment})`),
    dirtyWhen(c, version, sql`EXISTS (SELECT 1 FROM proposal_votes WHERE ${where})`),
    statement(db, sql`UPDATE proposal_votes SET settled = 1, settled_by = ${by}, settled_at = ${c.ts}, comment = ${comment} WHERE ${where}`),
    ...transitions(c, version, settings.decideDays),
  ])
  if (results[2].meta.changes > 0) return { outcome: 'recorded' }
  return shut(db, versionId, { outcome: 'nothing' })
}

/** Why a write on a version that changed nothing could not: the version was replaced, or its proposal is not open; else `otherwise` (a version gone too). */
async function shut<T>(db: Database, versionId: number, otherwise: T) {
  const why = await versionBlock(db, versionId)
  return why && why.outcome !== 'gone' ? why : otherwise
}

/**
 * A comment added to the user's own settled agree after its window
 * closed (the site's "add a comment"), only on an open proposal's current version; journaled, the cards re-rendered. A
 * settled vote's value does not change, so no transition follows. `unchanged` — no settled agree, or the same comment.
 */
export async function addComment(db: Database, versionId: number, userId: number, comment: string, actor: Actor, now: Date): Promise<VoteResult> {
  const c = await context(db, actor, now)
  const version = sql`${versionId}`
  const where = sql`version_id = ${versionId} AND user_id = ${userId} AND settled = 1 AND vote = 'agree' AND comment IS NOT ${comment}
    AND ${openVersion(version)}`
  const results = await db.batch([
    journalChange(c, 'proposal_votes', c.cols.proposal_votes, 'update', where, sql`json_set(${raw(rowJson(c.cols.proposal_votes))}, '$.comment', ${comment})`),
    dirtyWhen(c, version, sql`EXISTS (SELECT 1 FROM proposal_votes WHERE ${where})`),
    statement(db, sql`UPDATE proposal_votes SET comment = ${comment} WHERE ${where}`),
  ])
  if (results[2].meta.changes > 0) return { outcome: 'recorded' }
  return shut(db, versionId, { outcome: 'unchanged' })
}

/**
 * Cancel vote, while the vote is provisional and the proposal open on that version: a change of a settled vote goes back
 * to it (a settled vote that could change is an `agree`: a settled `against` is final), a first vote is deleted; then the
 * transitions (the restored agree may be the last one). False — nothing to cancel.
 */
export async function cancelVote(db: Database, versionId: number, userId: number, actor: Actor, now: Date): Promise<boolean> {
  const [settings, c] = await Promise.all([readSettings(db), context(db, actor, now)])
  const version = sql`${versionId}`
  const provisional = sql`version_id = ${versionId} AND user_id = ${userId} AND settled = 0 AND ${openVersion(version)}`
  const restore = sql`${provisional} AND settled_by IS NOT NULL`
  const remove = sql`${provisional} AND settled_by IS NULL`
  const results = await db.batch([
    dirtyWhen(c, version, sql`EXISTS (SELECT 1 FROM proposal_votes WHERE ${provisional})`),
    journalChange(c, 'proposal_votes', c.cols.proposal_votes, 'update', restore,
      sql`json_set(${raw(rowJson(c.cols.proposal_votes))}, '$.vote', 'agree', '$.settled', 1, '$.pending_until', NULL)`),
    statement(db, sql`UPDATE proposal_votes SET vote = 'agree', settled = 1, pending_until = NULL WHERE ${restore}`),
    journalChange(c, 'proposal_votes', c.cols.proposal_votes, 'delete', remove, null),
    statement(db, sql`DELETE FROM proposal_votes WHERE ${remove}`),
    ...transitions(c, version, settings.decideDays),
  ])
  return results[2].meta.changes + results[4].meta.changes > 0
}

/**
 * Settles every provisional vote on an open proposal's current version whose comment window has closed, one by one (each
 * with its own transitions); how many.
 */
export async function settleDue(db: Database, now: Date): Promise<number> {
  const { results } = await db.prepare(`SELECT pv.version_id, pv.user_id FROM proposal_votes pv
      JOIN proposal_versions v ON v.id = pv.version_id JOIN proposals p ON p.id = v.proposal_id AND p.version = v.number AND p.status = 'open'
      WHERE pv.settled = 0 AND pv.pending_until <= ? ORDER BY pv.pending_until`)
    .bind(now.toISOString()).all<{ version_id: number; user_id: number }>()
  let settled = 0
  for (const v of results) {
    // an earlier settle of this run may have closed the version (an against): this one then records nothing
    const result = await settleVote(db, v.version_id, v.user_id, null, 'timeout', SCHEDULER_ACTOR, now)
    if (result.outcome === 'recorded') settled++
  }
  return settled
}

type VoteRef = { versionId: number; proposalId: number }
const voteRef = (row: { version_id: number; proposal_id: number } | null): VoteRef | null =>
  row ? { versionId: row.version_id, proposalId: row.proposal_id } : null

/** The user's newest provisional vote on an open proposal's current version, its comment window still open: their next message is its comment. */
export async function pendingVoteOf(db: Database, userId: number, now: Date): Promise<VoteRef | null> {
  return voteRef(await db.prepare(`SELECT pv.version_id, v.proposal_id FROM proposal_votes pv JOIN proposal_versions v ON v.id = pv.version_id
      JOIN proposals p ON p.id = v.proposal_id AND p.version = v.number AND p.status = 'open'
      WHERE pv.user_id = ? AND pv.settled = 0 AND pv.pending_until > ? ORDER BY pv.voted_at DESC, pv.rowid DESC LIMIT 1`)
    .bind(userId, now.toISOString()).first())
}

/**
 * The user's vote settled without a comment because its window closed less than LATE_COMMENT_MS ago: a comment now is
 * late; `closedAt` — when its window closed. Only a timeout settles it, so the window has closed by then even if `now` is
 * a moment earlier (a comment that lost the race with the timer).
 */
export async function lateVoteOf(db: Database, userId: number, now: Date): Promise<(VoteRef & { closedAt: string }) | null> {
  const row = await db.prepare(`SELECT pv.version_id, v.proposal_id, pv.pending_until FROM proposal_votes pv JOIN proposal_versions v ON v.id = pv.version_id
      WHERE pv.user_id = ? AND pv.settled = 1 AND pv.settled_by = 'timeout' AND pv.comment IS NULL AND pv.pending_until > ?
      ORDER BY pv.pending_until DESC LIMIT 1`)
    .bind(userId, new Date(now.getTime() - LATE_COMMENT_MS).toISOString()).first<{ version_id: number; proposal_id: number; pending_until: string }>()
  return row ? { ...voteRef(row)!, closedAt: row.pending_until } : null
}

// --- the hourly run -----------------------------------------------------------------------------------------------

/**
 * Runs the transitions of every open proposal's current version, one batch each, as the scheduler: a voter deleted since
 * the last vote no longer blocks, so the proposal may be accepted now. Journals and notices only when one fires; how many
 * fired. The hourly run calls it before expireDue.
 */
export async function recheckOpen(db: Database, now: Date): Promise<number> {
  const { results } = await db.prepare(`SELECT v.id FROM proposals p JOIN proposal_versions v ON v.proposal_id = p.id AND v.number = p.version
      WHERE p.status = 'open' ORDER BY p.id`).all<{ id: number }>()
  if (!results.length) return 0
  const [settings, c] = await Promise.all([readSettings(db), context(db, SCHEDULER_ACTOR, now)])
  let fired = 0
  for (const { id } of results) {
    const statements = transitions(c, sql`${id}`, settings.decideDays)
    fired += changesOf(statements, await db.batch(statements))
  }
  return fired
}

/**
 * Closes every open or revising proposal past its deadline, one batch each, and tells its current voters (the author by
 * their status message when it can show it: STATUS_SHOWS); the ids closed.
 */
export async function expireDue(db: Database, now: Date): Promise<number[]> {
  const ts = now.toISOString()
  const { results } = await db.prepare(`SELECT id FROM proposals WHERE status IN ('open', 'revising') AND deadline_at <= ? ORDER BY id`).bind(ts).all<{ id: number }>()
  const c = await context(db, SCHEDULER_ACTOR, now)
  const expired: number[] = []
  for (const { id } of results) {
    const current = currentVersionOf(id)
    const where = sql`id = ${id} AND status IN ('open', 'revising') AND deadline_at <= ${ts}`
    const statements = [
      dirtyWhen(c, current, proposalsWhere(where)),
      ...updateProposals(c, { status: 'expired', decided_at: ts }, where),
      noticeIfChanged(c, current, 'expired', VOTERS, STATUS_SHOWS),
    ]
    if (changesOf(statements, await db.batch(statements)) > 0) expired.push(id)
  }
  return expired
}

/**
 * The reminders due (none while they are off): from `remindDays` before the deadline, one per voter of an open
 * proposal's current version without a settled vote, and one to the author of a revising proposal; each once (the
 * unique delivery row). How many rows were created.
 */
export async function remindDue(db: Database, now: Date): Promise<number> {
  const { remindDays } = await readSettings(db)
  if (remindDays === null) return 0
  const ts = now.toISOString()
  const { results } = await db.prepare(`SELECT p.status, p.deadline_at, v.id AS version_id FROM proposals p
      JOIN proposal_versions v ON v.proposal_id = p.id AND v.number = p.version
      WHERE p.status IN ('open', 'revising') AND p.deadline_at > ? ORDER BY p.id`)
    .bind(ts).all<{ status: 'open' | 'revising'; deadline_at: string; version_id: number }>()
  const due = results.filter(r => remindAt(r.deadline_at, remindDays)! <= ts)
  if (!due.length) return 0
  const c = await context(db, SCHEDULER_ACTOR, now)
  // still in the state it was read in: the reminder belongs to that version and status
  const still = (status: string) => sql`(SELECT p.status FROM proposals p WHERE p.id = v.proposal_id AND p.version = v.number) = ${status}`
  const out = await db.batch(due.map(r => r.status === 'open'
    ? messages(c, sql`${r.version_id}`, 'notice', 'reminder', VOTERS, sql`${still('open')}
        AND NOT EXISTS (SELECT 1 FROM proposal_votes pv WHERE pv.version_id = v.id AND pv.user_id = u.id AND pv.settled = 1)`)
    : messages(c, sql`${r.version_id}`, 'notice', 'reminder', AUTHOR, still('revising'))))
  return out.reduce((n, r) => n + r.meta.changes, 0)
}

// --- the goal link and the settings -------------------------------------------------------------------------------

/**
 * Links an accepted `save_up` or `goal` proposal to the goal made from it (409 `advisor.cannot_link_goal` for another
 * proposal, 409 `advisor.goal_linked` when it already has one, 400 `unknown_goal` for a goal that does not exist).
 */
export async function linkGoal(db: Database, proposalId: number, goalId: string, actor: Actor): Promise<ProposalView> {
  await proposalRow(db, proposalId)
  const c = await context(db, actor, new Date())
  const results = await db.batch(updateProposals(c, { goal_id: goalId }, sql`id = ${proposalId} AND status = 'accepted'
    AND type IN ('save_up', 'goal') AND goal_id IS NULL AND EXISTS (SELECT 1 FROM goals WHERE id = ${goalId})`))
  if (results[1].meta.changes === 0) {
    // why, read after the write that did not happen
    const row = await proposalRow(db, proposalId)
    if (row.status !== 'accepted' || (row.type !== 'save_up' && row.type !== 'goal')) throw new InputError('advisor.cannot_link_goal', 409)
    if (row.goal_id !== null) throw new InputError('advisor.goal_linked', 409)
    throw new InputError('unknown_goal', 400)
  }
  return view(db, proposalId, actor)
}

/**
 * The council's days (through `parseSettings`: 400 `invalid_param` naming the field; a reminder of a whole number of days
 * that does not come before the deadline is 400 `advisor.remind_after_deadline`), journaled.
 */
export async function saveSettings(db: Database, body: unknown, actor: Actor): Promise<AdvisorSettings> {
  let settings: AdvisorSettings
  try { settings = parseSettings(body) } catch (err) {
    if (!(err instanceof ScenarioError)) throw err
    // the days to decide passed (they are checked first): a positive whole reminder fails only by not coming before them
    const remind = (body as { remindDays?: unknown } | null)?.remindDays
    if (err.param === 'remindDays' && Number.isSafeInteger(remind) && (remind as number) >= 1) {
      throw new InputError('advisor.remind_after_deadline', 400, { param: 'remindDays' })
    }
    throw new InputError('invalid_param', 400, { param: err.param })
  }
  const c = await context(db, actor, new Date())
  const cols = await tableColumns(db, 'advisor_settings')
  const where = raw('id = 1')
  await db.batch([
    journalChange(c, 'advisor_settings', cols, 'update', where,
      sql`json_set(${raw(rowJson(cols))}, '$.decide_days', ${settings.decideDays}, '$.remind_days', ${settings.remindDays})`),
    statement(db, sql`UPDATE advisor_settings SET decide_days = ${settings.decideDays}, remind_days = ${settings.remindDays} WHERE ${where}`),
  ])
  return readSettings(db)
}
