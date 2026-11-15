// Sign-in through the bot: the browser starts an attempt and gets a public code (for the deep link) and a secret
// (for its cookie); the bot approves the code for a user; only the browser holding the secret takes the session.
// In memory: a restart drops the attempts, and the person presses the button again.
import { InputError } from './http'
import { randomId, sameSecret } from './secrets'

export interface LoginTarget {
  valid(): boolean
  confirm?(telegram: { id: string; name: string | null }, valid: () => boolean): Promise<number | 'mismatch' | 'expired'>
}

export interface LoginAttempts {
  /**
   * `key`: the client's limiter key (IPv6 /64), capped at `perKey` live attempts; `group` (IPv6 /48, default the key)
   * ranks clients for eviction. Throws 429 sign_in_attempts_full when there is no room
   */
  start(target?: LoginTarget, key?: string, group?: string): { code: string; secret: string }
  targeted(code: string): boolean
  confirm(code: string, telegram: { id: string; name: string | null }): Promise<boolean>
  cancel(code: string, secret: string): void
  /** A confirm from the bot: false when the code is unknown, expired, or already approved */
  approve(code: string, userId: number): boolean
  /**
   * The browser asks: only the matching secret completes; 'done' is returned once, then the attempt is gone. `approvedAt`
   * (ms) is when the bot confirmed: the session counts from then, so a re-link in between ends it.
   */
  take(code: string, secret: string): { status: 'waiting' | 'expired' | 'mismatch' } | { status: 'done'; userId: number; approvedAt: number }
}

interface Attempt { key?: string; group?: string; secret: string; expiresAt: number; userId: number | null; approvedAt: number; target?: LoginTarget; failure?: 'mismatch' | 'expired'; confirming?: boolean }

const TTL_MS = 5 * 60_000

/**
 * At most `max` attempts are kept, `perKey` of them from one client key. Expired attempts go first; a full store then
 * drops the oldest unapproved attempt of the busiest group (an IPv6 /48 spreads over many /64 keys), and only of a group
 * holding more than one and more than the requester's: a lone attempt and one approved in Telegram are never pushed out.
 * Otherwise the start is refused (429).
 * shortcut: an attacker with about `max` (1000) distinct IPv4 addresses or IPv6 /48s can block new starts while the flood
 * lasts (each key's single attempt is never evicted); upgrade (e.g. a per-user cap) if that is ever seen.
 */
export function createLoginAttempts(
  { ttlMs = TTL_MS, now = Date.now, max = 1000, perKey = 5 }: { ttlMs?: number; now?: () => number; max?: number; perKey?: number } = {},
): LoginAttempts {
  const attempts = new Map<string, Attempt>()
  const live = (code: string) => {
    const attempt = attempts.get(code)
    if (attempt && (now() >= attempt.expiresAt || attempt.target && !attempt.target.valid())) { attempts.delete(code); return undefined }
    return attempt
  }
  return {
    start(target, key, group = key) {
      for (const code of attempts.keys()) live(code)
      const values = [...attempts.values()]
      if (key !== undefined && values.filter(a => a.key === key).length >= perKey) throw new InputError('sign_in_attempts_full', 429)
      if (attempts.size >= max) {
        const counts = new Map<string | undefined, number>()
        for (const a of values) counts.set(a.group, (counts.get(a.group) ?? 0) + 1)
        let victim: string | undefined
        let most = Math.max(1, counts.get(group) ?? 0)
        // insertion order: the first attempt found of the busiest group is its oldest
        for (const [code, a] of attempts) {
          const n = counts.get(a.group) ?? 0
          if (n > most && a.userId === null && !a.confirming) { victim = code; most = n }
        }
        if (victim === undefined) throw new InputError('sign_in_attempts_full', 429)
        attempts.delete(victim)
      }
      // 128 bits for the public code (22 characters, within Telegram's 64 for /start), 256 for the secret
      const code = randomId(16)
      const secret = randomId(32)
      attempts.set(code, { key, group, secret, expiresAt: now() + ttlMs, userId: null, approvedAt: 0, target })
      return { code, secret }
    },
    targeted(code) { return !!live(code)?.target?.confirm },
    cancel(code, secret) {
      const attempt = live(code)
      if (attempt && sameSecret(secret, attempt.secret)) attempts.delete(code)
    },
    async confirm(code, telegram) {
      const attempt = live(code)
      if (!attempt?.target?.confirm || attempt.confirming || attempt.userId !== null || attempt.failure) return false
      attempt.confirming = true
      const valid = () => live(code) === attempt
      const result = await attempt.target.confirm(telegram, valid)
      if (!valid()) return false
      if (typeof result !== 'number') { attempt.failure = result; return false }
      attempt.userId = result
      attempt.approvedAt = now()
      return true
    },
    approve(code, userId) {
      const attempt = live(code)
      if (!attempt || attempt.target?.confirm || attempt.userId !== null) return false
      attempt.userId = userId
      attempt.approvedAt = now()
      return true
    },
    take(code, secret) {
      const attempt = live(code)
      if (!attempt) return { status: 'expired' }
      // a wrong secret learns nothing: it looks like an attempt still waiting
      if (!sameSecret(secret, attempt.secret)) return { status: 'waiting' }
      if (attempt.failure) { attempts.delete(code); return { status: attempt.failure } }
      if (attempt.userId === null) return { status: 'waiting' }
      attempts.delete(code)
      return { status: 'done', userId: attempt.userId, approvedAt: attempt.approvedAt }
    },
  }
}
