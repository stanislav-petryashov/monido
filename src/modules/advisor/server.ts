// The server side of the Advisor module: /api/advisor/tools (the list) and /api/advisor/tools/:name (a call); the consent
// API of Claude's connector (/api/advisor/oauth/requests/:id) and its connections (/api/advisor/connector); the council on
// the site (/api/advisor/proposals and a proposal's votes, comment, withdraw and goal; /api/advisor/settings); outside /api/, the OAuth endpoints come from oauth/routes.ts and the MCP endpoint from mcp.ts;
// the bot's council presses and comments from council/bot.ts; the hourly run from council/scheduled.ts.
import type { Hono } from 'hono'
import type {
  AdvisorSettings, CommentRequest, ConnectorView, ConsentRequest, LinkGoalRequest, ProposalsView, ProposalView, VoteRequest,
} from '../../domain/api'
import { cleanText, COMMENT_MAX } from '../../domain/proposals'
import { fallbackOf, type AuthRuntime } from '../../server/authSettings'
import type { AppConfig, ModuleEnv } from '../../server/config'
import type { Database } from '../../server/db'
import { errorJson, guard, InputError, logRequestError, readJson, requireRight, type Actor } from '../../server/http'
import { findUser } from '../../server/users'
import type { ServerModule } from '../server'
import { connectorStatus } from './connector'
import { councilAvailable, requireCouncilUser } from './council/available'
import { handleCouncilUpdate } from './council/bot'
import { deliverSoon } from './council/delivery'
import { readProposal, readProposals, readSettings } from './council/read'
import { runCouncilScheduled } from './council/scheduled'
import { addComment, castVote, linkGoal, saveSettings, withdraw, type VoteResult } from './council/store'
import { bodyOf, invalid, missing, nonEmptyString } from './input'
import { handleMcp } from './mcp'
import { answerConsent, connectorOf, consentRequest, oauthRoutes, startedHere, type Connector } from './oauth/routes'
import { FAMILY_USER_ID, familyMarker, listConnections, revokePersonTokens, revokeUser } from './oauth/store'
import { ADVISOR_TOOLS, callTool, toolInfo } from './tools/registry'

const LIST = '/api/advisor/tools'
const CALL = /^\/api\/advisor\/tools\/([^/]+)$/
const REQUEST = /^\/api\/advisor\/oauth\/requests\/([^/]+)$/
const CONNECTOR = '/api/advisor/connector'
const MINE = '/api/advisor/connector/mine'
const PROPOSALS = '/api/advisor/proposals'
const PROPOSAL = /^\/api\/advisor\/proposals\/([^/]+)\/(votes|comment|withdraw|goal)$/
const SETTINGS = '/api/advisor/settings'

/**
 * A proposal's writes, by the last path segment: the method each takes and the right it needs. The votes, the comment and
 * withdraw need none of their own, as in the bot: the version lists its voters when it is sent and the store checks the
 * voter or the author (a right taken away changes the next version's voters); the goal link is an edit of the data.
 */
const PROPOSAL_WRITES = {
  votes: { method: 'POST', right: null },
  comment: { method: 'POST', right: null },
  withdraw: { method: 'POST', right: null },
  goal: { method: 'PUT', right: 'edit' },
} as const
type ProposalWrite = keyof typeof PROPOSAL_WRITES

/** The tool's name from the path; a broken percent escape is no tool. */
function nameOf(segment: string): string {
  try { return decodeURIComponent(segment) } catch { return segment }
}

/** The tool's input: the JSON body, `{}` when there is none. */
async function inputOf(request: Request): Promise<unknown> {
  if (request.body === null) return {}
  return readJson(request)
}

/** The connector createApp built for this database, and its status from that app's config. */
function connectorView(db: Database, auth: AuthRuntime): { connector: Connector; status: Omit<ConnectorView, 'connected'> } {
  const connector = connectorOf(db)
  // createApp builds the advisor's routes for every app: without them this is a programming error
  if (!connector) throw new Error('the advisor routes are not mounted on this database')
  return { connector, status: connectorStatus(connector.config, auth) }
}

/**
 * Who has a live connection in the sign-in that is on: with Telegram the members whose account is still linked, by member
 * name, `you` marking the actor; with the family password the family's one entry (member null); otherwise none.
 */
