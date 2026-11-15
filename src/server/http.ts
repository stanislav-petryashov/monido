import type { Right, Rights } from '../domain/api'
import type { MsgParams } from '../domain/types'

// Shared by the server routes: JSON answers, reading the request body, input errors and route error handling.

/**
 * An error the user may see: its status, code and params go into the answer; the client shows `errors.<code>`.
 * Core codes are plain (`invalid_month`), module codes carry the module key (`reminders.no_chat`). `message` is the code, for logs.
 */
export class InputError extends Error {
  readonly status: number
  readonly code: string
  readonly params?: MsgParams
  constructor(code: string, status = 400, params?: MsgParams) {
    super(code)
    this.status = status
    this.code = code
    this.params = params
  }
}

/**
 * Who writes: the journal's name for them, their rights, their user id (null: family password, demo);
 * `source` is the way in, journaled with the change: 'admin' — the app itself, 'mcp' — Claude's connector acting as the user,
 * 'bot' — the Telegram bot acting for the user who pressed a button or wrote a comment, 'scheduler' — the hourly module run
 * (SCHEDULER_ACTOR), no person.
 */
export interface Actor { name: string; source: 'admin' | 'mcp' | 'bot' | 'scheduler' | 'config'; rights: Rights; userId: number | null }

/**
 * The hourly module run as a journal actor (an expired proposal): no user and no rights — what it writes is the
 * store's own transition, never a rights-checked edit. The journal page labels it by the source, "Scheduled run".
 */
export const SCHEDULER_ACTOR: Actor = { name: 'scheduler', source: 'scheduler', rights: { edit: false, vote: false, manage: false }, userId: null }

/**
 * The server's own writes to the sign-in settings (mirroring .env, the reset command): no user and no rights. The journal
 * page labels it by the source, "Server configuration".
 */
export const CONFIG_ACTOR: Actor = { name: 'config', source: 'config', rights: { edit: false, vote: false, manage: false }, userId: null }

/** 403 `no_right_<right>` unless the actor has the right. */
export function requireRight(actor: Actor, right: Right): void {
  if (!actor.rights[right]) throw new InputError(`no_right_${right}`, 403)
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}

/** An error answer: `{ error: { code, params? } }`. */
export function errorJson(code: string, status: number, params?: MsgParams) {
  return json({ error: params === undefined ? { code } : { code, params } }, status)
}

/** /api and everything under /api/: the app's JSON answers, not the SPA page. */
export const notAllowed = () => errorJson('method_not_allowed', 405)

export function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/')
}

const MAX_BODY_BYTES = 64 * 1024

/**
 * The request body as bytes, at most `limit` of them, else InputError(tooLarge, 413). A declared Content-Length over
 * the limit is refused before reading; the stream itself is counted too, since Content-Length alone is not trustworthy.
 */
export async function readBytes(request: Request, limit: number, tooLarge = 'body_too_large'): Promise<Uint8Array> {
  const declared = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(declared) && declared > limit) throw new InputError(tooLarge, 413)
  const reader = request.body?.getReader()
  if (!reader) throw new InputError('missing_body')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new InputError(tooLarge, 413)
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

/** The media type of a request, without parameters, in lower case (media types are case-insensitive, RFC 9110 §8.3.1). */
export const mediaType = (request: Request) => request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()

/** A file answer: the body with its type and length, `Content-Disposition: attachment`, never cached or sniffed. */
export function attachment(body: BodyInit, { type, length, filename }: { type: string; length: number; filename: string }): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(length),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** A request body that must be a plain JSON object (not null, not an array), else 400 expected_object. */
export function plainObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('expected_object')
  return body as Record<string, unknown>
}

/** One property of a request body that may be anything: undefined unless the body is an object. */
export const field = (body: unknown, key: string): unknown =>
  body !== null && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined

export async function readJson(request: Request, limit = MAX_BODY_BYTES): Promise<unknown> {
  if (mediaType(request) !== 'application/json') throw new InputError('unsupported_media_type', 415)
  const bytes = await readBytes(request, limit)
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new InputError('invalid_json') }
}

/** A database constraint violation (UNIQUE, NOT NULL, CHECK, FOREIGN KEY). */
export const isConstraint = (err: unknown) => String(err).includes('constraint failed')

const SQLITE_FULL = 13

/** SQLITE_FULL: the disk is full, or the database reached its page cap (a demo sandbox). */
export const isFull = (err: unknown) => {
  const code = (err as { errcode?: unknown } | null)?.errcode
  return typeof code === 'number' && (code & 0xff) === SQLITE_FULL
}

/**
 * The answer to an error no route turned into its own: a full database is a 507 storage_full (the write did not
 * happen, nothing is wrong with the request), anything else is a 500 with `failure`. The details go to the log only.
 */
export function failureJson(err: unknown, failure: string): Response {
  return isFull(err) ? errorJson('storage_full', 507) : errorJson(failure, 500)
}

/** One JSON record per failure; escape controls and Unicode line separators in every field. */
export function logRequestError(req: { method: string; path: string }, tag: string, err: unknown): void {
  const error = err instanceof Error ? err.stack ?? err.message : String(err)
  console.error(JSON.stringify({ tag, method: req.method, path: req.path, error })
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`))
}

interface GuardOptions {
  /** Tag identifying the route in the structured error log. */
  tag: string
  /** Error code of the 409 for a database constraint violation; without it such an error is a 500 */
  conflict?: string
  /** Error code of the 500 */
  failure?: string
  /** What to log instead of the error itself (reminders cut the bot token out of it) */
  describe?: (err: unknown) => unknown
}

/**
 * Route error handling: an InputError keeps its status and code, a constraint violation is a 409, a full database
 * a 507, anything else is a 500 without details (those go to the log). A ready Response passes as is, data becomes JSON.
 */
export async function guard(
  req: { method: string; path: string },
  { tag, conflict, failure = 'save_failed', describe }: GuardOptions,
  run: () => Promise<unknown>,
): Promise<Response> {
  try {
    const result = await run()
    return result instanceof Response ? result : json(result)
  } catch (err) {
    if (err instanceof InputError) return errorJson(err.code, err.status, err.params)
    if (conflict && isConstraint(err)) return errorJson(conflict, 409)
    logRequestError(req, tag, describe ? describe(err) : err)
    return failureJson(err, failure)
  }
}
