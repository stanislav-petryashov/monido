// Update notice: the latest semver tag of the public image on ghcr.io, asked at most once a day. Only the image name is sent.
import { IMAGE_REPO as IMAGE } from '../lib/imageRepo'

const TIMEOUT_MS = 5000
const DAY_MS = 24 * 3600_000
const FAILURE_MS = 3600_000
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

type Triple = [number, number, number]
const triple = (m: RegExpMatchArray): Triple => [Number(m[1]), Number(m[2]), Number(m[3])]
const cmp = (a: Triple, b: Triple) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

async function getJson(fetchImpl: typeof fetch, url: string, signal: AbortSignal, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetchImpl(url, { headers, signal })
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json()
}

/**
 * The greatest `X.Y.Z` tag of the image; any failure (network, rate limit, odd answer, the deadline) is null, silently.
 * `signal` is ONE deadline for both requests (default 5 s).
 */
export async function latestImageTag(fetchImpl: typeof fetch = fetch, signal: AbortSignal = AbortSignal.timeout(TIMEOUT_MS)): Promise<string | null> {
  try {
    const auth = await getJson(fetchImpl, `https://ghcr.io/token?scope=repository:${IMAGE}:pull`, signal) as { token?: unknown }
    if (typeof auth.token !== 'string') return null
    // one page as large as the registry gives: the default page may end before the newest tags
    const list = await getJson(fetchImpl, `https://ghcr.io/v2/${IMAGE}/tags/list?n=1000`, signal, { Authorization: `Bearer ${auth.token}` }) as { tags?: unknown }
    if (!Array.isArray(list.tags)) return null
    let best: Triple | null = null
    for (const tag of list.tags) {
      const m = typeof tag === 'string' ? tag.match(SEMVER) : null
      if (m && (!best || cmp(triple(m), best) > 0)) best = triple(m)
    }
    return best ? best.join('.') : null
  } catch { return null }
}

/** Is `latest` newer than the leading X.Y.Z of `current`? A dev build, an unknown format or no answer is never behind. */
export function isBehind(current: string, latest: string | null): boolean {
  const c = current.match(/^(\d+)\.(\d+)\.(\d+)/)
  const l = latest?.match(SEMVER)
  return !!c && !!l && cmp(triple(c), triple(l)) < 0
}

/** One check a day, a failure is remembered for an hour; disabled never calls out. */
export function createUpdateChecker({ enabled, fetchImpl = fetch, now = Date.now }: { enabled: boolean; fetchImpl?: typeof fetch; now?: () => number }) {
  let cached: { value: string | null; until: number } | null = null
  let pending: Promise<string | null> | null = null
  return {
    async latest(): Promise<string | null> {
      if (!enabled) return null
      if (cached && now() < cached.until) return cached.value
      pending ??= latestImageTag(fetchImpl).then(value => {
        cached = { value, until: now() + (value ? DAY_MS : FAILURE_MS) }
        return value
      }).finally(() => { pending = null })
      return pending
    },
  }
}