async function connections(db: Database, auth: AuthRuntime, actor: Actor, now: Date): Promise<ConnectorView['connected']> {
  const mode = auth.mode()
  if (mode === 'password') {
    const [family] = await listConnections(db, now, { kind: 'family', marker: familyMarker(auth.generation()) })
    return family ? [{ member: null, you: true, clients: family.clients, lastIssuedAt: family.lastIssuedAt }] : []
  }
  if (mode !== 'telegram') return []
  const live = new Map((await listConnections(db, now, { kind: 'person' })).map(c => [c.userId, c]))
  const { results } = await db.prepare('SELECT id, member FROM users WHERE telegram_id IS NOT NULL ORDER BY member').all<{ id: number; member: string }>()
  return results.flatMap(u => {
    const c = live.get(Number(u.id))
    return c ? [{ member: u.member, you: Number(u.id) === actor.userId, clients: c.clients, lastIssuedAt: c.lastIssuedAt }] : []
  })
}

/**
 * The consent API: a request started in this browser, answered by the signed-in person; 404 `advisor.connector_unavailable`
 * when the connector is not available, 403 `advisor.request_elsewhere` from another browser.
 */
async function consent(request: Request, db: Database, auth: AuthRuntime, actor: Actor, id: string): Promise<ConsentRequest | { redirect: string } | Response> {
  const { connector, status } = connectorView(db, auth)
  // with Telegram a person answers; with the family password the family's session (the actor with no user)
  const family = auth.mode() === 'password'
  if (!status.available || (actor.userId === null) !== family) throw new InputError('advisor.connector_unavailable', 404)
  // only the browser that started the authorization may see or answer it; checked before the request is looked up
  if (!startedHere(request, id)) throw new InputError('advisor.request_elsewhere', 403)
  if (request.method === 'GET') {
    const view = consentRequest(connector, id, family ? null : actor.name)
    if (!view) throw new InputError('advisor.request_expired', 404)
    return view
  }
  if (request.method !== 'POST') return errorJson('method_not_allowed', 405)
  // the sign-in this session belongs to: a password change or a switch while the answer is read refuses it
  const generation = auth.generation()
  const mode = auth.mode()
  const body = await readJson(request) as { approve?: unknown } | null
  if (auth.generation() !== generation || auth.mode() !== mode) throw new InputError('advisor.request_expired', 404)
  if (typeof body?.approve !== 'boolean') throw new InputError('invalid_param', 400, { param: 'approve' })
  const grant = family
    ? { userId: FAMILY_USER_ID, telegramId: familyMarker(generation), generation }
    : await personGrant(db, actor, generation)
  const redirect = answerConsent(connector, id, grant, body.approve)
  if (redirect === null) throw new InputError('advisor.request_expired', 404)
  return { redirect }
}

// --- the council on the site --------------------------------------------------------------------------------------

interface CouncilContext { db: Database; env: ModuleEnv; auth: AuthRuntime; actor: Actor }

/** Whether the council works here: Telegram sign-in (the app's config, held by its connector) and a signed-in user. */
const council = (auth: AuthRuntime, actor: Actor) => councilAvailable({ authMode: auth.mode(), actor })

/** The proposals page; without the council no proposals at all, only the settings. */
async function proposalsView({ db, auth, actor }: CouncilContext): Promise<ProposalsView> {
  if (!council(auth, actor)) return { available: false, proposals: [], settings: await readSettings(db), canCreateGoal: actor.rights.edit }
  return readProposals(db, actor)
}

/** The proposal id in the path: a positive whole number, else there is no such proposal. */
function proposalIdOf(segment: string): number {
  const id = /^[1-9]\d*$/.test(segment) ? Number(segment) : NaN
  if (!Number.isSafeInteger(id)) throw new InputError('advisor.proposal_not_found', 404)
  return id
}

/** A site vote (VoteRequest): the vote, and its comment cleaned, or null */
function voteRequestOf(body: Record<string, unknown>): { vote: VoteRequest['vote']; comment: string | null; versionId: number } {
  if (body.vote === undefined || body.vote === null) throw missing('vote')
  if (body.vote !== 'agree' && body.vote !== 'against') throw invalid('vote')
  return { vote: body.vote, comment: commentOf(body), versionId: versionIdOf(body) }
}

/** A person's grant: the tokens are bound to the Telegram account they signed in with (linking another one ends them). */
async function personGrant(db: Database, actor: Actor, generation: number): Promise<{ userId: number; telegramId: string; generation: number }> {
  const telegramId = actor.userId === null ? null : (await findUser(db, { id: actor.userId }))?.telegramId
  if (!telegramId || actor.userId === null) throw new InputError('unauthorized', 401)
  return { userId: actor.userId, telegramId, generation }
}

