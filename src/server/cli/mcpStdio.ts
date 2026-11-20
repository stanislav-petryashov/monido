// The monido-mcp command (`docker compose exec -T app monido-mcp`): the advisor's MCP tools over stdio, as a family
// member, for Claude Desktop or Claude Code on the family's own machine, and for Glama's sandbox (`--init`). Whoever can run
// it already owns the database, so there is no sign-in. stdout is the protocol: every notice goes to stderr.
import { existsSync, mkdirSync } from 'node:fs'
import { once } from 'node:events'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { advisorMcpServer } from '../../modules/advisor/mcp'
import type { ToolContext } from '../../modules/advisor/tools/registry'
import { actorOfMember, FAMILY_MCP_ACTOR } from '../auth'
import { loadAuthRuntime, type AuthRuntime } from '../authSettings'
import { ConfigError, loadConfig, type AppConfig } from '../config'
import { openDatabase, type Database } from '../db'
import { InputError } from '../http'
import { initializeSchema, SchemaError } from '../schema'
import { readUsers } from '../users'

/** The writes after which the server should send proposal cards now (it is the only process that sends) */
const PROPOSAL_WRITES = new Set(['propose_to_family', 'revise_proposal', 'withdraw_proposal'])

type Kill = (pid: number, signal: NodeJS.Signals) => void

interface StdioDeps {
  env: Record<string, string | undefined>
  stdin?: Readable
  stdout?: Writable
  kill?: Kill
  /** stderr by default */
  log?: (line: string) => void
}

/**
 * One tool call's context, read from the database every time: the member's current rights (a deleted member, or a user
 * added to a fresh install the family acted on, is refused), the time, the sign-in mode. No rate downloads and no bot
 * token: the server fetches rates and sends Telegram.
 */
export async function stdioContext(db: Database, auth: AuthRuntime, member: string | null, config: AppConfig): Promise<ToolContext> {
  auth.reload()
  const actor = member === null
    ? ((await readUsers(db)).length === 0 ? FAMILY_MCP_ACTOR : null)
    : await actorOfMember(db, member, 'mcp')
  if (!actor) throw new InputError('unauthorized', 401)
  return { db, actor, download: false, now: new Date(), env: config.appUrl ? { APP_URL: config.appUrl } : {}, authMode: auth.mode(), signInLink: auth.signInLink() }
}

/**
 * After a proposal write, SIGHUP to the server so it sends the cards now. Only inside the image, where the wrapper sets
 * MONIDO_NUDGE_PID=1 (pid 1 elsewhere is the init system); never to itself (`docker run … monido-mcp` makes it pid 1).
 * @public a test seam: run() is the only caller
 */
export function nudgeFor(env: Record<string, string | undefined>, kill: Kill, pid = process.pid): (tool: string) => void {
  const target = Number(env.MONIDO_NUDGE_PID)
  return tool => {
    if (!PROPOSAL_WRITES.has(tool) || !Number.isInteger(target) || target <= 0 || target === pid) return
    // without a server to hear it the hourly run sends the cards; a failed signal must not fail the tool
    try { kill(target, 'SIGHUP') } catch { /* ignored */ }
  }
}

/** Who acts: the named member, else the only manager, else the family when there are no users; or why not. */
async function chooseMember(db: Database, given: string | undefined): Promise<{ member: string | null } | { error: string }> {
  const users = await readUsers(db)
  const names = users.map(u => u.member).join(', ')
  if (given !== undefined) {
    const user = users.find(u => u.member === given)
    return user && (user.rights.edit || user.rights.vote) ? { member: given } : { error: `Unknown member "${given}". Members: ${names}` }
  }
  if (users.length === 0) return { member: null }
  const managers = users.filter(u => u.rights.manage)
  return managers.length === 1 ? { member: managers[0].member } : { error: `Choose a member with --member: ${names}` }
}

/**
 * The requests still unanswered: stdin may close right after the last one (a pipe), before its answer is written. A
 * request the client cancelled gets no answer, so its cancellation takes it off the list.
 */
function trackPending(transport: StdioServerTransport): () => number {
  const pending = new Set<string | number>()
  const receive = transport.onmessage
  transport.onmessage = (message: JSONRPCMessage) => {
    if ('method' in message && 'id' in message) pending.add(message.id)
    if ('method' in message && message.method === 'notifications/cancelled') {
      const id = (message.params as { requestId?: string | number } | undefined)?.requestId
      if (id !== undefined) pending.delete(id)
    }
    receive?.(message)
  }
  const send = transport.send.bind(transport)
  transport.send = async (message: JSONRPCMessage) => {
    try { await send(message) } finally { if (!('method' in message) && 'id' in message && message.id !== undefined) pending.delete(message.id) }
  }
  return () => pending.size
}

/** The longest wait for the last answers after stdin ends: a slow call (a 5 s busy database) finishes, a lost one does not hang the process. */
const DRAIN_MS = 30_000

/** Runs the command until stdin closes; the result is the exit code. */
export async function run(argv: string[], deps: StdioDeps): Promise<number> {
  const log = deps.log ?? ((line: string) => { process.stderr.write(`${line}\n`) })
  let args
  try {
    args = parseArgs({ args: argv, options: { member: { type: 'string' }, init: { type: 'boolean' } }, strict: true }).values
  } catch (err) {
    log(`${(err as Error).message}. Usage: monido-mcp [--member <name>] [--init]`)
    return 1
  }
  let config: AppConfig
  try {
    config = loadConfig(deps.env)
  } catch (err) {
    if (err instanceof ConfigError) { log(`[config] ${err.message}`); return 1 }
    throw err
  }
  if (config.authMode === 'demo') { log('monido-mcp does not run in AUTH_MODE=demo: the demo keeps every visitor\'s data apart.'); return 1 }
  const file = join(config.dataDir, 'finance.sqlite')
  if (!existsSync(file)) {
    if (!args.init) { log(`No database at ${file}; check DATA_DIR`); return 1 }
    mkdirSync(config.dataDir, { recursive: true })
    log(`[mcp] created an empty database at ${file}`)
  }
  const db = openDatabase(file)
  try {
    try {
      initializeSchema(db, config.schemaFile, config.dataDir)
    } catch (err) {
      if (err instanceof SchemaError) { log(`[schema] ${err.message}`); return 1 }
      throw err
    }
    // each call re-reads the sign-in rows: a notice is worth one line, not one per call
    let last = ''
    const auth = await loadAuthRuntime(db, config, { log: line => { if (line !== last) { last = line; log(line) } } })
    const choice = await chooseMember(db, args.member)
    if ('error' in choice) { log(choice.error); return 1 }

    const stdin = deps.stdin ?? process.stdin
    const server = advisorMcpServer(() => stdioContext(db, auth, choice.member, config), config.appVersion, nudgeFor(deps.env, deps.kill ?? process.kill.bind(process)))
    const transport = new StdioServerTransport(stdin, deps.stdout ?? process.stdout)
    await server.connect(transport)
    const pending = trackPending(transport)
    // the SDK's transport does not watch for the end of stdin
    if (!stdin.readableEnded) await Promise.race([once(stdin, 'end'), once(stdin, 'close')])
    // shortcut: polls for the last answers to be written; an event per answer if a long call ever needs it
    const deadline = Date.now() + DRAIN_MS
    while (pending() > 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    await server.close()
    return 0
  } finally {
    db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // stdout is the protocol: a stray console.log anywhere must not corrupt it
  console.log = console.error
  void run(process.argv.slice(2), { env: process.env }).then(code => { process.exitCode = code })
}
