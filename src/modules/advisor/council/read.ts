// The council's views: the proposals as the site, the tools and the bot show them, assembled from the proposals' select and four more
// (versions, votes, users, goals) joined in code, and a draft's view as it would be once sent. A user id with no users row
// (deleted, or after a restore) reads as an empty member, never an error.
import type { Scenario } from '../../../domain/advisor'
import type { Evaluation } from '../../../domain/advisorImpact'
import type { AdvisorSettings, ProposalVersionView, ProposalView, ProposalsView } from '../../../domain/api'
import {
  DEFAULT_DECIDE_DAYS, DEFAULT_REMIND_DAYS, deadlineAfter, numberChanges, scenarioChanges, voteSummary,
  type ProposalStatus, type Verdict, type VoteValue,
} from '../../../domain/proposals'
import type { Database } from '../../../server/db'
import type { Actor } from '../../../server/http'
import type { SendInput } from './store'

/** A `proposals` row. */
export interface ProposalRow {
  id: number; type: Scenario['kind']; author_id: number; status: ProposalStatus; version: number
  created_at: string; deadline_at: string; decided_at: string | null; goal_id: string | null
}
interface VersionRow {
  id: number; proposal_id: number; number: number; title: string; question: string; scenario_json: string
  evaluation_json: string; base_currency: string; verdict_json: string; voters_json: string; created_at: string
}
interface VoteRow { version_id: number; user_id: number; vote: VoteValue; settled: number; comment: string | null; voted_at: string }

/** The decided proposals a list shows by default */
const HISTORY = 50

export async function readSettings(db: Database): Promise<AdvisorSettings> {
  const row = await db.prepare('SELECT decide_days, remind_days FROM advisor_settings WHERE id = 1')
    .first<{ decide_days: number; remind_days: number | null }>()
  return row ? { decideDays: row.decide_days, remindDays: row.remind_days } : { decideDays: DEFAULT_DECIDE_DAYS, remindDays: DEFAULT_REMIND_DAYS }
}

/** The versions, votes, members and existing goals of the given proposals, by three selects bound to their ids as a JSON array. */
async function assemble(db: Database, proposals: ProposalRow[], actor: Actor): Promise<ProposalView[]> {
  if (!proposals.length) return []
  const ids = JSON.stringify(proposals.map(p => p.id))
  const [versions, votes, users, goals] = await Promise.all([
    db.prepare('SELECT * FROM proposal_versions WHERE proposal_id IN (SELECT value FROM json_each(?)) ORDER BY number').bind(ids).all<VersionRow>(),
    db.prepare(`SELECT version_id, user_id, vote, settled, comment, voted_at FROM proposal_votes
      WHERE version_id IN (SELECT id FROM proposal_versions WHERE proposal_id IN (SELECT value FROM json_each(?)))`).bind(ids).all<VoteRow>(),
    db.prepare('SELECT id, member FROM users').all<{ id: number; member: string }>(),
    db.prepare('SELECT id FROM goals WHERE id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(proposals.flatMap(p => (p.goal_id === null ? [] : [p.goal_id])))).all<{ id: string }>(),
  ])
  const members: Record<number, string> = Object.fromEntries(users.results.map(u => [u.id, u.member]))
  const goalIds = new Set(goals.results.map(g => g.id))

  return proposals.map(p => {
    const own = versions.results.filter(v => v.proposal_id === p.id)
    const views = own.map((v, i) => versionView(v, own[i - 1] ?? null, votes.results.filter(x => x.version_id === v.id), members))
    const current = views.find(v => v.number === p.version) ?? views[views.length - 1]
    const voters: number[] = JSON.parse(own.find(v => v.id === current.id)!.voters_json) as number[]
    const yours = actor.userId === null ? undefined : votes.results.find(x => x.version_id === current.id && x.user_id === actor.userId)
    return {
      id: p.id,
      type: p.type,
      status: p.status,
      author: { userId: p.author_id, member: members[p.author_id] ?? '' },
      createdAt: p.created_at,
      deadlineAt: p.deadline_at,
      decidedAt: p.decided_at,
      baseCurrency: own.find(v => v.id === current.id)!.base_currency,
      goal: p.goal_id === null ? null : { id: p.goal_id, deleted: !goalIds.has(p.goal_id) },
      current,
      previous: views.filter(v => v !== current).reverse(),
      you: {
        voter: actor.userId !== null && voters.includes(actor.userId), vote: yours?.vote ?? null, settled: yours?.settled === 1,
        author: actor.userId === p.author_id,
      },
    }
  })
}

function versionView(row: VersionRow, previous: VersionRow | null, votes: VoteRow[], members: Record<number, string>): ProposalVersionView {
  const scenario = JSON.parse(row.scenario_json) as Scenario
  const evaluation = JSON.parse(row.evaluation_json) as Evaluation
  const voters = JSON.parse(row.voters_json) as number[]
  const summary = voteSummary(voters, votes.map(v => ({ userId: v.user_id, vote: v.vote, settled: v.settled === 1 })), members)
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    question: row.question,
    scenario,
    evaluation,
    verdict: JSON.parse(row.verdict_json) as Verdict,
    baseCurrency: row.base_currency,
    createdAt: row.created_at,
    votes: summary.map(s => {
      const v = votes.find(x => x.user_id === s.userId)
      // a pending vote shows no comment: a change of a settled agree keeps that agree's comment until it is settled or cancelled
      return { ...s, comment: v && v.settled === 1 ? v.comment : null, votedAt: v?.voted_at ?? null }
    }),
    changes: previous === null
      ? { scenario: [], numbers: [] }
      : {
          scenario: scenarioChanges(JSON.parse(previous.scenario_json) as Scenario, scenario),
          numbers: numberChanges((JSON.parse(previous.evaluation_json) as Evaluation).impact, evaluation.impact),
        },
  }
}

