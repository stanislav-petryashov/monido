import type { MsgParams } from '../domain/types'
import { errorMessage, t } from '../i18n/client'
import { reloadAuth, sessionLost } from './authState'

/**
 * A failed API request. `message` is the text in the UI language: `errors.<code>` with its params;
 * a plain-text error is shown as received; anything else reads as the HTTP status.
 */
export class ApiError extends Error {
  readonly code: string | null
  readonly params?: MsgParams
  readonly status: number
  constructor(status: number, code: string | null, message: string, params?: MsgParams) {
    super(message)
    this.status = status
    this.code = code
    this.params = params
  }
}

/** Params as the messages read them: a wait in seconds (`{ retryAfter }`, the demo's refusals) reads in whole minutes, rounded up, as the plural `count`. */
function displayParams(params?: MsgParams): MsgParams {
  const wait = params?.retryAfter
  return {
    ...params,
    ...(typeof wait === 'number' ? { count: Math.max(1, Math.ceil(wait / 60)) } : {}),
  }
}

/** The error of an answer: `{ error: { code, params? } }`, the older `{ error: 'text' }`, or just the status. */
export function apiError(status: number, body: unknown): ApiError {
  const error = (body as { error?: unknown } | null)?.error
  if (typeof error === 'string' && error) return new ApiError(status, null, error)
  const { code, params } = (error ?? {}) as { code?: unknown; params?: MsgParams }
  if (typeof code !== 'string') return new ApiError(status, null, t('errors.http', { status }))
  return new ApiError(status, code, errorMessage(code, displayParams(params), t('errors.http', { status })), params)
}

/**
 * 401: the session is over — the sign-in screen appears, or in the demo the end-of-session dialog. The demo's
 * `demo_expired` keeps its own code and text. `wrong_current_password` (the Settings password checks) is not a lost
 * session: it is an ordinary error with its code.
 */
async function unauthorized(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null) as { error?: { code?: unknown } } | null
  const code = body?.error?.code
  // a mistyped current password in a Settings dialog: the session is still good, the dialog words it
  if (code === 'wrong_current_password') return apiError(401, body)
  sessionLost()
  return code === 'demo_expired' ? apiError(401, body) : new ApiError(401, 'unauthorized', t('errors.unauthorized'))
}

/** fetch whose network failure (offline, the server down) reads as `auth.unreachable`; a cancelled request stays an AbortError */
async function send(url: string, options?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, options)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'network', t('auth.unreachable'))
  }
}

/**
 * An API request: the JSON answer, or an ApiError. T is the shape the endpoint answers with (the types of
 * `src/domain/api.ts`); the body is checked to be a JSON object, not against T — the server and the browser ship together.
 */
export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await send(url, options)
  if (res.status === 401) throw await unauthorized(res)
  // the body may not be JSON (an HTML 502 page from a proxy): then the error reads as the status
  const data = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!res.ok || !data || data['error']) {
    const code = (data?.['error'] as { code?: unknown } | undefined)?.code
    // a right was taken away since the app read it: the menus and the screens catch up
    if (res.status === 403 && typeof code === 'string' && code.startsWith('no_right_')) void reloadAuth()
    throw apiError(res.status, data)
  }
  return data as T
}

/** Downloads a file from the API (the database copy): the name comes from Content-Disposition; errors as in apiFetch. */
export async function downloadFile(url: string): Promise<string> {
  const res = await send(url)
  if (res.status === 401) throw await unauthorized(res)
  if (!res.ok) throw apiError(res.status, await res.json().catch(() => null))
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'download'
  const href = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  // release the blob link once the browser has started saving
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
  return name
}

/** A write through the API: a JSON body with its header; without a body, just the method (DELETE). T is the answer, if the caller reads it. */
export function apiSend<T = void>(url: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  return apiFetch<T>(url, body === undefined
    ? { method }
    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

/** A file as the raw body of a POST (a backup to restore); the answer and the errors as in apiFetch. */
export function apiUpload<T = unknown>(url: string, file: Blob): Promise<T> {
  return apiFetch<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file })
}