/** The version the person read and answers: consent is given to one text, not to whatever is current. */
function versionIdOf(body: Record<string, unknown>): number {
  if (body.versionId === undefined || body.versionId === null) throw missing('versionId')
  if (!Number.isSafeInteger(body.versionId)) throw invalid('versionId')
  return body.versionId as number
}

/** The person's comment, cleaned and cut at COMMENT_MAX; null — none, or nothing left after cleaning. */
function commentOf(body: Record<string, unknown>): string | null {
  const value = body.comment
  if (value !== undefined && value !== null && typeof value !== 'string') throw invalid('comment')
  return cleanText(value, COMMENT_MAX, { multiline: true })
}

/** A comment added later (CommentRequest): one is required. */
function commentRequestOf(body: Record<string, unknown>): CommentRequest {
  const comment = commentOf(body)
  if (comment === null) throw missing('comment')
  return { comment, versionId: versionIdOf(body) }
}

/** A vote or comment the store did not write, as the site's error; `recorded` and `unchanged` pass. */
function refusal(result: VoteResult): InputError | null {
  switch (result.outcome) {
    case 'recorded': case 'unchanged': return null
    // the route votes on the version it just read: only a revise in between replaces it
    case 'replaced': return new InputError('advisor.proposal_replaced', 409, { number: result.version })
    case 'closed': return new InputError('advisor.proposal_closed', 409)
    case 'not_voter': return new InputError('advisor.not_a_voter', 403)
    case 'gone': return new InputError('advisor.proposal_not_found', 404)
  }
}

/** Whether the user's vote on the current version is a settled agree: what a later comment can be added to */
const settledAgree = (view: ProposalView, userId: number) => view.current.votes.some(v => v.userId === userId && v.vote === 'agree' && v.settled)

/**
 * A proposal's write from the site, as the signed-in user, on its current version: a vote settled at once with its
 * comment, a comment added to one's own settled agree, withdraw, the goal link. The messages go out in the background;
 * the answer is the proposals page.
 */
async function proposalWrite(request: Request, ctx: CouncilContext, segment: string, action: ProposalWrite): Promise<ProposalsView> {
  const { db, env, auth, actor } = ctx
  const right = PROPOSAL_WRITES[action].right
  if (right) requireRight(actor, right)
  const userId = requireCouncilUser(auth.mode(), actor)
  const id = proposalIdOf(segment)
  const now = new Date()
  if (action === 'withdraw') await withdraw(db, id, actor, now)
  else {
    const body = bodyOf(await readJson(request))
    if (action === 'goal') {
      const goalId: LinkGoalRequest['goalId'] = nonEmptyString(body.goalId, 'goalId')
      await linkGoal(db, id, goalId, actor)
    }
    else {
      const input = action === 'votes' ? voteRequestOf(body) : commentRequestOf(body)
      const view = await readProposal(db, id, actor)
      if (!view) throw new InputError('advisor.proposal_not_found', 404)
      // only a voter of the current version has a vote to comment on
      if (!view.you.voter) throw new InputError('advisor.not_a_voter', 403)
      if (input.versionId !== view.current.id) throw new InputError('advisor.version_changed', 409, { number: view.current.number })
      let result = 'vote' in input
        ? await castVote(db, view.current.id, userId, input.vote, { settle: 'now', comment: input.comment, by: 'site' }, actor, now)
        : await addComment(db, view.current.id, userId, input.comment, actor, now)
      // an agree over one's own settled agree writes no vote: its comment goes onto that agree, not lost
      if ('vote' in input && result.outcome === 'unchanged' && input.vote === 'agree' && input.comment !== null && settledAgree(view, userId)) {
        result = await addComment(db, view.current.id, userId, input.comment, actor, now)
      }
      // a comment changes nothing when it repeats the one there; with no settled agree there is nothing to add it to
      if (!('vote' in input) && result.outcome === 'unchanged' && !settledAgree(view, userId)) {
        throw new InputError('advisor.nothing_to_comment', 409)
      }
      const refused = refusal(result)
      if (refused) throw refused
    }
  }
  deliverSoon(db, env)
  return proposalsView(ctx)
}

/** The council's days; the `manage` right, whether or not the council works here. */
async function settingsWrite(request: Request, { db, env, actor }: CouncilContext): Promise<AdvisorSettings> {
  requireRight(actor, 'manage')
  const settings = await saveSettings(db, await readJson(request), actor)
  deliverSoon(db, env)
  return settings
}

