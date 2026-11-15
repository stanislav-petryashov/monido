import { describe, expect, it } from 'vitest'
import type { Scenario } from '../../../src/domain/advisor'
import type { Evaluation } from '../../../src/domain/advisorImpact'
import { COMMENT_WINDOW_MS } from '../../../src/domain/proposals'
import { readProposal, readProposals, readSettings } from '../../../src/modules/advisor/council/read'
import {
  addComment, cancelVote, castVote, expireDue, lateVoteOf, linkGoal, pendingVoteOf, propose, recheckOpen, remindDue, revise, saveSettings, settleDue,
  settleVote, withdraw, type SendInput,
} from '../../../src/modules/advisor/council/store'
import { type TestDb } from '../../helpers/db'
import { CREDIT, councilFamily, creditEvaluation, creditInput } from '../../helpers/council'

const DAY = 86_400_000
const T0 = new Date('2026-11-02T09:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)

const SAVE_UP: Scenario = { kind: 'save_up', amount: 6000, currency: 'USD', targetMonth: '2027-09' }

/** One evaluation of the demo family, computed once: the store takes it as it is */
let evaluation: Evaluation

/** The council family (helpers/council.ts): Ryan, Annika and Mila vote, in chats 101, 102 and 103. */
async function setup() {
  const family = councilFamily()
  evaluation = await creditEvaluation(family.db)
  return family
}

const input = (overrides: Partial<SendInput> = {}): SendInput => creditInput(evaluation, overrides)

type Row = Record<string, unknown>
const rows = (db: TestDb, sql: string, ...args: (string | number | null)[]) => db.sqlite.prepare(sql).all(...args) as Row[]
const messages = (db: TestDb, versionId: number) =>
  rows(db, 'SELECT user_id, chat_id, kind, notice, dirty FROM proposal_messages WHERE version_id = ? ORDER BY id', versionId)
const notices = (db: TestDb, notice: string) => rows(db, `SELECT version_id, user_id FROM proposal_messages WHERE kind = 'notice' AND notice = ? ORDER BY id`, notice)
const journal = (db: TestDb, table: string) => rows(db, 'SELECT actor, source, row_id, op, before_json, after_json FROM change_log WHERE table_name = ? ORDER BY id', table)
const statusChanges = (db: TestDb, status: string) =>
  journal(db, 'proposals').filter(e => e.op === 'update' && (JSON.parse(String(e.after_json)) as Row).status === status)
const cleanDirty = (db: TestDb) => db.sqlite.exec('UPDATE proposal_messages SET dirty = 0')
const vote = (db: TestDb, versionId: number, userId: number) =>
  db.sqlite.prepare('SELECT * FROM proposal_votes WHERE version_id = ? AND user_id = ?').get(versionId, userId) as Row | undefined

describe('the council store', () => {
  it('propose stores version 1 with the voters fixed, the author agreed, a card row per other voter and a status row for the author', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)

    expect(view).toMatchObject({ type: 'credit', status: 'open', author: { userId: ids.ryan, member: 'Ryan' }, baseCurrency: 'USD', goal: null, previous: [] })
    expect(view.createdAt).toBe(T0.toISOString())
    expect(view.deadlineAt).toBe(at(14 * DAY).toISOString())
    expect(view.current).toMatchObject({ number: 1, title: 'A car on credit', question: 'Shall we buy the car?', scenario: CREDIT, changes: { scenario: [], numbers: [] } })
    expect(view.current.evaluation).toEqual(evaluation)
    expect(view.current.votes).toEqual([
      { userId: ids.ryan, member: 'Ryan', vote: 'agree', settled: true, comment: null, votedAt: T0.toISOString() },
      { userId: ids.annika, member: 'Annika', vote: null, settled: false, comment: null, votedAt: null },
      { userId: ids.mila, member: 'Mila', vote: null, settled: false, comment: null, votedAt: null },
    ])
    expect(view.you).toEqual({ voter: true, vote: 'agree', settled: true, author: true })

    const version = rows(db, 'SELECT * FROM proposal_versions')[0]
    expect(JSON.parse(String(version.voters_json))).toEqual([ids.ryan, ids.annika, ids.mila])
    expect(vote(db, view.current.id, ids.ryan)).toMatchObject({ vote: 'agree', settled: 1, settled_by: 'author' })
    expect(messages(db, view.current.id)).toEqual([
      { user_id: ids.annika, chat_id: '102', kind: 'card', notice: '', dirty: 1 },
      { user_id: ids.mila, chat_id: '103', kind: 'card', notice: '', dirty: 1 },
      { user_id: ids.ryan, chat_id: '101', kind: 'status', notice: '', dirty: 1 },
    ])
  })

  it('refuses an author who is not a voter (no vote right or no Telegram)', async () => {
    const { db, actor } = await setup()
    db.sqlite.exec(`UPDATE users SET telegram_id = NULL WHERE member = 'Ryan'`)
    await expect(propose(db, input(), actor('Ryan'), T0)).rejects.toMatchObject({ code: 'advisor.not_a_voter', status: 409 })
    expect(rows(db, 'SELECT * FROM proposals')).toEqual([])
  })

  it('a voter needs a card (proposals on) or the site (Telegram sign-in on); revise re-reads the same set', async () => {
    const { db, ids, actor } = await setup()
    // Annika gets no card and cannot sign in: she could never vote; Mila has no card but votes on the site
    db.sqlite.exec(`UPDATE users SET telegram_proposals = 0, telegram_sign_in = 0 WHERE member = 'Annika';
      UPDATE users SET telegram_proposals = 0 WHERE member = 'Mila'`)
    const view = await propose(db, input(), actor('Ryan'), T0)
    expect(view.current.votes.map(v => v.userId)).toEqual([ids.ryan, ids.mila])
    await castVote(db, view.current.id, ids.mila, 'against', { settle: 'now', by: 'site' }, actor('Mila', 'admin'), at(1000))
    db.sqlite.exec(`UPDATE users SET telegram_sign_in = 0 WHERE member = 'Mila'; UPDATE users SET telegram_proposals = 1 WHERE member = 'Annika'`)
    const next = await revise(db, view.id, input(), actor('Ryan'), at(2000))
    expect(next.current.votes.map(v => v.userId)).toEqual([ids.ryan, ids.annika])
    // the only other voter agrees: the version is settled by the voters it was sent to
    await castVote(db, next.current.id, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(3000))
    expect(rows(db, 'SELECT status FROM proposals')[0].status).toBe('accepted')
  })

  it('refuses a sixth open or revising proposal of one author with 409 advisor.too_many_open, even sent at once', async () => {
    const { db, actor } = await setup()
    for (let i = 0; i < 4; i++) await propose(db, input(), actor('Ryan'), T0)
    db.sqlite.exec(`UPDATE proposals SET status = 'revising' WHERE id = 1`)
    // the fifth and a sixth race: only one gets through
    const raced = await Promise.allSettled([propose(db, input(), actor('Ryan'), T0), propose(db, input(), actor('Ryan'), T0)])
    expect(raced.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect((raced.find(r => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'advisor.too_many_open', status: 409 })
    expect(rows(db, 'SELECT COUNT(*) AS n FROM proposals')).toEqual([{ n: 5 }])
    // another author is not counted against, and a decided one frees a place
    await propose(db, input(), actor('Annika'), T0)
    db.sqlite.exec(`UPDATE proposals SET status = 'withdrawn' WHERE id = 2`)
    await propose(db, input(), actor('Ryan'), T0)
  })

  it('with the author as the only voter the proposal is accepted at once and only the author gets an accepted notice', async () => {
    const { db, ids, actor } = await setup()
    db.sqlite.exec(`UPDATE users SET can_vote = 0 WHERE member IN ('Annika', 'Mila')`)
    const view = await propose(db, input(), actor('Ryan'), T0)
    expect(view.status).toBe('accepted')
    expect(view.decidedAt).toBe(T0.toISOString())
    expect(messages(db, view.current.id)).toEqual([{ user_id: ids.ryan, chat_id: '101', kind: 'notice', notice: 'accepted', dirty: 1 }])
    expect(statusChanges(db, 'accepted')).toHaveLength(1)
  })

  it('a provisional vote changes nothing until settled; settling it with a comment keeps the comment', async () => {
    const { db, ids, actor } = await setup()
    const proposal = await propose(db, input(), actor('Ryan'), T0)
    const { current } = proposal
    expect(await castVote(db, current.id, ids.mila, 'agree', { settle: 'now', by: 'site' }, actor('Mila', 'admin'), at(1000))).toEqual({ outcome: 'recorded' })

    expect(await castVote(db, current.id, ids.annika, 'agree', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(2000))).toEqual({ outcome: 'recorded' })
    expect(vote(db, current.id, ids.annika)).toMatchObject({ vote: 'agree', settled: 0, settled_by: null, pending_until: at(2000 + COMMENT_WINDOW_MS).toISOString() })
    expect((await readProposal(db, proposal.id, actor('Annika')))!.status).toBe('open')
    expect(await pendingVoteOf(db, ids.annika, at(3000))).toEqual({ versionId: current.id, proposalId: proposal.id })
    expect(await pendingVoteOf(db, ids.annika, at(2000 + COMMENT_WINDOW_MS))).toBeNull()

    expect(await settleVote(db, current.id, ids.annika, 'Good idea', 'comment', actor('Annika', 'bot'), at(5000))).toEqual({ outcome: 'recorded' })
    expect(vote(db, current.id, ids.annika)).toMatchObject({ settled: 1, settled_by: 'comment', comment: 'Good idea', settled_at: at(5000).toISOString() })
    const view = (await readProposals(db, actor('Annika'))).proposals[0]
    expect(view.status).toBe('accepted')
    expect(view.current.votes.find(v => v.userId === ids.annika)).toMatchObject({ vote: 'agree', settled: true, comment: 'Good idea' })
    expect(await settleVote(db, current.id, ids.annika, null, 'button', actor('Annika', 'bot'), at(6000))).toEqual({ outcome: 'closed', status: 'accepted' })
  })

  it('cancel after a change of vote restores the settled agree; settling the change overwrites it', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    const v = view.current.id
    await castVote(db, v, ids.annika, 'agree', { settle: 'now', comment: 'Fine by me', by: 'site' }, actor('Annika', 'admin'), at(1000))
    expect(await castVote(db, v, ids.annika, 'against', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(2000))).toEqual({ outcome: 'recorded' })
    expect(vote(db, v, ids.annika)).toMatchObject({ vote: 'against', settled: 0, settled_by: 'site', settled_at: at(1000).toISOString(), comment: 'Fine by me' })
    expect((await readProposal(db, view.id, actor('Ryan')))!.status).toBe('open')

    expect(await cancelVote(db, v, ids.annika, actor('Annika', 'bot'), at(3000))).toBe(true)
    expect(vote(db, v, ids.annika)).toMatchObject({ vote: 'agree', settled: 1, pending_until: null, settled_by: 'site', settled_at: at(1000).toISOString(), comment: 'Fine by me' })
    const restored = journal(db, 'proposal_votes').at(-1)!
    expect(restored).toMatchObject({ op: 'update', actor: 'Annika', source: 'bot' })
    expect(JSON.parse(String(restored.after_json))).toEqual(vote(db, v, ids.annika))

    await castVote(db, v, ids.annika, 'against', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(4000))
    await settleVote(db, v, ids.annika, 'On second thought, no', 'comment', actor('Annika', 'bot'), at(5000))
    expect(vote(db, v, ids.annika)).toMatchObject({ vote: 'against', settled: 1, settled_by: 'comment', settled_at: at(5000).toISOString(), comment: 'On second thought, no' })
    expect((await readProposal(db, view.id, actor('Ryan')))!.status).toBe('revising')

    // the restored agree may be the last one: the cancel accepts the proposal
    const second = await propose(db, input(), actor('Ryan'), at(6000))
    const w = second.current.id
    await castVote(db, w, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(7000))
    await castVote(db, w, ids.annika, 'against', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(8000))
    await castVote(db, w, ids.mila, 'agree', { settle: 'now', by: 'button' }, actor('Mila', 'bot'), at(9000))
    expect((await readProposal(db, second.id, actor('Ryan')))!.status).toBe('open')
    expect(await cancelVote(db, w, ids.annika, actor('Annika', 'bot'), at(10_000))).toBe(true)
    expect((await readProposal(db, second.id, actor('Ryan')))!.status).toBe('accepted')
    expect(statusChanges(db, 'accepted')).toEqual([expect.objectContaining({ actor: 'Annika', row_id: second.id })])
  })

  it('a closed or replaced proposal takes no settles: a late comment answers closed and the provisional row stays inert', async () => {
    const { db, ids, actor } = await setup()
    const withdrawn = await propose(db, input(), actor('Ryan'), T0)
    await castVote(db, withdrawn.current.id, ids.annika, 'against', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(1000))
    await withdraw(db, withdrawn.id, actor('Ryan'), at(2000))
    const entries = rows(db, 'SELECT COUNT(*) AS n FROM change_log')[0].n as number
    expect(await pendingVoteOf(db, ids.annika, at(3000))).toBeNull()
    expect(await settleVote(db, withdrawn.current.id, ids.annika, 'Too late', 'comment', actor('Annika', 'bot'), at(3000)))
      .toEqual({ outcome: 'closed', status: 'withdrawn' })
    expect(rows(db, 'SELECT COUNT(*) AS n FROM change_log')[0].n).toBe(entries)
    expect(vote(db, withdrawn.current.id, ids.annika)).toMatchObject({ settled: 0, comment: null })

    const expired = await propose(db, input(), actor('Ryan'), at(4000))
    await castVote(db, expired.current.id, ids.mila, 'against', { settle: 'provisional', by: 'button' }, actor('Mila', 'bot'), at(14 * DAY))
    expect(await expireDue(db, at(14 * DAY + 4000))).toEqual([expired.id])
    expect(await settleDue(db, at(15 * DAY))).toBe(0)
    expect(vote(db, expired.current.id, ids.mila)).toMatchObject({ settled: 0 })
    expect(vote(db, withdrawn.current.id, ids.annika)).toMatchObject({ settled: 0 })
    expect(notices(db, 'against')).toEqual([])
    expect(rows(db, 'SELECT COUNT(*) AS n FROM change_log')[0].n).toBe(entries + 5)
  })

  it('recheckOpen accepts a proposal whose last missing voter was deleted, once', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    const other = await propose(db, input(), actor('Ryan'), T0)
    await castVote(db, view.current.id, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(1000))
    db.sqlite.prepare('DELETE FROM users WHERE id = ?').run(ids.mila)
    expect((await readProposal(db, view.id, actor('Ryan')))!.status).toBe('open')
    cleanDirty(db)

    expect(await recheckOpen(db, at(2000))).toBe(1)
    expect((await readProposal(db, view.id, actor('Ryan')))!).toMatchObject({ status: 'accepted', decidedAt: at(2000).toISOString() })
    expect((await readProposal(db, other.id, actor('Ryan')))!.status).toBe('open')
    expect(statusChanges(db, 'accepted')).toEqual([expect.objectContaining({ actor: 'scheduler', source: 'scheduler', row_id: view.id })])
    // the author's status message shows the outcome: the notice goes to the other voters
    expect(notices(db, 'accepted')).toEqual([ids.annika].map(user_id => ({ version_id: view.current.id, user_id })))
    expect(messages(db, other.current.id).every(m => m.dirty === 0)).toBe(true)
    expect(await recheckOpen(db, at(3000))).toBe(0)
    expect(statusChanges(db, 'accepted')).toHaveLength(1)
  })

  it('a refused press marks nothing dirty; the author cannot vote on their own proposal', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    const v1 = view.current.id
    cleanDirty(db)
    expect(await castVote(db, v1, ids.ryan, 'against', { settle: 'now', by: 'site' }, actor('Ryan', 'admin'), at(1000))).toEqual({ outcome: 'unchanged' })
    expect(vote(db, v1, ids.ryan)).toMatchObject({ vote: 'agree', settled: 1, settled_by: 'author' })
    expect(await castVote(db, v1, 999, 'agree', { settle: 'now', by: 'site' }, actor('Annika', 'admin'), at(1000))).toEqual({ outcome: 'not_voter' })
    await castVote(db, v1, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(1000))
    cleanDirty(db)
    expect(await castVote(db, v1, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(2000))).toEqual({ outcome: 'unchanged' })
    expect(await settleVote(db, v1, ids.annika, null, 'button', actor('Annika', 'bot'), at(2000))).toEqual({ outcome: 'nothing' })
    expect(await cancelVote(db, v1, ids.annika, actor('Annika', 'bot'), at(2000))).toBe(false)
    expect(rows(db, 'SELECT dirty FROM proposal_messages').every(m => m.dirty === 0)).toBe(true)

    await castVote(db, v1, ids.mila, 'against', { settle: 'now', by: 'button' }, actor('Mila', 'bot'), at(3000))
    await revise(db, view.id, input(), actor('Ryan'), at(4000))
    cleanDirty(db)
    expect(await castVote(db, v1, ids.mila, 'agree', { settle: 'now', by: 'button' }, actor('Mila', 'bot'), at(5000))).toEqual({ outcome: 'replaced', version: 2 })
    await withdraw(db, view.id, actor('Ryan'), at(6000))
    cleanDirty(db)
    const v2 = (await readProposal(db, view.id, actor('Ryan')))!.current.id
    expect(await castVote(db, v2, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(7000))).toEqual({ outcome: 'closed', status: 'withdrawn' })
    expect(rows(db, 'SELECT dirty FROM proposal_messages').every(m => m.dirty === 0)).toBe(true)
  })

  it('a pending change of vote reads without the earlier comment and is not a late vote; settleDue counts only what it recorded', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    const v = view.current.id
    await castVote(db, v, ids.annika, 'agree', { settle: 'now', comment: 'Fine by me', by: 'site' }, actor('Annika', 'admin'), at(1000))
    await castVote(db, v, ids.annika, 'against', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(2000))
    const pending = (await readProposal(db, view.id, actor('Annika')))!.current.votes.find(x => x.userId === ids.annika)
    expect(pending).toEqual({ userId: ids.annika, member: 'Annika', vote: 'against', settled: false, comment: null, votedAt: at(2000).toISOString() })

    // a timed-out agree changed to a pending against is not a late vote: its window is open again
    await castVote(db, v, ids.mila, 'agree', { settle: 'provisional', by: 'button' }, actor('Mila', 'bot'), at(0))
    expect(await settleDue(db, at(COMMENT_WINDOW_MS))).toBe(1)
    await castVote(db, v, ids.mila, 'against', { settle: 'provisional', by: 'button' }, actor('Mila', 'bot'), at(COMMENT_WINDOW_MS + 1000))
    expect(vote(db, v, ids.mila)).toMatchObject({ settled: 0, settled_by: 'timeout', comment: null })
    expect(await pendingVoteOf(db, ids.mila, at(COMMENT_WINDOW_MS + 2000))).toEqual({ versionId: v, proposalId: view.id })
    // its window has closed but no run has settled it yet: still not a late vote
    expect(await lateVoteOf(db, ids.mila, at(2 * COMMENT_WINDOW_MS + 2000))).toBeNull()

    // two windows close at once: the first against freezes the version, so the second settle records nothing
    expect(await settleDue(db, at(DAY))).toBe(1)
    expect((await readProposal(db, view.id, actor('Ryan')))!.status).toBe('revising')
    expect(vote(db, v, ids.mila)).toMatchObject({ settled: 0 })
  })

  it('addComment sets the comment of a settled agree on an open current version, journaled; anything else answers why not', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    const v = view.current.id
    await castVote(db, v, ids.annika, 'agree', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(0))
    // still provisional: nothing to comment yet
    expect(await addComment(db, v, ids.annika, 'Too early', actor('Annika', 'admin'), at(1000))).toEqual({ outcome: 'unchanged' })
    await settleDue(db, at(COMMENT_WINDOW_MS))
    cleanDirty(db)
    const before = journal(db, 'proposal_votes').length

    expect(await addComment(db, v, ids.annika, 'Late but agreed', actor('Annika', 'admin'), at(COMMENT_WINDOW_MS + 1000))).toEqual({ outcome: 'recorded' })
    expect(vote(db, v, ids.annika)).toMatchObject({ vote: 'agree', settled: 1, settled_by: 'timeout', comment: 'Late but agreed' })
    const entries = journal(db, 'proposal_votes')
    expect(entries).toHaveLength(before + 1)
    expect(entries.at(-1)).toMatchObject({ actor: 'Annika', source: 'admin', op: 'update' })
    expect((JSON.parse(String(entries.at(-1)!.after_json)) as Row).comment).toBe('Late but agreed')
    expect(messages(db, v).filter(m => m.kind !== 'notice').every(m => Number(m.dirty) > 0)).toBe(true)
    // the same text again, or Mila with no vote: unchanged, and nothing marked
    cleanDirty(db)
    expect(await addComment(db, v, ids.annika, 'Late but agreed', actor('Annika', 'admin'), at(COMMENT_WINDOW_MS + 2000))).toEqual({ outcome: 'unchanged' })
    expect(await addComment(db, v, ids.mila, 'Hello', actor('Mila', 'admin'), at(COMMENT_WINDOW_MS + 2000))).toEqual({ outcome: 'unchanged' })
    expect(messages(db, v).every(m => Number(m.dirty) === 0)).toBe(true)
    expect(journal(db, 'proposal_votes')).toHaveLength(before + 1)

    // an against sends it back: closed revising; after a new version: replaced
    await castVote(db, v, ids.mila, 'against', { settle: 'now', by: 'site' }, actor('Mila', 'admin'), at(COMMENT_WINDOW_MS + 3000))
    expect(await addComment(db, v, ids.annika, 'Changed my text', actor('Annika', 'admin'), at(COMMENT_WINDOW_MS + 4000))).toEqual({ outcome: 'closed', status: 'revising' })
    await revise(db, view.id, input(), actor('Ryan'), at(COMMENT_WINDOW_MS + 5000))
    expect(await addComment(db, v, ids.annika, 'Changed my text', actor('Annika', 'admin'), at(COMMENT_WINDOW_MS + 6000))).toEqual({ outcome: 'replaced', version: 2 })
    expect(vote(db, v, ids.annika)).toMatchObject({ comment: 'Late but agreed' })
  })

  it('cancelVote deletes only a provisional vote', async () => {
    const { db, ids, actor } = await setup()
    const { current } = await propose(db, input(), actor('Ryan'), T0)
    await castVote(db, current.id, ids.annika, 'against', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(1000))
    cleanDirty(db)
    expect(await cancelVote(db, current.id, ids.annika, actor('Annika', 'bot'), at(2000))).toBe(true)
    expect(vote(db, current.id, ids.annika)).toBeUndefined()
    expect(messages(db, current.id).every(m => Number(m.dirty) > 0)).toBe(true)
    expect(await cancelVote(db, current.id, ids.annika, actor('Annika', 'bot'), at(3000))).toBe(false)
    await castVote(db, current.id, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(4000))
    expect(await cancelVote(db, current.id, ids.annika, actor('Annika', 'bot'), at(5000))).toBe(false)
    expect(vote(db, current.id, ids.annika)).toMatchObject({ settled: 1 })
    expect(journal(db, 'proposal_votes').map(e => e.op)).toEqual(['insert', 'insert', 'delete', 'insert'])
  })

  it('every voter agreeing accepts the proposal: one journal entry, an accepted notice per voter but the author (their status tells), cards dirty', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    const versionId = view.current.id
    await castVote(db, versionId, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(1000))
    expect((await readProposal(db, view.id, actor('Ryan')))!.status).toBe('open')
    cleanDirty(db)
    await castVote(db, versionId, ids.mila, 'agree', { settle: 'now', comment: 'Yes', by: 'site' }, actor('Mila', 'admin'), at(2000))

    const after = (await readProposal(db, view.id, actor('Ryan')))!
    expect(after).toMatchObject({ status: 'accepted', decidedAt: at(2000).toISOString() })
    const accepted = statusChanges(db, 'accepted')
    expect(accepted).toHaveLength(1)
    expect(accepted[0]).toMatchObject({ actor: 'Mila', source: 'admin', row_id: view.id })
    expect(JSON.parse(String(accepted[0].before_json))).toMatchObject({ status: 'open', decided_at: null })
    expect(notices(db, 'accepted')).toEqual([ids.annika, ids.mila].map(user_id => ({ version_id: versionId, user_id })))
    expect(rows(db, `SELECT dirty FROM proposal_messages WHERE kind IN ('card', 'status')`).every(m => Number(m.dirty) > 0)).toBe(true)
    expect(await castVote(db, versionId, ids.annika, 'against', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(3000)))
      .toEqual({ outcome: 'closed', status: 'accepted' })
  })

  it('two last agrees produce one acceptance', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    const versionId = view.current.id
    // both calls read what they need before either writes: the batches, not the reads, decide
    const steps: string[] = []
    const prepare = db.prepare.bind(db)
    const batch = db.batch.bind(db)
    db.prepare = sql => {
      if (sql.startsWith('SELECT decide_days')) steps.push('read')
      return prepare(sql)
    }
    db.batch = statements => {
      steps.push('write')
      return batch(statements)
    }
    const results = await Promise.all([
      castVote(db, versionId, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(1000)),
      castVote(db, versionId, ids.mila, 'agree', { settle: 'now', by: 'button' }, actor('Mila', 'bot'), at(1000)),
    ])
    expect(results).toEqual([{ outcome: 'recorded' }, { outcome: 'recorded' }])
    expect(steps).toEqual(['read', 'read', 'write', 'write'])
    expect((await readProposal(db, view.id, actor('Ryan')))!.status).toBe('accepted')
    expect(rows(db, 'SELECT user_id FROM proposal_votes WHERE settled = 1 ORDER BY user_id').map(r => r.user_id)).toEqual([ids.ryan, ids.annika, ids.mila].sort((a, b) => a - b))
    expect(statusChanges(db, 'accepted')).toHaveLength(1)
    expect(notices(db, 'accepted')).toHaveLength(2)

    // the same last press twice at once (a double click on the site): one vote, still one acceptance
    const again = await setup()
    const second = await propose(again.db, input(), again.actor('Ryan'), T0)
    await castVote(again.db, second.current.id, again.ids.annika, 'agree', { settle: 'now', by: 'site' }, again.actor('Annika', 'admin'), at(1000))
    const twice = await Promise.all([1, 2].map(() =>
      castVote(again.db, second.current.id, again.ids.mila, 'agree', { settle: 'now', by: 'site' }, again.actor('Mila', 'admin'), at(2000))))
    expect(twice.map(r => r.outcome).sort()).toEqual(['recorded', 'unchanged'])
    expect(statusChanges(again.db, 'accepted')).toHaveLength(1)
    expect(notices(again.db, 'accepted')).toHaveLength(2)
    expect(journal(again.db, 'proposal_votes')).toHaveLength(3)
  })

  it('a settled against turns the proposal to revising, restarts the deadline and notices the author once', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    await castVote(db, view.current.id, ids.annika, 'against', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(DAY))
    expect((await readProposal(db, view.id, actor('Ryan')))!.status).toBe('open')
    expect(notices(db, 'against')).toEqual([])
    cleanDirty(db)
    await settleVote(db, view.current.id, ids.annika, 'Wait for the bonus', 'comment', actor('Annika', 'bot'), at(DAY + 1000))

    const after = (await readProposal(db, view.id, actor('Ryan')))!
    expect(after).toMatchObject({ status: 'revising', deadlineAt: at(DAY + 1000 + 14 * DAY).toISOString(), decidedAt: null })
    expect(notices(db, 'against')).toEqual([{ version_id: view.current.id, user_id: ids.ryan }])
    expect(statusChanges(db, 'revising')).toHaveLength(1)
    expect(rows(db, `SELECT dirty FROM proposal_messages WHERE kind IN ('card', 'status')`).every(m => Number(m.dirty) > 0)).toBe(true)

    expect(await castVote(db, view.current.id, ids.annika, 'against', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(DAY + 2000)))
      .toEqual({ outcome: 'unchanged' })
    expect(notices(db, 'against')).toHaveLength(1)
    expect(statusChanges(db, 'revising')).toHaveLength(1)
  })

  it('nobody can vote while revising; a vote on a replaced version answers replaced with the current number', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    const v1 = view.current.id
    await castVote(db, v1, ids.annika, 'against', { settle: 'now', comment: 'No', by: 'site' }, actor('Annika', 'admin'), at(1000))
    expect(await castVote(db, v1, ids.mila, 'agree', { settle: 'now', by: 'button' }, actor('Mila', 'bot'), at(2000)))
      .toEqual({ outcome: 'closed', status: 'revising' })
    expect(await castVote(db, v1, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(2000)))
      .toEqual({ outcome: 'unchanged' })
    expect(vote(db, v1, ids.mila)).toBeUndefined()

    await revise(db, view.id, input({ question: 'And now?' }), actor('Ryan'), at(3000))
    const journalBefore = rows(db, 'SELECT COUNT(*) AS n FROM change_log')[0].n
    const votesBefore = rows(db, 'SELECT * FROM proposal_votes')
    expect(await castVote(db, v1, ids.mila, 'agree', { settle: 'provisional', by: 'button' }, actor('Mila', 'bot'), at(4000)))
      .toEqual({ outcome: 'replaced', version: 2 })
    expect(await settleVote(db, v1, ids.mila, 'late', 'comment', actor('Mila', 'bot'), at(4000))).toEqual({ outcome: 'replaced', version: 2 })
    expect(await settleVote(db, (await readProposal(db, view.id, actor('Ryan')))!.current.id, ids.mila, null, 'button', actor('Mila', 'bot'), at(4000)))
      .toEqual({ outcome: 'nothing' })
    expect(rows(db, 'SELECT * FROM proposal_votes')).toEqual(votesBefore)
    expect(rows(db, 'SELECT COUNT(*) AS n FROM change_log')[0].n).toBe(journalBefore)
  })

  it('a duplicate press with the same settled vote is unchanged; agree after a settled against is unchanged; against after agree is recorded', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    const v = view.current.id
    const press = (value: 'agree' | 'against', ms: number) =>
      castVote(db, v, ids.annika, value, { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(ms))
    expect(await press('agree', 1000)).toEqual({ outcome: 'recorded' })
    expect(await press('agree', 2000)).toEqual({ outcome: 'unchanged' })
    expect(vote(db, v, ids.annika)).toMatchObject({ voted_at: at(1000).toISOString() })
    expect(await press('against', 3000)).toEqual({ outcome: 'recorded' })
    expect(vote(db, v, ids.annika)).toMatchObject({ vote: 'against', settled: 1 })
    expect((await readProposal(db, view.id, actor('Ryan')))!.status).toBe('revising')
    expect(await press('agree', 4000)).toEqual({ outcome: 'unchanged' })
    expect(journal(db, 'proposal_votes').map(e => e.op)).toEqual(['insert', 'insert', 'update'])
    const outsider = await castVote(db, v, 999, 'agree', { settle: 'now', by: 'site' }, actor('Annika', 'admin'), at(5000))
    expect(outsider).toEqual({ outcome: 'not_voter' })
    expect(await castVote(db, 12345, ids.annika, 'agree', { settle: 'now', by: 'site' }, actor('Annika', 'admin'), at(5000))).toEqual({ outcome: 'gone' })
  })

  it('revise writes version 2 with the voters re-read, resets the votes and marks the old cards dirty', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    const v1 = view.current.id
    await expect(revise(db, view.id, input(), actor('Ryan'), at(500))).rejects.toMatchObject({ code: 'advisor.not_revising', status: 409 })
    await castVote(db, v1, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(1000))
    await castVote(db, v1, ids.mila, 'against', { settle: 'now', by: 'button' }, actor('Mila', 'bot'), at(2000))
    await expect(revise(db, view.id, input(), actor('Annika'), at(3000))).rejects.toMatchObject({ code: 'advisor.not_author', status: 403 })
    await expect(revise(db, 4242, input(), actor('Ryan'), at(3000))).rejects.toMatchObject({ code: 'advisor.proposal_not_found', status: 404 })
    db.sqlite.exec(`UPDATE users SET telegram_id = NULL WHERE member = 'Mila'`)
    cleanDirty(db)

    const scenario: Scenario = { ...CREDIT, termMonths: 72 }
    const next = await revise(db, view.id, input({ scenario, title: 'A car, longer term', question: 'Six years then?' }), actor('Ryan'), at(4000))
    expect(next).toMatchObject({ status: 'open', deadlineAt: at(4000 + 14 * DAY).toISOString() })
    expect(next.current).toMatchObject({ number: 2, title: 'A car, longer term', question: 'Six years then?', scenario })
    expect(next.current.changes.scenario).toEqual([{ field: 'termMonths', before: 60, after: 72 }])
    expect(next.current.votes).toEqual([
      { userId: ids.ryan, member: 'Ryan', vote: 'agree', settled: true, comment: null, votedAt: at(4000).toISOString() },
      { userId: ids.annika, member: 'Annika', vote: null, settled: false, comment: null, votedAt: null },
    ])
    expect(next.previous.map(p => p.number)).toEqual([1])
    expect(next.previous[0].votes.find(v => v.userId === ids.mila)).toMatchObject({ vote: 'against', settled: true })
    expect(rows(db, 'SELECT version FROM proposals')[0].version).toBe(2)
    // the old cards are marked to show "replaced"; the author's one status message moves to version 2
    expect(messages(db, v1).filter(m => m.kind !== 'notice').map(m => [m.kind, m.dirty])).toEqual([['card', 1], ['card', 1]])
    expect(messages(db, next.current.id)).toEqual([
      { user_id: ids.ryan, chat_id: '101', kind: 'status', notice: '', dirty: 2 },
      { user_id: ids.annika, chat_id: '102', kind: 'card', notice: '', dirty: 1 },
    ])
    expect(rows(db, `SELECT COUNT(*) AS n FROM proposal_messages WHERE kind = 'status'`)[0].n).toBe(1)
    expect(statusChanges(db, 'open')).toHaveLength(1)
  })

  it('a revision accepted at once (the author now the only voter) is told by the moved status message alone', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    await castVote(db, view.current.id, ids.mila, 'against', { settle: 'now', by: 'button' }, actor('Mila', 'bot'), at(1000))
    db.sqlite.exec(`UPDATE users SET can_vote = 0 WHERE member IN ('Annika', 'Mila')`)
    const next = await revise(db, view.id, input(), actor('Ryan'), at(2000))
    expect(next.status).toBe('accepted')
    expect(messages(db, next.current.id).map(m => [m.user_id, m.kind, m.notice])).toEqual([[ids.ryan, 'status', '']])
    expect(notices(db, 'accepted')).toEqual([])
  })

  it('an author whose status message cannot show the outcome (re-linked to another chat, or blocked) gets the accepted notice', async () => {
    const { db, ids, actor } = await setup()
    const agreeAll = async (versionId: number, t: number) => {
      await castVote(db, versionId, ids.annika, 'agree', { settle: 'now', by: 'site' }, actor('Annika', 'admin'), at(t))
      await castVote(db, versionId, ids.mila, 'agree', { settle: 'now', by: 'site' }, actor('Mila', 'admin'), at(t + 1))
    }
    const relinked = await propose(db, input(), actor('Ryan'), T0)
    db.sqlite.exec(`UPDATE proposal_messages SET state = 'sent', message_id = 1, dirty = 0`)
    db.sqlite.exec(`UPDATE users SET telegram_id = '201' WHERE member = 'Ryan'`)
    await agreeAll(relinked.current.id, 1000)
    expect(rows(db, `SELECT user_id, chat_id FROM proposal_messages WHERE notice = 'accepted' AND version_id = ? ORDER BY id`, relinked.current.id))
      .toEqual([{ user_id: ids.ryan, chat_id: '201' }, { user_id: ids.annika, chat_id: '102' }, { user_id: ids.mila, chat_id: '103' }])

    const blocked = await propose(db, input(), actor('Ryan'), at(2000))
    db.sqlite.prepare(`UPDATE proposal_messages SET state = 'blocked' WHERE kind = 'status' AND version_id = ?`).run(blocked.current.id)
    await agreeAll(blocked.current.id, 3000)
    expect(notices(db, 'accepted').filter(n => n.version_id === blocked.current.id).map(n => n.user_id)).toEqual([ids.ryan, ids.annika, ids.mila])

    // a revision moves the status message to the author's chat now before the outcome: accepted at once, it alone tells
    const revised = await propose(db, input(), actor('Ryan'), at(4000))
    await castVote(db, revised.current.id, ids.mila, 'against', { settle: 'now', by: 'button' }, actor('Mila', 'bot'), at(5000))
    db.sqlite.exec(`UPDATE users SET telegram_id = '301' WHERE member = 'Ryan'`)
    db.sqlite.exec(`UPDATE users SET can_vote = 0 WHERE member IN ('Annika', 'Mila')`)
    const next = await revise(db, revised.id, input(), actor('Ryan'), at(6000))
    expect(next.status).toBe('accepted')
    expect(messages(db, next.current.id).map(m => [m.user_id, m.chat_id, m.kind, m.notice])).toEqual([[ids.ryan, '301', 'status', '']])
  })

  it('a vote after the deadline is refused as expired before the hourly run closes it; a vote cast in time still settles', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    const deadline = 14 * DAY
    expect(await castVote(db, view.current.id, ids.annika, 'agree', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(deadline - 1000)))
      .toEqual({ outcome: 'recorded' })
    const journaled = rows(db, 'SELECT COUNT(*) AS n FROM change_log')[0].n
    expect(await castVote(db, view.current.id, ids.mila, 'agree', { settle: 'now', by: 'site' }, actor('Mila', 'admin'), at(deadline)))
      .toEqual({ outcome: 'closed', status: 'expired' })
    expect(await castVote(db, view.current.id, ids.annika, 'against', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(deadline + 1)))
      .toEqual({ outcome: 'closed', status: 'expired' })
    expect(vote(db, view.current.id, ids.mila)).toBeUndefined()
    expect(vote(db, view.current.id, ids.annika)).toMatchObject({ vote: 'agree', settled: 0 })
    expect(rows(db, 'SELECT COUNT(*) AS n FROM change_log')[0].n).toBe(journaled)
    // Annika's agree was cast in time: settling it after the deadline counts
    expect(await settleVote(db, view.current.id, ids.annika, 'Yes', 'comment', actor('Annika', 'bot'), at(deadline + 2))).toEqual({ outcome: 'recorded' })
    expect(vote(db, view.current.id, ids.annika)).toMatchObject({ vote: 'agree', settled: 1, comment: 'Yes' })
  })

  it('a vote on a version that no longer exists answers gone', async () => {
    const { db, ids, actor } = await setup()
    expect(await castVote(db, 4242, ids.annika, 'agree', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(1000))).toEqual({ outcome: 'gone' })
    expect(await castVote(db, 4242, ids.annika, 'against', { settle: 'now', by: 'site' }, actor('Annika', 'admin'), at(1000))).toEqual({ outcome: 'gone' })
  })

  it('a revise racing another revise or a withdraw writes one of them whole and refuses the other', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    await castVote(db, view.current.id, ids.mila, 'against', { settle: 'now', by: 'button' }, actor('Mila', 'bot'), at(1000))
    const twice = await Promise.allSettled([1, 2].map(() => revise(db, view.id, input(), actor('Ryan'), at(2000))))
    expect(twice.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(twice.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'advisor.not_revising', status: 409 } })
    expect(rows(db, 'SELECT number FROM proposal_versions ORDER BY id').map(r => r.number)).toEqual([1, 2])
    expect(rows(db, 'SELECT COUNT(*) AS n FROM proposal_votes WHERE version_id = (SELECT MAX(id) FROM proposal_versions)')[0].n).toBe(1)

    const other = await propose(db, input(), actor('Ryan'), at(3000))
    await castVote(db, other.current.id, ids.mila, 'against', { settle: 'now', by: 'button' }, actor('Mila', 'bot'), at(4000))
    const versions = rows(db, 'SELECT COUNT(*) AS n FROM proposal_versions')[0].n
    const [revised, withdrawn] = await Promise.allSettled([
      revise(db, other.id, input(), actor('Ryan'), at(5000)),
      withdraw(db, other.id, actor('Ryan'), at(5000)),
    ])
    expect(withdrawn.status).toBe('fulfilled')
    expect(revised).toMatchObject({ status: 'rejected', reason: { code: 'advisor.not_revising' } })
    expect(rows(db, 'SELECT COUNT(*) AS n FROM proposal_versions')[0].n).toBe(versions)
    expect((await readProposal(db, other.id, actor('Ryan')))!).toMatchObject({ status: 'withdrawn', current: { number: 1 } })
    expect(statusChanges(db, 'open')).toHaveLength(1)
  })

  it('a deleted voter no longer blocks acceptance; an unlinked one still does', async () => {
    const { db, ids, actor } = await setup()
    const unlinked = await propose(db, input(), actor('Ryan'), T0)
    db.sqlite.exec(`UPDATE users SET telegram_id = NULL WHERE member = 'Mila'`)
    await castVote(db, unlinked.current.id, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(1000))
    expect((await readProposal(db, unlinked.id, actor('Ryan')))!.status).toBe('open')
    // the unlinked voter still votes on the site
    await castVote(db, unlinked.current.id, ids.mila, 'agree', { settle: 'now', by: 'site' }, actor('Mila', 'admin'), at(2000))
    expect((await readProposal(db, unlinked.id, actor('Ryan')))!.status).toBe('accepted')
    expect(notices(db, 'accepted').map(n => n.user_id)).toEqual([ids.annika])

    db.sqlite.exec(`UPDATE users SET telegram_id = '103' WHERE member = 'Mila'`)
    const deleted = await propose(db, input(), actor('Ryan'), at(3000))
    db.sqlite.prepare('DELETE FROM users WHERE id = ?').run(ids.mila)
    await castVote(db, deleted.current.id, ids.annika, 'agree', { settle: 'now', by: 'button' }, actor('Annika', 'bot'), at(4000))
    const view = (await readProposal(db, deleted.id, actor('Ryan')))!
    expect(view.status).toBe('accepted')
    expect(view.current.votes.find(v => v.userId === ids.mila)).toMatchObject({ member: '', vote: null })
  })

  it('withdraw by the author closes it; withdraw by another is 403; withdraw of a closed one is 409', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    await expect(withdraw(db, view.id, actor('Annika'), at(1000))).rejects.toMatchObject({ code: 'advisor.not_author', status: 403 })
    cleanDirty(db)
    const after = await withdraw(db, view.id, actor('Ryan', 'bot'), at(2000))
    expect(after).toMatchObject({ status: 'withdrawn', decidedAt: at(2000).toISOString() })
    expect(notices(db, 'withdrawn')).toEqual([ids.annika, ids.mila].map(user_id => ({ version_id: view.current.id, user_id })))
    expect(rows(db, `SELECT dirty FROM proposal_messages WHERE kind IN ('card', 'status')`).every(m => Number(m.dirty) > 0)).toBe(true)
    expect(statusChanges(db, 'withdrawn')).toEqual([expect.objectContaining({ actor: 'Ryan', source: 'bot' })])
    await expect(withdraw(db, view.id, actor('Ryan'), at(3000))).rejects.toMatchObject({ code: 'advisor.proposal_closed', status: 409 })
    await expect(withdraw(db, 4242, actor('Ryan'), at(3000))).rejects.toMatchObject({ code: 'advisor.proposal_not_found', status: 404 })

    // a revising one can be withdrawn too
    const second = await propose(db, input(), actor('Ryan'), at(4000))
    await castVote(db, second.current.id, ids.mila, 'against', { settle: 'now', by: 'button' }, actor('Mila', 'bot'), at(5000))
    expect((await withdraw(db, second.id, actor('Ryan'), at(6000))).status).toBe('withdrawn')
  })

  it('settleDue settles only the votes past their window, each with its own transition', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    const v = view.current.id
    await castVote(db, v, ids.annika, 'agree', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(0))
    await castVote(db, v, ids.mila, 'agree', { settle: 'provisional', by: 'button' }, actor('Mila', 'bot'), at(5 * 60_000))

    expect(await settleDue(db, at(COMMENT_WINDOW_MS - 1))).toBe(0)
    expect(await settleDue(db, at(COMMENT_WINDOW_MS))).toBe(1)
    expect(vote(db, v, ids.annika)).toMatchObject({ settled: 1, settled_by: 'timeout', comment: null })
    expect(vote(db, v, ids.mila)).toMatchObject({ settled: 0 })
    expect((await readProposal(db, view.id, actor('Ryan')))!.status).toBe('open')
    expect(await lateVoteOf(db, ids.annika, at(COMMENT_WINDOW_MS + 1000))).toEqual({ versionId: v, proposalId: view.id, closedAt: at(COMMENT_WINDOW_MS).toISOString() })
    expect(await lateVoteOf(db, ids.annika, at(COMMENT_WINDOW_MS + 3_600_001))).toBeNull()
    expect(await lateVoteOf(db, ids.mila, at(COMMENT_WINDOW_MS + 1000))).toBeNull()

    expect(await settleDue(db, at(5 * 60_000 + COMMENT_WINDOW_MS))).toBe(1)
    expect((await readProposal(db, view.id, actor('Ryan')))!.status).toBe('accepted')
    expect(statusChanges(db, 'accepted')).toEqual([expect.objectContaining({ actor: 'scheduler', source: 'scheduler' })])
    expect(await settleDue(db, at(DAY))).toBe(0)
  })

  it('expireDue closes open and revising proposals past the deadline with an expired notice per voter (the author\'s status tells them)', async () => {
    const { db, ids, actor } = await setup()
    const open = await propose(db, input(), actor('Ryan'), T0)
    const revising = await propose(db, input(), actor('Ryan'), T0)
    await castVote(db, revising.current.id, ids.mila, 'against', { settle: 'now', by: 'button' }, actor('Mila', 'bot'), at(1000))
    const later = await propose(db, input(), actor('Ryan'), at(DAY))

    expect(await expireDue(db, at(14 * DAY - 1))).toEqual([])
    expect(await expireDue(db, at(14 * DAY))).toEqual([open.id])
    expect(await expireDue(db, at(14 * DAY + 1000))).toEqual([revising.id])
    expect((await readProposal(db, open.id, actor('Ryan')))!).toMatchObject({ status: 'expired', decidedAt: at(14 * DAY).toISOString() })
    expect((await readProposal(db, later.id, actor('Ryan')))!.status).toBe('open')
    // Ryan's status message shows the outcome in his chat: no second message to him
    expect(notices(db, 'expired')).toEqual([
      ...[ids.annika, ids.mila].map(user_id => ({ version_id: open.current.id, user_id })),
      ...[ids.annika, ids.mila].map(user_id => ({ version_id: revising.current.id, user_id })),
    ])
    expect(statusChanges(db, 'expired')).toEqual([
      expect.objectContaining({ actor: 'scheduler', source: 'scheduler', row_id: open.id }),
      expect.objectContaining({ actor: 'scheduler', source: 'scheduler', row_id: revising.id }),
    ])
    // re-linked to another chat, the author's status message cannot show it: he gets the notice there
    db.sqlite.exec(`UPDATE users SET telegram_id = '201' WHERE member = 'Ryan'`)
    expect(await expireDue(db, at(30 * DAY))).toEqual([later.id])
    expect(rows(db, `SELECT user_id, chat_id FROM proposal_messages WHERE notice = 'expired' AND version_id = ? ORDER BY id`, later.current.id))
      .toEqual([{ user_id: ids.ryan, chat_id: '201' }, { user_id: ids.annika, chat_id: '102' }, { user_id: ids.mila, chat_id: '103' }])
  })

  it('remindDue creates one reminder per voter without a settled vote, and one for the author of a revising proposal, only once', async () => {
    const { db, ids, actor } = await setup()
    const open = await propose(db, input(), actor('Ryan'), T0)
    const revising = await propose(db, input(), actor('Ryan'), T0)
    await castVote(db, revising.current.id, ids.mila, 'against', { settle: 'now', by: 'button' }, actor('Mila', 'bot'), at(3_600_000))
    // reminders go 3 days before the deadline: the open one at day 11, the revising one (its clock restarted) an hour later
    expect(await remindDue(db, at(11 * DAY - 1))).toBe(0)
    await castVote(db, open.current.id, ids.annika, 'agree', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(11 * DAY - 1))
    expect(await remindDue(db, at(11 * DAY))).toBe(2)
    expect(notices(db, 'reminder')).toEqual([ids.annika, ids.mila].map(user_id => ({ version_id: open.current.id, user_id })))
    expect(await remindDue(db, at(11 * DAY + 1000))).toBe(0)
    expect(await remindDue(db, at(11 * DAY + 3_600_000))).toBe(1)
    expect(notices(db, 'reminder').at(-1)).toEqual({ version_id: revising.current.id, user_id: ids.ryan })
    expect(await remindDue(db, at(12 * DAY))).toBe(0)

    await saveSettings(db, { decideDays: 14, remindDays: null }, actor('Ryan', 'admin'))
    const quiet = await propose(db, input(), actor('Ryan'), at(12 * DAY))
    expect(await remindDue(db, at(25 * DAY))).toBe(0)
    expect(notices(db, 'reminder').filter(n => n.version_id === quiet.current.id)).toEqual([])
    expect(journal(db, 'proposal_messages')).toEqual([])
  })

  it('linkGoal needs an accepted save_up or goal proposal, an existing goal and no earlier link', async () => {
    const { db, actor } = await setup()
    const goalId = String(rows(db, 'SELECT id FROM goals ORDER BY id')[0].id)
    const open = await propose(db, input({ scenario: SAVE_UP }), actor('Ryan'), T0)
    await expect(linkGoal(db, open.id, goalId, actor('Ryan'))).rejects.toMatchObject({ code: 'advisor.cannot_link_goal', status: 409 })
    db.sqlite.exec(`UPDATE users SET can_vote = 0 WHERE member IN ('Annika', 'Mila')`)
    const credit = await propose(db, input(), actor('Ryan'), at(1000))
    await expect(linkGoal(db, credit.id, goalId, actor('Ryan'))).rejects.toMatchObject({ code: 'advisor.cannot_link_goal', status: 409 })
    const saveUp = await propose(db, input({ scenario: SAVE_UP }), actor('Ryan'), at(2000))
    expect(saveUp.status).toBe('accepted')
    await expect(linkGoal(db, saveUp.id, 'no-such-goal', actor('Ryan'))).rejects.toMatchObject({ code: 'unknown_goal', status: 400 })
    await expect(linkGoal(db, 4242, goalId, actor('Ryan'))).rejects.toMatchObject({ code: 'advisor.proposal_not_found', status: 404 })

    const linked = await linkGoal(db, saveUp.id, goalId, actor('Annika', 'admin'))
    expect(linked.goal).toEqual({ id: goalId, deleted: false })
    await expect(linkGoal(db, saveUp.id, goalId, actor('Ryan'))).rejects.toMatchObject({ code: 'advisor.goal_linked', status: 409 })
    const entry = journal(db, 'proposals').at(-1)!
    expect(entry).toMatchObject({ actor: 'Annika', source: 'admin', op: 'update', row_id: saveUp.id })
    expect(JSON.parse(String(entry.after_json))).toMatchObject({ goal_id: goalId })
  })

  it('readProposals lists open first, then history; you.vote, you.settled and goal.deleted are filled', async () => {
    const { db, ids, actor } = await setup()
    const first = await propose(db, input({ title: 'First' }), actor('Ryan'), T0)
    const withdrawn = await propose(db, input({ title: 'Withdrawn' }), actor('Ryan'), at(1000))
    const second = await propose(db, input({ title: 'Second' }), actor('Ryan'), at(2000))
    await withdraw(db, withdrawn.id, actor('Ryan'), at(3000))
    await castVote(db, second.current.id, ids.annika, 'agree', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(4000))
    db.sqlite.exec(`UPDATE users SET can_vote = 0 WHERE member IN ('Annika', 'Mila')`)
    const accepted = await propose(db, input({ title: 'Accepted', scenario: SAVE_UP }), actor('Ryan'), at(5000))
    db.sqlite.exec(`UPDATE users SET can_vote = 1`)
    const goalId = String(rows(db, 'SELECT id FROM goals ORDER BY id')[0].id)
    await linkGoal(db, accepted.id, goalId, actor('Ryan'))
    db.sqlite.prepare('DELETE FROM goals WHERE id = ?').run(goalId)

    const view = await readProposals(db, actor('Annika'))
    expect(view.proposals.map(p => p.current.title)).toEqual(['Second', 'First', 'Accepted', 'Withdrawn'])
    expect(view.settings).toEqual({ decideDays: 14, remindDays: 3 })
    expect(view.available).toBe(true)
    expect(view.canCreateGoal).toBe(true)
    const [mine, waiting, done] = view.proposals
    // Annika's agree is still provisional (the bot's comment window): given, not yet counted
    expect(mine.you).toEqual({ voter: true, vote: 'agree', settled: false, author: false })
    expect(waiting.you).toEqual({ voter: true, vote: null, settled: false, author: false })
    expect(done.you).toEqual({ voter: false, vote: null, settled: false, author: false })
    expect(done.goal).toEqual({ id: goalId, deleted: true })
    expect((await readProposals(db, actor('Annika'), { history: 1 })).proposals.map(p => p.current.title)).toEqual(['Second', 'First', 'Accepted'])

    await castVote(db, first.current.id, ids.annika, 'agree', { settle: 'now', by: 'site' }, actor('Annika', 'admin'), at(6000))
    expect((await readProposal(db, first.id, actor('Annika')))?.you).toEqual({ voter: true, vote: 'agree', settled: true, author: false })
    expect(await readProposal(db, 4242, actor('Ryan'))).toBeNull()

    // an author whose user row is gone (deleted, or after a restore) reads as an empty member
    db.sqlite.prepare('DELETE FROM users WHERE id = ?').run(ids.ryan)
    expect((await readProposal(db, first.id, actor('Annika')))!.author).toEqual({ userId: ids.ryan, member: '' })
  })

  it('saveSettings checks the days and journals the row; readSettings reads it back', async () => {
    const { db, actor } = await setup()
    expect(await readSettings(db)).toEqual({ decideDays: 14, remindDays: 3 })
    await expect(saveSettings(db, { decideDays: 0, remindDays: null }, actor('Ryan', 'admin'))).rejects.toMatchObject({ code: 'invalid_param', status: 400, params: { param: 'decideDays' } })
    await expect(saveSettings(db, { decideDays: 5, remindDays: 5 }, actor('Ryan', 'admin'))).rejects.toMatchObject({ code: 'advisor.remind_after_deadline', params: { param: 'remindDays' } })
    await expect(saveSettings(db, { decideDays: 5, remindDays: 0 }, actor('Ryan', 'admin'))).rejects.toMatchObject({ code: 'invalid_param', params: { param: 'remindDays' } })
    // not a whole number: invalid, not "after the deadline"
    await expect(saveSettings(db, { decideDays: 5, remindDays: 'x' }, actor('Ryan', 'admin'))).rejects.toMatchObject({ code: 'invalid_param', params: { param: 'remindDays' } })
    expect(await saveSettings(db, { decideDays: 7, remindDays: 2 }, actor('Ryan', 'admin'))).toEqual({ decideDays: 7, remindDays: 2 })
    expect(await readSettings(db)).toEqual({ decideDays: 7, remindDays: 2 })
    const [entry] = journal(db, 'advisor_settings')
    expect(entry).toMatchObject({ actor: 'Ryan', source: 'admin', op: 'update', row_id: 1 })
    expect(JSON.parse(String(entry.before_json))).toEqual({ id: 1, decide_days: 14, remind_days: 3 })
    expect(JSON.parse(String(entry.after_json))).toEqual({ id: 1, decide_days: 7, remind_days: 2 })
    // a new proposal takes the new days
    const view = await propose(db, input(), actor('Ryan'), T0)
    expect(view.deadlineAt).toBe(at(7 * DAY).toISOString())
  })

  it('every write of the store is journaled with the actor and its source; proposal_messages rows are not', async () => {
    const { db, ids, actor } = await setup()
    const view = await propose(db, input(), actor('Ryan'), T0)
    await castVote(db, view.current.id, ids.annika, 'against', { settle: 'provisional', by: 'button' }, actor('Annika', 'bot'), at(1000))
    await settleVote(db, view.current.id, ids.annika, 'Not now', 'comment', actor('Annika', 'bot'), at(2000))
    await revise(db, view.id, input(), actor('Ryan'), at(3000))
    await withdraw(db, view.id, actor('Ryan', 'bot'), at(4000))

    const entries = rows(db, 'SELECT ts, actor, source, table_name, row_id, op, before_json, after_json FROM change_log ORDER BY id')
    expect(entries.map(e => `${e.table_name} ${e.op} ${e.actor} ${e.source}`)).toEqual([
      'proposals insert Ryan mcp',
      'proposal_versions insert Ryan mcp',
      'proposal_votes insert Ryan mcp',
      'proposal_votes insert Annika bot',
      'proposal_votes update Annika bot',
      'proposals update Annika bot',
      'proposals update Ryan mcp',
      'proposal_versions insert Ryan mcp',
      'proposal_votes insert Ryan mcp',
      'proposals update Ryan bot',
    ])
    expect(rows(db, `SELECT COUNT(*) AS n FROM proposal_messages`)[0].n).toBeGreaterThan(0)
    expect(entries.some(e => e.table_name === 'proposal_messages')).toBe(false)
    // every entry's after is the row as it is now or was then: the vote's row id and its after match the table
    const voteEntry = entries[4]
    const stored = db.sqlite.prepare('SELECT rowid FROM proposal_votes WHERE version_id = ? AND user_id = ?').get(view.current.id, ids.annika) as { rowid: number }
    expect(voteEntry.row_id).toBe(stored.rowid)
    expect(JSON.parse(String(voteEntry.after_json))).toEqual({ ...JSON.parse(String(entries[3].after_json)), settled: 1, settled_by: 'comment', settled_at: at(2000).toISOString(), comment: 'Not now' })
    for (const e of entries.filter(x => x.after_json !== null)) {
      const table = String(e.table_name)
      const now = db.sqlite.prepare(`SELECT * FROM ${table} WHERE rowid = ?`).get(Number(e.row_id))
      expect(now, `${table} ${String(e.row_id)}`).toBeDefined()
    }
  })
})