/** One proposal as `actor` sees it; null — no such proposal. */
export async function readProposal(db: Database, proposalId: number, actor: Actor): Promise<ProposalView | null> {
  const row = await db.prepare('SELECT * FROM proposals WHERE id = ?').bind(proposalId).first<ProposalRow>()
  return row ? (await assemble(db, [row], actor))[0] : null
}

/**
 * Why a write on a version changed nothing, as far as the version tells: gone (a wipe or a restore), replaced by a newer
 * version, or its proposal no longer open; null — none of these.
 */
export async function versionBlock(db: Database, versionId: number): Promise<{ outcome: 'gone' } | { outcome: 'replaced'; version: number } | { outcome: 'closed'; status: ProposalStatus } | null> {
  const row = await db.prepare(`SELECT p.status, p.version, v.number FROM proposal_versions v JOIN proposals p ON p.id = v.proposal_id WHERE v.id = ?`)
    .bind(versionId).first<{ status: ProposalStatus; version: number; number: number }>()
  if (!row) return { outcome: 'gone' }
  if (Number(row.number) !== Number(row.version)) return { outcome: 'replaced', version: Number(row.version) }
  if (row.status !== 'open') return { outcome: 'closed', status: row.status }
  return null
}

/**
 * The proposals page: the open and revising ones first, newest first, then at most `history` decided ones, the latest
 * decision first; the council settings; `canCreateGoal` — the actor may edit. `available` is
 * true: the caller answers the unavailable view itself (Telegram sign-in is not enabled, or no user) without reading.
 */
export async function readProposals(db: Database, actor: Actor, { history = HISTORY }: { history?: number } = {}): Promise<ProposalsView> {
  const [active, decided, settings] = await Promise.all([
    db.prepare(`SELECT * FROM proposals WHERE status IN ('open', 'revising') ORDER BY created_at DESC, id DESC`).all<ProposalRow>(),
    db.prepare(`SELECT * FROM proposals WHERE status NOT IN ('open', 'revising') ORDER BY decided_at DESC, id DESC LIMIT ?`)
      .bind(history).all<ProposalRow>(),
    readSettings(db),
  ])
  return {
    available: true,
    proposals: await assemble(db, [...active.results, ...decided.results], actor),
    settings,
    canCreateGoal: actor.rights.edit,
  }
}

/**
 * The voters a new version gets, by id: users with the vote right and a linked Telegram account who can vote somewhere —
 * by a card (council proposals on) or on the site (Telegram sign-in on). Anyone else would hold the version open until it expires.
 */
export async function currentVoters(db: Database): Promise<number[]> {
  const { results } = await db.prepare(`SELECT id FROM users WHERE can_vote = 1 AND telegram_id IS NOT NULL
    AND (telegram_proposals = 1 OR telegram_sign_in = 1) ORDER BY id`).all<{ id: number }>()
  return results.map(r => Number(r.id))
}

/**
 * The proposal as it would be once `input` is sent by `author` now, for the preview: a new proposal (`revising` null) or
 * the next version of `revising`, with what changed since its current one. The voters as propose and revise read them,
 * the author's settled agree, the deadline `input.deadlineAt` or else from the settings; the new version's id is 0, and the new proposal's too:
 * nothing is stored. The author is among the votes only when a voter: the caller refuses otherwise, as the store does.
 */
export async function draftView(db: Database, input: SendInput, author: number, now: Date, revising: ProposalView | null): Promise<ProposalView> {
  const [voters, settings, users] = await Promise.all([
    currentVoters(db), readSettings(db), db.prepare('SELECT id, member FROM users').all<{ id: number; member: string }>(),
  ])
  const members: Record<number, string> = Object.fromEntries(users.results.map(u => [u.id, u.member]))
  const ts = now.toISOString()
  const votes = voteSummary(voters, [{ userId: author, vote: 'agree', settled: true }], members)
    .map(v => ({ ...v, comment: null, votedAt: v.userId === author ? ts : null }))
  const before = revising?.current ?? null
  const current: ProposalVersionView = {
    id: 0, number: before ? before.number + 1 : 1, title: input.title, question: input.question, scenario: input.scenario,
    evaluation: input.evaluation, verdict: input.verdict, baseCurrency: input.baseCurrency, createdAt: ts, votes,
    changes: before
      ? { scenario: scenarioChanges(before.scenario, input.scenario), numbers: numberChanges(before.evaluation.impact, input.evaluation.impact) }
      : { scenario: [], numbers: [] },
  }
  return {
    id: revising?.id ?? 0, type: revising?.type ?? input.scenario.kind, status: 'open', author: { userId: author, member: members[author] ?? '' },
    createdAt: revising?.createdAt ?? ts, deadlineAt: input.deadlineAt ?? deadlineAfter(now, settings.decideDays), decidedAt: null, baseCurrency: input.baseCurrency,
    goal: revising?.goal ?? null, current, previous: revising ? [revising.current, ...revising.previous] : [],
    you: { voter: voters.includes(author), vote: 'agree', settled: true, author: true },
  }
}