/** The council's route on the site for this path and method, to run under guard; null — not one of its paths. */
function councilRoute(request: Request, ctx: CouncilContext, path: string): (() => Promise<unknown>) | null {
  const method = request.method
  const notAllowed = async () => errorJson('method_not_allowed', 405)
  const write = path.match(PROPOSAL)
  if (write) {
    const action = write[2] as ProposalWrite
    return method === PROPOSAL_WRITES[action].method ? () => proposalWrite(request, ctx, write[1], action) : notAllowed
  }
  if (path === PROPOSALS) return method === 'GET' ? () => proposalsView(ctx) : notAllowed
  if (path === SETTINGS) return method === 'PUT' ? () => settingsWrite(request, ctx) : notAllowed
  return null
}

/** The paths outside /api/: the OAuth endpoints and /mcp, all behind createApp's gate. */
/**
 * A switch of the sign-in ends every Telegram connection, like the sessions: a new generation with Telegram on one side
 * (setMode, the shared password back from Telegram, reset-password heard through SIGHUP). A password change inside Telegram
 * sign-in (the fallback password) keeps them; the family's tokens end by the generation alone; a fallback flip changes none.
 */
function endTelegramConnectionsOnSwitch(db: Database, auth: AuthRuntime): void {
  // the fallback runs on the password but Telegram is the stored sign-in: a password change there is no switch
  const stored = () => (fallbackOf(auth) === null ? auth.mode() : 'telegram')
  let last = { generation: auth.generation(), mode: stored() }
  auth.onChange(() => {
    const next = { generation: auth.generation(), mode: stored() }
    const switched = next.generation !== last.generation && !(last.mode === 'telegram' && next.mode === 'telegram')
    last = next
    if (switched) revokePersonTokens(db, new Date()).catch(err => logRequestError({ method: 'SIGNAL', path: 'auth-switch' }, 'advisor', err))
  })
}

function routes(ctx: { db: Database; config: AppConfig; auth: AuthRuntime; download: boolean }): Hono {
  const app = oauthRoutes(ctx)
  endTelegramConnectionsOnSwitch(ctx.db, ctx.auth)
  app.all('/mcp', c => handleMcp(c.req.raw, { ...ctx, now: new Date() }))
  return app
}

export const advisorServer: ServerModule = {
  key: 'advisor',
  routes,
  async api(request, { db, env, auth, url, actor, download }) {
    const path = url.pathname
    const call = path.match(CALL)
    const pending = path.match(REQUEST)
    const method = request.method
    const councilRun = councilRoute(request, { db, env, auth, actor }, path)
    if (councilRun) return guard({ method, path }, { tag: 'advisor' }, councilRun)
    if (path !== LIST && path !== CONNECTOR && path !== MINE && !call && !pending) return null
    return guard({ method, path }, { tag: 'advisor' }, async () => {
      if (path === LIST && method === 'GET') return { tools: ADVISOR_TOOLS.map(toolInfo) }
      if (call && method === 'POST') {
        const authMode = auth.mode()
        return { result: await callTool(nameOf(call[1]), { db, actor, download, now: new Date(), env, authMode }, await inputOf(request)) }
      }
      if (pending) return consent(request, db, auth, actor, nameOf(pending[1]))
      if (path === CONNECTOR && method === 'GET') {
        return { ...connectorView(db, auth).status, connected: await connections(db, auth, actor, new Date()) } satisfies ConnectorView
      }
      if (path === MINE && method === 'DELETE') {
        const { status } = connectorView(db, auth)
        const now = new Date()
        if (actor.userId !== null) await revokeUser(db, actor.userId, now)
        // the family's connection: any session of the family password ends it (anyone with the password may connect again)
        else if (auth.mode() === 'password') await revokeUser(db, FAMILY_USER_ID, now)
        return { ...status, connected: await connections(db, auth, actor, now) } satisfies ConnectorView
      }
      return errorJson('method_not_allowed', 405)
    })
  },
  // the council's hourly run: settle, re-check, expire, remind, retry deliveries
  // the stdio command wrote a proposal: its cards go out now, from this process (the only one that sends)
  onNudge: async ({ db, env }) => { deliverSoon(db, env) },
  scheduled: ({ db, env }) => runCouncilScheduled(db, env).then(() => undefined),
  // the council's presses and comments; the core's sign-in handler has heard the update first
  onBotUpdate: (update, { db, env }) => handleCouncilUpdate(update, { db, env }),
}
