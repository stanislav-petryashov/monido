// The connector's MCP endpoint, POST /mcp: Claude calls the advisor's tools as the family member whose access token it
// holds. Stateless Streamable HTTP: a new low-level Server and transport per request, JSON answers, no sessions, no SSE.
// Only `Authorization: Bearer` signs in here (cookies are never read); the token and its user are checked on every call
// and the user's rights are read live. Mounted by the module's routes (../server.ts), so createApp's gate answers 404
// in the demo (the advisor is not mounted there); this answers 404 itself while the connector is not available.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListToolsRequestSchema,
  McpError, ErrorCode, type CallToolResult, type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { actorOfUser, FAMILY_MCP_ACTOR } from '../../server/auth'
import type { AuthRuntime } from '../../server/authSettings'
import { moduleEnv, type AppConfig } from '../../server/config'
import type { Database } from '../../server/db'
import { errorJson, InputError, isFull, logRequestError, type Actor } from '../../server/http'
import { connectorUrls, liveAuth } from './connector'
import { ADVISOR_GUIDE, BIG_PURCHASE_PROMPT } from './guide'
import { verifyAccessToken } from './oauth/store'
import { ADVISOR_TOOLS, callTool, findTool, toolInfo, type ToolContext } from './tools/registry'

/** What handleMcp runs with: `download` — whether exchange rates may be downloaded; `now` — the moment of the request. */
interface McpContext { db: Database; config: AppConfig; auth: AuthRuntime; download: boolean; now: Date }

/** The largest JSON-RPC body read, as for the app's own JSON routes */
const MAX_BODY_BYTES = 64 * 1024
/** `Bearer <token>`; the scheme is case-insensitive (RFC 7235), the token is base64url (oauth/store.ts) */
const BEARER = /^Bearer +([A-Za-z0-9_-]+)$/i
const LOG_PATH = { method: 'POST', path: '/mcp' }

/** Every answer of /mcp is never cached. */
function noStore(res: Response): Response {
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** 401 that points Claude at the protected-resource metadata (RFC 9728), from which it finds the authorization server. */
function unauthorized(resourceMetadata: string): Response {
  const res = errorJson('unauthorized', 401)
  res.headers.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadata}"`)
  return res
}

/** The actor of the request's bearer token: a live access token of a user who can still sign in; null otherwise. */
async function bearerActor(request: Request, db: Database, auth: AuthRuntime, now: Date): Promise<Actor | null> {
  const token = BEARER.exec(request.headers.get('Authorization') ?? '')?.[1]
  if (!token) return null
  const grant = await verifyAccessToken(db, token, now, liveAuth(auth))
  if (grant?.family) return FAMILY_MCP_ACTOR
  const link = auth.signInLink()
  return grant && link ? actorOfUser(db, grant.userId, Date.parse(grant.createdAt), link, 'mcp') : null
}

const text = (data: unknown, isError = false): CallToolResult =>
  ({ content: [{ type: 'text', text: JSON.stringify(data) }], ...(isError ? { isError: true } : {}) })

/**
 * One tool call: the result as JSON text; an error as an error result with `{ error: { code, params } }`, which Claude
 * reads to ask for a missing parameter or explain a refusal. An unexpected failure is logged and answered without its text.
 */
async function runTool(context: () => Promise<ToolContext>, name: string, input: Record<string, unknown> | undefined): Promise<CallToolResult> {
  try {
    // inside the try: a context that refuses (a member gone) is answered like any refusal
    return text(await callTool(name, await context(), input ?? {}))
  } catch (err) {
    if (err instanceof InputError) return text({ error: { code: err.code, params: err.params } }, true)
    logRequestError(LOG_PATH, 'advisor-mcp', err)
    const tool = findTool(name)
    const writes = tool !== undefined && !toolInfo(tool).readOnly
    return text({ error: { code: isFull(err) ? 'storage_full' : writes ? 'save_failed' : 'load_failed' } }, true)
  }
}

/**
 * The advisor as an MCP server: its tools, the guide as instructions, one prompt. `context` is read on every tool call (a
 * stdio session lives for days: the time, the rights and the sign-in mode are the current ones); `onWrite` hears each
 * successful call of a tool that writes.
 */
export function advisorMcpServer(context: () => Promise<ToolContext>, version: string, onWrite?: (tool: string) => void): Server {
  const server = new Server(
    { name: 'monido', version },
    { capabilities: { tools: {}, prompts: {} }, instructions: ADVISOR_GUIDE },
  )
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: ADVISOR_TOOLS.map((tool): Tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Tool['inputSchema'],
      annotations: { readOnlyHint: toolInfo(tool).readOnly },
    })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name } = request.params
    const result = await runTool(context, name, request.params.arguments)
    const tool = findTool(name)
    if (!result.isError && tool !== undefined && !toolInfo(tool).readOnly) onWrite?.(name)
    return result
  })
  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: [{ name: BIG_PURCHASE_PROMPT.name, description: BIG_PURCHASE_PROMPT.description }],
  }))
  server.setRequestHandler(GetPromptRequestSchema, request => {
    if (request.params.name !== BIG_PURCHASE_PROMPT.name) throw new McpError(ErrorCode.InvalidParams, 'unknown prompt')
    return {
      description: BIG_PURCHASE_PROMPT.description,
      messages: [{ role: 'user', content: { type: 'text', text: BIG_PURCHASE_PROMPT.text } }],
    }
  })
  return server
}

/**
 * /mcp: 404 while the connector is not available; only POST (no SSE stream to GET, no session to DELETE: 405); a missing
 * or dead token, or a token whose user was deleted, unlinked or re-created, is 401 with `WWW-Authenticate`. Then the
 * JSON-RPC request is answered by a new Server and transport, as the token's user (journal source `mcp`).
 */
export async function handleMcp(request: Request, { db, config, auth, download, now }: McpContext): Promise<Response> {
  const urls = connectorUrls(config, auth)
  if (!urls) return new Response('Not found', { status: 404 })
  if (request.method !== 'POST') return noStore(errorJson('method_not_allowed', 405))
  let server: Server | undefined
  try {
    const actor = await bearerActor(request, db, auth, now)
    if (!actor) return noStore(unauthorized(urls.resourceMetadata))
    const ctx: ToolContext = { db, actor, download, now, env: moduleEnv(config, auth), authMode: auth.mode() }
    server = advisorMcpServer(async () => ctx, config.appVersion)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_BODY_BYTES,
    })
    await server.connect(transport)
    return noStore(await transport.handleRequest(request))
  } catch (err) {
    logRequestError(LOG_PATH, 'advisor-mcp', err)
    return noStore(errorJson('load_failed', 500))
  } finally {
    // a JSON answer is complete once handleRequest returns: nothing is left to stream; a failing close must not replace it
    try { await server?.close() } catch (err) { logRequestError(LOG_PATH, 'advisor-mcp', err) }
  }
}
