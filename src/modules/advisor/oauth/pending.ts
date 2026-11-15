// In-memory OAuth state that lives minutes: authorization requests waiting for the person's consent, and the one-time
// codes handed to Claude after it. A restart drops both, and Claude starts the connection again.
import { randomId } from '../../../server/secrets'
import type { SCOPE } from './store'

/** A validated `/oauth/authorize` request, waiting for the consent screen. */
export interface AuthorizationRequest {
  clientId: string
  clientName: string | null
  redirectUri: string
  /** base64url(SHA-256(code_verifier)): PKCE S256 */
  codeChallenge: string
  state: string | null
  scope: typeof SCOPE
}

/** What a code stands for: the request, the person who consented and the chain of tokens it starts. */
export interface CodeGrant extends AuthorizationRequest {
  userId: number
  /** the person's Telegram account at consent: every token of the chain is bound to it */
  telegramId: string
  chainId: string
}

/** A pending authorization request lives 10 minutes. */
const PENDING_TTL_MS = 10 * 60_000
/** At most this many pending requests are kept; when full, the oldest goes. */
const PENDING_MAX = 200
/** An authorization code lives 60 seconds and is used once. */
const CODE_TTL_MS = 60_000
/** A taken code is remembered this long, so a replay can revoke the tokens issued from it. */
const SPENT_CODE_MEMORY_MS = 10 * 60_000
/** At most this many codes (live and spent) are kept; when full, the oldest goes. */
const CODE_MAX = 1000

/** 256 random bits, base64url (43 characters). */
const newId = () => randomId(32)

interface Entry<T> { value: T; expiresAt: number }

/** A map whose entries expire; `max` bounds it (expired entries go first, then the oldest). */
function expiringMap<T>(now: () => number, max: number) {
  // Map order is insertion order: the first entry is the oldest
  const entries = new Map<string, Entry<T>>()
  const live = (key: string) => {
    const entry = entries.get(key)
    if (entry && now() >= entry.expiresAt) { entries.delete(key); return undefined }
    return entry
  }
  return {
    live,
    /** The live values (expired entries are dropped on the way) */
    values(): T[] {
      for (const k of [...entries.keys()]) live(k)
      return [...entries.values()].map(e => e.value)
    },
    delete: (key: string) => entries.delete(key),
    set(key: string, value: T, ttlMs: number) {
      if (entries.size >= max) for (const k of [...entries.keys()]) live(k)
      while (entries.size >= max) entries.delete(entries.keys().next().value!)
      entries.set(key, { value, expiresAt: now() + ttlMs })
    },
  }
}

export interface PendingStore {
  /** Keeps the request and returns its id for the consent page */
  put(req: AuthorizationRequest): string
  /** The request while it is live; it stays */
  get(id: string): AuthorizationRequest | null
  /** The request while it is live; it is gone afterwards */
  take(id: string): AuthorizationRequest | null
  /** The clients of the live requests: registration must not evict them */
  clientIds(): Set<string>
}

export function createPendingStore(
  { now = Date.now, ttlMs = PENDING_TTL_MS, max = PENDING_MAX }: { now?: () => number; ttlMs?: number; max?: number } = {},
): PendingStore {
  const requests = expiringMap<AuthorizationRequest>(now, max)
  return {
    put(req) {
      const id = newId()
      requests.set(id, { ...req }, ttlMs)
      return id
    },
    get: id => {
      const entry = requests.live(id)
      return entry ? { ...entry.value } : null
    },
    take(id) {
      const entry = requests.live(id)
      if (!entry) return null
      requests.delete(id)
      return { ...entry.value }
    },
    clientIds: () => new Set(requests.values().map(r => r.clientId)),
  }
}

export interface CodeStore {
  /** A new one-time code for the grant */
  issue(grant: CodeGrant): string
  /** The grant of a live code that was not taken yet; the code is spent from now on */
  take(code: string): CodeGrant | null
  /** The chain of a code already taken (a replay), while it is remembered; else null */
  spentChain(code: string): string | null
  /** The clients of the live codes not taken yet: registration must not evict them */
  clientIds(): Set<string>
}

type CodeState = { grant: CodeGrant; spent: boolean }

export function createCodeStore(
  { now = Date.now, ttlMs = CODE_TTL_MS, max = CODE_MAX }: { now?: () => number; ttlMs?: number; max?: number } = {},
): CodeStore {
  const codes = expiringMap<CodeState>(now, max)
  return {
    issue(grant) {
      const code = newId()
      codes.set(code, { grant: { ...grant }, spent: false }, ttlMs)
      return code
    },
    take(code) {
      const entry = codes.live(code)
      if (!entry || entry.value.spent) return null
      // spent at once and remembered a while longer, for replay detection
      codes.delete(code)
      codes.set(code, { grant: entry.value.grant, spent: true }, SPENT_CODE_MEMORY_MS)
      return { ...entry.value.grant }
    },
    spentChain(code) {
      const entry = codes.live(code)
      return entry?.value.spent ? entry.value.grant.chainId : null
    },
    clientIds: () => new Set(codes.values().filter(c => !c.spent).map(c => c.grant.clientId)),
  }
}
