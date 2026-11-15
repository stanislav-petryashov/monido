import { describe, expect, it, vi } from 'vitest'
import { createUpdateChecker, isBehind, latestImageTag } from '../../src/server/updates'
import { createApp } from '../../src/server/app'
import { createTestDb, testConfig } from '../helpers/db'
import { IMAGE_REPO } from '../../src/lib/imageRepo'
import { jsonResponse } from '../helpers/http'
import { authFor } from '../helpers/auth'
import { FAMILY_PASSWORD, familyCookie } from '../helpers/session'

/** A registry stub: the anonymous token, then the tag list. */
const registry = (tags: string[]) => vi.fn(async (input: RequestInfo | URL) =>
  String(input).startsWith('https://ghcr.io/token') ? jsonResponse({ token: 'anon' }) : jsonResponse({ tags }))

describe('isBehind', () => {
  it('compares the leading X.Y.Z', () => {
    expect(isBehind('0.9.0', '0.10.0')).toBe(true)
    expect(isBehind('0.10.0-3-gabc', '0.10.0')).toBe(false)
    expect(isBehind('0.10.0', '0.10.0')).toBe(false)
    expect(isBehind('1.0.0', '0.10.0')).toBe(false)
  })
  it('never says behind for a dev build or without an answer', () => {
    expect(isBehind('dev', '0.10.0')).toBe(false)
    expect(isBehind('0.9.0', null)).toBe(false)
  })
})

describe('latestImageTag', () => {
  it('picks the greatest semver tag', async () => {
    const f = registry(['latest', '0.9.0', '0.10.0', '0.2.0', 'sha-abc', '0.10.0-3-gabc'])
    expect(await latestImageTag(f)).toBe('0.10.0')
    const urls = f.mock.calls.map(([u]) => String(u))
    expect(urls[0]).toBe(`https://ghcr.io/token?scope=repository:${IMAGE_REPO}:pull`)
    expect(urls[1]).toBe(`https://ghcr.io/v2/${IMAGE_REPO}/tags/list?n=1000`)
  })
  it('is null on any failure', async () => {
    expect(await latestImageTag(vi.fn(async () => { throw new Error('down') }))).toBeNull()
    expect(await latestImageTag(vi.fn(async () => jsonResponse({}, 429)))).toBeNull()
  })
})

describe('the deadline', () => {
  it('one deadline covers both requests: a hanging registry answers null at once after it', async () => {
    const hang = vi.fn((_u: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const deadline = new AbortController()
    const answer = latestImageTag(hang as unknown as typeof fetch, deadline.signal)
    expect(hang).toHaveBeenCalledTimes(1)
    deadline.abort()
    expect(await answer).toBeNull()
    expect(hang).toHaveBeenCalledTimes(1)
  })
  it('a token that arrives in time but a tag list that hangs is still cut by the same deadline', async () => {
    const f = vi.fn((u: RequestInfo | URL, init?: RequestInit) => String(u).includes('/token')
      ? Promise.resolve(jsonResponse({ token: 'x' }))
      : new Promise<Response>((_, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))) }))
    const deadline = new AbortController()
    const answer = latestImageTag(f as unknown as typeof fetch, deadline.signal)
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2))
    deadline.abort()
    expect(await answer).toBeNull()
  })
})

describe('createUpdateChecker', () => {
  it('a failing check is cached and silent', async () => {
    let t = 0
    const f = vi.fn(async () => { throw new Error('down') })
    const checker = createUpdateChecker({ enabled: true, fetchImpl: f as unknown as typeof fetch, now: () => t })
    expect(await checker.latest()).toBeNull()
    const calls = f.mock.calls.length
    t += 30 * 60_000
    expect(await checker.latest()).toBeNull()
    expect(f.mock.calls.length).toBe(calls)
    t += 31 * 60_000
    await checker.latest()
    expect(f.mock.calls.length).toBeGreaterThan(calls)
  })
  it('caches a success for a day', async () => {
    let t = 0
    const f = registry(['0.10.0'])
    const checker = createUpdateChecker({ enabled: true, fetchImpl: f, now: () => t })
    expect(await checker.latest()).toBe('0.10.0')
    const calls = f.mock.calls.length
    t += 23 * 3600_000
    await checker.latest()
    expect(f.mock.calls.length).toBe(calls)
    t += 2 * 3600_000
    await checker.latest()
    expect(f.mock.calls.length).toBeGreaterThan(calls)
  })
  it('disabled sends no request', async () => {
    const f = registry(['0.10.0'])
    expect(await createUpdateChecker({ enabled: false, fetchImpl: f, now: () => 0 }).latest()).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})

describe('GET /api/version', () => {
  const config = (env: Record<string, string>) => testConfig({ password: FAMILY_PASSWORD, ...env })
  const app = (env: Record<string, string>, f: typeof fetch) =>
    createApp({ db: createTestDb(), config: config(env), auth: authFor(config(env)), updateFetch: f })
  const authHeaders = async (env: Record<string, string>) => ({ Cookie: await familyCookie(authFor(config(env))) })

  it('answers with the version, the latest tag and whether it is behind', async () => {
    const res = await app({ APP_VERSION: '0.9.0' }, registry(['0.10.0'])).request('/api/version', { headers: await authHeaders({ APP_VERSION: '0.9.0' }) })
    expect(await res.json()).toEqual({ version: '0.9.0', latest: '0.10.0', behind: true })
  })
  it('requires sign-in', async () => {
    expect((await app({}, registry([])).request('/api/version')).status).toBe(401)
  })
  it('says dev and asks nobody when the check is off', async () => {
    const f = registry(['0.10.0'])
    const res = await app({ UPDATE_CHECK: 'off' }, f).request('/api/version', { headers: await authHeaders({ UPDATE_CHECK: 'off' }) })
    expect(await res.json()).toEqual({ version: 'dev', latest: null, behind: false })
    expect(f).not.toHaveBeenCalled()
  })
})
