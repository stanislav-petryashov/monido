import { vi, type Mock } from 'vitest'

/** A JSON server response with the given status. */
export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export type TableRows = Record<string, Record<string, unknown>[]>

/**
 * An answer that replaces stubApi's own: gets the request's init (its body) and `next`, the answer the stub gave the
 * same request before this one was laid (to delay it behind a gate, or to count it and pass it on).
 */
export type Answer = (init: RequestInit | undefined, next: () => Promise<Response>) => Response | Promise<Response>

/** Answers keyed by `METHOD url` ('PUT /api/admin/loans/1'), by url for every method ('/api/wipe'), or by `METHOD *` ('POST *': every add). */
export type Answers = Record<string, Answer>

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** stubApi's fetch mock; `answer(more)` lays more answers over the ones set (mid-test too) and returns the same mock. */
export type ApiMock = Mock<Fetch> & { answer: (more: Answers) => ApiMock }

/**
 * A fetch stub for the Data screens: /api/settings keeps the family settings (en-US, USD) and takes a PUT;
 * /api/admin/:table gives the rows from fixtures, the columns being the keys of the first row without rowid; anything else is empty.
 * `answer` overrides it by `METHOD url`, by url, or by `METHOD *` — looked up in that order. `.answer(more)` on the
 * returned mock lays another map over it: the newest map that has a key for the request answers it, its `next` is the
 * answer of the maps below (stubApi's own under all of them).
 * Returns the fetch mock so a test can check which requests went out (`sent`).
 */
/** GET /api/spending with nothing in it: the Breakdown query, which the Accounts screen's categories read too */
export const NO_SPENDING = { categories: [], accounts: [], sources: [], manual: null }

export function stubApi(tables: TableRows = {}, { answer = {} }: { answer?: Answers } = {}): ApiMock {
  let settings = { language: 'en-US', currency: 'USD', trackFlows: true }
  const own = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/settings') {
      if (init?.method === 'PUT') settings = { ...settings, ...JSON.parse(String(init.body)) }
      return jsonResponse(settings)
    }
    // the Breakdown query (the Accounts screen's categories read it too): none unless a test answers it
    if (String(input) === '/api/spending') return jsonResponse(NO_SPENDING)
    const table = String(input).split('/').pop() ?? ''
    const rows = tables[table] ?? []
    const columns = rows.length ? Object.keys(rows[0]).filter(k => k !== 'rowid') : []
    return jsonResponse({ rows, columns })
  }
  /** the answer maps, oldest first */
  const layers: Answers[] = [answer]
  const respond = async (input: RequestInfo | URL, init: RequestInit | undefined, depth: number): Promise<Response> => {
    if (depth < 0) return own(input, init)
    const url = String(input)
    const method = init?.method ?? 'GET'
    const map = layers[depth]
    const override = map[`${method} ${url}`] ?? map[url] ?? map[`${method} *`]
    const next = () => respond(input, init, depth - 1)
    return override ? override(init, next) : next()
  }
  const fetchMock = vi.fn<Fetch>((input, init) => respond(input, init, layers.length - 1)) as ApiMock
  fetchMock.answer = (more: Answers) => { layers.push(more); return fetchMock }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** One request a fetch mock saw: its method (GET when none), url and body (parsed when it is JSON text). */
export interface SentRequest<B = unknown> { method: string; url: string; body: B }

/** Every write method: what a "writes nothing" check counts. */
export const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

/** The requests `fetchMock` saw, in order; only those of `method` (one or several) when given. `B`: the bodies' shape, as the test expects it. */
export function sent<B = unknown>(fetchMock: Mock, method?: string | readonly string[]): SentRequest<B>[] {
  const methods = method === undefined ? null : typeof method === 'string' ? [method] : method
  return (fetchMock.mock.calls as [RequestInfo | URL, RequestInit | undefined][])
    .map(([input, init]) => ({ method: init?.method ?? 'GET', url: String(input), body: parseBody(init?.body) as B }))
    .filter(r => !methods || methods.includes(r.method))
}

function parseBody(body: RequestInit['body'] | undefined): unknown {
  if (typeof body !== 'string') return body ?? undefined
  try { return JSON.parse(body) as unknown } catch { return body }
}

/** A promise settled from outside: `resolve` / `reject` it when the test is ready. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
